# Neue Datei: dhf_app/routes_queries.py

from flask import Blueprint, request, jsonify, current_app
# --- NEUE IMPORTE ---
from .models import ShiftQuery, User, FeedbackReport, UpdateLog, ShiftQueryReply  # <<< ShiftQueryReply HINZUGEFÜGT
from .extensions import db
from .utils import admin_required, scheduler_or_admin_required
from flask_login import login_required, current_user
from sqlalchemy import extract, func
# --- ENDE NEUE IMPORTE ---
from datetime import datetime

# Erstellt einen Blueprint. Alle Routen hier beginnen mit /api/queries
query_bp = Blueprint('query', __name__, url_prefix='/api/queries')


# --- NEU: Hilfsfunktion (kopiert von routes_admin) ---
def _log_update_event(area, description):
    """
    Erstellt einen Eintrag im UpdateLog.
    """
    new_log = UpdateLog(
        area=area,
        description=description,
        updated_at=datetime.utcnow()
    )
    db.session.add(new_log)
    # Wichtig: KEIN db.session.commit() hier, da dies in der aufrufenden Funktion geschieht.


# --- ENDE NEU ---


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
        target_user_id_raw = data.get('target_user_id')
        shift_date_str = data.get('shift_date')
        message = data.get('message')

        # target_user_id_raw ist jetzt OPTIONAL. Wir prüfen nur auf Datum und Nachricht.
        if not shift_date_str or not message:
            return jsonify({"message": "shift_date und message sind erforderlich"}), 400

        # Sichere Umwandlung: Konvertiere nur wenn Wert vorhanden, sonst None
        if target_user_id_raw is None or target_user_id_raw == 'null' or target_user_id_raw == '':
            target_user_id = None
        else:
            try:
                target_user_id = int(target_user_id_raw)
            except (ValueError, TypeError):
                return jsonify({"message": "Ungültige target_user_id"}), 400

        shift_date = datetime.fromisoformat(shift_date_str).date()

        # Prüfen, ob für diese Zelle schon eine offene Anfrage existiert
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
    Ruft alle Schicht-Anfragen ab.
    Optional filterbar nach Jahr/Monat UND Status.
    """
    year = request.args.get('year')
    month = request.args.get('month')
    status = request.args.get('status')  # Optional: 'offen' oder 'erledigt'

    try:
        # Beginne mit der Basis-Abfrage
        query = ShiftQuery.query

        # Wende Datumsfilter nur an, wenn BEIDE (year und month) vorhanden sind
        if year and month:
            try:
                query = query.filter(
                    extract('year', ShiftQuery.shift_date) == int(year),
                    extract('month', ShiftQuery.shift_date) == int(month)
                )
            except ValueError:
                return jsonify({"message": "Ungültiges Jahr oder Monat"}), 400

        # Wende Statusfilter an, falls vorhanden
        if status in ['offen', 'erledigt']:
            query = query.filter_by(status=status)

        # Sortiere (optional, aber gut für die Anzeige)
        queries = query.order_by(ShiftQuery.created_at.desc()).all()

        return jsonify([q.to_dict() for q in queries]), 200

    except Exception as e:
        current_app.logger.error(f"Fehler beim Laden von ShiftQueries: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


@query_bp.route('/<int:query_id>/status', methods=['PUT'])
@scheduler_or_admin_required
def update_query_status(query_id):
    """
    Aktualisiert den Status einer Anfrage (z.B. 'offen' -> 'erledigt').
    Jetzt für Admins UND Planschreiber.
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

        # --- NEU: Logging (Regel 2) ---
        log_msg = f"Anfrage ID {query.id} als '{new_status}' markiert."
        _log_update_event("Schicht-Anfragen", log_msg)
        # --- ENDE NEU ---

        db.session.commit()
        return jsonify(query.to_dict()), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


# --- START: NEUE ROUTE (Regel 1, Regel 4) ---
@query_bp.route('/<int:query_id>', methods=['DELETE'])
@scheduler_or_admin_required  # Admins und Planschreiber dürfen löschen
def delete_shift_query(query_id):
    """
    Löscht eine Schicht-Anfrage endgültig.
    """
    query = db.session.get(ShiftQuery, query_id)
    if not query:
        return jsonify({"message": "Anfrage nicht gefunden"}), 404

    try:
        # Protokollieren VOR dem Löschen
        _log_update_event("Schicht-Anfragen", f"Anfrage ID {query.id} (Status: {query.status}) gelöscht.")

        db.session.delete(query)
        db.session.commit()
        return jsonify({"message": "Anfrage erfolgreich gelöscht"}), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler beim Löschen von ShiftQuery {query_id}: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


# --- ENDE: NEUE ROUTE ---


# --- START: NEUE ROUTEN FÜR ANTWORTEN (Replies) ---

@query_bp.route('/<int:query_id>/replies', methods=['GET'])
@scheduler_or_admin_required  # Admins und Planschreiber dürfen Konversationen sehen
def get_query_replies(query_id):
    """
    Ruft alle Antworten für eine spezifische ShiftQuery ab.
    """
    query = db.session.get(ShiftQuery, query_id)
    if not query:
        return jsonify({"message": "Anfrage nicht gefunden"}), 404

    # Sortiere nach Erstellungsdatum (älteste zuerst)
    replies = query.replies

    return jsonify([reply.to_dict() for reply in replies]), 200


@query_bp.route('/<int:query_id>/replies', methods=['POST'])
@scheduler_or_admin_required  # Admins und Planschreiber dürfen antworten
def create_query_reply(query_id):
    """
    Erstellt eine neue Antwort auf eine ShiftQuery.
    """
    query = db.session.get(ShiftQuery, query_id)
    if not query:
        return jsonify({"message": "Anfrage nicht gefunden"}), 404

    data = request.get_json()
    message = data.get('message')

    if not message:
        return jsonify({"message": "Nachricht ist erforderlich"}), 400

    new_reply = ShiftQueryReply(
        query_id=query_id,
        user_id=current_user.id,
        message=message,
        created_at=datetime.utcnow()
    )

    try:
        db.session.add(new_reply)

        # NEU: Antwort protokollieren (Regel 2)
        log_msg = f"Neue Antwort auf Anfrage ID {query_id} von {current_user.vorname}."
        _log_update_event("Schicht-Anfragen", log_msg)

        db.session.commit()
        return jsonify(new_reply.to_dict()), 201
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler beim Erstellen der Antwort für Query {query_id}: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500

# --- ENDE NEUE ROUTEN ---