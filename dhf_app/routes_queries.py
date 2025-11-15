# Neue Datei: dhf_app/routes_queries.py

from flask import Blueprint, request, jsonify, current_app
# --- NEUE IMPORTE ---
from .models import ShiftQuery, User, FeedbackReport, UpdateLog, ShiftQueryReply
from .extensions import db
from .utils import admin_required, scheduler_or_admin_required
from flask_login import login_required, current_user
from sqlalchemy import extract, func
# --- ENDE NEUE IMPORTE ---
from datetime import datetime
# --- START: HINZUGEFÜGT (Für performante Zählung) ---
from sqlalchemy.sql import select

# --- ENDE: HINZUGEFÜGT ---

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

    ANGEPASST: Zählt jetzt intelligent, wer zuletzt geantwortet hat.
    """

    response = {
        "new_feedback_count": 0,
        "new_replies_count": 0,  # (Umbenannt: Action Required)
        "waiting_on_others_count": 0  # (Umbenannt: Waiting)
    }

    try:
        user_role = current_user.role.name if current_user.role else ""

        # 1. Zähler für Admins (Neue Meldungen)
        if user_role == 'admin':
            count = db.session.query(func.count(FeedbackReport.id)).filter(
                FeedbackReport.status == 'neu'
            ).scalar()
            response["new_feedback_count"] = count

        # 2. Zähler für Admins UND Planschreiber
        if user_role in ['admin', 'Planschreiber']:

            current_user_id = current_user.id

            # --- START: KOMPLETT NEUE ZÄHL-LOGIK ---

            # A) Finde die ID des letzten Antwortenden für JEDE Anfrage
            # A.1: Subquery findet die *letzte* Antwort-Zeit für jede Query
            last_reply_sq = db.session.query(
                ShiftQueryReply.query_id,
                func.max(ShiftQueryReply.created_at).label('last_reply_time')
            ).group_by(ShiftQueryReply.query_id).subquery()

            # A.2: Subquery findet die user_id, die zur *letzten* Antwort-Zeit gehört
            last_reply_user_sq = db.session.query(
                ShiftQueryReply.query_id,
                ShiftQueryReply.user_id
            ).join(
                last_reply_sq,
                db.and_(
                    ShiftQueryReply.query_id == last_reply_sq.c.query_id,
                    ShiftQueryReply.created_at == last_reply_sq.c.last_reply_time
                )
            ).distinct(ShiftQueryReply.query_id).subquery()

            # B) Hole ALLE offenen Anfragen und verknüpfe sie (LEFT JOIN)
            #    mit dem letzten Antwortenden.
            query_results = db.session.query(
                ShiftQuery,
                last_reply_user_sq.c.user_id.label('last_replier_id')
            ).filter(
                ShiftQuery.status == 'offen'
            ).outerjoin(
                last_reply_user_sq,
                ShiftQuery.id == last_reply_user_sq.c.query_id
            ).all()

            # C) Initialisiere Zähler
            new_replies_count = 0  # (Action Required)
            waiting_on_others_count = 0  # (Waiting)

            # D) Sortiere die Anfragen in die beiden Kategorien
            for query, last_replier_id in query_results:

                if last_replier_id is None:
                    # FALL 1: Keine Antworten vorhanden
                    if query.sender_user_id == current_user_id:
                        # Ich habe sie erstellt, niemand hat geantwortet.
                        waiting_on_others_count += 1
                    else:
                        # Jemand anderes hat sie erstellt, niemand hat geantwortet.
                        new_replies_count += 1  # (Neue Aufgabe für mich)

                elif last_replier_id == current_user_id:
                    # FALL 2: ICH war der letzte Antwortende
                    waiting_on_others_count += 1

                else:
                    # FALL 3: Jemand ANDERES war der letzte Antwortende
                    new_replies_count += 1  # (Action Required)

            response["new_replies_count"] = new_replies_count
            response["waiting_on_others_count"] = waiting_on_others_count

            # --- ENDE: KOMPLETT NEUE ZÄHL-LOGIK ---

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

    NEU: Liefert jetzt 'last_replier_id' mit, um "Neue Antwort"
    im Frontend zu signalisieren.
    """
    year = request.args.get('year')
    month = request.args.get('month')
    status = request.args.get('status')  # Optional: 'offen' oder 'erledigt'

    try:
        # --- START: Subquery für letzten Antwortenden (identisch zu summary) ---
        # A.1: Subquery findet die *letzte* Antwort-Zeit für jede Query
        last_reply_sq = db.session.query(
            ShiftQueryReply.query_id,
            func.max(ShiftQueryReply.created_at).label('last_reply_time')
        ).group_by(ShiftQueryReply.query_id).subquery()

        # A.2: Subquery findet die user_id, die zur *letzten* Antwort-Zeit gehört
        last_reply_user_sq = db.session.query(
            ShiftQueryReply.query_id,
            ShiftQueryReply.user_id
        ).join(
            last_reply_sq,
            db.and_(
                ShiftQueryReply.query_id == last_reply_sq.c.query_id,
                ShiftQueryReply.created_at == last_reply_sq.c.last_reply_time
            )
        ).distinct(ShiftQueryReply.query_id).subquery()
        # --- ENDE: Subquery ---

        # Beginne mit der Basis-Abfrage
        query = db.session.query(
            ShiftQuery,
            last_reply_user_sq.c.user_id.label('last_replier_id')
        ).outerjoin(
            last_reply_user_sq,
            ShiftQuery.id == last_reply_user_sq.c.query_id
        )

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
            query = query.filter(ShiftQuery.status == status)

        # Sortiere
        query_results = query.order_by(ShiftQuery.created_at.desc()).all()

        # --- Manuelles Erstellen der Dictionaries ---
        response_list = []
        for query, last_replier_id in query_results:
            q_dict = query.to_dict()
            q_dict['last_replier_id'] = last_replier_id
            response_list.append(q_dict)

        return jsonify(response_list), 200

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

        # --- START: ANPASSUNG (Überschrift statt ID) ---
        date_str = query.shift_date.strftime('%d.%m.%Y')
        target_name = f"{query.target_user.vorname} {query.target_user.name}" if query.target_user else "Thema des Tages"
        log_msg = f"Anfrage ({target_name} am {date_str}) als '{new_status}' markiert."
        _log_update_event("Schicht-Anfragen", log_msg)
        # --- ENDE: ANPASSUNG ---

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
        # --- START: ANPASSUNG (Überschrift statt ID) ---
        # Protokollieren VOR dem Löschen
        date_str = query.shift_date.strftime('%d.%m.%Y')
        target_name = f"{query.target_user.vorname} {query.target_user.name}" if query.target_user else "Thema des Tages"
        _log_update_event("Schicht-Anfragen", f"Anfrage ({target_name} am {date_str}) gelöscht.")
        # --- ENDE: ANPASSUNG ---

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

        # --- START: ANPASSUNG (Überschrift statt ID) ---
        date_str = query.shift_date.strftime('%d.%m.%Y')
        target_name = f"{query.target_user.vorname} {query.target_user.name}" if query.target_user else "Thema des Tages"
        log_msg = f"Neue Antwort für '{target_name}' am {date_str} (von {current_user.vorname})."
        _log_update_event("Schicht-Anfragen", log_msg)
        # --- ENDE: ANPASSUNG ---

        db.session.commit()
        return jsonify(new_reply.to_dict()), 201
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler beim Erstellen der Antwort für Query {query_id}: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500

# --- ENDE NEUE ROUTEN ---