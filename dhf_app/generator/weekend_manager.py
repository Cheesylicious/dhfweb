# dhf_app/generator/weekend_manager.py

import datetime
import calendar


class WeekendManager:
    """
    Verwaltet die Logik für die Regel "Jeder Mitarbeiter mindestens ein Wochenende frei".
    Wird vom Generator instanziiert, wenn die Option aktiviert ist.
    """

    def __init__(self, generator_instance):
        self.gen = generator_instance
        self.weekends = []  # Liste von Tupeln: [(sat_date, sun_date), ...]
        self.total_weekends_count = 0

        # Initialisierung
        self._identify_weekends()

    def _identify_weekends(self):
        """
        Ermittelt alle kompletten Wochenenden (Samstag + Sonntag) im Planungsmonat.
        """
        self.weekends = []
        year = self.gen.year
        month = self.gen.month

        # Anzahl Tage im Monat
        _, num_days = calendar.monthrange(year, month)

        # Iteriere durch alle Tage
        for day in range(1, num_days + 1):
            date_obj = datetime.date(year, month, day)
            # 5 = Samstag
            if date_obj.weekday() == 5:
                # Prüfe, ob der Sonntag noch im selben Monat liegt
                sun_date = date_obj + datetime.timedelta(days=1)
                if sun_date.month == month:
                    self.weekends.append((date_obj, sun_date))

        self.total_weekends_count = len(self.weekends)
        # Debug
        # print(f"[WeekendManager] Gefundene Wochenenden im {month}/{year}: {self.total_weekends_count}")

    def would_violate_free_weekend_rule(self, user_id_str, target_date_obj):
        """
        Prüft, ob die Zuweisung einer Schicht an 'target_date_obj' dazu führen würde,
        dass der Mitarbeiter KEIN freies Wochenende mehr übrig hat.

        Logik:
        Wenn wir das aktuelle Wochenende "kaputt machen" (durch Arbeit),
        und der Mitarbeiter an allen anderen Wochenenden auch schon arbeitet (oder arbeiten muss),
        dann wäre die Anzahl der Arbeits-Wochenenden == Gesamtanzahl. -> Verletzung.
        """

        # 1. Ist das Ziel-Datum überhaupt Teil eines Wochenendes?
        target_weekend_index = -1
        for idx, (sat, sun) in enumerate(self.weekends):
            if target_date_obj == sat or target_date_obj == sun:
                target_weekend_index = idx
                break

        if target_weekend_index == -1:
            return False  # Tag ist Mo-Fr, Regel greift nicht.

        # 2. Zähle, wie viele Wochenenden der Mitarbeiter bereits "verbrannt" (gearbeitet) hat.
        # Wir müssen dazu die Live-Daten prüfen.
        burned_weekends_indices = set()

        # Wir iterieren über alle Wochenenden des Monats
        for idx, (sat, sun) in enumerate(self.weekends):
            # Prüfen wir das aktuelle Ziel-Wochenende?
            if idx == target_weekend_index:
                # Ja, wenn wir hier zuweisen, wird es "verbrannt".
                burned_weekends_indices.add(idx)
                continue

            # Prüfen anderer Wochenenden anhand der Live-Daten (und Locked Shifts)
            sat_str = sat.strftime('%Y-%m-%d')
            sun_str = sun.strftime('%Y-%m-%d')

            # Hilfsfunktion: Ist an einem Tag Arbeit?
            # Arbeit ist definiert als: Eintrag vorhanden UND nicht in free_shifts_indicators (wie 'X', 'Urlaub', etc.)
            is_sat_work = self._is_working_day(user_id_str, sat_str)
            is_sun_work = self._is_working_day(user_id_str, sun_str)

            if is_sat_work or is_sun_work:
                burned_weekends_indices.add(idx)

        # 3. Entscheidung
        # Wenn wir jetzt zuweisen, haben wir 'len(burned_weekends_indices)' Wochenenden mit Arbeit.
        # Wenn das gleich der Gesamtanzahl ist, gibt es KEIN freies Wochenende mehr.
        if len(burned_weekends_indices) >= self.total_weekends_count:
            return True  # Verletzung!

        return False

    def _is_working_day(self, user_id_str, date_str):
        """
        Prüft effizient, ob an einem Tag gearbeitet wird.
        Berücksichtigt Live-Daten, Locked-Daten.
        Urlaub und Wunschfrei werden implizit als "nicht Arbeit" betrachtet,
        da sie entweder als 'X'/'U' im Plan stehen oder gar nicht belegt sind (und damit frei).
        """
        # 1. Live-Daten (Generator-Status)
        shift = self.gen.live_shifts_data.get(user_id_str, {}).get(date_str)
        if shift and shift not in self.gen.free_shifts_indicators:
            return True

        # 2. Locked-Daten (Manuelle Vorbelegungen, die vllt noch nicht in Live kopiert wurden, sicherheitshalber)
        locked_shift = self.gen.locked_shifts_data.get(user_id_str, {}).get(date_str)
        if locked_shift and locked_shift not in self.gen.free_shifts_indicators:
            return True

        return False