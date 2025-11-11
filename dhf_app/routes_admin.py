from flask import Blueprint, request, jsonify, current_app
# Importe für Shift und GlobalSetting hinzugefügt (Regel 1)
from .models import User, Role, ShiftType, Shift, GlobalSetting
from .extensions import db, bcrypt  # <--- BCRYPT HINZUGEFÜGT
from flask_login import login_required, current_user
from functools import wraps
from datetime import datetime

# Erstellt einen Blueprint. Alle Routen hier beginnen mit /api
admin_bp = Blueprint('admin', __name__, url_prefix='/api')


# --- 6. Admin-Check Decorator (Hier definiert) ---
def admin_required(fn):
    @wraps(fn)
    @login_required
    def decorator(*args, **kwargs):
        if not current_user.role or current_user.role.name != 'admin':
            return jsonify({"message": "Admin-Rechte erforderlich"}), 403
        return fn(*args, **kwargs)

    return decorator


# --- Hilfsfunktion ---
def none_if_empty(value):
    return None if value == '' else value


# --- 8. BENUTZERVERWALTUNGS-API ---
@admin_bp.route('/users', methods=['GET'])
@admin_required
def get_users():
    users = User.query.order_by(User.shift_plan_sort_order, User.name).all()
    return jsonify([user.to_dict() for user in users]), 200


@admin_bp.route('/users', methods=['POST'])
@admin_required
def create_user():
    data = request.get_json()
    if not data or not data.get('vorname') or not data.get('passwort') or not data.get('role_id'):
        return jsonify({"message": "Fehlende Daten (Vorname, Passwort, role_id)"}), 400
    passwort_hash = bcrypt.generate_password_hash(data['passwort']).decode('utf-8')  # <-- Verwendet bcrypt
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


@admin_bp.route('/users/<int:user_id>', methods=['PUT'])
@admin_required
def update_user(user_id):
    user = db.session.get(User, user_id)
    if not user: return jsonify({"message": "Benutzer nicht gefunden"}), 404
    data = request.get_json()
    user.vorname = data.get('vorname', user.vorname)
    user.name = data.get('name', user.name)
    user.role_id = data.get('role_id', user.role_id)
    if data.get('passwort'):
        user.passwort_hash = bcrypt.generate_password_hash(data['passwort']).decode('utf-8')  # <-- Verwendet bcrypt
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


@admin_bp.route('/users/<int:user_id>', methods=['DELETE'])
@admin_required
def delete_user(user_id):
    if user_id == current_user.id: return jsonify({"message": "Sie können sich nicht selbst löschen"}), 400
    user = db.session.get(User, user_id)
    if not user: return jsonify({"message": "Benutzer nicht gefunden"}), 404
    db.session.delete(user)
    db.session.commit()
    return jsonify({"message": "Benutzer erfolgreich gelöscht"}), 200


@admin_bp.route('/users/display_settings', methods=['PUT'])
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
        current_app.logger.error(f"Fehler bei update_user_display_settings: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


@admin_bp.route('/roles', methods=['GET'])
@admin_required
def get_roles():
    roles = Role.query.all()
    return jsonify([role.to_dict() for role in roles]), 200


@admin_bp.route('/roles', methods=['POST'])
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


@admin_bp.route('/roles/<int:role_id>', methods=['PUT'])
@admin_required
def update_role(role_id):
    role = db.session.get(Role, role_id)
    if not role: return jsonify({"message": "Rolle nicht gefunden"}), 404
    data = request.get_json()
    role.name = data.get('name', role.name)
    role.description = data.get('description', role.description)
    db.session.commit()
    return jsonify(role.to_dict()), 200


@admin_bp.route('/roles/<int:role_id>', methods=['DELETE'])
@admin_required
def delete_role(role_id):
    role = db.session.get(Role, role_id)
    if not role: return jsonify({"message": "Rolle nicht gefunden"}), 404
    if role.name == 'admin': return jsonify({"message": "Die Basis-Rolle 'admin' kann nicht gelöscht werden"}), 403
    if role.users: return jsonify({"message": "Rolle wird noch von Benutzern verwendet"}), 400
    db.session.delete(role)
    db.session.commit()
    return jsonify({"message": "Rolle erfolgreich gelöscht"}), 200


@admin_bp.route('/shifttypes', methods=['GET'])
@admin_required
def get_shifttypes():
    types = ShiftType.query.all()
    return jsonify([st.to_dict() for st in types]), 200


@admin_bp.route('/shifttypes', methods=['POST'])
@admin_required
def create_shifttype():
    data = request.get_json()
    if not data or not data.get('name') or not data.get('abbreviation'):
        return jsonify({"message": "Name und Abkürzung sind erforderlich"}), 400
    existing = ShiftType.query.filter_by(abbreviation=data['abbreviation']).first()
    if existing: return jsonify({"message": "Abkürzung existiert bereits"}), 409

    new_type = ShiftType(
        name=data['name'], abbreviation=data['abbreviation'],
        color=data.get('color', '#FFFFFF'),
        hours=data.get('hours', 0.0),
        is_work_shift=data.get('is_work_shift', False),
        hours_spillover=data.get('hours_spillover', 0.0),
        # --- NEU: Zeiten speichern ---
        start_time=data.get('start_time'),
        end_time=data.get('end_time')
        # --- ENDE NEU ---
    )
    db.session.add(new_type)
    db.session.commit()
    return jsonify(new_type.to_dict()), 201


@admin_bp.route('/shifttypes/<int:type_id>', methods=['PUT'])
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
    st.hours_spillover = data.get('hours_spillover', st.hours_spillover)
    # --- NEU: Zeiten aktualisieren ---
    st.start_time = data.get('start_time', st.start_time)
    st.end_time = data.get('end_time', st.end_time)
    # --- ENDE NEU ---

    db.session.commit()
    return jsonify(st.to_dict()), 200


@admin_bp.route('/shifttypes/<int:type_id>', methods=['DELETE'])
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


# --- NEUE ROUTEN: GLOBALE EINSTELLUNGEN ---

@admin_bp.route('/settings', methods=['GET'])
@admin_required
def get_global_settings():
    """
    Ruft alle globalen Schlüssel-Wert-Paare (GlobalSetting) ab und gibt sie als Dictionary zurück.
    """
    settings = GlobalSetting.query.all()
    # Konvertiert [GlobalSetting(key='k', value='v'), ...] zu {'k': 'v', ...}
    settings_dict = {s.key: s.value for s in settings}
    return jsonify(settings_dict), 200


@admin_bp.route('/settings', methods=['PUT'])
@admin_required
def update_global_settings():
    """
    Nimmt ein Dictionary von Einstellungen entgegen und speichert/aktualisiert sie.
    """
    data = request.get_json()
    if not isinstance(data, dict):
        return jsonify({"message": "Ungültiges Datenformat. Erwartet ein Schlüssel-Wert-Dictionary."}), 400

    updated_count = 0
    try:
        for key, value in data.items():
            # Versucht, bestehende Einstellung zu finden
            setting = GlobalSetting.query.filter_by(key=key).first()

            if setting:
                # Aktualisieren
                setting.value = value
                db.session.add(setting)
            else:
                # Neu erstellen
                new_setting = GlobalSetting(key=key, value=value)
                db.session.add(new_setting)

            updated_count += 1

        db.session.commit()
        return jsonify({"message": f"{updated_count} Einstellungen erfolgreich gespeichert."}), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler beim Speichern der Global Settings: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500