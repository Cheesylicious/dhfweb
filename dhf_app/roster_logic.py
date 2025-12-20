# dhf_app/roster_logic.py

import calendar
from datetime import date, timedelta
from sqlalchemy import extract, or_
from sqlalchemy.orm import joinedload
from .models import User, Shift, ShiftType, SpecialDate, ShiftQuery
from .extensions import db
from collections import defaultdict


def get_short_weekday(year, month, day):
    """Gibt den deutschen Wochentag zurück."""
    d = date(year, month, day)
    days = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
    return days[d.weekday()]


def calculate_user_total_hours(user_id, year, month, shift_types_map=None, variant_id=None):
    """
    Berechnet die Gesamtstunden eines Benutzers.
    Zentralisiert, um Monolithen zu vermeiden (Regel 4).
    """
    try:
        days_in_month = calendar.monthrange(year, month)[1]
        last_day_curr = date(year, month, days_in_month)
        first_day_curr = date(year, month, 1)
        last_day_prev = first_day_curr - timedelta(days=1)
    except ValueError:
        return 0.0

    if shift_types_map is None:
        all_types = ShiftType.query.all()
        shift_types_map = {st.abbreviation: st for st in all_types}

    total_hours = 0.0

    # 1. Schichten im aktuellen Monat
    shifts = Shift.query.options(joinedload(Shift.shift_type)).filter(
        Shift.user_id == user_id,
        extract('year', Shift.date) == year,
        extract('month', Shift.date) == month,
        Shift.variant_id == variant_id
    ).all()

    for s in shifts:
        if s.shift_type and s.shift_type.is_work_shift:
            total_hours += float(s.shift_type.hours or 0.0)
            if s.date == last_day_curr and (s.shift_type.hours_spillover or 0.0) > 0:
                total_hours -= float(s.shift_type.hours_spillover or 0.0)

    # 2. Spillover vom Vormonat
    prev_shifts = Shift.query.options(joinedload(Shift.shift_type)).filter(
        Shift.user_id == user_id,
        Shift.date == last_day_prev,
        Shift.variant_id == None
    ).all()

    for s in prev_shifts:
        if s.shift_type and s.shift_type.is_work_shift and (s.shift_type.hours_spillover or 0.0) > 0:
            total_hours += float(s.shift_type.hours_spillover or 0.0)

    # 3. Offene Anfragen
    queries = ShiftQuery.query.filter(
        ShiftQuery.sender_user_id == user_id,
        extract('year', ShiftQuery.shift_date) == year,
        extract('month', ShiftQuery.shift_date) == month,
        ShiftQuery.status == 'offen'
    ).all()

    for q in queries:
        if q.message.startswith("Anfrage für:"):
            try:
                abbr = q.message.split(":")[1].strip().replace('?', '')
                st = shift_types_map.get(abbr)
                if st and st.is_work_shift:
                    total_hours += float(st.hours or 0.0)
                    if q.shift_date == last_day_curr and (st.hours_spillover or 0.0) > 0:
                        total_hours -= float(st.hours_spillover or 0.0)
            except:
                pass

    return round(total_hours, 2)


def calculate_actual_staffing(shifts_data, queries_data, shifttypes_data, year, month):
    """Berechnet die Ist-Besetzung für das Staffing-Panel."""
    days_in_month = calendar.monthrange(year, month)[1]
    relevant_ids = set()
    abbr_to_id = {}

    for st in shifttypes_data:
        abbr_to_id[st['abbreviation']] = st['id']
        if any(st.get(k, 0) > 0 for k in
               ['min_staff_mo', 'min_staff_di', 'min_staff_mi', 'min_staff_do', 'min_staff_fr', 'min_staff_sa',
                'min_staff_so', 'min_staff_holiday']):
            relevant_ids.add(st['id'])

    staffing = defaultdict(lambda: defaultdict(int))
    for s in shifts_data:
        sid = s.get('shifttype_id')
        if sid in relevant_ids:
            day = int(s['date'].split('-')[2]) if '-' in s['date'] else 1
            staffing[sid][day] += 1

    for q in queries_data:
        if q.get('message', '').startswith("Anfrage für:"):
            try:
                abbr = q['message'].split(":")[1].strip().replace('?', '')
                sid = abbr_to_id.get(abbr)
                if sid in relevant_ids:
                    day = int(q['shift_date'].split('-')[2]) if '-' in q['shift_date'] else 1
                    staffing[sid][day] += 1
            except:
                pass

    return {sid: {d: staffing[sid].get(d, 0) for d in range(1, days_in_month + 1)} for sid in relevant_ids}


def prepare_roster_render_data(year, month, variant_id=None):
    """Bereitet alle Daten für das Vorschaubild/Rundmail vor."""
    days_in_month = calendar.monthrange(year, month)[1]

    special_dates = SpecialDate.query.filter(extract('year', SpecialDate.date) == year,
                                             extract('month', SpecialDate.date) == month).all()
    spec_map = {sd.date.day: sd.type for sd in special_dates}

    header = []
    for d in range(1, days_in_month + 1):
        header.append({
            'day_num': d,
            'weekday': get_short_weekday(year, month, d),
            'is_weekend': date(year, month, d).weekday() >= 5,
            'event_type': spec_map.get(d)
        })

    users_q = User.query.filter(User.shift_plan_visible == True).order_by(User.shift_plan_sort_order, User.name)
    visible_users = [u for u in users_q.all() if
                     (u.aktiv_ab_datum is None or u.aktiv_ab_datum <= date(year, month, days_in_month)) and (
                                 u.inaktiv_ab_datum is None or u.inaktiv_ab_datum > date(year, month, 1))]

    shifts_db = Shift.query.options(joinedload(Shift.shift_type)).filter(extract('year', Shift.date) == year,
                                                                         extract('month', Shift.date) == month,
                                                                         Shift.variant_id == variant_id).all()
    st_types = ShiftType.query.order_by(ShiftType.staffing_sort_order, ShiftType.abbreviation).all()
    st_map = {st.abbreviation: st for st in st_types}

    matrix = {}
    for s in shifts_db:
        if s.shift_type:
            matrix[(s.user_id, s.date.day)] = {'abbr': s.shift_type.abbreviation, 'color': s.shift_type.color,
                                               'bg_priority': s.shift_type.prioritize_background}

    rows = []
    for u in visible_users:
        total = calculate_user_total_hours(u.id, year, month, st_map, variant_id)
        cells = [matrix.get((u.id, d), {'abbr': '', 'color': 'transparent'}) for d in range(1, days_in_month + 1)]
        rows.append({'name': f"{u.vorname} {u.name}", 'dog': u.diensthund or '', 'total_hours': total, 'cells': cells})

    staffing_ist = calculate_actual_staffing([s.to_dict() for s in shifts_db], [], [st.to_dict() for st in st_types],
                                             year, month)
    staffing_rows = []
    days_keys = ['min_staff_mo', 'min_staff_di', 'min_staff_mi', 'min_staff_do', 'min_staff_fr', 'min_staff_sa',
                 'min_staff_so']

    for st in st_types:
        if any(getattr(st, k) > 0 for k in days_keys) or st.min_staff_holiday > 0:
            s_cells = []
            for d in range(1, days_in_month + 1):
                soll = st.min_staff_holiday if spec_map.get(d) == 'holiday' else getattr(st, days_keys[
                    date(year, month, d).weekday()])
                ist = staffing_ist.get(st.id, {}).get(d, 0)
                status = "ok"
                if soll > 0:
                    if ist == 0:
                        status = "err"
                    elif ist != soll:
                        status = "warn"
                    s_cells.append({'count': ist, 'status': status, 'is_empty': False})
                else:
                    s_cells.append({'count': '', 'status': 'none', 'is_empty': True})
            staffing_rows.append({'name': st.abbreviation, 'cells': s_cells})

    return {'year': year, 'month_name': date(year, month, 1).strftime('%B'), 'days_header': header, 'rows': rows,
            'staffing_rows': staffing_rows}