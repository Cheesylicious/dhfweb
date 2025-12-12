from .extensions import db
from datetime import datetime


class ShiftMarketOffer(db.Model):
    """
    Repräsentiert ein Schicht-Angebot in der Tauschbörse.
    Hundeführer können ihre Schichten hier einstellen.
    """
    __tablename__ = 'shift_market_offers'

    id = db.Column(db.Integer, primary_key=True)

    # Welche Schicht wird angeboten?
    shift_id = db.Column(db.Integer, db.ForeignKey('shift.id'), nullable=False)

    # Wer bietet sie an?
    offering_user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)

    # Optionale Notiz (z.B. "Suche Tausch gegen Wochenende")
    note = db.Column(db.String(255), nullable=True)

    # Status des Angebots
    # 'active'   = In der Börse sichtbar
    # 'pending'  = Jemand hat angebissen, warte auf Admin-Genehmigung
    # 'done'     = Tausch abgeschlossen / genehmigt
    # 'cancelled'= Vom Ersteller zurückgezogen
    status = db.Column(db.String(20), default='active', index=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Wer hat das Angebot angenommen? (Bevor der Admin genehmigt)
    accepted_by_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    accepted_at = db.Column(db.DateTime, nullable=True)

    # Relationships
    shift = db.relationship('Shift', backref=db.backref('market_offers', lazy=True, cascade="all, delete-orphan"))
    offering_user = db.relationship('User', foreign_keys=[offering_user_id])
    accepted_by_user = db.relationship('User', foreign_keys=[accepted_by_id])

    def to_dict(self):
        """
        JSON-Repräsentation für das Frontend.
        """
        st_abbr = "?"
        st_color = "#cccccc"
        shift_date = None

        if self.shift:
            shift_date = self.shift.date.isoformat()
            if self.shift.shift_type:
                st_abbr = self.shift.shift_type.abbreviation
                st_color = self.shift.shift_type.color

        offering_name = "Unbekannt"
        if self.offering_user:
            offering_name = f"{self.offering_user.vorname} {self.offering_user.name}"

        return {
            'id': self.id,
            'shift_id': self.shift_id,
            'shift_date': shift_date,
            'shift_type_abbr': st_abbr,
            'shift_type_color': st_color,
            'offering_user_id': self.offering_user_id,
            'offering_user_name': offering_name,
            'note': self.note,
            'status': self.status,
            'created_at': self.created_at.isoformat(),
            'is_my_offer': False,  # Wird im Backend/Frontend dynamisch gesetzt
            'accepted_by_id': self.accepted_by_id
        }