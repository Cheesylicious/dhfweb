from .extensions import db
from datetime import datetime


class ShiftChangeRequest(db.Model):
    __tablename__ = 'shift_change_request'

    id = db.Column(db.Integer, primary_key=True)
    original_shift_id = db.Column(db.Integer, db.ForeignKey('shift.id'), nullable=True)
    requester_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    replacement_user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)

    # NEU: Speichert die ursprüngliche Schichtart für "Rückgängig machen"
    backup_shifttype_id = db.Column(db.Integer, nullable=True)

    reason_type = db.Column(db.String(50), default='sickness', nullable=False)
    note = db.Column(db.String(255), nullable=True)
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
        shift_date_str = self.original_shift.date.isoformat() if self.original_shift else None
        original_user = "Unbekannt"
        if self.original_shift and self.original_shift.user:
            original_user = f"{self.original_shift.user.vorname} {self.original_shift.user.name}"
        elif not self.original_shift:
            original_user = "Schicht gelöscht/offen"

        requester_name = "System"
        if self.requester:
            requester_name = f"{self.requester.vorname} {self.requester.name}"

        replacement_name = "Kein Ersatz"
        if self.replacement_user:
            replacement_name = f"{self.replacement_user.vorname} {self.replacement_user.name}"

        return {
            "id": self.id,
            "original_shift_id": self.original_shift_id,
            "shift_date": shift_date_str,
            "original_user_name": original_user,
            "requester_name": requester_name,
            "replacement_user_id": self.replacement_user_id,
            "replacement_name": replacement_name,
            "reason_type": self.reason_type,
            "note": self.note,
            "status": self.status,
            "created_at": self.created_at.isoformat()
        }