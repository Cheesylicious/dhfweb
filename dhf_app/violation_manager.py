# dhf_app/violation_manager.py
# NEU: Ausgelagerte Logik für Konflikt- und Verletzungsprüfungen (Regel 4)

from datetime import datetime, timedelta
from collections import defaultdict
import calendar
from sqlalchemy import extract


# from .extensions import db # Nicht nötig, da Daten übergeben werden


class ViolationManager:
    """
    Stellt Methoden zur Verfügung, um Regelverletzungen (Hunde, Ruhezeiten)
    basierend auf Schichtdaten und Schichtarten zu berechnen.

    Die Logik ist von den Flask-Routen entkoppelt, um Regel 4 zu erfüllen.
    """

    def __init__(self, shift_types):
        # Schichtarten werden beim Initialisieren des Managers geladen und vorverarbeitet
        self._preprocessed_shift_times = self.preprocess_shift_times(shift_types)
        # Hilfskarte von Abkürzung zu Schicht-Objekt
        self.shift_types_map = {st['abbreviation']: st for st in shift_types}

    def preprocess_shift_times(self, shift_types):
        """
        Konvertiert Schichtzeiten (HH:MM) in Minuten-Intervalle für schnelle Überlappungsprüfung
        (erfüllt Regel 2: Performance).
        """
        preprocessed = {}

        for st in shift_types:
            abbrev = st['abbreviation']
            start_time_str = st.get('start_time')
            end_time_str = st.get('end_time')

            # Nur Arbeitsschichten mit definierten Zeiten prüfen
            if not st.get('is_work_shift') or not start_time_str or not end_time_str:
                continue

            try:
                s_time = datetime.strptime(start_time_str, '%H:%M').time()
                e_time = datetime.strptime(end_time_str, '%H:%M').time()

                s_min = s_time.hour * 60 + s_time.minute
                e_min = e_time.hour * 60 + e_time.minute

                # Wenn Endzeit vor oder gleich Startzeit, ist es eine Übernachtschicht
                if e_min <= s_min: e_min += 24 * 60

                preprocessed[abbrev] = (s_min, e_min)

            except ValueError:
                print(f"[WARNUNG] Ungültiges Zeitformat für Schicht '{abbrev}' in Schichtarten.")

        return preprocessed

    def _check_time_overlap_optimized(self, shift1_abbrev, shift2_abbrev):
        """ Prüft Zeitüberlappung mit vorverarbeiteten Zeiten (Cache). """
        # Nicht-Arbeitsschichten filtern
        if shift1_abbrev in ['U', 'X', 'EU', 'WF', '', 'FREI'] or shift2_abbrev in ['U', 'X', 'EU', 'WF', '', 'FREI']:
            return False

        s1, e1 = self._preprocessed_shift_times.get(shift1_abbrev, (None, None))
        s2, e2 = self._preprocessed_shift_times.get(shift2_abbrev, (None, None))

        if s1 is None or s2 is None:
            return False

        # Standard-Überlappungsprüfung: Überlappung, wenn [Start1 < Ende2] UND [Start2 < Ende1]
        return (s1 < e2) and (s2 < e1)

    def calculate_all_violations(self, year, month, shifts_in_month, users):
        """
        Prüft den gesamten Monat auf Konflikte (Ruhezeit, Hunde) und gibt ein Set
        von Verletzungen als Tupel (user_id, day) zurück.
        """
        violations = set()

        # Mapping von Datum auf Schicht-Abkürzung (für schnellen Zugriff)
        # Key: (user_id, date_str) -> shift_abbreviation
        shifts_map = {}
        for s in shifts_in_month:
            abbrev = s.get('shifttype_abbreviation')
            if abbrev:
                shifts_map[(s['user_id'], s['date'])] = abbrev

        # User Map mit Diensthunden
        user_map = {u['id']: u for u in users}

        # Monatsdaten
        days_in_month = calendar.monthrange(year, month)[1]

        # --- HILFSFUNKTION ---
        def get_shift_abbrev(user_id, date_obj):
            """ Holt die Abkürzung der Arbeitsschicht am gegebenen Datum. """
            date_str = date_obj.strftime('%Y-%m-%d')
            abbrev = shifts_map.get((user_id, date_str))

            # Überprüfe, ob es eine Arbeitsschicht ist (erneut, falls Fehler in der shifts_map)
            if abbrev and self.shift_types_map.get(abbrev, {}).get('is_work_shift'):
                return abbrev

            return ""

        # 1. Ruhezeitkonflikte (N. -> T./6/QA/S)

        # Starte einen Tag vor Monatsanfang bis zum Monatsende
        start_date = datetime(year, month, 1) - timedelta(days=1)
        end_date = datetime(year, month, days_in_month)

        # Alle Schichten, die nach einer Nachtschicht eine Ruhezeitverletzung auslösen
        next_day_conflicts = ["T.", "6", "QA", "S"]

        for user_id in user_map.keys():
            current_check_date = start_date
            while current_check_date <= end_date:
                next_day_date = current_check_date + timedelta(days=1)

                shift1 = get_shift_abbrev(user_id, current_check_date)
                shift2 = get_shift_abbrev(user_id, next_day_date)

                # Ruhezeitverletzung
                is_ruhezeit_violation = (shift1 == 'N.' and shift2 in next_day_conflicts)

                if is_ruhezeit_violation:
                    # Konfliktzelle für den Tag mit N.
                    if current_check_date.month == month and current_check_date.year == year:
                        violations.add((user_id, current_check_date.day))
                    # Konfliktzelle für den Tag mit T./6/QA/S
                    if next_day_date.month == month and next_day_date.year == year:
                        violations.add((user_id, next_day_date.day))

                current_check_date += timedelta(days=1)

        # 2. Hundekonflikte (zeitliche Überlappung am selben Tag)

        for day in range(1, days_in_month + 1):
            current_date = datetime(year, month, day).date()
            dog_assignments = defaultdict(list)

            for user_id, user in user_map.items():
                dog = user.get('diensthund')
                if dog and dog != '---':
                    shift_abbrev = get_shift_abbrev(user_id, current_date)

                    if shift_abbrev:
                        dog_assignments[dog].append({'id': user_id, 'shift': shift_abbrev})

            for dog, assignments in dog_assignments.items():
                if len(assignments) > 1:
                    # Prüfe jedes Paar auf zeitliche Überlappung
                    for i in range(len(assignments)):
                        for j in range(i + 1, len(assignments)):
                            u1 = assignments[i];
                            u2 = assignments[j]

                            if self._check_time_overlap_optimized(u1['shift'], u2['shift']):
                                # Füge beide User für diesen Tag den Verletzungen hinzu
                                violations.add((u1['id'], day))
                                violations.add((u2['id'], day))

        return violations