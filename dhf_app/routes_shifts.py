# dhf_app/routes_shifts.py

from flask import Blueprint, request, jsonify, current_app
from .models import Shift, ShiftType, User, ShiftPlanStatus, UpdateLog, ShiftQuery, SpecialDate, Role
from .extensions import db, socketio
from .utils import admin_required
from .models_audit import log_audit
from flask_login import login_required, current_user
from sqlalchemy import extract, func, or_, and_
from sqlalchemy.orm import joinedload
from datetime import datetime, timedelta, date, time
from .violation_manager import ViolationManager
import calendar
from collections import defaultdict
from .email_service import send_template_email
import threading

# --- Import für Bildgenerierung ---
from .plan_renderer import generate_roster_image_bytes

# --- Import der zentralen Logik (Regel 4: Vermeidung von Monolithen) ---
from .roster_logic import (
    calculate_user_total_hours,
    calculate_actual_staffing,
    prepare_roster_render_data
)

shifts_bp = Blueprint('shifts', __name__, url_prefix='/api')


def _log_update_event(area, description):
    new_log = UpdateLog(area=area, description=description, updated_at=datetime.utcnow())
    db.session.add(new_log)


# --- Hilfsfunktionen für Fälligkeiten ---

def get_quarter_dates(year, month):
    """
    Gibt Start- und Enddatum des Quartals zurück, in dem der angegebene Monat liegt.
    """
    q = (month - 1) // 3 + 1
    s_date = date(year, (q - 1) * 3 + 1, 1)
    e_date = date(year, q * 3, calendar.monthrange(year, q * 3)[1])
    return s_date, e_date


def get_latest_shift_date(user_id, abbreviation, limit_date):
    """
    Sucht das Datum der letzten Schicht eines bestimmten Typs (QA/S) vor oder am limit_date.
    """
    last = Shift.query.join(ShiftType).filter(
        Shift.user_id == user_id,
        ShiftType.abbreviation == abbreviation,
        Shift.date <= limit_date
    ).order_by(Shift.date.desc()).first()
    return last.date if last else None


def calculate_training_warnings(users, shifts_current_month, year, month):
    """
    Prüft Fälligkeiten (QA/Schießen) basierend auf DB-Einträgen UND geplanten Schichten.
    """
    warnings = []
    plan_end = date(year, month, calendar.monthrange(year, month)[1])
    q_start, q_end = get_quarter_dates(year, month)
    existing = {(s.user_id, s.shift_type.abbreviation) for s in shifts_current_month if s.shift_type}

    for user in users:
        is_hf = (user.role and user.role.name == 'Hundeführer') or user.is_manual_dog_handler
        if not is_hf or user.is_hidden_dog_handler:
            continue

        # QA Check
        l_qa = get_latest_shift_date(user.id, 'QA', plan_end)
        l_qa = max(l_qa, user.last_training_qa) if (l_qa and user.last_training_qa) else (l_qa or user.last_training_qa)
        if not (l_qa and q_start <= l_qa <= q_end) and (user.id, 'QA') not in existing:
            warnings.append({
                "user_id": user.id,
                "name": f"{user.vorname} {user.name}",
                "type": "QA",
                "due_date": q_end.strftime('%d.%m.%Y'),
                "status": "Fällig",
                "message": "QA fällig"
            })

        # Schießen Check
        l_s = get_latest_shift_date(user.id, 'S', plan_end)
        l_s = max(l_s, user.last_training_shooting) if (l_s and user.last_training_shooting) else (
                    l_s or user.last_training_shooting)
        s_due = (l_s + timedelta(days=90)) if l_s else date(year, month, 1)
        if s_due <= plan_end and (user.id, 'S') not in existing:
            warnings.append({
                "user_id": user.id,
                "name": f"{user.vorname} {user.name}",
                "type": "S",
                "due_date": s_due.strftime('%d.%m.%Y'),
                "status": "Fällig",
                "message": "Schießen fällig"
            })
    return warnings


@shifts_bp.route('/shifts', methods=['GET'])
@login_required
def get_shifts():
    try:
        year, month = int(request.args.get('year')), int(request.args.get('month'))
        v_id = request.args.get('variant_id')
        variant_id = int(v_id) if v_id and v_id != 'null' else None
    except:
        return jsonify({"message": "Parameterfehler"}), 400

    current_month_end = date(year, month, calendar.monthrange(year, month)[1])
    prev_month_end = date(year, month, 1) - timedelta(days=1)

    users_q = User.query.options(joinedload(User.role)).filter(
        User.shift_plan_visible == True
    ).order_by(User.shift_plan_sort_order, User.name)

    users = [u for u in users_q.all() if u.inaktiv_ab_datum is None or u.inaktiv_ab_datum > prev_month_end]

    shifts_curr = Shift.query.options(joinedload(Shift.shift_type)).filter(
        extract('year', Shift.date) == year,
        extract('month', Shift.date) == month,
        Shift.variant_id == variant_id
    ).all()

    shifts_prev = Shift.query.filter(Shift.date == prev_month_end, Shift.variant_id == None).all()

    st_types = ShiftType.query.all()
    st_map = {st.abbreviation: st for st in st_types}

    # Nutzt zentrale Logik zur Berechnung der Gesamtstunden
    totals = {u.id: calculate_user_total_hours(u.id, year, month, st_map, variant_id) for u in users}

    # Violations berechnen
    vm = ViolationManager([st.to_dict() for st in st_types])
    violations = list(vm.calculate_all_violations(year, month, [s.to_dict() for s in shifts_curr + shifts_prev],
                                                  [u.to_dict() for u in users]))

    # Staffing (Soll/Ist) berechnen
    queries = ShiftQuery.query.filter(
        extract('year', ShiftQuery.shift_date) == year,
        extract('month', ShiftQuery.shift_date) == month,
        ShiftQuery.status == 'offen'
    ).all()
    staffing = calculate_actual_staffing([s.to_dict() for s in shifts_curr], [q.to_dict() for q in queries],
                                         [st.to_dict() for st in st_types], year, month)

    status_obj = ShiftPlanStatus.query.filter_by(year=year, month=month).first()

    return jsonify({
        "shifts": [s.to_dict() for s in shifts_curr],
        "users": [u.to_dict() for u in users],
        "totals": totals,
        "violations": violations,
        "staffing_actual": staffing,
        "plan_status": status_obj.to_dict() if status_obj else {"status": "In Bearbeitung"},
        "training_warnings": calculate_training_warnings(users, shifts_curr, year, month) if (
                    current_user.role and current_user.role.name == 'admin') else []
    }), 200


def _parse_date_from_payload(data):
    d_str = data.get('date')
    try:
        return datetime.fromisoformat(d_str).date()
    except:
        for fmt in ('%Y-%m-%d', '%d.%m.%Y'):
            try:
                return datetime.strptime(d_str, fmt).date()
            except:
                continue
    raise ValueError('Datum ungültig')


@shifts_bp.route('/shifts/toggle_lock', methods=['POST'])
@admin_required
def toggle_shift_lock():
    data = request.get_json()
    try:
        user_id = int(data.get('user_id'))
        shift_date = _parse_date_from_payload(data)
        v_id = data.get('variant_id')
        variant_id = int(v_id) if v_id and v_id != 'null' else None

        shift = Shift.query.filter_by(user_id=user_id, date=shift_date, variant_id=variant_id).first()
        old_status = "Gesperrt" if shift and shift.is_locked else "Offen"

        if shift:
            shift.is_locked = not shift.is_locked
            if shift.shifttype_id is None and not shift.is_locked:
                db.session.delete(shift)
                was_del = True
            else:
                was_del = False
        else:
            shift = Shift(user_id=user_id, date=shift_date, shifttype_id=None, is_locked=True, variant_id=variant_id)
            db.session.add(shift)
            was_del = False

        db.session.commit()

        log_audit(action="SHIFT_LOCK_TOGGLE",
                  details={"old": old_status, "new": "Gesperrt" if not was_del and shift.is_locked else "Offen"},
                  target_date=shift_date, user=current_user)

        res = {"deleted": was_del, "user_id": user_id, "date": shift_date.isoformat(), "variant_id": variant_id}
        if not was_del:
            res.update(shift.to_dict())

        socketio.emit('shift_lock_update', res)
        return jsonify(res), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"message": str(e)}), 500


@shifts_bp.route('/shifts', methods=['POST'])
@admin_required
def save_shift():
    data = request.get_json(silent=True)
    try:
        user_id = int(data.get('user_id') or data.get('userId'))
        st_id_raw = data.get('shifttype_id') or data.get('shifttypeId')
        shifttype_id = int(st_id_raw) if st_id_raw not in (None, '', 'null') else None
        shift_date = _parse_date_from_payload(data)
        v_id = data.get('variant_id')
        variant_id = int(v_id) if v_id and v_id != 'null' else None

        existing = Shift.query.filter_by(user_id=user_id, date=shift_date, variant_id=variant_id).first()
        if existing and existing.is_locked:
            return jsonify({"message": "Zelle ist gesperrt."}), 403

        # Typ "FREI" identifizieren
        free_type = ShiftType.query.filter_by(abbreviation='FREI').first()
        is_free_request = (shifttype_id is None) or (free_type and shifttype_id == free_type.id)

        old_abbr = "LEER"
        if existing and existing.shifttype_id:
            st_old = ShiftType.query.get(existing.shifttype_id)
            if st_old: old_abbr = st_old.abbreviation

        saved_id = None
        if is_free_request:
            # Schicht löschen, wenn "FREI" gewählt wurde oder Typ leer ist
            if existing:
                db.session.delete(existing)
        else:
            # Schicht anlegen oder aktualisieren
            if existing:
                existing.shifttype_id = shifttype_id
                saved_id = existing.id
            else:
                new_s = Shift(user_id=user_id, shifttype_id=shifttype_id, date=shift_date, variant_id=variant_id)
                db.session.add(new_s)
                db.session.flush()
                saved_id = new_s.id

        db.session.commit()

        # Audit Log
        new_abbr = "LEER"
        if not is_free_request and shifttype_id:
            st_new = ShiftType.query.get(shifttype_id)
            if st_new: new_abbr = st_new.abbreviation

        if old_abbr != new_abbr:
            t_user = User.query.get(user_id)
            log_audit(action="SHIFT_UPDATE",
                      details={"old": old_abbr, "new": new_abbr, "target_user": f"{t_user.vorname} {t_user.name}"},
                      target_date=shift_date, user=current_user)

        # Vollständiger Response für das Frontend zur sofortigen Aktualisierung
        if saved_id:
            res = Shift.query.options(joinedload(Shift.shift_type)).get(saved_id).to_dict()
            res['is_deleted'] = False
        else:
            res = {"message": "Gelöscht", "is_deleted": True, "user_id": user_id, "date": shift_date.isoformat()}

        # Neue Stunden und Violations berechnen
        res['new_total_hours'] = calculate_user_total_hours(user_id, shift_date.year, shift_date.month,
                                                            variant_id=variant_id)

        vm = ViolationManager([st.to_dict() for st in ShiftType.query.all()])
        users_check = User.query.filter(User.shift_plan_visible == True).all()
        shifts_curr = Shift.query.filter(extract('year', Shift.date) == shift_date.year,
                                         extract('month', Shift.date) == shift_date.month,
                                         Shift.variant_id == variant_id).all()
        res['violations'] = list(
            vm.calculate_all_violations(shift_date.year, shift_date.month, [s.to_dict() for s in shifts_curr],
                                        [u.to_dict() for u in users_check]))

        socketio.emit('shift_update', {
            'user_id': user_id,
            'date': shift_date.isoformat(),
            'shifttype_id': None if is_free_request else shifttype_id,
            'variant_id': variant_id,
            'data': res
        })

        return jsonify(res), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"message": str(e)}), 500


@shifts_bp.route('/shifts/status', methods=['PUT'])
@admin_required
def update_plan_status():
    data = request.get_json()
    try:
        year, month = int(data.get('year')), int(data.get('month'))
        status_obj = ShiftPlanStatus.query.filter_by(year=year, month=month).first()
        if not status_obj:
            status_obj = ShiftPlanStatus(year=year, month=month)
            db.session.add(status_obj)
        status_obj.status = data.get('status', status_obj.status)
        status_obj.is_locked = data.get('is_locked', status_obj.is_locked)
        db.session.commit()
        socketio.emit('plan_status_update', status_obj.to_dict())
        return jsonify(status_obj.to_dict()), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"message": str(e)}), 500


def _send_notification_task(app, user_email_map, render_data, year, month):
    with app.app_context():
        try:
            for user_id, info in user_email_map.items():
                rd = render_data.copy()
                rd['highlight_user_name'] = info['name']
                img = generate_roster_image_bytes(rd, year, month)
                if img:
                    send_template_email(
                        template_key="plan_completed",
                        recipient_email=info['email'],
                        context={"vorname": info['vorname'], "name": info['name'], "monat": f"{month:02d}",
                                 "jahr": str(year)},
                        attachments=[{'filename': f"Dienstplan_{year}_{month:02d}.jpg", 'content_type': 'image/jpeg',
                                      'data': img}]
                    )
            _log_update_event("Rundmail", f"Dienstplan {month}/{year} versendet.")
            db.session.commit()
        except Exception as e:
            current_app.logger.error(f"Mail-Task Fehler: {e}")


@shifts_bp.route('/shifts/send_completion_notification', methods=['POST'])
@admin_required
def send_completion_notification():
    """
    Startet den Rundmail-Versand mit optimierter Datenaufbereitung.
    """
    data = request.get_json() or {}
    try:
        year, month = int(data.get('year')), int(data.get('month'))
        render_data = prepare_roster_render_data(year, month)
        users = User.query.filter(User.email != None, User.email != "").all()
        user_email_map = {u.id: {'email': u.email, 'name': f"{u.vorname} {u.name}", 'vorname': u.vorname} for u in
                          users}

        app = current_app._get_current_object()
        threading.Thread(target=_send_notification_task, args=(app, user_email_map, render_data, year, month)).start()
        return jsonify({"message": "Versand gestartet"}), 200
    except Exception as e:
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
            log_audit(action="PLAN_CLEAR", details={"year": year, "month": month, "deleted_count": num_deleted},
                      user=current_user)
            socketio.emit('plan_cleared',
                          {'year': year, 'month': month, 'variant_id': variant_id, 'num_deleted': num_deleted})
            return jsonify({"message": f"Plan geleert. {num_deleted} Schichten gelöscht."}), 200
        return jsonify({"message": "Keine löschbaren Schichten."}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"message": str(e)}), 500