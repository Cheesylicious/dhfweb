# dhf_app/routes_dog_assignments.py

from flask import Blueprint, request, jsonify
from flask_login import login_required
from .extensions import db
from .models_dogs import DogAssignment
from .utils import admin_required
from datetime import datetime, timedelta

dog_assignments_bp = Blueprint('dog_assignments', __name__, url_prefix='/api/dog_assignments')

def parse_date(date_str):
    if not date_str or date_str in ['null', '']: return None
    try: return datetime.strptime(date_str, '%Y-%m-%d').date()
    except ValueError: return None


@dog_assignments_bp.route('/', methods=['GET'])
@login_required
def get_assignments():
    """
    Liefert die Historie. Kann nach user_id oder dog_id gefiltert werden.
    (So können wir sie in der Hundeakte UND in den User-Einstellungen anzeigen)
    """
    user_id = request.args.get('user_id')
    dog_id = request.args.get('dog_id')
    
    query = DogAssignment.query
    if user_id:
        query = query.filter_by(user_id=user_id)
    if dog_id:
        query = query.filter_by(dog_id=dog_id)
        
    assignments = query.order_by(DogAssignment.start_date.desc()).all()
    return jsonify([a.to_dict() for a in assignments]), 200


@dog_assignments_bp.route('/', methods=['POST'])
@admin_required
def add_assignment():
    """
    Erstellt eine neue Zuweisung. 
    Schließt automatisch vorherige, offene Zuweisungen des Users, um Überschneidungen zu verhindern.
    """
    data = request.get_json()
    user_id = data.get('user_id')
    dog_id = data.get('dog_id')
    start_date = parse_date(data.get('start_date'))
    
    if not user_id or not dog_id or not start_date:
        return jsonify({"message": "Mitarbeiter, Hund und Startdatum sind zwingend erforderlich."}), 400

    try:
        # 1. Prüfen, ob der User eine aktuell offene Zuweisung hat (end_date is None)
        active_assignment = DogAssignment.query.filter_by(user_id=user_id, end_date=None).first()
        
        # 2. Wenn ja, beende die alte Zuweisung einen Tag vor dem Start der neuen Zuweisung
        if active_assignment:
            active_assignment.end_date = start_date - timedelta(days=1)
            
        # 3. Neue Zuweisung eintragen
        new_assignment = DogAssignment(
            user_id=user_id,
            dog_id=dog_id,
            start_date=start_date,
            end_date=parse_date(data.get('end_date'))
        )
        
        db.session.add(new_assignment)
        db.session.commit()
        return jsonify(new_assignment.to_dict()), 201
        
    except Exception as e:
        db.session.rollback()
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


@dog_assignments_bp.route('/<int:assignment_id>', methods=['DELETE'])
@admin_required
def delete_assignment(assignment_id):
    """Löscht einen Historien-Eintrag (falls man sich mal vertippt hat)"""
    assignment = db.session.get(DogAssignment, assignment_id)
    if not assignment:
        return jsonify({"message": "Eintrag nicht gefunden"}), 404
        
    try:
        db.session.delete(assignment)
        db.session.commit()
        return jsonify({"message": "Zuweisung erfolgreich gelöscht."}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500