from .extensions import db
from datetime import datetime


class GamificationSettings(db.Model):
    """
    Speichert die globalen Einstellungen für XP-Werte.
    Dient als "Control Center" für den Admin.
    """
    __tablename__ = 'gamification_settings'

    id = db.Column(db.Integer, primary_key=True)

    # XP für Schichten
    xp_tag_workday = db.Column(db.Integer, default=10)  # T. (Mo-Fr)
    xp_tag_weekend = db.Column(db.Integer, default=5)  # T. (Sa/So)
    xp_night = db.Column(db.Integer, default=5)  # N.
    xp_24h = db.Column(db.Integer, default=10)  # 24
    xp_friday_6 = db.Column(db.Integer, default=20)  # 6er (Freitag)

    # Boni & Multiplikatoren
    xp_health_bonus = db.Column(db.Integer, default=100)  # Monat ohne Krank
    xp_holiday_mult = db.Column(db.Float, default=2.0)  # Multiplikator Feiertag

    last_updated = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'xp_tag_workday': self.xp_tag_workday,
            'xp_tag_weekend': self.xp_tag_weekend,
            'xp_night': self.xp_night,
            'xp_24h': self.xp_24h,
            'xp_friday_6': self.xp_friday_6,
            'xp_health_bonus': self.xp_health_bonus,
            'xp_holiday_mult': self.xp_holiday_mult
        }


class UserGamificationStats(db.Model):
    """
    Speichert die Gamification-Metriken und Fairness-Statistiken für einen Benutzer.
    """
    __tablename__ = 'user_gamification_stats'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False, unique=True)

    # --- Fairness Metriken ---
    weekend_shift_count = db.Column(db.Integer, default=0)
    weekend_balance = db.Column(db.Float, default=0.0)
    holiday_shift_count = db.Column(db.Integer, default=0)

    # --- Gamification ---
    points_total = db.Column(db.Integer, default=0)
    current_level = db.Column(db.Integer, default=1)
    current_rank = db.Column(db.String(50), default="Anwärter")
    jokers_available = db.Column(db.Integer, default=0)

    last_updated = db.Column(db.DateTime, default=datetime.utcnow)

    user = db.relationship('User',
                           backref=db.backref('gamification_stats', uselist=False, cascade="all, delete-orphan"))

    def to_dict(self):
        return {
            "user_id": self.user_id,
            "weekend_shift_count": self.weekend_shift_count,
            "weekend_balance": self.weekend_balance,
            "holiday_shift_count": self.holiday_shift_count,
            "points_total": self.points_total,
            "current_level": self.current_level,
            "current_rank": self.current_rank,
            "jokers_available": self.jokers_available,
            "last_updated": self.last_updated.isoformat() if self.last_updated else None
        }


class GamificationLog(db.Model):
    """
    Protokolliert, wofür Punkte vergeben wurden (Historie).
    """
    __tablename__ = 'gamification_log'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)

    action_type = db.Column(db.String(50), nullable=False, default='shift')
    points_awarded = db.Column(db.Integer, nullable=False)
    description = db.Column(db.String(255), nullable=True)

    shift_id = db.Column(db.Integer, db.ForeignKey('shift.id'), nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    user = db.relationship('User',
                           backref=db.backref('gamification_logs', lazy='dynamic', cascade="all, delete-orphan"))
    shift = db.relationship('Shift', backref=db.backref('xp_entries', lazy=True))

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "shift_id": self.shift_id,
            "action_type": self.action_type,
            "points_awarded": self.points_awarded,
            "description": self.description,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }