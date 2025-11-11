from flask import Blueprint, request, jsonify, current_app
from .models import User, Role
from .extensions import db, bcrypt, login_manager # login_manager wird evtl. nicht mehr gebraucht, schadet aber nicht
from flask_login import login_user, logout_user, login_required
from datetime import datetime

# Erstellt einen Blueprint. Alle Routen hier beginnen mit /api
auth_bp = Blueprint('auth', __name__, url_prefix='/api')

# --- @login_manager.user_loader WURDE VON HIER ENTFERNT ---
# (Das war die Fehlerquelle für den zirkulären Import)

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
        role_id=admin_role.id, password_geaendert=datetime.utcnow()
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
    (Logik 1:1 aus alter app.py)
    """
    data = request.get_json()
    user = User.query.filter_by(vorname=data['vorname'], name=data['name']).first()
    if user and bcrypt.check_password_hash(user.passwort_hash, data['passwort']):
        login_user(user, remember=True)
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
    (Logik 1:1 aus alter app.py)
    """
    logout_user()
    return jsonify({"message": "Erfolgreich abgemeldet"}), 200