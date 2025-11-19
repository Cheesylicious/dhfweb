# cheesylicious/dhfweb/dhfweb-c1908779df584d29ef33ffe20aa2d1ffd04401f99/dhf_app/routes_shifts.py

from flask import Blueprint, request, jsonify, current_app
# Importe für ShiftPlanStatus und UpdateLog hinzugefügt
from .models import Shift, ShiftType, User, ShiftPlanStatus, UpdateLog
from .extensions import db
# --- KORREKTUR: Import aus utils.py ---
from .utils import admin_required
# --- ENDE KORREKTUR ---
from flask_login import login_required
from sqlalchemy import extract, func
from sqlalchemy.orm import joinedload
from sqlalchemy.exc import IntegrityError, OperationalError
from datetime import datetime, timedelta, date
from .violation_manager import ViolationManager
import calendar
from collections import defaultdict

# Blueprint
shifts_bp = Blueprint('shifts', __name__, url_prefix='/api')


# --- NEU: Hilfsfunktion (kopiert von routes_admin) ---
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


# --- ENDE NEU ---


def _calculate_user_total_hours(user_id, year, month):
    """
    Berechnet Gesamtstunden für einen User in einem Monat.
    (Lädt Shift.shift_type eager, summiert hours; addiert Spillover von Vormonat.)
    """
    try:
        first_day_of_current_month = datetime(year, month, 1)
        last_day_of_previous_month = first_day_of_current_month - timedelta(days=1)

        # --- KORREKTUR (aus vorherigem Schritt) ---
        days_in_month = calendar.monthrange(year, month)[1]
        last_day_of_current_month = date(year, month, days_in_month)
        # --- ENDE KORREKTUR ---

    except ValueError:
        current_app.logger.error(f"Ungültiges Datum in _calculate_user_total_hours: {year}-{month}")
        return 0.0

    total_hours = 0.0

    # Normale Stunden (Eager loading)
    shifts_in_this_month = Shift.query.options(joinedload(Shift.shift_type)).filter(
        Shift.user_id == user_id,
        extract('year', Shift.date) == year,
        extract('month', Shift.date) == month
    ).all()

    for shift in shifts_in_this_month:
        # KORREKTUR: Tippfehler behoben (shift.shift_type.is_work_shift)
        if shift.shift_type and shift.shift_type.is_work_shift:
            try:
                # --- START: FINALE KORREKTUR (Regel 1) --- (IHR NEUER CODE)

                # 1. Addiere IMMER die Stunden des Tages (z.B. 8 für T, 12 für N)
                #    (Dies ist oft die Gesamtdauer der Schicht)
                total_hours += float(shift.shift_type.hours or 0.0)

                # 2. ABER: Wenn die Schicht am Monatsletzten ist UND einen Übertrag hat,
                #    ziehe diesen Übertrag wieder ab (er zählt ja ja erst im Folgemonat).
                if shift.date == last_day_of_current_month and (shift.shift_type.hours_spillover or 0.0) > 0:
                    total_hours -= float(shift.shift_type.hours_spillover or 0.0)

                # --- ENDE: FINALE KORREKTUR ---

            except Exception:
                current_app.logger.warning(
                    f"Ungültiger hours-Wert für ShiftType id={getattr(shift.shift_type, 'id', None)}")

    # Spillover vom letzten Tag des Vormonats
    # (Diese Logik ist KORREKT und bleibt unverändert)
    shifts_on_last_day_prev_month = Shift.query.options(joinedload(Shift.shift_type)).filter(
        Shift.user_id == user_id,
        Shift.date == last_day_of_previous_month.date()
    ).all()

    for shift in shifts_on_last_day_prev_month:
        if shift.shift_type and shift.shift_type.is_work_shift and (shift.shift_type.hours_spillover or 0.0) > 0:
            try:
                # Fügt Robustheit beim Parsen hinzu
                total_hours += float(shift.shift_type.hours_spillover or 0.0)
            except Exception:
                current_app.logger.warning(
                    f"Ungültiger hours_spillover für ShiftType id={getattr(shift.shift_type, 'id', None)}")

    return round(total_hours, 2)


def _calculate_actual_staffing(shifts_in_month_dicts, shifttypes_dicts, year, month):
    """
    Berechnet die IST-Besetzung (tatsächliche Zählung) für alle Schichtarten.
    (Prüft jetzt die 8 granularen SOLL-Felder, um relevante Schichten zu finden)
    """
    days_in_month = calendar.monthrange(year, month)[1]

    # 1. Finde heraus, welche Schicht-IDs überhaupt gezählt werden müssen
    relevant_shifttype_ids = set()
    for st in shifttypes_dicts:
        if (st.get('min_staff_mo', 0) > 0 or
                st.get('min_staff_di', 0) > 0 or
                st.get('min_staff_mi', 0) > 0 or
                st.get('min_staff_do', 0) > 0 or
                st.get('min_staff_fr', 0) > 0 or
                st.get('min_staff_sa', 0) > 0 or
                st.get('min_staff_so', 0) > 0 or
                st.get('min_staff_holiday', 0) > 0):
            relevant_shifttype_ids.add(st['id'])

    if not relevant_shifttype_ids:
        return {}  # (Niemand muss gezählt werden)

    # 2. Initialisiere das Zähl-Dictionary (Struktur: {shifttype_id: {day: 0, ...}})
    staffing_actual = defaultdict(lambda: defaultdict(int))

    # 3. Zähle die Schichten
    for s_dict in shifts_in_month_dicts:
        shifttype_id = s_dict.get('shifttype_id')

        if shifttype_id in relevant_shifttype_ids:
            try:
                day_of_month = datetime.fromisoformat(s_dict['date']).day
                staffing_actual[shifttype_id][day_of_month] += 1
            except (ValueError, TypeError):
                pass  # Ignoriere ungültige Datumseinträge

    # 4. Fülle die Nullen für Tage, an denen niemand eingeteilt war
    final_staffing_actual = {}
    for shifttype_id in relevant_shifttype_ids:
        counts_for_type = {}
        for day in range(1, days_in_month + 1):
            counts_for_type[day] = staffing_actual[shifttype_id].get(day, 0)
        final_staffing_actual[shifttype_id] = counts_for_type

    return final_staffing_actual


# --- ENDE KORRIGIERTE HILFSFUNKTION ---


@shifts_bp.route('/shifts', methods=['GET'])
@login_required
def get_shifts():
    """
    Liefert alle Schichten, Totals, Konflikte, IST-Besetzung UND PLAN-STATUS.

    KORRIGIERT: Implementiert Python-Filterung für inaktive Benutzer, um
    Datenbank-Kompatibilitätsfehler an der Monatsgrenze zu umgehen.
    """
    try:
        year = int(request.args.get('year'))
        month = int(request.args.get('month'))
    except (TypeError, ValueError):
        return jsonify({"message": "Jahr und Monat sind erforderlich"}), 400

    current_month_start_date = date(year, month, 1)
    prev_month_end_date = current_month_start_date - timedelta(days=1)
    days_in_month = calendar.monthrange(year, month)[1]
    current_month_end_date = date(year, month, days_in_month)

    # --- START KORREKTUR: Aktiv/Inaktiv Logik (Regel 1) ---

    # 1. SQL-Abfrage: Lade ALLE potenziell relevanten Benutzer (aktiv/sichtbar)
    #    (Der fehlerhafte Inaktivitätsfilter WIRD HIER NICHT MEHR verwendet)
    users_query = User.query.filter(

        # NEU/KORREKTUR: User muss als sichtbar markiert sein (Grundvoraussetzung)
        User.shift_plan_visible == True,

        # 1. Aktiv-Datum: Muss (NULL sein) ODER (vor/am Monatsende)
        db.or_(User.aktiv_ab_datum.is_(None), User.aktiv_ab_datum <= current_month_end_date),

        # ALTE/FEHLERHAFTE Bedingung (für inaktiv_ab_datum) wird entfernt/ersetzt
        # Wir laden temporär alle User, die aktiv sein SOLLTEN,
        # und filtern sie im nächsten Schritt in Python.
    )

    all_users_pre_filter = users_query.order_by(User.shift_plan_sort_order, User.name).all()

    # 2. Python-Filterung (Workaround für den Datenbankfehler)
    #    Ein Benutzer ist nur sichtbar, wenn sein inaktiv_ab_datum strikt nach dem
    #    Ende des Vormonats (prev_month_end_date) liegt.
    users = []
    for user in all_users_pre_filter:
        # Wenn inaktiv_ab_datum == None ODER inaktiv_ab_datum > 31.12.2025 (für Jan 2026)
        if user.inaktiv_ab_datum is None or user.inaktiv_ab_datum > prev_month_end_date:
            users.append(user)

    # --- ENDE KORREKTUR ---

    shifts_for_calc = Shift.query.options(joinedload(Shift.shift_type)).filter(
        db.or_(
            db.and_(
                extract('year', Shift.date) == year,
                extract('month', Shift.date) == month
            ),
            Shift.date == prev_month_end_date
        )
    ).all()

    shift_types = ShiftType.query.order_by(ShiftType.staffing_sort_order, ShiftType.abbreviation).all()

    shifts_data = []
    shifts_last_month_data = []

    for s in shifts_for_calc:
        s_dict = s.to_dict()
        if s.date >= current_month_start_date:
            shifts_data.append(s_dict)
        else:
            shifts_last_month_data.append(s_dict)

    shifts_all_data = shifts_data + shifts_last_month_data

    users_data = [u.to_dict() for u in users]  # <-- Dies ist jetzt die SAUBER GEFILTERTE Liste
    shifttypes_data = [st.to_dict() for st in shift_types]

    # 2. Stundensummen berechnen
    first_day = datetime(year, month, 1)
    last_day_prev_month = first_day - timedelta(days=1)

    user_ids_this_month = {s['user_id'] for s in shifts_data}
    user_ids_prev_month = {s['user_id'] for s in shifts_last_month_data}
    relevant_user_ids = user_ids_this_month.union(user_ids_prev_month)

    totals_dict = {}
    for user_id in relevant_user_ids:
        if user_id in [u['id'] for u in users_data]:
            totals_dict[user_id] = _calculate_user_total_hours(user_id, year, month)

    # 3. Konflikte berechnen
    violation_manager = ViolationManager(shifttypes_data)
    violations_set = violation_manager.calculate_all_violations(year, month, shifts_all_data, users_data)
    violations_list = list(violations_set)

    # 4. IST-Besetzung berechnen
    staffing_actual = _calculate_actual_staffing(shifts_data, shifttypes_data, year, month)

    # --- Plan-Status holen ---
    status_obj = ShiftPlanStatus.query.filter_by(year=year, month=month).first()
    if status_obj:
        plan_status_data = status_obj.to_dict()
    else:
        plan_status_data = {
            "id": None, "year": year, "month": month,
            "status": "In Bearbeitung", "is_locked": False
        }

    return jsonify({
        "shifts": shifts_data,
        "users": users_data,  # <<< START NEU: Gefilterte Benutzerliste wird mitgesendet
        "totals": totals_dict,
        "violations": violations_list,
        "staffing_actual": staffing_actual,
        "shifts_last_month": shifts_last_month_data,
        "plan_status": plan_status_data
    }), 200


def _parse_date_from_payload(data):
    """
    Robustes Parsen von Datumsdaten.
    (Unverändert)
    """
    date_str = data.get('date')
    if date_str:
        if isinstance(date_str, (date, datetime)):
            return date_str if isinstance(date_str, date) else date_str.date()
        for fmt in ('%Y-%m-%d', '%d.%m.%Y'):
            try:
                return datetime.strptime(date_str, fmt).date()
            except ValueError:
                continue
        try:
            return datetime.fromisoformat(date_str).date()
        except Exception:
            raise ValueError('Ungültiges Datumsformat in "date". Erwartet YYYY-MM-DD oder TT.MM.YYYY.')
    try:
        day = data.get('day')
        month = data.get('month')
        year = data.get('year')
        if day is None or month is None or year is None:
            raise ValueError('Kein valides Datum gefunden (weder date noch day/month/year).')
        day_i = int(day)
        month_i = int(month)
        year_i = int(year)
        return datetime(year_i, month_i, day_i).date()
    except (TypeError, ValueError) as e:
        raise ValueError(str(e) or 'Ungültige day/month/year Kombination')


@shifts_bp.route('/shifts', methods=['POST'])
@admin_required
def save_shift():
    """
    Speichert oder löscht eine Schicht.
    (Unverändert zur letzten Version)
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"message": "Leere Nutzlast"}), 400

    user_id_raw = data.get('user_id') or data.get('userId')
    if user_id_raw is None:
        return jsonify({"message": "user_id erforderlich"}), 400

    try:
        user_id = int(user_id_raw)
    except (TypeError, ValueError):
        return jsonify({"message": "Ungültige user_id"}), 400

    raw_shift_type = data.get('shifttype_id')
    if raw_shift_type is None:
        raw_shift_type = data.get('shifttypeId')
    shifttype_id = None
    if raw_shift_type in (None, '', 'null'):
        shifttype_id = None
    else:
        try:
            shifttype_id = int(raw_shift_type)
        except (TypeError, ValueError):
            shifttype_id = None

    try:
        shift_date = _parse_date_from_payload(data)
    except ValueError as e:
        return jsonify({"message": f"Ungültiges Datum: {str(e)}"}), 400

    # --- SPERR-PRÜFUNG ---
    try:
        status_obj = ShiftPlanStatus.query.filter_by(
            year=shift_date.year,
            month=shift_date.month
        ).first()

        if status_obj and status_obj.is_locked:
            return jsonify({
                "message": f"Aktion blockiert: Der Schichtplan für {shift_date.month:02d}/{shift_date.year} ist gesperrt."
            }), 403
    except Exception as e:
        current_app.logger.error(f"Fehler bei der Schichtplan-Sperrprüfung: {str(e)}")
        return jsonify({"message": "Serverfehler bei der Sperrprüfung."}), 500
    # --- ENDE SPERR-PRÜFUNG ---

    free_type = ShiftType.query.filter_by(abbreviation='FREI').first()
    free_type_id = free_type.id if free_type else None

    is_free_payload = False
    if shifttype_id is None:
        is_free_payload = True
    elif free_type_id is not None and shifttype_id == free_type_id:
        is_free_payload = True
    elif shifttype_id == 0:
        is_free_payload = True

    status_code = 200
    action_taken = None
    saved_shift_id = None

    try:
        existing_shift = Shift.query.filter_by(user_id=user_id, date=shift_date).first()

        if existing_shift:
            saved_shift_id = existing_shift.id
            if is_free_payload:
                db.session.delete(existing_shift)
                action_taken = 'delete'
            else:
                existing_shift.shifttype_id = shifttype_id
                db.session.add(existing_shift)
                action_taken = 'update'
        else:
            if not is_free_payload:
                new_shift = Shift(user_id=user_id, shifttype_id=shifttype_id, date=shift_date)
                db.session.add(new_shift)
                db.session.flush()
                saved_shift_id = new_shift.id
                action_taken = 'create'
                status_code = 201
            else:
                action_taken = 'none'

        db.session.commit()

    except (IntegrityError, OperationalError) as e:
        db.session.rollback()
        current_app.logger.warning(f"DB-Fehler beim Speichern der Schicht: {str(e)}")
        existing = Shift.query.filter_by(user_id=user_id, date=shift_date).first()
        if existing:
            saved_shift_id = existing.id
            action_taken = 'update'
        else:
            action_taken = 'none'
        status_code = 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Unerwarteter Fehler beim Speichern: {str(e)}")
        return jsonify({"message": f"Serverfehler: {str(e)}"}), 500

    # Lese-Transaktion: re-load und berechne totals
    response_data = {}

    if action_taken in ('create', 'update'):
        if saved_shift_id:
            reloaded_shift = Shift.query.options(joinedload(Shift.shift_type)).get(saved_shift_id)
            if reloaded_shift:
                response_data = reloaded_shift.to_dict()
            else:
                response_data = {"message": "Schicht wurde gespeichert, konnte aber nicht neu geladen werden."}
                current_app.logger.error(f"Konnte Schicht-ID {saved_shift_id} nach Commit nicht finden.")
        else:
            response_data = {"message": "Schicht gespeichert, ID unbekannt."}
    elif action_taken == 'delete':
        response_data = {"message": "Schicht gelöscht (Frei)"}
    else:
        response_data = {"message": "Keine Aktion erforderlich (bereits Frei oder kein payload)."}

    # Totals
    new_total = _calculate_user_total_hours(user_id, shift_date.year, shift_date.month)
    response_data['new_total_hours'] = new_total

    try:
        next_day = shift_date + timedelta(days=1)
        if next_day.month != shift_date.month:
            response_data['new_total_hours_next_month'] = _calculate_user_total_hours(user_id, next_day.year,
                                                                                      next_day.month)
    except Exception as e:
        current_app.logger.warning(f"Fehler beim Berechnen des Folgemonats: {str(e)}")

    # --- NEUBERECHNUNG (Konflikte UND IST-Besetzung) ---

    month_start = date(shift_date.year, shift_date.month, 1)
    month_end = date(shift_date.year, shift_date.month, calendar.monthrange(shift_date.year, shift_date.month)[1])
    day_before = month_start - timedelta(days=1)
    day_after = month_end + timedelta(days=1)

    shifts_for_calc_all = Shift.query.options(joinedload(Shift.shift_type)).filter(
        Shift.date.between(day_before, day_after)
    ).all()

    relevant_user_ids_for_violations = {s.user_id for s in shifts_for_calc_all}
    users = User.query.filter(User.id.in_(relevant_user_ids_for_violations)).all()
    shift_types = ShiftType.query.order_by(ShiftType.staffing_sort_order, ShiftType.abbreviation).all()

    shifts_all_data = [s.to_dict() for s in shifts_for_calc_all]
    users_data = [u.to_dict() for u in users]
    shifttypes_data = [st.to_dict() for st in shift_types]

    # 3. Konflikte berechnen
    violation_manager = ViolationManager(shifttypes_data)
    violations_set = violation_manager.calculate_all_violations(shift_date.year, shift_date.month, shifts_all_data,
                                                                users_data)
    response_data['violations'] = list(violations_set)

    # 4. IST-Besetzung berechnen
    staffing_actual = _calculate_actual_staffing(shifts_data, shifttypes_data, shift_date.year, shift_date.month)

    return jsonify(response_data), status_code


# --- ROUTE ZUM SETZEN DES PLAN-STATUS ---
@shifts_bp.route('/shifts/status', methods=['PUT'])
@admin_required
def update_plan_status():
    """
    (Admin-Only) Aktualisiert den Status und die Sperrung eines Schichtplans.
    (Unverändert zur letzten Version)
    """
    data = request.get_json()
    if not data:
        return jsonify({"message": "Leere Nutzlast"}), 400

    try:
        year = int(data.get('year'))
        month = int(data.get('month'))
        status = data.get('status')
        is_locked = data.get('is_locked')
    except (TypeError, ValueError):
        return jsonify({"message": "Ungültiges Jahr oder Monat"}), 400

    if status not in ["In Bearbeitung", "Fertiggestellt"] or is_locked not in [True, False]:
        return jsonify({"message": "Ungültige Status- oder Sperrwerte"}), 400

    try:
        status_obj = ShiftPlanStatus.query.filter_by(year=year, month=month).first()

        if not status_obj:
            status_obj = ShiftPlanStatus(year=year, month=month)
            db.session.add(status_obj)

        status_obj.status = status
        status_obj.is_locked = is_locked

        lock_text = "Gesperrt" if is_locked else "Entsperrt"
        _log_update_event(
            "Schichtplan Status",
            f"Status für {month:02d}/{year} gesetzt auf: '{status}' ({lock_text})"
        )

        db.session.commit()

        return jsonify(status_obj.to_dict()), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler beim Aktualisieren des ShiftPlanStatus: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500

# --- ENDE ROUTE ---