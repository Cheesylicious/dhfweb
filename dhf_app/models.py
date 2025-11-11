from .extensions import db
from flask_login import UserMixin
from datetime import datetime


# --- 5. Datenbank-Modelle ---
# (Modelle User, Role, ShiftType, Shift bleiben unverändert)
# ... (Code für User, Role, ShiftType, Shift) ...

class Role(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), unique=True, nullable=False)
    description = db.Column(db.String(255))

    def to_dict(self):
        return {"id": self.id, "name": self.name, "description": self.description}


class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    vorname = db.Column(db.String(100), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    passwort_hash = db.Column(db.String(128), nullable=False)
    role_id = db.Column(db.Integer, db.ForeignKey('role.id'), nullable=True)
    role = db.relationship('Role', backref=db.backref('users', lazy=True))
    geburtstag = db.Column(db.Date, nullable=True)
    telefon = db.Column(db.String(50), nullable=True)
    eintrittsdatum = db.Column(db.Date, nullable=True)
    aktiv_ab_datum = db.Column(db.Date, nullable=True)
    urlaub_gesamt = db.Column(db.Integer, default=0)
    urlaub_rest = db.Column(db.Integer, default=0)
    diensthund = db.Column(db.String(100), nullable=True)
    tutorial_gesehen = db.Column(db.Boolean, default=False)
    password_geaendert = db.Column(db.DateTime, nullable=True)
    zuletzt_online = db.Column(db.DateTime, nullable=True)
    shift_plan_visible = db.Column(db.Boolean, default=False)
    shift_plan_sort_order = db.Column(db.Integer, default=999)
    __table_args__ = (db.UniqueConstraint('vorname', 'name', name='_vorname_name_uc'),)

    def safe_date_iso(self, date_obj):
        if date_obj: return date_obj.isoformat()
        return None

    def to_dict(self):
        return {
            "id": self.id, "vorname": self.vorname, "name": self.name,
            "role": self.role.to_dict() if self.role else None, "role_id": self.role_id,
            "geburtstag": self.safe_date_iso(self.geburtstag), "telefon": self.telefon,
            "eintrittsdatum": self.safe_date_iso(self.eintrittsdatum),
            "aktiv_ab_datum": self.safe_date_iso(self.aktiv_ab_datum),
            "urlaub_gesamt": self.urlaub_gesamt, "urlaub_rest": self.urlaub_rest,
            "diensthund": self.diensthund, "tutorial_gesehen": self.tutorial_gesehen,
            "password_geaendert": self.safe_date_iso(self.password_geaendert),
            "zuletzt_online": self.safe_date_iso(self.zuletzt_online),
            "shift_plan_visible": self.shift_plan_visible,
            "shift_plan_sort_order": self.shift_plan_sort_order
        }


class ShiftType(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    abbreviation = db.Column(db.String(10), unique=True, nullable=False)
    color = db.Column(db.String(20), default="#FFFFFF")
    hours = db.Column(db.Float, default=0.0)
    is_work_shift = db.Column(db.Boolean, default=False)
    hours_spillover = db.Column(db.Float, default=0.0)
    # --- Start- und Endzeit für Konfliktprüfung ---
    start_time = db.Column(db.String(5), nullable=True)  # Format 'HH:MM'
    end_time = db.Column(db.String(5), nullable=True)  # Format 'HH:MM'

    # --- NEU: Hintergrund-Priorisierung ---
    prioritize_background = db.Column(db.Boolean, default=False, nullable=False)

    # --- ENDE NEU ---

    def to_dict(self):
        return {"id": self.id, "name": self.name, "abbreviation": self.abbreviation,
                "color": self.color, "hours": self.hours,
                "is_work_shift": self.is_work_shift,
                "hours_spillover": self.hours_spillover,
                "start_time": self.start_time,
                "end_time": self.end_time,
                # --- NEU: Rückgabe des Feldes ---
                "prioritize_background": self.prioritize_background
                # --- ENDE NEU ---
                }


class Shift(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    shifttype_id = db.Column(db.Integer, db.ForeignKey('shift_type.id'), nullable=False)
    date = db.Column(db.Date, nullable=False)
    user = db.relationship('User', backref=db.backref('shifts', lazy=True))
    shift_type = db.relationship('ShiftType')
    __table_args__ = (db.UniqueConstraint('user_id', 'date', name='_user_date_uc'),)

    def to_dict(self):
        abbr = "ERR"
        if self.shift_type:
            abbr = self.shift_type.abbreviation
        return {"id": self.id, "user_id": self.user_id, "date": self.date.isoformat(),
                "shifttype_id": self.shifttype_id,
                "shifttype_abbreviation": abbr}


# --- NEUES MODELL ---
class SpecialDate(db.Model):
    """
    Speichert Feiertage, Ausbildungstermine und Schießtermine.
    """
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    date = db.Column(db.Date, nullable=True)  # (Datum kann für Vorlagen (MV-Feiertage) null sein)

    # 'holiday', 'training', 'shooting'
    type = db.Column(db.String(20), nullable=False, index=True)

    def safe_date_iso(self, date_obj):
        if date_obj: return date_obj.isoformat()
        return None

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "date": self.safe_date_iso(self.date),
            "type": self.type
        }


# --- NEUES MODELL: Globale Einstellungen (Farben etc.) ---
class GlobalSetting(db.Model):
    """
    Speichert globale Schlüssel-Wert-Paare für Einstellungen (z.B. Farben).
    """
    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(100), unique=True, nullable=False)
    value = db.Column(db.String(255), nullable=True)

    def to_dict(self):
        return {
            "key": self.key,
            "value": self.value
        }
# --- ENDE NEUES MODELL ---