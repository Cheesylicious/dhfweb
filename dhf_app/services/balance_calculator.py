import datetime
import traceback
from sqlalchemy.orm import joinedload
from dhf_app.extensions import db
from dhf_app.models import User, Shift, ShiftType


class WeekendBalanceCalculator:
    """
    Service-Klasse zur Berechnung der Wochenend-Bilanz.
    FIX: Lädt Schichtarten separat in Python (vermeidet SQL-Join-Probleme).
    """

    def __init__(self, year, shift_plan_id=None):
        self.year = year
        self.shift_plan_id = shift_plan_id
        self.start_of_year = datetime.date(year, 1, 1)
        self.end_of_year = datetime.date(year, 12, 31)

    def calculate_balances(self):
        try:
            # 1. Relevante Benutzer holen
            relevant_users = self._get_relevant_users_safe()
            if not relevant_users:
                return []

            # 2. Bulk-Load der Schichten (und Schichtarten-Map)
            user_ids = [u.id for u in relevant_users]
            weekend_shift_counts = self._get_weekend_shift_counts_bulk(user_ids)

            results = []

            for user in relevant_users:
                try:
                    # 3. Zeitraum berechnen
                    active_start, active_end = self._get_user_active_period(user)

                    # 4. Mögliche Wochenenden
                    total_possible_weekends = self._count_weekends_in_range(active_start, active_end)

                    actual_weekends = weekend_shift_counts.get(user.id, 0)
                    percentage = 0.0

                    if total_possible_weekends > 0:
                        percentage = (actual_weekends / total_possible_weekends) * 100

                    # Namen
                    u_vorname = getattr(user, 'vorname', '')
                    u_nachname = getattr(user, 'name', '')
                    u_username = f"{u_vorname}.{u_nachname}".lower().replace(" ", ".")

                    entry_str = None
                    if active_start > self.start_of_year:
                        entry_str = str(active_start)

                    results.append({
                        'user_id': user.id,
                        'username': u_username,
                        'first_name': u_vorname,
                        'last_name': u_nachname,
                        'actual_weekends': actual_weekends,
                        'possible_weekends': total_possible_weekends,
                        'percentage': round(percentage, 2),
                        'entry_date': entry_str
                    })

                except Exception as user_e:
                    print(f"ERROR bei User ID {user.id}: {user_e}")
                    continue

            results.sort(key=lambda x: x['percentage'], reverse=True)
            return results

        except Exception as e:
            print("CRITICAL ERROR in calculate_balances:")
            traceback.print_exc()
            return []

    def _get_relevant_users_safe(self):
        try:
            query = db.session.query(User).options(joinedload(User.role))
            all_users = query.all()

            relevant = []
            allowed_roles_lower = ['admin', 'hundeführer', 'hundefuehrer', 'diensthundeführer']

            for u in all_users:
                # Inaktivitäts-Check
                inaktiv_ab = getattr(u, 'inaktiv_ab_datum', None)
                if inaktiv_ab:
                    inaktiv_date = self._to_date(inaktiv_ab)
                    if inaktiv_date < self.start_of_year:
                        continue

                        # Rollen Check
                role_obj = getattr(u, 'role', None)
                if not role_obj: continue

                role_name = getattr(role_obj, 'name', '')
                if role_name and role_name.lower() in allowed_roles_lower:
                    relevant.append(u)

            return relevant

        except Exception as e:
            print(f"DB QUERY ERROR: {e}")
            return []

    def _to_date(self, val):
        if isinstance(val, datetime.datetime):
            return val.date()
        return val

    def _get_user_active_period(self, user):
        start_date = self.start_of_year
        end_date = self.end_of_year

        raw_active_from = getattr(user, 'aktiv_ab_datum', None)
        if raw_active_from:
            u_active_from = self._to_date(raw_active_from)
            if u_active_from > self.start_of_year:
                start_date = u_active_from

        raw_exit = getattr(user, 'inaktiv_ab_datum', None)
        if raw_exit:
            u_exit = self._to_date(raw_exit)
            if u_exit < self.end_of_year:
                end_date = u_exit

        if start_date > end_date:
            return start_date, start_date

        return start_date, end_date

    def _count_weekends_in_range(self, start_date, end_date):
        if start_date > end_date:
            return 0

        d_start = self._to_date(start_date)
        d_end = self._to_date(end_date)

        day_count = (d_end - d_start).days + 1
        weekend_days = 0

        for n in range(day_count):
            single_date = d_start + datetime.timedelta(n)
            if single_date.weekday() >= 5:
                weekend_days += 1

        return weekend_days

    def _get_weekend_shift_counts_bulk(self, user_ids):
        """
        Lädt alle Schichtarten in eine Map und prüft dann die Schichten in Python.
        """
        if not user_ids:
            return {}

        try:
            # 1. Map aufbauen: ID -> Abkürzung (z.B. 5 -> 'T.')
            # Wir suchen nach 'abbreviation' (laut deiner schichtarten.js)
            all_types = db.session.query(ShiftType).all()
            # Map: ID -> Kürzel (in Kleinbuchstaben)
            type_map = {st.id: (st.abbreviation.lower() if st.abbreviation else '') for st in all_types}

            # Debug: Was haben wir gefunden?
            # print(f"DEBUG: Gefundene Schichtarten-Map: {type_map}")

            # 2. Schichten laden (nur die shifttype_id)
            shifts = db.session.query(Shift.user_id, Shift.date, Shift.shifttype_id).filter(
                Shift.user_id.in_(user_ids),
                Shift.date >= self.start_of_year,
                Shift.date <= self.end_of_year
            ).all()

            counts = {}

            # --- WHITELIST ---
            # Nur diese Kürzel zählen! (Kleinbuchstaben, Punkt beachten!)
            allowed_abbr = ['t.', 'n.', '24']

            for uid, s_date, st_id in shifts:
                if not s_date: continue
                if not st_id: continue  # Schicht ohne Typ wird ignoriert

                # Check gegen die Map
                abbr = type_map.get(st_id, '')

                # Wenn das Kürzel nicht in der Liste ist -> Skip
                if abbr not in allowed_abbr:
                    # Optional: Prüfe auch auf Namen wie 'Tag' oder 'Nacht', falls Kürzel fehlt
                    # Aber du wolltest strikt T., N., 24
                    continue

                check_date = self._to_date(s_date)
                if check_date.weekday() >= 5:
                    counts[uid] = counts.get(uid, 0) + 1

            return counts

        except Exception as e:
            print(f"ERROR reading shifts/types: {e}")
            traceback.print_exc()
            return {}