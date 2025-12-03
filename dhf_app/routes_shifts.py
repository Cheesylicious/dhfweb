# dhf_app/routes_shifts.py

from flask import Blueprint, request, jsonify, current_app
from .models import Shift, ShiftType, User, ShiftPlanStatus, UpdateLog, ShiftQuery
from .extensions import db
from .utils import admin_required
from flask_login import login_required, current_user
from sqlalchemy import extract, func
from sqlalchemy.orm import joinedload
from sqlalchemy.exc import IntegrityError, OperationalError
from datetime import datetime, timedelta, date
from .violation_manager import ViolationManager
import calendar
from collections import defaultdict
from .email_service import send_template_email

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


def _calculate_user_total_hours(user_id, year, month, shift_types_map=None, variant_id=None):
    """
    Berechnet Gesamtstunden für einen User in einem Monat.
    Inkludiert:
    1. Genehmigte Schichten (Shift) der gewählten Variante (oder Hauptplan)
    2. Offene Wunsch-Anfragen (ShiftQuery) (gelten global)

    HINWEIS: Übertrag vom Vormonat wird IMMER aus dem Hauptplan (variant_id=None) gezogen,
    da Varianten meist nur für den aktuellen Planungsmonat existieren.
    """
    try:
        days_in_month = calendar.monthrange(year, month)[1]
        last_day_of_current_month = date(year, month, days_in_month)
        first_day_of_current_month = date(year, month, 1)
        last_day_of_previous_month = first_day_of_current_month - timedelta(days=1)
    except ValueError:
        current_app.logger.error(f"Ungültiges Datum in _calculate_user_total_hours: {year}-{month}")
        return 0.0

    # Map laden falls nicht übergeben
    if shift_types_map is None:
        all_types = ShiftType.query.all()
        shift_types_map = {st.abbreviation: st for st in all_types}

    total_hours = 0.0

    # --- 1. Genehmigte Schichten (Shift) ---
    # Filtert nach Variante (oder Hauptplan wenn variant_id None ist)
    shifts_in_this_month = Shift.query.options(joinedload(Shift.shift_type)).filter(
        Shift.user_id == user_id,
        extract('year', Shift.date) == year,
        extract('month', Shift.date) == month,
        Shift.variant_id == variant_id
    ).all()

    for shift in shifts_in_this_month:
        if shift.shift_type and shift.shift_type.is_work_shift:
            try:
                total_hours += float(shift.shift_type.hours or 0.0)
                # Übertrag abziehen am Monatsende
                if shift.date == last_day_of_current_month and (shift.shift_type.hours_spillover or 0.0) > 0:
                    total_hours -= float(shift.shift_type.hours_spillover or 0.0)
            except Exception:
                pass

    # --- Übertrag vom Vormonat (IMMER Hauptplan) ---
    shifts_on_last_day_prev_month = Shift.query.options(joinedload(Shift.shift_type)).filter(
        Shift.user_id == user_id,
        Shift.date == last_day_of_previous_month,
        Shift.variant_id == None  # Immer Hauptplan
    ).all()

    for shift in shifts_on_last_day_prev_month:
        if shift.shift_type and shift.shift_type.is_work_shift and (shift.shift_type.hours_spillover or 0.0) > 0:
            try:
                total_hours += float(shift.shift_type.hours_spillover or 0.0)
            except Exception:
                pass

    # --- 2. Offene Wunsch-Anfragen (ShiftQuery) ---
    # Anfragen sind global (nicht an Variante gebunden) -> gelten für alle.

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
    Berechnet die IST-Besetzung.
    (Logik bleibt gleich, da 'shifts_in_month_dicts' bereits vom Caller gefiltert wird)
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
        # --- NEU: Variant ID auslesen ---
        variant_id_raw = request.args.get('variant_id')
        variant_id = int(variant_id_raw) if variant_id_raw and variant_id_raw != 'null' else None
    except (TypeError, ValueError):
        return jsonify({"message": "Ungültige Parameter"}), 400

    # Sicherheitscheck: Nur Admins dürfen Varianten sehen
    if variant_id is not None:
        if not current_user.role or current_user.role.name != 'admin':
            return jsonify({"message": "Keine Berechtigung für Variantenansicht"}), 403

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

    # --- SCHICHTEN LADEN ---
    # 1. Aktueller Monat: Filtert nach variant_id (Entweder Hauptplan oder spezifische Variante)
    shifts_current_month = Shift.query.options(joinedload(Shift.shift_type)).filter(
        extract('year', Shift.date) == year,
        extract('month', Shift.date) == month,
        Shift.variant_id == variant_id
    ).all()

    # 2. Vormonat: Lädt IMMER den Hauptplan (variant_id=None) für Konsistenz
    shifts_prev_month = Shift.query.options(joinedload(Shift.shift_type)).filter(
        Shift.date == prev_month_end_date,
        Shift.variant_id == None
    ).all()

    shift_types = ShiftType.query.order_by(ShiftType.staffing_sort_order, ShiftType.abbreviation).all()
    st_map = {st.abbreviation: st for st in shift_types}

    shifts_data = [s.to_dict() for s in shifts_current_month]
    shifts_last_month_data = [s.to_dict() for s in shifts_prev_month]

    shifts_all_data = shifts_data + shifts_last_month_data
    users_data = [u.to_dict() for u in users]
    shifttypes_data = [st.to_dict() for st in shift_types]

    # Berechnungen
    totals_dict = {}
    for user in users:
        totals_dict[user.id] = _calculate_user_total_hours(user.id, year, month, st_map, variant_id)

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
        "plan_status": plan_status_data,
        "current_variant_id": variant_id  # Zur Bestätigung im Frontend
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


@shifts_bp.route('/shifts/toggle_lock', methods=['POST'])
@admin_required
def toggle_shift_lock():
    """
    Schaltet den 'is_locked' Status einer Schichtzelle um.
    Unterstützt Varianten.
    """
    data = request.get_json()
    if not data: return jsonify({"message": "Keine Daten gesendet."}), 400

    try:
        user_id = int(data.get('user_id'))
        shift_date = _parse_date_from_payload(data)
        # Variant ID
        variant_id_raw = data.get('variant_id')
        variant_id = int(variant_id_raw) if variant_id_raw and variant_id_raw != 'null' else None
    except (TypeError, ValueError):
        return jsonify({"message": "Ungültige Parameter."}), 400

    # Globale Plansperre prüfen (Gilt nur für Hauptplan)
    if variant_id is None:
        status_obj = ShiftPlanStatus.query.filter_by(year=shift_date.year, month=shift_date.month).first()
        if status_obj and status_obj.is_locked:
            return jsonify({"message": "Plan ist global gesperrt."}), 403

    try:
        # Schicht suchen (unter Berücksichtigung der Variante)
        shift = Shift.query.filter_by(
            user_id=user_id,
            date=shift_date,
            variant_id=variant_id
        ).first()

        if shift:
            shift.is_locked = not shift.is_locked
            # Aufräumen wenn leer und entsperrt
            if shift.shifttype_id is None and not shift.is_locked:
                db.session.delete(shift)
                was_deleted = True
            else:
                was_deleted = False
        else:
            # Neue leere, gesperrte Schicht
            shift = Shift(
                user_id=user_id,
                date=shift_date,
                shifttype_id=None,
                is_locked=True,
                variant_id=variant_id
            )
            db.session.add(shift)
            was_deleted = False

        db.session.commit()

        if was_deleted:
            return jsonify({"deleted": True, "user_id": user_id, "date": shift_date.isoformat()}), 200
        else:
            return jsonify(shift.to_dict()), 200

    except Exception as e:
        db.session.rollback()
        return jsonify({"message": f"DB Fehler: {str(e)}"}), 500


@shifts_bp.route('/shifts/clear', methods=['DELETE'])
@admin_required
def clear_shift_plan():
    """
    Löscht Schichten einer Variante oder des Hauptplans.
    Behält einzeln gesperrte Schichten.
    """
    data = request.get_json() or {}
    try:
        year = int(data.get('year'))
        month = int(data.get('month'))
        variant_id_raw = data.get('variant_id')
        variant_id = int(variant_id_raw) if variant_id_raw and variant_id_raw != 'null' else None
    except (TypeError, ValueError):
        return jsonify({"message": "Parameter fehlen."}), 400

    # Globale Sperre nur bei Hauptplan
    if variant_id is None:
        status_obj = ShiftPlanStatus.query.filter_by(year=year, month=month).first()
        if status_obj and status_obj.is_locked:
            return jsonify({"message": "Hauptplan ist gesperrt."}), 403

    try:
        # Löschen (mit variant_id Filter)
        num_deleted = Shift.query.filter(
            extract('year', Shift.date) == year,
            extract('month', Shift.date) == month,
            Shift.is_locked == False,
            Shift.variant_id == variant_id
        ).delete(synchronize_session=False)

        if num_deleted > 0:
            db.session.commit()
            return jsonify({"message": f"Plan erfolgreich geleert. {num_deleted} Schichten gelöscht."}), 200
        else:
            return jsonify({"message": "Keine löschbaren Schichten gefunden."}), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler beim Leeren: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


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

        variant_id_raw = data.get('variant_id')
        variant_id = int(variant_id_raw) if variant_id_raw and variant_id_raw != 'null' else None
    except (TypeError, ValueError) as e:
        return jsonify({"message": f"Ungültige Daten: {str(e)}"}), 400

    # Sperrprüfung nur für Hauptplan
    if variant_id is None:
        status_obj = ShiftPlanStatus.query.filter_by(year=shift_date.year, month=shift_date.month).first()
        if status_obj and status_obj.is_locked:
            return jsonify({"message": f"Aktion blockiert: Plan gesperrt."}), 403

    free_type = ShiftType.query.filter_by(abbreviation='FREI').first()
    is_free = (shifttype_id is None) or (free_type and shifttype_id == free_type.id) or (shifttype_id == 0)

    action_taken, saved_shift_id = None, None
    status_code = 200

    try:
        # Suche nach existierender Schicht in dieser Variante
        existing_shift = Shift.query.filter_by(
            user_id=user_id,
            date=shift_date,
            variant_id=variant_id
        ).first()

        if existing_shift and existing_shift.is_locked:
            return jsonify({"message": "Schicht ist gesperrt. Bitte entsperren."}), 403

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
            new_shift = Shift(
                user_id=user_id,
                shifttype_id=shifttype_id,
                date=shift_date,
                variant_id=variant_id
            )
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

    # Totals berechnen (mit Variante)
    response_data['new_total_hours'] = _calculate_user_total_hours(user_id, shift_date.year, shift_date.month,
                                                                   variant_id=variant_id)

    # Violations und Staffing (brauchen auch variant_id im Kontext, aber hier nutzen wir
    # für die Berechnung die Daten aus dem aktuellen Kontext.
    # Um Performance zu sparen, laden wir hier NICHT den ganzen Monat neu,
    # sondern verlassen uns darauf, dass das Frontend bei Bedarf neu lädt oder
    # wir implementieren die Violation-Checks später varianten-aware.
    # Für den Moment laden wir die Daten neu, aber gefiltert nach Variante.)

    # ... (Code für Violation/Staffing Calc hier vereinfacht, um Monolith zu vermeiden.
    # ViolationManager müsste eigentlich auch variant_id können, aber er arbeitet auf Listen.
    # Wir laden hier die Shifts der Variante für die Berechnung.)

    month_start = date(shift_date.year, shift_date.month, 1)
    month_end = date(shift_date.year, shift_date.month, calendar.monthrange(shift_date.year, shift_date.month)[1])
    day_before = month_start - timedelta(days=1)
    day_after = month_end + timedelta(days=1)

    shifts_for_calc_all = Shift.query.options(joinedload(Shift.shift_type)).filter(
        Shift.date.between(day_before, day_after),
        Shift.variant_id == variant_id  # Nur Schichten dieser Variante
    ).all()

    relevant_user_ids = {s.user_id for s in shifts_for_calc_all}
    if user_id not in relevant_user_ids: relevant_user_ids.add(user_id)  # Aktuellen User immer dazu

    users = User.query.filter(User.id.in_(relevant_user_ids)).all()
    shift_types = ShiftType.query.all()

    shifts_all_data = [s.to_dict() for s in shifts_for_calc_all]
    users_data = [u.to_dict() for u in users]
    shifttypes_data = [st.to_dict() for st in shift_types]

    violation_manager = ViolationManager(shifttypes_data)
    # Beachte: Violation Manager braucht Vormonat. Da wir nur Shifts der Variante laden,
    # fehlt ggf. der Vormonat (wenn Variante leer begann).
    # Das ist akzeptabel für Varianten-Entwürfe oder wir müssten Vormonat (Main) dazu laden.
    # Hier laden wir Vormonat (Main) dazu:
    prev_month_shifts = Shift.query.options(joinedload(Shift.shift_type)).filter(
        Shift.date == day_before,
        Shift.variant_id == None
    ).all()
    shifts_all_data.extend([s.to_dict() for s in prev_month_shifts])

    response_data['violations'] = list(
        violation_manager.calculate_all_violations(shift_date.year, shift_date.month, shifts_all_data, users_data))

    # Staffing
    shifts_data_for_staffing = [s.to_dict() for s in shifts_for_calc_all if month_start <= s.date <= month_end]

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
    # Status gilt weiterhin nur für den Hauptplan (variant_id spielt hier keine Rolle)
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

        db.session.commit()
        return jsonify(status_obj.to_dict()), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"message": f"Fehler: {str(e)}"}), 500


@shifts_bp.route('/shifts/send_completion_notification', methods=['POST'])
@admin_required
def send_completion_notification():
    # Rundmail nur für Hauptplan-Fertigstellung sinnvoll
    data = request.get_json() or {}
    try:
        year = int(data.get('year'))
        month = int(data.get('month'))
    except (TypeError, ValueError):
        return jsonify({"message": "Jahr und Monat erforderlich."}), 400

    status_obj = ShiftPlanStatus.query.filter_by(year=year, month=month).first()
    if not status_obj:
        return jsonify({"message": "Planstatus nicht gefunden."}), 404

    if status_obj.status != "Fertiggestellt" or not status_obj.is_locked:
        return jsonify({"message": "Plan muss 'Fertiggestellt' und 'Gesperrt' sein."}), 400

    try:
        users = User.query.filter(User.email != None, User.email != "").all()
        if not users:
            return jsonify({"message": "Keine Benutzer mit E-Mail-Adresse gefunden."}), 404

        count = 0
        for user in users:
            context = {
                "vorname": user.vorname,
                "name": user.name,
                "monat": f"{month:02d}",
                "jahr": str(year)
            }
            send_template_email(
                template_key="plan_completed",
                recipient_email=user.email,
                context=context
            )
            count += 1

        db.session.commit()
        return jsonify({"message": f"Benachrichtigung wurde an {count} Benutzer versendet."}), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler bei Rundmail: {str(e)}")
        return jsonify({"message": f"Fehler beim Senden: {str(e)}"}), 500