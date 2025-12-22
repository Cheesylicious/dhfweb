# dhf_app/routes_auth.py

from flask import Blueprint, request, jsonify, current_app, session
from .models import User, Role, UpdateLog
from .extensions import db, bcrypt
from flask_login import login_user, logout_user, current_user
from .utils import login_required
from .models_audit import log_audit
from datetime import datetime
import traceback

auth_bp = Blueprint('auth', __name__, url_prefix='/api')


@auth_bp.route('/check_session', methods=['GET'])
@login_required
def check_session():
    """
    Prüft, ob der Benutzer eingeloggt ist und gibt Daten zurück.
    Gibt zusätzlich 'is_impersonating' zurück, wenn ein Admin als anderer User agiert.
    """
    is_impersonating = 'original_admin_id' in session
    return jsonify({
        "user": current_user.to_dict(),
        "is_impersonating": is_impersonating
    }), 200


@auth_bp.route('/login', methods=['POST'])
def login():
    """
    Loggt einen Benutzer ein.
    """
    # Sicherheitsreinigung: Falls noch alte Impersonation-Daten in der Session hängen
    session.pop('original_admin_id', None)

    data = request.get_json()
    user = User.query.filter_by(vorname=data.get('vorname'), name=data.get('name')).first()

    if user and bcrypt.check_password_hash(user.passwort_hash, data.get('passwort')):
        login_user(user, remember=True)

        # Aktivität loggen mit dem neuen Audit-System
        log_audit(action="LOGIN", user=user)

        user.zuletzt_online = datetime.utcnow()
        db.session.commit()
        return jsonify({"message": "Login erfolgreich", "user": user.to_dict()}), 200
    else:
        return jsonify({"message": "Ungültige Anmeldedaten"}), 401


@auth_bp.route('/logout', methods=['POST'])
@login_required
def logout():
    """
    Loggt den aktuellen Benutzer aus.
    Löscht auch eventuelle Impersonation-Sessions.
    """
    # Dauer berechnen für Details
    duration_str = ""
    if current_user.zuletzt_online:
        diff = datetime.utcnow() - current_user.zuletzt_online
        total_seconds = int(diff.total_seconds())
        hours, remainder = divmod(total_seconds, 3600)
        minutes, seconds = divmod(remainder, 60)
        duration_str = f"Dauer: {hours}h {minutes}m {seconds}s"

    # Loggen VOR dem Logout, damit wir den User noch haben
    log_audit(action="LOGOUT", details={"duration": duration_str}, user=current_user)

    # Impersonation Key bereinigen
    session.pop('original_admin_id', None)

    logout_user()
    return jsonify({"message": "Erfolgreich abgemeldet"}), 200


@auth_bp.route('/change_password', methods=['POST'])
@login_required
def change_password():
    """
    Passwort ändern (für den eingeloggten User).
    """
    data = request.get_json()
    old_password = data.get('old_password')
    new_password1 = data.get('new_password1')
    new_password2 = data.get('new_password2')

    if not old_password or not new_password1 or not new_password2:
        return jsonify({"message": "Alle Felder sind erforderlich."}), 400

    if new_password1 != new_password2:
        return jsonify({"message": "Die neuen Passwörter stimmen nicht überein."}), 400

    if len(new_password1) < 4:
        return jsonify({"message": "Das neue Passwort muss mindestens 4 Zeichen lang sein."}), 400

    if not bcrypt.check_password_hash(current_user.passwort_hash, old_password):
        return jsonify({"message": "Das alte Passwort ist falsch."}), 403

    try:
        new_hash = bcrypt.generate_password_hash(new_password1).decode('utf-8')
        current_user.passwort_hash = new_hash
        current_user.password_geaendert = datetime.utcnow()
        current_user.force_password_change = False

        log_audit(action="PASSWORD_CHANGE", user=current_user)

        db.session.commit()

        return jsonify({"message": "Passwort erfolgreich geändert."}), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler bei Passwortänderung: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


# --- Profil-Management ---

@auth_bp.route('/user/profile', methods=['GET'])
@login_required
def get_profile():
    return jsonify(current_user.to_dict()), 200


@auth_bp.route('/user/profile', methods=['PUT'])
@login_required
def update_profile():
    data = request.get_json()
    email = data.get('email', '').strip()
    telefon = data.get('telefon', '').strip()
    geburtstag_str = data.get('geburtstag', '').strip()

    if email:
        existing_user = User.query.filter(User.email == email, User.id != current_user.id).first()
        if existing_user:
            return jsonify({"message": "Diese E-Mail-Adresse wird bereits verwendet."}), 409
    else:
        email = None

    new_bday = None
    if geburtstag_str:
        try:
            new_bday = datetime.strptime(geburtstag_str, '%Y-%m-%d').date()
        except ValueError:
            return jsonify({"message": "Ungültiges Datumsformat für Geburtstag."}), 400

    try:
        changes = []
        if current_user.email != email:
            current_user.email = email
            changes.append("E-Mail")
        if telefon == "": telefon = None
        if current_user.telefon != telefon:
            current_user.telefon = telefon
            changes.append("Telefon")
        if current_user.geburtstag != new_bday:
            current_user.geburtstag = new_bday
            changes.append("Geburtstag")

        if changes:
            log_audit(action="PROFILE_UPDATE", details={"changed_fields": changes}, user=current_user)
            db.session.commit()
            return jsonify({"message": "Profil erfolgreich aktualisiert.", "user": current_user.to_dict()}), 200
        else:
            return jsonify({"message": "Keine Änderungen vorgenommen.", "user": current_user.to_dict()}), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler bei Profil-Update: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


# --- Shadow Admin / Impersonation Routen ---

@auth_bp.route('/impersonate', methods=['POST'])
@login_required
def impersonate_user():
    """
    Erlaubt einem Admin, sich als ein anderer Benutzer einzuloggen.
    """
    try:
        # 1. Berechtigung prüfen (Robust)
        user_role = ""

        # Prüfe auf 'role' (Englisch, Standard in modernem SQLAlchemy)
        if hasattr(current_user, 'role') and current_user.role:
            user_role = getattr(current_user.role, 'name', str(current_user.role))
        # Prüfe auf 'rolle' (Deutsch, falls Legacy-Code)
        elif hasattr(current_user, 'rolle') and current_user.rolle:
            user_role = getattr(current_user.rolle, 'name', str(current_user.rolle))
        # Prüfe direkt über ID (Sicherster Weg)
        elif hasattr(current_user, 'role_id') and current_user.role_id:
            r = db.session.get(Role, current_user.role_id)
            if r: user_role = r.name

        user_role = user_role.lower()

        if "admin" not in user_role and "owner" not in user_role:
            return jsonify({"message": "Zugriff verweigert."}), 403

        # 2. Ziel-User validieren
        data = request.get_json()
        target_user_id = data.get('user_id')
        target_user = db.session.get(User, target_user_id)

        if not target_user:
            return jsonify({"message": "Benutzer nicht gefunden."}), 404

        if target_user.id == current_user.id:
            return jsonify({"message": "Selbst-Login nicht notwendig."}), 400

        # 3. WICHTIG: Admin-ID sichern, BEVOR wir den User wechseln
        original_admin_id = current_user.id

        # 4. Audit Log schreiben UND COMMITEN
        log_audit(
            action="IMPERSONATION_START",
            details={"target_user_id": target_user.id, "target_user_name": f"{target_user.vorname} {target_user.name}"},
            user=current_user
        )
        db.session.commit()

        # 5. Login als Ziel-User durchführen
        login_user(target_user)

        # 6. Backpack wieder in die Session packen
        session['original_admin_id'] = original_admin_id

        # 7. WICHTIG: User-Objekt zurückgeben für Frontend-Sync
        return jsonify({
            "message": f"Angemeldet als {target_user.vorname} {target_user.name}",
            "redirect": "/dashboard.html",
            "user": target_user.to_dict()  # << NEU: Damit das Frontend den User kennt
        }), 200

    except Exception as e:
        current_app.logger.error(f"Impersonation Error: {str(e)}")
        current_app.logger.error(traceback.format_exc())
        db.session.rollback()
        return jsonify({"message": f"Serverfehler beim Wechseln: {str(e)}"}), 500


@auth_bp.route('/stop_impersonate', methods=['POST'])
@login_required
def stop_impersonate():
    """
    Beendet den Shadow-Modus.
    """
    try:
        original_admin_id = session.get('original_admin_id')

        if not original_admin_id:
            return jsonify({"message": "Keine aktive Shadow-Sitzung gefunden."}), 400

        admin_user = db.session.get(User, original_admin_id)

        if not admin_user:
            session.pop('original_admin_id', None)
            logout_user()
            return jsonify({"message": "Admin-Konto nicht gefunden."}), 401

        # Zurück zum Admin
        login_user(admin_user)
        session.pop('original_admin_id', None)

        log_audit(
            action="IMPERSONATION_END",
            details={"duration": "ended via stop_impersonate"},
            user=current_user
        )
        db.session.commit()

        return jsonify({
            "message": "Willkommen zurück, Admin.",
            "redirect": "/dashboard.html",
            "user": admin_user.to_dict()  # << NEU: Damit das Frontend wieder Admin ist
        }), 200

    except Exception as e:
        current_app.logger.error(f"Stop Impersonation Error: {str(e)}")
        return jsonify({"message": "Fehler beim Zurückwechseln."}), 500