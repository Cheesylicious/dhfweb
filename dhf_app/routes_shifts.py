from flask import Blueprint, request, jsonify, current_app
from .models import Shift, ShiftType, User
from .extensions import db
from .routes_admin import admin_required
from flask_login import login_required
from sqlalchemy import extract, func
from sqlalchemy.orm import joinedload
from sqlalchemy.exc import IntegrityError, OperationalError
from datetime import datetime, timedelta

# Erstellt einen Blueprint. Alle Routen hier beginnen mit /api
shifts_bp = Blueprint('shifts', __name__, url_prefix='/api')


# --- HILFSFUNKTION (Unverändert, war bereits korrekt) ---
def _calculate_user_total_hours(user_id, year, month):
    """
    Berechnet die Gesamtstunden für EINEN User in einem Monat.
    Verwendet joinedload, um Lazy-Loading zu verhindern (Regel 2).
    """
    try:
        first_day_of_current_month = datetime(year, month, 1)
        last_day_of_previous_month = first_day_of_current_month - timedelta(days=1)
    except ValueError:
        current_app.logger.error(f"Ungültiges Datum in _calculate_user_total_hours: {year}-{month}")
        return 0.0

    total_hours = 0.0

    # 1. Normale Stunden (Eager Loading)
    shifts_in_this_month = Shift.query.options(joinedload(Shift.shift_type)).filter(
        Shift.user_id == user_id,
        extract('year', Shift.date) == year,
        extract('month', Shift.date) == month
    ).all()

    for shift in shifts_in_this_month:
        if shift.shift_type and shift.shift_type.is_work_shift:
            total_hours += shift.shift_type.hours

    # 2. Übertrag-Stunden (Eager Loading)
    shifts_on_last_day_prev_month = Shift.query.options(joinedload(Shift.shift_type)).filter(
        Shift.user_id == user_id,
        Shift.date == last_day_of_previous_month.date()
    ).all()

    for shift in shifts_on_last_day_prev_month:
        if shift.shift_type and shift.shift_type.is_work_shift and shift.shift_type.hours_spillover > 0:
            total_hours += shift.shift_type.hours_spillover

    return total_hours


# --- GET-Anfrage (Unverändert, war bereits korrekt) ---
@shifts_bp.route('/shifts', methods=['GET'])
@login_required
def get_shifts():
    """
    Holt alle Schichten & Stundensummen für einen Monat.
    """
    try:
        year = int(request.args.get('year'))
        month = int(request.args.get('month'))
    except (TypeError, ValueError):
        return jsonify({"message": "Jahr und Monat sind erforderlich"}), 400

    shifts_in_month = Shift.query.options(joinedload(Shift.shift_type)).filter(
        extract('year', Shift.date) == year,
        extract('month', Shift.date) == month
    ).all()

    first_day = datetime(year, month, 1)
    last_day_prev_month = first_day - timedelta(days=1)

    user_ids_this_month = db.session.query(Shift.user_id).filter(
        extract('year', Shift.date) == year,
        extract('month', Shift.date) == month
    ).distinct()
    user_ids_prev_month = db.session.query(Shift.user_id).filter(
        Shift.date == last_day_prev_month.date()
    ).distinct()

    relevant_user_ids = {uid[0] for uid in user_ids_this_month.union(user_ids_prev_month)}

    totals_dict = {}
    for user_id in relevant_user_ids:
        totals_dict[user_id] = _calculate_user_total_hours(user_id, year, month)

    return jsonify({
        "shifts": [s.to_dict() for s in shifts_in_month],
        "totals": totals_dict
    }), 200


# --- POST-Anfrage (KORRIGIERT) ---
@shifts_bp.route('/shifts', methods=['POST'])
@admin_required
def save_shift():
    """
    Speichert oder löscht eine einzelne Schicht.
    (Korrigiert, um Deadlocks durch Trennung von Write/Read zu verhindern)
    """
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

    status_code = 200
    action_taken = None  # 'delete', 'update', 'create', 'none'
    saved_shift_id = None  # Wir merken uns die ID der betroffenen Schicht

    # --- START: SCHREIB-TRANSAKTION (Regel 2) ---
    # (So kurz wie möglich halten)
    try:
        # Finde den Eintrag (ohne joinedload, da wir nur die ID brauchen)
        existing_shift = Shift.query.filter_by(user_id=user_id, date=shift_date).first()

        if existing_shift:
            saved_shift_id = existing_shift.id  # Merken
            if shifttype_id == free_type_id:
                db.session.delete(existing_shift)
                action_taken = 'delete'
            else:
                existing_shift.shifttype_id = shifttype_id
                db.session.add(existing_shift)
                action_taken = 'update'
        else:
            if shifttype_id != free_type_id:
                new_shift = Shift(user_id=user_id, shifttype_id=shifttype_id, date=shift_date)
                db.session.add(new_shift)

                # (WICHTIG) Wir brauchen die ID für den nächsten Schritt.
                # db.session.flush() schreibt die Änderung in die DB (ohne Commit),
                # um die 'new_shift.id' zu erhalten.
                db.session.flush()
                saved_shift_id = new_shift.id

                action_taken = 'create'
                status_code = 201
            else:
                action_taken = 'none'

        db.session.commit()

    except (IntegrityError, OperationalError) as e:
        db.session.rollback()
        current_app.logger.warning(f"Abgefangener DB-Fehler (Doppelklick/Lock) beim Speichern: {str(e)}")

        # Die Aktion ist fehlgeschlagen ODER wurde von einem anderen Klick ausgeführt.
        # Wir laden den *aktuellen* Stand, um die korrekte ID zu haben.
        existing = Shift.query.filter_by(user_id=user_id, date=shift_date).first()
        if existing:
            saved_shift_id = existing.id
            action_taken = 'update'
        else:
            action_taken = 'none'
        status_code = 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Unerwarteter Fehler beim Speichern der Schicht: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500

    # --- ENDE: SCHREIB-TRANSAKTION ---

    # --- START: LESE-TRANSAKTION (Regel 2) ---
    # (Jetzt, da der Commit durch ist, können wir sicher lesen)

    response_data = {}

    if action_taken in ['update', 'create']:
        # Lade die gespeicherte Schicht *mit* joinedload (Regel 2)
        reloaded_shift = Shift.query.options(joinedload(Shift.shift_type)).get(saved_shift_id)
        if reloaded_shift:
            response_data = reloaded_shift.to_dict()
        else:
            # (Sollte nicht passieren)
            response_data = {"message": "Fehler beim Neuladen der Schicht."}
            current_app.logger.error(f"Konnte Schicht-ID {saved_shift_id} nach Commit nicht finden.")

    elif action_taken == 'delete':
        response_data = {"message": "Schicht gelöscht (Frei)"}
    else:  # 'none'
        response_data = {"message": "Keine Aktion (bereits Frei)"}

    # --- STUNDEN BERECHNEN (Teil der Lese-Transaktion) ---

    new_total_hours = _calculate_user_total_hours(user_id, shift_date.year, shift_date.month)
    response_data['new_total_hours'] = new_total_hours

    try:
        next_day = shift_date + timedelta(days=1)
        if next_day.month != shift_date.month:
            next_month_total = _calculate_user_total_hours(user_id, next_day.year, next_day.month)
            response_data['new_total_hours_next_month'] = next_month_total
    except Exception as e:
        current_app.logger.warning(f"Konnte Folgemonat nicht berechnen: {str(e)}")

    return jsonify(response_data), status_code