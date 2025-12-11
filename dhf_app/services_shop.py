from datetime import datetime, timedelta
from sqlalchemy import func
from dhf_app.extensions import db
from dhf_app.models import User
from dhf_app.models_gamification import UserGamificationStats
from dhf_app.models_shop import ShopItem, UserActiveEffect


class ShopService:
    """
    Zentraler Service für Shop-Logik und Transaktionen.
    """

    @staticmethod
    def get_all_items(include_inactive=False):
        """ Gibt alle Shop-Items zurück (für die Anzeige im Shop). """
        try:
            query = ShopItem.query
            # FIX: Diese Logik wird nun fast immer ignoriert (include_inactive=True wird in der Route gesetzt)
            if not include_inactive:
                query = query.filter_by(is_active=True)
            return [item.to_dict() for item in query.all()]
        except Exception as e:
            print(f"ShopService ERROR in get_all_items: {e}")
            return []

    @staticmethod
    def update_item_price(item_id, new_price, admin_user):
        item = ShopItem.query.get(item_id)
        if not item:
            return {"success": False, "message": "Item nicht gefunden."}

        try:
            item.cost_xp = int(new_price)
            db.session.commit()
            return {"success": True, "message": "Preis aktualisiert."}
        except Exception as e:
            db.session.rollback()
            return {"success": False, "message": f"Datenbankfehler beim Preis-Update: {str(e)}"}

    # NEUE METHODE: Item aktivieren/deaktivieren
    @staticmethod
    def toggle_item_active_status(item_id, is_active, message=""):
        item = ShopItem.query.get(item_id)
        if not item:
            return {"success": False, "message": "Item nicht gefunden."}

        try:
            item.is_active = is_active
            # Setze die Deaktivierung-Nachricht nur, wenn es deaktiviert wird
            if not is_active:
                item.deactivation_message = message if message else "Aktuell nicht verfügbar."
            else:
                item.deactivation_message = None  # Nachricht beim Aktivieren löschen

            db.session.commit()
            action = "aktiviert" if is_active else "deaktiviert"
            return {"success": True, "message": f"Item '{item.name}' erfolgreich {action}."}
        except Exception as e:
            db.session.rollback()
            return {"success": False, "message": f"Datenbankfehler beim De-/Aktivieren: {str(e)}"}

    @staticmethod
    def buy_item(user_id, item_id):
        # 1. Daten abrufen
        user = User.query.get(user_id)
        item = ShopItem.query.get(item_id)
        stats = UserGamificationStats.query.filter_by(user_id=user_id).first()

        if not user or not item:
            return {"success": False, "message": "Benutzerprofil oder Item nicht gefunden."}

        # NEU: Prüfen, ob das Item aktiv ist
        if not item.is_active:
            # Hier liegt der Fix für den Kauf: Kauf wird verweigert, Nachricht wird verwendet
            return {"success": False,
                    "message": f"Dieses Item ist aktuell nicht verfügbar: {item.deactivation_message}"}

        if not stats or stats.points_total is None:
            return {"success": False, "message": "XP-Guthaben konnte nicht abgerufen werden."}

        # 2. XP-Prüfung (nutzt stats.points_total)
        current_xp = stats.points_total
        if current_xp < item.cost_xp:
            return {"success": False, "message": "Nicht genügend Erfahrungspunkte. Kaufe mehr XP!"}

        try:
            # 3. XP Abziehen (vom stats-Objekt)
            stats.points_total -= item.cost_xp

            # Effekt anwenden
            if item.item_type == 'xp_multiplier':
                existing_effect = UserActiveEffect.query.filter_by(
                    user_id=user.id,
                    item_id=item.id
                ).filter(UserActiveEffect.end_date > datetime.utcnow()).first()

                if existing_effect:
                    existing_effect.end_date += timedelta(days=item.duration_days)
                    msg = f"{item.name} erfolgreich verlängert!"
                else:
                    new_end = datetime.utcnow() + timedelta(days=item.duration_days)
                    new_effect = UserActiveEffect(
                        user_id=user.id,
                        item_id=item.id,
                        multiplier_value=item.multiplier_value,
                        end_date=new_end
                    )
                    db.session.add(new_effect)
                    msg = f"{item.name} erfolgreich gekauft!"
            else:
                msg = f"{item.name} erfolgreich gekauft!"

            # 4. Transaktion abschließen
            db.session.commit()
            return {"success": True, "message": msg, "new_xp": stats.points_total}

        except Exception as e:
            db.session.rollback()
            return {"success": False, "message": f"Datenbankfehler bei Kaufabwicklung: {str(e)}"}

    @staticmethod
    def get_user_active_effects(user_id):
        """
        Gibt aktive, nicht abgelaufene Effekte des Users zurück.
        """
        now = datetime.utcnow()
        result = []

        try:
            effects = UserActiveEffect.query.filter(
                UserActiveEffect.user_id == user_id,
                UserActiveEffect.end_date > now
            ).all()
        except Exception as e:
            print(f"ShopService KRITISCHER DB-FEHLER in get_user_active_effects: {e}")
            return []

        for eff in effects:
            item = ShopItem.query.get(eff.item_id)
            if not item:
                continue

            result.append({
                'name': item.name,
                'multiplier': eff.multiplier_value,
                'end_date': eff.end_date.strftime('%d.%m.%Y %H:%M'),
                'days_left': (eff.end_date - now).days
            })
        return result

    @staticmethod
    def init_default_items():
        pass