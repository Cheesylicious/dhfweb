import sqlite3
import traceback
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
        
        return jsonify([dict(row) for row in rows]), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@special_dates_bp.route('/api/special_dates', methods=['POST'])
def add_special_date():
    try:
        data = request.get_json(silent=True) or {}
        name = data.get('name', '').strip()
        date_iso = data.get('date', '')
        date_type = data.get('type', 'holiday')

        # Fehlende Namen automatisch ergänzen
        if not name:
            if date_type == 'dpo': name = 'DPO - Prüfung'
            elif date_type == 'training': name = 'Ausbildung'
            elif date_type == 'shooting': name = 'Schießen'
            else: name = 'Termin'

        if not date_iso:
            return jsonify({"error": "Datum ist erforderlich"}), 400

        db = get_db()
        cursor = db.cursor()

        cursor.execute("""CREATE TABLE IF NOT EXISTS special_dates (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, type TEXT NOT NULL, date TEXT NOT NULL
        )""")

        cursor.execute("INSERT INTO special_dates (name, type, date) VALUES (?, ?, ?)",
                       (name, date_type, date_iso))
        db.commit()

        return jsonify({"message": "Termin erfolgreich erstellt", "id": cursor.lastrowid}), 201
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 400


@special_dates_bp.route('/api/special_dates/<int:event_id>', methods=['PUT'])
def update_special_date(event_id):
    try:
        data = request.get_json(silent=True) or {}
        db = get_db()
        cursor = db.cursor()
        
        cursor.execute("SELECT name, type, date FROM special_dates WHERE id = ?", (event_id,))
        row = cursor.fetchone()
        
        if not row:
            return jsonify({"error": "Termin nicht gefunden"}), 404
            
        name = data.get('name', row['name']).strip()
        date_type = data.get('type', row['type'])
        date_iso = data.get('date', row['date'])

        if not name:
            if date_type == 'dpo': name = 'DPO - Prüfung'
            elif date_type == 'training': name = 'Ausbildung'
            elif date_type == 'shooting': name = 'Schießen'
            else: name = 'Termin'

        cursor.execute("""
            UPDATE special_dates 
            SET name = ?, type = ?, date = ? 
            WHERE id = ?
        """, (name, date_type, date_iso, event_id))
        
        db.commit()
        return jsonify({"message": "Aktualisiert"}), 200
        
    except Exception as e:
        traceback.print_exc() 
        return jsonify({"error": f"Backend-Fehler: {str(e)}"}), 400


@special_dates_bp.route('/api/special_dates/<int:event_id>', methods=['DELETE'])
def delete_special_date(event_id):
    try:
        db = get_db()
        cursor = db.cursor()
        cursor.execute("DELETE FROM special_dates WHERE id = ?", (event_id,))
        db.commit()
        return jsonify({"message": "Gelöscht"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 400