# dhf_app/__init__.py

import os
from flask import Flask, jsonify
from flask_cors import CORS
from .config import config
from .extensions import db, bcrypt, login_manager, mail, socketio


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

    # NEU: SocketIO initialisieren (Echtzeit-Kommunikation)
    socketio.init_app(app, cors_allowed_origins="*")

    # 3. CORS initialisieren
    CORS(app, supports_credentials=True, origins=["http://46.224.63.203", "http://ihre-domain.de", "*"])

    # 4. Modelle laden (ALLE MÜSSEN HIER SEIN, DAMIT SQLALCHEMY SIE KENNT)
    from . import models
    from . import models_gamification
    from . import models_shop
    from . import models_audit
    from . import models_market

    @login_manager.user_loader
    def load_user(user_id):
        return db.session.get(models.User, int(user_id))

    # 5. Blueprints registrieren (OHNE URL PREFIX, da die Routen schon /api/... enthalten)
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

    from .routes_special_dates import special_dates_bp
    app.register_blueprint(special_dates_bp)

    from .routes_emails import emails_bp
    app.register_blueprint(emails_bp)

    # --- NEU: E-Mail Vorschau Blueprint (Regel 4) ---
    from .routes_email_preview import preview_bp
    app.register_blueprint(preview_bp)

    from .routes_variants import variants_bp
    app.register_blueprint(variants_bp)

    from .routes_gamification import gamification_bp
    app.register_blueprint(gamification_bp)

    from .routes_shop import shop_bp
    app.register_blueprint(shop_bp)

    from .routes.shift_change_routes import shift_change_bp
    app.register_blueprint(shift_change_bp, url_prefix='/api/shift-change')

    from .routes.balance_routes import balance_bp
    app.register_blueprint(balance_bp)

    from .routes_prediction import prediction_bp
    app.register_blueprint(prediction_bp)

    from .routes_audit import audit_bp
    app.register_blueprint(audit_bp)

    from .routes_market import market_bp
    app.register_blueprint(market_bp)

    # 6. Startup-Logik (Innerhalb des App Context)
    with app.app_context():
        db.create_all()
        create_default_roles(db)
        create_default_holidays(db)
        create_default_settings(db)
        create_default_email_templates(db)
        create_default_shop_items(db)

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
        'holiday_bg_color': '#ffddaa', 'training_bg_color': '#daffdb',
        'shooting_bg_color': '#ffb0b0',
        'dpo_border_color': '#ff0000'
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
        {
            "key": "plan_completed",
            "name": "Schichtplan Fertiggestellt (Rundmail)",
            "subject": "DHF-Planer: Schichtplan {monat}/{jahr} ist fertig",
            "body": "Hallo {vorname},\n\nder Schichtplan für {monat}/{jahr} wurde fertiggestellt und ist nun einsehbar.\n\nBitte prüfe deine Dienste.\n\n{plan_preview}\n\nViele Grüße,\nDein Admin",
            "description": "Wird gesendet, wenn der Admin den Button 'E-Mail an alle' im Schichtplan klickt.",
            "placeholders": "{vorname}, {name}, {monat}, {jahr}, {plan_preview}"
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
        db_instance.session.rollback()
        print(f"Fehler beim Erstellen der Email-Vorlagen: {e}")


def create_default_shop_items(db_instance):
    from .models_shop import ShopItem
    try:
        if ShopItem.query.count() == 0:
            booster = ShopItem(
                name="XP Booster (7 Tage)",
                description="+50% mehr Erfahrungspunkte für eine Woche.",
                icon_class="fas fa-bolt",
                cost_xp=500,
                item_type="xp_multiplier",
                multiplier_value=1.5,
                duration_days=7,
                is_active=True
            )
            db_instance.session.add(booster)

            coffee = ShopItem(
                name="Virtueller Kaffee",
                description="Zeig deine Wertschätzung für Kollegen.",
                icon_class="fas fa-coffee",
                cost_xp=50,
                item_type="cosmetic",
                multiplier_value=1.0,
                duration_days=0,
                is_active=True
            )
            db_instance.session.add(coffee)

            db_instance.session.commit()
    except Exception as e:
        db_instance.session.rollback()
        print(f"Fehler beim Erstellen der Shop-Items: {e}")