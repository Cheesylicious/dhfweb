# dhf_app/services_shift_change.py

from datetime import datetime
import traceback
import json
from .extensions import db, socketio
from .models_shift_change import ShiftChangeRequest
from .models import Shift, User, ShiftType
from .models_market import ShiftMarketOffer


class ShiftChangeService:

    @staticmethod
    def create_request(shift_id, requester_id, replacement_user_id=None, note=None, reason_type='sickness'):
        """
        Erstellt einen neuen Änderungsantrag.
        WICHTIG: Bei 'trade' (Tausch) wird dieser sofort genehmigt (Auto-Approve).
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

        # Datum direkt mitspeichern (für sicheren Rollback)
        new_request = ShiftChangeRequest(
            original_shift_id=shift_id,
            requester_id=requester_id,
            replacement_user_id=replacement_user_id,
            backup_shifttype_id=backup_shifttype_id,
            shift_date=shift.date,  # <--- HIER GESPEICHERT
            note=note,
            reason_type=reason_type,
            status='pending',
            created_at=datetime.utcnow()
        )

        db.session.add(new_request)
        db.session.commit()

        # --- AUTO-APPROVE FÜR TAUSCH ---
        if reason_type == 'trade':
            print(f"[ShiftChange] Auto-Approve für Tausch-Request {new_request.id}")
            return ShiftChangeService.approve_request(new_request.id, admin_user_id=None)

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
            return {"status": "success", "message": "Schicht existierte nicht mehr. Antrag wurde archiviert."}, 200

        target_date = original_shift.date
        target_variant = original_shift.variant_id
        giver_user_id = original_shift.user_id
        shift_type_id = req.backup_shifttype_id

        # Sicherheits-Update: Falls shift_date im Request fehlt (alte Daten), jetzt nachpflegen
        if not req.shift_date:
            req.shift_date = target_date

        socket_updates = []

        # --- 1. MARKTPLATZ BEREINIGEN & SICHERN ---
        try:
            market_offers = ShiftMarketOffer.query.filter_by(shift_id=original_shift.id).all()
            for offer in market_offers:
                # Snapshot für Historie
                shift_snapshot = {
                    "date": original_shift.date.isoformat(),
                    "abbr": original_shift.shift_type.abbreviation if original_shift.shift_type else "?",
                    "color": original_shift.shift_type.color if original_shift.shift_type else "#cccccc"
                }
                offer.archived_shift_data = json.dumps(shift_snapshot)
                offer.status = 'done'
                offer.shift_id = None  # Entkoppeln

                print(f"[ShiftChange] Markt-Angebot {offer.id} archiviert und entkoppelt.")

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
            original_shift.is_trade = False

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
            req.original_shift_id = None  # Entkoppeln
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

            is_trade_flag = (req.reason_type == 'trade')

            if existing_shift:
                existing_shift.shifttype_id = shift_type_id
                existing_shift.is_locked = True
                existing_shift.is_trade = is_trade_flag

                socket_updates.append({
                    'user_id': receiver_id,
                    'date': target_date.isoformat(),
                    'shifttype_id': shift_type_id,
                    'variant_id': target_variant,
                    'is_deleted': False,
                    'is_trade': is_trade_flag
                })
            else:
                new_shift = Shift(
                    user_id=receiver_id,
                    date=target_date,
                    shifttype_id=shift_type_id,
                    variant_id=target_variant,
                    is_locked=True,
                    is_trade=is_trade_flag
                )
                db.session.add(new_shift)
                db.session.flush()

                socket_updates.append({
                    'user_id': receiver_id,
                    'date': target_date.isoformat(),
                    'shifttype_id': shift_type_id,
                    'variant_id': target_variant,
                    'is_deleted': False,
                    'is_trade': is_trade_flag
                })

        # --- 4. ABSCHLUSS ---
        req.status = 'approved'
        req.processed_at = datetime.utcnow()
        req.processed_by_id = admin_user_id

        try:
            db.session.commit()
        except Exception as e:
            db.session.rollback()
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
                    'data': {
                        'new_total_hours': 0, 'violations': [], 'is_trade': update['is_trade']
                    }
                }
                socketio.emit('shift_update', payload)
        except Exception as e:
            print(f"[ShiftChange] Socket Error: {e}")

        return {"status": "success", "message": "Änderung erfolgreich durchgeführt.", "request": req.to_dict()}, 200

    @staticmethod
    def reject_request(request_id, admin_user_id):
        """
        Lehnt einen Antrag ab ODER wickelt ihn rück ab (Rollback).
        """
        req = ShiftChangeRequest.query.get(request_id)
        if not req:
            return {"error": "Antrag nicht gefunden"}, 404

        socket_updates = []

        # --- FALL A: ROLLBACK EINES GENEHMIGTEN TAUSCHES ---
        if req.status == 'approved' and req.reason_type == 'trade':
            print(f"[ShiftChange] Starte ROLLBACK für Request {req.id}...")

            if not req.replacement_user_id:
                return {"error": "Rollback nicht möglich: Kein Ersatz-User gespeichert."}, 500

            # --- DATUM ERMITTELN ---
            target_date = req.shift_date  # 1. Priorität: Das fest gespeicherte Datum

            # Fallback 1: Archivierte Angebotsdaten
            if not target_date:
                offer = ShiftMarketOffer.query.filter_by(
                    offering_user_id=req.requester_id,
                    accepted_by_id=req.replacement_user_id,
                    status='done'
                ).order_by(ShiftMarketOffer.id.desc()).first()

                if offer and offer.archived_shift_data:
                    try:
                        data = json.loads(offer.archived_shift_data)
                        if data.get('date'):
                            target_date = datetime.strptime(data.get('date'), "%Y-%m-%d").date()
                    except:
                        pass

            # Fallback 2: Suche beim Receiver
            if not target_date:
                receiver_shifts = Shift.query.filter_by(
                    user_id=req.replacement_user_id,
                    shifttype_id=req.backup_shifttype_id,
                    is_trade=True
                ).all()
                if len(receiver_shifts) == 1:
                    target_date = receiver_shifts[0].date

            if not target_date:
                return {"error": "Rollback fehlgeschlagen: Datum konnte nicht ermittelt werden."}, 400

            # --- DURCHFÜHRUNG ROLLBACK ---
            # 1. Receiver Schicht löschen
            target_shift = Shift.query.filter_by(user_id=req.replacement_user_id, date=target_date).first()
            if target_shift:
                db.session.delete(target_shift)
                socket_updates.append({
                    'user_id': req.replacement_user_id,
                    'date': target_date.isoformat(),
                    'shifttype_id': None, 'variant_id': None,
                    'is_deleted': True, 'is_trade': False
                })

            # 2. Giver Schicht wiederherstellen (FIXED: Auch wenn schon eine da ist)
            check_giver = Shift.query.filter_by(user_id=req.requester_id, date=target_date).first()

            if check_giver:
                # Update existing (vielleicht war es "Frei" oder Dummy)
                check_giver.shifttype_id = req.backup_shifttype_id
                check_giver.is_locked = False
                check_giver.is_trade = False
                # Socket für Update
                socket_updates.append({
                    'user_id': req.requester_id,
                    'date': target_date.isoformat(),
                    'shifttype_id': req.backup_shifttype_id, 'variant_id': None,
                    'is_deleted': False, 'is_trade': False
                })
            else:
                # Neu erstellen
                new_giver_shift = Shift(
                    user_id=req.requester_id,
                    date=target_date,
                    shifttype_id=req.backup_shifttype_id,
                    is_locked=False,
                    is_trade=False
                )
                db.session.add(new_giver_shift)
                socket_updates.append({
                    'user_id': req.requester_id,
                    'date': target_date.isoformat(),
                    'shifttype_id': req.backup_shifttype_id, 'variant_id': None,
                    'is_deleted': False, 'is_trade': False
                })

            req.status = 'rejected'

            # 4. Market Offer Status ändern
            offer = ShiftMarketOffer.query.filter_by(
                offering_user_id=req.requester_id,
                accepted_by_id=req.replacement_user_id,
                status='done'
            ).first()
            if offer:
                offer.status = 'rejected'
                offer.accepted_by_id = None

        # --- FALL B: NORMALES ABLEHNEN (noch pending) ---
        else:
            if req.original_shift_id and req.reason_type == 'trade':
                market_offer = ShiftMarketOffer.query.filter_by(shift_id=req.original_shift_id,
                                                                status='pending').first()
                if market_offer:
                    market_offer.status = 'active'
                    market_offer.accepted_by_id = None
                    market_offer.accepted_at = None
            req.status = 'rejected'

        req.processed_at = datetime.utcnow()
        req.processed_by_id = admin_user_id

        try:
            db.session.commit()
            for update in socket_updates:
                payload = {
                    'type': 'single',
                    'user_id': update['user_id'], 'date': update['date'],
                    'shifttype_id': update['shifttype_id'], 'variant_id': update['variant_id'],
                    'is_deleted': update['is_deleted'],
                    'data': {'new_total_hours': 0, 'violations': [], 'is_trade': update['is_trade']}
                }
                socketio.emit('shift_update', payload)
        except Exception as e:
            db.session.rollback()
            return {"error": f"DB Fehler: {str(e)}"}, 500

        return {"status": "success", "message": "Antrag abgelehnt (bzw. rückabgewickelt).",
                "request": req.to_dict()}, 200