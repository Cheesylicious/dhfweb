from flask import Blueprint, request, jsonify, current_app
from .models import FeedbackReport, User
from .extensions import db
# --- KORREKTUR: Import aus utils.py ---
from .utils import admin_required
# --- ENDE KORREKTUR ---
from flask_login import login_required, current_user
from sqlalchemy.orm import joinedload
from datetime import datetime

# Erstellt einen Blueprint. Alle Routen hier beginnen mit /api/feedback
feedback_bp = Blueprint('feedback', __name__, url_prefix='/api/feedback')


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
        query = FeedbackReport.query.options(joinedload(FeedbackReport.user))

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
        db.session.delete(report)
        db.session.commit()
        return jsonify({"message": "Bericht erfolgreich gelöscht"}), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler beim Löschen von FeedbackReport {report_id}: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500