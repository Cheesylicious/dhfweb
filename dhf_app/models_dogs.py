# dhf_app/models_dogs.py

from .extensions import db
from datetime import datetime

class Dog(db.Model):
    """
    Eigenständiges Modell für die Diensthunde. 
    Ermöglicht detaillierte Verwaltung und Historisierung für Schichtpläne.
    """
    __tablename__ = 'dog'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    breed = db.Column(db.String(100), nullable=True)  # z.B. Deutscher Schäferhund
    weight_kg = db.Column(db.Float, nullable=True)    # Wichtig für Medikamente oder Transport
    size_cm = db.Column(db.Float, nullable=True)      # Schulterhöhe
    coat_color = db.Column(db.String(100), nullable=True)
    chip_number = db.Column(db.String(100), unique=True, nullable=True)
    birthdate = db.Column(db.Date, nullable=True)
    
    # --- NEU: Zugang und Abgang ---
    entry_date = db.Column(db.Date, nullable=True)
    exit_date = db.Column(db.Date, nullable=True)
    
    # --- Foto ---
    photo_filename = db.Column(db.String(255), nullable=True)
    
    # --- Medizinische Termine (Veraltet, aber als Schnellübersicht behalten wir sie) ---
    last_vaccination = db.Column(db.Date, nullable=True)
    next_vaccination = db.Column(db.Date, nullable=True)
    
    # --- Ausbildung & Verhalten ---
    training_focus = db.Column(db.String(100), nullable=True)  # z.B. Schutzdienst, Fährtenarbeit
    notes = db.Column(db.Text, nullable=True)  # z.B. Wesenszüge, Futterbesonderheiten
    
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    
    # --- Verknüpfung zum primären UND sekundären Hundeführer ---
    owner_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    owner_id_2 = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    
    # Explizite Zuweisung der foreign_keys, damit SQLAlchemy die Beziehungen nicht verwechselt
    owner = db.relationship('User', foreign_keys=[owner_id], backref=db.backref('owned_dogs_1', lazy='dynamic'))
    owner_2 = db.relationship('User', foreign_keys=[owner_id_2], backref=db.backref('owned_dogs_2', lazy='dynamic'))

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    def safe_date_iso(self, date_obj):
        if date_obj: return date_obj.isoformat()
        return None

    def to_dict(self):
        age_years = None
        if self.birthdate:
            today = datetime.utcnow().date()
            age_years = today.year - self.birthdate.year - ((today.month, today.day) < (self.birthdate.month, self.birthdate.day))

        # Beide Besitzer formatieren
        owner_1_name = f"{self.owner.vorname} {self.owner.name}" if self.owner else ""
        owner_2_name = f"{self.owner_2.vorname} {self.owner_2.name}" if self.owner_2 else ""
        owners_list = [n for n in [owner_1_name, owner_2_name] if n]
        combined_owners = " & ".join(owners_list) if owners_list else "Kein Hundeführer"

        return {
            "id": self.id,
            "name": self.name,
            "breed": self.breed,
            "weight_kg": self.weight_kg,
            "size_cm": self.size_cm,
            "coat_color": self.coat_color,
            "chip_number": self.chip_number,
            "birthdate": self.safe_date_iso(self.birthdate),
            "entry_date": self.safe_date_iso(self.entry_date),   # <--- NEU
            "exit_date": self.safe_date_iso(self.exit_date),     # <--- NEU
            "age_years": age_years,
            "photo_filename": self.photo_filename,
            "last_vaccination": self.safe_date_iso(self.last_vaccination),
            "next_vaccination": self.safe_date_iso(self.next_vaccination),
            "training_focus": self.training_focus,
            "notes": self.notes,
            "is_active": self.is_active,
            "owner_id": self.owner_id,
            "owner_id_2": self.owner_id_2,
            "owner_name": combined_owners, 
            "created_at": self.created_at.isoformat()
        }

class DogEvent(db.Model):
    __tablename__ = 'dog_event'
    id = db.Column(db.Integer, primary_key=True)
    dog_id = db.Column(db.Integer, db.ForeignKey('dog.id', ondelete='CASCADE'), nullable=False)
    event_type = db.Column(db.String(50), nullable=False)
    event_date = db.Column(db.Date, nullable=False)
    
    # --- NEU: Fälligkeitsdatum für den Countdown ---
    due_date = db.Column(db.Date, nullable=True) 
    
    notes = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    
    dog = db.relationship('Dog', backref=db.backref('events', lazy='dynamic', cascade="all, delete-orphan"))

    def to_dict(self):
        return {
            "id": self.id,
            "dog_id": self.dog_id,
            "event_type": self.event_type,
            "event_date": self.event_date.isoformat() if self.event_date else None,
            "due_date": self.due_date.isoformat() if self.due_date else None, 
            "notes": self.notes,
            "created_at": self.created_at.isoformat()
        }