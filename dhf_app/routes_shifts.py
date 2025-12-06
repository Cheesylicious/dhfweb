from flask import Blueprint, request, jsonify, current_app
from .models import Shift, ShiftType, User, ShiftPlanStatus, UpdateLog, ShiftQuery, SpecialDate
from .extensions import db
from .utils import admin_required
from flask_login import login_required, current_user
from sqlalchemy import extract, func, or_, and_
from sqlalchemy.orm import joinedload
from datetime import datetime, timedelta, date, time
from .violation_manager import ViolationManager
import calendar
from collections import defaultdict
from .email_service import send_template_email

# --- Import für Bildgenerierung ---
from .plan_renderer import generate_roster_image_bytes

# ----------------------------------

shifts_bp = Blueprint('shifts', __name__, url_prefix='/api')


def _log_update_event(area, description):
    new_log = UpdateLog(area=area, description=description, updated_at=datetime.utcnow())
    db.session.add(new_log)


def _calculate_user_total_hours(user_id, year, month, shift_types_map=None, variant_id=None):
    try:
        days_in_month = calendar.monthrange(year, month)[1]
        last_day_of_current_month = date(year, month, days_in_month)
        first_day_of_current_month = date(year, month, 1)
        last_day_of_previous_month = first_day_of_current_month - timedelta(days=1)
    except ValueError:
        return 0.0

    if shift_types_map is None:
        all_types = ShiftType.query.all()
        shift_types_map = {st.abbreviation: st for st in all_types}

    total_hours = 0.0

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
                if shift.date == last_day_of_current_month and (shift.shift_type.hours_spillover or 0.0) > 0:
                    total_hours -= float(shift.shift_type.hours_spillover or 0.0)
            except Exception:
                pass

    shifts_on_last_day_prev_month = Shift.query.options(joinedload(Shift.shift_type)).filter(
        Shift.user_id == user_id,
        Shift.date == last_day_of_previous_month,
        Shift.variant_id == None
    ).all()

    for shift in shifts_on_last_day_prev_month:
        if shift.shift_type and shift.shift_type.is_work_shift and (shift.shift_type.hours_spillover or 0.0) > 0:
            try:
                total_hours += float(shift.shift_type.hours_spillover or 0.0)
            except Exception:
                pass

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
                        if q.shift_date == last_day_of_current_month and (st.hours_spillover or 0.0) > 0:
                            total_hours -= float(st.hours_spillover or 0.0)
                    except Exception:
                        pass

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
    days_in_month = calendar.monthrange(year, month)[1]
    relevant_shifttype_ids = set()
    abbr_to_id_map = {}

    for st in shifttypes_dicts:
        abbr_to_id_map[st['abbreviation']] = st['id']
        if (st.get('min_staff_mo', 0) > 0 or st.get('min_staff_di', 0) > 0 or st.get('min_staff_mi', 0) > 0 or
                st.get('min_staff_do', 0) > 0 or st.get('min_staff_fr', 0) > 0 or st.get('min_staff_sa', 0) > 0 or
                st.get('min_staff_so', 0) > 0 or st.get('min_staff_holiday', 0) > 0):
            relevant_shifttype_ids.add(st['id'])

    if not relevant_shifttype_ids:
        return {}

    staffing_actual = defaultdict(lambda: defaultdict(int))

    for s_dict in shifts_in_month_dicts:
        shifttype_id = s_dict.get('shifttype_id')
        if shifttype_id in relevant_shifttype_ids:
            try:
                date_str = s_dict.get('date')
                if not date_str: continue
                try:
                    day_of_month = datetime.fromisoformat(date_str).day
                except:
                    day_of_month = int(date_str.split('-')[2])
                staffing_actual[shifttype_id][day_of_month] += 1
            except:
                pass

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
                        except:
                            day_of_month = int(date_str.split('-')[2])
                        staffing_actual[st_id][day_of_month] += 1
            except:
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
        variant_id_raw = request.args.get('variant_id')
        variant_id = int(variant_id_raw) if variant_id_raw and variant_id_raw != 'null' else None
    except (TypeError, ValueError):
        return jsonify({"message": "Ungültige Parameter"}), 400

    if variant_id is not None:
        if not current_user.role or current_user.role.name != 'admin':
            return jsonify({"message": "Keine Berechtigung für Variantenansicht"}), 403

    current_month_start_date = date(year, month, 1)
    days_in_month = calendar.monthrange(year, month)[1]
    current_month_end_date = date(year, month, days_in_month)
    prev_month_end_date = current_month_start_date - timedelta(days=1)

    users_query = User.query.filter(
        User.shift_plan_visible == True,
        or_(User.aktiv_ab_datum.is_(None), User.aktiv_ab_datum <= current_month_end_date)
    )
    all_users_pre_filter = users_query.order_by(User.shift_plan_sort_order, User.name).all()

    users = []
    for user in all_users_pre_filter:
        if user.inaktiv_ab_datum is None or user.inaktiv_ab_datum > prev_month_end_date:
            users.append(user)

    shifts_current_month = Shift.query.options(joinedload(Shift.shift_type)).filter(
        extract('year', Shift.date) == year,
        extract('month', Shift.date) == month,
        Shift.variant_id == variant_id
    ).all()

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
        "current_variant_id": variant_id
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
        except:
            pass
    raise ValueError('Ungültiges Datum')


@shifts_bp.route('/shifts/toggle_lock', methods=['POST'])
@admin_required
def toggle_shift_lock():
    data = request.get_json()
    if not data: return jsonify({"message": "Keine Daten."}), 400

    try:
        user_id = int(data.get('user_id'))
        shift_date = _parse_date_from_payload(data)
        variant_id_raw = data.get('variant_id')
        variant_id = int(variant_id_raw) if variant_id_raw and variant_id_raw != 'null' else None
    except:
        return jsonify({"message": "Ungültige Parameter."}), 400

    if variant_id is None:
        status_obj = ShiftPlanStatus.query.filter_by(year=shift_date.year, month=shift_date.month).first()
        if status_obj and status_obj.is_locked:
            return jsonify({"message": "Plan ist gesperrt."}), 403

    try:
        shift = Shift.query.filter_by(user_id=user_id, date=shift_date, variant_id=variant_id).first()
        if shift:
            shift.is_locked = not shift.is_locked
            if shift.shifttype_id is None and not shift.is_locked:
                db.session.delete(shift)
                was_deleted = True
            else:
                was_deleted = False
        else:
            shift = Shift(user_id=user_id, date=shift_date, shifttype_id=None, is_locked=True, variant_id=variant_id)
            db.session.add(shift)
            was_deleted = False

        db.session.commit()
        if was_deleted:
            return jsonify({"deleted": True, "user_id": user_id, "date": shift_date.isoformat()}), 200
        else:
            return jsonify(shift.to_dict()), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"message": str(e)}), 500


@shifts_bp.route('/shifts/clear', methods=['DELETE'])
@admin_required
def clear_shift_plan():
    data = request.get_json() or {}
    try:
        year = int(data.get('year'))
        month = int(data.get('month'))
        variant_id_raw = data.get('variant_id')
        variant_id = int(variant_id_raw) if variant_id_raw and variant_id_raw != 'null' else None
    except:
        return jsonify({"message": "Parameter fehlen."}), 400

    if variant_id is None:
        status_obj = ShiftPlanStatus.query.filter_by(year=year, month=month).first()
        if status_obj and status_obj.is_locked:
            return jsonify({"message": "Hauptplan ist gesperrt."}), 403

    try:
        num_deleted = Shift.query.filter(
            extract('year', Shift.date) == year,
            extract('month', Shift.date) == month,
            Shift.is_locked == False,
            Shift.variant_id == variant_id
        ).delete(synchronize_session=False)

        if num_deleted > 0:
            db.session.commit()
            return jsonify({"message": f"Plan geleert. {num_deleted} Schichten gelöscht."}), 200
        else:
            return jsonify({"message": "Keine löschbaren Schichten."}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"message": str(e)}), 500


@shifts_bp.route('/shifts', methods=['POST'])
@admin_required
def save_shift():
    data = request.get_json(silent=True)
    if not data: return jsonify({"message": "Leere Nutzlast"}), 400

    try:
        user_id = int(data.get('user_id') or data.get('userId'))
        raw_st = data.get('shifttype_id') or data.get('shifttypeId')
        shifttype_id = int(raw_st) if raw_st not in (None, '', 'null') else None
        shift_date = _parse_date_from_payload(data)
        variant_id_raw = data.get('variant_id')
        variant_id = int(variant_id_raw) if variant_id_raw and variant_id_raw != 'null' else None
    except Exception as e:
        return jsonify({"message": str(e)}), 400

    if variant_id is None:
        status_obj = ShiftPlanStatus.query.filter_by(year=shift_date.year, month=shift_date.month).first()
        if status_obj and status_obj.is_locked:
            return jsonify({"message": "Plan gesperrt."}), 403

    free_type = ShiftType.query.filter_by(abbreviation='FREI').first()
    is_free = (shifttype_id is None) or (free_type and shifttype_id == free_type.id) or (shifttype_id == 0)

    try:
        existing_shift = Shift.query.filter_by(user_id=user_id, date=shift_date, variant_id=variant_id).first()
        if existing_shift and existing_shift.is_locked:
            return jsonify({"message": "Schicht gesperrt."}), 403

        saved_shift_id = None
        if existing_shift:
            saved_shift_id = existing_shift.id
            if is_free:
                db.session.delete(existing_shift)
            else:
                existing_shift.shifttype_id = shifttype_id
                db.session.add(existing_shift)
        elif not is_free:
            new_shift = Shift(user_id=user_id, shifttype_id=shifttype_id, date=shift_date, variant_id=variant_id)
            db.session.add(new_shift)
            db.session.flush()
            saved_shift_id = new_shift.id

        db.session.commit()

        response_data = {}
        if saved_shift_id:
            reloaded = Shift.query.options(joinedload(Shift.shift_type)).get(saved_shift_id)
            response_data = reloaded.to_dict() if reloaded else {}
        else:
            response_data = {"message": "Gelöscht"}

        response_data['new_total_hours'] = _calculate_user_total_hours(user_id, shift_date.year, shift_date.month,
                                                                       variant_id=variant_id)

        return jsonify(response_data), 200 if saved_shift_id else 200

    except Exception as e:
        db.session.rollback()
        return jsonify({"message": str(e)}), 500


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
        db.session.commit()
        return jsonify(status_obj.to_dict()), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"message": str(e)}), 500


# --- HILFSFUNKTIONEN FÜR RUNDMAIL ---
def get_short_weekday(year, month, day):
    d = date(year, month, day)
    days = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
    return days[d.weekday()]


@shifts_bp.route('/shifts/send_completion_notification', methods=['POST'])
@admin_required
def send_completion_notification():
    """
    Sendet eine Rundmail an alle User.
    Generiert ein MATRIX-Bild des Dienstplans (genau wie im Web),
    filtert inaktive User und zeigt Feiertage/Wochenenden korrekt an.
    """
    data = request.get_json() or {}
    try:
        year = int(data.get('year'))
        month = int(data.get('month'))
    except (TypeError, ValueError):
        return jsonify({"message": "Jahr und Monat erforderlich."}), 400

    status_obj = ShiftPlanStatus.query.filter_by(year=year, month=month).first()
    if not status_obj:
        return jsonify({"message": "Planstatus nicht gefunden."}), 404

    # Optional: Prüfen ob Plan "fertig" ist (deaktiviert für Testzwecke)
    # if status_obj.status != "Fertiggestellt" or not status_obj.is_locked:
    #    return jsonify({"message": "Plan muss 'Fertiggestellt' und 'Gesperrt' sein."}), 400

    try:
        users_with_email = User.query.filter(User.email != None, User.email != "").all()
        if not users_with_email:
            return jsonify({"message": "Keine Benutzer mit E-Mail-Adresse gefunden."}), 404

        print(f"Generiere Matrix-Bild für {month}/{year}...")

        # --- DATEN VORBEREITEN (MATRIX STRUKTUR) ---

        days_in_month = calendar.monthrange(year, month)[1]
        days_header = []

        # 1. Feiertage & Sondertermine laden
        special_dates = SpecialDate.query.filter(
            extract('year', SpecialDate.date) == year,
            extract('month', SpecialDate.date) == month
        ).all()
        # Map: Day -> Event Type (holiday, training, shooting, dpo)
        special_dates_map = {sd.date.day: sd.type for sd in special_dates}

        # Header aufbauen
        for day in range(1, days_in_month + 1):
            is_weekend = date(year, month, day).weekday() >= 5
            evt_type = special_dates_map.get(day)

            days_header.append({
                'day_num': day,
                'weekday': get_short_weekday(year, month, day),
                'is_weekend': is_weekend,
                'event_type': evt_type
            })

        # 2. Filter für aktive Benutzer (genau wie im Web-Frontend)
        # Sichtbar == True UND (Aktiv ab <= Monatsende ODER None) UND (Inaktiv ab > Monatsanfang ODER None)
        current_month_end_date = date(year, month, days_in_month)
        prev_month_end_date = date(year, month, 1) - timedelta(days=1)

        users_query = User.query.filter(
            User.shift_plan_visible == True,
            or_(User.aktiv_ab_datum.is_(None), User.aktiv_ab_datum <= current_month_end_date)
        ).order_by(User.shift_plan_sort_order, User.name)

        all_visible_users = []
        for u in users_query.all():
            # Inaktivitäts-Prüfung
            # Zeige User an, wenn er NICHT inaktiv ist, ODER erst nach dem Vormonatsende inaktiv wird
            if u.inaktiv_ab_datum is None or u.inaktiv_ab_datum > prev_month_end_date:
                all_visible_users.append(u)

        # 3. Schichten laden
        shifts_db = Shift.query.options(joinedload(Shift.shift_type)).filter(
            extract('year', Shift.date) == year,
            extract('month', Shift.date) == month,
            Shift.variant_id == None
        ).all()

        # Map: (user_id, day) -> Shift Info
        shift_map = {}
        for s in shifts_db:
            if s.shift_type:
                day = s.date.day
                shift_map[(s.user_id, day)] = {
                    'abbr': s.shift_type.abbreviation,
                    'color': s.shift_type.color,
                    'is_dark': False,  # Textfarbe
                    'bg_priority': s.shift_type.prioritize_background
                }

        # 4. Matrix Rows bauen
        matrix_rows = []
        for u in all_visible_users:
            row_data = {
                'name': f"{u.vorname} {u.name}",
                'dog': u.diensthund or '',
                'cells': []
            }

            for day in range(1, days_in_month + 1):
                cell_data = shift_map.get((u.id, day))
                if cell_data:
                    row_data['cells'].append(cell_data)
                else:
                    # Leere Zelle (wird im Template dann eingefärbt)
                    row_data['cells'].append({'abbr': '', 'color': 'transparent'})

            matrix_rows.append(row_data)

        # Daten-Paket für Renderer
        render_data = {
            'year': year,
            'month_name': date(year, month, 1).strftime('%B'),
            'days_header': days_header,
            'rows': matrix_rows
        }

        # 5. Bild generieren (JPG)
        image_bytes = generate_roster_image_bytes(render_data, year, month)

        # --- E-MAIL VERSAND ---
        attachments = []
        if image_bytes:
            attachments.append({
                'filename': f"Dienstplan_{year}_{month:02d}.jpg",
                'content_type': 'image/jpeg',
                'data': image_bytes
            })
            print("Bild erfolgreich generiert und angehängt.")
        else:
            print("Warnung: Bildgenerierung fehlgeschlagen.")

        count = 0
        for user in users_with_email:
            context = {
                "vorname": user.vorname,
                "name": user.name,
                "monat": f"{month:02d}",
                "jahr": str(year)
            }
            send_template_email(
                template_key="plan_completed",
                recipient_email=user.email,
                context=context,
                attachments=attachments
            )
            count += 1

        db.session.commit()
        return jsonify({"message": f"Benachrichtigung an {count} Benutzer versendet."}), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler bei Rundmail: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({"message": f"Fehler beim Senden: {str(e)}"}), 500