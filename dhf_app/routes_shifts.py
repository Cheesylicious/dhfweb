from flask import Blueprint, request, jsonify, current_app
from .models import Shift, ShiftType, User
from .extensions import db
from .routes_admin import admin_required
from flask_login import login_required
from sqlalchemy import extract, func
from sqlalchemy.orm import joinedload
from sqlalchemy.exc import IntegrityError, OperationalError
from datetime import datetime, timedelta, date
# --- NEU ---
from .violation_manager import ViolationManager  # Importiert den externen Manager
# --- ENDE NEU ---
import calendar  # Für Monatslängen

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
                # Fügt Robustheit beim Parsen hinzu
                total_hours += float(shift.shift_type.hours or 0.0)
            except Exception:
                current_app.logger.warning(
                    f"Ungültiger hours-Wert für ShiftType id={getattr(shift.shift_type, 'id', None)}")

    # Spillover vom letzten Tag des Vormonats
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


@shifts_bp.route('/shifts', methods=['GET'])
@login_required
def get_shifts():
    """
    Liefert alle Schichten, Totals UND Konflikte für einen Monat.
    (Erweitert um Konfliktprüfung und Vormonats-Query für Vollständigkeit)
    """
    try:
        year = int(request.args.get('year'))
        month = int(request.args.get('month'))
    except (TypeError, ValueError):
        return jsonify({"message": "Jahr und Monat sind erforderlich"}), 400

    # Daten für die Berechnung ermitteln (aktueller Monat + letzter Tag Vormonat)
    current_month_start_date = date(year, month, 1)
    prev_month_end_date = current_month_start_date - timedelta(days=1)

    # Optimierte Abfrage: Holt alle Schichten des Monats + den letzten Tag des Vormonats
    shifts_for_calc = Shift.query.options(joinedload(Shift.shift_type)).filter(
        db.or_(
            db.and_(
                extract('year', Shift.date) == year,
                extract('month', Shift.date) == month
            ),
            Shift.date == prev_month_end_date  # Nur der letzte Tag des Vormonats
        )
    ).all()

    # Zusätzliche Daten abrufen
    users = User.query.order_by(User.shift_plan_sort_order, User.name).all()
    shift_types = ShiftType.query.all()

    # Daten für die Übergabe vorbereiten
    shifts_data = [s.to_dict() for s in shifts_for_calc if s.date >= current_month_start_date]
    shifts_all_data = [s.to_dict() for s in shifts_for_calc]
    users_data = [u.to_dict() for u in users]
    shifttypes_data = [st.to_dict() for st in shift_types]

    # 2. Stundensummen berechnen

    first_day = datetime(year, month, 1)
    last_day_prev_month = first_day - timedelta(days=1)

    # Ermittle relevante Benutzer für die Berechnung
    user_ids_this_month = {s.user_id for s in shifts_for_calc if s.date >= first_day.date()}
    user_ids_prev_month = {s.user_id for s in shifts_for_calc if s.date == last_day_prev_month.date()}

    relevant_user_ids = user_ids_this_month.union(user_ids_prev_month)

    totals_dict = {}
    for user_id in relevant_user_ids:
        # Führt die Berechnung nur für tatsächlich existierende User durch
        if user_id in [u['id'] for u in users_data]:
            totals_dict[user_id] = _calculate_user_total_hours(user_id, year, month)

    # 3. Konflikte berechnen (NEU)
    violation_manager = ViolationManager(shifttypes_data)
    violations_set = violation_manager.calculate_all_violations(year, month, shifts_all_data, users_data)

    # Konvertiere Set von (user_id, day) zu einer Liste für JSON
    violations_list = list(violations_set)

    return jsonify({
        "shifts": shifts_data,
        "totals": totals_dict,
        "violations": violations_list  # <<< NEU: Konflikte zurückgeben
    }), 200


def _parse_date_from_payload(data):
    """
    Robustes Parsen von Datumsdaten.
    (Unverändert)
    """
    # First: explicit 'date' string
    date_str = data.get('date')
    if date_str:
        # allow already a date object too (occasionally)
        if isinstance(date_str, (date, datetime)):
            return date_str if isinstance(date_str, date) else date_str.date()
        for fmt in ('%Y-%m-%d', '%d.%m.%Y'):
            try:
                return datetime.strptime(date_str, fmt).date()
            except ValueError:
                continue
        # fallback: try ISO parse
        try:
            return datetime.fromisoformat(date_str).date()
        except Exception:
            raise ValueError('Ungültiges Datumsformat in "date". Erwartet YYYY-MM-DD oder TT.MM.YYYY.')

    # Second: separate fields day/month/year
    try:
        day = data.get('day')
        month = data.get('month')
        year = data.get('year')
        if day is None or month is None or year is None:
            raise ValueError('Kein valides Datum gefunden (weder date noch day/month/year).')
        # cast to int safely (strings like "01" will work)
        day_i = int(day)
        month_i = int(month)
        year_i = int(year)
        return datetime(year_i, month_i, day_i).date()
    except (TypeError, ValueError) as e:
        # re-raise als ValueError mit klarer Meldung
        raise ValueError(str(e) or 'Ungültige day/month/year Kombination')


@shifts_bp.route('/shifts', methods=['POST'])
@admin_required
def save_shift():
    """
    Speichert oder löscht eine Schicht.
    (Erweitert um Neuberechnung der Konflikte)
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"message": "Leere Nutzlast"}), 400

    # user_id kann 'user_id' oder 'userId' heißen, abfangen
    user_id_raw = data.get('user_id') or data.get('userId')
    if user_id_raw is None:
        return jsonify({"message": "user_id erforderlich"}), 400

    try:
        user_id = int(user_id_raw)
    except (TypeError, ValueError):
        return jsonify({"message": "Ungültige user_id"}), 400

    # robustes Parsen von shifttype_id (kann 'null', '', None oder 0 sein)
    raw_shift_type = data.get('shifttype_id')
    if raw_shift_type is None:
        raw_shift_type = data.get('shifttypeId')  # alternative key
    shifttype_id = None
    if raw_shift_type in (None, '', 'null'):
        shifttype_id = None
    else:
        try:
            # viele frontends senden '0' oder 0 für "FREI" — wir behandeln 0 als None später
            shifttype_id = int(raw_shift_type)
        except (TypeError, ValueError):
            shifttype_id = None

    # Parse date (robust)
    try:
        shift_date = _parse_date_from_payload(data)
    except ValueError as e:
        return jsonify({"message": f"Ungültiges Datum: {str(e)}"}), 400

    # Ermitteln der "FREI"-Schicht (falls vorhanden)
    free_type = ShiftType.query.filter_by(abbreviation='FREI').first()
    free_type_id = free_type.id if free_type else None

    # Interpretiere shifttype_id == free_type_id oder shifttype_id in (None, 0) als 'FREI'
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
        # Kurzzeit-Write-Transaction (Unverändert)
        existing_shift = Shift.query.filter_by(user_id=user_id, date=shift_date).first()

        if existing_shift:
            saved_shift_id = existing_shift.id
            if is_free_payload:
                # Lösche vorhandene Schicht (wird zu Frei)
                db.session.delete(existing_shift)
                action_taken = 'delete'
            else:
                # Update vorhandene Schicht
                existing_shift.shifttype_id = shifttype_id
                db.session.add(existing_shift)
                action_taken = 'update'
        else:
            if not is_free_payload:
                # Erstelle neue Schicht
                new_shift = Shift(user_id=user_id, shifttype_id=shifttype_id, date=shift_date)
                db.session.add(new_shift)
                # flush, um id zu erhalten (ohne Commit)
                db.session.flush()
                saved_shift_id = new_shift.id
                action_taken = 'create'
                status_code = 201
            else:
                action_taken = 'none'  # payload wollte "frei", und es gab nichts zum Löschen

        db.session.commit()

    except (IntegrityError, OperationalError) as e:
        db.session.rollback()
        current_app.logger.warning(f"DB-Fehler beim Speichern der Schicht: {str(e)}")
        # Best-effort: lade aktuellen Zustand
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

    # Falls Änderung Auswirkungen auf nächsten Monat hat (z.B. Spillover), mitliefern
    try:
        next_day = shift_date + timedelta(days=1)
        if next_day.month != shift_date.month:
            response_data['new_total_hours_next_month'] = _calculate_user_total_hours(user_id, next_day.year,
                                                                                      next_day.month)
    except Exception as e:
        current_app.logger.warning(f"Fehler beim Berechnen des Folgemonats: {str(e)}")

    # NEU: Vollständige Konfliktprüfung für den aktuellen Monat.

    # Datumsgrenzen für die Abfrage
    month_start = date(shift_date.year, shift_date.month, 1)
    month_end = date(shift_date.year, shift_date.month, calendar.monthrange(shift_date.year, shift_date.month)[1])
    day_before = month_start - timedelta(days=1)
    day_after = month_end + timedelta(days=1)

    # Abfrage aller notwendigen Schichten (Tag vorher bis Tag nachher)
    shifts_for_violation = Shift.query.options(joinedload(Shift.shift_type)).filter(
        Shift.date.between(day_before, day_after)
    ).all()

    # Zusätzliche Daten abrufen
    users = User.query.order_by(User.shift_plan_sort_order, User.name).all()
    shift_types = ShiftType.query.all()

    # Daten für den ViolationManager vorbereiten
    shifts_all_data = [s.to_dict() for s in shifts_for_violation]
    users_data = [u.to_dict() for u in users]
    shifttypes_data = [st.to_dict() for st in shift_types]

    violation_manager = ViolationManager(shifttypes_data)
    violations_set = violation_manager.calculate_all_violations(shift_date.year, shift_date.month, shifts_all_data,
                                                                users_data)

    # Konvertiere Set von (user_id, day) zu einer Liste für JSON
    response_data['violations'] = list(violations_set)

    return jsonify(response_data), status_code