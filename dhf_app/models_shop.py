from dhf_app.extensions import db
from sqlalchemy.sql import func
from datetime import datetime


class ShopItem(db.Model):
    __tablename__ = 'shop_items'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.String(255), nullable=True)
    icon_class = db.Column(db.String(50), default="fas fa-box")  # Für FontAwesome
    cost_xp = db.Column(db.Integer, nullable=False, default=100)

    # Technische Konfiguration des Items
    item_type = db.Column(db.String(50), nullable=False)  # z.B. 'xp_multiplier'
    multiplier_value = db.Column(db.Float, default=1.0)  # z.B. 1.5 für +50%
    duration_days = db.Column(db.Integer, default=0)  # Wie lange hält es?

    is_active = db.Column(db.Boolean, default=True)  # Kann vom Admin deaktiviert werden
    # NEU: Nachricht, die angezeigt wird, wenn das Item deaktiviert ist
    deactivation_message = db.Column(db.String(255), nullable=True)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'icon_class': self.icon_class,
            'cost_xp': self.cost_xp,
            'item_type': self.item_type,
            'multiplier_value': self.multiplier_value,
            'duration_days': self.duration_days,
            'is_active': self.is_active,
            # NEU: Nachricht hinzufügen
            'deactivation_message': self.deactivation_message
        }


class UserActiveEffect(db.Model):
    __tablename__ = 'user_active_effects'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    item_id = db.Column(db.Integer, db.ForeignKey('shop_items.id'), nullable=False)

    # Cache für schnelle Berechnung, damit wir nicht immer das Item joinen müssen
    multiplier_value = db.Column(db.Float, default=1.0)

    # KRITISCHE KORREKTUR: Verwende func.now() anstelle von datetime.utcnow
    start_date = db.Column(db.DateTime, default=func.now())
    end_date = db.Column(db.DateTime, nullable=False)

    def is_expired(self):
        return datetime.utcnow() > self.end_date