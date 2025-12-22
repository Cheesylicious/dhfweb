import datetime
import calendar
import traceback
from sqlalchemy import func
from sqlalchemy.orm import joinedload
# WICHTIG: Absolute Importe (dhf_app.X) verhindern Pfad-Fehler!
from dhf_app.extensions import db
from dhf_app.models import User, Shift, ShiftType, SpecialDate
# NEU: GamificationSettings und Shop-Modelle importiert
from dhf_app.models_gamification import GamificationLog, UserGamificationStats, GamificationSettings
from dhf_app.models_shop import UserActiveEffect


class GamificationService:
    """
    Zentraler Service für Gamification-Logik.
    VERSION: DYNAMISCH (Werte aus Datenbank) + SHOP INTEGRATION.
    """

    XP_PER_LEVEL = 1000

    @staticmethod
    def get_settings():
        """
        Holt die XP-Einstellungen aus der DB oder erstellt Standards.
        """
        try:
            settings = GamificationSettings.query.first()
            if not settings:
                settings = GamificationSettings()
                db.session.add(settings)
                db.session.commit()
            return settings
        except Exception as e:
            print(f"Fehler beim Laden der Settings: {e}")
            return GamificationSettings()  # Fallback mit Defaults

    @staticmethod
    def get_rank_info(level):
        if level >= 100: return "🏆 K9-Master", "#FFD700"
        if level >= 90:  return "🌟 Legende", "#00ffff"
        if level >= 75:  return "👑 Rudelführer", "#e74c3c"
        if level >= 50:  return "🛡️ Beschützer", "#2ecc71"
        if level >= 25:  return "🔎 Spürhund", "#3498db"
        if level >= 10:  return "🐕 Team-Mitglied", "#bdc3c7"
        return "🥚 Anwärter", "#7f8c8d"

    @staticmethod
    def get_current_multiplier(user_id):
        """
        Ermittelt den AKTUELLEN Multiplikator für einen User (für Anzeige im Frontend).
        """
        now = datetime.datetime.utcnow()
        effects = UserActiveEffect.query.filter(
            UserActiveEffect.user_id == user_id,
            UserActiveEffect.end_date > now
        ).all()

        mult = 1.0
        for e in effects:
            if e.multiplier_value > 1.0:
                mult += (e.multiplier_value - 1.0)
        return mult

    @staticmethod
    def get_dashboard_data(user_id):
        try:
            stats = UserGamificationStats.query.filter_by(user_id=user_id).first()
            if not stats:
                stats = UserGamificationStats(user_id=user_id)
                db.session.add(stats)
                db.session.commit()

            rank_name, rank_color = GamificationService.get_rank_info(stats.current_level)

            recent_logs = db.session.query(GamificationLog) \
                .filter_by(user_id=user_id) \
                .order_by(GamificationLog.created_at.desc()) \
                .limit(5).all()

            logs_data = [{
                'description': log.description,
                'points_awarded': log.points_awarded,
                'action_type': log.action_type,
                'created_at': log.created_at.strftime('%d.%m.')
            } for log in recent_logs]

            xp_in_level = stats.points_total % GamificationService.XP_PER_LEVEL
            if stats.current_level >= 100: xp_in_level = 1000

            # NEU: Aktuellen Multiplikator anzeigen
            current_mult = GamificationService.get_current_multiplier(user_id)

            return {
                'stats': {
                    'current_level': stats.current_level,
                    'points_total': stats.points_total,
                    'rank_name': rank_name,
                    'rank_color': rank_color,
                    'xp_current': xp_in_level,
                    'xp_max': GamificationService.XP_PER_LEVEL,
                    'active_multiplier': current_mult  # Für UI Anzeige (z.B. "1.5x Boost aktiv")
                },
                'logs': logs_data
            }
        except Exception as e:
            print(f"ERROR in get_dashboard_data: {e}")
            return {
                'stats': {'current_level': 1, 'points_total': 0, 'rank_name': 'Fehler', 'rank_color': 'gray',
                          'xp_current': 0, 'xp_max': 1000, 'active_multiplier': 1.0},
                'logs': []
            }

    @staticmethod
    def get_full_history(user_id, limit=100):
        try:
            logs = db.session.query(GamificationLog) \
                .filter_by(user_id=user_id) \
                .order_by(GamificationLog.created_at.desc()) \
                .limit(limit).all()

            return [{
                'description': log.description,
                'points_awarded': log.points_awarded,
                'action_type': log.action_type,
                'created_at': log.created_at.strftime('%d.%m.%Y')
            } for log in logs]
        except Exception as e:
            print(f"ERROR getting history: {e}")
            return []

    @staticmethod
    def get_global_ranking():
        try:
            results = db.session.query(User, UserGamificationStats) \
                .options(joinedload(User.role)) \
                .outerjoin(UserGamificationStats, User.id == UserGamificationStats.user_id) \
                .filter(
                (User.inaktiv_ab_datum == None) | (User.inaktiv_ab_datum > datetime.date.today())
            ).all()

            ranking_list = []
            allowed_roles = ['admin', 'hundeführer', 'hundefuehrer', 'diensthundeführer']

            for user, stats in results:
                if not user.role: continue

                role_name = user.role.name.lower() if user.role.name else ''
                if role_name not in allowed_roles: continue

                points = stats.points_total if stats else 0
                level = stats.current_level if stats else 1

                rank_title, rank_color = GamificationService.get_rank_info(level)

                u_vorname = getattr(user, 'vorname', '')
                u_name = getattr(user, 'name', '')
                full_name = f"{u_name}, {u_vorname}" if u_name and u_vorname else user.username

                ranking_list.append({
                    'user_id': user.id,
                    'name': full_name,
                    'points': points,
                    'level': level,
                    'rank_title': rank_title,
                    'rank_color': rank_color
                })

            ranking_list.sort(key=lambda x: x['points'], reverse=True)

            for i, entry in enumerate(ranking_list):
                entry['position'] = i + 1

            return ranking_list

        except Exception as e:
            print(f"ERROR getting ranking: {e}")
            traceback.print_exc()
            return []

    @staticmethod
    def calculate_fairness_metrics():
        print(">>> STARTE XP-NEUBERECHNUNG (Dynamic Mode + Shop Support) <<<")
        try:
            current_year = datetime.date.today().year
            start_of_year = datetime.date(current_year, 1, 1)
            today = datetime.date.today()

            # 1. EINSTELLUNGEN LADEN
            settings = GamificationService.get_settings()

            # A. VORBEREITUNG
            type_map = {}
            try:
                all_types = db.session.query(ShiftType).all()
                type_map = {st.id: (st.abbreviation.lower() if st.abbreviation else '') for st in all_types}
            except Exception as e:
                print(f"WARNUNG: Konnte Schichtarten nicht laden ({e}).")

            holiday_dates = set()
            try:
                holidays = db.session.query(SpecialDate).filter(
                    SpecialDate.type == 'holiday',
                    SpecialDate.date >= start_of_year
                ).all()
                holiday_dates = {h.date for h in holidays if h.date}
            except Exception as e:
                print(f"WARNUNG: Konnte Feiertage nicht laden ({e}).")

            # --- NEU: PERFORMANCE CACHE FÜR SHOP ITEMS ---
            # Wir laden alle Effekte einmalig, anstatt für jede Schicht eine Query zu senden.
            # Das beschleunigt die Berechnung massiv.
            effects_cache = {}  # Dict: user_id -> List of items
            try:
                all_effects = UserActiveEffect.query.all()
                for eff in all_effects:
                    if eff.user_id not in effects_cache:
                        effects_cache[eff.user_id] = []
                    effects_cache[eff.user_id].append({
                        'start': eff.start_date,
                        'end': eff.end_date,
                        'value': eff.multiplier_value
                    })
            except Exception as e:
                print(f"WARNUNG: Konnte Shop-Effekte nicht laden ({e}).")
            # ---------------------------------------------

            # B. RESET
            db.session.query(GamificationLog).filter(
                GamificationLog.action_type.in_(['shift', 'bonus_health']),
                GamificationLog.created_at >= start_of_year
            ).delete(synchronize_session=False)
            db.session.commit()

            # C. BERECHNUNG
            shifts = db.session.query(Shift).filter(
                Shift.date >= start_of_year,
                Shift.date < today
            ).all()

            new_logs = []
            user_ids = set()

            for shift in shifts:
                st_id = getattr(shift, 'shifttype_id', None)
                if not st_id: continue

                abbr = type_map.get(st_id, '')
                if not abbr: continue

                user_ids.add(shift.user_id)

                # Übergabe der Settings UND des Effects-Cache an die Berechnung
                points, desc = GamificationService._calc_shift_points(shift, abbr, holiday_dates, settings,
                                                                      effects_cache)

                if points > 0:
                    log = GamificationLog(
                        user_id=shift.user_id,
                        shift_id=shift.id,
                        points_awarded=points,
                        description=desc,
                        action_type='shift',
                        created_at=datetime.datetime.combine(shift.date, datetime.time(12, 0))
                    )
                    new_logs.append(log)

            # D. BONUS: Gesundheits-Check
            current_month = today.month
            months_to_check = range(1, current_month)

            for uid in user_ids:
                for m in months_to_check:
                    if not GamificationService._check_user_sick(uid, m, current_year, type_map):
                        last_day = calendar.monthrange(current_year, m)[1]
                        bonus_date = datetime.datetime(current_year, m, last_day, 23, 59)

                        # Wert aus Settings nutzen
                        log = GamificationLog(
                            user_id=uid,
                            points_awarded=settings.xp_health_bonus,
                            description=f"Gesundheits-Bonus ({m:02d}/{current_year})",
                            action_type='bonus_health',
                            created_at=bonus_date
                        )
                        new_logs.append(log)

            # E. SPEICHERN
            if new_logs:
                db.session.bulk_save_objects(new_logs)
                db.session.commit()
                print(f">>> {len(new_logs)} Logs erstellt.")
                GamificationService._update_all_user_stats(user_ids)
            else:
                print(">>> Keine Logs zu erstellen.")

        except Exception as e:
            print("CRITICAL ERROR in calculate_fairness_metrics:")
            traceback.print_exc()
            db.session.rollback()
            raise e

    @staticmethod
    def _calc_shift_points(shift, abbr, holiday_dates, settings, effects_cache=None):
        """
        Berechnet Punkte basierend auf den dynamischen Einstellungen UND Shop-Boostern.
        """
        wd = shift.date.weekday()
        is_weekend = wd >= 5
        is_friday = wd == 4
        is_holiday = shift.date in holiday_dates

        points = 0
        desc = ""

        # Dynamische Werte aus settings nutzen
        if 't.' in abbr:
            points = settings.xp_tag_weekend if is_weekend else settings.xp_tag_workday
            desc = "Tagdienst"
        elif '6' in abbr and is_friday:
            points = settings.xp_friday_6
            desc = "Freitag (6er)"
        elif 'n.' in abbr:
            points = settings.xp_night
            desc = "Nachtdienst"
        elif '24' in abbr:
            points = settings.xp_24h
            desc = "24h Dienst"

        if points == 0:
            return 0, ""

        if is_holiday:
            # Multiplikator aus Settings
            points = int(points * settings.xp_holiday_mult)
            desc += f" (Feiertag x{settings.xp_holiday_mult})"

        # --- NEU: SHOP MULTIPLIKATOR ANWENDEN ---
        # Wir prüfen im Cache, ob der User zum Zeitpunkt der Schicht einen Booster hatte
        multiplier = 1.0
        if effects_cache and shift.user_id in effects_cache:
            shift_datetime = datetime.datetime.combine(shift.date, datetime.time(12, 0))
            for eff in effects_cache[shift.user_id]:
                # Datumsvergleich: War der Effekt zum Schichtzeitpunkt aktiv?
                # Wir konvertieren sicherheitshalber Start/Ende auf Datetime falls nötig
                start = eff['start']
                end = eff['end']
                if start <= shift_datetime <= end:
                    if eff['value'] > 1.0:
                        multiplier += (eff['value'] - 1.0)

        if multiplier > 1.0:
            original_points = points
            points = int(points * multiplier)
            bonus = points - original_points
            desc += f" [Booster +{bonus}]"
        # ----------------------------------------

        return points, f"{desc} ({abbr.upper()})"

    @staticmethod
    def _check_user_sick(user_id, month, year, type_map):
        start_date = datetime.date(year, month, 1)
        last_day = calendar.monthrange(year, month)[1]
        end_date = datetime.date(year, month, last_day)

        user_shifts = db.session.query(Shift).filter(
            Shift.user_id == user_id,
            Shift.date >= start_date,
            Shift.date <= end_date
        ).all()

        for s in user_shifts:
            st_id = getattr(s, 'shifttype_id', None)
            if not st_id: continue
            abbr = type_map.get(st_id, '')
            if 'k' in abbr or 'krank' in abbr:
                return True

        return False

    @staticmethod
    def _update_all_user_stats(user_ids):
        print(">>> Aktualisiere User-Stats...")
        for uid in user_ids:
            total = db.session.query(func.sum(GamificationLog.points_awarded)) \
                        .filter_by(user_id=uid).scalar() or 0

            stats = UserGamificationStats.query.filter_by(user_id=uid).first()
            if not stats:
                stats = UserGamificationStats(user_id=uid)
                db.session.add(stats)

            stats.points_total = total
            stats.current_level = int(total / GamificationService.XP_PER_LEVEL) + 1
            if stats.current_level > 100: stats.current_level = 100

            r_name, _ = GamificationService.get_rank_info(stats.current_level)
            stats.current_rank = r_name
            stats.last_updated = datetime.datetime.utcnow()

        db.session.commit()
        print(">>> User-Stats aktualisiert.")