import os
from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from flask_bcrypt import Bcrypt
from flask_cors import CORS
from flask_login import (
    LoginManager, UserMixin, login_user, logout_user, login_required, current_user
)
from functools import wraps
from datetime import datetime
from sqlalchemy import extract, func

# --- 1. Initialisierung & Konfiguration ---
app = Flask(__name__)
# Stellen Sie sicher, dass Ihre Domain hier eingetragen ist
CORS(app, supports_credentials=True, origins=["http://46.224.63.203", "http://ihre-domain.de"])

# --- 2. Datenbank-Konfiguration (Wie bisher) ---
DB_USER = 'dhf_planer_app'
DB_PASS = 'SEHR_STARKES_PASSWORT_HIER'
DB_HOST = 'localhost'
DB_NAME = 'dhf_planer_db'

app.config['SQLALCHEMY_DATABASE_URI'] = f'mysql+mysqlconnector://{DB_USER}:{DB_PASS}@{DB_HOST}/{DB_NAME}'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# --- 3. Session Konfiguration (Wie bisher) ---
app.config['SECRET_KEY'] = 'SUPER-GEHEIMES-WORT-BITTE-AENDERN'
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

db = SQLAlchemy(app)
bcrypt = Bcrypt(app)
login_manager = LoginManager()
login_manager.init_app(app)


@login_manager.unauthorized_handler
def unauthorized():
    return jsonify({"message": "Nicht eingeloggt oder Sitzung abgelaufen"}), 401


@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))


# --- 5. Datenbank-Modelle (Alle unverändert) ---
class Role(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), unique=True, nullable=False)
    description = db.Column(db.String(255))

    def to_dict(self):
        return {"id": self.id, "name": self.name, "description": self.description}


class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    vorname = db.Column(db.String(100), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    passwort_hash = db.Column(db.String(128), nullable=False)
    role_id = db.Column(db.Integer, db.ForeignKey('role.id'), nullable=True)
    role = db.relationship('Role', backref=db.backref('users', lazy=True))
    geburtstag = db.Column(db.Date, nullable=True)
    telefon = db.Column(db.String(50), nullable=True)
    eintrittsdatum = db.Column(db.Date, nullable=True)
    aktiv_ab_datum = db.Column(db.Date, nullable=True)
    urlaub_gesamt = db.Column(db.Integer, default=0)
    urlaub_rest = db.Column(db.Integer, default=0)
    diensthund = db.Column(db.String(100), nullable=True)
    tutorial_gesehen = db.Column(db.Boolean, default=False)
    password_geaendert = db.Column(db.DateTime, nullable=True)
    zuletzt_online = db.Column(db.DateTime, nullable=True)
    shift_plan_visible = db.Column(db.Boolean, default=False)
    shift_plan_sort_order = db.Column(db.Integer, default=999)
    __table_args__ = (db.UniqueConstraint('vorname', 'name', name='_vorname_name_uc'),)

    def safe_date_iso(self, date_obj):
        if date_obj: return date_obj.isoformat()
        return None

    def to_dict(self):
        return {
            "id": self.id, "vorname": self.vorname, "name": self.name,
            "role": self.role.to_dict() if self.role else None, "role_id": self.role_id,
            "geburtstag": self.safe_date_iso(self.geburtstag), "telefon": self.telefon,
            "eintrittsdatum": self.safe_date_iso(self.eintrittsdatum),
            "aktiv_ab_datum": self.safe_date_iso(self.aktiv_ab_datum),
            "urlaub_gesamt": self.urlaub_gesamt, "urlaub_rest": self.urlaub_rest,
            "diensthund": self.diensthund, "tutorial_gesehen": self.tutorial_gesehen,
            "password_geaendert": self.safe_date_iso(self.password_geaendert),
            "zuletzt_online": self.safe_date_iso(self.zuletzt_online),
            "shift_plan_visible": self.shift_plan_visible,
            "shift_plan_sort_order": self.shift_plan_sort_order
        }


class ShiftType(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    abbreviation = db.Column(db.String(10), unique=True, nullable=False)
    color = db.Column(db.String(20), default="#FFFFFF")
    hours = db.Column(db.Float, default=0.0)
    is_work_shift = db.Column(db.Boolean, default=False)

    def to_dict(self):
        return {"id": self.id, "name": self.name, "abbreviation": self.abbreviation,
                "color": self.color, "hours": self.hours, "is_work_shift": self.is_work_shift}


class Shift(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    shifttype_id = db.Column(db.Integer, db.ForeignKey('shift_type.id'), nullable=False)
    date = db.Column(db.Date, nullable=False)
    user = db.relationship('User', backref=db.backref('shifts', lazy=True))
    shift_type = db.relationship('ShiftType')
    __table_args__ = (db.UniqueConstraint('user_id', 'date', name='_user_date_uc'),)

    def to_dict(self):
        return {"id": self.id, "user_id": self.user_id, "date": self.date.isoformat(),
                "shifttype_id": self.shifttype_id,
                "shifttype_abbreviation": self.shift_type.abbreviation}


# --- 6. Admin-Check Decorator (Unverändert) ---
def admin_required(fn):
    @wraps(fn)
    @login_required
    def decorator(*args, **kwargs):
        if not current_user.role or current_user.role.name != 'admin':
            return jsonify({"message": "Admin-Rechte erforderlich"}), 403
        return fn(*args, **kwargs)

    return decorator


# --- 7. API-Endpunkte (Login/Register/Logout - Unverändert) ---
# ... (Code für /api/register, /api/login, /api/logout unverändert) ...
@app.route('/api/register', methods=['POST'])
def register():
    # ... (Code unverändert) ...
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
        app.logger.error(f"Datenbankfehler bei Registrierung: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


@app.route('/api/login', methods=['POST'])
def login():
    # ... (Code unverändert) ...
    data = request.get_json()
    user = User.query.filter_by(vorname=data['vorname'], name=data['name']).first()
    if user and bcrypt.check_password_hash(user.passwort_hash, data['passwort']):
        login_user(user, remember=True)
        user.zuletzt_online = datetime.utcnow()
        db.session.commit()
        return jsonify({"message": "Login erfolgreich", "user": user.to_dict()}), 200
    else:
        return jsonify({"message": "Ungültige Anmeldedaten"}), 401


@app.route('/api/logout', methods=['POST'])
@login_required
def logout():
    logout_user()
    return jsonify({"message": "Erfolgreich abgemeldet"}), 200


# --- 8. BENUTZERVERWALTUNGS-API (Unverändert) ---
# ... (Code für /api/users... und /api/users/display_settings... unverändert) ...
@app.route('/api/users', methods=['GET'])
@admin_required
def get_users():
    users = User.query.order_by(User.shift_plan_sort_order, User.name).all()
    return jsonify([user.to_dict() for user in users]), 200


def none_if_empty(value):
    return None if value == '' else value


@app.route('/api/users', methods=['POST'])
@admin_required
def create_user():
    data = request.get_json()
    if not data or not data.get('vorname') or not data.get('passwort') or not data.get('role_id'):
        return jsonify({"message": "Fehlende Daten (Vorname, Passwort, role_id)"}), 400
    passwort_hash = bcrypt.generate_password_hash(data['passwort']).decode('utf-8')
    new_user = User(
        vorname=data['vorname'], name=data['name'], passwort_hash=passwort_hash,
        password_geaendert=datetime.utcnow(), role_id=data['role_id'],
        geburtstag=none_if_empty(data.get('geburtstag')), telefon=data.get('telefon'),
        eintrittsdatum=none_if_empty(data.get('eintrittsdatum')),
        aktiv_ab_datum=none_if_empty(data.get('aktiv_ab_datum')),
        urlaub_gesamt=data.get('urlaub_gesamt', 0), urlaub_rest=data.get('urlaub_rest', 0),
        diensthund=data.get('diensthund'), tutorial_gesehen=data.get('tutorial_gesehen', False),
        shift_plan_visible=data.get('shift_plan_visible', False),
        shift_plan_sort_order=data.get('shift_plan_sort_order', 999)
    )
    db.session.add(new_user)
    db.session.commit()
    return jsonify(new_user.to_dict()), 201


@app.route('/api/users/<int:user_id>', methods=['PUT'])
@admin_required
def update_user(user_id):
    user = db.session.get(User, user_id)
    if not user: return jsonify({"message": "Benutzer nicht gefunden"}), 404
    data = request.get_json()
    user.vorname = data.get('vorname', user.vorname)
    user.name = data.get('name', user.name)
    user.role_id = data.get('role_id', user.role_id)
    if data.get('passwort'):
        user.passwort_hash = bcrypt.generate_password_hash(data['passwort']).decode('utf-8')
        user.password_geaendert = datetime.utcnow()
    user.geburtstag = none_if_empty(data.get('geburtstag', user.geburtstag))
    user.telefon = data.get('telefon', user.telefon)
    user.eintrittsdatum = none_if_empty(data.get('eintrittsdatum', user.eintrittsdatum))
    user.aktiv_ab_datum = none_if_empty(data.get('aktiv_ab_datum', user.aktiv_ab_datum))
    user.urlaub_gesamt = data.get('urlaub_gesamt', user.urlaub_gesamt)
    user.urlaub_rest = data.get('urlaub_rest', user.urlaub_rest)
    user.diensthund = data.get('diensthund', user.diensthund)
    user.tutorial_gesehen = data.get('tutorial_gesehen', user.tutorial_gesehen)
    user.shift_plan_visible = data.get('shift_plan_visible', user.shift_plan_visible)
    user.shift_plan_sort_order = data.get('shift_plan_sort_order', user.shift_plan_sort_order)
    db.session.commit()
    return jsonify(user.to_dict()), 200


@app.route('/api/users/<int:user_id>', methods=['DELETE'])
@admin_required
def delete_user(user_id):
    if user_id == current_user.id: return jsonify({"message": "Sie können sich nicht selbst löschen"}), 400
    user = db.session.get(User, user_id)
    if not user: return jsonify({"message": "Benutzer nicht gefunden"}), 404
    db.session.delete(user)
    db.session.commit()
    return jsonify({"message": "Benutzer erfolgreich gelöscht"}), 200


@app.route('/api/users/display_settings', methods=['PUT'])
@admin_required
def update_user_display_settings():
    data = request.get_json()
    if not isinstance(data, list):
        return jsonify({"message": "Eine Liste von Benutzern wurde erwartet"}), 400
    try:
        user_ids = [item['id'] for item in data]
        users = User.query.filter(User.id.in_(user_ids)).all()
        user_map = {user.id: user for user in users}
        for item in data:
            user = user_map.get(item['id'])
            if user:
                user.shift_plan_visible = item.get('visible', user.shift_plan_visible)
                user.shift_plan_sort_order = item.get('order', user.shift_plan_sort_order)
        db.session.commit()
        return jsonify({"message": "Anzeige-Einstellungen gespeichert"}), 200
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Fehler bei update_user_display_settings: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


# --- 9. ROLLENVERWALTUNGS-API (Unverändert) ---
# ... (Code für /api/roles... unverändert) ...
@app.route('/api/roles', methods=['GET'])
@admin_required
def get_roles():
    roles = Role.query.all()
    return jsonify([role.to_dict() for role in roles]), 200


@app.route('/api/roles', methods=['POST'])
@admin_required
def create_role():
    data = request.get_json()
    if not data or not data.get('name'): return jsonify({"message": "Name erforderlich"}), 400
    existing = Role.query.filter_by(name=data['name']).first()
    if existing: return jsonify({"message": "Rolle existiert bereits"}), 409
    new_role = Role(name=data['name'], description=data.get('description', ''))
    db.session.add(new_role)
    db.session.commit()
    return jsonify(new_role.to_dict()), 201


@app.route('/api/roles/<int:role_id>', methods=['PUT'])
@admin_required
def update_role(role_id):
    role = db.session.get(Role, role_id)
    if not role: return jsonify({"message": "Rolle nicht gefunden"}), 404
    data = request.get_json()
    role.name = data.get('name', role.name)
    role.description = data.get('description', role.description)
    db.session.commit()
    return jsonify(role.to_dict()), 200


@app.route('/api/roles/<int:role_id>', methods=['DELETE'])
@admin_required
def delete_role(role_id):
    role = db.session.get(Role, role_id)
    if not role: return jsonify({"message": "Rolle nicht gefunden"}), 404
    if role.name == 'admin': return jsonify({"message": "Die Basis-Rolle 'admin' kann nicht gelöscht werden"}), 403
    if role.users: return jsonify({"message": "Rolle wird noch von Benutzern verwendet"}), 400
    db.session.delete(role)
    db.session.commit()
    return jsonify({"message": "Rolle erfolgreich gelöscht"}), 200


# --- 10. SCHICHTPLAN-API (Angepasst) ---

# --- NEUE HILFSFUNKTION (Regel 4: Modularisierung) ---
def _calculate_user_total_hours(user_id, year, month):
    """
    Berechnet die Gesamtstunden für EINEN User in einem Monat.
    Wird von get_shifts (für alle) und save_shift (für einen) genutzt.
    """
    total_hours_query = db.session.query(
        func.sum(ShiftType.hours)
    ).join(Shift).filter(
        Shift.user_id == user_id,
        extract('year', Shift.date) == year,
        extract('month', Shift.date) == month,
        ShiftType.is_work_shift == True
    ).scalar()  # .scalar() gibt die Summe direkt zurück (z.B. 80.5) oder None

    return total_hours_query or 0.0


# ... (Code für /api/shifttypes... unverändert) ...
@app.route('/api/shifttypes', methods=['GET'])
@admin_required
def get_shifttypes():
    types = ShiftType.query.all()
    return jsonify([st.to_dict() for st in types]), 200


@app.route('/api/shifttypes', methods=['POST'])
@admin_required
def create_shifttype():
    data = request.get_json()
    if not data or not data.get('name') or not data.get('abbreviation'):
        return jsonify({"message": "Name und Abkürzung sind erforderlich"}), 400
    existing = ShiftType.query.filter_by(abbreviation=data['abbreviation']).first()
    if existing: return jsonify({"message": "Abkürzung existiert bereits"}), 409
    new_type = ShiftType(
        name=data['name'], abbreviation=data['abbreviation'], color=data.get('color', '#FFFFFF'),
        hours=data.get('hours', 0.0), is_work_shift=data.get('is_work_shift', False)
    )
    db.session.add(new_type)
    db.session.commit()
    return jsonify(new_type.to_dict()), 201


@app.route('/api/shifttypes/<int:type_id>', methods=['PUT'])
@admin_required
def update_shifttype(type_id):
    st = db.session.get(ShiftType, type_id)
    if not st: return jsonify({"message": "Schicht-Typ nicht gefunden"}), 404
    data = request.get_json()
    st.name = data.get('name', st.name)
    st.abbreviation = data.get('abbreviation', st.abbreviation)
    st.color = data.get('color', st.color)
    st.hours = data.get('hours', st.hours)
    st.is_work_shift = data.get('is_work_shift', st.is_work_shift)
    db.session.commit()
    return jsonify(st.to_dict()), 200


@app.route('/api/shifttypes/<int:type_id>', methods=['DELETE'])
@admin_required
def delete_shifttype(type_id):
    st = db.session.get(ShiftType, type_id)
    if not st: return jsonify({"message": "Schicht-Typ nicht gefunden"}), 404
    existing_shifts = Shift.query.filter_by(shifttype_id=type_id).first()
    if existing_shifts:
        return jsonify({"message": "Typ wird noch in Schichten verwendet"}), 400
    db.session.delete(st)
    db.session.commit()
    return jsonify({"message": "Schicht-Typ gelöscht"}), 200


# --- 10b. API für Schichtplan (GET-Anfrage angepasst) ---
@app.route('/api/shifts', methods=['GET'])
@login_required
def get_shifts():
    try:
        year = int(request.args.get('year'))
        month = int(request.args.get('month'))
    except (TypeError, ValueError):
        return jsonify({"message": "Jahr und Monat sind erforderlich"}), 400

    # Abfrage 1: Hole alle Schichten (wie bisher)
    shifts_in_month = db.session.query(Shift).join(ShiftType).filter(
        extract('year', Shift.date) == year,
        extract('month', Shift.date) == month
    ).all()

    # Abfrage 2: Berechne Gesamtstunden (wie bisher)
    total_hours_query = db.session.query(
        Shift.user_id,
        func.sum(ShiftType.hours)
    ).join(ShiftType).filter(
        extract('year', Shift.date) == year,
        extract('month', Shift.date) == month,
        ShiftType.is_work_shift == True
    ).group_by(Shift.user_id).all()

    totals_dict = {user_id: hours for user_id, hours in total_hours_query}

    return jsonify({
        "shifts": [s.to_dict() for s in shifts_in_month],
        "totals": totals_dict
    }), 200


# --- 10c. API für Schichtplan (POST-Anfrage angepasst - BUGFIX) ---
@app.route('/api/shifts', methods=['POST'])
@admin_required
def save_shift():
    data = request.get_json()
    try:
        user_id = int(data['user_id'])
        date_str = data['date']
        shifttype_id = int(data['shifttype_id'])
        shift_date = datetime.strptime(date_str, '%Y-%m-%d').date()
    except (KeyError, TypeError, ValueError):
        return jsonify({"message": "Ungültige Daten (user_id, date, shifttype_id erforderlich)"}), 400

    free_type = ShiftType.query.filter_by(abbreviation='FREI').first()
    free_type_id = free_type.id if free_type else -1

    existing_shift = Shift.query.filter_by(user_id=user_id, date=shift_date).first()
    response_data = {}

    if existing_shift:
        if shifttype_id == free_type_id:
            db.session.delete(existing_shift)
            response_data = {"message": "Schicht gelöscht (Frei)"}
        else:
            existing_shift.shifttype_id = shifttype_id
            db.session.add(existing_shift)
            response_data = existing_shift.to_dict()
    else:
        if shifttype_id != free_type_id:
            new_shift = Shift(user_id=user_id, shifttype_id=shifttype_id, date=shift_date)
            db.session.add(new_shift)
            db.session.flush()  # (Stellt sicher, dass new_shift seine Beziehungen hat)
            db.session.refresh(new_shift)
            response_data = new_shift.to_dict()
        else:
            response_data = {"message": "Keine Aktion (bereits Frei)"}

    # --- ÄNDERUNG HIER (BUGFIX) ---
    # Führe die Transaktion aus, *bevor* die Stunden neu berechnet werden
    db.session.commit()

    # Berechne die *neue* Stundensumme für DIESEN User (Regel 2)
    new_total_hours = _calculate_user_total_hours(user_id, shift_date.year, shift_date.month)

    # Füge die Summe der Antwort hinzu
    response_data['new_total_hours'] = new_total_hours
    # --- ENDE ÄNDERUNG ---

    # (Status 201 nur bei *echter* Neuanlage)
    status_code = 201 if (not existing_shift and shifttype_id != free_type_id) else 200

    return jsonify(response_data), status_code


# --- 11. Start-Logik (Unverändert) ---
def create_default_roles():
    # ... (Code unverändert) ...
    admin_role = Role.query.filter_by(name='admin').first()
    if not admin_role:
        admin_role = Role(name='admin', description='Systemadministrator')
        db.session.add(admin_role)
    user_role = Role.query.filter_by(name='user').first()
    if not user_role:
        user_role = Role(name='user', description='Standardbenutzer')
        db.session.add(user_role)
    db.session.commit()


def create_default_shifttypes():
    # ... (Code unverändert) ...
    default_types = [
        {'name': 'Tag (T)', 'abbreviation': 'T.', 'color': '#AED6F1', 'hours': 8.0, 'is_work_shift': True},
        {'name': 'Nacht (N)', 'abbreviation': 'N.', 'color': '#5D6D7E', 'hours': 8.0, 'is_work_shift': True},
        {'name': 'Kurz (6)', 'abbreviation': '6', 'color': '#A9DFBF', 'hours': 6.0, 'is_work_shift': True},
        {'name': 'Frei (Geplant)', 'abbreviation': 'FREI', 'color': '#FFFFFF', 'hours': 0.0, 'is_work_shift': False},
        {'name': 'Urlaub', 'abbreviation': 'U', 'color': '#FAD7A0', 'hours': 0.0, 'is_work_shift': False},
        {'name': 'Wunschfrei (X)', 'abbreviation': 'X', 'color': '#D2B4DE', 'hours': 0.0, 'is_work_shift': False},
    ]
    for st_data in default_types:
        existing = ShiftType.query.filter_by(abbreviation=st_data['abbreviation']).first()
        if not existing:
            new_type = ShiftType(**st_data)
            db.session.add(new_type)
    db.session.commit()


if __name__ == '__main__':
    with app.app_context():
        db.create_all()
        create_default_roles()
        create_default_shifttypes()
    app.run(host='0.0.0.0', port=5000, debug=True)