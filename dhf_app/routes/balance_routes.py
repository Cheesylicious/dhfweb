from flask import Blueprint, jsonify, request
import datetime

# Import des Services, den wir im vorherigen Schritt erstellt haben.
# Stelle sicher, dass die Datei 'services/balance_calculator.py' existiert.
from dhf_app.services.balance_calculator import WeekendBalanceCalculator

# Wir erstellen einen neuen Blueprint. Das ist wie eine "Mini-App" innerhalb deiner Flask-App.
balance_bp = Blueprint('balance_routes', __name__)


@balance_bp.route('/api/shift-plans/<int:shift_plan_id>/weekend-balance', methods=['GET'])
def get_weekend_balance(shift_plan_id):
    """
    API-Endpunkt zum Abrufen der Wochenend-Bilanz für einen spezifischen Schichtplan.

    Parameter:
        - shift_plan_id (URL): ID des Schichtplans.
        - year (Query Param, optional): Das Jahr, für das berechnet werden soll (Standard: aktuelles Jahr).

    Rückgabe:
        - JSON mit den bereinigten Statistiken (unter Berücksichtigung von Ein-/Austritt und Rollen).
    """
    try:
        # 1. Jahr aus den Parametern holen oder aktuelles Jahr nehmen
        current_year = datetime.date.today().year
        year_param = request.args.get('year', default=current_year, type=int)

        # 2. Service initialisieren
        # Hier wird die Logik sauber gekapselt aufgerufen.
        calculator = WeekendBalanceCalculator(year=year_param, shift_plan_id=shift_plan_id)

        # 3. Berechnung durchführen
        # Da der Service optimiert ist (Bulk-Abfragen), geht das sehr schnell.
        balance_data = calculator.calculate_balances()

        # 4. Antwort zurückgeben
        return jsonify({
            'status': 'success',
            'meta': {
                'shift_plan_id': shift_plan_id,
                'year': year_param,
                'calculated_at': datetime.datetime.now().isoformat()
            },
            'data': balance_data
        }), 200

    except ValueError as ve:
        # Fängt spezifische Validierungsfehler ab (z.B. falsches Datumsformat)
        return jsonify({
            'status': 'error',
            'message': f"Validierungsfehler: {str(ve)}"
        }), 400

    except Exception as e:
        # Fängt unerwartete Fehler ab, damit der Server nicht abstürzt
        # In einer echten App hier idealerweise Logging hinzufügen (z.B. app.logger.error(e))
        print(f"KRITISCHER FEHLER in get_weekend_balance: {e}")
        return jsonify({
            'status': 'error',
            'message': "Ein interner Fehler ist bei der Berechnung aufgetreten."
        }), 500