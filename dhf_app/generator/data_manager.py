# dhf_app/generator/data_manager.py

import calendar
import json
from datetime import date, timedelta, datetime
from collections import defaultdict
from sqlalchemy import extract, or_, and_
from sqlalchemy.orm import joinedload

from ..models import User, Shift, ShiftType, SpecialDate, GlobalSetting, ShiftQuery


class ShiftPlanDataManager:
    """
    Zentrale Klasse für das Laden und Bereitstellen aller planungsrelevanten Daten.
    Optimiert für Performance (Regel 2): Lädt Daten in Batches und hält sie im Speicher.
    Unterstützt jetzt Plan-Varianten.
    """

    def __init__(self, db_session, year, month, variant_id=None):
        self.db = db_session
        self.year = year
        self.month = month
        self.variant_id = variant_id  # <<< NEU: Speichert die Ziel-Variante

        # Cache-Strukturen
        self.all_users = []
        self.user_data_map = {}  # {id: {user_dict}}
        self.user_preferences = {}  # {str(id): {prefs}}

        self.shift_types = {}  # {id: shift_type_obj}
        self.shift_types_data = {}  # {abbrev: {data}}
        self._preprocessed_shift_times = {}  # Für schnellen Overlap-Check

        self.existing_shifts_data = defaultdict(dict)  # {user_id_str: {date_str: shift_abbrev}}
        self.prev_month_shifts = defaultdict(dict)
        self.next_month_shifts = defaultdict(dict)

        self.vacation_requests = defaultdict(dict)  # {user_id_str: {date_obj: status}}
        self.wunschfrei_requests = defaultdict(dict)  # {user_id_str: {date_str: (status, shift)}}

        self.holidays_in_month = set()  # {date_obj}
        self.special_dates_data = {}  # {date_str: type}

        self.locked_shifts_data = defaultdict(dict)  # {user_id_str: {date_str: shift_abbrev}}

        self.staffing_rules = {
            'weekday_staffing': {},
            'holiday_staffing': {}
        }

        # Generator-Konfiguration (Default)
        self.generator_config = {
            "max_consecutive_same_shift": 4,
            "mandatory_rest_days_after_max_shifts": 2,
            "generator_fill_rounds": 3,
            "fairness_threshold_hours": 10.0,
            "min_hours_score_multiplier": 5.0,
            "max_monthly_hours": 170.0,
            "shifts_to_plan": ["6", "T.", "N."],
            "user_preferences": {},
            "preferred_partners_prioritized": [],
            "avoid_partners_prioritized": []
        }

    def load_data(self):
        """
        Führt alle Lade-Operationen in der korrekten Reihenfolge aus.
        """
        variant_info = f" (Variante ID: {self.variant_id})" if self.variant_id else " (Hauptplan)"
        print(f"[DataManager] Lade Daten für {self.month:02d}/{self.year}{variant_info}...")

        self._load_generator_config()
        self._fetch_shift_types()
        self._fetch_users()
        self._fetch_shifts()  # <<< Hier liegt die Hauptänderung für Varianten
        self._fetch_calendar_events()
        self._fetch_requests()
        self._build_staffing_rules()

        print("[DataManager] Daten erfolgreich geladen.")

    def _load_generator_config(self):
        """Lädt die Generator-Konfiguration aus den GlobalSettings."""
        setting = self.db.session.query(GlobalSetting).filter_by(key='generator_config').first()
        if setting and setting.value:
            try:
                loaded_conf = json.loads(setting.value)
                self.generator_config.update(loaded_conf)
                self.user_preferences = self.generator_config.get('user_preferences', {})
            except json.JSONDecodeError:
                print("[DataManager] Fehler beim Parsen der Generator-Config.")

    def _fetch_shift_types(self):
        """Lädt alle Schichtarten und bereitet Metadaten vor."""
        types = self.db.session.query(ShiftType).all()
        for st in types:
            self.shift_types[st.id] = st
            self.shift_types_data[st.abbreviation] = st.to_dict()

            if st.is_work_shift and st.start_time and st.end_time:
                try:
                    s_t = datetime.strptime(st.start_time, '%H:%M').time()
                    e_t = datetime.strptime(st.end_time, '%H:%M').time()
                    s_min = s_t.hour * 60 + s_t.minute
                    e_min = e_t.hour * 60 + e_t.minute
                    if e_min <= s_min: e_min += 24 * 60
                    self._preprocessed_shift_times[st.abbreviation] = (s_min, e_min)
                except ValueError:
                    pass

    def _fetch_users(self):
        """Lädt alle aktiven und sichtbaren Benutzer."""
        last_day = calendar.monthrange(self.year, self.month)[1]
        month_end = date(self.year, self.month, last_day)
        prev_month_end = date(self.year, self.month, 1) - timedelta(days=1)

        users_query = self.db.session.query(User).filter(
            User.shift_plan_visible == True,
            or_(User.aktiv_ab_datum.is_(None), User.aktiv_ab_datum <= month_end)
        ).order_by(User.shift_plan_sort_order, User.name).all()

        for u in users_query:
            if u.inaktiv_ab_datum is not None and u.inaktiv_ab_datum <= prev_month_end:
                continue

            u_dict = u.to_dict()
            self.all_users.append(u_dict)
            self.user_data_map[u.id] = u_dict

            if str(u.id) not in self.user_preferences:
                self.user_preferences[str(u.id)] = {}

    def _fetch_shifts(self):
        """
        Lädt Schichten für den aktuellen, vorherigen und nächsten Monat.

        LOGIK FÜR VARIANTEN:
        - Vormonat: Lädt IMMER den Hauptplan (variant_id IS NULL), da dies die historische Basis ist.
        - Aktueller Monat: Lädt die spezifische Variante (self.variant_id) ODER Hauptplan (wenn None).
        - Nächster Monat: Lädt IMMER den Hauptplan (variant_id IS NULL).
        """

        # Datumsbereiche berechnen
        start_curr = date(self.year, self.month, 1)
        last_day = calendar.monthrange(self.year, self.month)[1]
        end_curr = date(self.year, self.month, last_day)

        start_prev = (start_curr - timedelta(days=1)).replace(day=1)
        end_prev = start_curr - timedelta(days=1)

        start_next = end_curr + timedelta(days=1)
        # Ende nächster Monat (ca.)
        end_next = (start_next.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)

        # Filter erstellen

        # 1. Vormonat (Basis ist immer Hauptplan)
        filter_prev = and_(
            Shift.date >= start_prev,
            Shift.date <= end_prev,
            Shift.variant_id == None
        )

        # 2. Aktueller Monat (Ziel-Variante)
        filter_curr = and_(
            Shift.date >= start_curr,
            Shift.date <= end_curr,
            Shift.variant_id == self.variant_id
        )

        # 3. Nächster Monat (Basis ist immer Hauptplan)
        filter_next = and_(
            Shift.date >= start_next,
            Shift.date <= end_next,
            Shift.variant_id == None
        )

        # Gesamtabfrage mit OR
        shifts = self.db.session.query(Shift).options(joinedload(Shift.shift_type)).filter(
            or_(filter_prev, filter_curr, filter_next)
        ).all()

        for s in shifts:
            uid = str(s.user_id)
            date_str = s.date.strftime('%Y-%m-%d')
            abbrev = s.shift_type.abbreviation if s.shift_type else ""

            if start_prev <= s.date <= end_prev:
                self.prev_month_shifts[uid][date_str] = abbrev

            elif start_curr <= s.date <= end_curr:
                # Dies sind nun die Schichten der korrekten Variante (oder Hauptplan)
                self.existing_shifts_data[uid][date_str] = abbrev
                # Diese gelten als "Locked" für den Generator, da sie bereits in der DB stehen (z.B. manuell eingetragen oder kopiert)
                self.locked_shifts_data[uid][date_str] = abbrev

            elif start_next <= s.date <= end_next:
                self.next_month_shifts[uid][date_str] = abbrev

    def _fetch_calendar_events(self):
        """Lädt Feiertage und Sondertermine."""
        events = self.db.session.query(SpecialDate).filter(
            extract('year', SpecialDate.date) == self.year,
            extract('month', SpecialDate.date) == self.month
        ).all()

        for e in events:
            self.special_dates_data[e.date.strftime('%Y-%m-%d')] = e.type
            if e.type == 'holiday':
                self.holidays_in_month.add(e.date)

    def _fetch_requests(self):
        """
        Lädt Urlaubsanträge und Wunschfrei-Anfragen.
        Diese sind global und nicht an Varianten gebunden.
        """
        queries = self.db.session.query(ShiftQuery).filter(
            extract('year', ShiftQuery.shift_date) == self.year,
            extract('month', ShiftQuery.shift_date) == self.month,
            ShiftQuery.status == 'offen'
        ).all()

        for q in queries:
            if not q.target_user_id: continue
            uid = str(q.target_user_id)
            date_str = q.shift_date.strftime('%Y-%m-%d')

            msg = q.message.lower()
            if "anfrage für:" in msg:
                parts = q.message.split(":")
                if len(parts) > 1:
                    req_shift = parts[1].strip().replace("?", "")
                    self.wunschfrei_requests[uid][date_str] = ('Genehmigt', req_shift)

    def _build_staffing_rules(self):
        """
        Erstellt die Besetzungsregeln.
        """
        for st in self.shift_types.values():
            mapping = [
                st.min_staff_mo, st.min_staff_di, st.min_staff_mi,
                st.min_staff_do, st.min_staff_fr, st.min_staff_sa, st.min_staff_so
            ]

            for day_idx, amount in enumerate(mapping):
                if amount > 0:
                    day_str = str(day_idx)
                    if day_str not in self.staffing_rules['weekday_staffing']:
                        self.staffing_rules['weekday_staffing'][day_str] = {}
                    self.staffing_rules['weekday_staffing'][day_str][st.abbreviation] = amount

            if st.min_staff_holiday > 0:
                if 'holiday_staffing' not in self.staffing_rules:
                    self.staffing_rules['holiday_staffing'] = {}
                self.staffing_rules['holiday_staffing'][st.abbreviation] = st.min_staff_holiday

    # --- Public Getter Methoden ---

    def get_generator_config(self):
        return self.generator_config

    def get_previous_month_shifts(self):
        return self.prev_month_shifts

    def get_next_month_shifts(self):
        return self.next_month_shifts

    def get_min_staffing_for_date(self, date_obj):
        if date_obj in self.holidays_in_month:
            return self.staffing_rules.get('holiday_staffing', {}).copy()
        weekday_str = str(date_obj.weekday())
        return self.staffing_rules.get('weekday_staffing', {}).get(weekday_str, {}).copy()