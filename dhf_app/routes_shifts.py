# cheesylicious/dhfweb/dhfweb-8c61769a1d719fb2f6c9f14a71dc863ec0e0b9b5/dhf_app/routes_shifts.py

from flask import Blueprint, request, jsonify, current_app
from .models import Shift, ShiftType, User
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
        if shift.shift_type and shift.shift_type.is_work_shift:
            try:
                # --- KORREKTUR V2 (aus vorherigem Schritt) ---

                # 1. Addiere IMMER die Stunden des Tages (z.B. 6)
                total_hours += float(shift.shift_type.hours or 0.0)

                # 2. Addiere den Übertrag (z.B. 6), ABER NUR,
                #    wenn die Schicht NICHT am letzten Tag des Monats stattfindet.
                if shift.date != last_day_of_current_month:
                    total_hours += float(shift.shift_type.hours_spillover or 0.0)

                # --- ENDE KORREKTUR V2 ---
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
    Liefert alle Schichten, Totals, Konflikte UND IST-Besetzung.
    """
    try:
        year = int(request.args.get('year'))
        month = int(request.args.get('month'))
    except (TypeError, ValueError):
        return jsonify({"message": "Jahr und Monat sind erforderlich"}), 400

    current_month_start_date = date(year, month, 1)
    prev_month_end_date = current_month_start_date - timedelta(days=1)

    shifts_for_calc = Shift.query.options(joinedload(Shift.shift_type)).filter(
        db.or_(
            db.and_(
                extract('year', Shift.date) == year,
                extract('month', Shift.date) == month
            ),
            Shift.date == prev_month_end_date
        )
    ).all()

    users = User.query.order_by(User.shift_plan_sort_order, User.name).all()

    # NEU: ShiftType-Liste nach Sortierfeld für Besetzung sortieren
    shift_types = ShiftType.query.order_by(ShiftType.staffing_sort_order, ShiftType.abbreviation).all()  # <<< GEÄNDERT

    # --- ANPASSUNG (Regel 1) ---
    # Trenne die Schichten des aktuellen Monats von denen des Vormonats
    shifts_data = []
    shifts_last_month_data = []

    for s in shifts_for_calc:
        s_dict = s.to_dict()  # Konvertiere einmal
        if s.date >= current_month_start_date:
            shifts_data.append(s_dict)
        else:
            shifts_last_month_data.append(s_dict)

    # (shifts_all_data wird für die Konfliktberechnung benötigt und muss alle enthalten)
    shifts_all_data = shifts_data + shifts_last_month_data
    # --- ENDE ANPASSUNG ---

    users_data = [u.to_dict() for u in users]
    shifttypes_data = [st.to_dict() for st in shift_types]  # (Enthält jetzt die granularen SOLL-Werte)

    # 2. Stundensummen berechnen
    first_day = datetime(year, month, 1)
    last_day_prev_month = first_day - timedelta(days=1)

    # (Logik zur Ermittlung relevanter User-IDs kann vereinfacht werden)
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

    # 4. IST-Besetzung berechnen (verwendet jetzt die korrigierte Funktion)
    staffing_actual = _calculate_actual_staffing(shifts_data, shifttypes_data, year, month)

    return jsonify({
        "shifts": shifts_data,
        "totals": totals_dict,
        "violations": violations_list,
        "staffing_actual": staffing_actual,
        "shifts_last_month": shifts_last_month_data  # <-- NEU HINZUGEFÜGT
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
    (Erweitert um Neuberechnung der Konflikte UND IST-Besetzung)
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

    # Totals (Ruft die KORRIGIERTE Funktion auf)
    new_total = _calculate_user_total_hours(user_id, shift_date.year, shift_date.month)
    response_data['new_total_hours'] = new_total

    try:
        next_day = shift_date + timedelta(days=1)
        if next_day.month != shift_date.month:
            # Neuberechnung des Folgemonats (falls der geänderte Tag der Monatsletzte war)
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
    users = User.query.order_by(User.shift_plan_sort_order, User.name).all()

    # NEU: ShiftType-Liste nach Sortierfeld für Besetzung sortieren
    shift_types = ShiftType.query.order_by(ShiftType.staffing_sort_order, ShiftType.abbreviation).all()  # <<< GEÄNDERT

    shifts_all_data = [s.to_dict() for s in shifts_for_calc_all]
    users_data = [u.to_dict() for u in users]
    shifttypes_data = [st.to_dict() for st in shift_types]

    # 3. Konflikte berechnen
    violation_manager = ViolationManager(shifttypes_data)
    violations_set = violation_manager.calculate_all_violations(shift_date.year, shift_date.month, shifts_all_data,
                                                                users_data)
    response_data['violations'] = list(violations_set)

    # 4. IST-Besetzung berechnen (verwendet jetzt die korrigierte Funktion)
    shifts_in_month_dicts = [
        s_dict for s_dict in shifts_all_data
        if shift_date.year == datetime.fromisoformat(s_dict['date']).year and
           shift_date.month == datetime.fromisoformat(s_dict['date']).month
    ]
    staffing_actual = _calculate_actual_staffing(shifts_in_month_dicts, shifttypes_data, shift_date.year,
                                                 shift_date.month)
    response_data['staffing_actual'] = staffing_actual

    return jsonify(response_data), status_code