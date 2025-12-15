from flask import Blueprint, request, jsonify
from .models import Shift, ShiftType, SpecialDate, User
from .utils import admin_required
from sqlalchemy import extract, func
from sqlalchemy.orm import joinedload
from datetime import date, timedelta
import calendar
from collections import defaultdict
import random  # Für minimale Varianz, um "Leben" zu simulieren

prediction_bp = Blueprint('prediction', __name__, url_prefix='/api/prediction')


def get_historical_factor(year, month, weekday):
    """
    Ermittelt einen Faktor basierend auf dem Vorjahr.
    Gibt (Faktor 0.0-1.0, Grund) zurück.
    """
    target_year = year - 1
    # Wir schauen uns den ganzen Monat im Vorjahr an
    shifts = Shift.query.join(ShiftType).filter(
        extract('year', Shift.date) == target_year,
        extract('month', Shift.date) == month,
        ShiftType.abbreviation.in_(['K', 'KK', 'K.'])
    ).all()

    total_days = calendar.monthrange(target_year, month)[1]
    if total_days == 0: return 0.05, "Keine Historie"  # Fallback

    # Zähle Ausfälle an diesem Wochentag
    relevant_failures = 0
    day_occurrences = 0

    for d in range(1, total_days + 1):
        d_obj = date(target_year, month, d)
        if d_obj.weekday() == weekday:
            day_occurrences += 1
            # Gab es an diesem Tag mind. einen Ausfall?
            failures_on_day = sum(1 for s in shifts if s.date == d_obj)
            if failures_on_day > 0:
                relevant_failures += 1

    if day_occurrences == 0: return 0.05, "Basis-Wert"

    rate = relevant_failures / day_occurrences
    return max(0.05, rate), "Vorjahres-Daten"  # Nie unter 5%


def analyze_smart_risk(date_obj, actual_staff, required_staff, historical_rate):
    """
    Die "KI"-Logik. Kombiniert Faktoren zu einem Score.
    """
    score = 0
    reasons = []

    # 1. Basis: Historische Daten (Gewicht 40%)
    score += historical_rate * 40
    if historical_rate > 0.3:
        reasons.append("Hohe Ausfallquote im Vorjahr")

    # 2. Saison-Faktor (Gewicht 20%)
    month = date_obj.month
    if month in [1, 2, 11, 12]:
        score += 20
        reasons.append("Grippe-Saison")
    elif month in [6, 7, 8]:
        score += 10
        reasons.append("Urlaubszeit (hohe Belastung)")
    else:
        score += 5

    # 3. Wochentags-Psychologie (Gewicht 20%)
    wd = date_obj.weekday()
    if wd == 0:  # Montag
        score += 15
        reasons.append("Statistisches Montags-Risiko")
    elif wd == 4:  # Freitag
        score += 10
    elif wd >= 5:  # Wochenende
        score += 5  # Wochenende ist oft stabiler, wenn geplant

    # 4. Puffer-Analyse (Gewicht 20%)
    buffer = actual_staff - required_staff
    if buffer <= 0:
        score += 20
        reasons.append("Kein Personal-Puffer")
    elif buffer == 1:
        score += 10
        reasons.append("Geringer Puffer")

    # 5. Zufallsrauschen (Simuliert Tagesform/Wetter) - +/- 5%
    noise = random.randint(-5, 5)
    score += noise

    # Deckeln
    final_score = max(5, min(99, int(score)))  # Mindestens 5%, maximal 99%

    # Handlungsempfehlung generieren
    recommendation = ""
    risk_class = "low"

    if final_score >= 70:
        risk_class = "high"
        recommendation = "DRINGEND: Springer organisieren oder Bereitschaft anordnen."
    elif final_score >= 40:
        risk_class = "medium"
        recommendation = "Beobachten: Ggf. Kollegen vorwarnen."
    else:
        recommendation = "Lage stabil. Standard-Prozedere."

    return {
        "score": final_score,
        "reasons": reasons,
        "recommendation": recommendation,
        "class": risk_class
    }


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

    # Daten laden
    shifts_current = Shift.query.options(joinedload(Shift.shift_type)).filter(
        extract('year', Shift.date) == year,
        extract('month', Shift.date) == month,
        Shift.variant_id == variant_id
    ).all()

    current_staffing = defaultdict(int)
    for s in shifts_current:
        if s.shift_type and s.shift_type.is_work_shift:
            current_staffing[s.date.day] += 1

    all_types = ShiftType.query.all()
    holidays = SpecialDate.query.filter(
        extract('year', SpecialDate.date) == year,
        extract('month', SpecialDate.date) == month,
        SpecialDate.type == 'holiday'
    ).all()
    holiday_days = {h.date.day for h in holidays}

    analysis_result = []
    days_in_month = calendar.monthrange(year, month)[1]

    # Zähler für Summary
    high_risk_days = 0
    medium_risk_days = 0

    for day in range(1, days_in_month + 1):
        date_obj = date(year, month, day)
        wd = date_obj.weekday()
        is_holiday = day in holiday_days

        # Soll berechnen
        required = 0
        for st in all_types:
            if is_holiday:
                required += (st.min_staff_holiday or 0)
            else:
                daily_req = [
                    st.min_staff_mo, st.min_staff_di, st.min_staff_mi,
                    st.min_staff_do, st.min_staff_fr, st.min_staff_sa,
                    st.min_staff_so
                ]
                required += (daily_req[wd] or 0)

        if required == 0: continue

        actual = current_staffing[day]

        # 1. Historische Rate holen
        hist_rate, _ = get_historical_factor(year, month, wd)

        # 2. KI-Berechnung aufrufen
        ai_data = analyze_smart_risk(date_obj, actual, required, hist_rate)

        # Nur relevante Risiken zurückgeben (ab Medium oder wenn Puffer negativ)
        buffer = actual - required
        if ai_data['class'] != 'low' or buffer < 0:
            if ai_data['class'] == 'high' or buffer < 0:
                high_risk_days += 1
            else:
                medium_risk_days += 1

            # Nachricht formatieren
            msg = f"Soll: {required} | Ist: {actual}"
            if buffer < 0:
                msg = f"UNTERDECKUNG ({buffer})! {msg}"
            elif buffer == 0:
                msg = f"Kein Puffer. {msg}"

            analysis_result.append({
                "day": day,
                "date": date_obj.isoformat(),
                "weekday": wd,
                "risk_score": ai_data['score'],  # Prozentzahl
                "risk_class": ai_data['class'],  # high, medium, low
                "factors": ai_data['reasons'],  # Liste von Gründen
                "recommendation": ai_data['recommendation'],
                "message": msg
            })

    # KI-Zusammenfassung generieren
    summary = ""
    if high_risk_days > 3:
        summary = f"Analyse abgeschlossen. Der Monat wirkt kritisch. Es wurden {high_risk_days} Tage mit hohem Ausfallrisiko identifiziert. Achten Sie besonders auf Montags-Schichten und die Grippe-Saison."
    elif high_risk_days > 0:
        summary = f"Analyse fertig. Der Plan ist größtenteils stabil, weist aber {high_risk_days} kritische Tage auf. Prüfen Sie die markierten Tage im Detail."
    elif medium_risk_days > 5:
        summary = "Analyse fertig. Viele Tage haben nur einen geringen Puffer. Ein Ausfall könnte Kettenreaktionen auslösen."
    else:
        summary = "Analyse abgeschlossen. Der Dienstplan wirkt sehr robust. Das Ausfallrisiko ist minimal."

    return jsonify({
        "year": year,
        "month": month,
        "summary": summary,
        "risks": analysis_result
    }), 200