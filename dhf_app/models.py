from .extensions import db
from flask_login import UserMixin
from datetime import datetime


# --- 5. Datenbank-Modelle ---
# (Modelle User, Role) ...

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
    start_time = db.Column(db.String(5), nullable=True)  # Format 'HH:MM'
    end_time = db.Column(db.String(5), nullable=True)  # Format 'HH:MM'
    prioritize_background = db.Column(db.Boolean, default=False, nullable=False)

    min_staff_mo = db.Column(db.Integer, default=0, nullable=False)
    min_staff_di = db.Column(db.Integer, default=0, nullable=False)
    min_staff_mi = db.Column(db.Integer, default=0, nullable=False)
    min_staff_do = db.Column(db.Integer, default=0, nullable=False)
    min_staff_fr = db.Column(db.Integer, default=0, nullable=False)
    min_staff_sa = db.Column(db.Integer, default=0, nullable=False)
    min_staff_so = db.Column(db.Integer, default=0, nullable=False)
    min_staff_holiday = db.Column(db.Integer, default=0, nullable=False)

    # --- NEU: Sortierung für SOLL/IST-Tabelle ---
    staffing_sort_order = db.Column(db.Integer, default=999)

    # --- ENDE NEU ---

    def to_dict(self):
        return {"id": self.id, "name": self.name, "abbreviation": self.abbreviation,
                "color": self.color, "hours": self.hours,
                "is_work_shift": self.is_work_shift,
                "hours_spillover": self.hours_spillover,
                "start_time": self.start_time,
                "end_time": self.end_time,
                "prioritize_background": self.prioritize_background,
                "min_staff_mo": self.min_staff_mo,
                "min_staff_di": self.min_staff_di,
                "min_staff_mi": self.min_staff_mi,
                "min_staff_do": self.min_staff_do,
                "min_staff_fr": self.min_staff_fr,
                "min_staff_sa": self.min_staff_sa,
                "min_staff_so": self.min_staff_so,
                "min_staff_holiday": self.min_staff_holiday,
                # --- NEU: Rückgabe der Sortierung ---
                "staffing_sort_order": self.staffing_sort_order
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


class SpecialDate(db.Model):
    """
    Speichert Feiertage, Ausbildungstermine und Schießtermine.
    """
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    date = db.Column(db.Date, nullable=True)
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


class UpdateLog(db.Model):  # <<< NEUES MODELL HINZUGEFÜGT
    """
    Protokolliert wichtige administrative Änderungen und System-Updates.
    """
    id = db.Column(db.Integer, primary_key=True)

    # Welchen Bereich betrifft das Update (z.B. 'Schichtarten', 'Farbeinstellungen', 'System')
    area = db.Column(db.String(100), nullable=False, index=True)

    # Eine kurze Beschreibung der Änderung oder Version
    description = db.Column(db.String(255), nullable=True)

    # Wann fand die Änderung statt
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "area": self.area,
            "description": self.description,
            "updated_at": self.updated_at.isoformat()
        }


# --- NEU: Feedback-System (Regel 4) ---

class FeedbackReport(db.Model):
    """
    Speichert Bug-Reports und Verbesserungsvorschläge von Benutzern.
    """
    id = db.Column(db.Integer, primary_key=True)

    # Wer hat es gemeldet?
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)

    # --- KORREKTUR: 'backref' entfernt, um Ladefehler zu beheben ---
    user = db.relationship('User')
    # --- ENDE KORREKTUR ---

    # Was wurde gemeldet?
    report_type = db.Column(db.String(50), nullable=False)  # z.B. 'bug', 'improvement'
    category = db.Column(db.String(100), nullable=False)  # z.B. 'Schichtplan', 'Login', 'Allgemein'
    message = db.Column(db.Text, nullable=False)
    page_context = db.Column(db.String(255), nullable=True)  # z.B. '/schichtplan.html'

    # Status (für Admin-Verwaltung)
    # 'neu', 'gesehen', 'archiviert'
    status = db.Column(db.String(50), nullable=False, default='neu', index=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    def to_dict(self):
        """
        Serialisiert das Objekt.
        (Regel 2: Liefert user_name direkt mit, um Frontend-Lookups zu sparen)
        """
        return {
            "id": self.id,
            "user_id": self.user_id,
            "user_name": f"{self.user.vorname} {self.user.name}" if self.user else "Unbekannt",
            "report_type": self.report_type,
            "category": self.category,
            "message": self.message,
            "page_context": self.page_context,
            "status": self.status,
            "created_at": self.created_at.isoformat()
        }


# --- ENDE NEU ---


# --- NEU: Schichtplan-Status (Regel 1) ---

class ShiftPlanStatus(db.Model):
    """
    Speichert den Bearbeitungsstatus und die Sperrung für einen Monats-Schichtplan.
    """
    id = db.Column(db.Integer, primary_key=True)
    year = db.Column(db.Integer, nullable=False, index=True)
    month = db.Column(db.Integer, nullable=False, index=True)

    # Status: 'In Bearbeitung', 'Fertiggestellt'
    status = db.Column(db.String(50), nullable=False, default='In Bearbeitung')

    # Sperrung: True (gesperrt, keine Bearbeitung), False (offen)
    is_locked = db.Column(db.Boolean, nullable=False, default=False)

    # Stellt sicher, dass es nur einen Eintrag pro Monat/Jahr gibt
    __table_args__ = (db.UniqueConstraint('year', 'month', name='_year_month_uc'),)

    def to_dict(self):
        return {
            "id": self.id,
            "year": self.year,
            "month": self.month,
            "status": self.status,
            "is_locked": self.is_locked
        }
# --- ENDE NEU ---