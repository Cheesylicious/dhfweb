# Neue Datei: dhf_app/routes_queries.py

from flask import Blueprint, request, jsonify, current_app
# --- NEUE IMPORTE ---
from .models import ShiftQuery, User, FeedbackReport
from .extensions import db
from .utils import admin_required, scheduler_or_admin_required
from flask_login import login_required, current_user
from sqlalchemy import extract, func
# --- ENDE NEUE IMPORTE ---
from datetime import datetime

# Erstellt einen Blueprint. Alle Routen hier beginnen mit /api/queries
query_bp = Blueprint('query', __name__, url_prefix='/api/queries')


# --- NEUE ROUTE FÜR BENACHRICHTIGUNGS-ZÄHLER ---
@query_bp.route('/notifications_summary', methods=['GET'])
@login_required
def get_notifications_summary():
    """
    Ruft eine Zusammenfassung aller relevanten Benachrichtigungs-Zähler
    für den aktuell eingeloggten Benutzer ab.
    """

    # (Regel 2: Innovativ - wir holen das Datum nur einmal)
    now = datetime.utcnow()
    current_year = now.year
    current_month = now.month

    response = {
        "new_feedback_count": 0,
        "open_shift_queries_count": 0
    }

    try:
        user_role = current_user.role.name if current_user.role else ""

        # 1. Zähler für Admins (Neue Meldungen)
        if user_role == 'admin':
            # (Logik aus routes_feedback.py übernommen, Regel 2: Performant)
            count = db.session.query(func.count(FeedbackReport.id)).filter(
                FeedbackReport.status == 'neu'
            ).scalar()
            response["new_feedback_count"] = count

        # 2. Zähler für Admins UND Planschreiber (Offene Anfragen)
        # (Wir zählen alle offenen Anfragen, nicht nur diesen Monat,
        #  damit alte Anfragen nicht übersehen werden)
        if user_role in ['admin', 'Planschreiber']:
            count = db.session.query(func.count(ShiftQuery.id)).filter(
                ShiftQuery.status == 'offen'
            ).scalar()
            response["open_shift_queries_count"] = count

        return jsonify(response), 200

    except Exception as e:
        current_app.logger.error(f"Fehler beim Erstellen von Notification Summary: {str(e)}")
        # (Selbst bei Fehler senden wir ein leeres 200 OK, damit das UI nicht blockiert)
        return jsonify(response), 200


# --- ENDE NEUE ROUTE ---


@query_bp.route('', methods=['POST'])
@scheduler_or_admin_required  # Planschreiber oder Admin darf erstellen
def create_shift_query():
    """
    Erstellt eine neue Schicht-Anfrage oder aktualisiert eine bestehende offene Anfrage.
    """
    data = request.get_json()
    try:
        # --- KORREKTUR: Validierung VOR der int()-Umwandlung ---
        target_user_id_raw = data.get('target_user_id')
        shift_date_str = data.get('shift_date')
        message = data.get('message')

        if not target_user_id_raw or not shift_date_str or not message:
            return jsonify({"message": "target_user_id, shift_date und message sind erforderlich"}), 400

        # Sichere Umwandlung, NACHDEM wir wissen, dass der Wert existiert
        target_user_id = int(target_user_id_raw)
        # --- ENDE KORREKTUR ---

        shift_date = datetime.fromisoformat(shift_date_str).date()

        # Prüfen, ob für diese Zelle schon eine offene Anfrage existiert
        # (Regel 2: Innovativ - wir überschreiben die alte Anfrage statt Duplikate zu erzeugen)
        existing_query = ShiftQuery.query.filter_by(
            target_user_id=target_user_id,
            shift_date=shift_date,
            status='offen'
        ).first()

        if existing_query:
            # Alte Anfrage aktualisieren
            existing_query.message = message
            existing_query.sender_user_id = current_user.id
            existing_query.created_at = datetime.utcnow()
            db.session.add(existing_query)
        else:
            # Neue Anfrage erstellen
            new_query = ShiftQuery(
                sender_user_id=current_user.id,
                target_user_id=target_user_id,
                shift_date=shift_date,
                message=message,
                status='offen'
            )
            db.session.add(new_query)

        db.session.commit()
        return jsonify({"message": "Anfrage gespeichert."}), 201

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler beim Erstellen von ShiftQuery: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


@query_bp.route('', methods=['GET'])
@scheduler_or_admin_required  # Planschreiber oder Admin darf lesen
def get_shift_queries():
    """
    Ruft alle Schicht-Anfragen für einen bestimmten Monat ab.
    Optional filterbar nach Status.
    """
    year = request.args.get('year')
    month = request.args.get('month')
    status = request.args.get('status')  # Optional: 'offen' oder 'erledigt'

    if not year or not month:
        return jsonify({"message": "Jahr und Monat sind erforderlich"}), 400

    try:
        query = ShiftQuery.query.filter(
            extract('year', ShiftQuery.shift_date) == int(year),
            extract('month', ShiftQuery.shift_date) == int(month)
        )
        if status in ['offen', 'erledigt']:
            query = query.filter_by(status=status)

        queries = query.all()
        return jsonify([q.to_dict() for q in queries]), 200

    except Exception as e:
        current_app.logger.error(f"Fehler beim Laden von ShiftQueries: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


@query_bp.route('/<int:query_id>/status', methods=['PUT'])
@admin_required  # Nur Admin darf Status ändern (z.B. auf 'erledigt')
def update_query_status(query_id):
    """
    Aktualisiert den Status einer Anfrage (z.B. 'offen' -> 'erledigt').
    Nur für Admins.
    """
    query = db.session.get(ShiftQuery, query_id)
    if not query:
        return jsonify({"message": "Anfrage nicht gefunden"}), 404

    data = request.get_json()
    new_status = data.get('status')

    if new_status not in ['offen', 'erledigt']:
        return jsonify({"message": "Ungültiger Status"}), 400

    try:
        query.status = new_status
        db.session.commit()
        return jsonify(query.to_dict()), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500