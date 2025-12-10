from .extensions import db
from datetime import datetime


class ShiftChangeRequest(db.Model):
    """
    Speichert Änderungsanträge für bereits gesperrte Schichtpläne.
    Ermöglicht Planschreibern, Änderungen (z.B. Krankheit) zu beantragen,
    die vom Admin genehmigt werden müssen.
    """
    __tablename__ = 'shift_change_request'

    id = db.Column(db.Integer, primary_key=True)

    # Referenz zur ursprünglichen Schicht (die Person, die krank ist)
    original_shift_id = db.Column(db.Integer, db.ForeignKey('shift.id'), nullable=False)

    # Wer stellt den Antrag? (Planschreiber)
    requester_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)

    # Optional: Wer soll einspringen?
    replacement_user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)

    # Art der Änderung (z.B. 'sickness', 'swap')
    reason_type = db.Column(db.String(50), default='sickness', nullable=False)

    # Notiz / Begründung
    note = db.Column(db.String(255), nullable=True)

    # Status des Antrags: 'pending', 'approved', 'rejected'
    status = db.Column(db.String(20), default='pending', index=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    processed_at = db.Column(db.DateTime, nullable=True)
    processed_by_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)

    # Relationships
    original_shift = db.relationship('Shift', backref=db.backref('change_requests', lazy=True))
    requester = db.relationship('User', foreign_keys=[requester_id])
    replacement_user = db.relationship('User', foreign_keys=[replacement_user_id])
    processed_by = db.relationship('User', foreign_keys=[processed_by_id])

    def to_dict(self):
        return {
            "id": self.id,
            "original_shift_id": self.original_shift_id,
            "shift_date": self.original_shift.date.isoformat() if self.original_shift else None,
            "original_user_name": f"{self.original_shift.user.vorname} {self.original_shift.user.name}" if self.original_shift and self.original_shift.user else "Unbekannt",
            "requester_name": f"{self.requester.vorname} {self.requester.name}" if self.requester else "System",
            "replacement_user_id": self.replacement_user_id,
            "replacement_name": f"{self.replacement_user.vorname} {self.replacement_user.name}" if self.replacement_user else "Kein Ersatz",
            "reason_type": self.reason_type,
            "note": self.note,
            "status": self.status,
            "created_at": self.created_at.isoformat()
        }