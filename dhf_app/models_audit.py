from .extensions import db
from datetime import datetime
from flask_login import current_user
from flask import request
import json


class AuditLog(db.Model):
    __tablename__ = 'audit_logs'

    id = db.Column(db.Integer, primary_key=True)

    # --- KORREKTUR: 'user.id' statt 'users.id' (Singular!) ---
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)

    user_name = db.Column(db.String(100))  # Snapshot des Namens
    action = db.Column(db.String(50), nullable=False)
    target_date = db.Column(db.Date, nullable=True)
    details = db.Column(db.Text, nullable=True)
    ip_address = db.Column(db.String(45))
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

    # Beziehung
    user = db.relationship('User', backref='audit_actions', lazy=True)

    def to_dict(self):
        return {
            'id': self.id,
            'user_name': self.user.name if self.user else (self.user_name or "System"),
            'action': self.action,
            'target_date': self.target_date.isoformat() if self.target_date else None,
            'details': json.loads(self.details) if self.details else {},
            'timestamp': self.timestamp.isoformat(),
            'ip_address': self.ip_address
        }


def log_audit(action, details=None, target_date=None, user=None):
    """
    Erstellt einen Audit-Eintrag und speichert ihn SOFORT.
    """
    try:
        # User ermitteln
        u_id = None
        u_name = "System"

        if user:
            u_id = user.id
            u_name = f"{user.vorname} {user.name}"
        elif current_user and current_user.is_authenticated:
            u_id = current_user.id
            u_name = f"{current_user.vorname} {current_user.name}"

        # IP ermitteln
        ip = "127.0.0.1"
        if request:
            # Falls hinter Nginx Proxy
            if request.headers.get('X-Forwarded-For'):
                ip = request.headers.get('X-Forwarded-For').split(',')[0]
            else:
                ip = request.remote_addr

        # Details als JSON
        details_json = json.dumps(details) if details else None

        new_log = AuditLog(
            user_id=u_id,
            user_name=u_name,
            action=action,
            target_date=target_date,
            details=details_json,
            ip_address=ip
        )

        db.session.add(new_log)
        db.session.commit()  # <<< HIER: ZWINGENDES SPEICHERN!
        print(f"[AUDIT] Log gespeichert: {action} von {u_name}")  # Debug-Ausgabe in der Konsole

    except Exception as e:
        db.session.rollback()  # Wichtig bei Fehlern
        print(f"[AUDIT ERROR] Konnte nicht loggen: {e}")