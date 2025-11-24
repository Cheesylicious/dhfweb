from threading import Thread
from flask import current_app
from flask_mail import Message
from .extensions import mail


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
    Vermeidet Wartezeiten für den User.

    Args:
        subject (str): Betreff
        recipients (list): Liste der Empfänger-E-Mail-Adressen (Strings)
        text_body (str): Nur-Text Inhalt
        html_body (str, optional): HTML Inhalt
    """
    # Wir brauchen das echte App-Objekt, um es an den Thread zu übergeben
    app = current_app._get_current_object()

    # Standard-Absender aus Config laden
    sender = app.config.get('MAIL_DEFAULT_SENDER')

    msg = Message(subject, sender=sender, recipients=recipients)
    msg.body = text_body
    if html_body:
        msg.html = html_body

    # Thread starten (Non-Blocking)
    thr = Thread(target=send_async_email, args=(app, msg))
    thr.start()