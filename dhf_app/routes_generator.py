# dhf_app/routes_generator.py

from flask import Blueprint, request, jsonify, current_app
from .utils import admin_required
from .models import GlobalSetting, UpdateLog, User
from .extensions import db
import json
import threading
from datetime import datetime

# Wir importieren die Generator-Klasse
try:
    from .generator.core import ShiftPlanGenerator
except ImportError:
    ShiftPlanGenerator = None

generator_bp = Blueprint('generator', __name__, url_prefix='/api/generator')

# Globale Variablen zur Statusverfolgung
GENERATOR_STATE = {
    "is_running": False,
    "progress": 0,
    "status": "idle",
    "logs": [],
    "instance": None
}


def _generator_task(app, year, month, variant_id=None):
    """
    Der Hintergrund-Task, der den Generator ausführt.
    Jetzt mit Unterstützung für Varianten.
    """
    with app.app_context():
        try:
            GENERATOR_STATE["is_running"] = True
            GENERATOR_STATE["status"] = "running"
            GENERATOR_STATE["progress"] = 0
            GENERATOR_STATE["logs"] = []

            def log_callback(msg, progress=None):
                if progress is not None:
                    GENERATOR_STATE["progress"] = progress
                GENERATOR_STATE["logs"].append(msg)
                if len(GENERATOR_STATE["logs"]) > 100:
                    GENERATOR_STATE["logs"].pop(0)

            if ShiftPlanGenerator:
                # <<< NEU: variant_id übergeben
                gen = ShiftPlanGenerator(db, year, month, log_callback, variant_id)
                GENERATOR_STATE["instance"] = gen
                success = gen.run()

                if success:
                    GENERATOR_STATE["status"] = "finished"
                    GENERATOR_STATE["progress"] = 100

                    # Info für Log
                    plan_info = f"Variante {variant_id}" if variant_id else "Hauptplan"

                    new_log = UpdateLog(
                        area="Schichtplan Generator",
                        description=f"Plan für {month:02d}/{year} ({plan_info}) erfolgreich generiert.",
                        updated_at=datetime.utcnow()
                    )
                    db.session.add(new_log)
                    db.session.commit()
                else:
                    GENERATOR_STATE["status"] = "error"
            else:
                log_callback("[CRITICAL] Generator-Klasse nicht gefunden.")
                GENERATOR_STATE["status"] = "error"

        except Exception as e:
            GENERATOR_STATE["status"] = "error"
            GENERATOR_STATE["logs"].append(f"[EXCEPTION] {str(e)}")
            current_app.logger.error(f"Generator Exception: {e}")
        finally:
            GENERATOR_STATE["is_running"] = False


@generator_bp.route('/start', methods=['POST'])
@admin_required
def start_generator():
    """
    Startet den Generator-Prozess.
    Erwartet optional 'variant_id' im Body.
    """
    if GENERATOR_STATE["is_running"]:
        return jsonify({"message": "Generator läuft bereits."}), 409

    data = request.get_json()
    year = data.get('year')
    month = data.get('month')
    # <<< NEU: Variant ID auslesen
    variant_id = data.get('variant_id') # Kann None sein

    if not year or not month:
        return jsonify({"message": "Jahr und Monat erforderlich."}), 400

    app = current_app._get_current_object()
    # <<< NEU: variant_id an Thread übergeben
    thread = threading.Thread(target=_generator_task, args=(app, year, month, variant_id))
    thread.start()

    return jsonify({"message": "Generator gestartet."}), 202


@generator_bp.route('/status', methods=['GET'])
@admin_required
def get_generator_status():
    """
    Gibt den aktuellen Status zurück.
    """
    return jsonify({
        "is_running": GENERATOR_STATE["is_running"],
        "status": GENERATOR_STATE["status"],
        "progress": GENERATOR_STATE["progress"],
        "logs": GENERATOR_STATE["logs"]
    }), 200


@generator_bp.route('/config', methods=['GET'])
@admin_required
def get_generator_config():
    """
    Lädt die Generator-Konfiguration.
    """
    setting = GlobalSetting.query.filter_by(key='generator_config').first()
    if setting and setting.value:
        try:
            config = json.loads(setting.value)
            return jsonify(config), 200
        except json.JSONDecodeError:
            return jsonify({"message": "Fehler beim Parsen der Konfiguration."}), 500

    # Standard-Werte
    default_config = {
        "max_consecutive_same_shift": 4,
        "mandatory_rest_days_after_max_shifts": 2,
        "generator_fill_rounds": 3,
        "fairness_threshold_hours": 10.0,
        "min_hours_score_multiplier": 5.0,
        "max_monthly_hours": 170.0,
        "shifts_to_plan": ["6", "T.", "N."]
    }
    return jsonify(default_config), 200


@generator_bp.route('/config', methods=['PUT'])
@admin_required
def update_generator_config():
    """
    Speichert die Generator-Konfiguration.
    """
    data = request.get_json()
    if not data:
        return jsonify({"message": "Keine Daten gesendet."}), 400

    try:
        json_str = json.dumps(data)

        setting = GlobalSetting.query.filter_by(key='generator_config').first()
        if not setting:
            setting = GlobalSetting(key='generator_config', value=json_str)
            db.session.add(setting)
        else:
            setting.value = json_str

        new_log = UpdateLog(
            area="Generator Einstellungen",
            description="Konfiguration aktualisiert.",
            updated_at=datetime.utcnow()
        )
        db.session.add(new_log)

        db.session.commit()
        return jsonify({"message": "Konfiguration gespeichert."}), 200

    except Exception as e:
        db.session.rollback()
        return jsonify({"message": f"Fehler beim Speichern: {str(e)}"}), 500