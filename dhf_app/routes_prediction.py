from flask import Blueprint, request, jsonify
from .models import Shift, ShiftType, SpecialDate
from .utils import admin_required
from sqlalchemy import extract, and_
from sqlalchemy.orm import joinedload
from datetime import date, timedelta
import calendar
from collections import defaultdict

prediction_bp = Blueprint('prediction', __name__, url_prefix='/api/prediction')


def get_absence_stats_last_year(year, month):
    """
    Analysiert den gleichen Monat im Vorjahr.
    Gibt zurück: Durchschnittliche Ausfälle (Krank/Kind-Krank) pro Wochentag.
    """
    target_year = year - 1

    # Alle Schichten des Vorjahres-Monats laden
    shifts = Shift.query.options(joinedload(Shift.shift_type)).filter(
        extract('year', Shift.date) == target_year,
        extract('month', Shift.date) == month
    ).all()

    # Relevante Ausfall-Kürzel (Anpassbar, basierend auf deinen Daten)
    # 'K' = Krank, 'KK' = Kind Krank. 'U' (Urlaub) nehmen wir raus, da Urlaub planbar ist.
    # Wir wollen vor unvorhergesehenen Ausfällen warnen.
    absence_codes = ['K', 'KK', 'K.']

    # Map: Datum -> Anzahl Ausfälle
    daily_counts = defaultdict(int)
    for s in shifts:
        if s.shift_type and s.shift_type.abbreviation in absence_codes:
            daily_counts[s.date] += 1

    # Nach Wochentag aggregieren (0=Mo, 6=So)
    weekday_absences = defaultdict(list)
    days_in_month = calendar.monthrange(target_year, month)[1]

    for day in range(1, days_in_month + 1):
        d = date(target_year, month, day)
        wd = d.weekday()
        count = daily_counts.get(d, 0)
        weekday_absences[wd].append(count)

    # Durchschnitt berechnen
    averages = {}
    for wd, counts in weekday_absences.items():
        avg = sum(counts) / len(counts) if counts else 0.0
        averages[wd] = avg

    return averages


@prediction_bp.route('/analyze', methods=['GET'])
@admin_required
def analyze_risk():
    try:
        year = int(request.args.get('year'))
        month = int(request.args.get('month'))
        variant_id_raw = request.args.get('variant_id')
        variant_id = int(variant_id_raw) if variant_id_raw and variant_id_raw != 'null' else None
    except:
        return jsonify({"message": "Ungültige Parameter"}), 400

    # 1. Historische Krankheitsdaten (Der "Risiko-Faktor")
    stats_last_year = get_absence_stats_last_year(year, month)

    # 2. Aktuellen Plan laden
    shifts_current = Shift.query.options(joinedload(Shift.shift_type)).filter(
        extract('year', Shift.date) == year,
        extract('month', Shift.date) == month,
        Shift.variant_id == variant_id
    ).all()

    # Aktuelles Personal pro Tag zählen (Nur wer wirklich arbeitet)
    current_staffing = defaultdict(int)
    for s in shifts_current:
        # Wir zählen nur Schichten, die als "Arbeitsschicht" markiert sind
        if s.shift_type and s.shift_type.is_work_shift:
            current_staffing[s.date.day] += 1

    # 3. SOLL-Zustand aus den Schichtarten berechnen
    # Wir laden alle Schichtarten und summieren deren Mindestbesetzung pro Wochentag
    all_types = ShiftType.query.all()

    # Feiertage laden, da dort oft andere Besetzungen gelten
    holidays = SpecialDate.query.filter(
        extract('year', SpecialDate.date) == year,
        extract('month', SpecialDate.date) == month,
        SpecialDate.type == 'holiday'
    ).all()
    holiday_days = {h.date.day for h in holidays}  # Set mit Tagen: {1, 25, 26}

    analysis_result = []
    days_in_month = calendar.monthrange(year, month)[1]

    for day in range(1, days_in_month + 1):
        date_obj = date(year, month, day)
        wd = date_obj.weekday()
        is_holiday = day in holiday_days

        # --- INTELLIGENTE SOLL-BERECHNUNG ---
        # Wir summieren den Bedarf aller Schichtarten für diesen Wochentag
        required_staff = 0
        for st in all_types:
            # Wenn Feiertag, nimm Feiertags-Besetzung, sonst Wochentag
            if is_holiday:
                required_staff += (st.min_staff_holiday or 0)
            else:
                # Mapping: 0=Mo -> min_staff_mo
                daily_req = [
                    st.min_staff_mo, st.min_staff_di, st.min_staff_mi,
                    st.min_staff_do, st.min_staff_fr, st.min_staff_sa,
                    st.min_staff_so
                ]
                required_staff += (daily_req[wd] or 0)

        # Wenn an einem Tag gar kein Bedarf hinterlegt ist (z.B. Wochenende vergessen),
        # nehmen wir keine Warnung an, um Fehlalarme zu vermeiden.
        if required_staff == 0:
            continue

        actual = current_staffing[day]
        predicted_absence = stats_last_year.get(wd, 0)

        # Die harte Wahrheit: Haben wir genug Puffer für die Statistik?
        # Netto-Verfügbar = Geplant - Historisch_Krank
        net_available = actual - predicted_absence

        buffer = net_available - required_staff

        risk_level = "low"
        msg = ""

        # Logik für Warnstufen
        if buffer < 0:
            # Wir rutschen statistisch unter das Minimum
            risk_level = "high"
            msg = f"Achtung: Soll={required_staff}, Ist={actual}. Durch ~{predicted_absence:.1f} Krankheitsfälle droht Unterbesetzung!"
        elif buffer < 0.5:
            # Es ist extrem knapp (weniger als eine halbe Person Puffer)
            risk_level = "medium"
            msg = f"Knapp: Puffer ist fast aufgebraucht ({buffer:.1f}). Ein Ausfall wäre kritisch."

        if risk_level != "low":
            analysis_result.append({
                "day": day,
                "date": date_obj.isoformat(),
                "weekday": wd,
                "actual_staff": actual,
                "required_staff": required_staff,
                "predicted_absence": round(predicted_absence, 1),
                "risk": risk_level,
                "message": msg
            })

    return jsonify({
        "year": year,
        "month": month,
        "base_year": year - 1,
        "risks": analysis_result
    }), 200