# dhf_app/routes_dogs.py

import os
import re
from flask import Blueprint, request, jsonify, current_app, send_from_directory
from werkzeug.utils import secure_filename
from .models_dogs import Dog, DogEvent
from .models import User
from .extensions import db
from flask_login import login_required, current_user
from .utils import admin_required
from datetime import datetime, timedelta

dogs_bp = Blueprint('dogs', __name__, url_prefix='/api/dogs')

def none_if_empty(value):
    return None if value in ['', 'null', None] else str(value).strip()

def int_or_none(value):
    if value in [None, '', 'null']: return None
    try: return int(value)
    except ValueError: return None

def float_or_none(value):
    if value in [None, '', 'null']: return None
    try: return float(value)
    except ValueError: return None

def parse_date(date_str):
    if not date_str or date_str in ['null', '']: return None
    try: return datetime.strptime(date_str, '%Y-%m-%d').date()
    except ValueError: return None


@dogs_bp.route('/owners', methods=['GET'])
@login_required
def get_owners():
    """Liefert eine Liste möglicher Hundeführer (nur Rolle 'admin' oder 'Hundeführer')"""
    users = User.query.filter_by(is_hidden_dog_handler=False).order_by(User.name).all()
    result = []
    
    for u in users:
        if u.role and u.role.name in ['admin', 'Hundeführer']:
            result.append({"id": u.id, "name": f"{u.vorname} {u.name}"})
            
    return jsonify(result), 200


@dogs_bp.route('/', methods=['GET'])
@login_required
def get_dogs():
    try:
        dogs = Dog.query.order_by(Dog.name).all()
        return jsonify([dog.to_dict() for dog in dogs]), 200
    except Exception as e:
        return jsonify({"message": f"Serverfehler: {str(e)}"}), 500


@dogs_bp.route('/', methods=['POST'])
@admin_required
def create_dog():
    data = request.get_json()
    if not data or not data.get('name'):
        return jsonify({"message": "Der Name des Hundes ist erforderlich."}), 400

    try:
        new_dog = Dog(
            name=data['name'],
            breed=none_if_empty(data.get('breed')),
            weight_kg=float_or_none(data.get('weight_kg')),
            size_cm=float_or_none(data.get('size_cm')),
            coat_color=none_if_empty(data.get('coat_color')),
            chip_number=none_if_empty(data.get('chip_number')),
            birthdate=parse_date(data.get('birthdate')),
            last_vaccination=parse_date(data.get('last_vaccination')),
            next_vaccination=parse_date(data.get('next_vaccination')),
            training_focus=none_if_empty(data.get('training_focus')),
            notes=none_if_empty(data.get('notes')),
            is_active=data.get('is_active', True),
            owner_id=int_or_none(data.get('owner_id')),
            owner_id_2=int_or_none(data.get('owner_id_2'))
        )
        
        db.session.add(new_dog)
        db.session.commit()
        return jsonify(new_dog.to_dict()), 201

    except Exception as e:
        db.session.rollback()
        if "UNIQUE constraint failed" in str(e) or "Duplicate entry" in str(e):
            return jsonify({"message": "Ein Hund mit dieser Chipnummer existiert bereits."}), 409
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


@dogs_bp.route('/<int:dog_id>', methods=['PUT'])
@admin_required
def update_dog(dog_id):
    dog = db.session.get(Dog, dog_id)
    if not dog: return jsonify({"message": "Hund nicht gefunden"}), 404
    data = request.get_json()

    try:
        if 'name' in data: dog.name = data['name']
        if 'breed' in data: dog.breed = none_if_empty(data['breed'])
        if 'weight_kg' in data: dog.weight_kg = float_or_none(data['weight_kg'])
        if 'size_cm' in data: dog.size_cm = float_or_none(data['size_cm'])
        if 'coat_color' in data: dog.coat_color = none_if_empty(data['coat_color'])
        if 'chip_number' in data: dog.chip_number = none_if_empty(data['chip_number'])
        if 'birthdate' in data: dog.birthdate = parse_date(data['birthdate'])
        if 'last_vaccination' in data: dog.last_vaccination = parse_date(data['last_vaccination'])
        if 'next_vaccination' in data: dog.next_vaccination = parse_date(data['next_vaccination'])
        if 'training_focus' in data: dog.training_focus = none_if_empty(data['training_focus'])
        if 'notes' in data: dog.notes = none_if_empty(data['notes'])
        if 'is_active' in data: dog.is_active = data['is_active']
        
        if 'owner_id' in data: dog.owner_id = int_or_none(data['owner_id'])
        if 'owner_id_2' in data: dog.owner_id_2 = int_or_none(data['owner_id_2'])

        db.session.commit()
        return jsonify(dog.to_dict()), 200
    except Exception as e:
        db.session.rollback()
        if "UNIQUE constraint failed" in str(e) or "Duplicate entry" in str(e):
            return jsonify({"message": "Diese Chipnummer ist bereits einem anderen Hund zugewiesen."}), 409
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


@dogs_bp.route('/<int:dog_id>', methods=['DELETE'])
@admin_required
def delete_dog(dog_id):
    dog = db.session.get(Dog, dog_id)
    if not dog: return jsonify({"message": "Hund nicht gefunden"}), 404
    try:
        dog.is_active = False
        db.session.commit()
        return jsonify({"message": f"Diensthund '{dog.name}' archiviert."}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"message": str(e)}), 500


# --- FOTO UPLOAD & ABFRAGE ---

@dogs_bp.route('/<int:dog_id>/photo', methods=['POST'])
@login_required
def upload_photo(dog_id):
    if current_user.role.name not in ['admin', 'Hundeführer']:
        return jsonify({"message": "Keine Berechtigung"}), 403

    dog = db.session.get(Dog, dog_id)
    if not dog: return jsonify({"message": "Hund nicht gefunden"}), 404
    if 'photo' not in request.files: return jsonify({"message": "Kein Bild gesendet"}), 400
    
    file = request.files['photo']
    if file.filename == '': return jsonify({"message": "Keine Datei ausgewählt"}), 400
    
    upload_folder = os.path.join(current_app.root_path, 'static', 'uploads', 'dogs')
    os.makedirs(upload_folder, exist_ok=True)
    
    filename = secure_filename(f"dog_{dog.id}_{int(datetime.utcnow().timestamp())}_{file.filename}")
    file_path = os.path.join(upload_folder, filename)
    file.save(file_path)
    
    if dog.photo_filename:
        old_path = os.path.join(upload_folder, dog.photo_filename)
        if os.path.exists(old_path):
            os.remove(old_path)
            
    dog.photo_filename = filename
    db.session.commit()
    return jsonify(dog.to_dict()), 200


@dogs_bp.route('/photo/<path:filename>', methods=['GET'])
def serve_photo(filename):
    """
    Dieser neue Endpunkt liefert das Bild direkt aus.
    Er umgeht fehlerhafte Nginx-Static-Pfade.
    """
    upload_folder = os.path.join(current_app.root_path, 'static', 'uploads', 'dogs')
    return send_from_directory(upload_folder, filename)


# --- HUNDE-AKTE / EVENTS ---
@dogs_bp.route('/<int:dog_id>/events', methods=['GET'])
@login_required
def get_events(dog_id):
    events = DogEvent.query.filter_by(dog_id=dog_id).order_by(DogEvent.event_date.desc()).all()
    return jsonify([e.to_dict() for e in events]), 200

@dogs_bp.route('/<int:dog_id>/events', methods=['POST'])
@login_required
def add_event(dog_id):
    if current_user.role.name not in ['admin', 'Hundeführer']:
        return jsonify({"message": "Keine Berechtigung"}), 403

    data = request.get_json()
    if not data or not data.get('event_type') or not data.get('event_date'):
        return jsonify({"message": "Typ und Datum sind erforderlich."}), 400

    try:
        new_event = DogEvent(
            dog_id=dog_id,
            event_type=data['event_type'],
            event_date=parse_date(data['event_date']),
            due_date=parse_date(data.get('due_date')),
            notes=none_if_empty(data.get('notes'))
        )
        db.session.add(new_event)
        db.session.commit()
        return jsonify(new_event.to_dict()), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500

@dogs_bp.route('/events/<int:event_id>', methods=['DELETE'])
@login_required
def delete_event(event_id):
    if current_user.role.name not in ['admin', 'Hundeführer']:
        return jsonify({"message": "Keine Berechtigung"}), 403

    event = db.session.get(DogEvent, event_id)
    if not event: return jsonify({"message": "Eintrag nicht gefunden"}), 404
    try:
        db.session.delete(event)
        db.session.commit()
        return jsonify({"message": "Gelöscht"}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"message": str(e)}), 500


# --- ERINNERUNGS-BANNER ENDPUNKT (SMART UPDATE) ---
@dogs_bp.route('/upcoming_dues', methods=['GET'])
@login_required
def get_upcoming_dues():
    """
    Liefert alle Diensthunde-Termine, die in den nächsten 21 Tagen fällig sind oder überfällig sind.
    Löscht Duplikate heraus, wenn bereits eine neue Impfung des gleichen Typs eingetragen wurde!
    """
    try:
        today = datetime.utcnow().date()
        target_date = today + timedelta(days=21)
        
        dogs = Dog.query.filter_by(is_active=True).all()
        alerts = []
        
        for dog in dogs:
            # Hole alle Events dieses Hundes mit einem Fälligkeitsdatum, sortiert nach dem Ausführungsdatum (NEUSTE zuerst!)
            events = DogEvent.query.filter_by(dog_id=dog.id).filter(DogEvent.due_date.isnot(None)).order_by(DogEvent.event_date.desc()).all()
            
            seen_keys = set()
            
            for event in events:
                raw_notes = event.notes or ""
                # Entferne die "(Erfasst von: ...)" Signatur, damit der Schlüsselvergleich sauber klappt
                clean_notes = re.sub(r'\s*\(Erfasst von:.*?\)', '', raw_notes)
                
                # Wir nehmen den ersten Teil der Notiz (z.B. "Präparat: Tollwut" oder "Bravecto")
                base_note = clean_notes.split(' | ')[0]
                
                # Bilde einen eindeutigen Schlüssel (z.B. "Impfung_Präparat: Tollwut (3 Jahre)")
                key = f"{event.event_type}_{base_note}"
                
                # Wenn wir diesen Typ/Präparat bei DIESEM Hund schon gesehen haben, 
                # dann war das vorherige Event jünger -> das aktuelle Event ist veraltet/erledigt!
                if key in seen_keys:
                    continue 
                
                seen_keys.add(key)
                
                # Ist DIESES neuste Event in den nächsten 21 Tagen fällig oder überfällig?
                if event.due_date <= target_date:
                    days_left = (event.due_date - today).days
                    alerts.append({
                        "dog_id": dog.id,
                        "dog_name": dog.name,
                        "event_type": event.event_type,
                        "due_date": event.due_date.isoformat(),
                        "days_left": days_left,
                        "details": base_note # "Präparat: Tollwut" zur schönen Anzeige im Banner
                    })
                    
        return jsonify(alerts), 200
    except Exception as e:
        return jsonify({"message": f"Fehler bei Fristenabfrage: {str(e)}"}), 500