from datetime import datetime
import traceback
from .extensions import db, socketio
from .models_shift_change import ShiftChangeRequest
from .models import Shift, User, ShiftType
from .models_market import ShiftMarketOffer


class ShiftChangeService:

    @staticmethod
    def create_request(shift_id, requester_id, replacement_user_id=None, note=None, reason_type='sickness'):
        """
        Erstellt einen neuen Änderungsantrag.
        """
        shift = db.session.get(Shift, shift_id)
        if not shift:
            return {"error": "Schicht nicht gefunden"}, 404

        existing = ShiftChangeRequest.query.filter_by(
            original_shift_id=shift_id,
            status='pending'
        ).first()

        if existing:
            return {"error": "Es gibt bereits einen offenen Antrag für diese Schicht."}, 400

        backup_shifttype_id = shift.shifttype_id

        new_request = ShiftChangeRequest(
            original_shift_id=shift_id,
            requester_id=requester_id,
            replacement_user_id=replacement_user_id,
            backup_shifttype_id=backup_shifttype_id,
            note=note,
            reason_type=reason_type,
            status='pending',
            created_at=datetime.utcnow()
        )

        db.session.add(new_request)
        db.session.commit()

        # Auch hier status mitgeben
        return {"status": "success", "request": new_request.to_dict()}, 201

    @staticmethod
    def approve_request(request_id, admin_user_id):
        """
        Genehmigt den Antrag und führt die Änderungen SOFORT durch.
        """
        print(f"[ShiftChange] Starte Approval für Request {request_id}...")

        req = ShiftChangeRequest.query.get(request_id)
        if not req or req.status != 'pending':
            return {"error": "Antrag nicht gefunden oder bereits bearbeitet"}, 400

        original_shift = req.original_shift

        if not original_shift:
            print("[ShiftChange] Originalschicht nicht gefunden! Breche ab.")
            req.status = 'approved'
            db.session.commit()
            # Hier auch success senden, damit das UI aufräumt
            return {"status": "success", "message": "Schicht existierte nicht mehr. Antrag wurde archiviert."}, 200

        target_date = original_shift.date
        target_variant = original_shift.variant_id
        giver_user_id = original_shift.user_id
        shift_type_id = req.backup_shifttype_id

        socket_updates = []

        # --- 1. MARKTPLATZ BEREINIGEN ---
        try:
            market_offers = ShiftMarketOffer.query.filter_by(shift_id=original_shift.id).all()
            for offer in market_offers:
                offer.status = 'done'
                print(f"[ShiftChange] Markt-Angebot {offer.id} auf 'done' gesetzt.")
            db.session.flush()
        except Exception as e:
            print(f"[ShiftChange] Warnung bei Markt-Bereinigung: {e}")

        # --- 2. ABGEBER (GIVER) BEARBEITEN ---

        if req.reason_type == 'sickness':
            print("[ShiftChange] Typ: Krankheit. Setze Schicht auf 'Krank'.")
            sick_type = ShiftType.query.filter((ShiftType.name == 'Krank') | (ShiftType.abbreviation == 'K')).first()
            if not sick_type:
                return {"error": "Schichtart 'Krank' fehlt im System!"}, 500

            original_shift.shifttype_id = sick_type.id
            original_shift.is_locked = True
            original_shift.is_trade = False  # Sicherstellen

            socket_updates.append({
                'user_id': giver_user_id,
                'date': target_date.isoformat(),
                'shifttype_id': sick_type.id,
                'variant_id': target_variant,
                'is_deleted': False,
                'is_trade': False
            })

        elif req.reason_type == 'trade':
            print("[ShiftChange] Typ: Tausch. Lösche alte Schicht.")
            req.original_shift_id = None
            db.session.delete(original_shift)

            socket_updates.append({
                'user_id': giver_user_id,
                'date': target_date.isoformat(),
                'shifttype_id': None,
                'variant_id': target_variant,
                'is_deleted': True,
                'is_trade': False
            })

        # --- 3. ERSATZ (RECEIVER) EINTRAGEN ---
        if req.replacement_user_id:
            receiver_id = req.replacement_user_id
            print(f"[ShiftChange] Trage Ersatz ein: User {receiver_id}")

            existing_shift = Shift.query.filter_by(
                user_id=receiver_id,
                date=target_date,
                variant_id=target_variant
            ).first()

            # --- NEU: Handshake-Flag setzen wenn es ein Tausch war ---
            is_trade_flag = (req.reason_type == 'trade')
            # ---------------------------------------------------------

            if existing_shift:
                existing_shift.shifttype_id = shift_type_id
                existing_shift.is_locked = True
                existing_shift.is_trade = is_trade_flag  # <<< NEU

                socket_updates.append({
                    'user_id': receiver_id,
                    'date': target_date.isoformat(),
                    'shifttype_id': shift_type_id,
                    'variant_id': target_variant,
                    'is_deleted': False,
                    'is_trade': is_trade_flag # <<< NEU
                })
            else:
                new_shift = Shift(
                    user_id=receiver_id,
                    date=target_date,
                    shifttype_id=shift_type_id,
                    variant_id=target_variant,
                    is_locked=True,
                    is_trade=is_trade_flag  # <<< NEU
                )
                db.session.add(new_shift)
                db.session.flush()

                socket_updates.append({
                    'user_id': receiver_id,
                    'date': target_date.isoformat(),
                    'shifttype_id': shift_type_id,
                    'variant_id': target_variant,
                    'is_deleted': False,
                    'is_trade': is_trade_flag # <<< NEU
                })

        # --- 4. ABSCHLUSS ---
        req.status = 'approved'
        req.processed_at = datetime.utcnow()
        req.processed_by_id = admin_user_id

        try:
            db.session.commit()
            print("[ShiftChange] DB Commit erfolgreich.")
        except Exception as e:
            db.session.rollback()
            print(f"[ShiftChange] DB ERROR: {e}")
            traceback.print_exc()
            return {"message": f"Datenbankfehler: {str(e)}"}, 500

        # --- 5. SOCKET EVENTS SENDEN ---
        try:
            for update in socket_updates:
                payload = {
                    'type': 'single',
                    'user_id': update['user_id'],
                    'date': update['date'],
                    'shifttype_id': update['shifttype_id'],
                    'variant_id': update['variant_id'],
                    'is_deleted': update['is_deleted'],
                    # NEU: Das Flag übergeben (innerhalb von data oder direkt, je nach Client)
                    # Wir packen es in 'data' für Konsistenz mit routes_shifts.save_shift
                    'data': {
                        'new_total_hours': 0,
                        'violations': [],
                        'is_trade': update['is_trade'] # <<< WICHTIG
                    }
                }
                socketio.emit('shift_update', payload)
        except Exception as e:
            print(f"[ShiftChange] Socket Error: {e}")

        # --- FIX: status: success HINZUGEFÜGT ---
        return {
            "status": "success",
            "message": "Änderung erfolgreich durchgeführt.",
            "request": req.to_dict()
        }, 200

    @staticmethod
    def reject_request(request_id, admin_user_id):
        req = ShiftChangeRequest.query.get(request_id)
        if not req:
            return {"error": "Antrag nicht gefunden"}, 404

        if req.original_shift_id and req.reason_type == 'trade':
            market_offer = ShiftMarketOffer.query.filter_by(shift_id=req.original_shift_id, status='pending').first()
            if market_offer:
                market_offer.status = 'active'
                market_offer.accepted_by_id = None
                market_offer.accepted_at = None
                print(f"[ShiftChange] Antrag abgelehnt -> Angebot {market_offer.id} wieder freigegeben.")

        req.status = 'rejected'
        req.processed_at = datetime.utcnow()
        req.processed_by_id = admin_user_id

        db.session.commit()

        # --- FIX: status: success HINZUGEFÜGT ---
        return {
            "status": "success",
            "message": "Antrag abgelehnt (Angebot wieder freigegeben).",
            "request": req.to_dict()
        }, 200