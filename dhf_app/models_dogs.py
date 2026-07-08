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
    weight_kg = db.Column(db.Float, nullable=True)    # Wichtig für Medikamente oder Transport, z.B. 40.0
    size_cm = db.Column(db.Float, nullable=True)      # Schulterhöhe
    coat_color = db.Column(db.String(100), nullable=True)
    chip_number = db.Column(db.String(100), unique=True, nullable=True)
    birthdate = db.Column(db.Date, nullable=True)
    
    # --- Medizinische Termine ---
    last_vaccination = db.Column(db.Date, nullable=True)
    next_vaccination = db.Column(db.Date, nullable=True)
    
    # --- Ausbildung & Verhalten ---
    training_focus = db.Column(db.String(100), nullable=True)  # z.B. Schutzdienst, Fährtenarbeit
    notes = db.Column(db.Text, nullable=True)  # z.B. Wesenszüge wie "sehr triebstark", Futterbesonderheiten
    
    # Ein Hund kann auf inaktiv gesetzt werden (z.B. bei Rente), ohne die Historie zu zerstören
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    
    # --- Verknüpfung zum primären Hundeführer ---
    owner_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    owner = db.relationship('User', foreign_keys=[owner_id], backref=db.backref('owned_dogs', lazy='dynamic'))

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

    def safe_date_iso(self, date_obj):
        if date_obj: return date_obj.isoformat()
        return None

    def to_dict(self):
        # Das Alter wird ressourcenschonend dynamisch berechnet, ohne die DB zu belasten
        age_years = None
        if self.birthdate:
            today = datetime.utcnow().date()
            # Zieht 1 Jahr ab, falls der Geburtstag im aktuellen Jahr noch nicht war
            age_years = today.year - self.birthdate.year - ((today.month, today.day) < (self.birthdate.month, self.birthdate.day))

        return {
            "id": self.id,
            "name": self.name,
            "breed": self.breed,
            "weight_kg": self.weight_kg,
            "size_cm": self.size_cm,
            "coat_color": self.coat_color,
            "chip_number": self.chip_number,
            "birthdate": self.safe_date_iso(self.birthdate),
            "age_years": age_years,
            "last_vaccination": self.safe_date_iso(self.last_vaccination),
            "next_vaccination": self.safe_date_iso(self.next_vaccination),
            "training_focus": self.training_focus,
            "notes": self.notes,
            "is_active": self.is_active,
            "owner_id": self.owner_id,
            "owner_name": f"{self.owner.vorname} {self.owner.name}" if self.owner else "Kein Besitzer",
            "created_at": self.created_at.isoformat()
        }