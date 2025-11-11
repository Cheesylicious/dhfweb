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

    # --- KORREKTUR: User Loader Registrierung ---
    # Dies MUSS hier passieren, NACHDEM login_manager initialisiert wurde
    # und BEVOR die Blueprints importiert werden, die User verwenden.
    from .models import User
    @login_manager.user_loader
    def load_user(user_id):
        return db.session.get(User, int(user_id))

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

    # 5. Startup-Logik (Defaults erstellen)
    with app.app_context():
        db.create_all()
        create_default_roles(db)
        create_default_shifttypes(db)  # <<< HIER FÜHREN WIR DIE WIEDERHERSTELLUNG DURCH
        create_default_holidays(db)
        create_default_settings(db)  # <<< NEU: Globale Einstellungen erstellen

    return app


# --- Startup-Funktionen ---

def create_default_roles(db_instance):
    """
    Erstellt die Standard-Rollen 'admin', 'user' und NEU 'Besucher', falls sie nicht existieren.
    """
    from .models import Role  # Importiert Model *innerhalb* der Funktion

    roles_to_create = {
        'admin': 'Systemadministrator',
        'user': 'Standardbenutzer',
        'Besucher': 'Nur-Lese-Zugriff auf Schichtplan'  # <<< NEU
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


def create_default_shifttypes(db_instance):
    """
    Erstellt die Standard-Schichtarten (T, N, 6, FREI, U, X).
    """
    from .models import ShiftType  # Importiert Model *innerhalb* der Funktion

    default_types = [
        # Startzeit / Endzeit sind für Konfliktprüfung wichtig (HH:MM)
        {'name': 'Tag (T)', 'abbreviation': 'T.', 'color': '#AED6F1',
         'hours': 8.0, 'hours_spillover': 0.0, 'is_work_shift': True,
         'start_time': '06:00', 'end_time': '14:00'},

        {'name': 'Nacht (N)', 'abbreviation': 'N.', 'color': '#5D6D7E',
         'hours': 2.0, 'hours_spillover': 6.0, 'is_work_shift': True,
         'start_time': '18:00', 'end_time': '06:00'},  # Übernachtschicht

        {'name': 'Kurz (6)', 'abbreviation': '6', 'color': '#A9DFBF',
         'hours': 6.0, 'hours_spillover': 0.0, 'is_work_shift': True,
         'start_time': '10:00', 'end_time': '16:00'},

        {'name': 'Frei (Geplant)', 'abbreviation': 'FREI', 'color': '#FFFFFF',
         'hours': 0.0, 'hours_spillover': 0.0, 'is_work_shift': False},

        {'name': 'Urlaub', 'abbreviation': 'U', 'color': '#FAD7A0',
         'hours': 0.0, 'hours_spillover': 0.0, 'is_work_shift': False},

        {'name': 'Wunschfrei (X)', 'abbreviation': 'X', 'color': '#D2B4DE',
         'hours': 0.0, 'hours_spillover': 0.0, 'is_work_shift': False},
    ]

    try:
        for st_data in default_types:
            # Suche nach vorhandenem Eintrag über die Abkürzung
            existing = ShiftType.query.filter_by(abbreviation=st_data['abbreviation']).first()

            if not existing:
                # Füge den Eintrag neu hinzu, wenn er fehlt
                new_type = ShiftType(**st_data)
                db_instance.session.add(new_type)
            else:
                # Wenn er existiert, aktualisiere die Felder
                update_needed = False
                for key, value in st_data.items():
                    # Überspringe den 'id' Key (nicht vorhanden, aber zur Sicherheit)
                    if key == 'id': continue
                    # Prüfe auf Unterschiede und update
                    if getattr(existing, key) != value:
                        setattr(existing, key, value)
                        update_needed = True

                if update_needed:
                    db_instance.session.add(existing)  # Markiere für Update

        db_instance.session.commit()
    except Exception as e:
        db_instance.session.rollback()
        print(f"Fehler beim Erstellen der Standard-Schichtarten: {e}")


def create_default_holidays(db_instance):
    """
    Erstellt die Standard-Feiertage für MV (als Vorlagen ohne Datum).
    """
    from .models import SpecialDate
    # ... (Rest des Codes bleibt unverändert, da die Funktion nur auszugsweise benötigt wurde)
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