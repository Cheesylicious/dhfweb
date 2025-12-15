# dhf_app/services_market.py

from datetime import timedelta, datetime, date
import json  # WICHTIG: json importieren
from sqlalchemy import and_, or_, func, extract
from sqlalchemy.orm import joinedload
from .extensions import db
# KORREKTUR: ShiftMarketOffer muss aus models_market importiert werden!
from .models import User, Shift, ShiftType
from .models_market import ShiftMarketOffer, ShiftMarketResponse


class MarketService:
    """
    Kapselt die Geschäftslogik für die Tauschbörse,
    insbesondere die komplexe Kandidaten-Ermittlung und Historie.
    """

    @staticmethod
    def cleanup_old_offers():
        """
        Markiert Angebote als abgelaufen, wenn das Schichtdatum in der Vergangenheit liegt
        ODER das Angebot älter als 7 Tage ist.

        Führt zusätzlich die Prüfung auf automatische Annahme durch (Auto-Accept).
        """
        # 1. Automatische Annahme prüfen (Timer abgelaufen?)
        MarketService.process_auto_accepts()

        # 2. Aufräumen alter Angebote
        try:
            now = datetime.utcnow()
            seven_days_ago = now - timedelta(days=7)
            today_date = datetime.now().date()

            # Finde aktive Angebote, deren Schichtdatum in der Vergangenheit liegt
            past_shifts = ShiftMarketOffer.query.join(Shift).filter(
                ShiftMarketOffer.status == 'active',
                Shift.date < today_date
            ).all()

            # Finde aktive Angebote, die älter als 7 Tage sind
            old_offers = ShiftMarketOffer.query.filter(
                ShiftMarketOffer.status == 'active',
                ShiftMarketOffer.created_at < seven_days_ago
            ).all()

            to_expire = set(past_shifts + old_offers)

            count = 0
            for offer in to_expire:
                offer.status = 'expired'
                count += 1

            if count > 0:
                db.session.commit()
                print(f"[Market] {count} alte Angebote auf 'expired' gesetzt.")
        except Exception as e:
            print(f"[Market] Fehler beim Cleanup: {e}")

    @staticmethod
    def check_and_set_deadline(offer_id):
        """
        Prüft, ob für ein Angebot ein Timer gestartet oder gestoppt werden muss.
        Wird aufgerufen, wenn eine Reaktion (Interesse/Absage) erfolgt.
        Regel:
        - Erster Interessent da? -> Timer auf 24h setzen (falls noch nicht gesetzt).
        - Kein Interessent mehr da? -> Timer entfernen.
        """
        offer = db.session.get(ShiftMarketOffer, offer_id)
        if not offer or offer.status != 'active':
            return

        # Prüfen, ob es aktive Interessenten gibt
        has_interest = ShiftMarketResponse.query.filter_by(
            offer_id=offer_id,
            response_type='interested'
        ).count() > 0

        if has_interest:
            # Wenn Interesse besteht, aber noch kein Timer läuft -> Starten
            if not offer.auto_accept_deadline:
                # Timer: Jetzt + 24 Stunden
                offer.auto_accept_deadline = datetime.utcnow() + timedelta(hours=24)
                print(f"[Market] Timer für Angebot {offer.id} gestartet (24h).")
        else:
            # Wenn kein Interesse mehr besteht (alle abgesprungen), Timer resetten
            if offer.auto_accept_deadline:
                offer.auto_accept_deadline = None
                print(f"[Market] Timer für Angebot {offer.id} gestoppt (keine Interessenten mehr).")

        db.session.commit()

    @staticmethod
    def process_auto_accepts():
        """
        Prüft alle aktiven Angebote auf abgelaufene Deadlines.
        Wenn Deadline erreicht: Automatisch den ältesten (ersten) Interessenten akzeptieren.
        """
        try:
            now = datetime.utcnow()

            # Finde Angebote, deren Deadline erreicht ist
            due_offers = ShiftMarketOffer.query.filter(
                ShiftMarketOffer.status == 'active',
                ShiftMarketOffer.auto_accept_deadline != None,
                ShiftMarketOffer.auto_accept_deadline <= now
            ).all()

            if not due_offers:
                return

            # Import hier, um Zyklen zu vermeiden
            from .services_shift_change import ShiftChangeService

            for offer in due_offers:
                # Den Kandidaten finden, der am längsten wartet (FIFO Prinzip)
                winner_response = ShiftMarketResponse.query.filter_by(
                    offer_id=offer.id,
                    response_type='interested'
                ).order_by(ShiftMarketResponse.created_at.asc()).first()

                if winner_response:
                    candidate = winner_response.user
                    print(f"[Market] Auto-Accept ausgelöst für Angebot {offer.id}. Gewinner: {candidate.name}")

                    # Status im Angebot setzen
                    offer.status = 'pending'
                    offer.accepted_by_id = candidate.id
                    offer.accepted_at = now

                    # Offiziellen Tausch-Antrag erstellen
                    ShiftChangeService.create_request(
                        shift_id=offer.shift_id,
                        requester_id=offer.offering_user_id,
                        replacement_user_id=candidate.id,
                        note=f"🤖 AUTO-MATCH (24h Timer abgelaufen): {offer.offering_user.name} -> {candidate.name}\nNotiz: {offer.note}",
                        reason_type='trade'
                    )
                else:
                    # Sollte eigentlich nicht passieren (Timer läuft, aber keiner will mehr?),
                    # aber zur Sicherheit Timer entfernen, damit er nicht loopet.
                    offer.auto_accept_deadline = None

            db.session.commit()

        except Exception as e:
            print(f"[Market] Fehler bei Auto-Accept Verarbeitung: {e}")
            # Rollback nur bei Fehler, damit der Server weiterläuft
            db.session.rollback()

    @staticmethod
    def check_and_archive_if_all_declined(offer_id):
        """
        Prüft, ob für ein Angebot ALLE potenziellen Kandidaten abgelehnt haben.
        Wenn ja, wird auf 'archived_no_interest' gesetzt, ABER NUR,
        wenn es die 7-Tage-Frist überschritten hat ODER in der Vergangenheit liegt.
        """
        offer = db.session.get(ShiftMarketOffer, offer_id)
        if not offer or offer.status != 'active':
            return

        # 1. Alle potenziellen Kandidaten ermitteln (die DÜRFEN)
        potential = MarketService.get_potential_candidates(offer_id)
        potential_ids = {p['id'] for p in potential}

        # Wenn es keine potentiellen Kandidaten gibt, wird der Status nicht geändert
        if not potential_ids:
            return

        # 2. Alle Reaktionen abrufen
        responses = ShiftMarketResponse.query.filter_by(offer_id=offer_id).all()

        # Check auf Interesse
        has_interest = any(r.response_type == 'interested' for r in responses)
        if has_interest:
            return

        # IDs der Ablehner
        declined_ids = {r.user_id for r in responses if r.response_type == 'declined'}

        # 3. Prüfen: Haben alle Potenziellen ABGELEHNT?
        all_potential_declined = potential_ids.issubset(declined_ids)

        if all_potential_declined:
            # 4. PRÜFUNG DER ZEITFRIST (7 Tage oder Shift-Datum in der Vergangenheit)
            offer_date = offer.shift.date if offer.shift else date.today()
            is_past_shift = offer_date < date.today()
            is_older_than_7_days = (datetime.utcnow() - offer.created_at) > timedelta(days=7)

            if is_past_shift or is_older_than_7_days:
                offer.status = 'archived_no_interest'
                db.session.commit()
                print(
                    f"[Market] Angebot {offer.id} archiviert (Kein Interesse & Frist abgelaufen/Datum in Vergangenheit).")
            # Andernfalls bleibt der Status "active", der Anbieter weiß Bescheid (da keine Interessenten)
            # und das System wartet die Frist ab.

    @staticmethod
    def get_market_history(limit=50):
        """
        Holt die Historie abgeschlossener, abgebrochener, abgelaufener und archivierter Tausche.
        REPARATUR: Liest nun korrekt archivierte Daten aus, wenn die Schicht gelöscht wurde.
        """
        history = ShiftMarketOffer.query.options(
            joinedload(ShiftMarketOffer.shift).joinedload(Shift.shift_type),
            joinedload(ShiftMarketOffer.offering_user),
            joinedload(ShiftMarketOffer.accepted_by_user)
        ).filter(
            ShiftMarketOffer.status.in_(['done', 'cancelled', 'rejected', 'expired', 'archived_no_interest'])
        ).order_by(ShiftMarketOffer.created_at.desc()).limit(limit).all()

        # Performance: Alle Schichtarten einmal laden für Namens-Mapping (Kürzel -> Voller Name)
        all_types = db.session.query(ShiftType).all()
        # Map: "T." -> "Tagdienst"
        type_map_name = {st.abbreviation: st.name for st in all_types}

        results = []
        for offer in history:
            shift_date_str = "Datum Unbekannt"
            shift_abbr = "?"
            shift_name = ""

            # 1. Versuch: Daten aus der lebenden Schicht holen (falls noch existent, z.B. bei 'cancelled')
            if offer.shift:
                shift_date_str = offer.shift.date.strftime('%d.%m.%Y')
                if offer.shift.shift_type:
                    shift_abbr = offer.shift.shift_type.abbreviation
                    shift_name = offer.shift.shift_type.name

            # 2. Versuch: Daten aus dem Archiv-Snapshot holen (wenn Schicht gelöscht wurde, z.B. bei 'done')
            elif offer.archived_shift_data:
                try:
                    data = json.loads(offer.archived_shift_data)
                    # Datum parsen (YYYY-MM-DD -> DD.MM.YYYY)
                    raw_date = data.get('date')
                    if raw_date:
                        d_obj = datetime.strptime(raw_date, '%Y-%m-%d')
                        shift_date_str = d_obj.strftime('%d.%m.%Y')

                    shift_abbr = data.get('abbr', '?')
                    # Den vollen Namen aus der Map holen, da der Snapshot oft nur das Kürzel hat
                    shift_name = type_map_name.get(shift_abbr, "Unbekannt")
                except Exception as e:
                    print(f"[Market History] JSON Error: {e}")

            # Formatierung: "T. (Tagdienst) am 14.12.2025"
            full_shift_info = f"{shift_abbr} ({shift_name}) am {shift_date_str}"

            status_display = offer.status
            if offer.status == 'archived_no_interest': status_display = 'Kein Interesse'
            if offer.status == 'expired': status_display = 'Abgelaufen'

            results.append({
                "id": offer.id,
                "offering_user": f"{offer.offering_user.vorname} {offer.offering_user.name}" if offer.offering_user else "Unbekannt",
                "accepted_by": f"{offer.accepted_by_user.vorname} {offer.accepted_by_user.name}" if offer.accepted_by_user else "-",
                "status": status_display,
                "raw_status": offer.status,
                "note": offer.note,
                # Hier übergeben wir jetzt den schönen String
                "shift_info": full_shift_info,
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
        if offer.status in ['active', 'pending']:
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

    @staticmethod
    def get_enriched_responses(offer_id):
        """
        Lädt alle Antworten auf ein Angebot und reichert sie mit Zusatzinformationen an:
        - Zeitstempel (Wann?)
        - Stundenbilanz (Aktuelle Stunden -> Neue Stunden bei Übernahme)
        """
        offer = db.session.get(ShiftMarketOffer, offer_id)
        if not offer:
            return []

        # Basisdaten des Angebots
        shift_year = offer.shift.date.year
        shift_month = offer.shift.date.month
        shift_hours_value = offer.shift.shift_type.hours if (offer.shift and offer.shift.shift_type) else 0.0

        # Alle Antworten laden (mit User Joined Load)
        responses = ShiftMarketResponse.query.filter_by(offer_id=offer_id).options(
            joinedload(ShiftMarketResponse.user)
        ).all()

        # Liste der interessierten User IDs für die Stunden-Berechnung
        interested_user_ids = [r.user_id for r in responses if r.response_type == 'interested']

        # Bulk-Berechnung der aktuellen Stunden für alle interessierten User in diesem Monat
        # Wir summieren die Stunden aller Schichten im selben Monat
        hours_map = {}
        if interested_user_ids:
            hours_query = db.session.query(
                Shift.user_id,
                func.sum(ShiftType.hours)
            ).join(ShiftType, Shift.shifttype_id == ShiftType.id).filter(
                Shift.user_id.in_(interested_user_ids),
                extract('year', Shift.date) == shift_year,
                extract('month', Shift.date) == shift_month,
                # Nur Hauptplan beachten
                Shift.variant_id == None
            ).group_by(Shift.user_id).all()

            for uid, total_h in hours_query:
                hours_map[uid] = float(total_h) if total_h else 0.0

        # Ergebnisse zusammenbauen
        enriched_results = []
        for r in responses:
            current_h = hours_map.get(r.user_id, 0.0)

            # Neue Stunden nur berechnen, wenn interessiert
            new_h = current_h + shift_hours_value if r.response_type == 'interested' else current_h

            enriched_results.append({
                'id': r.id,
                'offer_id': r.offer_id,
                'user_id': r.user_id,
                'user_name': f"{r.user.vorname} {r.user.name}" if r.user else "Unbekannt",
                'response_type': r.response_type,
                'note': r.note,
                # Timestamp im ISO Format für JS
                'created_at': r.created_at.isoformat(),
                # Stunden-Info
                'current_hours': round(current_h, 1),
                'new_hours': round(new_h, 1),
                'hours_diff': shift_hours_value
            })

        # Sortieren: Interessierte zuerst, dann nach Datum (FIFO)
        enriched_results.sort(key=lambda x: (0 if x['response_type'] == 'interested' else 1, x['created_at']))

        return enriched_results