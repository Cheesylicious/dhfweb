# dhf_app/routes_dogs.py

from flask import Blueprint, request, jsonify, current_app
from .models_dogs import Dog
from .models import User
from .extensions import db
from flask_login import login_required, current_user
from .utils import admin_required
from datetime import datetime

# Eigener Blueprint für die Hunde-API, um Monolithen-Bildung zu vermeiden
dogs_bp = Blueprint('dogs', __name__, url_prefix='/api/dogs')

def none_if_empty(value):
    """Konvertiert leere Strings zu None (NULL in der Datenbank)"""
    return None if value == '' else value

def parse_date(date_str):
    """Sicheres Parsen von Datums-Strings (YYYY-MM-DD) ins Date-Objekt"""
    if not date_str:
        return None
    try:
        return datetime.strptime(date_str, '%Y-%m-%d').date()
    except ValueError:
        return None

@dogs_bp.route('/', methods=['GET'])
@login_required
def get_dogs():
    """
    Liefert eine Liste aller Hunde zurück (aktiv und inaktiv).
    """
    try:
        dogs = Dog.query.order_by(Dog.name).all()
        return jsonify([dog.to_dict() for dog in dogs]), 200
    except Exception as e:
        current_app.logger.error(f"Fehler beim Laden der Hunde: {str(e)}")
        return jsonify({"message": f"Serverfehler: {str(e)}"}), 500


@dogs_bp.route('/', methods=['POST'])
@admin_required
def create_dog():
    """
    Erstellt einen neuen Diensthund.
    """
    data = request.get_json()
    if not data or not data.get('name'):
        return jsonify({"message": "Der Name des Hundes ist erforderlich."}), 400

    try:
        new_dog = Dog(
            name=data['name'],
            breed=none_if_empty(data.get('breed')),
            weight_kg=data.get('weight_kg'),
            size_cm=data.get('size_cm'),
            coat_color=none_if_empty(data.get('coat_color')),
            chip_number=none_if_empty(data.get('chip_number')),
            birthdate=parse_date(data.get('birthdate')),
            last_vaccination=parse_date(data.get('last_vaccination')),
            next_vaccination=parse_date(data.get('next_vaccination')),
            training_focus=none_if_empty(data.get('training_focus')),
            notes=none_if_empty(data.get('notes')),
            is_active=data.get('is_active', True),
            owner_id=data.get('owner_id')
        )
        
        db.session.add(new_dog)
        db.session.commit()
        return jsonify(new_dog.to_dict()), 201

    except Exception as e:
        db.session.rollback()
        if "UNIQUE constraint failed" in str(e) or "Duplicate entry" in str(e):
            return jsonify({"message": "Ein Hund mit dieser Chipnummer existiert bereits."}), 409
        current_app.logger.error(f"Fehler beim Erstellen eines Hundes: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


@dogs_bp.route('/<int:dog_id>', methods=['PUT'])
@admin_required
def update_dog(dog_id):
    """
    Aktualisiert die Metadaten eines bestehenden Diensthundes.
    """
    dog = db.session.get(Dog, dog_id)
    if not dog:
        return jsonify({"message": "Hund nicht gefunden"}), 404

    data = request.get_json()

    try:
        if 'name' in data: dog.name = data['name']
        if 'breed' in data: dog.breed = none_if_empty(data['breed'])
        if 'weight_kg' in data: dog.weight_kg = data['weight_kg']
        if 'size_cm' in data: dog.size_cm = data['size_cm']
        if 'coat_color' in data: dog.coat_color = none_if_empty(data['coat_color'])
        if 'chip_number' in data: dog.chip_number = none_if_empty(data['chip_number'])
        
        if 'birthdate' in data: dog.birthdate = parse_date(data['birthdate'])
        if 'last_vaccination' in data: dog.last_vaccination = parse_date(data['last_vaccination'])
        if 'next_vaccination' in data: dog.next_vaccination = parse_date(data['next_vaccination'])
        
        if 'training_focus' in data: dog.training_focus = none_if_empty(data['training_focus'])
        if 'notes' in data: dog.notes = none_if_empty(data['notes'])
        if 'is_active' in data: dog.is_active = data['is_active']
        
        # Besitzer zuweisen (None erlaubt, falls der Hund aktuell keinem zugewiesen ist)
        if 'owner_id' in data: 
            dog.owner_id = data['owner_id']

        db.session.commit()
        return jsonify(dog.to_dict()), 200

    except Exception as e:
        db.session.rollback()
        if "UNIQUE constraint failed" in str(e) or "Duplicate entry" in str(e):
            return jsonify({"message": "Diese Chipnummer ist bereits einem anderen Hund zugewiesen."}), 409
        current_app.logger.error(f"Fehler beim Update des Hundes {dog_id}: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


@dogs_bp.route('/<int:dog_id>', methods=['DELETE'])
@admin_required
def delete_dog(dog_id):
    """
    Soft-Delete (Archivierung). Setzt is_active auf False, 
    damit die Schichtplan-Historie intakt bleibt.
    """
    dog = db.session.get(Dog, dog_id)
    if not dog:
        return jsonify({"message": "Hund nicht gefunden"}), 404

    try:
        dog.is_active = False
        # Optional: Wenn ein Hund deaktiviert wird, nehmen wir ihn dem aktuellen HF weg
        # dog.owner_id = None 
        
        db.session.commit()
        return jsonify({"message": f"Diensthund '{dog.name}' wurde erfolgreich archiviert."}), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler beim Archivieren des Hundes {dog_id}: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500