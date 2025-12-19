# dhf_app/routes_queries.py

from flask import Blueprint, request, jsonify, current_app
from .models import ShiftQuery, User, FeedbackReport, UpdateLog, ShiftQueryReply, Role, UserShiftLimit, ShiftType, Shift
from .extensions import db
from sqlalchemy.orm import joinedload
from .utils import admin_required, scheduler_or_admin_required, query_roles_required
from flask_login import login_required, current_user
from sqlalchemy import extract, func, or_
from datetime import datetime
from sqlalchemy.sql import select
from sqlalchemy.exc import IntegrityError
from .email_service import send_email
from collections import defaultdict

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


# --- HILFSFUNKTION: VERBRAUCH BERECHNEN ---
def _calculate_usage(user_id, year, month, shifttype_id, abbreviation):
    """
    Berechnet den Verbrauch eines Limits (Genehmigte Schichten + Offene Anfragen).
    """
    # 1. Zähle echte Schichten im Plan (genehmigt) -> NUR HAUPTPLAN (variant_id=None)
    shift_count = Shift.query.filter(
        Shift.user_id == user_id,
        extract('year', Shift.date) == year,
        extract('month', Shift.date) == month,
        Shift.shifttype_id == shifttype_id,
        Shift.variant_id == None  # WICHTIG: Nur Hauptplan zählen!
    ).count()

    # 2. Zähle offene Anfragen (textbasiert: "Anfrage für: T.")
    # Wir suchen nach Nachrichten, die mit der Abkürzung beginnen
    search_pattern = f"Anfrage für: {abbreviation}%"
    query_count = ShiftQuery.query.filter(
        ShiftQuery.sender_user_id == user_id,
        extract('year', ShiftQuery.shift_date) == year,
        extract('month', ShiftQuery.shift_date) == month,
        ShiftQuery.status == 'offen',
        ShiftQuery.message.like(search_pattern)
    ).count()

    return shift_count + query_count


# --- ROUTE FÜR BENACHRICHTIGUNGS-ZÄHLER ---
@query_bp.route('/notifications_summary', methods=['GET'])
@login_required
def get_notifications_summary():
    """
    Ruft eine Zusammenfassung aller relevanten Benachrichtigungs-Zähler ab.
    """
    response = {
        "new_feedback_count": 0,
        "new_wishes_count": 0,
        "new_notes_count": 0,
        "waiting_on_others_count": 0
    }

    try:
        user_role = current_user.role.name if current_user.role else ""

        if user_role == 'admin':
            count = db.session.query(func.count(FeedbackReport.id)).filter(
                FeedbackReport.status == 'neu'
            ).scalar()
            response["new_feedback_count"] = count

        if user_role in ['admin', 'Planschreiber', 'Hundeführer']:
            current_user_id = current_user.id

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
                        ShiftQuery.sender_user_id == current_user.id,
                        ShiftQuery.target_user_id == current_user.id
                    )
                )

            query_results = base_query.all()

            new_wishes = 0
            new_notes = 0
            waiting = 0

            for query, last_replier_id in query_results:
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


# --- NEUE ROUTE: VERFÜGBARE ANFRAGEN ABFRAGEN ---
@query_bp.route('/usage', methods=['GET'])
@login_required
def get_query_usage():
    """
    Gibt zurück, wie viele Anfragen der aktuelle User pro Schichtart in einem Monat noch stellen darf.
    """
    year = request.args.get('year')
    month = request.args.get('month')

    if not year or not month:
        return jsonify({"message": "Jahr und Monat erforderlich"}), 400

    try:
        year = int(year)
        month = int(month)

        # 1. Limits für den User laden
        limits = UserShiftLimit.query.filter_by(user_id=current_user.id).options(
            joinedload(UserShiftLimit.shift_type)).all()

        result = {}

        for l in limits:
            st = l.shift_type
            if not st: continue

            limit = l.monthly_limit
            # Wenn Limit 0 ist, ist die Schicht gesperrt/nicht verfügbar

            # 2. Verbrauch berechnen (Schichten + Offene Anfragen)
            used = _calculate_usage(current_user.id, year, month, st.id, st.abbreviation)

            remaining = max(0, limit - used)

            result[st.abbreviation] = {
                "shifttype_id": st.id,
                "limit": limit,
                "used": used,
                "remaining": remaining
            }

        return jsonify(result), 200

    except Exception as e:
        current_app.logger.error(f"Fehler beim Berechnen der Usage: {str(e)}")
        return jsonify({"message": f"Serverfehler: {str(e)}"}), 500


@query_bp.route('', methods=['POST'])
@query_roles_required
def create_shift_query():
    """
    Erstellt eine neue Schicht-Anfrage oder aktualisiert eine EIGENE bestehende.
    Enthält jetzt einen Check auf Limits.
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

        # --- START: LIMIT-PRÜFUNG FÜR HUNDEFÜHRER ---
        if user_role == 'Hundeführer':
            if target_user_id != current_user.id:
                return jsonify({"message": "Hundeführer dürfen Anfragen nur für sich selbst erstellen."}), 403

            # Prüfe, ob es eine Schicht-Wunsch-Anfrage ist (Format "Anfrage für: X")
            if message.startswith("Anfrage für:"):
                # --- ANPASSUNG: Nur im HAUPTPLAN (variant_id=None) prüfen! ---
                existing_shift_db = Shift.query.filter_by(
                    user_id=current_user.id,
                    date=shift_date,
                    variant_id=None  # Ignoriere Schichten in Varianten
                ).first()

                # Wenn Schicht existiert und nicht 'FREI' (also shifttype_id nicht NULL)
                if existing_shift_db and existing_shift_db.shifttype_id is not None:
                    return jsonify({
                        "message": "Nicht möglich: Du hast an diesem Tag bereits eine Schicht eingetragen. Bitte nutze die Tauschbörse."
                    }), 403
                # --- ENDE ANPASSUNG ---

                # Extrahiere Abkürzung
                parts = message.split(":")
                if len(parts) > 1:
                    abbr = parts[1].strip().replace('?', '')  # Entferne evtl. Fragezeichen

                    # Finde Schichtart
                    st = ShiftType.query.filter_by(abbreviation=abbr).first()
                    if st:
                        # Finde Limit
                        limit_entry = UserShiftLimit.query.filter_by(user_id=current_user.id,
                                                                     shifttype_id=st.id).first()

                        if limit_entry:
                            max_limit = limit_entry.monthly_limit
                            if max_limit == 0:
                                return jsonify({
                                    "message": f"Anfragen für '{abbr}' sind für Sie nicht freigeschaltet (Limit 0)."}), 403

                            # Prüfe, ob schon eine Anfrage für DIESEN Tag existiert (Update-Fall)
                            existing_same_day = ShiftQuery.query.filter_by(
                                target_user_id=target_user_id,
                                shift_date=shift_date,
                                status='offen',
                                sender_user_id=current_user.id
                            ).first()

                            current_usage = _calculate_usage(current_user.id, shift_date.year, shift_date.month, st.id,
                                                             st.abbreviation)

                            # Strenger Check:
                            if not existing_same_day and current_usage >= max_limit:
                                return jsonify(
                                    {"message": f"Monatliches Limit für '{abbr}' erreicht ({max_limit}x)."}), 403

        # --- ENDE LIMIT-PRÜFUNG ---

        # Bestehende Anfrage prüfen
        existing_query = ShiftQuery.query.filter_by(
            target_user_id=target_user_id,
            shift_date=shift_date,
            status='offen',
            sender_user_id=current_user.id
        ).first()

        if existing_query:
            existing_query.message = message
            existing_query.created_at = datetime.utcnow()
            db.session.add(existing_query)
        else:
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


# --- MASSEN-FUNKTIONEN (KORRIGIERT UND VOLLSTÄNDIG) ---

@query_bp.route('/bulk_approve', methods=['POST'])
@scheduler_or_admin_required
def bulk_approve_queries():
    """
    Markiert mehrere Anfragen als 'erledigt', TRÄGT DIE SCHICHT EIN
    und sendet EINE Zusammenfassungs-Mail pro User.
    """
    data = request.get_json()
    query_ids = data.get('query_ids', [])

    if not query_ids:
        return jsonify({"message": "Keine IDs übergeben"}), 400

    try:
        # Alle Schichtarten vorladen (Abkürzung -> ID) für den Eintrag in den Plan
        all_types = ShiftType.query.all()
        types_map = {st.abbreviation: st.id for st in all_types}

        queries = db.session.query(ShiftQuery).options(joinedload(ShiftQuery.sender)).filter(
            ShiftQuery.id.in_(query_ids),
            ShiftQuery.status == 'offen'
        ).all()

        if not queries:
            return jsonify({"message": "Keine offenen Anfragen gefunden."}), 404

        queries_by_user_email = defaultdict(list)
        count_updated = 0
        count_shifts_created = 0

        for q in queries:
            # 1. Versuche, die Schicht aus der Nachricht zu lesen und einzutragen
            if q.target_user_id and q.message.startswith("Anfrage für:"):
                parts = q.message.split("Anfrage für:")
                if len(parts) > 1:
                    abbr = parts[1].strip().replace('?', '')
                    st_id = types_map.get(abbr)

                    if st_id:
                        # Schicht erstellen oder updaten (IMMER HAUPTPLAN)
                        existing_shift = Shift.query.filter_by(
                            user_id=q.target_user_id,
                            date=q.shift_date,
                            variant_id=None  # Explizit Hauptplan
                        ).first()

                        if existing_shift:
                            existing_shift.shifttype_id = st_id
                        else:
                            # Explizit variant_id=None setzen
                            new_shift = Shift(
                                user_id=q.target_user_id,
                                date=q.shift_date,
                                shifttype_id=st_id,
                                variant_id=None
                            )
                            db.session.add(new_shift)
                        count_shifts_created += 1

            # 2. Status ändern
            q.status = 'erledigt'
            count_updated += 1

            # 3. Mail vormerken
            if q.sender and q.sender.email:
                queries_by_user_email[q.sender.email].append(q)

        db.session.commit()

        # E-Mails senden (1 pro User)
        for email, q_list in queries_by_user_email.items():
            if not q_list: continue

            user_name = q_list[0].sender.vorname

            msg_lines = []
            for item in q_list:
                date_s = item.shift_date.strftime('%d.%m.%Y')
                short_msg = item.message.replace('Anfrage für:', '').strip()
                msg_lines.append(f"- {date_s}: {short_msg}")

            body_text = "\n".join(msg_lines)

            email_subject = f"DHF-Planer: {len(q_list)} Anfragen genehmigt/erledigt"
            email_body = f"""
            Hallo {user_name},

            folgende {len(q_list)} Anfragen wurden genehmigt und im Plan eingetragen:

            {body_text}

            Bitte prüfe den Schichtplan für Details.

            Viele Grüße,
            Dein Admin
            """
            send_email(email_subject, [email], email_body)

        _log_update_event("Massen-Bearbeitung",
                          f"{count_updated} Anfragen genehmigt, {count_shifts_created} Schichten eingetragen.")
        return jsonify(
            {"message": f"{count_updated} Anfragen genehmigt, {count_shifts_created} Schichten erstellt."}), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler bei Bulk Approve: {str(e)}")
        return jsonify({"message": f"Fehler: {str(e)}"}), 500


@query_bp.route('/bulk_delete', methods=['POST'])
@scheduler_or_admin_required
def bulk_delete_queries():
    """
    Löscht mehrere Anfragen.
    - Wenn status == 'offen': Ablehnung -> Mail wird gesendet.
    - Wenn status == 'erledigt': Aufräumen -> KEINE Mail.
    """
    data = request.get_json()
    query_ids = data.get('query_ids', [])

    if not query_ids:
        return jsonify({"message": "Keine IDs übergeben"}), 400

    try:
        # Queries laden VOR dem Löschen für E-Mail Infos
        queries = db.session.query(ShiftQuery).options(joinedload(ShiftQuery.sender)).filter(
            ShiftQuery.id.in_(query_ids)
        ).all()

        if not queries:
            return jsonify({"message": "Keine Anfragen gefunden."}), 404

        # Daten sichern für E-Mail (als einfache Dictionaries, um DB-Abhängigkeit zu lösen)
        mails_to_send = defaultdict(list)

        for q in queries:
            # --- NEU: E-Mail nur, wenn noch OFFEN (also eine echte Ablehnung) ---
            should_send_mail = (
                        q.status == 'offen' and q.sender_user_id != current_user.id and q.sender and q.sender.email)

            if should_send_mail:
                info = {
                    'email': q.sender.email,
                    'name': q.sender.vorname,
                    'date': q.shift_date.strftime('%d.%m.%Y'),
                    'msg': q.message.replace('Anfrage für:', '').strip()
                }
                mails_to_send[info['email']].append(info)

        # Löschen durchführen (performant via SQL DELETE)
        ShiftQuery.query.filter(ShiftQuery.id.in_(query_ids)).delete(synchronize_session=False)

        db.session.commit()

        # E-Mails mit gesicherten Daten senden
        for email, info_list in mails_to_send.items():
            if not info_list: continue

            user_name = info_list[0]['name']

            msg_lines = []
            for item in info_list:
                msg_lines.append(f"- {item['date']}: {item['msg']}")

            body_text = "\n".join(msg_lines)

            email_subject = f"DHF-Planer: {len(info_list)} Anfragen abgelehnt"
            email_body = f"""
            Hallo {user_name},

            folgende {len(info_list)} Anfragen wurden gelöscht (abgelehnt):

            {body_text}

            Viele Grüße,
            Dein Admin
            """
            send_email(email_subject, [email], email_body)

        _log_update_event("Massen-Bearbeitung", f"{len(queries)} Anfragen gelöscht.")
        return jsonify({"message": f"{len(queries)} Anfragen gelöscht."}), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler bei Bulk Delete: {str(e)}")
        return jsonify({"message": f"Fehler: {str(e)}"}), 500


@query_bp.route('/<int:query_id>/status', methods=['PUT'])
@scheduler_or_admin_required
def update_query_status(query_id):
    """
    Aktualisiert den Status einer Anfrage.
    SENDET EINE EMAIL BEI ERLEDIGUNG (Einzelaktion).
    """
    query = db.session.get(ShiftQuery, query_id)
    if not query:
        return jsonify({"message": "Anfrage nicht gefunden"}), 404

    user_role = current_user.role.name if current_user.role else ""
    if user_role == 'Planschreiber':
        sender_role = query.sender.role.name if query.sender and query.sender.role else ""
        is_wunsch = (sender_role == 'Hundeführer' and query.message.startswith("Anfrage für:"))
        if is_wunsch:
            return jsonify({"message": "Planschreiber dürfen Wunsch-Anfragen nicht bearbeiten."}), 403

    data = request.get_json()
    new_status = data.get('status')

    if new_status not in ['offen', 'erledigt']:
        return jsonify({"message": "Ungültiger Status"}), 400

    try:
        query.status = new_status
        date_str = query.shift_date.strftime('%d.%m.%Y')
        target_name = f"{query.target_user.vorname} {query.target_user.name}" if query.target_user else "Thema des Tages"

        # --- E-Mail Benachrichtigung bei Genehmigung/Erledigung ---
        if new_status == 'erledigt' and query.sender and query.sender.email:
            email_subject = f"DHF-Planer: Anfrage erledigt ({date_str})"
            email_body = f"""
            Hallo {query.sender.vorname},

            deine Anfrage für {date_str} wurde bearbeitet und als 'Erledigt' markiert.

            Deine Nachricht: "{query.message}"

            Bitte prüfe den Schichtplan für Details.

            Viele Grüße,
            Dein Admin
            """
            send_email(email_subject, [query.sender.email], email_body)
        # ---------------------------------------------------------

        _log_update_event("Schicht-Anfragen", f"Anfrage ({target_name} am {date_str}) als '{new_status}' markiert.")

        db.session.commit()
        return jsonify(query.to_dict()), 200

    except IntegrityError as e:
        db.session.rollback()
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
    SENDET EINE EMAIL BEI ABLEHNUNG (wenn Admin löscht).
    """
    query = db.session.get(ShiftQuery, query_id)
    if not query:
        return jsonify({"message": "Anfrage nicht gefunden"}), 404

    user_role = current_user.role.name if current_user.role else ""

    # Sicherheits-Checks (wie bisher)
    if user_role == 'Hundeführer' and query.sender_user_id != current_user.id:
        return jsonify({"message": "Sie dürfen nur Ihre eigenen Anfragen löschen."}), 403

    if user_role == 'Planschreiber':
        sender_role = query.sender.role.name if query.sender and query.sender.role else ""
        is_wunsch = (sender_role == 'Hundeführer' and query.message.startswith("Anfrage für:"))
        if is_wunsch:
            return jsonify({"message": "Planschreiber dürfen Wunsch-Anfragen nicht löschen."}), 403

    try:
        date_str = query.shift_date.strftime('%d.%m.%Y')
        target_name = f"{query.target_user.vorname} {query.target_user.name}" if query.target_user else "Thema des Tages"

        # --- E-Mail Benachrichtigung nur bei Ablehnung (OFFEN) ---
        # Wenn Status "erledigt" ist, wird KEINE Mail gesendet (Aufräumen).
        should_send_mail = (
                    query.status == 'offen' and query.sender_user_id != current_user.id and query.sender and query.sender.email)

        if should_send_mail:
            email_subject = f"DHF-Planer: Anfrage abgelehnt/gelöscht ({date_str})"
            email_body = f"""
            Hallo {query.sender.vorname},

            deine Anfrage für den {date_str} wurde gelöscht (abgelehnt).

            Deine Nachricht war: "{query.message}"

            Viele Grüße,
            Dein Admin
            """
            send_email(email_subject, [query.sender.email], email_body)
        # -----------------------------------------------------------------------

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
    """
    Erstellt eine Antwort auf eine Anfrage.
    SENDET EMAIL AN DEN EMPFÄNGER DER NACHRICHT.
    """
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

        # --- E-Mail Benachrichtigung bei neuer Antwort ---
        if query.sender_user_id != current_user.id and query.sender and query.sender.email:
            email_subject = f"DHF-Planer: Neue Antwort zur Anfrage ({date_str})"
            email_body = f"""
             Hallo {query.sender.vorname},

             es gibt eine neue Antwort zu deiner Anfrage für den {date_str}.

             Antwort von {current_user.vorname}:
             "{message}"

             Bitte logge dich ein, um zu antworten.
             """
            send_email(email_subject, [query.sender.email], email_body)
        # -----------------------------------------------

        return jsonify(new_reply.to_dict()), 201
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler beim Erstellen der Antwort für Query {query_id}: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500