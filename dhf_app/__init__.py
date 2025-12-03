import os
from flask import Flask, jsonify
from flask_cors import CORS
from .config import config
from .extensions import db, bcrypt, login_manager, mail


def create_app(config_name='default'):
    """
    Application Factory: Erstellt und konfiguriert die Flask-App.
    """
    app = Flask(__name__)

    # 1. Konfiguration laden
    app.config.from_object(config[config_name])
    config[config_name].init_app(app)

    # 2. Extensions (db, bcrypt, mail etc.) an die App binden
    db.init_app(app)
    bcrypt.init_app(app)
    login_manager.init_app(app)
    mail.init_app(app)

    # 3. CORS initialisieren
    CORS(app, supports_credentials=True, origins=["http://46.224.63.203", "http://ihre-domain.de"])

    from . import models

    @login_manager.user_loader
    def load_user(user_id):
        return db.session.get(models.User, int(user_id))

    # 4. Blueprints registrieren
    from .routes_auth import auth_bp
    app.register_blueprint(auth_bp)

    from .routes_admin import admin_bp
    app.register_blueprint(admin_bp)

    from .routes_shifts import shifts_bp
    app.register_blueprint(shifts_bp)

    from .routes_events import events_bp
    app.register_blueprint(events_bp)

    from .routes_feedback import feedback_bp
    app.register_blueprint(feedback_bp)

    from .routes_queries import query_bp
    app.register_blueprint(query_bp)

    from .routes_generator import generator_bp
    app.register_blueprint(generator_bp)

    from .routes_statistics import statistics_bp
    app.register_blueprint(statistics_bp)

    # --- NEU: E-Mails Blueprint ---
    from .routes_emails import emails_bp
    app.register_blueprint(emails_bp)

    # --- NEU: Varianten Blueprint ---
    from .routes_variants import variants_bp
    app.register_blueprint(variants_bp)

    # 5. Startup-Logik
    with app.app_context():
        db.create_all()
        create_default_roles(db)
        create_default_holidays(db)
        create_default_settings(db)
        create_default_email_templates(db) # <<< NEU

    return app


# --- Startup-Funktionen ---

def create_default_roles(db_instance):
    from .models import Role
    roles_to_create = {
        'admin': 'Systemadministrator',
        'user': 'Standardbenutzer',
        'Besucher': 'Nur-Lese-Zugriff auf Schichtplan',
        'Planschreiber': 'Darf Plan bearbeiten',
        'Hundeführer': 'Diensthundeführer mit Wünschen'
    }
    for role_name, description in roles_to_create.items():
        existing_role = Role.query.filter_by(name=role_name).first()
        if not existing_role:
            new_role = Role(name=role_name, description=description)
            db_instance.session.add(new_role)
    try:
        db_instance.session.commit()
    except Exception:
        db_instance.session.rollback()


def create_default_holidays(db_instance):
    from .models import SpecialDate
    mv_holidays = ["Neujahr", "Internationaler Frauentag", "Karfreitag", "Ostermontag", "Tag der Arbeit",
                   "Christi Himmelfahrt", "Pfingstmontag", "Tag der Deutschen Einheit", "Reformationstag",
                   "Erster Weihnachtsfeiertag", "Zweiter Weihnachtsfeiertag"]
    try:
        for holiday_name in mv_holidays:
            existing = SpecialDate.query.filter_by(type='holiday', name=holiday_name).first()
            if not existing:
                new_holiday = SpecialDate(name=holiday_name, date=None, type='holiday')
                db_instance.session.add(new_holiday)
        db_instance.session.commit()
    except Exception:
        db_instance.session.rollback()


def create_default_settings(db_instance):
    from .models import GlobalSetting
    default_settings = {
        'weekend_bg_color': '#fff8f8', 'weekend_text_color': '#333333',
        'holiday_bg_color': '#ffddaa', 'training_bg_color': '#daffdb', 'shooting_bg_color': '#ffb0b0'
    }
    try:
        for key, default_value in default_settings.items():
            existing = GlobalSetting.query.filter_by(key=key).first()
            if not existing:
                new_setting = GlobalSetting(key=key, value=default_value)
                db_instance.session.add(new_setting)
        db_instance.session.commit()
    except Exception:
        db_instance.session.rollback()


# --- NEU: Standard E-Mail Vorlagen ---
def create_default_email_templates(db_instance):
    from .models import EmailTemplate

    defaults = [
        {
            "key": "query_resolved",
            "name": "Anfrage erledigt / genehmigt",
            "subject": "DHF-Planer: Anfrage erledigt ({datum})",
            "body": "Hallo {vorname},\n\ndeine Anfrage für {datum} wurde bearbeitet und als 'Erledigt' markiert.\n\nDeine Nachricht: \"{nachricht}\"\n\nBitte prüfe den Schichtplan für Details.\n\nViele Grüße,\nDein Admin",
            "description": "Wird gesendet, wenn eine Anfrage auf 'Erledigt' gesetzt wird.",
            "placeholders": "{vorname}, {name}, {datum}, {nachricht}"
        },
        {
            "key": "query_rejected",
            "name": "Anfrage abgelehnt / gelöscht",
            "subject": "DHF-Planer: Anfrage abgelehnt ({datum})",
            "body": "Hallo {vorname},\n\ndeine Anfrage für den {datum} wurde gelöscht (abgelehnt).\n\nDeine Nachricht war: \"{nachricht}\"\n\nViele Grüße,\nDein Admin",
            "description": "Wird gesendet, wenn eine Anfrage gelöscht wird.",
            "placeholders": "{vorname}, {name}, {datum}, {nachricht}"
        },
        {
            "key": "query_reply",
            "name": "Neue Antwort auf Anfrage",
            "subject": "DHF-Planer: Neue Antwort zur Anfrage ({datum})",
            "body": "Hallo {vorname},\n\nes gibt eine neue Antwort zu deiner Anfrage für den {datum}.\n\nAntwort:\n\"{nachricht}\"\n\nBitte logge dich ein, um zu antworten.",
            "description": "Wird gesendet, wenn jemand auf eine Anfrage antwortet.",
            "placeholders": "{vorname}, {datum}, {nachricht}"
        },
        {
            "key": "bulk_approved",
            "name": "Massen-Genehmigung Zusammenfassung",
            "subject": "DHF-Planer: Deine Anfragen wurden genehmigt",
            "body": "Hallo {vorname},\n\nfolgende Anfragen wurden genehmigt und im Plan eingetragen:\n\n{nachricht}\n\nBitte prüfe den Schichtplan.\n\nViele Grüße,\nDein Admin",
            "description": "Zusammenfassung bei Massen-Genehmigung.",
            "placeholders": "{vorname}, {nachricht} (Liste der Termine)"
        },
        # --- NEU: Vorlage für Plan-Fertigstellung ---
        {
            "key": "plan_completed",
            "name": "Schichtplan Fertiggestellt (Rundmail)",
            "subject": "DHF-Planer: Schichtplan {monat}/{jahr} ist fertig",
            "body": "Hallo {vorname},\n\nder Schichtplan für {monat}/{jahr} wurde fertiggestellt und ist nun einsehbar.\n\nBitte prüfe deine Dienste.\n\nViele Grüße,\nDein Admin",
            "description": "Wird gesendet, wenn der Admin den Button 'E-Mail an alle' im Schichtplan klickt.",
            "placeholders": "{vorname}, {name}, {monat}, {jahr}"
        }
    ]

    try:
        for t in defaults:
            existing = EmailTemplate.query.filter_by(key=t['key']).first()
            if not existing:
                new_template = EmailTemplate(
                    key=t['key'], name=t['name'], subject=t['subject'],
                    body=t['body'], description=t['description'],
                    available_placeholders=t['placeholders']
                )
                db_instance.session.add(new_template)
        db_instance.session.commit()
    except Exception as e:
        db.session.rollback()
        print(f"Fehler beim Erstellen der Email-Vorlagen: {e}")