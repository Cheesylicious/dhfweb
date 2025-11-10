# app.py
from flask import Flask, request, jsonify
from flask_cors import CORS
import sys
import os
import datetime

# --- Konfiguration ---
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# --- Import Ihrer Datenbanklogik ---
try:
    from database.db_users import authenticate_user, register_user
    from database.db_users import get_all_users, approve_user
    from database.db_users import update_user_details, delete_user # <--- NEU
    DB_READY = True
except Exception as e:
    print(f"WARNUNG: Import von db_users fehlgeschlagen: {e}")
    DB_READY = False

# --- Flask-Anwendung erstellen ---
app = Flask(__name__)
CORS(app)

# --- JSON-Konverter (unverändert) ---
from json import JSONEncoder
class CustomJSONEncoder(JSONEncoder):
    def default(self, o):
        try:
            if isinstance(o, (datetime.date, datetime.datetime)):
                return o.isoformat()
        except Exception:
            pass
        return super().default(o)
app.json_encoder = CustomJSONEncoder
# --- Ende JSON-Konverter ---


# --- Routen definieren ---

@app.route("/")
def hello_world():
    return "Hallo Welt! DHF-Planer Backend läuft."

@app.route("/api/login", methods=["POST"])
def handle_login():
    data = request.get_json()
    vorname = data.get('vorname')
    name = data.get('name')
    passwort = data.get('passwort')

    if not vorname or not name or not passwort:
         return jsonify({"status": "fehler", "message": "Daten unvollständig"}), 400
    if not DB_READY:
        return jsonify({"status": "fehler", "message": "Datenbank nicht bereit"}), 500

    user_data = authenticate_user(vorname, name, passwort)

    if user_data:
        if not user_data.get('is_approved', 0):
             return jsonify({"status": "fehler", "message": "Benutzer noch nicht freigeschaltet"}), 403
        # Wir senden die user_id mit, damit das Frontend weiß, wer eingeloggt ist
        return jsonify({"status": "erfolg", "role": user_data.get('role'), "user_id": user_data.get('id')})
    else:
        return jsonify({"status": "fehler", "message": "Login fehlgeschlagen"}), 401

# --- Routen für Benutzererstellung (unverändert) ---
@app.route("/api/register", methods=["POST"])
def handle_register():
    data = request.get_json()
    vorname = data.get('vorname')
    name = data.get('name')
    passwort = data.get('passwort')
    if not vorname or not name or not passwort: return jsonify({"status": "fehler", "message": "Daten unvollständig"}), 400
    if not DB_READY: return jsonify({"status": "fehler", "message": "Datenbank nicht bereit"}), 500
    try:
        success, message = register_user(vorname, name, passwort, role="Admin")
        if success: return jsonify({"status": "erfolg", "message": message})
        else: return jsonify({"status": "fehler", "message": message}), 500
    except Exception as e: return jsonify({"status": "fehler", "message": f"Serverfehler: {str(e)}"}), 500

@app.route("/api/admin/create_user", methods=["POST"])
def handle_admin_create_user():
    data = request.get_json()
    vorname = data.get('vorname')
    name = data.get('name')
    passwort = data.get('passwort')
    role = data.get('role', 'Mitarbeiter')
    if not vorname or not name or not passwort: return jsonify({"status": "fehler", "message": "Daten unvollständig"}), 400
    if not DB_READY: return jsonify({"status": "fehler", "message": "Datenbank nicht bereit"}), 500
    try:
        success, message = register_user(vorname, name, passwort, role=role)
        if success: return jsonify({"status": "erfolg", "message": f"Benutzer {vorname} {name} erstellt. Muss noch freigeschaltet werden."})
        else: return jsonify({"status": "fehler", "message": message}), 500
    except Exception as e: return jsonify({"status": "fehler", "message": f"Serverfehler: {str(e)}"}), 500

# --- Route für Benutzerliste (unverändert) ---
@app.route("/api/users", methods=["GET"])
def get_users():
    if not DB_READY: return jsonify({"status": "fehler", "message": "Datenbank nicht bereit"}), 500
    try:
        users_from_db = get_all_users()
        users_list = []
        for user in users_from_db:
            user_copy = user.copy()
            for key, value in user_copy.items():
                if isinstance(value, (datetime.date, datetime.datetime)):
                    user_copy[key] = value.isoformat()
            users_list.append(user_copy)
        return jsonify(users_list)
    except Exception as e:
        print(f"Serverfehler bei /api/users: {e}")
        return jsonify({"status": "fehler", "message": f"Serverfehler: {str(e)}"}), 500

# --- Route für Freischaltung (unverändert) ---
@app.route("/api/admin/approve", methods=["POST"])
def handle_approve_user():
    data = request.get_json()
    user_id_to_approve = data.get('user_id')
    current_admin_id = 1 # Platzhalter
    if not user_id_to_approve: return jsonify({"status": "fehler", "message": "user_id fehlt"}), 400
    try:
        success, message = approve_user(user_id_to_approve, current_admin_id)
        if success: return jsonify({"status": "erfolg", "message": message})
        else: return jsonify({"status": "fehler", "message": message}), 500
    except Exception as e: return jsonify({"status": "fehler", "message": f"Serverfehler: {str(e)}"}), 500

# ======================================================================
# --- NEUE ROUTE: Benutzer löschen ---
# ======================================================================
@app.route("/api/admin/delete_user/<int:user_id>", methods=["DELETE"])
def handle_delete_user(user_id):
    current_admin_id = 1 # Platzhalter

    try:
        # Rufen Sie Ihre Original-Funktion auf
        success, message = delete_user(user_id, current_admin_id)

        if success:
            return jsonify({"status": "erfolg", "message": message})
        else:
            return jsonify({"status": "fehler", "message": message}), 500
    except Exception as e:
        return jsonify({"status": "fehler", "message": f"Serverfehler: {str(e)}"}), 500

# ======================================================================
# --- NEUE ROUTE: Benutzer bearbeiten ---
# ======================================================================
@app.route("/api/admin/update_user/<int:user_id>", methods=["POST"])
def handle_update_user(user_id):
    details = request.get_json() # Das 'details'-Wörterbuch
    current_admin_id = 1 # Platzhalter

    if not details:
        return jsonify({"status": "fehler", "message": "Keine Daten gesendet"}), 400

    try:
        # Rufen Sie Ihre Original-Funktion auf
        success, message = update_user_details(user_id, details, current_admin_id)

        if success:
            return jsonify({"status": "erfolg", "message": message})
        else:
            return jsonify({"status": "fehler", "message": message}), 500
    except Exception as e:
        return jsonify({"status": "fehler", "message": f"Serverfehler: {str(e)}"}), 500

# --- Server starten ---
if __name__ == "__main__":
    app.run(debug=True, host='0.0.0.0', port=5000)