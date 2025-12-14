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
    # 'active'               = In der Börse sichtbar
    # 'pending'              = In Verhandlung (Admin-Genehmigung ausstehend)
    # 'done'                 = Tausch abgeschlossen / genehmigt
    # 'cancelled'            = Vom Ersteller zurückgezogen
    # 'expired'              = Abgelaufen (Datum vorbei oder > 7 Tage)
    # 'archived_no_interest' = Automatisch archiviert (alle Kandidaten haben abgelehnt)
    status = db.Column(db.String(30), default='active', index=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Wer hat den Zuschlag bekommen? (Bevor der Admin genehmigt)
    accepted_by_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    accepted_at = db.Column(db.DateTime, nullable=True)

    # Relationships
    shift = db.relationship('Shift', backref=db.backref('market_offers', lazy=True, cascade="all, delete-orphan"))
    offering_user = db.relationship('User', foreign_keys=[offering_user_id])
    accepted_by_user = db.relationship('User', foreign_keys=[accepted_by_id])

    # NEU: Reaktionen der Kandidaten (Interesse / Ablehnung)
    responses = db.relationship('ShiftMarketResponse', backref='offer', lazy='dynamic', cascade="all, delete-orphan")

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


class ShiftMarketResponse(db.Model):
    """
    Speichert die Reaktion eines Kandidaten auf ein Angebot.
    Damit wissen wir, wer Interesse hat oder wer abgelehnt hat.
    """
    __tablename__ = 'shift_market_responses'

    id = db.Column(db.Integer, primary_key=True)
    offer_id = db.Column(db.Integer, db.ForeignKey('shift_market_offers.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)

    # Art der Antwort: 'interested' oder 'declined'
    response_type = db.Column(db.String(20), nullable=False)

    # Optionale Notiz (z.B. "Kann nicht wegen Geburtstag" oder "Gerne!")
    note = db.Column(db.String(255), nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Relationship zum User, damit wir den Namen anzeigen können
    user = db.relationship('User')

    def to_dict(self):
        return {
            'id': self.id,
            'offer_id': self.offer_id,
            'user_id': self.user_id,
            'user_name': f"{self.user.vorname} {self.user.name}" if self.user else "Unbekannt",
            'response_type': self.response_type,
            'note': self.note,
            'created_at': self.created_at.isoformat()
        }