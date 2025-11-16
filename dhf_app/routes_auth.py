from flask import Blueprint, request, jsonify, current_app
from .models import User, Role
from .extensions import db, bcrypt, login_manager  # login_manager wird evtl. nicht mehr gebraucht, schadet aber nicht
# HINZUGEFÜGT: current_user für die neue Route
from flask_login import login_user, logout_user, login_required, current_user
from datetime import datetime

# Erstellt einen Blueprint. Alle Routen hier beginnen mit /api
auth_bp = Blueprint('auth', __name__, url_prefix='/api')


# --- NEUE ROUTE: CHECK_SESSION ---
@auth_bp.route('/check_session', methods=['GET'])
@login_required
def check_session():
    """
    Prüft, ob der Benutzer (via Cookie) eingeloggt ist.
    Gibt die aktuellen Benutzerdaten zurück (inkl. force_password_change).
    Wenn nicht eingeloggt, wird 401 automatisch durch @login_required ausgelöst.
    """
    return jsonify({"user": current_user.to_dict()}), 200
# --- ENDE NEUE ROUTE ---


@auth_bp.route('/register', methods=['POST'])
def register():
    """
    Registriert den allerersten Admin-Benutzer.
    (Logik 1:1 aus alter app.py)
    """
    data = request.get_json()
    if not data or not data.get('vorname') or not data.get('passwort'):
        return jsonify({"message": "Fehlende Daten"}), 400
    existing_user = User.query.filter_by(vorname=data['vorname'], name=data['name']).first()
    if existing_user:
        return jsonify({"message": "Benutzer existiert bereits"}), 409
    passwort_hash = bcrypt.generate_password_hash(data['passwort']).decode('utf-8')
    admin_role = Role.query.filter_by(name='admin').first()
    if not admin_role:
        return jsonify({"message": "Kritischer Fehler: Admin-Rolle nicht gefunden"}), 500
    new_user = User(
        vorname=data['vorname'], name=data['name'], passwort_hash=passwort_hash,
        role_id=admin_role.id, password_geaendert=datetime.utcnow(),
        force_password_change=False  # Explizit auf False für den ersten Admin
    )
    try:
        db.session.add(new_user)
        db.session.commit()
        return jsonify({"message": "SuperAdmin erfolgreich registriert!"}), 201
    except Exception as e:
        db.session.rollback()
        # current_app.logger.error... ist der Standard-Flask-Weg für Logging
        current_app.logger.error(f"Datenbankfehler bei Registrierung: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


@auth_bp.route('/login', methods=['POST'])
def login():
    """
    Loggt einen Benutzer ein.
    (user.to_dict() enthält jetzt 'force_password_change')
    """
    data = request.get_json()
    user = User.query.filter_by(vorname=data['vorname'], name=data['name']).first()
    if user and bcrypt.check_password_hash(user.passwort_hash, data['passwort']):
        login_user(user, remember=True)
        user.zuletzt_online = datetime.utcnow()
        db.session.commit()
        # user.to_dict() enthält jetzt das "force_password_change" Flag
        return jsonify({"message": "Login erfolgreich", "user": user.to_dict()}), 200
    else:
        return jsonify({"message": "Ungültige Anmeldedaten"}), 401


@auth_bp.route('/logout', methods=['POST'])
@login_required
def logout():
    """
    Loggt den aktuellen Benutzer aus.
    (Logik 1:1 aus alter app.py)
    """
    logout_user()
    return jsonify({"message": "Erfolgreich abgemeldet"}), 200


# --- NEUE ROUTE ---
@auth_bp.route('/change_password', methods=['POST'])
@login_required
def change_password():
    """
    Ermöglicht dem *aktuell eingeloggten* Benutzer, sein eigenes Passwort zu ändern.
    Dies wird beim ersten Login erzwungen.
    """
    data = request.get_json()
    old_password = data.get('old_password')
    new_password1 = data.get('new_password1')
    new_password2 = data.get('new_password2')

    if not old_password or not new_password1 or not new_password2:
        return jsonify({"message": "Alle Felder sind erforderlich."}), 400

    if new_password1 != new_password2:
        return jsonify({"message": "Die neuen Passwörter stimmen nicht überein."}), 400

    if len(new_password1) < 4:  # Minimal-Check
        return jsonify({"message": "Das neue Passwort muss mindestens 4 Zeichen lang sein."}), 400

    # Prüfe das alte Passwort
    if not bcrypt.check_password_hash(current_user.passwort_hash, old_password):
        return jsonify({"message": "Das alte Passwort ist falsch."}), 403  # 403 = Forbidden

    try:
        # Setze das neue Passwort und update das Flag
        new_hash = bcrypt.generate_password_hash(new_password1).decode('utf-8')
        current_user.passwort_hash = new_hash
        current_user.password_geaendert = datetime.utcnow()
        current_user.force_password_change = False  # WICHTIG

        db.session.commit()

        return jsonify({"message": "Passwort erfolgreich geändert."}), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler bei Passwortänderung für User {current_user.id}: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500
# --- ENDE NEUE ROUTE ---