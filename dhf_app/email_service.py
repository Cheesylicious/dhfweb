from threading import Thread
from flask import current_app
from flask_mail import Message
from .extensions import mail, db


# --- HILFSFUNKTIONEN FÜR DESIGN ---

def _get_design_settings():
    """
    Lädt die Design-Einstellungen (Farben) aus der Datenbank.
    Nutzt Fallback-Werte, falls noch nichts gespeichert wurde.
    """
    from .models import GlobalSetting  # Import hier, um Zyklen zu vermeiden

    defaults = {
        'email_header_bg': '#3498db',
        'email_header_text': '#ffffff',
        'email_body_bg': '#ffffff',
        'email_body_text': '#333333',
        'email_accent_color': '#3498db',
        'email_btn_text': '#ffffff',
        'email_footer_bg': '#eeeeee',
        'email_footer_text': '#7f8c8d'
    }

    try:
        # Laden aller Settings, die mit 'email_' beginnen (oder alle)
        settings_db = GlobalSetting.query.all()
        settings_dict = {s.key: s.value for s in settings_db}

        # Defaults mit DB-Werten überschreiben
        for key in defaults:
            if key in settings_dict and settings_dict[key]:
                defaults[key] = settings_dict[key]

    except Exception as e:
        print(f"[EMAIL DESIGN] Warnung: Konnte Settings nicht laden ({e}). Nutze Defaults.")

    return defaults


def _apply_email_design(content_html, title="Benachrichtigung"):
    """
    Wickelt den Inhalt in das HTML-Gerüst mit den konfigurierten Farben ein.
    """
    c = _get_design_settings()

    html_template = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body {{ margin: 0; padding: 0; font-family: 'Helvetica', 'Arial', sans-serif; background-color: #f4f4f4; }}
            .email-container {{ max-width: 600px; margin: 20px auto; background-color: {c['email_body_bg']}; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }}
            .email-header {{ background-color: {c['email_header_bg']}; color: {c['email_header_text']}; padding: 20px; text-align: center; }}
            .email-header h2 {{ margin: 0; font-size: 24px; }}
            .email-body {{ padding: 30px; color: {c['email_body_text']}; line-height: 1.6; font-size: 16px; }}
            .email-footer {{ background-color: {c['email_footer_bg']}; color: {c['email_footer_text']}; padding: 15px; text-align: center; font-size: 12px; }}
            .btn {{ display: inline-block; padding: 10px 20px; background-color: {c['email_accent_color']}; color: {c['email_btn_text']}; text-decoration: none; border-radius: 5px; margin-top: 15px; font-weight: bold; }}
            a {{ color: {c['email_accent_color']}; }}
        </style>
    </head>
    <body>
        <div class="email-container">
            <div class="email-header">
                <h2>DHF-Planer</h2>
            </div>
            <div class="email-body">
                <h3 style="margin-top:0; color:{c['email_accent_color']};">{title}</h3>
                {content_html}
            </div>
            <div class="email-footer">
                &copy; DHF-Planer Systembenachrichtigung.<br>
                Bitte nicht auf diese E-Mail antworten.
            </div>
        </div>
    </body>
    </html>
    """
    return html_template


# --- CORE EMAIL FUNKTIONEN ---

def send_async_email(app, msg):
    """
    Sendet die E-Mail im Hintergrund-Kontext der App.
    """
    with app.app_context():
        try:
            mail.send(msg)
            # Logging im Server-Log
            print(f"[EMAIL] Gesendet an: {msg.recipients}")
        except Exception as e:
            print(f"[EMAIL ERROR] Konnte E-Mail nicht senden: {e}")


def send_email(subject, recipients, text_body, html_body=None, attachments=None):
    """
    Startet einen Thread, um die E-Mail asynchron zu senden.
    """
    # Wir brauchen das echte App-Objekt für den Thread
    app = current_app._get_current_object()
    sender = app.config.get('MAIL_DEFAULT_SENDER')

    msg = Message(subject, sender=sender, recipients=recipients)
    msg.body = text_body

    if html_body:
        msg.html = html_body

    # Anhänge verarbeiten
    if attachments:
        for att in attachments:
            try:
                msg.attach(
                    filename=att['filename'],
                    content_type=att['content_type'],
                    data=att['data']
                )
            except Exception as e:
                print(f"[EMAIL WARN] Konnte Anhang '{att.get('filename')}' nicht hinzufügen: {e}")

    thr = Thread(target=send_async_email, args=(app, msg))
    thr.start()


def send_template_email(template_key, recipient_email, context=None, attachments=None):
    """
    Lädt eine Vorlage aus der Datenbank, ersetzt Platzhalter,
    WENDET DAS DESIGN AN und sendet die Mail.
    """
    from .models import EmailTemplate  # Import hier, um Zyklen zu vermeiden

    if not context:
        context = {}

    try:
        template = EmailTemplate.query.filter_by(key=template_key).first()
        if not template:
            print(f"[EMAIL WARN] Vorlage '{template_key}' nicht gefunden. Sende nicht.")
            return

        subject = template.subject
        body = template.body

        # Platzhalter ersetzen
        for k, v in context.items():
            placeholder = "{" + str(k) + "}"
            if placeholder in subject:
                subject = subject.replace(placeholder, str(v))
            if placeholder in body:
                body = body.replace(placeholder, str(v))

        # 1. Text-Version (Clean)
        text_body = body

        # 2. HTML-Version (Design anwenden)
        # Einfache Newlines zu <br> wandeln für den Content
        raw_html_content = body.replace('\n', '<br>')

        # Design-Wrapper anwenden (Hier passiert die Magie!)
        styled_html_body = _apply_email_design(raw_html_content, title=template.name)

        # Senden
        send_email(subject, [recipient_email], text_body, styled_html_body, attachments=attachments)

    except Exception as e:
        print(f"[EMAIL ERROR] Fehler bei Template-Versand '{template_key}': {e}")