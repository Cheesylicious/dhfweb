import sqlite3
from flask import Blueprint, request, jsonify, g, current_app

special_dates_bp = Blueprint('special_dates_bp', __name__)


def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db_path = current_app.config.get('DATABASE', 'planer.db')
        db = g._database = sqlite3.connect(db_path)
        db.row_factory = sqlite3.Row
    return db


@special_dates_bp.route('/api/special_dates', methods=['GET'])
def get_special_dates():
    """
    Liefert ALLE Termine. Das Filtern übernimmt das Frontend.
    """
    try:
        db = get_db()
        cursor = db.cursor()
        cursor.execute("SELECT id, name, type, date FROM special_dates ORDER BY date ASC")
        rows = cursor.fetchall()

        events = []
        for row in rows:
            events.append({
                "id": row["id"],
                "name": row["name"],
                "type": row["type"],
                "date": row["date"]
            })
        return jsonify(events), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@special_dates_bp.route('/api/special_dates', methods=['POST'])
def add_special_date():
    try:
        data = request.get_json()
        name = data.get('name')
        date_iso = data.get('date')
        # Hier stand früher die Prüfung, die den Fehler "Ungültiger Typ" warf.
        # Jetzt nehmen wir einfach alles an:
        date_type = data.get('type', 'holiday')

        if not name or not date_iso:
            return jsonify({"error": "Name und Datum sind erforderlich"}), 400

        db = get_db()
        cursor = db.cursor()

        # Tabelle zur Sicherheit erstellen
        cursor.execute("""CREATE TABLE IF NOT EXISTS special_dates (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, type TEXT NOT NULL, date TEXT NOT NULL
        )""")

        cursor.execute("INSERT INTO special_dates (name, type, date) VALUES (?, ?, ?)",
                       (name, date_type, date_iso))
        db.commit()

        return jsonify({"message": "Termin erfolgreich erstellt", "id": cursor.lastrowid}), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@special_dates_bp.route('/api/special_dates/<int:event_id>', methods=['PUT'])
def update_special_date(event_id):
    try:
        data = request.get_json()
        fields = []
        params = []

        if 'name' in data:
            fields.append("name = ?")
            params.append(data['name'])
        if 'date' in data:
            fields.append("date = ?")
            params.append(data['date'])
        if 'type' in data:
            fields.append("type = ?")
            params.append(data['type'])

        if not fields: return jsonify({"message": "Keine Änderungen"}), 200

        params.append(event_id)
        query = f"UPDATE special_dates SET {', '.join(fields)} WHERE id = ?"

        db = get_db()
        cursor = db.cursor()
        cursor.execute(query, params)
        db.commit()
        return jsonify({"message": "Aktualisiert"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@special_dates_bp.route('/api/special_dates/<int:event_id>', methods=['DELETE'])
def delete_special_date(event_id):
    try:
        db = get_db()
        cursor = db.cursor()
        cursor.execute("DELETE FROM special_dates WHERE id = ?", (event_id,))
        db.commit()
        return jsonify({"message": "Gelöscht"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500