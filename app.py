import os
from dhf_app import create_app
from dhf_app.extensions import socketio  # <--- Import der SocketIO Instanz

# Lädt die Konfiguration basierend auf einer Umgebungsvariable oder 'default'
config_name = os.getenv('FLASK_CONFIG') or 'default'
app = create_app(config_name)

if __name__ == '__main__':
    """
    Startet die Flask-Anwendung mit WebSocket-Support.

    WICHTIG: Wir nutzen jetzt socketio.run(app) anstelle von app.run().
    Das erlaubt Echtzeit-Kommunikation zwischen Server und Client.
    """
    socketio.run(
        app,
        host='0.0.0.0',
        port=5000,
        debug=app.config.get('DEBUG', True),
        allow_unsafe_werkzeug=True  # Erlaubt den Betrieb auch in einfachen Umgebungen
    )