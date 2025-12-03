# dhf_app/generator/core.py

from collections import defaultdict
from datetime import date, timedelta
import calendar

# Import der Komponenten
from .data_manager import ShiftPlanDataManager
from .generator_config import GeneratorConfig
from .helpers import GeneratorHelpers
from .generator_scoring import GeneratorScoring
from .generator_rounds import GeneratorRounds
from .generator_pre_planning import GeneratorPrePlanner
from .generator_persistence import save_generation_batch_to_db


class ShiftPlanGenerator:
    """
    Hauptklasse des Generators. Steuert den gesamten Ablauf von
    Daten laden -> Konfiguration -> Planung -> Speichern.
    """

    def __init__(self, db_session, year, month, log_callback=None, variant_id=None):
        self.db = db_session
        self.year = year
        self.month = month
        self.variant_id = variant_id  # <<< NEU: Ziel-Variante
        # Logging-Funktion (Default: print, falls nichts übergeben)
        self.log = log_callback if log_callback else lambda msg, p=None: print(msg)

        # --- Status-Speicher (Live-Daten während der Generierung) ---
        self.live_shifts_data = defaultdict(dict)  # {user_id_str: {date_str: shift_abbrev}}
        self.live_user_hours = defaultdict(float)  # {user_id_int: hours}
        self.live_shift_counts = defaultdict(lambda: defaultdict(int))
        self.live_shift_counts_ratio = defaultdict(lambda: defaultdict(int))

        # --- Konstanten & Listen ---
        # Standardwert, wird später durch Config überschrieben
        self.shifts_to_plan = ["6", "T.", "N."]
        self.free_shifts_indicators = {"", "FREI", "U", "X", "EU", "WF"}
        self.holidays_in_month = set()

        # Puffer für Pre-Planning
        self.CRITICAL_LOOKAHEAD_DAYS = 3
        self.CRITICAL_BUFFER = 1

        # --- Komponenten-Placeholder ---
        self.data_manager = None
        self.config = None
        self.helpers = None
        self.scoring = None
        self.rounds = None
        self.pre_planner = None

        # Kompatibilität für PrePlanner (erwartet self.gen.app.staffing_rules)
        self.app = self
        self.staffing_rules = {}

    def run(self):
        """
        Führt den kompletten Generierungsprozess aus.
        Gibt True zurück, wenn erfolgreich, sonst False.
        """
        try:
            self.log("Initialisiere Generator...", 5)

            # 1. Daten laden (DataManager)
            # <<< NEU: variant_id übergeben
            self.data_manager = ShiftPlanDataManager(self.db, self.year, self.month, self.variant_id)
            self.data_manager.load_data()

            # Daten in Generator-Scope übernehmen (für schnellen Zugriff der Helfer)
            self.all_users = self.data_manager.all_users
            self.user_data_map = self.data_manager.user_data_map
            self.holidays_in_month = self.data_manager.holidays_in_month
            self.vacation_requests = self.data_manager.vacation_requests
            self.wunschfrei_requests = self.data_manager.wunschfrei_requests
            self.staffing_rules = self.data_manager.staffing_rules  # Wichtig für PrePlanner
            self.locked_shifts_data = self.data_manager.locked_shifts_data

            # Schicht-Stunden mappen
            self.shift_hours = {
                st.abbreviation: st.hours
                for st in self.data_manager.shift_types.values()
            }

            # Live-Daten mit existierenden (gelockten/bereits gesetzten) Daten initialisieren
            for uid, days in self.data_manager.existing_shifts_data.items():
                self.live_shifts_data[uid] = days.copy()

            # Initiale Stunden berechnen (falls wir auf einem teilweise gefüllten Plan aufsetzen)
            for uid_str, days in self.live_shifts_data.items():
                uid_int = int(uid_str)
                for s_abbr in days.values():
                    self.live_user_hours[uid_int] += self.shift_hours.get(s_abbr, 0.0)

            # 2. Konfiguration laden
            self.log("Lade Konfiguration...", 10)
            self.config = GeneratorConfig(self.data_manager)

            # Config-Werte auf self mappen (erwartet von Helfer-Klassen)
            self.HARD_MAX_CONSECUTIVE_SHIFTS = self.config.max_consecutive_same_shift_limit
            self.SOFT_MAX_CONSECUTIVE_SHIFTS = self.config.max_consecutive_same_shift_limit
            self.max_consecutive_same_shift_limit = self.config.max_consecutive_same_shift_limit
            self.mandatory_rest_days = self.config.mandatory_rest_days
            self.avoid_understaffing_hard = self.config.avoid_understaffing_hard
            self.wunschfrei_respect_level = self.config.wunschfrei_respect_level

            # Dynamische Werte aus Config übernehmen
            self.MAX_MONTHLY_HOURS = self.config.max_monthly_hours
            self.shifts_to_plan = self.config.shifts_to_plan
            self.log(f"Aktive Schichten: {', '.join(self.shifts_to_plan)}", 12)
            self.log(f"Max. Stunden: {self.MAX_MONTHLY_HOURS}", 12)

            self.min_hours_fairness_threshold = self.config.min_hours_fairness_threshold
            self.min_hours_score_multiplier = self.config.min_hours_score_multiplier
            self.fairness_threshold_hours = self.config.fairness_threshold_hours
            self.fairness_score_multiplier = self.config.fairness_score_multiplier
            self.isolation_score_multiplier = self.config.isolation_score_multiplier
            self.AVOID_PARTNER_PENALTY_SCORE = self.config.AVOID_PARTNER_PENALTY_SCORE

            self.partner_priority_map = self.config.partner_priority_map
            self.avoid_priority_map = self.config.avoid_priority_map
            self.user_preferences = self.config.user_preferences

            # 3. Helfer initialisieren
            self.helpers = GeneratorHelpers(self)
            self.scoring = GeneratorScoring(self)
            self.rounds = GeneratorRounds(self, self.helpers, self.scoring)
            self.pre_planner = GeneratorPrePlanner(self, self.helpers)

            # 4. Hauptschleife (Tag für Tag)
            days_in_month = calendar.monthrange(self.year, self.month)[1]

            for day in range(1, days_in_month + 1):
                current_date = date(self.year, self.month, day)
                date_str = current_date.strftime('%Y-%m-%d')

                # Fortschritt berechnen (10% bis 90%)
                progress = 10 + int((day / days_in_month) * 80)
                self.log(f"Plane Tag {day} ({date_str})...", progress)

                # Soll-Besetzung für diesen Tag
                min_staffing = self.data_manager.get_min_staffing_for_date(current_date)

                # Tracking-Listen für den aktuellen Tag
                users_unavailable_today = set()
                existing_dog_assignments = defaultdict(list)  # {dog_name: [{user_id, shift}]}
                assignments_today_by_shift = defaultdict(set)  # {shift_abbrev: {user_ids}}

                # a) Bereits gesetzte Schichten (Locked/Urlaub/Manuell) erfassen
                for uid_str, user_shifts in self.live_shifts_data.items():
                    shift = user_shifts.get(date_str)

                    # --- KORREKTUR: Prüfe auf gesicherte Schichten (DB) ---
                    # Wir prüfen, ob dieser Tag für diesen User bereits in der DB existierte
                    # (auch wenn es 'X' oder 'U' ist).
                    is_locked = self.locked_shifts_data.get(uid_str, {}).get(date_str) is not None

                    # User ist nicht verfügbar, wenn er arbeitet ODER wenn der Eintrag gelockt ist
                    if (shift and shift not in self.free_shifts_indicators) or is_locked:
                        uid_int = int(uid_str)
                        users_unavailable_today.add(uid_str)

                        # Wenn eine Schicht eingetragen ist (auch manuell), zählen wir sie zur Besetzung
                        if shift:
                            assignments_today_by_shift[shift].add(uid_int)

                        # Hund prüfen
                        user_data = self.user_data_map.get(uid_int)
                        if user_data and user_data.get('diensthund'):
                            dog = user_data['diensthund']
                            if dog != '---' and shift:  # Nur wenn eine echte Schicht da ist
                                existing_dog_assignments[dog].append({'user_id': uid_int, 'shift': shift})
                    # --- ENDE KORREKTUR ---

                # b) Abwesenheiten (Urlaub/WF) erfassen
                # (Dies ist jetzt teilweise redundant durch den 'is_locked' check oben,
                # aber wichtig für frisch genehmigte Anträge, die noch nicht im Plan stehen)
                # ... (wird implizit in den Runden geprüft oder durch locked_shifts abgedeckt)

                # c) Planungsschleife für die Schichtarten (in konfigurierter Reihenfolge)
                for shift_abbrev in self.shifts_to_plan:
                    needed = min_staffing.get(shift_abbrev, 0)
                    if needed <= 0:
                        continue

                    current_count = len(assignments_today_by_shift.get(shift_abbrev, set()))
                    needed_now = max(0, needed - current_count)

                    if needed_now > 0:
                        # Runde 1: Faire Zuweisung
                        assigned_fair = self.rounds.run_fair_assignment_round(
                            shift_abbrev, current_date,
                            users_unavailable_today, existing_dog_assignments, assignments_today_by_shift,
                            self.live_user_hours, self.live_shift_counts, self.live_shift_counts_ratio,
                            needed_now, days_in_month
                        )

                        remaining = needed_now - assigned_fair

                        # Runde 2-4: Auffüllen (Regeln lockern)
                        if remaining > 0:
                            for r in range(2, self.config.generator_fill_rounds + 2):
                                if remaining <= 0: break

                                assigned_fill = self.rounds.run_fill_round(
                                    shift_abbrev, current_date,
                                    users_unavailable_today, existing_dog_assignments, assignments_today_by_shift,
                                    self.live_user_hours, self.live_shift_counts, self.live_shift_counts_ratio,
                                    remaining, r
                                )
                                remaining -= assigned_fill

                        if remaining > 0:
                            self.log(
                                f"[WARN] Tag {day}: Konnte {shift_abbrev} nicht voll besetzen (Fehlen: {remaining})")

            # 5. Speichern
            self.log("Speichere Plan in Datenbank...", 95)

            # <<< NEU: variant_id übergeben
            success, count, err = save_generation_batch_to_db(
                self.live_shifts_data,
                self.year,
                self.month,
                self.variant_id
            )

            if success:
                self.log(f"Erfolgreich! {count} Einträge gespeichert.", 100)
                return True
            else:
                self.log(f"[FEHLER] DB-Speichern fehlgeschlagen: {err}", 100)
                return False

        except Exception as e:
            self.log(f"[CRASH] Kritischer Fehler im Generator: {str(e)}", 0)
            import traceback
            traceback.print_exc()
            return False