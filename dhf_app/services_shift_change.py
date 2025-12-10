from .extensions import db
from .models_shift_change import ShiftChangeRequest
from .models import Shift, User, ShiftType
from datetime import datetime


class ShiftChangeService:

    @staticmethod
    def create_request(shift_id, requester_id, replacement_user_id=None, note=None):
        """
        Erstellt einen neuen Änderungsantrag.
        """
        # Validierung: Existiert die Schicht?
        shift = Shift.query.get(shift_id)
        if not shift:
            return {"error": "Schicht nicht gefunden"}, 404

        # Optional: Prüfen, ob bereits ein offener Antrag existiert
        existing = ShiftChangeRequest.query.filter_by(
            original_shift_id=shift_id,
            status='pending'
        ).first()

        if existing:
            return {"error": "Es gibt bereits einen offenen Antrag für diese Schicht."}, 400

        new_request = ShiftChangeRequest(
            original_shift_id=shift_id,
            requester_id=requester_id,
            replacement_user_id=replacement_user_id,
            note=note,
            status='pending'
        )

        db.session.add(new_request)
        db.session.commit()

        return new_request.to_dict(), 201

    @staticmethod
    def approve_request(request_id, admin_user_id):
        """
        Genehmigt den Antrag:
        1. Setzt ursprüngliche Schicht auf 'Krank' (oder entfernt sie).
        2. Trägt ggf. die Ersatzperson ein.
        3. Aktualisiert den Status des Antrags.
        """
        req = ShiftChangeRequest.query.get(request_id)
        if not req or req.status != 'pending':
            return {"error": "Antrag nicht gefunden oder bereits bearbeitet"}, 400

        # 1. Ursprüngliche Schicht bearbeiten -> Auf "Krank" setzen
        # Wir suchen den Schicht-Typ "Krank" (Annahme: Name 'Krank' oder Kürzel 'K')
        sick_type = ShiftType.query.filter((ShiftType.name == 'Krank') | (ShiftType.abbreviation == 'K')).first()

        if not sick_type:
            return {"error": "Schichtart 'Krank' nicht im System gefunden."}, 500

        original_shift = req.original_shift
        original_shift_type_id = original_shift.shifttype_id  # Merken für den Ersatz

        # Original User wird krank
        original_shift.shifttype_id = sick_type.id
        original_shift.is_locked = True  # Sicherstellen, dass es gesperrt bleibt/wird

        # 2. Ersatzperson eintragen (falls vorhanden)
        if req.replacement_user_id:
            # Prüfen, ob Ersatzperson schon eine Schicht hat
            existing_replacement_shift = Shift.query.filter_by(
                user_id=req.replacement_user_id,
                date=original_shift.date
            ).first()

            if existing_replacement_shift:
                # Update existierender Schicht
                existing_replacement_shift.shifttype_id = original_shift_type_id
                existing_replacement_shift.is_locked = True
            else:
                # Neue Schicht erstellen
                new_shift = Shift(
                    user_id=req.replacement_user_id,
                    date=original_shift.date,
                    shifttype_id=original_shift_type_id,
                    is_locked=True
                )
                db.session.add(new_shift)

        # 3. Request Status updaten
        req.status = 'approved'
        req.processed_at = datetime.utcnow()
        req.processed_by_id = admin_user_id

        db.session.commit()

        return {"message": "Änderung erfolgreich durchgeführt.", "request": req.to_dict()}, 200

    @staticmethod
    def reject_request(request_id, admin_user_id):
        req = ShiftChangeRequest.query.get(request_id)
        if not req:
            return {"error": "Antrag nicht gefunden"}, 404

        req.status = 'rejected'
        req.processed_at = datetime.utcnow()
        req.processed_by_id = admin_user_id

        db.session.commit()
        return {"message": "Antrag abgelehnt.", "request": req.to_dict()}, 200