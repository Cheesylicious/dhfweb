# dhf_app/routes_auth.py

from flask import Blueprint, request, jsonify, current_app
from .models import User, Role, UpdateLog
from .extensions import db, bcrypt
# KORREKTUR: Importiere nur die Komponenten von flask_login, die wir BRAUCHEN
from flask_login import login_user, logout_user, current_user
# NEU: Importiere unseren gefixten login_required aus utils
from .utils import login_required
from .models_audit import log_audit  # <<< NEU: Unser zentraler Audit-Logger
from datetime import datetime

# Erstellt einen Blueprint. Alle Routen hier beginnen mit /api
auth_bp = Blueprint('auth', __name__, url_prefix='/api')


@auth_bp.route('/check_session', methods=['GET'])
@login_required
def check_session():
    """
    Prüft, ob der Benutzer eingeloggt ist und gibt Daten zurück.
    """
    return jsonify({"user": current_user.to_dict()}), 200


@auth_bp.route('/login', methods=['POST'])
def login():
    """
    Loggt einen Benutzer ein.
    """
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
        # Optional: Fehlgeschlagene Logins loggen (Vorsicht: kann Logs fluten)
        # log_audit(action="LOGIN_FAILED", details={"name": data.get('name')})
        return jsonify({"message": "Ungültige Anmeldedaten"}), 401


@auth_bp.route('/logout', methods=['POST'])
@login_required
def logout():
    """
    Loggt den aktuellen Benutzer aus.
    """
    # Dauer berechnen für Details
    duration_str = ""
    if current_user.zuletzt_online:
        diff = datetime.utcnow() - current_user.zuletzt_online
        # Formatieren als HH:MM:SS
        total_seconds = int(diff.total_seconds())
        hours, remainder = divmod(total_seconds, 3600)
        minutes, seconds = divmod(remainder, 60)
        duration_str = f"Dauer: {hours}h {minutes}m {seconds}s"

    # Loggen VOR dem Logout, damit wir den User noch haben
    log_audit(action="LOGOUT", details={"duration": duration_str}, user=current_user)

    logout_user()
    # db.session.commit() # Nicht zwingend nötig für logout_user, aber schadet nicht

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


# --- Profil-Management (Erweitert) ---

@auth_bp.route('/user/profile', methods=['GET'])
@login_required
def get_profile():
    """
    Gibt die Profildaten des aktuellen Benutzers zurück.
    """
    return jsonify(current_user.to_dict()), 200


@auth_bp.route('/user/profile', methods=['PUT'])
@login_required
def update_profile():
    """
    Aktualisiert E-Mail, Telefon und Geburtstag des aktuellen Benutzers.
    """
    data = request.get_json()

    # Felder auslesen
    email = data.get('email', '').strip()
    telefon = data.get('telefon', '').strip()
    geburtstag_str = data.get('geburtstag', '').strip()  # Format YYYY-MM-DD vom Frontend

    # Validierung E-Mail
    if email:
        existing_user = User.query.filter(User.email == email, User.id != current_user.id).first()
        if existing_user:
            return jsonify({"message": "Diese E-Mail-Adresse wird bereits verwendet."}), 409
    else:
        email = None

    # Validierung Datum
    new_bday = None
    if geburtstag_str:
        try:
            # Versuche ISO-Format (YYYY-MM-DD)
            new_bday = datetime.strptime(geburtstag_str, '%Y-%m-%d').date()
        except ValueError:
            return jsonify({"message": "Ungültiges Datumsformat für Geburtstag."}), 400

    try:
        changes = []

        # E-Mail Update
        if current_user.email != email:
            current_user.email = email
            changes.append("E-Mail")

        # Telefon Update
        if telefon == "": telefon = None
        if current_user.telefon != telefon:
            current_user.telefon = telefon
            changes.append("Telefon")

        # Geburtstag Update
        if current_user.geburtstag != new_bday:
            current_user.geburtstag = new_bday
            changes.append("Geburtstag")

        if changes:
            # Audit Log
            log_audit(
                action="PROFILE_UPDATE",
                details={"changed_fields": changes},
                user=current_user
            )

            db.session.commit()
            return jsonify({"message": "Profil erfolgreich aktualisiert.", "user": current_user.to_dict()}), 200
        else:
            return jsonify({"message": "Keine Änderungen vorgenommen.", "user": current_user.to_dict()}), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler bei Profil-Update: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500