from threading import Thread
from flask import current_app
from flask_mail import Message
from .extensions import mail, db


def send_async_email(app, msg):
    """
    Sendet die E-Mail im Hintergrund-Kontext der App.
    """
    with app.app_context():
        try:
            mail.send(msg)
            print(f"[EMAIL] Gesendet an: {msg.recipients}")
        except Exception as e:
            print(f"[EMAIL ERROR] Konnte E-Mail nicht senden: {e}")


def send_email(subject, recipients, text_body, html_body=None):
    """
    Startet einen Thread, um die E-Mail asynchron zu senden.
    """
    # Wir brauchen das echte App-Objekt
    app = current_app._get_current_object()
    sender = app.config.get('MAIL_DEFAULT_SENDER')

    msg = Message(subject, sender=sender, recipients=recipients)
    msg.body = text_body
    if html_body:
        msg.html = html_body

    thr = Thread(target=send_async_email, args=(app, msg))
    thr.start()


# --- NEUE FUNKTION: Template-basierter Versand ---
def send_template_email(template_key, recipient_email, context=None):
    """
    Lädt eine Vorlage aus der Datenbank, ersetzt Platzhalter und sendet die Mail.

    Args:
        template_key (str): Der eindeutige Key der Vorlage (z.B. 'query_resolved')
        recipient_email (str): Empfänger-Adresse
        context (dict): Dictionary mit Werten für die Platzhalter (z.B. {'vorname': 'Max'})
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

        # HTML Version (einfaches Umwandeln von Newlines)
        html_body = body.replace('\n', '<br>')

        send_email(subject, [recipient_email], body, html_body)

    except Exception as e:
        print(f"[EMAIL ERROR] Fehler bei Template-Versand '{template_key}': {e}")