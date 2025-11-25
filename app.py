import os
from dhf_app import create_app

# Lädt die Konfiguration basierend auf einer Umgebungsvariable oder 'default'
config_name = os.getenv('FLASK_CONFIG') or 'default'
app = create_app(config_name)

if __name__ == '__main__':
    """
    Startet die Flask-Anwendung.
    Host='0.0.0.0' macht die App im Netzwerk erreichbar (wichtig für Hosting).
    Debug=True wird über die Konfigurationsdatei gesteuert.
    """
    app.run(
        host='0.0.0.0',
        port=5000,
        debug=app.config.get('DEBUG', True)
    )