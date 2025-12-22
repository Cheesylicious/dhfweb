# dhf_app/generator/generator_pre_planning.py

import calendar
import traceback
from collections import defaultdict
from datetime import date, timedelta


class GeneratorPrePlanner:
    """
    Kapselt die Logik für die Vorausplanung (Pre-Planning) des Generators.

    Identifiziert potenzielle Engpässe (kritische Schichten) vor der
    eigentlichen Zuweisungsrunde und stellt Methoden zur dynamischen
    Prüfung und Vorab-Zuweisung bereit.
    """

    def __init__(self, generator_instance, helpers_instance):
        """
        Initialisiert den Pre-Planner.

        Args:
            generator_instance (ShiftPlanGenerator): Die Hauptinstanz des Generators.
            helpers_instance (GeneratorHelpers): Die Instanz der Generator-Helfer.
        """
        self.gen = generator_instance
        self.helpers = helpers_instance

    def identify_potential_critical_shifts(self):
        """
        Identifiziert potenziell kritische Schichten basierend auf dem Puffer.
        (Ehemals _identify_potential_critical_shifts in ShiftPlanGenerator)
        """
        potential_critical = set()
        days_in_month = calendar.monthrange(self.gen.year, self.gen.month)[1]

        # Wir schauen nur die letzten X Tage an, da dort oft Engpässe entstehen
        start_day = max(1, days_in_month - self.gen.CRITICAL_LOOKAHEAD_DAYS + 1)

        print(f"  [Krit-Check Vorfilter] Prüfe Tage {start_day} bis {days_in_month}...")

        for day in range(start_day, days_in_month + 1):
            current_date_obj = date(self.gen.year, self.gen.month, day)
            date_str = current_date_obj.strftime('%Y-%m-%d')

            # --- KORREKTE MINDESTBESETZUNG LOGIK (SONDERTERMINE IGNORIEREN) ---
            try:
                # 1. Lade die Besetzung (die T/N/6 an Event-Tagen fälschlich auf 0 setzen könnte)
                min_staffing_today = self.gen.data_manager.get_min_staffing_for_date(current_date_obj)

                # 2. Prüfe, ob ein Event (S/QA) T/N/6 überschrieben hat
                is_event_day = False
                if min_staffing_today:
                    if min_staffing_today.get('S', 0) > 0 or min_staffing_today.get('QA', 0) > 0:
                        is_event_day = True

                # 3. Wenn Event-Tag, lade die Basis-Regeln (Wochentag/Feiertag)
                if is_event_day:
                    base_staffing_rules = self.gen.app.staffing_rules
                    is_holiday_today = current_date_obj in self.gen.holidays_in_month
                    base_staffing_today = {}

                    if is_holiday_today and 'holiday_staffing' in base_staffing_rules:
                        base_staffing_today = base_staffing_rules['holiday_staffing'].copy()
                    else:
                        weekday_str = str(current_date_obj.weekday())
                        if weekday_str in base_staffing_rules.get('weekday_staffing', {}):
                            base_staffing_today = base_staffing_rules['weekday_staffing'][weekday_str].copy()

                    # 4. Überschreibe T/N/6 im Event-Staffing mit den Basis-Regeln
                    for shift in self.gen.shifts_to_plan:  # ["6", "T.", "N."]
                        if shift in base_staffing_today:
                            min_staffing_today[shift] = base_staffing_today[shift]

            except Exception as staffing_err:
                min_staffing_today = {}
                print(f"[WARN] Staffing Error bei Krit-Vorfilter {date_str}: {staffing_err}")
                traceback.print_exc()
            # --- ENDE MINDESTBESETZUNG LOGIK ---

            if not min_staffing_today: continue
            initial_availability_per_shift = defaultdict(int)

            # Nur die Schichten prüfen, die der Generator planen soll
            shifts_to_check = [s for s in self.gen.shifts_to_plan if
                               s in min_staffing_today and min_staffing_today.get(s, 0) > 0]

            for user_dict in self.gen.all_users:
                user_id_int = user_dict.get('id')
                if user_id_int is None: continue
                user_id_str = str(user_id_int)
                user_pref = self.gen.user_preferences[user_id_str]

                is_unavailable_day = False

                # Urlaub?
                if self.gen.vacation_requests.get(user_id_str, {}).get(current_date_obj) in ['Approved', 'Genehmigt']:
                    is_unavailable_day = True
                # Wunschfrei (Ganztags)?
                elif not is_unavailable_day and date_str in self.gen.wunschfrei_requests.get(user_id_str, {}):
                    wf_entry = self.gen.wunschfrei_requests[user_id_str][date_str]
                    wf_status, wf_shift = None, None
                    if isinstance(wf_entry, tuple) and len(wf_entry) >= 2:
                        wf_status, wf_shift = wf_entry[0], wf_entry[1]
                    if wf_status in ['Approved', 'Genehmigt', 'Akzeptiert'] and wf_shift == "":
                        is_unavailable_day = True

                # --- NEU (Regel 1): Prüfe auf gesicherte Schichten ---
                if not is_unavailable_day:
                    if self.gen.locked_shifts_data.get(user_id_str, {}).get(date_str) is not None:
                        is_unavailable_day = True
                # --- ENDE NEU ---

                if is_unavailable_day: continue

                for shift_abbrev in shifts_to_check:
                    wf_blocks_this_shift = False
                    # Wunschfrei (Schichtspezifisch)?
                    if date_str in self.gen.wunschfrei_requests.get(user_id_str, {}):
                        wf_entry = self.gen.wunschfrei_requests[user_id_str][date_str]
                        wf_status, wf_shift = None, None
                        if isinstance(wf_entry, tuple) and len(wf_entry) >= 2:
                            wf_status, wf_shift = wf_entry[0], wf_entry[1]
                        if wf_status in ['Approved', 'Genehmigt', 'Akzeptiert'] and wf_shift == shift_abbrev:
                            wf_blocks_this_shift = True

                    is_excluded = shift_abbrev in user_pref.get('shift_exclusions', [])

                    if not wf_blocks_this_shift and not is_excluded:
                        initial_availability_per_shift[shift_abbrev] += 1

            for shift_abbrev in shifts_to_check:
                required = min_staffing_today.get(shift_abbrev, 0)
                if required > 0:
                    available = initial_availability_per_shift[shift_abbrev]
                    # Wenn Verfügbarkeit <= Bedarf + Puffer -> Kritisch
                    if available <= required + self.gen.CRITICAL_BUFFER:
                        potential_critical.add((current_date_obj, shift_abbrev))
                        print(
                            f"  [Krit-Check Vorfilter {date_str}-{shift_abbrev}] Potenziell Kritisch! Benötigt: {required}, Verfügbar: {available}, Puffer: {self.gen.CRITICAL_BUFFER}")

        return potential_critical

    def get_actually_available_count(self, target_date_obj, target_shift_abbrev, live_user_hours):
        """
        Zählt, wie viele Mitarbeiter *aktuell* die Ziel-Schicht machen könnten.
        Berücksichtigt Live-Daten (bereits geplante Schichten) und alle harten Regeln.
        """
        count = 0
        date_str = target_date_obj.strftime('%Y-%m-%d')
        print(f"    [DynCheck Detail {date_str}-{target_shift_abbrev}] Starte Zählung...")

        users_unavailable_on_target_day = set()
        occupied_dogs = defaultdict(list)

        # Status Quo für den Ziel-Tag sammeln
        for uid_str, day_data in self.gen.live_shifts_data.items():
            if date_str in day_data:
                shift = day_data[date_str]
                if shift and shift not in self.gen.free_shifts_indicators:
                    users_unavailable_on_target_day.add(uid_str)
                    uid_int = int(uid_str)
                    user_dog = self.gen.user_data_map.get(uid_int, {}).get('diensthund')
                    if user_dog and user_dog != '---':
                        occupied_dogs[user_dog].append({'user_id': uid_int, 'shift': shift})

            # Urlaub
            if self.gen.vacation_requests.get(uid_str, {}).get(target_date_obj) in ['Approved', 'Genehmigt']:
                users_unavailable_on_target_day.add(uid_str)

            # Wunschfrei
            elif date_str in self.gen.wunschfrei_requests.get(uid_str, {}):
                wf_entry = self.gen.wunschfrei_requests[uid_str][date_str]
                wf_status, wf_shift = None, None
                if isinstance(wf_entry, tuple) and len(wf_entry) >= 2:
                    wf_status, wf_shift = wf_entry[0], wf_entry[1]
                if wf_status in ['Approved', 'Genehmigt', 'Akzeptiert']:
                    if wf_shift == "" or wf_shift == target_shift_abbrev:
                        users_unavailable_on_target_day.add(uid_str)

            # --- NEU (Regel 1): Prüfe auf gesicherte Schichten ---
            if self.gen.locked_shifts_data.get(uid_str, {}).get(date_str) is not None:
                users_unavailable_on_target_day.add(uid_str)
            # --- ENDE NEU ---

        # Jeden Mitarbeiter gegen harte Regeln prüfen
        for user_dict in self.gen.all_users:
            user_id_int = user_dict.get('id')
            if user_id_int is None: continue
            user_id_str = str(user_id_int)

            if user_id_str in users_unavailable_on_target_day:
                continue

            user_pref = self.gen.user_preferences[user_id_str]
            user_dog = user_dict.get('diensthund')
            current_hours = live_user_hours.get(user_id_int, 0.0)
            hours_for_this_shift = self.gen.shift_hours.get(target_shift_abbrev, 0.0)
            max_hours_override = user_pref.get('max_monthly_hours')

            skip_reason = None

            prev_date_obj = target_date_obj - timedelta(days=1)
            two_days_ago_obj = target_date_obj - timedelta(days=2)

            prev_shift = self.helpers.get_previous_shift(user_id_str, prev_date_obj)
            one_day_ago_raw_shift = self.helpers.get_previous_raw_shift(user_id_str, prev_date_obj)
            two_days_ago_shift = self.helpers.get_previous_shift(user_id_str, two_days_ago_obj)

            # Harte Regeln

            # Hundekonflikt
            if user_dog and user_dog != '---' and user_dog in occupied_dogs:
                if any(self.helpers.check_time_overlap_optimized(target_shift_abbrev, a['shift']) for a in
                       occupied_dogs[user_dog]):
                    skip_reason = "Dog"

            # N->T/6 Block
            if not skip_reason and prev_shift == "N." and target_shift_abbrev in ["T.", "6"]:
                skip_reason = "N->T/6"

            # N-F-T
            if not skip_reason and target_shift_abbrev == "T." and one_day_ago_raw_shift in self.gen.free_shifts_indicators and two_days_ago_shift == "N.":
                skip_reason = "N-F-T"

            # Exclusions
            if not skip_reason and target_shift_abbrev in user_pref.get('shift_exclusions', []):
                skip_reason = f"Excl({target_shift_abbrev})"

            # Max Consecutive
            consecutive_days = 0
            if not skip_reason:
                consecutive_days = self.helpers.count_consecutive_shifts(user_id_str, target_date_obj)
            if consecutive_days >= self.gen.HARD_MAX_CONSECUTIVE_SHIFTS:
                skip_reason = f"MaxCons({consecutive_days})"

            # Mandatory Rest
            if not skip_reason and self.gen.mandatory_rest_days > 0 and consecutive_days == 0 and not self.helpers.check_mandatory_rest(
                    user_id_str, target_date_obj):
                skip_reason = f"Rest({self.gen.mandatory_rest_days}d)"

            # Max Hours
            max_hours_check = max_hours_override if max_hours_override is not None else self.gen.MAX_MONTHLY_HOURS
            if not skip_reason and current_hours + hours_for_this_shift > max_hours_check:
                skip_reason = f"MaxHrs({current_hours:.1f}+{hours_for_this_shift:.1f}>{max_hours_check})"

            if not skip_reason:
                count += 1

        return count

    def pre_plan_critical_shift(self, critical_date_obj, critical_shift_abbrev, needed_count,
                                live_user_hours, live_shift_counts, live_shift_counts_ratio):
        """
        Versucht, EINE kritische Schicht zu füllen (Hard Rules + niedrigste Stunden).
        """
        assigned_count = 0
        search_attempts = 0
        date_str = critical_date_obj.strftime('%Y-%m-%d')
        print(f"    [Pre-Plan] Fülle {critical_shift_abbrev} am {date_str} (benötigt: {needed_count})")

        users_unavailable_this_call = set()
        assignments_on_critical_date = defaultdict(set)
        dogs_assigned_on_critical_date = defaultdict(list)

        # Status Quo laden
        for uid_str, day_data in self.gen.live_shifts_data.items():
            if date_str in day_data:
                shift = day_data[date_str]
                if shift and shift not in self.gen.free_shifts_indicators:
                    uid_int = int(uid_str)
                    assignments_on_critical_date[shift].add(uid_int)
                    users_unavailable_this_call.add(uid_str)

                    user_dog = self.gen.user_data_map.get(uid_int, {}).get('diensthund')
                    if user_dog and user_dog != '---':
                        dogs_assigned_on_critical_date[user_dog].append({'user_id': uid_int, 'shift': shift})

            # Urlaub/WF/Locked prüfen (analog zu oben)
            if self.gen.vacation_requests.get(uid_str, {}).get(critical_date_obj) in ['Approved', 'Genehmigt']:
                users_unavailable_this_call.add(uid_str)
            elif date_str in self.gen.wunschfrei_requests.get(uid_str, {}):
                wf_entry = self.gen.wunschfrei_requests[uid_str][date_str]
                wf_status, wf_shift = None, None
                if isinstance(wf_entry, tuple) and len(wf_entry) >= 2:
                    wf_status, wf_shift = wf_entry[0], wf_entry[1]
                if wf_status in ['Approved', 'Genehmigt', 'Akzeptiert'] and (
                        wf_shift == "" or wf_shift == critical_shift_abbrev):
                    users_unavailable_this_call.add(uid_str)

            # --- NEU (Regel 1): Prüfe auf gesicherte Schichten ---
            if self.gen.locked_shifts_data.get(uid_str, {}).get(date_str) is not None:
                users_unavailable_this_call.add(uid_str)
            # --- ENDE NEU ---

        # Kandidaten suchen
        while assigned_count < needed_count and search_attempts < len(self.gen.all_users) + 1:
            search_attempts += 1
            possible_candidates = []

            for user_dict in self.gen.all_users:
                user_id_int = user_dict.get('id')
                if user_id_int is None: continue
                user_id_str = str(user_id_int)

                if user_id_str in users_unavailable_this_call: continue

                user_pref = self.gen.user_preferences[user_id_str]
                user_dog = user_dict.get('diensthund')
                current_hours = live_user_hours.get(user_id_int, 0.0)
                hours_for_this_shift = self.gen.shift_hours.get(critical_shift_abbrev, 0.0)
                max_hours_override = user_pref.get('max_monthly_hours')

                skip_reason = None

                prev_date_obj = critical_date_obj - timedelta(days=1)
                two_days_ago_obj = critical_date_obj - timedelta(days=2)

                prev_shift = self.helpers.get_previous_shift(user_id_str, prev_date_obj)
                one_day_ago_raw_shift = self.helpers.get_previous_raw_shift(user_id_str, prev_date_obj)
                two_days_ago_shift = self.helpers.get_previous_shift(user_id_str, two_days_ago_obj)

                # --- Diensthund ---
                if user_dog and user_dog != '---' and user_dog in dogs_assigned_on_critical_date:
                    for assigned_dog_shift in dogs_assigned_on_critical_date[user_dog]:
                        assigned_shift = assigned_dog_shift['shift']
                        if critical_shift_abbrev == assigned_shift:
                            skip_reason = "Dog (Same Shift)"
                            break
                        if self.helpers.check_time_overlap_optimized(critical_shift_abbrev, assigned_shift):
                            skip_reason = "Dog (Overlap)"
                            break

                # N->T/6
                if not skip_reason and prev_shift == "N." and critical_shift_abbrev in ["T.", "6"]:
                    skip_reason = "N->T/6"

                # N-F-T
                if not skip_reason and critical_shift_abbrev == "T." and one_day_ago_raw_shift in self.gen.free_shifts_indicators and two_days_ago_shift == "N.":
                    skip_reason = "N-F-T"

                # Exclusion
                if not skip_reason and critical_shift_abbrev in user_pref.get('shift_exclusions', []):
                    skip_reason = "Excl"

                # Max Consecutive
                consecutive_days = 0
                if not skip_reason:
                    consecutive_days = self.helpers.count_consecutive_shifts(user_id_str, critical_date_obj)
                if consecutive_days >= self.gen.HARD_MAX_CONSECUTIVE_SHIFTS:
                    skip_reason = "MaxCons"

                # Rest
                if not skip_reason and self.gen.mandatory_rest_days > 0 and consecutive_days == 0 and not self.helpers.check_mandatory_rest(
                        user_id_str, critical_date_obj):
                    skip_reason = "Rest"

                # Max Hours
                max_hours_check = max_hours_override if max_hours_override is not None else self.gen.MAX_MONTHLY_HOURS
                if not skip_reason and current_hours + hours_for_this_shift > max_hours_check:
                    skip_reason = "MaxHrs"

                # Avoid Partner (Hard Check für Prio 1)
                if not skip_reason and user_id_int in self.gen.avoid_priority_map:
                    for prio, avoid_id in self.gen.avoid_priority_map[user_id_int]:
                        if prio == 1 and avoid_id in assignments_on_critical_date.get(critical_shift_abbrev, set()):
                            skip_reason = "Avoid-Hard"
                            break

                if skip_reason: continue

                possible_candidates.append(
                    {'id': user_id_int, 'id_str': user_id_str, 'dog': user_dog, 'hours': current_hours}
                )

            if not possible_candidates:
                print(
                    f"      [Pre-Plan] Keine Kandidaten in Versuch {search_attempts} für {critical_shift_abbrev} am {date_str}.")
                break

            # Sortiere nach Stunden (Ausgleich)
            possible_candidates.sort(key=lambda x: x['hours'])
            chosen_user = possible_candidates[0]

            # Zuweisen
            assigned_count += 1
            user_id_int = chosen_user['id']
            user_id_str = chosen_user['id_str']
            user_dog = chosen_user['dog']

            if user_id_str not in self.gen.live_shifts_data:
                self.gen.live_shifts_data[user_id_str] = {}

            self.gen.live_shifts_data[user_id_str][date_str] = critical_shift_abbrev
            users_unavailable_this_call.add(user_id_str)

            hours_added = self.gen.shift_hours.get(critical_shift_abbrev, 0.0)
            live_user_hours[user_id_int] += hours_added

            if critical_shift_abbrev in ['T.', '6']:
                live_shift_counts_ratio[user_id_int]['T_OR_6'] += 1
            if critical_shift_abbrev == 'N.':
                live_shift_counts_ratio[user_id_int]['N_DOT'] += 1

            live_shift_counts[user_id_int][critical_shift_abbrev] += 1
            assignments_on_critical_date[critical_shift_abbrev].add(user_id_int)

            print(
                f"      [Pre-Plan] OK (In-Memory): User {user_id_int} -> {critical_shift_abbrev} @ {date_str}. (Hrs: {live_user_hours[user_id_int]:.1f})")

            if user_dog and user_dog != '---':
                dogs_assigned_on_critical_date[user_dog].append(
                    {'user_id': user_id_int, 'shift': critical_shift_abbrev})

        return assigned_count