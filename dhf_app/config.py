import os


class Config:
    """
    Basis-Konfiguration.
    """
    # Starker Secret Key, wird aus Umgebungsvariablen geladen oder nutzt Fallback
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'SUPER-GEHEIMES-WORT-BITTE-AENDERN'

    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # Session-Cookie-Sicherheit
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = 'Lax'

    # Debug-Modus ist Standard, wird in Produktion überschrieben
    DEBUG = True

    # --- Datenbank-Konfiguration ---
    # Lädt DB-Zugangsdaten aus Umgebungsvariablen oder nutzt Fallback-Werte
    DB_USER = os.environ.get('DB_USER', 'dhf_planer_app')
    DB_PASS = os.environ.get('DB_PASS', 'SEHR_STARKES_PASSWORT_HIER')
    DB_HOST = os.environ.get('DB_HOST', 'localhost')
    DB_NAME = os.environ.get('DB_NAME', 'dhf_planer_db')

    # Stellt den Datenbank-URI zusammen
    SQLALCHEMY_DATABASE_URI = (
            os.environ.get('DATABASE_URL') or  # DATABASE_URL hat Priorität (z.B. für Heroku)
            f'mysql+mysqlconnector://{DB_USER}:{DB_PASS}@{DB_HOST}/{DB_NAME}'
    )

    @staticmethod
    def init_app(app):
        # Hier könnten app-spezifische Initialisierungen stattfinden
        pass


class ProductionConfig(Config):
    """
    Produktions-Konfiguration (überschreibt Basis-Werte).
    """
    DEBUG = False
    # In Produktion (hinter HTTPS) sollte Secure=True gesetzt werden
    # SESSION_COOKIE_SECURE = True


# Mapping, um Konfigurationen einfach per String in create_app zu laden
config = {
    'production': ProductionConfig,
    'default': Config
}