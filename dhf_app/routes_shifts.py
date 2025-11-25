# dhf_app/routes_shifts.py

from flask import Blueprint, request, jsonify, current_app
from .models import Shift, ShiftType, User, ShiftPlanStatus, UpdateLog, ShiftQuery
from .extensions import db
from .utils import admin_required
from flask_login import login_required
from sqlalchemy import extract, func
from sqlalchemy.orm import joinedload
from sqlalchemy.exc import IntegrityError, OperationalError
from datetime import datetime, timedelta, date
from .violation_manager import ViolationManager
import calendar
from collections import defaultdict

shifts_bp = Blueprint('shifts', __name__, url_prefix='/api')


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


def _calculate_user_total_hours(user_id, year, month, shift_types_map=None):
    """
    Berechnet Gesamtstunden für einen User in einem Monat.
    Inkludiert:
    1. Genehmigte Schichten (Shift)
    2. Offene Wunsch-Anfragen (ShiftQuery)
    """
    try:
        days_in_month = calendar.monthrange(year, month)[1]
        last_day_of_current_month = date(year, month, days_in_month)
        first_day_of_current_month = date(year, month, 1)
        last_day_of_previous_month = first_day_of_current_month - timedelta(days=1)
    except ValueError:
        current_app.logger.error(f"Ungültiges Datum in _calculate_user_total_hours: {year}-{month}")
        return 0.0

    # Map laden falls nicht übergeben (für Einzelaufrufe in save_shift)
    if shift_types_map is None:
        all_types = ShiftType.query.all()
        shift_types_map = {st.abbreviation: st for st in all_types}

    total_hours = 0.0

    # --- 1. Genehmigte Schichten (Shift) ---
    shifts_in_this_month = Shift.query.options(joinedload(Shift.shift_type)).filter(
        Shift.user_id == user_id,
        extract('year', Shift.date) == year,
        extract('month', Shift.date) == month
    ).all()

    for shift in shifts_in_this_month:
        # Prüfen ob shift_type existiert (könnte bei Locked-Empty-Shift None sein)
        if shift.shift_type and shift.shift_type.is_work_shift:
            try:
                total_hours += float(shift.shift_type.hours or 0.0)
                # Übertrag abziehen am Monatsende
                if shift.date == last_day_of_current_month and (shift.shift_type.hours_spillover or 0.0) > 0:
                    total_hours -= float(shift.shift_type.hours_spillover or 0.0)
            except Exception:
                pass

    # Übertrag vom Vormonat (Shift)
    shifts_on_last_day_prev_month = Shift.query.options(joinedload(Shift.shift_type)).filter(
        Shift.user_id == user_id,
        Shift.date == last_day_of_previous_month
    ).all()

    for shift in shifts_on_last_day_prev_month:
        if shift.shift_type and shift.shift_type.is_work_shift and (shift.shift_type.hours_spillover or 0.0) > 0:
            try:
                total_hours += float(shift.shift_type.hours_spillover or 0.0)
            except Exception:
                pass

    # --- 2. Offene Wunsch-Anfragen (ShiftQuery) ---

    # A) Anfragen im aktuellen Monat
    queries_this_month = ShiftQuery.query.filter(
        ShiftQuery.sender_user_id == user_id,
        extract('year', ShiftQuery.shift_date) == year,
        extract('month', ShiftQuery.shift_date) == month,
        ShiftQuery.status == 'offen'
    ).all()

    for q in queries_this_month:
        if q.message.startswith("Anfrage für:"):
            parts = q.message.split(":")
            if len(parts) > 1:
                abbr = parts[1].strip().replace('?', '')
                st = shift_types_map.get(abbr)

                if st and st.is_work_shift:
                    try:
                        total_hours += float(st.hours or 0.0)
                        # Übertrag abziehen am Monatsende
                        if q.shift_date == last_day_of_current_month and (st.hours_spillover or 0.0) > 0:
                            total_hours -= float(st.hours_spillover or 0.0)
                    except Exception:
                        pass

    # B) Übertrag von Anfragen am letzten Tag des Vormonats
    queries_prev_month_last_day = ShiftQuery.query.filter(
        ShiftQuery.sender_user_id == user_id,
        ShiftQuery.shift_date == last_day_of_previous_month,
        ShiftQuery.status == 'offen'
    ).all()

    for q in queries_prev_month_last_day:
        if q.message.startswith("Anfrage für:"):
            parts = q.message.split(":")
            if len(parts) > 1:
                abbr = parts[1].strip().replace('?', '')
                st = shift_types_map.get(abbr)

                if st and st.is_work_shift and (st.hours_spillover or 0.0) > 0:
                    try:
                        total_hours += float(st.hours_spillover or 0.0)
                    except Exception:
                        pass

    return round(total_hours, 2)


def _calculate_actual_staffing(shifts_in_month_dicts, queries_in_month_dicts, shifttypes_dicts, year, month):
    """
    Berechnet die IST-Besetzung (tatsächliche Zählung) für alle Schichtarten.
    Zählt genehmigte Schichten UND offene Wunsch-Anfragen.
    """
    days_in_month = calendar.monthrange(year, month)[1]

    relevant_shifttype_ids = set()
    abbr_to_id_map = {}

    for st in shifttypes_dicts:
        abbr_to_id_map[st['abbreviation']] = st['id']
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
        return {}

    staffing_actual = defaultdict(lambda: defaultdict(int))

    # 2. Zähle genehmigte Schichten (shifts)
    for s_dict in shifts_in_month_dicts:
        shifttype_id = s_dict.get('shifttype_id')

        if shifttype_id in relevant_shifttype_ids:
            try:
                date_str = s_dict.get('date')
                if not date_str: continue

                try:
                    day_of_month = datetime.fromisoformat(date_str).day
                except (ValueError, AttributeError):
                    day_of_month = int(date_str.split('-')[2])

                staffing_actual[shifttype_id][day_of_month] += 1
            except (ValueError, TypeError, IndexError):
                pass

    # 3. Zähle offene Wunsch-Anfragen (queries)
    for q_dict in queries_in_month_dicts:
        msg = q_dict.get('message', '')
        if msg.startswith("Anfrage für:"):
            try:
                parts = msg.split(":")
                if len(parts) > 1:
                    abbr = parts[1].strip().replace('?', '')
                    st_id = abbr_to_id_map.get(abbr)

                    if st_id and st_id in relevant_shifttype_ids:
                        date_str = q_dict.get('shift_date')
                        if not date_str: continue

                        try:
                            day_of_month = datetime.fromisoformat(date_str).day
                        except (ValueError, AttributeError):
                            day_of_month = int(date_str.split('-')[2])

                        staffing_actual[st_id][day_of_month] += 1
            except Exception:
                pass

    final_staffing_actual = {}
    for shifttype_id in relevant_shifttype_ids:
        counts_for_type = {}
        for day in range(1, days_in_month + 1):
            counts_for_type[day] = staffing_actual[shifttype_id].get(day, 0)
        final_staffing_actual[shifttype_id] = counts_for_type

    return final_staffing_actual


@shifts_bp.route('/shifts', methods=['GET'])
@login_required
def get_shifts():
    try:
        year = int(request.args.get('year'))
        month = int(request.args.get('month'))
    except (TypeError, ValueError):
        return jsonify({"message": "Jahr und Monat sind erforderlich"}), 400

    current_month_start_date = date(year, month, 1)
    days_in_month = calendar.monthrange(year, month)[1]
    current_month_end_date = date(year, month, days_in_month)
    prev_month_end_date = current_month_start_date - timedelta(days=1)

    users_query = User.query.filter(
        User.shift_plan_visible == True,
        db.or_(User.aktiv_ab_datum.is_(None), User.aktiv_ab_datum <= current_month_end_date)
    )
    all_users_pre_filter = users_query.order_by(User.shift_plan_sort_order, User.name).all()

    users = []
    for user in all_users_pre_filter:
        if user.inaktiv_ab_datum is None or user.inaktiv_ab_datum > prev_month_end_date:
            users.append(user)

    shifts_for_calc = Shift.query.options(joinedload(Shift.shift_type)).filter(
        db.or_(
            db.and_(extract('year', Shift.date) == year, extract('month', Shift.date) == month),
            Shift.date == prev_month_end_date
        )
    ).all()

    shift_types = ShiftType.query.order_by(ShiftType.staffing_sort_order, ShiftType.abbreviation).all()

    # Map erstellen für effizientere Berechnung
    st_map = {st.abbreviation: st for st in shift_types}

    shifts_data = []
    shifts_last_month_data = []

    for s in shifts_for_calc:
        s_dict = s.to_dict()
        if s.date >= current_month_start_date:
            shifts_data.append(s_dict)
        else:
            shifts_last_month_data.append(s_dict)

    shifts_all_data = shifts_data + shifts_last_month_data
    users_data = [u.to_dict() for u in users]
    shifttypes_data = [st.to_dict() for st in shift_types]

    # Berechnungen
    # Wir müssen auch User berücksichtigen, die nur Anfragen haben, aber noch keine Schichten
    totals_dict = {}
    for user in users:
        totals_dict[user.id] = _calculate_user_total_hours(user.id, year, month, st_map)

    violation_manager = ViolationManager(shifttypes_data)
    violations_set = violation_manager.calculate_all_violations(year, month, shifts_all_data, users_data)

    queries_for_calc = ShiftQuery.query.filter(
        extract('year', ShiftQuery.shift_date) == year,
        extract('month', ShiftQuery.shift_date) == month,
        ShiftQuery.status == 'offen'
    ).all()
    queries_data = [q.to_dict() for q in queries_for_calc]

    staffing_actual = _calculate_actual_staffing(shifts_data, queries_data, shifttypes_data, year, month)

    status_obj = ShiftPlanStatus.query.filter_by(year=year, month=month).first()
    plan_status_data = status_obj.to_dict() if status_obj else {"id": None, "year": year, "month": month,
                                                                "status": "In Bearbeitung", "is_locked": False}

    return jsonify({
        "shifts": shifts_data,
        "users": users_data,
        "totals": totals_dict,
        "violations": list(violations_set),
        "staffing_actual": staffing_actual,
        "shifts_last_month": shifts_last_month_data,
        "plan_status": plan_status_data
    }), 200


def _parse_date_from_payload(data):
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
            pass
    raise ValueError('Ungültiges Datum')


# --- NEU: Route zum Umschalten des Sperrstatus ---
@shifts_bp.route('/shifts/toggle_lock', methods=['POST'])
@admin_required
def toggle_shift_lock():
    """
    Schaltet den 'is_locked' Status einer Schichtzelle um.
    Wenn die Zelle leer ist, wird ein neuer Shift-Eintrag (shifttype_id=None) erstellt, der gesperrt ist.
    """
    data = request.get_json()
    if not data:
        return jsonify({"message": "Keine Daten gesendet."}), 400

    try:
        user_id = int(data.get('user_id'))
        shift_date = _parse_date_from_payload(data)
    except (TypeError, ValueError):
        return jsonify({"message": "Ungültige User-ID oder Datum."}), 400

    # Globale Plansperre prüfen
    status_obj = ShiftPlanStatus.query.filter_by(year=shift_date.year, month=shift_date.month).first()
    if status_obj and status_obj.is_locked:
        return jsonify({"message": "Plan ist global gesperrt."}), 403

    try:
        shift = Shift.query.filter_by(user_id=user_id, date=shift_date).first()

        if shift:
            # Status umschalten
            shift.is_locked = not shift.is_locked

            # Aufräumen: Wenn es eine "leere" Schicht war (shifttype=None) und sie jetzt entsperrt wird,
            # ist sie überflüssig -> löschen.
            if shift.shifttype_id is None and not shift.is_locked:
                db.session.delete(shift)
                was_deleted = True
            else:
                was_deleted = False
        else:
            # Neue leere, gesperrte Schicht erstellen
            shift = Shift(user_id=user_id, date=shift_date, shifttype_id=None, is_locked=True)
            db.session.add(shift)
            was_deleted = False

        db.session.commit()

        if was_deleted:
            # Dem Frontend signalisieren, dass der Eintrag weg ist
            return jsonify({"deleted": True, "user_id": user_id, "date": shift_date.isoformat()}), 200
        else:
            return jsonify(shift.to_dict()), 200

    except Exception as e:
        db.session.rollback()
        return jsonify({"message": f"DB Fehler: {str(e)}"}), 500


# --- NEU: Route zum Leeren des Schichtplans (Behält gesperrte Schichten) ---
@shifts_bp.route('/shifts/clear', methods=['DELETE'])
@admin_required
def clear_shift_plan():
    """
    Löscht alle Schichten eines Monats, sofern der Plan nicht global gesperrt ist.
    Einzeln gesperrte Schichten (is_locked=True) werden NICHT gelöscht.
    """
    data = request.get_json() or {}
    try:
        year = int(data.get('year'))
        month = int(data.get('month'))
    except (TypeError, ValueError):
        return jsonify({"message": "Jahr und Monat sind erforderlich."}), 400

    # 1. Globale Sperre prüfen
    status_obj = ShiftPlanStatus.query.filter_by(year=year, month=month).first()
    if status_obj and status_obj.is_locked:
        return jsonify({"message": "Der Schichtplan ist global gesperrt. Löschen nicht möglich."}), 403

    try:
        # 2. Performantes Löschen aller NICHT gesperrten Schichten für den Zeitraum
        # Wir nutzen synchronize_session=False für maximale Performance (Regel 2)
        # Dies generiert ein effizientes "DELETE FROM shift WHERE ..." Statement
        num_deleted = Shift.query.filter(
            extract('year', Shift.date) == year,
            extract('month', Shift.date) == month,
            Shift.is_locked == False  # WICHTIG: Gesperrte Schichten behalten!
        ).delete(synchronize_session=False)

        if num_deleted > 0:
            _log_update_event("Schichtplan", f"Plan für {month:02d}/{year} geleert. ({num_deleted} Einträge gelöscht, gesperrte behalten).")
            db.session.commit()
            return jsonify({"message": f"Plan erfolgreich geleert. {num_deleted} Schichten gelöscht."}), 200
        else:
            return jsonify({"message": "Keine löschbaren Schichten gefunden."}), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler beim Leeren des Plans: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500
# --- ENDE NEU ---


@shifts_bp.route('/shifts', methods=['POST'])
@admin_required
def save_shift():
    data = request.get_json(silent=True)
    if not data: return jsonify({"message": "Leere Nutzlast"}), 400

    try:
        user_id = int(data.get('user_id') or data.get('userId'))
        raw_shift_type = data.get('shifttype_id') or data.get('shifttypeId')
        shifttype_id = int(raw_shift_type) if raw_shift_type not in (None, '', 'null') else None
        shift_date = _parse_date_from_payload(data)
    except (TypeError, ValueError) as e:
        return jsonify({"message": f"Ungültige Daten: {str(e)}"}), 400

    status_obj = ShiftPlanStatus.query.filter_by(year=shift_date.year, month=shift_date.month).first()
    if status_obj and status_obj.is_locked:
        return jsonify({"message": f"Aktion blockiert: Plan gesperrt."}), 403

    free_type = ShiftType.query.filter_by(abbreviation='FREI').first()
    is_free = (shifttype_id is None) or (free_type and shifttype_id == free_type.id) or (shifttype_id == 0)

    action_taken, saved_shift_id = None, None
    status_code = 200

    try:
        existing_shift = Shift.query.filter_by(user_id=user_id, date=shift_date).first()

        # --- NEU: Check auf individuelle Sperre ---
        if existing_shift and existing_shift.is_locked:
            return jsonify({
                               "message": "Diese Schicht ist einzeln gesperrt (Schloss-Symbol). Bitte entsperren (Leertaste), um sie zu ändern."}), 403
        # --- ENDE NEU ---

        if existing_shift:
            saved_shift_id = existing_shift.id
            if is_free:
                db.session.delete(existing_shift)
                action_taken = 'delete'
            else:
                existing_shift.shifttype_id = shifttype_id
                db.session.add(existing_shift)
                action_taken = 'update'
        elif not is_free:
            new_shift = Shift(user_id=user_id, shifttype_id=shifttype_id, date=shift_date)
            db.session.add(new_shift)
            db.session.flush()
            saved_shift_id = new_shift.id
            action_taken = 'create'
            status_code = 201
        else:
            action_taken = 'none'

        db.session.commit()
    except Exception as e:
        db.session.rollback()
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500

    response_data = {}
    if action_taken in ('create', 'update') and saved_shift_id:
        reloaded = Shift.query.options(joinedload(Shift.shift_type)).get(saved_shift_id)
        response_data = reloaded.to_dict() if reloaded else {}
    elif action_taken == 'delete':
        response_data = {"message": "Gelöscht"}

    # Totals neu berechnen (inkl. Queries!)
    response_data['new_total_hours'] = _calculate_user_total_hours(user_id, shift_date.year, shift_date.month)

    month_start = date(shift_date.year, shift_date.month, 1)
    month_end = date(shift_date.year, shift_date.month, calendar.monthrange(shift_date.year, shift_date.month)[1])
    day_before = month_start - timedelta(days=1)
    day_after = month_end + timedelta(days=1)

    shifts_for_calc_all = Shift.query.options(joinedload(Shift.shift_type)).filter(
        Shift.date.between(day_before, day_after)
    ).all()

    relevant_user_ids = {s.user_id for s in shifts_for_calc_all}
    users = User.query.filter(User.id.in_(relevant_user_ids)).all()
    shift_types = ShiftType.query.order_by(ShiftType.staffing_sort_order, ShiftType.abbreviation).all()

    shifts_all_data = [s.to_dict() for s in shifts_for_calc_all]
    users_data = [u.to_dict() for u in users]
    shifttypes_data = [st.to_dict() for st in shift_types]

    violation_manager = ViolationManager(shifttypes_data)
    response_data['violations'] = list(
        violation_manager.calculate_all_violations(shift_date.year, shift_date.month, shifts_all_data, users_data))

    shifts_data_for_staffing = []
    for s in shifts_for_calc_all:
        if s.date >= month_start and s.date <= month_end:
            shifts_data_for_staffing.append(s.to_dict())

    # Queries für Staffing mit einbeziehen
    queries_for_calc = ShiftQuery.query.filter(
        extract('year', ShiftQuery.shift_date) == shift_date.year,
        extract('month', ShiftQuery.shift_date) == shift_date.month,
        ShiftQuery.status == 'offen'
    ).all()
    queries_data = [q.to_dict() for q in queries_for_calc]

    response_data['staffing_actual'] = _calculate_actual_staffing(shifts_data_for_staffing, queries_data,
                                                                  shifttypes_data, shift_date.year, shift_date.month)

    return jsonify(response_data), status_code


@shifts_bp.route('/shifts/status', methods=['PUT'])
@admin_required
def update_plan_status():
    data = request.get_json() or {}
    try:
        year = int(data.get('year'))
        month = int(data.get('month'))
        status_obj = ShiftPlanStatus.query.filter_by(year=year, month=month).first()
        if not status_obj:
            status_obj = ShiftPlanStatus(year=year, month=month)
            db.session.add(status_obj)

        status_obj.status = data.get('status', status_obj.status)
        status_obj.is_locked = data.get('is_locked', status_obj.is_locked)

        _log_update_event("Schichtplan Status",
                          f"Status {month}/{year}: {status_obj.status} (Locked: {status_obj.is_locked})")
        db.session.commit()
        return jsonify(status_obj.to_dict()), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"message": f"Fehler: {str(e)}"}), 500