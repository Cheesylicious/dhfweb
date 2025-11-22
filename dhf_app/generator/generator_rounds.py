# dhf_app/generator/generator_rounds.py

from collections import defaultdict
from datetime import timedelta


class GeneratorRounds:
    """
    Kapselt die Logik für die Ausführung der verschiedenen Zuweisungsrunden
    (Runde 1: Fair mit Future Conflict Score, Runde 2-4: Auffüllen).
    """

    def __init__(self, generator_instance, helpers_instance, scoring_instance):
        self.gen = generator_instance
        self.helpers = helpers_instance
        self.scoring = scoring_instance

    def run_fair_assignment_round(self, shift_abbrev, current_date_obj,
                                  users_unavailable_today, existing_dog_assignments, assignments_today_by_shift,
                                  live_user_hours, live_shift_counts, live_shift_counts_ratio,
                                  needed_now, days_in_month):
        """
        Führt die "Runde 1" (Faire Zuweisung mit Präferenzen und Future Conflict Score) aus.
        Gibt die Anzahl der erfolgreich zugewiesenen Schichten zurück.
        """

        assigned_count_this_round = 0
        search_attempts_fair = 0
        date_str = current_date_obj.strftime('%Y-%m-%d')

        # Datums-Objekte für Helfer bereitstellen
        prev_date_obj = current_date_obj - timedelta(days=1)
        two_days_ago_obj = current_date_obj - timedelta(days=2)

        # Wir versuchen so lange Kandidaten zu finden, bis der Bedarf gedeckt ist
        # oder wir alle User einmal durchgeprüft haben (Sicherheitsabbruch).
        while assigned_count_this_round < needed_now and search_attempts_fair < len(self.gen.all_users) + 1:
            search_attempts_fair += 1
            possible_candidates = []
            candidate_total_hours = 0.0
            num_available_candidates = 0

            # Schritt 1.1: Gültige Kandidaten sammeln
            for user_dict in self.gen.all_users:
                user_id_int = user_dict.get('id')
                if user_id_int is None: continue
                user_id_str = str(user_id_int)

                # Bereits heute verplant?
                if user_id_str in users_unavailable_today: continue

                user_dog = user_dict.get('diensthund')
                current_hours = live_user_hours.get(user_id_int, 0.0)
                hours_for_this_shift = self.gen.shift_hours.get(shift_abbrev, 0.0)

                user_pref = self.gen.user_preferences[user_id_str]
                max_hours_override = user_pref.get('max_monthly_hours')
                max_same_shift_override = user_pref.get('max_consecutive_same_shift_override')

                skip_reason = None

                # Helfer-Methoden verwenden für vergangene Schichten
                prev_shift = self.helpers.get_previous_shift(user_id_str, prev_date_obj)
                one_day_ago_raw_shift = self.helpers.get_previous_raw_shift(user_id_str, prev_date_obj)
                two_days_ago_shift = self.helpers.get_previous_shift(user_id_str, two_days_ago_obj)

                # Für Isolations-Check (Zukunft)
                next_raw_shift = self.helpers.get_next_raw_shift(user_id_str, current_date_obj)
                after_next_raw_shift = self.helpers.get_shift_after_next_raw_shift(user_id_str, current_date_obj)

                # --- Diensthund-Logik (Regel 1: Keine Überlappung) ---
                if user_dog and user_dog != '---' and user_dog in existing_dog_assignments:
                    for assigned_dog_shift in existing_dog_assignments[user_dog]:
                        assigned_shift = assigned_dog_shift['shift']

                        # Gleiche Schicht ist okay? Nein, zwei HF mit gleichem Hund können nicht gleichzeitig arbeiten
                        # (außer es ist explizit erlaubt, aber hier gehen wir von Konflikt aus)
                        if shift_abbrev == assigned_shift:
                            skip_reason = "Dog (Same Shift)"
                            break

                        # Zeitliche Überlappung prüfen
                        if self.helpers.check_time_overlap_optimized(shift_abbrev, assigned_shift):
                            skip_reason = "Dog (Overlap)"
                            break
                    if skip_reason: continue

                # --- Harte Ruhezeit-Regeln ---

                # N->T/6 Block (Ruhezeit nach Nachtschicht)
                if not skip_reason and prev_shift == "N." and shift_abbrev in ["T.", "6"]:
                    skip_reason = "N->T/6"

                # N. -> QA/S Block
                if not skip_reason and prev_shift == "N." and shift_abbrev in ["QA", "S"]:
                    skip_reason = "N->QA/S"

                # N-F-T (Ein einzelner freier Tag nach Nacht vor Tag ist oft zu wenig Erholung)
                if not skip_reason and shift_abbrev == "T." and one_day_ago_raw_shift in self.gen.free_shifts_indicators and two_days_ago_shift == "N.":
                    skip_reason = "N-F-T"

                # Expliziter Ausschluss
                if not skip_reason and shift_abbrev in user_pref.get('shift_exclusions', []):
                    skip_reason = f"Excl({shift_abbrev})"

                # Max. aufeinanderfolgende Arbeitstage (Soft/Hard Limit)
                consecutive_days = self.helpers.count_consecutive_shifts(user_id_str, current_date_obj)
                if not skip_reason and consecutive_days >= self.gen.SOFT_MAX_CONSECUTIVE_SHIFTS:
                    skip_reason = f"MaxConsS({consecutive_days})"

                # Obligatorische Ruhetage nach Block
                if not skip_reason and self.gen.mandatory_rest_days > 0 and consecutive_days == 0 and not self.helpers.check_mandatory_rest(
                        user_id_str, current_date_obj):
                    skip_reason = f"Rest({self.gen.mandatory_rest_days}d)"

                # Wunschfrei (Respekt-Level)
                if not skip_reason and date_str in self.gen.wunschfrei_requests.get(user_id_str, {}):
                    wf_entry = self.gen.wunschfrei_requests[user_id_str][date_str]
                    wf_status, wf_shift = None, None
                    if isinstance(wf_entry, tuple) and len(wf_entry) >= 2:
                        wf_status, wf_shift = wf_entry[0], wf_entry[1]

                    # Wenn Wunsch genehmigt/akzeptiert UND (ganztags oder diese Schicht betreffend)
                    if wf_status in ['Approved', 'Genehmigt', 'Akzeptiert'] and wf_shift in ["", shift_abbrev]:
                        # Prüfe Respekt-Level (ab 50% wird es in Runde 1 respektiert)
                        if self.gen.wunschfrei_respect_level >= 50:
                            skip_reason = f"WF({self.gen.wunschfrei_respect_level})"

                # Max. gleiche Schicht in Folge
                limit = max_same_shift_override if max_same_shift_override is not None else self.gen.max_consecutive_same_shift_limit
                if not skip_reason:
                    consecutive_same = self.helpers.count_consecutive_same_shifts(user_id_str, current_date_obj,
                                                                                  shift_abbrev)
                    if consecutive_same >= limit:
                        skip_reason = f"MaxSame({consecutive_same})"

                # Max. Monatsstunden
                max_hours_check = max_hours_override if max_hours_override is not None else self.gen.MAX_MONTHLY_HOURS
                if not skip_reason and current_hours + hours_for_this_shift > max_hours_check:
                    skip_reason = f"MaxHrs({current_hours:.1f}+{hours_for_this_shift:.1f}>{max_hours_check})"

                # Isolation (Frei - Arbeit - Frei) vermeiden
                is_isolated = False
                if not skip_reason:
                    # Check 1: Gestern Frei, Morgen Frei
                    iso_case_1 = (one_day_ago_raw_shift in self.gen.free_shifts_indicators and
                                  self.helpers.get_previous_raw_shift(user_id_str,
                                                                      two_days_ago_obj) in self.gen.free_shifts_indicators and
                                  next_raw_shift in self.gen.free_shifts_indicators)
                    # Check 2: Gestern Frei, Morgen Frei, Übermorgen Frei (Wochenend-Logik)
                    iso_case_2 = (one_day_ago_raw_shift in self.gen.free_shifts_indicators and
                                  next_raw_shift in self.gen.free_shifts_indicators and
                                  after_next_raw_shift in self.gen.free_shifts_indicators)

                    is_isolated = iso_case_1 or iso_case_2

                if skip_reason: continue

                # Kandidat ist gültig -> Daten sammeln
                candidate_data = {
                    'id': user_id_int,
                    'id_str': user_id_str,
                    'dog': user_dog,
                    'hours': current_hours,
                    'prev_shift': prev_shift,
                    'is_isolated': is_isolated,
                    'user_pref': user_pref
                }
                possible_candidates.append(candidate_data)
                candidate_total_hours += current_hours
                num_available_candidates += 1

            if not possible_candidates:
                break

            # Schritt 1.2: Scores berechnen
            average_hours = (candidate_total_hours / num_available_candidates) if num_available_candidates > 0 else 0.0
            available_candidate_ids = {c['id'] for c in possible_candidates}

            for candidate in possible_candidates:
                scores = self.scoring.calculate_scores(
                    candidate, average_hours, available_candidate_ids,
                    shift_abbrev, live_shift_counts_ratio,
                    assignments_today_by_shift,
                    current_date_obj, days_in_month
                )
                candidate.update(scores)

            # Schritt 1.3: Kandidaten sortieren
            # Kriterien-Hierarchie:
            # 1. Avoid Score (Strafen vermeiden)
            # 2. Partner Score (Wunsch-Partner bevorzugen)
            # 3. Future Conflict Score (Zukunftsprobleme vermeiden)
            # 4. Min Hours (Unterbelegte bevorzugen)
            # 5. Fairness (Ausgleich zum Durchschnitt)
            # 6. Ratio (T/N Verhältnis)
            # 7. Isolation (Einzelne Arbeitstage vermeiden)
            # 8. Bonus für gleiche Schicht (Blockbildung)
            # 9. Weniger Stunden (als Tie-Breaker)

            possible_candidates.sort(
                key=lambda x: (
                    x.get('avoid_score', 0),  # Niedriger = Besser
                    x.get('partner_score', 1000),  # Niedriger = Besser (Prio 1 = beste)
                    x.get('future_conflict_score', 0),  # Niedriger = Besser
                    -x.get('min_hours_score', 0),  # Höher = Besser (negieren)
                    -x.get('fairness_score', 0),  # Höher = Besser (negieren)
                    x.get('ratio_pref_score', 0),  # Niedriger (näher an 0) = Besser
                    x.get('isolation_score', 0),  # Niedriger = Besser
                    0 if x['prev_shift'] == shift_abbrev else 1,  # Gleiche Schicht bevorzugen (0 vor 1)
                    x['hours']  # Weniger Stunden bevorzugen (als letztes Mittel)
                )
            )

            # Schritt 1.4: Besten Kandidaten auswählen und zuweisen
            chosen_user = possible_candidates[0]

            # Zuweisung durchführen (Nur im Speicher des Generators!)
            assigned_count_this_round += 1

            user_id_int = chosen_user['id']
            user_id_str = chosen_user['id_str']
            user_dog = chosen_user['dog']

            # In Live-Daten schreiben
            if user_id_str not in self.gen.live_shifts_data:
                self.gen.live_shifts_data[user_id_str] = {}
            self.gen.live_shifts_data[user_id_str][date_str] = shift_abbrev

            # Tracking aktualisieren
            users_unavailable_today.add(user_id_str)
            assignments_today_by_shift[shift_abbrev].add(user_id_int)

            if user_dog and user_dog != '---':
                existing_dog_assignments[user_dog].append({'user_id': user_id_int, 'shift': shift_abbrev})

            hours_added = self.gen.shift_hours.get(shift_abbrev, 0.0)
            live_user_hours[user_id_int] += hours_added

            # Ratio Tracking
            if shift_abbrev in ['T.', '6']:
                live_shift_counts_ratio[user_id_int]['T_OR_6'] += 1
            if shift_abbrev == 'N.':
                live_shift_counts_ratio[user_id_int]['N_DOT'] += 1

            live_shift_counts[user_id_int][shift_abbrev] += 1

        return assigned_count_this_round

    def run_fill_round(self, shift_abbrev, current_date_obj, users_unavailable_today, existing_dog_assignments,
                       assignments_today_by_shift, live_user_hours, live_shift_counts, live_shift_counts_ratio,
                       needed, round_num):
        """
        Führt eine Auffüllrunde (2, 3 oder 4) mit spezifischen Regel-Lockerungen durch.
        Ziel: Lücken füllen, auch wenn es "unschön" ist (aber legal).
        """
        assigned_count = 0
        search_attempts = 0
        date_str = current_date_obj.strftime('%Y-%m-%d')

        prev_date_obj = current_date_obj - timedelta(days=1)
        two_days_ago_obj = current_date_obj - timedelta(days=2)

        while assigned_count < needed and search_attempts < len(self.gen.all_users) + 1:
            search_attempts += 1
            possible_fill_candidates = []

            for user_dict in self.gen.all_users:
                user_id_int = user_dict.get('id')
                if user_id_int is None: continue
                user_id_str = str(user_id_int)
                if user_id_str in users_unavailable_today: continue

                user_dog = user_dict.get('diensthund')
                current_hours = live_user_hours.get(user_id_int, 0.0)
                hours_for_this_shift = self.gen.shift_hours.get(shift_abbrev, 0.0)

                user_pref = self.gen.user_preferences[user_id_str]
                max_hours_override = user_pref.get('max_monthly_hours')

                skip_reason = None

                prev_shift = self.helpers.get_previous_shift(user_id_str, prev_date_obj)
                one_day_ago_raw_shift = self.helpers.get_previous_raw_shift(user_id_str, prev_date_obj)
                two_days_ago_shift = self.helpers.get_previous_shift(user_id_str, two_days_ago_obj)

                # --- Diensthund (Harte Regel bleibt) ---
                if user_dog and user_dog != '---' and user_dog in existing_dog_assignments:
                    for assigned_dog_shift in existing_dog_assignments[user_dog]:
                        assigned_shift = assigned_dog_shift['shift']
                        if shift_abbrev == assigned_shift:
                            skip_reason = "Dog (Same)"
                            break
                        if self.helpers.check_time_overlap_optimized(shift_abbrev, assigned_shift):
                            skip_reason = "Dog (Overlap)"
                            break
                    if skip_reason: continue

                # --- Harte Ruhezeiten ---
                # N->T/6 und N->QA/S bleiben auch in Fill-Runden aktiv (Gesundheitsschutz)
                if prev_shift == "N." and shift_abbrev in ["T.", "6", "QA", "S"]:
                    continue  # skip_reason = "N->..."

                # --- Lockerungen ---

                # N-F-T (Nacht -> Frei -> Tag)
                # In Runde 3 und höher erlaubt (unangenehm, aber möglich)
                if round_num <= 2 and shift_abbrev == "T." and one_day_ago_raw_shift in self.gen.free_shifts_indicators and two_days_ago_shift == "N.":
                    skip_reason = "N-F-T"

                # Schicht-Ausschluss
                # Wird hier als "Hard" betrachtet, außer man würde es explizit lockern wollen
                if not skip_reason and shift_abbrev in user_pref.get('shift_exclusions', []):
                    skip_reason = "Excl"

                # Max. Tage in Folge
                # In Fill-Runden nutzen wir das HARD Limit, wenn konfiguriert
                limit = self.gen.HARD_MAX_CONSECUTIVE_SHIFTS if self.gen.avoid_understaffing_hard else self.gen.SOFT_MAX_CONSECUTIVE_SHIFTS
                if not skip_reason:
                    consecutive_days = self.helpers.count_consecutive_shifts(user_id_str, current_date_obj)
                    if consecutive_days >= limit:
                        skip_reason = "MaxCons"

                # Ruhezeit nach Block
                # In Runde 4 (Notfall) könnte man dies lockern, hier erst ab Runde 4
                if round_num <= 3 and not skip_reason and self.gen.mandatory_rest_days > 0:
                    # ... (Prüfung wie oben)
                    consecutive_days = self.helpers.count_consecutive_shifts(user_id_str, current_date_obj)
                    if consecutive_days == 0 and not self.helpers.check_mandatory_rest(user_id_str, current_date_obj):
                        skip_reason = "Rest"

                # Max Stunden
                max_hours_check = max_hours_override if max_hours_override is not None else self.gen.MAX_MONTHLY_HOURS
                if not skip_reason and current_hours + hours_for_this_shift > max_hours_check:
                    skip_reason = "MaxHrs"

                if skip_reason: continue

                # Kandidat für Fill-Runde gefunden
                possible_fill_candidates.append(
                    {'id': user_id_int, 'id_str': user_id_str, 'dog': user_dog, 'hours': current_hours}
                )

            if not possible_fill_candidates:
                break

            # In Fill-Runden sortieren wir rein nach Stunden (Wer hat am wenigsten?)
            possible_fill_candidates.sort(key=lambda x: x['hours'])
            chosen_user = possible_fill_candidates[0]

            # Zuweisung
            assigned_count += 1
            user_id_int = chosen_user['id']
            user_id_str = chosen_user['id_str']
            user_dog = chosen_user['dog']

            if user_id_str not in self.gen.live_shifts_data:
                self.gen.live_shifts_data[user_id_str] = {}
            self.gen.live_shifts_data[user_id_str][date_str] = shift_abbrev

            users_unavailable_today.add(user_id_str)
            assignments_today_by_shift[shift_abbrev].add(user_id_int)

            if user_dog and user_dog != '---':
                existing_dog_assignments[user_dog].append({'user_id': user_id_int, 'shift': shift_abbrev})

            hours_added = self.gen.shift_hours.get(shift_abbrev, 0.0)
            live_user_hours[user_id_int] += hours_added

            if shift_abbrev in ['T.', '6']:
                live_shift_counts_ratio[user_id_int]['T_OR_6'] += 1
            if shift_abbrev == 'N.':
                live_shift_counts_ratio[user_id_int]['N_DOT'] += 1
            live_shift_counts[user_id_int][shift_abbrev] += 1

        return assigned_count