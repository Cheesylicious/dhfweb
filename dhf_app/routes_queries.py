# cheesylicious/dhfweb/dhfweb-ec604d738e9bd121b65cc8557f8bb98d2aa18062/dhf_app/routes_queries.py
# Neue Datei: dhf_app/routes_queries.py

from flask import Blueprint, request, jsonify, current_app
# --- IMPORTE ---
from .models import ShiftQuery, User, FeedbackReport, UpdateLog, ShiftQueryReply, Role
from .extensions import db
from sqlalchemy.orm import joinedload
from .utils import admin_required, scheduler_or_admin_required, query_roles_required
from flask_login import login_required, current_user
from sqlalchemy import extract, func, or_
from datetime import datetime
from sqlalchemy.sql import select
from sqlalchemy.exc import IntegrityError

# Erstellt einen Blueprint. Alle Routen hier beginnen mit /api/queries
query_bp = Blueprint('query', __name__, url_prefix='/api/queries')


# --- Hilfsfunktion ---
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


# --- ROUTE FÜR BENACHRICHTIGUNGS-ZÄHLER ---
@query_bp.route('/notifications_summary', methods=['GET'])
@login_required
def get_notifications_summary():
    """
    Ruft eine Zusammenfassung aller relevanten Benachrichtigungs-Zähler
    für den aktuell eingeloggten Benutzer ab.
    """

    response = {
        "new_feedback_count": 0,
        "new_wishes_count": 0,
        "new_notes_count": 0,
        "waiting_on_others_count": 0
    }

    try:
        user_role = current_user.role.name if current_user.role else ""

        # 1. Zähler für Admins (Neue Meldungen)
        if user_role == 'admin':
            count = db.session.query(func.count(FeedbackReport.id)).filter(
                FeedbackReport.status == 'neu'
            ).scalar()
            response["new_feedback_count"] = count

        # 2. Zähler für Admins UND Planschreiber UND Hundeführer
        if user_role in ['admin', 'Planschreiber', 'Hundeführer']:

            current_user_id = current_user.id

            # A) Subqueries für letzte Antwort
            last_reply_sq = db.session.query(
                ShiftQueryReply.query_id,
                func.max(ShiftQueryReply.created_at).label('last_reply_time')
            ).group_by(ShiftQueryReply.query_id).subquery()

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

            # B) Basis-Query
            base_query = db.session.query(
                ShiftQuery,
                last_reply_user_sq.c.user_id.label('last_replier_id')
            ).filter(
                ShiftQuery.status == 'offen'
            ).outerjoin(
                last_reply_user_sq,
                ShiftQuery.id == last_reply_user_sq.c.query_id
            ).options(
                joinedload(ShiftQuery.sender).joinedload(User.role)
            )

            if user_role == 'Hundeführer':
                base_query = base_query.filter(
                    or_(
                        ShiftQuery.sender_user_id == current_user_id,
                        ShiftQuery.target_user_id == current_user_id
                    )
                )

            query_results = base_query.all()

            # C) Zählen
            new_wishes = 0
            new_notes = 0
            waiting = 0

            for query, last_replier_id in query_results:

                # Filter für Planschreiber: Wünsche ignorieren
                sender_role_name = query.sender.role.name if query.sender and query.sender.role else ""
                is_wunsch = (sender_role_name == 'Hundeführer' and query.message.startswith("Anfrage für:"))

                if user_role == 'Planschreiber' and is_wunsch:
                    continue

                action_required = False

                if last_replier_id is None:
                    if query.sender_user_id == current_user_id:
                        waiting += 1
                    else:
                        action_required = True
                elif last_replier_id == current_user_id:
                    waiting += 1
                else:
                    action_required = True

                if action_required:
                    if is_wunsch:
                        new_wishes += 1
                    else:
                        new_notes += 1

            response["new_wishes_count"] = new_wishes
            response["new_notes_count"] = new_notes
            response["waiting_on_others_count"] = waiting

        return jsonify(response), 200

    except Exception as e:
        current_app.logger.error(f"Fehler beim Erstellen von Notification Summary: {str(e)}")
        return jsonify(response), 200


@query_bp.route('', methods=['POST'])
@query_roles_required
def create_shift_query():
    """
    Erstellt eine neue Schicht-Anfrage oder aktualisiert eine EIGENE bestehende.
    """
    data = request.get_json()
    try:
        target_user_id_raw = data.get('target_user_id')
        shift_date_str = data.get('shift_date')
        message = data.get('message')

        if not shift_date_str or not message:
            return jsonify({"message": "shift_date und message sind erforderlich"}), 400

        if target_user_id_raw is None or target_user_id_raw == 'null' or target_user_id_raw == '':
            target_user_id = None
        else:
            try:
                target_user_id = int(target_user_id_raw)
            except (ValueError, TypeError):
                return jsonify({"message": "Ungültige target_user_id"}), 400

        shift_date = datetime.fromisoformat(shift_date_str).date()

        user_role = current_user.role.name if current_user.role else ""
        if user_role == 'Hundeführer':
            if target_user_id != current_user.id:
                return jsonify({"message": "Hundeführer dürfen Anfragen nur für sich selbst erstellen."}), 403

        # --- WICHTIG: Prüfen, ob eine offene Anfrage VOM AKTUELLEN BENUTZER existiert ---
        existing_query = ShiftQuery.query.filter_by(
            target_user_id=target_user_id,
            shift_date=shift_date,
            status='offen',
            sender_user_id=current_user.id  # <<< KORREKTUR: Nur eigene Anfragen aktualisieren
        ).first()

        if existing_query:
            # Eigene Anfrage aktualisieren
            existing_query.message = message
            existing_query.created_at = datetime.utcnow()
            db.session.add(existing_query)
        else:
            # Neue Anfrage erstellen (auch wenn schon eine von einem anderen User da ist)
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
@query_roles_required
def get_shift_queries():
    """
    Ruft alle Schicht-Anfragen ab.
    """
    year = request.args.get('year')
    month = request.args.get('month')
    status = request.args.get('status')

    try:
        last_reply_sq = db.session.query(
            ShiftQueryReply.query_id,
            func.max(ShiftQueryReply.created_at).label('last_reply_time')
        ).group_by(ShiftQueryReply.query_id).subquery()

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

        query = db.session.query(
            ShiftQuery,
            last_reply_user_sq.c.user_id.label('last_replier_id')
        ).outerjoin(
            last_reply_user_sq,
            ShiftQuery.id == last_reply_user_sq.c.query_id
        ).options(
            # Performance: Lade Sender und Rolle für Frontend-Filterung
            joinedload(ShiftQuery.sender).joinedload(User.role)
        )

        if year and month:
            try:
                query = query.filter(
                    extract('year', ShiftQuery.shift_date) == int(year),
                    extract('month', ShiftQuery.shift_date) == int(month)
                )
            except ValueError:
                return jsonify({"message": "Ungültiges Jahr oder Monat"}), 400

        if status in ['offen', 'erledigt']:
            query = query.filter(ShiftQuery.status == status)

        user_role = current_user.role.name if current_user.role else ""
        if user_role == 'Hundeführer':
            query = query.filter(
                or_(
                    ShiftQuery.sender_user_id == current_user.id,
                    ShiftQuery.target_user_id == current_user.id
                )
            )

        query_results = query.order_by(ShiftQuery.created_at.desc()).all()

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
    Aktualisiert den Status einer Anfrage.
    """
    query = db.session.get(ShiftQuery, query_id)
    if not query:
        return jsonify({"message": "Anfrage nicht gefunden"}), 404

    # --- START: SCHUTZ FÜR PLANSCHREIBER ---
    user_role = current_user.role.name if current_user.role else ""
    if user_role == 'Planschreiber':
        sender_role = query.sender.role.name if query.sender and query.sender.role else ""
        is_wunsch = (sender_role == 'Hundeführer' and query.message.startswith("Anfrage für:"))
        if is_wunsch:
            return jsonify({"message": "Planschreiber dürfen Wunsch-Anfragen nicht bearbeiten."}), 403
    # --- ENDE: SCHUTZ ---

    data = request.get_json()
    new_status = data.get('status')

    if new_status not in ['offen', 'erledigt']:
        return jsonify({"message": "Ungültiger Status"}), 400

    try:
        query.status = new_status
        date_str = query.shift_date.strftime('%d.%m.%Y')
        target_name = f"{query.target_user.vorname} {query.target_user.name}" if query.target_user else "Thema des Tages"
        _log_update_event("Schicht-Anfragen", f"Anfrage ({target_name} am {date_str}) als '{new_status}' markiert.")

        db.session.commit()
        return jsonify(query.to_dict()), 200

    except IntegrityError as e:
        db.session.rollback()
        # Fallback für Duplicate Entry bei 'erledigt'
        if "Duplicate entry" in str(e) and new_status == 'erledigt':
            try:
                db.session.delete(query)
                db.session.commit()
                return jsonify(query.to_dict()), 200
            except:
                pass
        return jsonify({"message": f"Datenbank-Integritätsfehler: {str(e)}"}), 500
    except Exception as e:
        db.session.rollback()
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


@query_bp.route('/<int:query_id>', methods=['DELETE'])
@query_roles_required
def delete_shift_query(query_id):
    """
    Löscht eine Schicht-Anfrage endgültig.
    """
    query = db.session.get(ShiftQuery, query_id)
    if not query:
        return jsonify({"message": "Anfrage nicht gefunden"}), 404

    user_role = current_user.role.name if current_user.role else ""

    # Schutz für Hundeführer
    if user_role == 'Hundeführer' and query.sender_user_id != current_user.id:
        return jsonify({"message": "Sie dürfen nur Ihre eigenen Anfragen löschen."}), 403

    # --- START: SCHUTZ FÜR PLANSCHREIBER ---
    if user_role == 'Planschreiber':
        sender_role = query.sender.role.name if query.sender and query.sender.role else ""
        is_wunsch = (sender_role == 'Hundeführer' and query.message.startswith("Anfrage für:"))
        if is_wunsch:
            return jsonify({"message": "Planschreiber dürfen Wunsch-Anfragen nicht löschen."}), 403
    # --- ENDE: SCHUTZ ---

    try:
        date_str = query.shift_date.strftime('%d.%m.%Y')
        target_name = f"{query.target_user.vorname} {query.target_user.name}" if query.target_user else "Thema des Tages"
        _log_update_event("Schicht-Anfragen", f"Anfrage ({target_name} am {date_str}) gelöscht.")

        db.session.delete(query)
        db.session.commit()
        return jsonify({"message": "Anfrage erfolgreich gelöscht"}), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler beim Löschen von ShiftQuery {query_id}: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


@query_bp.route('/<int:query_id>/replies', methods=['GET'])
@query_roles_required
def get_query_replies(query_id):
    query = db.session.get(ShiftQuery, query_id)
    if not query:
        return jsonify({"message": "Anfrage nicht gefunden"}), 404

    user_role = current_user.role.name if current_user.role else ""
    if user_role == 'Hundeführer':
        if query.sender_user_id != current_user.id and query.target_user_id != current_user.id:
            return jsonify({"message": "Sie dürfen diese Konversation nicht einsehen."}), 403

    replies = query.replies.order_by(ShiftQueryReply.created_at.asc()).all()
    return jsonify([reply.to_dict() for reply in replies]), 200


@query_bp.route('/<int:query_id>/replies', methods=['POST'])
@query_roles_required
def create_query_reply(query_id):
    query = db.session.get(ShiftQuery, query_id)
    if not query:
        return jsonify({"message": "Anfrage nicht gefunden"}), 404

    user_role = current_user.role.name if current_user.role else ""
    if user_role == 'Hundeführer':
        if query.sender_user_id != current_user.id and query.target_user_id != current_user.id:
            return jsonify({"message": "Sie dürfen auf diese Anfrage nicht antworten."}), 403

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
        date_str = query.shift_date.strftime('%d.%m.%Y')
        target_name = f"{query.target_user.vorname} {query.target_user.name}" if query.target_user else "Thema des Tages"
        _log_update_event("Schicht-Anfragen", f"Neue Antwort für '{target_name}' am {date_str}.")
        db.session.commit()
        return jsonify(new_reply.to_dict()), 201
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler beim Erstellen der Antwort für Query {query_id}: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500