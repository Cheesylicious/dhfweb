from flask import Blueprint, jsonify, request
from flask_login import login_required, current_user
import datetime

# Imports
from dhf_app.extensions import db  # Wichtig für DB-Commits beim Speichern der Settings
from .services_gamification import GamificationService
from .services.balance_calculator import WeekendBalanceCalculator
from .models_gamification import UserGamificationStats, GamificationSettings

gamification_bp = Blueprint('gamification_bp', __name__)


@gamification_bp.route('/api/gamification/dashboard', methods=['GET'])
@login_required
def get_dashboard_data():
    """
    API-Endpunkt für das Gamification-Widget.
    ENTHÄLT: Automatische tägliche Neuberechnung (Auto-Update).
    """
    try:
        # --- AUTO-UPDATE CHECK ---
        needs_update = False

        try:
            # Hole Stats des aktuellen Users
            my_stats = UserGamificationStats.query.filter_by(user_id=current_user.id).first()

            if not my_stats:
                needs_update = True
            else:
                last_update_date = my_stats.last_updated.date()
                today = datetime.date.today()

                if last_update_date < today:
                    needs_update = True
                    # print(f">>> AUTO-UPDATE: Letzter Stand vom {last_update_date}. Starte Neuberechnung...")

            if needs_update:
                GamificationService.calculate_fairness_metrics()

        except Exception as e:
            print(f"Warnung beim Auto-Update Check: {e}")

        # --- DATEN LADEN ---
        try:
            data = GamificationService.get_dashboard_data(current_user.id)
        except Exception as e:
            data = {'stats': {'current_level': 1, 'points_total': 0}, 'logs': []}

        # 2. Fairness-Werte (Balance) LIVE berechnen
        current_year = datetime.date.today().year
        calculator = WeekendBalanceCalculator(year=current_year)
        all_stats = calculator.calculate_balances()

        balance_diff = 0.0
        user_percentage = 0.0
        team_average = 0.0

        if all_stats:
            total_percentage = sum(u['percentage'] for u in all_stats)
            team_average = total_percentage / len(all_stats)

            my_stat = next((u for u in all_stats if u['user_id'] == current_user.id), None)

            if my_stat:
                user_percentage = my_stat['percentage']
                balance_diff = user_percentage - team_average

        if 'stats' not in data:
            data['stats'] = {}

        data['stats']['weekend_balance'] = round(balance_diff, 1)
        data['stats']['user_percentage'] = round(user_percentage, 1)
        data['stats']['team_average'] = round(team_average, 1)

        return jsonify(data), 200

    except Exception as e:
        print(f"KRITISCHER FEHLER in get_dashboard_data: {e}")
        return jsonify({'error': 'Daten konnten nicht geladen werden', 'details': str(e)}), 500


@gamification_bp.route('/api/gamification/ranking', methods=['GET'])
@login_required
def get_ranking_data():
    """
    Liefert die globale Rangliste aller aktiven Mitarbeiter.
    """
    try:
        ranking = GamificationService.get_global_ranking()
        return jsonify(ranking), 200
    except Exception as e:
        print(f"Fehler beim Laden der Rangliste: {e}")
        return jsonify({'error': 'Fehler beim Laden der Rangliste', 'details': str(e)}), 500


@gamification_bp.route('/api/gamification/history', methods=['GET'])
@login_required
def get_history_data():
    """
    Liefert die detaillierte Punkte-Historie des aktuellen Users.
    """
    try:
        # Standardmäßig die letzten 100 Einträge laden
        history = GamificationService.get_full_history(current_user.id, limit=100)
        return jsonify(history), 200
    except Exception as e:
        print(f"Fehler beim Laden der Historie: {e}")
        return jsonify({'error': 'Fehler beim Laden der Historie', 'details': str(e)}), 500


@gamification_bp.route('/api/gamification/settings', methods=['GET'])
@login_required
def get_gamification_settings():
    """
    ADMIN ONLY: Lädt die aktuellen XP-Einstellungen.
    """
    if not current_user.role or current_user.role.name != 'admin':
        return jsonify({'error': 'Zugriff verweigert.'}), 403

    try:
        settings = GamificationService.get_settings()
        return jsonify(settings.to_dict()), 200
    except Exception as e:
        return jsonify({'error': 'Fehler beim Laden der Einstellungen', 'details': str(e)}), 500


@gamification_bp.route('/api/gamification/settings', methods=['PUT'])
@login_required
def update_gamification_settings():
    """
    ADMIN ONLY: Speichert neue XP-Werte und berechnet ALLES neu (sofortige Wirkung).
    """
    if not current_user.role or current_user.role.name != 'admin':
        return jsonify({'error': 'Zugriff verweigert.'}), 403

    try:
        data = request.get_json()
        settings = GamificationService.get_settings()  # Holt das ORM Objekt

        # Werte aktualisieren (mit Typumwandlung zur Sicherheit)
        if 'xp_tag_workday' in data: settings.xp_tag_workday = int(data['xp_tag_workday'])
        if 'xp_tag_weekend' in data: settings.xp_tag_weekend = int(data['xp_tag_weekend'])
        if 'xp_night' in data:       settings.xp_night = int(data['xp_night'])
        if 'xp_24h' in data:         settings.xp_24h = int(data['xp_24h'])
        if 'xp_friday_6' in data:    settings.xp_friday_6 = int(data['xp_friday_6'])
        if 'xp_health_bonus' in data: settings.xp_health_bonus = int(data['xp_health_bonus'])
        if 'xp_holiday_mult' in data: settings.xp_holiday_mult = float(data['xp_holiday_mult'])

        # Speichern
        db.session.commit()

        # SOFORTIGE NEUBERECHNUNG ALLER USER
        # Damit die Änderung sofort im Dashboard sichtbar ist
        GamificationService.calculate_fairness_metrics()

        return jsonify({'message': 'Einstellungen gespeichert und Punkte neu berechnet.'}), 200

    except Exception as e:
        db.session.rollback()
        print(f"Fehler beim Speichern der Settings: {e}")
        return jsonify({'error': 'Fehler beim Speichern', 'details': str(e)}), 500


@gamification_bp.route('/api/gamification/recalc', methods=['POST'])
@login_required
def trigger_recalculation():
    """
    Admin-only: Erzwingt eine manuelle Neuberechnung.
    """
    if not current_user.role or current_user.role.name != 'admin':
        return jsonify({'error': 'Zugriff verweigert.'}), 403
    try:
        GamificationService.calculate_fairness_metrics()
        return jsonify({'message': 'Fairness-Werte aktualisiert.'}), 200
    except Exception as e:
        return jsonify({'error': 'Fehler', 'details': str(e)}), 500