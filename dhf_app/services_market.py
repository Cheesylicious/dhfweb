# dhf_app/services_market.py

from datetime import timedelta, datetime
from sqlalchemy import and_, or_
from sqlalchemy.orm import joinedload
from .extensions import db
# KORREKTUR: ShiftMarketOffer muss aus models_market importiert werden!
from .models import User, Shift, ShiftType
from .models_market import ShiftMarketOffer


class MarketService:
    """
    Kapselt die Geschäftslogik für die Tauschbörse,
    insbesondere die komplexe Kandidaten-Ermittlung und Historie.
    """

    @staticmethod
    def get_market_history(limit=50):
        """
        Holt die Historie abgeschlossener oder abgebrochener Tausche.
        """
        history = ShiftMarketOffer.query.options(
            joinedload(ShiftMarketOffer.shift).joinedload(Shift.shift_type),
            joinedload(ShiftMarketOffer.offering_user),
            joinedload(ShiftMarketOffer.accepted_by_user)
        ).filter(
            ShiftMarketOffer.status.in_(['done', 'cancelled', 'rejected'])
        ).order_by(ShiftMarketOffer.created_at.desc()).limit(limit).all()

        results = []
        for offer in history:
            shift_date_str = "Gelöscht/Unbekannt"
            shift_abbr = "?"

            # Falls die Schicht noch existiert (z.B. bei cancelled)
            if offer.shift:
                shift_date_str = offer.shift.date.isoformat()
                if offer.shift.shift_type:
                    shift_abbr = offer.shift.shift_type.abbreviation
            # Hinweis: Bei 'done' Trades wurde die Schicht gelöscht/neu vergeben.
            # Hier zeigen wir an, was noch im Offer-Objekt referenzierbar ist.

            results.append({
                "id": offer.id,
                "offering_user": f"{offer.offering_user.vorname} {offer.offering_user.name}" if offer.offering_user else "Unbekannt",
                "accepted_by": f"{offer.accepted_by_user.vorname} {offer.accepted_by_user.name}" if offer.accepted_by_user else "-",
                "status": offer.status,
                "note": offer.note,
                "shift_info": f"{shift_abbr} am {shift_date_str}",
                "created_at": offer.created_at.isoformat()
            })
        return results

    @staticmethod
    def delete_history_entry(offer_id):
        """
        Löscht einen historischen Eintrag endgültig (Admin).
        """
        offer = db.session.get(ShiftMarketOffer, offer_id)
        if not offer:
            return False, "Eintrag nicht gefunden"

        # Nur Historie löschen
        if offer.status == 'active' or offer.status == 'pending':
            return False, "Aktive oder laufende Angebote können hier nicht gelöscht werden."

        db.session.delete(offer)
        db.session.commit()
        return True, "Eintrag gelöscht"

    @staticmethod
    def get_potential_candidates(offer_id):
        """
        Ermittelt eine Liste von Usern, die diese Schicht übernehmen KÖNNTEN.
        """
        offer = db.session.get(ShiftMarketOffer, offer_id)
        if not offer or not offer.shift:
            return []

        target_date = offer.shift.date
        target_shift_type = offer.shift.shift_type
        if not target_shift_type:
            return []

        variant_id = offer.shift.variant_id  # Sollte None sein für Hauptplan

        # 1. Alle aktiven User laden
        all_users = User.query.filter(
            User.shift_plan_visible == True,
            User.id != offer.offering_user_id,  # Nicht der Anbieter selbst
            or_(User.inaktiv_ab_datum == None, User.inaktiv_ab_datum > target_date)
        ).order_by(User.vorname).all()

        # 2. Bulk-Load: Wer arbeitet heute schon? (Blocker)
        shifts_today = Shift.query.options(joinedload(Shift.user)).filter(
            Shift.date == target_date,
            Shift.variant_id == variant_id,
            Shift.shifttype_id != None
        ).all()

        users_working_today = {s.user_id for s in shifts_today}

        # Hunde-Logik vorbereiten
        dogs_active_today = []
        for s in shifts_today:
            if s.user and s.user.diensthund and s.user.diensthund != '---' and s.shift_type:
                dogs_active_today.append({
                    'dog': s.user.diensthund,
                    'shift_type': s.shift_type,
                    'user_id': s.user_id
                })

        # 3. Bulk-Load: Wer hat gestern Nachtschicht gehabt?
        users_with_rest_conflict = set()
        if target_shift_type.abbreviation in ['T.', '6', 'S', 'QA']:
            yesterday = target_date - timedelta(days=1)
            shifts_yesterday = Shift.query.join(ShiftType).filter(
                Shift.date == yesterday,
                Shift.variant_id == variant_id,
                ShiftType.abbreviation == 'N.'
            ).all()
            users_with_rest_conflict = {s.user_id for s in shifts_yesterday}

        # 4. Kandidaten filtern
        candidates = []

        for user in all_users:
            # Check 1: Arbeitet schon?
            if user.id in users_working_today:
                continue

                # Check 2: Ruhezeit
            if user.id in users_with_rest_conflict:
                continue

                # Check 3: Hundekonflikt
            if user.diensthund and user.diensthund != '---':
                has_dog_conflict = False
                for active_dog in dogs_active_today:
                    if active_dog['dog'] == user.diensthund:
                        # Gleicher Hund! Prüfe Zeitüberlappung
                        if MarketService._check_overlap(target_shift_type, active_dog['shift_type']):
                            has_dog_conflict = True
                            break
                if has_dog_conflict:
                    continue

            candidates.append({
                "id": user.id,
                "name": f"{user.vorname} {user.name}",
                "dog": user.diensthund if user.diensthund else ""
            })

        return candidates

    @staticmethod
    def _check_overlap(st1, st2):
        """
        Interne Hilfsfunktion: Zeitüberlappung prüfen.
        """
        if not st1 or not st2: return False
        if not st1.start_time or not st1.end_time or not st2.start_time or not st2.end_time:
            return False

        try:
            def to_min(t_str):
                h, m = map(int, t_str.split(':'))
                return h * 60 + m

            s1, e1 = to_min(st1.start_time), to_min(st1.end_time)
            s2, e2 = to_min(st2.start_time), to_min(st2.end_time)

            if e1 <= s1: e1 += 24 * 60
            if e2 <= s2: e2 += 24 * 60

            return s1 < e2 and s2 < e1
        except:
            return False