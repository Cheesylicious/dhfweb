# dhf_app/routes_admin.py

from flask import Blueprint, request, jsonify, current_app, Response
from .models import User, Role, ShiftType, Shift, GlobalSetting, UpdateLog, UserShiftLimit, GlobalAnnouncement, \
    UserAnnouncementAck, ActivityLog
from .extensions import db, bcrypt
from flask_login import login_required, current_user
from .utils import admin_required
from datetime import datetime, date
from sqlalchemy import desc, or_, func, extract
# --- NEU: Import für E-Mail Service ---
from .email_service import send_email
# --- NEU: Import für Bild-Test ---
from .plan_renderer import generate_roster_image_bytes

# Erstellt einen Blueprint. Alle Routen hier beginnen mit /api
admin_bp = Blueprint('admin', __name__, url_prefix='/api')


# --- Hilfsfunktion ---
def _log_update_event(area, description):
    """
    Erstellt einen Eintrag im UpdateLog.
    """
    new_log = UpdateLog(
        area=area,
        description=description,
        updated_at=datetime.utcnow()
    )
    db.session.add(new_log)
    # Wichtig: KEIN db.session.commit() hier, da dies in der aufrufenden Funktion geschieht.


def none_if_empty(value):
    """Konvertiert leere Strings ('') in None, damit sie als NULL in die DB geschrieben werden."""
    return None if value == '' else value


# --- NEU: ROUTE FÜR ACTIVITY LOGS (LOGS TABELLE) ---
@admin_bp.route('/activity_logs', methods=['GET'])
@admin_required
def get_activity_logs():
    """
    Ruft paginierte und gefilterte Einträge aus dem ActivityLog ab.
    """
    try:
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 20, type=int)
        action_filter = request.args.get('action')
        user_filter = request.args.get('user')  # Suchstring für Name

        query = ActivityLog.query

        # Filter anwenden
        if action_filter:
            query = query.filter(ActivityLog.action == action_filter)

        if user_filter:
            # Join nötig, um nach User-Namen zu filtern
            query = query.join(User).filter(
                or_(
                    User.vorname.ilike(f"%{user_filter}%"),
                    User.name.ilike(f"%{user_filter}%")
                )
            )

        # Sortierung: Neueste zuerst
        query = query.order_by(desc(ActivityLog.timestamp))

        # Paginierung
        pagination = query.paginate(page=page, per_page=per_page, error_out=False)

        return jsonify({
            "total": pagination.total,
            "pages": pagination.pages,
            "page": pagination.page,
            "items": [log.to_dict() for log in pagination.items]
        }), 200

    except Exception as e:
        current_app.logger.error(f"Fehler beim Laden der Activity Logs: {e}")
        return jsonify({"message": f"Serverfehler: {str(e)}"}), 500


# --- ENDE NEU ---


# --- NEU: ROUTE FÜR TEST-EMAIL BROADCAST ---
@admin_bp.route('/send_test_broadcast', methods=['POST'])
@admin_required
def send_test_broadcast():
    """
    Sendet eine Test-E-Mail an alle Benutzer, die eine E-Mail hinterlegt haben.
    """
    try:
        # Filter: Email ist nicht NULL und nicht leer
        users_with_email = User.query.filter(User.email != None, User.email != "").all()

        if not users_with_email:
            return jsonify({"message": "Keine Benutzer mit E-Mail-Adresse gefunden."}), 404

        count = 0
        for user in users_with_email:
            send_email(
                subject="DHF-Planer: Test-Nachricht",
                recipients=[user.email],
                text_body=f"Hallo {user.vorname},\n\ndies ist eine Test-E-Mail vom DHF-Planer System.\nWenn du diese Nachricht liest, funktioniert der E-Mail-Versand!\n\nViele Grüße,\nDein Admin",
                html_body=f"""
                <h3>Hallo {user.vorname},</h3>
                <p>dies ist eine <strong>Test-E-Mail</strong> vom DHF-Planer System.</p>
                <p style="color: green;">Wenn du diese Nachricht liest, funktioniert der E-Mail-Versand!</p>
                <hr>
                <p>Viele Grüße,<br>Dein Admin</p>
                """
            )
            count += 1

        # Manuelle Aktion -> Loggen erlaubt/erwünscht
        # _log_update_event("System", f"Test-Email an {count} Benutzer gesendet.")

        db.session.commit()  # Commit für das Log (falls aktiv)

        return jsonify({"message": f"Test-E-Mail an {count} Empfänger wurde in den Versand gegeben."}), 200

    except Exception as e:
        current_app.logger.error(f"Fehler beim Broadcast: {e}")
        return jsonify({"message": f"Fehler: {str(e)}"}), 500


# --- NEU: TEST-ROUTE FÜR BILDGENERIERUNG (DIAGNOSE) ---
@admin_bp.route('/admin/test_roster_image', methods=['GET'])
@admin_required
def test_roster_image():
    """
    Generiert ein Test-Bild mit Dummy-Daten und gibt es direkt zurück.
    Hilft beim Debuggen von wkhtmltoimage Problemen.
    """
    try:
        # Dummy Daten
        grouped_data = {
            "Max Mustermann": [
                {'date_formatted': 'Mo, 01.01.', 'time_formatted': '06:00-14:00', 'location': 'T.',
                 'is_weekend': False},
                {'date_formatted': 'Di, 02.01.', 'time_formatted': '14:00-22:00', 'location': 'N.', 'is_weekend': False}
            ],
            "Erika Musterfrau": [
                {'date_formatted': 'Mo, 01.01.', 'time_formatted': '---', 'location': 'FREI', 'is_weekend': False},
                {'date_formatted': 'Di, 02.01.', 'time_formatted': '06:00-14:00', 'location': 'T.', 'is_weekend': False}
            ]
        }

        image_bytes = generate_roster_image_bytes(grouped_data, 2025, 1)

        if image_bytes:
            return Response(image_bytes, mimetype='image/jpeg')
        else:
            return jsonify(
                {"message": "Bildgenerierung fehlgeschlagen. Bitte Server-Logs prüfen (wkhtmltoimage fehlt?)."}), 500

    except Exception as e:
        return jsonify({"message": f"Exception: {str(e)}"}), 500


# --- ENDE NEU ---


# --- ROUTEN FÜR BENUTZER ---

@admin_bp.route('/users', methods=['GET'])
@login_required
def get_users():
    users = User.query.order_by(User.shift_plan_sort_order, User.name).all()

    # --- NEU: Urlaubsberechnung (Jahressicht) ---
    current_year = datetime.utcnow().year
    eu_type = ShiftType.query.filter_by(abbreviation='EU').first()
    vacation_usage = {}

    if eu_type:
        usage_query = db.session.query(Shift.user_id, func.count(Shift.id)) \
            .filter(
            Shift.shifttype_id == eu_type.id,
            extract('year', Shift.date) == current_year,
            Shift.variant_id == None
        ) \
            .group_by(Shift.user_id).all()
        vacation_usage = {uid: count for uid, count in usage_query}

    result = []
    for user in users:
        u_dict = user.to_dict()
        # Berechnung: Gesamt + Rest - Verbraucht
        total_budget = (user.urlaub_gesamt or 0) + (user.urlaub_rest or 0)
        used = vacation_usage.get(user.id, 0)
        u_dict['vacation_remaining'] = total_budget - used
        result.append(u_dict)

    return jsonify(result), 200


@admin_bp.route('/users', methods=['POST'])
@admin_required
def create_user():
    data = request.get_json()
    if not data or not data.get('vorname') or not data.get('passwort') or not data.get('role_id'):
        return jsonify({"message": "Fehlende Daten (Vorname, Passwort, role_id)"}), 400
    passwort_hash = bcrypt.generate_password_hash(data['passwort']).decode('utf-8')

    try:
        new_user = User(
            vorname=data['vorname'], name=data['name'], passwort_hash=passwort_hash,
            email=none_if_empty(data.get('email')),
            password_geaendert=datetime.utcnow(), role_id=data['role_id'],
            geburtstag=none_if_empty(data.get('geburtstag')), telefon=data.get('telefon'),
            eintrittsdatum=none_if_empty(data.get('eintrittsdatum')),
            aktiv_ab_datum=none_if_empty(data.get('aktiv_ab_datum')),
            inaktiv_ab_datum=none_if_empty(data.get('inaktiv_ab_datum')),
            urlaub_gesamt=data.get('urlaub_gesamt', 0), urlaub_rest=data.get('urlaub_rest', 0),
            diensthund=data.get('diensthund'), tutorial_gesehen=data.get('tutorial_gesehen', False),
            shift_plan_visible=data.get('shift_plan_visible', False),
            shift_plan_sort_order=data.get('shift_plan_sort_order', 999),
            force_password_change=True,
            can_see_statistics=data.get('can_see_statistics', False)
        )
        db.session.add(new_user)

        # _log_update_event("Benutzerverwaltung", f"Neuer Benutzer '{data['vorname']} {data['name']}' erstellt. (PW-Änderung erzwungen)") # DEAKTIVIERT

        db.session.commit()
        return jsonify(new_user.to_dict()), 201

    except Exception as e:
        db.session.rollback()
        if "UNIQUE constraint failed" in str(e) or "Duplicate entry" in str(e):
            return jsonify({"message": "Benutzername oder E-Mail existiert bereits."}), 409
        current_app.logger.error(f"Fehler bei create_user: {e}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


@admin_bp.route('/users/<int:user_id>', methods=['PUT'])
@admin_required
def update_user(user_id):
    user = db.session.get(User, user_id)
    if not user: return jsonify({"message": "Benutzer nicht gefunden"}), 404
    data = request.get_json()

    is_password_changed = data.get('passwort') is not None

    try:
        user.vorname = data.get('vorname', user.vorname)
        user.name = data.get('name', user.name)

        if 'email' in data:
            user.email = none_if_empty(data['email'])

        user.role_id = data.get('role_id', user.role_id)
        if is_password_changed:
            user.passwort_hash = bcrypt.generate_password_hash(data['passwort']).decode('utf-8')
            user.password_geaendert = datetime.utcnow()
        user.geburtstag = none_if_empty(data.get('geburtstag', user.geburtstag))
        user.telefon = data.get('telefon', user.telefon)
        user.eintrittsdatum = data.get('eintrittsdatum', user.eintrittsdatum)
        user.aktiv_ab_datum = none_if_empty(data.get('aktiv_ab_datum', user.aktiv_ab_datum))
        if 'inaktiv_ab_datum' in data:
            user.inaktiv_ab_datum = none_if_empty(data.get('inaktiv_ab_datum'))

        user.urlaub_gesamt = data.get('urlaub_gesamt', user.urlaub_gesamt)
        # user.urlaub_rest = data.get('urlaub_rest', user.urlaub_rest) # Read-Only im Frontend (berechnet), daher nicht überschreiben
        user.diensthund = data.get('diensthund', user.diensthund)
        user.tutorial_gesehen = data.get('tutorial_gesehen', user.tutorial_gesehen)
        user.shift_plan_visible = data.get('shift_plan_visible', user.shift_plan_visible)
        user.shift_plan_sort_order = data.get('shift_plan_sort_order', user.shift_plan_sort_order)

        if 'can_see_statistics' in data:
            user.can_see_statistics = data['can_see_statistics']

        desc_msg = f"Benutzer '{user.vorname} {user.name}' aktualisiert."
        if is_password_changed:
            desc_msg += " (Passwort geändert)"

        # _log_update_event("Benutzerverwaltung", desc_msg) # DEAKTIVIERT

        db.session.commit()
        return jsonify(user.to_dict()), 200

    except Exception as e:
        db.session.rollback()
        if "UNIQUE constraint failed" in str(e) or "Duplicate entry" in str(e):
            return jsonify({"message": "E-Mail Adresse wird bereits verwendet."}), 409
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


@admin_bp.route('/users/<int:user_id>/force_password_reset', methods=['POST'])
@admin_required
def force_password_reset(user_id):
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({"message": "Benutzer nicht gefunden"}), 404

    try:
        user.force_password_change = True
        # _log_update_event("Benutzerverwaltung", f"Passwort-Reset für '{user.vorname} {user.name}' erzwungen.") # DEAKTIVIERT
        db.session.commit()
        return jsonify({"message": "Passwort-Änderung beim nächsten Login erzwungen."}), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler bei force_password_reset für User {user_id}: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


@admin_bp.route('/users/<int:user_id>', methods=['DELETE'])
@admin_required
def delete_user(user_id):
    if user_id == current_user.id: return jsonify({"message": "Sie können sich nicht selbst löschen"}), 400
    user = db.session.get(User, user_id)
    if not user: return jsonify({"message": "Benutzer nicht gefunden"}), 404

    name = f"{user.vorname} {user.name}"
    db.session.delete(user)
    # _log_update_event("Benutzerverwaltung", f"Benutzer '{name}' gelöscht.") # DEAKTIVIERT

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

        # _log_update_event("Mitarbeiter Sortierung", "Anzeige- und Sortiereinstellungen aktualisiert.") # DEAKTIVIERT

        db.session.commit()
        return jsonify({"message": "Anzeige-Einstellungen gespeichert"}), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler bei update_user_display_settings: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


# --- ROUTEN FÜR SCHICHT-LIMITS ---

@admin_bp.route('/users/<int:user_id>/limits', methods=['GET'])
@admin_required
def get_user_limits(user_id):
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({"message": "Benutzer nicht gefunden"}), 404

    shift_types = ShiftType.query.filter(
        or_(
            ShiftType.is_work_shift == True,
            ShiftType.abbreviation == 'X'
        )
    ).order_by(ShiftType.staffing_sort_order, ShiftType.abbreviation).all()

    saved_limits = UserShiftLimit.query.filter_by(user_id=user_id).all()
    limits_map = {l.shifttype_id: l.monthly_limit for l in saved_limits}

    result = []
    for st in shift_types:
        result.append({
            "shifttype_id": st.id,
            "shifttype_name": st.name,
            "shifttype_abbreviation": st.abbreviation,
            "monthly_limit": limits_map.get(st.id, 0)
        })

    return jsonify(result), 200


@admin_bp.route('/users/<int:user_id>/limits', methods=['PUT'])
@admin_required
def update_user_limits(user_id):
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({"message": "Benutzer nicht gefunden"}), 404

    data = request.get_json()
    if not isinstance(data, list):
        return jsonify({"message": "Ungültiges Format. Liste erwartet."}), 400

    try:
        changes_count = 0
        for item in data:
            st_id = item.get('shifttype_id')
            new_limit = int(item.get('monthly_limit', 0))
            if new_limit < 0: new_limit = 0

            limit_entry = UserShiftLimit.query.filter_by(user_id=user_id, shifttype_id=st_id).first()

            if limit_entry:
                if limit_entry.monthly_limit != new_limit:
                    limit_entry.monthly_limit = new_limit
                    changes_count += 1
            else:
                new_entry = UserShiftLimit(user_id=user_id, shifttype_id=st_id, monthly_limit=new_limit)
                db.session.add(new_entry)
                changes_count += 1

        if changes_count > 0:
            # _log_update_event("Benutzerverwaltung", f"Schicht-Limits für '{user.vorname} {user.name}' aktualisiert.") # DEAKTIVIERT
            db.session.commit()
            return jsonify({"message": f"{changes_count} Limits aktualisiert."}), 200
        else:
            return jsonify({"message": "Keine Änderungen."}), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler beim Speichern der Limits: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


# --- NEU: ROUTEN FÜR HUNDEFÜHRER-VERWALTUNG (TRAINING & SCHIEßEN) ---

@admin_bp.route('/dog_handlers', methods=['GET'])
@admin_required
def get_dog_handlers():
    """
    Liefert alle Benutzer, die entweder die Rolle 'Hundeführer' haben
    ODER manuell als solche markiert wurden (is_manual_dog_handler=True).
    Sortiert nach Namen.

    ZUSÄTZLICH: Prüft im Schichtplan nach den letzten Terminen für "QA" und "S".
    Wenn ein Termin im Plan NEUER ist als der manuell im User-Profil gespeicherte,
    wird dieser für die Anzeige verwendet.
    """
    try:
        # 1. Benutzer laden
        query = User.query.join(Role).filter(
            or_(
                Role.name == 'Hundeführer',
                User.is_manual_dog_handler == True
            )
        ).order_by(User.name, User.vorname)

        users = query.all()
        user_list = []
        today = datetime.utcnow().date()

        for user in users:
            u_dict = user.to_dict()

            # 2. Letzte "QA" Schicht aus dem Plan holen
            last_qa_shift = Shift.query.join(ShiftType).filter(
                Shift.user_id == user.id,
                ShiftType.abbreviation == 'QA',  # Wir suchen nach dem Kürzel 'QA'
                Shift.date <= today
            ).order_by(Shift.date.desc()).first()

            roster_qa_date = last_qa_shift.date if last_qa_shift else None
            manual_qa_date = user.last_training_qa

            # Vergleich: Nehme das neuere Datum
            final_qa = roster_qa_date
            if manual_qa_date:
                # Wenn manuelles Datum existiert: Prüfe ob es neuer ist oder ob kein Roster-Datum da ist
                if not roster_qa_date or manual_qa_date > roster_qa_date:
                    final_qa = manual_qa_date

            # Datum ins Ergebnis schreiben (ISO Format)
            u_dict['last_training_qa'] = final_qa.isoformat() if final_qa else None

            # 3. Letzte "S" Schicht aus dem Plan holen
            last_shooting_shift = Shift.query.join(ShiftType).filter(
                Shift.user_id == user.id,
                ShiftType.abbreviation == 'S',  # Wir suchen nach dem Kürzel 'S'
                Shift.date <= today
            ).order_by(Shift.date.desc()).first()

            roster_s_date = last_shooting_shift.date if last_shooting_shift else None
            manual_s_date = user.last_training_shooting

            # Vergleich
            final_s = roster_s_date
            if manual_s_date:
                if not roster_s_date or manual_s_date > roster_s_date:
                    final_s = manual_s_date

            u_dict['last_training_shooting'] = final_s.isoformat() if final_s else None

            user_list.append(u_dict)

        return jsonify(user_list), 200

    except Exception as e:
        current_app.logger.error(f"Fehler beim Laden der Hundeführer: {e}")
        return jsonify({"message": f"Serverfehler: {str(e)}"}), 500


@admin_bp.route('/dog_handlers/<int:user_id>', methods=['PUT'])
@admin_required
def update_dog_handler_data(user_id):
    """
    Aktualisiert die Trainingsdaten und den manuellen/ausgeblendeten Status eines Hundeführers.
    """
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({"message": "Benutzer nicht gefunden"}), 404

    data = request.get_json()

    try:
        # 1. Manuelle Zuweisung (Optional)
        if 'is_manual_dog_handler' in data:
            user.is_manual_dog_handler = data['is_manual_dog_handler']

        # 2. Ausblenden (Optional) - NEU
        if 'is_hidden_dog_handler' in data:
            user.is_hidden_dog_handler = data['is_hidden_dog_handler']

        # 3. Letzte Quartalsausbildung
        if 'last_training_qa' in data:
            val = none_if_empty(data['last_training_qa'])
            # Datum parsen falls String
            if val and isinstance(val, str):
                try:
                    # Wir erwarten YYYY-MM-DD vom Frontend
                    val = datetime.strptime(val, '%Y-%m-%d').date()
                except ValueError:
                    return jsonify({"message": "Ungültiges Datumsformat für QA (erwartet YYYY-MM-DD)"}), 400
            user.last_training_qa = val

        # 4. Letztes Schießen
        if 'last_training_shooting' in data:
            val = none_if_empty(data['last_training_shooting'])
            if val and isinstance(val, str):
                try:
                    val = datetime.strptime(val, '%Y-%m-%d').date()
                except ValueError:
                    return jsonify({"message": "Ungültiges Datumsformat für Schießen (erwartet YYYY-MM-DD)"}), 400
            user.last_training_shooting = val

        db.session.commit()
        return jsonify(user.to_dict()), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler beim Update des Hundeführers {user_id}: {e}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


# --- ENDE NEU ---


# --- ROUTEN FÜR ROLLEN ---

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
    # _log_update_event("Rollenverwaltung", f"Neue Rolle '{data['name']}' erstellt.") # DEAKTIVIERT
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
    # _log_update_event("Rollenverwaltung", f"Rolle '{role.name}' aktualisiert.") # DEAKTIVIERT
    db.session.commit()
    return jsonify(role.to_dict()), 200


@admin_bp.route('/roles/<int:role_id>', methods=['DELETE'])
@admin_required
def delete_role(role_id):
    role = db.session.get(Role, role_id)
    if not role: return jsonify({"message": "Rolle nicht gefunden"}), 404
    if role.name == 'admin': return jsonify({"message": "Die Basis-Rolle 'admin' kann nicht gelöscht werden"}), 403
    if role.users: return jsonify({"message": "Rolle wird noch von Benutzern verwendet"}), 400
    name = role.name
    db.session.delete(role)
    # _log_update_event("Rollenverwaltung", f"Rolle '{name}' gelöscht.") # DEAKTIVIERT
    db.session.commit()
    return jsonify({"message": "Rolle erfolgreich gelöscht"}), 200


# --- ROUTEN FÜR SCHICHTARTEN ---

@admin_bp.route('/shifttypes', methods=['GET'])
@login_required
def get_shifttypes():
    types = ShiftType.query.order_by(ShiftType.staffing_sort_order, ShiftType.abbreviation).all()
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
        start_time=data.get('start_time'),
        end_time=data.get('end_time'),
        prioritize_background=data.get('prioritize_background', False),
        min_staff_mo=data.get('min_staff_mo', 0),
        min_staff_di=data.get('min_staff_di', 0),
        min_staff_mi=data.get('min_staff_mi', 0),
        min_staff_do=data.get('min_staff_do', 0),
        min_staff_fr=data.get('min_staff_fr', 0),
        min_staff_sa=data.get('min_staff_sa', 0),
        min_staff_so=data.get('min_staff_so', 0),
        min_staff_holiday=data.get('min_staff_holiday', 0),
        staffing_sort_order=data.get('staffing_sort_order', 999)
    )
    db.session.add(new_type)
    # _log_update_event("Schichtarten", f"Neue Schichtart '{data['name']}' erstellt.") # DEAKTIVIERT
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
    st.start_time = data.get('start_time', st.start_time)
    st.end_time = data.get('end_time', st.end_time)
    st.prioritize_background = data.get('prioritize_background', st.prioritize_background)
    st.min_staff_mo = data.get('min_staff_mo', st.min_staff_mo)
    st.min_staff_di = data.get('min_staff_di', st.min_staff_di)
    st.min_staff_mi = data.get('min_staff_mi', st.min_staff_mi)
    st.min_staff_do = data.get('min_staff_do', st.min_staff_do)
    st.min_staff_fr = data.get('min_staff_fr', st.min_staff_fr)
    st.min_staff_sa = data.get('min_staff_sa', st.min_staff_sa)
    st.min_staff_so = data.get('min_staff_so', st.min_staff_so)
    st.min_staff_holiday = data.get('min_staff_holiday', st.min_staff_holiday)
    st.staffing_sort_order = data.get('staffing_sort_order', st.staffing_sort_order)

    # _log_update_event("Schichtarten", f"Schichtart '{st.name}' aktualisiert.") # DEAKTIVIERT
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

    name = st.name
    db.session.delete(st)
    db.session.commit()
    # _log_update_event("Schichtarten", f"Schichtart '{name}' gelöscht.") # DEAKTIVIERT
    return jsonify({"message": "Schicht-Typ gelöscht"}), 200


@admin_bp.route('/shifttypes/staffing_order', methods=['PUT'])
@admin_required
def update_staffing_order():
    data = request.get_json()
    if not isinstance(data, list):
        return jsonify({"message": "Eine Liste von IDs wurde erwartet"}), 400

    try:
        type_ids = [item['id'] for item in data]
        types = ShiftType.query.filter(ShiftType.id.in_(type_ids)).all()
        type_map = {t.id: t for t in types}

        for item in data:
            type_id = item.get('id')
            order = item.get('order')
            if type_id in type_map:
                type_map[type_id].staffing_sort_order = order

        # _log_update_event("Schichtarten", "Sortierreihenfolge der Besetzung (SOLL/IST) aktualisiert.") # DEAKTIVIERT
        db.session.commit()
        return jsonify({"message": "Sortierreihenfolge der Besetzung gespeichert"}), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler bei update_staffing_order: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


# --- GLOBALE EINSTELLUNGEN ---

@admin_bp.route('/settings', methods=['GET'])
@login_required
def get_global_settings():
    settings = GlobalSetting.query.all()
    settings_dict = {s.key: s.value for s in settings}
    return jsonify(settings_dict), 200


@admin_bp.route('/settings', methods=['PUT'])
@admin_required
def update_global_settings():
    data = request.get_json()
    if not isinstance(data, dict):
        return jsonify({"message": "Ungültiges Datenformat. Erwartet ein Schlüssel-Wert-Dictionary."}), 400

    updated_count = 0
    try:
        for key, value in data.items():
            setting = GlobalSetting.query.filter_by(key=key).first()
            if setting:
                setting.value = value
                db.session.add(setting)
            else:
                new_setting = GlobalSetting(key=key, value=value)
                db.session.add(new_setting)
            updated_count += 1

        # _log_update_event("Farbeinstellungen", f"{updated_count} globale Farben/Einstellungen gespeichert.") # DEAKTIVIERT
        db.session.commit()
        return jsonify({"message": f"{updated_count} Einstellungen erfolgreich gespeichert."}), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler beim Speichern der Global Settings: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


# --- UPDATE LOG ---

@admin_bp.route('/updatelog', methods=['GET'])
@login_required
def get_updatelog():
    try:
        logs = UpdateLog.query.order_by(desc(UpdateLog.updated_at)).limit(20).all()
        return jsonify([log.to_dict() for log in logs]), 200
    except Exception as e:
        current_app.logger.error(f"Fehler beim Abrufen des UpdateLog: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


@admin_bp.route('/updatelog/<int:log_id>', methods=['DELETE'])
@admin_required
def delete_updatelog_entry(log_id):
    log_entry = db.session.get(UpdateLog, log_id)
    if not log_entry:
        return jsonify({"message": "Log-Eintrag nicht gefunden"}), 404

    try:
        db.session.delete(log_entry)
        db.session.commit()
        return jsonify({"message": "Log-Eintrag erfolgreich gelöscht"}), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler beim Löschen des Log-Eintrags {log_id}: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


@admin_bp.route('/manual_update_log', methods=['POST'])
@admin_required
def manual_update_log():
    data = request.get_json()
    description = data.get('description')
    area = data.get('area', 'System Update')

    if not description:
        return jsonify({"message": "Beschreibung ist erforderlich"}), 400

    try:
        _log_update_event(area, description)  # HIER BLEIBT ES AKTIV
        db.session.commit()
        return jsonify({"message": "Update erfolgreich protokolliert"}), 201
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler bei manuellem UpdateLog: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


# --- DASHBOARD MITTEILUNGEN ---

@admin_bp.route('/announcement', methods=['GET'])
@login_required
def get_announcement():
    announcement = GlobalAnnouncement.query.order_by(GlobalAnnouncement.updated_at.desc()).first()

    if not announcement or not announcement.message:
        return jsonify({"message": None, "is_read": True}), 200

    ack = UserAnnouncementAck.query.filter_by(user_id=current_user.id).first()

    is_read = False
    if ack and ack.acknowledged_at >= announcement.updated_at:
        is_read = True

    return jsonify({
        "message": announcement.message,
        "updated_at": announcement.updated_at.isoformat(),
        "updated_by": announcement.updated_by,
        "is_read": is_read
    }), 200


@admin_bp.route('/announcement', methods=['PUT'])
@admin_required
def update_announcement():
    data = request.get_json()
    message = data.get('message', '')

    new_announcement = GlobalAnnouncement(
        message=message,
        updated_at=datetime.utcnow(),
        updated_by=f"{current_user.vorname} {current_user.name}"
    )

    db.session.add(new_announcement)
    # _log_update_event("Dashboard", "Neue Mitteilung veröffentlicht.") # DEAKTIVIERT

    db.session.commit()
    return jsonify(new_announcement.to_dict()), 200


@admin_bp.route('/announcement/ack', methods=['POST'])
@login_required
def acknowledge_announcement():
    ack = UserAnnouncementAck.query.filter_by(user_id=current_user.id).first()

    if ack:
        ack.acknowledged_at = datetime.utcnow()
    else:
        ack = UserAnnouncementAck(user_id=current_user.id, acknowledged_at=datetime.utcnow())
        db.session.add(ack)

    db.session.commit()
    return jsonify({"message": "Bestätigt"}), 200