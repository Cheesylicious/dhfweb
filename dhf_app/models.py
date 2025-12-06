from .extensions import db
from flask_login import UserMixin
from datetime import datetime


# --- 5. Datenbank-Modelle ---

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
    email = db.Column(db.String(120), unique=True, nullable=True)
    passwort_hash = db.Column(db.String(128), nullable=False)
    role_id = db.Column(db.Integer, db.ForeignKey('role.id'), nullable=True)
    role = db.relationship('Role', backref=db.backref('users', lazy=True))
    geburtstag = db.Column(db.Date, nullable=True)
    telefon = db.Column(db.String(50), nullable=True)
    eintrittsdatum = db.Column(db.Date, nullable=True)
    aktiv_ab_datum = db.Column(db.Date, nullable=True)

    # --- Inaktiv-Datum ---
    inaktiv_ab_datum = db.Column(db.Date, nullable=True)  # Datum, ab dem User im Plan ausgeblendet wird

    urlaub_gesamt = db.Column(db.Integer, default=0)
    urlaub_rest = db.Column(db.Integer, default=0)
    diensthund = db.Column(db.String(100), nullable=True)
    tutorial_gesehen = db.Column(db.Boolean, default=False)
    password_geaendert = db.Column(db.DateTime, nullable=True)
    zuletzt_online = db.Column(db.DateTime, nullable=True)
    shift_plan_visible = db.Column(db.Boolean, default=False)
    shift_plan_sort_order = db.Column(db.Integer, default=999)

    # --- Passwortzwang ---
    force_password_change = db.Column(db.Boolean, default=False, nullable=False)

    # --- Statistik-Berechtigung ---
    can_see_statistics = db.Column(db.Boolean, default=False, nullable=False)

    __table_args__ = (db.UniqueConstraint('vorname', 'name', name='_vorname_name_uc'),)

    def safe_date_iso(self, date_obj):
        if date_obj: return date_obj.isoformat()
        return None

    def to_dict(self):
        return {
            "id": self.id, "vorname": self.vorname, "name": self.name, "email": self.email,
            "role": self.role.to_dict() if self.role else None, "role_id": self.role_id,
            "geburtstag": self.safe_date_iso(self.geburtstag), "telefon": self.telefon,
            "eintrittsdatum": self.safe_date_iso(self.eintrittsdatum),
            "aktiv_ab_datum": self.safe_date_iso(self.aktiv_ab_datum),
            "inaktiv_ab_datum": self.safe_date_iso(self.inaktiv_ab_datum),
            "urlaub_gesamt": self.urlaub_gesamt, "urlaub_rest": self.urlaub_rest,
            "diensthund": self.diensthund, "tutorial_gesehen": self.tutorial_gesehen,
            "password_geaendert": self.safe_date_iso(self.password_geaendert),
            "zuletzt_online": self.safe_date_iso(self.zuletzt_online),
            "shift_plan_visible": self.shift_plan_visible,
            "shift_plan_sort_order": self.shift_plan_sort_order,
            "force_password_change": self.force_password_change,
            "can_see_statistics": self.can_see_statistics
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

    # --- Sortierung für SOLL/IST-Tabelle ---
    staffing_sort_order = db.Column(db.Integer, default=999)

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
                "staffing_sort_order": self.staffing_sort_order
                }


# --- NEU: Plan-Varianten Modell ---
class PlanVariant(db.Model):
    """
    Speichert Metadaten für Plan-Varianten (z.B. 'Variante A' für Jan 2025).
    """
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), nullable=False)  # z.B. "Variante A"
    year = db.Column(db.Integer, nullable=False)
    month = db.Column(db.Integer, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Sicherstellen, dass Name pro Monat eindeutig ist (z.B. nur eine 'Variante A' im Jan 2025)
    __table_args__ = (db.UniqueConstraint('name', 'year', 'month', name='_variant_month_uc'),)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "year": self.year,
            "month": self.month,
            "created_at": self.created_at.isoformat()
        }


# --- ENDE NEU ---


class Shift(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)

    # --- UPDATE: Nullable=True erlaubt Sperren von "leeren" Zellen ---
    shifttype_id = db.Column(db.Integer, db.ForeignKey('shift_type.id'), nullable=True)

    date = db.Column(db.Date, nullable=False)

    # --- Sperr-Flag ---
    is_locked = db.Column(db.Boolean, default=False, nullable=False)

    # --- NEU: Verknüpfung zur Variante ---
    # Wenn NULL: Gehört zum Hauptplan (öffentlich sichtbar).
    # Wenn gesetzt: Gehört zu einer spezifischen Entwurfs-Variante.
    variant_id = db.Column(db.Integer, db.ForeignKey('plan_variant.id'), nullable=True)
    variant = db.relationship('PlanVariant', backref=db.backref('shifts', cascade="all, delete-orphan"))
    # --- ENDE NEU ---

    user = db.relationship('User', backref=db.backref('shifts', lazy=True))
    shift_type = db.relationship('ShiftType')

    # HINWEIS: Wir entfernen hier den UniqueConstraint ('user_id', 'date'),
    # da ein User nun am selben Tag in verschiedenen Varianten Schichten haben kann.
    # Die Eindeutigkeit (1 Schicht pro Tag pro Variante) muss von der Anwendungslogik sichergestellt werden.
    # __table_args__ = (db.UniqueConstraint('user_id', 'date', name='_user_date_uc'),)

    def to_dict(self):
        abbr = ""
        if self.shift_type:
            abbr = self.shift_type.abbreviation
        elif self.shifttype_id is not None:
            abbr = "ERR"

        return {
            "id": self.id,
            "user_id": self.user_id,
            "date": self.date.isoformat(),
            "shifttype_id": self.shifttype_id,
            "shifttype_abbreviation": abbr,
            "is_locked": self.is_locked,
            "variant_id": self.variant_id
        }


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
    # ÄNDERUNG: Text statt String(255), um große JSON-Konfigurationen zu speichern
    value = db.Column(db.Text, nullable=True)

    def to_dict(self):
        return {
            "key": self.key,
            "value": self.value
        }


class UpdateLog(db.Model):
    """
    Protokolliert wichtige administrative Änderungen und System-Updates.
    (Nur noch manuelle Einträge)
    """
    id = db.Column(db.Integer, primary_key=True)
    area = db.Column(db.String(100), nullable=False, index=True)
    description = db.Column(db.String(255), nullable=True)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "area": self.area,
            "description": self.description,
            "updated_at": self.updated_at.isoformat()
        }


# --- NEU: Activity Log (Für den 'Logs' Reiter) ---
class ActivityLog(db.Model):
    """
    Protokolliert detaillierte Benutzeraktivitäten (Login, Logout, PW-Change, etc.).
    """
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)  # Nullable, falls User gelöscht wird
    user = db.relationship('User')
    action = db.Column(db.String(50), nullable=False)  # Typ: LOGIN, LOGOUT, UPDATE_PROFILE, etc.
    details = db.Column(db.String(255), nullable=True)  # Z.B. "Dauer: 5min", "E-Mail geändert"
    ip_address = db.Column(db.String(50), nullable=True)
    timestamp = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "user_name": f"{self.user.vorname} {self.user.name}" if self.user else "Unbekannt/Gelöscht",
            "action": self.action,
            "details": self.details,
            "ip_address": self.ip_address,
            "timestamp": self.timestamp.isoformat()
        }


# --- ENDE NEU ---


class FeedbackReport(db.Model):
    """
    Speichert Bug-Reports und Verbesserungsvorschläge von Benutzern.
    """
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    user = db.relationship('User')
    report_type = db.Column(db.String(50), nullable=False)
    category = db.Column(db.String(100), nullable=False)
    message = db.Column(db.Text, nullable=False)
    page_context = db.Column(db.String(255), nullable=True)
    status = db.Column(db.String(50), nullable=False, default='neu', index=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    def to_dict(self):
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


class ShiftPlanStatus(db.Model):
    """
    Speichert den Bearbeitungsstatus und die Sperrung für einen Monats-Schichtplan.
    """
    id = db.Column(db.Integer, primary_key=True)
    year = db.Column(db.Integer, nullable=False, index=True)
    month = db.Column(db.Integer, nullable=False, index=True)
    status = db.Column(db.String(50), nullable=False, default='In Bearbeitung')
    is_locked = db.Column(db.Boolean, nullable=False, default=False)

    __table_args__ = (db.UniqueConstraint('year', 'month', name='_year_month_uc'),)

    def to_dict(self):
        return {
            "id": self.id,
            "year": self.year,
            "month": self.month,
            "status": self.status,
            "is_locked": self.is_locked
        }


class ShiftQuery(db.Model):
    """
    Speichert Anfragen oder Kommentare zu einer bestimmten Schicht-Zelle.
    """
    id = db.Column(db.Integer, primary_key=True)
    sender_user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    sender = db.relationship('User', foreign_keys=[sender_user_id])
    target_user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    target_user = db.relationship('User', foreign_keys=[target_user_id])
    shift_date = db.Column(db.Date, nullable=False)
    message = db.Column(db.Text, nullable=False)
    status = db.Column(db.String(50), nullable=False, default='offen', index=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    def to_dict(self):
        target_name = f"{self.target_user.vorname} {self.target_user.name}" if self.target_user else "Thema des Tages / Allgemein"
        sender_role = "Unbekannt"
        if self.sender and self.sender.role:
            sender_role = self.sender.role.name

        return {
            "id": self.id,
            "sender_user_id": self.sender_user_id,
            "sender_name": f"{self.sender.vorname} {self.sender.name}" if self.sender else "Unbekannt",
            "sender_role_name": sender_role,
            "target_user_id": self.target_user_id,
            "target_name": target_name,
            "shift_date": self.shift_date.isoformat(),
            "message": self.message,
            "status": self.status,
            "created_at": self.created_at.isoformat()
        }


class ShiftQueryReply(db.Model):
    """
    Speichert Antworten auf Schicht-Anfragen (ShiftQuery).
    """
    id = db.Column(db.Integer, primary_key=True)
    query_id = db.Column(db.Integer, db.ForeignKey('shift_query.id', ondelete='CASCADE'), nullable=False)
    query = db.relationship('ShiftQuery', backref=db.backref('replies', lazy='dynamic', cascade="all, delete-orphan",
                                                             passive_deletes=True))
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    user = db.relationship('User')
    message = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "query_id": self.query_id,
            "user_id": self.user_id,
            "user_name": f"{self.user.vorname} {self.user.name}" if self.user else "Unbekannt",
            "message": self.message,
            "created_at": self.created_at.isoformat()
        }


class UserShiftLimit(db.Model):
    """
    Speichert das monatliche Limit für eine bestimmte Schichtart pro User.
    """
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    shifttype_id = db.Column(db.Integer, db.ForeignKey('shift_type.id'), nullable=False)
    monthly_limit = db.Column(db.Integer, default=0, nullable=False)

    # Relationships
    user = db.relationship('User', backref=db.backref('shift_limits', lazy=True, cascade="all, delete-orphan"))
    shift_type = db.relationship('ShiftType')

    __table_args__ = (db.UniqueConstraint('user_id', 'shifttype_id', name='_user_shifttype_limit_uc'),)

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "shifttype_id": self.shifttype_id,
            "shifttype_name": self.shift_type.name if self.shift_type else "Unknown",
            "shifttype_abbreviation": self.shift_type.abbreviation if self.shift_type else "??",
            "monthly_limit": self.monthly_limit
        }


class GlobalAnnouncement(db.Model):
    """
    Speichert die globale Mitteilung für das Dashboard.
    """
    id = db.Column(db.Integer, primary_key=True)
    message = db.Column(db.Text, nullable=True)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_by = db.Column(db.String(100), nullable=True)  # Name des Admins

    def to_dict(self):
        return {
            "id": self.id,
            "message": self.message,
            "updated_at": self.updated_at.isoformat(),
            "updated_by": self.updated_by
        }


class UserAnnouncementAck(db.Model):
    """
    Speichert, wann ein Benutzer die Mitteilung zuletzt bestätigt hat.
    """
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False, unique=True)
    acknowledged_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    def to_dict(self):
        return {
            "user_id": self.user_id,
            "acknowledged_at": self.acknowledged_at.isoformat()
        }


# --- NEU: E-Mail Vorlagen Modell ---
class EmailTemplate(db.Model):
    """
    Speichert anpassbare E-Mail-Vorlagen für das System.
    """
    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(50), unique=True, nullable=False,
                    index=True)  # Eindeutiger Schlüssel (z.B. 'password_reset')
    name = db.Column(db.String(100), nullable=False)  # Angezeigter Name für den Admin
    subject = db.Column(db.String(255), nullable=False)  # Betreffzeile
    body = db.Column(db.Text, nullable=False)  # E-Mail Inhalt (HTML oder Text)
    description = db.Column(db.String(255), nullable=True)  # Erklärung, wann diese Mail gesendet wird
    available_placeholders = db.Column(db.String(255), nullable=True)  # JSON-String oder CSV der verfügbaren Variablen

    def to_dict(self):
        return {
            "id": self.id,
            "key": self.key,
            "name": self.name,
            "subject": self.subject,
            "body": self.body,
            "description": self.description,
            "available_placeholders": self.available_placeholders
        }