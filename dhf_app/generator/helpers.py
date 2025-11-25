# dhf_app/generator/helpers.py

from datetime import timedelta


class GeneratorHelpers:
    """
    Kapselt alle Low-Level-Datenabrufe und Regelprüfungen für den Generator.
    Greift auf den Zustand der Haupt-Generator-Instanz (gen) und deren DataManager zu.
    """

    def __init__(self, generator_instance):
        self.gen = generator_instance
        self._next_month_shifts = None  # Cache für Folgemonatsdaten (Lazy Loading)

        # Schichten, die als "harte" Arbeitstage zählen (für Konsekutiv-Zählung)
        # (Inkludiert QA und S, da dies Anwesenheiten sind)
        self.hard_work_indicators = {'T.', 'N.', '6', '24', 'QA', 'S'}

    def check_time_overlap_optimized(self, shift1_abbrev, shift2_abbrev):
        """
        Prüft Zeitüberlappung zweier Schichten mithilfe des Caches im DataManager.
        Vermeidet langsame DB- oder Parsing-Aufrufe.
        """
        # Freie Schichten haben keine Zeit -> Keine Überlappung
        if shift1_abbrev in self.gen.free_shifts_indicators or shift2_abbrev in self.gen.free_shifts_indicators:
            return False

        # Zugriff auf den vorverarbeiteten Cache im DataManager
        preprocessed_times = getattr(self.gen.data_manager, '_preprocessed_shift_times', {})

        s1, e1 = preprocessed_times.get(shift1_abbrev, (None, None))
        s2, e2 = preprocessed_times.get(shift2_abbrev, (None, None))

        if s1 is None or s2 is None:
            return False

        # Überlappung, wenn Start1 < Ende2 UND Start2 < Ende1
        overlap = (s1 < e2) and (s2 < e1)
        return overlap

    def get_previous_shift(self, user_id_str, check_date_obj):
        """
        Holt die *Arbeits*-Schicht vom Vortag (ignoriert 'FREI', 'U', 'X', etc.).
        Gibt die Schichtabkürzung zurück, oder "" falls kein Dienst.
        """
        check_date_str = check_date_obj.strftime('%Y-%m-%d')

        # 1. Prüfe, ob das Datum im Vormonat liegt (Cache DataManager)
        if check_date_obj.month != self.gen.month:
            prev_month_data = self.gen.data_manager.get_previous_month_shifts().get(user_id_str, {})
            shift = prev_month_data.get(check_date_str)
            if shift and shift not in self.gen.free_shifts_indicators:
                return shift
            return ""

        # 2. Datum im aktuellen Monat: Prüfe live_shifts_data (Live-Status des Generators)
        shifts_data = self.gen.live_shifts_data.get(user_id_str, {})
        shift = shifts_data.get(check_date_str)
        if shift and shift not in self.gen.free_shifts_indicators:
            return shift

        return ""

    def get_previous_raw_shift(self, user_id_str, check_date_obj):
        """
        Holt die Schicht vom Vortag, *inklusive* Freischichten (oder None).
        Wichtig für N-F-T Prüfungen (Nacht -> Frei -> Tag).
        """
        check_date_str = check_date_obj.strftime('%Y-%m-%d')

        # 1. Vormonat
        if check_date_obj.month != self.gen.month:
            prev_month_data = self.gen.data_manager.get_previous_month_shifts().get(user_id_str, {})
            shift = prev_month_data.get(check_date_str)
            return shift  # Kann None oder String sein

        # 2. Aktueller Monat (Live)
        shifts_data = self.gen.live_shifts_data.get(user_id_str, {})
        shift = shifts_data.get(check_date_str)
        return shift

    def get_next_raw_shift(self, user_id_str, current_date_obj):
        """
        Holt die Schicht des nächsten Tages.
        Wichtig für Isolationsprüfung (Frei -> Arbeit -> Frei).
        """
        next_date_obj = current_date_obj + timedelta(days=1)
        next_date_str = next_date_obj.strftime('%Y-%m-%d')

        # 1. Prüfe aktuellen Monatsplan (Live)
        shift = self.gen.live_shifts_data.get(user_id_str, {}).get(next_date_str)
        if shift is not None:
            return shift

        # 2. Prüfe Folgemonat (nur relevant, wenn wir am Monatsende sind)
        if next_date_obj.month != current_date_obj.month:
            if self._next_month_shifts is None:
                self._next_month_shifts = self.gen.data_manager.get_next_month_shifts()
            shift = self._next_month_shifts.get(user_id_str, {}).get(next_date_str)
            return shift

        return None

    def get_shift_after_next_raw_shift(self, user_id_str, current_date_obj):
        """
        Holt die Schicht des übernächsten Tages.
        """
        after_next_date_obj = current_date_obj + timedelta(days=2)
        after_next_date_str = after_next_date_obj.strftime('%Y-%m-%d')

        # 1. Live
        shift = self.gen.live_shifts_data.get(user_id_str, {}).get(after_next_date_str)
        if shift is not None:
            return shift

        # 2. Folgemonat
        if after_next_date_obj.month != current_date_obj.month:
            if self._next_month_shifts is None:
                self._next_month_shifts = self.gen.data_manager.get_next_month_shifts()
            shift = self._next_month_shifts.get(user_id_str, {}).get(after_next_date_str)
            return shift

        return None

    def count_consecutive_shifts(self, user_id_str, current_date_obj):
        """
        Zählt, wie viele Arbeitstage der User *bis* zum 'current_date_obj' (exklusive)
        ununterbrochen gearbeitet hat (Rückwärtszählung).
        """
        count = 0
        current_check = current_date_obj - timedelta(days=1)

        while True:
            shift = self.get_previous_raw_shift(user_id_str, current_check)

            # Prüfe auf Arbeitsschicht
            if shift and shift in self.hard_work_indicators:
                count += 1
                current_check -= timedelta(days=1)
            else:
                break
        return count

    def count_consecutive_same_shifts(self, user_id_str, current_date_obj, target_shift_abbrev):
        """
        Zählt, wie oft *dieselbe* Schicht (target_shift_abbrev) direkt nacheinander
        in der Vergangenheit liegt.
        """
        count = 0
        current_check = current_date_obj - timedelta(days=1)

        while True:
            shift = self.get_previous_shift(user_id_str, current_check)  # Ignoriert Freischichten

            if shift == target_shift_abbrev:
                count += 1
                current_check -= timedelta(days=1)
            else:
                break
        return count

    def check_mandatory_rest(self, user_id_str, current_date_obj):
        """
        Prüft die Einhaltung der obligatorischen Ruhezeit nach einem Block von
        Maximal-Arbeitstagen (HARD_MAX_CONSECUTIVE_SHIFTS).
        Gibt True zurück, wenn Planung erlaubt ist (Ruhezeit eingehalten oder nicht nötig).
        """
        if self.gen.mandatory_rest_days <= 0:
            return True

        # Suche den letzten Block von Arbeitstagen
        day_before = current_date_obj - timedelta(days=1)
        free_days_count = 0
        check_date = day_before

        # Zähle freie Tage rückwärts
        while True:
            shift = self.get_previous_raw_shift(user_id_str, check_date)
            if shift in self.gen.free_shifts_indicators:
                free_days_count += 1
                check_date -= timedelta(days=1)
                # Optimierung: Wenn wir genug freie Tage gefunden haben, ist alles ok
                if free_days_count >= self.gen.mandatory_rest_days:
                    return True
            else:
                break

        # Wir sind auf einen Arbeitstag gestoßen (check_date)
        last_work_day_obj = check_date

        # Wenn wir gar keine freien Tage gefunden haben, befinden wir uns direkt
        # im Anschluss an Arbeitstage. Die normale `count_consecutive_shifts`
        # Prüfung in der Hauptlogik deckt das ab. Hier geht es um die Pause DANACH.
        if free_days_count == 0:
            return True

        # Prüfe, wie lang der Arbeitsblock DAVOR war
        work_block_length = self.count_consecutive_shifts(user_id_str, last_work_day_obj + timedelta(days=1))

        # WAR der Block maximal lang?
        if work_block_length >= self.gen.HARD_MAX_CONSECUTIVE_SHIFTS:
            # Ja -> Dann MUSS die Pause lang genug sein
            return free_days_count >= self.gen.mandatory_rest_days

        return True