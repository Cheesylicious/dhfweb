import os
from flask import Flask, jsonify
from flask_cors import CORS
from .config import config
from .extensions import db, bcrypt, login_manager


def create_app(config_name='default'):
    """
    Application Factory: Erstellt und konfiguriert die Flask-App.
    """
    app = Flask(__name__)

    # 1. Konfiguration laden
    app.config.from_object(config[config_name])
    config[config_name].init_app(app)

    # 2. Extensions (db, bcrypt, etc.) an die App binden
    db.init_app(app)
    bcrypt.init_app(app)
    login_manager.init_app(app)

    # 3. CORS initialisieren (wie im Original)
    CORS(app, supports_credentials=True, origins=["http://46.224.63.203", "http://ihre-domain.de"])

    # --- KORREKTUR: Alle Modelle importieren ---
    # Wir importieren das gesamte 'models'-Modul.
    # Dies stellt sicher, dass ALLE Klassen (User, Role, ShiftPlanStatus, etc.)
    # bei SQLAlchemy registriert werden, BEVOR db.create_all() aufgerufen wird.
    from . import models

    @login_manager.user_loader
    def load_user(user_id):
        # Wir verwenden die Referenz über das importierte Modul
        return db.session.get(models.User, int(user_id))

    # --- ENDE KORREKTUR ---

    # 4. Blueprints (Routen-Sammlungen) registrieren
    # (Diese Importe bleiben HIER, um zirkuläre Abhängigkeiten zu vermeiden)
    from .routes_auth import auth_bp
    app.register_blueprint(auth_bp)

    from .routes_admin import admin_bp
    app.register_blueprint(admin_bp)

    from .routes_shifts import shifts_bp
    app.register_blueprint(shifts_bp)

    from .routes_events import events_bp
    app.register_blueprint(events_bp)

    # --- Feedback Blueprint ---
    from .routes_feedback import feedback_bp
    app.register_blueprint(feedback_bp)

    # --- Anfragen Blueprint ---
    from .routes_queries import query_bp
    app.register_blueprint(query_bp)

    # --- GENERATOR Blueprint (NEU) ---
    from .routes_generator import generator_bp
    app.register_blueprint(generator_bp)
    # --- ENDE NEU ---

    # 5. Startup-Logik (Defaults erstellen)
    with app.app_context():
        # db.create_all() kennt jetzt ALLE Modelle aus models.py
        db.create_all()
        create_default_roles(db)
        # --- ENTFERNT ---
        # create_default_shifttypes(db)
        # --- ENDE ENTFERNT ---
        create_default_holidays(db)
        create_default_settings(db)  # Globale Einstellungen erstellen

    return app


# --- Startup-Funktionen ---

def create_default_roles(db_instance):
    """
    Erstellt die Standard-Rollen 'admin', 'user' und NEU 'Besucher', falls sie nicht existieren.
    (Die Rolle 'Planschreiber' wird hier bewusst NICHT hinzugefügt, damit sie manuell erstellt werden kann)
    """
    # Dieser Import ist jetzt technisch redundant, schadet aber nicht
    from .models import Role

    roles_to_create = {
        'admin': 'Systemadministrator',
        'user': 'Standardbenutzer',
        'Besucher': 'Nur-Lese-Zugriff auf Schichtplan'
    }

    for role_name, description in roles_to_create.items():
        existing_role = Role.query.filter_by(name=role_name).first()
        if not existing_role:
            new_role = Role(name=role_name, description=description)
            db_instance.session.add(new_role)

    try:
        db_instance.session.commit()
    except Exception as e:
        db_instance.session.rollback()
        print(f"Fehler beim Erstellen der Standard-Rollen: {e}")


def create_default_holidays(db_instance):
    """
    Erstellt die Standard-Feiertage für MV (als Vorlagen ohne Datum).
    """
    from .models import SpecialDate

    mv_holidays = [
        "Neujahr",
        "Internationaler Frauentag",
        "Karfreitag",
        "Ostermontag",
        "Tag der Arbeit",
        "Christi Himmelfahrt",
        "Pfingstmontag",
        "Tag der Deutschen Einheit",
        "Reformationstag",
        "Erster Weihnachtsfeiertag",
        "Zweiter Weihnachtsfeiertag"
    ]

    try:
        for holiday_name in mv_holidays:
            # Prüft, ob ein Feiertag mit diesem NAMEN bereits existiert
            existing = SpecialDate.query.filter_by(
                type='holiday',
                name=holiday_name
            ).first()

            if not existing:
                new_holiday = SpecialDate(
                    name=holiday_name,
                    date=None,  # Datum wird vom Admin manuell gesetzt
                    type='holiday'
                )
                db_instance.session.add(new_holiday)

        db_instance.session.commit()
    except Exception as e:
        db_instance.session.rollback()
        print(f"Fehler beim Erstellen der Standard-Feiertage: {e}")


def create_default_settings(db_instance):
    """
    Erstellt die Standard-Farbeinstellungen, falls sie nicht existieren.
    """
    from .models import GlobalSetting

    default_settings = {
        'weekend_bg_color': '#fff8f8',
        'weekend_text_color': '#333333',
        'holiday_bg_color': '#ffddaa',
        'training_bg_color': '#daffdb',
        'shooting_bg_color': '#ffb0b0'
    }

    try:
        for key, default_value in default_settings.items():
            existing = GlobalSetting.query.filter_by(key=key).first()
            if not existing:
                new_setting = GlobalSetting(key=key, value=default_value)
                db_instance.session.add(new_setting)

        db_instance.session.commit()
    except Exception as e:
        db_instance.session.rollback()
        print(f"Fehler beim Erstellen der Standard-Einstellungen: {e}")