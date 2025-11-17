from flask_sqlalchemy import SQLAlchemy
from flask_bcrypt import Bcrypt
from flask_login import LoginManager
from flask import jsonify

# --- Erweiterungen initialisieren ---
# Die Instanzen werden hier erstellt, aber erst in create_app()
# an die App gebunden (mittels .init_app(app))
db = SQLAlchemy()
bcrypt = Bcrypt()
login_manager = LoginManager()

# --- Konfiguration für LoginManager ---
# Definiert die Antwort, wenn ein nicht eingeloggter User
# eine @login_required-Route aufruft.
@login_manager.unauthorized_handler
def unauthorized():
    return jsonify({"message": "Nicht eingeloggt oder Sitzung abgelaufen"}), 401