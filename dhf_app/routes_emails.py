# dhf_app/routes_emails.py

from flask import Blueprint, request, jsonify, current_app
from .models import EmailTemplate, UpdateLog, User
from .extensions import db
from .utils import admin_required
from .email_service import send_email
from datetime import datetime
from .email_service import send_email, _apply_email_design

# Erstellt einen Blueprint für E-Mail-Management
emails_bp = Blueprint('emails', __name__, url_prefix='/api/emails')


def _log_update_event(area, description):
    """ Hilfsfunktion für UpdateLog (vermeidet Import-Zyklen) """
    new_log = UpdateLog(area=area, description=description, updated_at=datetime.utcnow())
    db.session.add(new_log)


@emails_bp.route('/templates', methods=['GET'])
@admin_required
def get_email_templates():
    """ Liefert alle E-Mail-Vorlagen zurück. """
    try:
        templates = EmailTemplate.query.order_by(EmailTemplate.name).all()
        return jsonify([t.to_dict() for t in templates]), 200
    except Exception as e:
        return jsonify({"message": f"Fehler beim Laden: {str(e)}"}), 500


@emails_bp.route('/templates/<int:template_id>', methods=['PUT'])
@admin_required
def update_email_template(template_id):
    """ Aktualisiert eine E-Mail-Vorlage. """
    template = db.session.get(EmailTemplate, template_id)
    if not template:
        return jsonify({"message": "Vorlage nicht gefunden"}), 404

    data = request.get_json()
    if not data or not data.get('subject') or not data.get('body'):
        return jsonify({"message": "Betreff und Inhalt sind erforderlich."}), 400

    try:
        template.subject = data['subject']
        template.body = data['body']

        _log_update_event("E-Mail Einstellungen", f"Vorlage '{template.name}' aktualisiert.")
        db.session.commit()

        return jsonify(template.to_dict()), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


@emails_bp.route('/test_send', methods=['POST'])
@admin_required
def send_test_email_from_template():
    """
    Sendet eine Test-E-Mail basierend auf einer Vorlage an den aktuellen Admin.
    """
    data = request.get_json()
    template_id = data.get('template_id')

    if not template_id:
        return jsonify({"message": "Template ID erforderlich."}), 400

    template = db.session.get(EmailTemplate, template_id)
    if not template:
        return jsonify({"message": "Vorlage nicht gefunden."}), 404

    # Dummy-Daten
    now = datetime.now()
    dummy_context = {
        "vorname": "Max",
        "name": "Mustermann",
        "datum": now.strftime('%d.%m.%Y'),
        "nachricht": "Dies ist eine Testnachricht.",
        "status": "Erledigt",
        "shift_abbrev": "T.",
        "monat": now.strftime('%m'),
        "jahr": now.strftime('%Y'),
        "plan_preview": "(Hier wäre das Bild des Schichtplans)"
    }

    try:
        subject = template.subject
        body = template.body

        for key, val in dummy_context.items():
            placeholder = "{" + key + "}"
            if placeholder in subject:
                subject = subject.replace(placeholder, str(val))
            if placeholder in body:
                body = body.replace(placeholder, str(val))

        from flask_login import current_user
        recipient = current_user.email

        if not recipient:
            return jsonify({"message": "Deinem Admin-Account fehlt eine E-Mail-Adresse."}), 400

        # --- UPDATE: Design anwenden ---
        raw_html = body.replace('\n', '<br>')
        styled_html = _apply_email_design(raw_html, title="Vorschau: " + template.name)

        send_email(subject, [recipient], body, html_body=styled_html)

        return jsonify({"message": f"Test-E-Mail an {recipient} gesendet."}), 200

    except Exception as e:
        return jsonify({"message": f"Fehler beim Senden: {str(e)}"}), 500