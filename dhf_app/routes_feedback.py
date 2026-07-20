from flask import Blueprint, request, jsonify, current_app
from .models import FeedbackReport, PublicFeedbackItem, User
from .extensions import db
# --- KORREKTUR: Import aus utils.py ---
from .utils import admin_required
# --- ENDE KORREKTUR ---
from flask_login import login_required, current_user
from sqlalchemy.orm import joinedload
from datetime import datetime
from sqlalchemy import func # <<< NEU: func importiert

# Erstellt einen Blueprint. Alle Routen hier beginnen mit /api/feedback
feedback_bp = Blueprint('feedback', __name__, url_prefix='/api/feedback')


PUBLIC_FEEDBACK_STATUSES = {
    'aufgenommen': 'Aufgenommen',
    'geplant': 'Geplant',
    'in_arbeit': 'In Bearbeitung',
    'testphase': 'Testphase',
    'erledigt': 'Erledigt',
    'zurueckgestellt': 'Zurückgestellt',
    'nicht_umgesetzt': 'Nicht umgesetzt'
}


def _validate_public_item_payload(data):
    data = data or {}
    title = str(data.get('title') or '').strip()
    description = str(data.get('description') or '').strip()
    public_status = str(data.get('public_status') or 'aufgenommen').strip()
    status_note = str(data.get('status_note') or '').strip()

    if not title or not description:
        return None, "Titel und ausführliche Beschreibung sind erforderlich."
    if len(title) > 160:
        return None, "Der Titel darf höchstens 160 Zeichen lang sein."
    if public_status not in PUBLIC_FEEDBACK_STATUSES:
        return None, "Ungültiger Bearbeitungsstatus."

    try:
        progress = int(data.get('progress', 0))
    except (TypeError, ValueError):
        return None, "Der Fortschritt muss eine Zahl sein."

    if progress < 0 or progress > 100:
        return None, "Der Fortschritt muss zwischen 0 und 100 liegen."

    return {
        'title': title,
        'description': description,
        'public_status': public_status,
        'progress': progress,
        'status_note': status_note or None
    }, None


@feedback_bp.route('/count_new', methods=['GET']) # <<< NEUE ROUTE
@admin_required
def count_new_feedback_reports():
    """
    Gibt die Anzahl der Berichte mit dem Status 'neu' zurück. Nur für Admins.
    (Regel 2: Vermeidet unnötiges Laden aller Daten)
    """
    try:
        count = db.session.query(func.count(FeedbackReport.id)).filter(
            FeedbackReport.status == 'neu'
        ).scalar()
        return jsonify({"count": count}), 200
    except Exception as e:
        current_app.logger.error(f"Fehler beim Zählen neuer FeedbackReports: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


@feedback_bp.route('', methods=['POST'])
@login_required
def create_feedback_report():
    """
    Erstellt einen neuen Feedback-Bericht (Bug oder Verbesserung).
    Zugänglich für alle eingeloggten Benutzer.
    """
    data = request.get_json()
    if not data or not data.get('report_type') or not data.get('category') or not data.get('message'):
        return jsonify({"message": "Typ, Kategorie und Nachricht sind erforderlich."}), 400

    try:
        # 1. Zeitstempel VORHER in Python generieren (Löst den Fehler 'isoformat' und 'user.name' nach Commit)
        now = datetime.utcnow()

        new_report = FeedbackReport(
            user_id=current_user.id,
            report_type=data['report_type'],
            category=data['category'],
            message=data['message'],
            page_context=data.get('page_context'),  # Optionale Info, von welcher Seite gemeldet wurde
            status='neu',
            created_at=now
        )

        db.session.add(new_report)
        db.session.commit()

        # 3. Antwort-JSON mit denselben, im Speicher vorhandenen Daten bauen
        response_data = {
            "id": new_report.id,
            "user_id": current_user.id,
            "user_name": f"{current_user.vorname} {current_user.name}",
            "report_type": new_report.report_type,
            "category": new_report.category,
            "message": new_report.message,
            "page_context": new_report.page_context,
            "status": new_report.status,
            "created_at": now.isoformat()
        }

        return jsonify(response_data), 201

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler beim Erstellen von FeedbackReport: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


@feedback_bp.route('', methods=['GET'])
@admin_required
def get_feedback_reports():
    """
    Ruft alle Feedback-Berichte ab. Nur für Admins.
    Filtert optional nach Status.
    """
    status_filter = request.args.get('status')  # z.B. ?status=neu

    try:
        # Regel 2 (Performance): Verwende joinedload, um N+1-Abfragen beim
        # Abrufen der Benutzernamen in FeedbackReport.to_dict() zu vermeiden.
        query = FeedbackReport.query.options(
            joinedload(FeedbackReport.user),
            joinedload(FeedbackReport.public_item)
        )

        if status_filter in ['neu', 'gesehen', 'archiviert']:
            query = query.filter(FeedbackReport.status == status_filter)

        # Neueste zuerst
        reports = query.order_by(FeedbackReport.created_at.desc()).all()

        return jsonify([r.to_dict() for r in reports]), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler beim Abrufen von FeedbackReports: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


@feedback_bp.route('/<int:report_id>', methods=['PUT'])
@admin_required
def update_feedback_status(report_id):
    """
    Aktualisiert den Status eines Feedback-Berichts (z.B. archivieren).
    Nur für Admins.
    """
    # (Regel 2: joinedload() hinzugefügt, falls to_dict() den User braucht)
    report = db.session.query(FeedbackReport).options(joinedload(FeedbackReport.user)).get(report_id)
    if not report:
        return jsonify({"message": "Bericht nicht gefunden"}), 404

    data = request.get_json()
    new_status = data.get('status')

    if not new_status in ['neu', 'gesehen', 'archiviert']:
        return jsonify({"message": "Ungültiger Statuswert."}), 400

    try:
        report.status = new_status
        db.session.commit()
        return jsonify(report.to_dict()), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler beim Aktualisieren von FeedbackReport {report_id}: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


@feedback_bp.route('/<int:report_id>', methods=['DELETE'])
@admin_required
def delete_feedback_report(report_id):
    """
    Löscht einen Feedback-Bericht endgültig.
    Nur für Admins.
    """
    report = db.session.get(FeedbackReport, report_id)
    if not report:
        return jsonify({"message": "Bericht nicht gefunden"}), 404

    try:
        # Der öffentliche Status-Board-Eintrag bleibt als eigenständige
        # Dokumentation erhalten, auch wenn die interne Meldung gelöscht wird.
        if report.public_item:
            report.public_item.feedback_report_id = None
        db.session.delete(report)
        db.session.commit()
        return jsonify({"message": "Bericht erfolgreich gelöscht"}), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler beim Löschen von FeedbackReport {report_id}: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


@feedback_bp.route('/public_items', methods=['GET'])
@login_required
def get_public_feedback_items():
    """Liefert das für alle angemeldeten Benutzer sichtbare Status-Board."""
    status_filter = request.args.get('status')

    try:
        query = PublicFeedbackItem.query
        if status_filter in PUBLIC_FEEDBACK_STATUSES:
            query = query.filter(PublicFeedbackItem.public_status == status_filter)

        items = query.order_by(
            PublicFeedbackItem.updated_at.desc(),
            PublicFeedbackItem.created_at.desc()
        ).all()

        return jsonify([
            item.to_public_dict(
                viewer_user_id=current_user.id,
                status_label=PUBLIC_FEEDBACK_STATUSES.get(item.public_status)
            )
            for item in items
        ]), 200
    except Exception as e:
        current_app.logger.error(f"Fehler beim Laden des Status-Boards: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


@feedback_bp.route('/<int:report_id>/publish', methods=['POST'])
@admin_required
def publish_feedback_report(report_id):
    """Nimmt eine interne Meldung in das öffentliche Status-Board auf."""
    report = db.session.query(FeedbackReport).options(
        joinedload(FeedbackReport.user),
        joinedload(FeedbackReport.public_item)
    ).filter(FeedbackReport.id == report_id).first()

    if not report:
        return jsonify({"message": "Meldung nicht gefunden."}), 404
    if report.public_item:
        return jsonify({
            "message": "Diese Meldung ist bereits im Status-Board.",
            "public_item_id": report.public_item.id
        }), 409

    fields, validation_error = _validate_public_item_payload(request.get_json(silent=True))
    if validation_error:
        return jsonify({"message": validation_error}), 400

    try:
        reporter_name = None
        if report.user:
            reporter_name = f"{report.user.vorname} {report.user.name}"

        item = PublicFeedbackItem(
            feedback_report_id=report.id,
            reporter_user_id=report.user_id,
            report_type=report.report_type,
            category=report.category,
            original_message=report.message,
            reporter_name=reporter_name,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
            **fields
        )
        db.session.add(item)

        # Die Meldung ist mit der Aufnahme nachweislich angekommen.
        if report.status == 'neu':
            report.status = 'gesehen'

        db.session.commit()
        return jsonify(item.to_admin_dict(
            status_label=PUBLIC_FEEDBACK_STATUSES[item.public_status]
        )), 201
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler beim Veröffentlichen der Meldung {report_id}: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


@feedback_bp.route('/public_items/<int:item_id>', methods=['PUT'])
@admin_required
def update_public_feedback_item(item_id):
    """Aktualisiert Beschreibung, Status und Fortschritt eines Board-Eintrags."""
    item = db.session.get(PublicFeedbackItem, item_id)
    if not item:
        return jsonify({"message": "Status-Board-Eintrag nicht gefunden."}), 404

    fields, validation_error = _validate_public_item_payload(request.get_json(silent=True))
    if validation_error:
        return jsonify({"message": validation_error}), 400

    try:
        for field_name, value in fields.items():
            setattr(item, field_name, value)
        item.updated_at = datetime.utcnow()
        db.session.commit()

        return jsonify(item.to_admin_dict(
            status_label=PUBLIC_FEEDBACK_STATUSES[item.public_status]
        )), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler beim Aktualisieren des Board-Eintrags {item_id}: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


@feedback_bp.route('/public_items/<int:item_id>', methods=['DELETE'])
@admin_required
def delete_public_feedback_item(item_id):
    """Entfernt einen Eintrag aus dem öffentlichen Status-Board."""
    item = db.session.get(PublicFeedbackItem, item_id)
    if not item:
        return jsonify({"message": "Status-Board-Eintrag nicht gefunden."}), 404

    try:
        db.session.delete(item)
        db.session.commit()
        return jsonify({"message": "Eintrag wurde aus dem Status-Board entfernt."}), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler beim Entfernen des Board-Eintrags {item_id}: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500
