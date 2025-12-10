import traceback
from flask import Blueprint, request, jsonify, current_app
from datetime import datetime
from flask_login import current_user

# Absolute Importe
from dhf_app.extensions import db
from dhf_app.models_shift_change import ShiftChangeRequest
from dhf_app.models import Shift, User, ShiftType

shift_change_bp = Blueprint('shift_change_bp', __name__)


# --- 1. Neuen Antrag erstellen & SOFORT AUSFÜHREN ---
@shift_change_bp.route('/request', methods=['POST'])
def handle_shift_change_request():
    try:
        data = request.get_json()
        if not data: return jsonify({'message': 'Keine Daten empfangen'}), 400

        shift_id = data.get('shift_id')
        replacement_user_id = data.get('replacement_user_id')
        note = data.get('note')

        if not shift_id: return jsonify({'message': 'Schicht-ID fehlt'}), 400

        req_user_id = current_user.id if hasattr(current_user,
                                                 'is_authenticated') and current_user.is_authenticated else None

        # 1. Schicht laden
        shift = db.session.get(Shift, shift_id)
        if not shift:
            return jsonify({'message': f'Schicht {shift_id} nicht gefunden'}), 404

        existing = ShiftChangeRequest.query.filter_by(original_shift_id=shift_id, status='pending').first()
        if existing:
            return jsonify(
                {'message': 'Für diese Schicht existiert bereits eine offene Meldung.', 'status': 'info'}), 200

        # 2. Schichtart "K" suchen
        k_type = ShiftType.query.filter_by(abbreviation='K').first()
        if not k_type:
            return jsonify({'message': 'Fehler: Schichtart "K" existiert nicht im System.'}), 500

        # 3. Backup erstellen (was war es vorher?)
        backup_shifttype_id = shift.shifttype_id

        # 4. Request anlegen
        new_request = ShiftChangeRequest(
            original_shift_id=shift_id,
            requester_id=req_user_id,
            replacement_user_id=int(replacement_user_id) if replacement_user_id else None,
            backup_shifttype_id=backup_shifttype_id,  # Backup speichern
            note=note,
            status='pending',  # Bleibt pending, damit Admin es sieht und prüfen kann
            created_at=datetime.utcnow()
        )
        db.session.add(new_request)

        # 5. SOFORTIGE AUSFÜHRUNG (Die Logik von früher 'Approve')

        # Original-Schicht auf "K" setzen (User bleibt gleich!)
        shift.shifttype_id = k_type.id

        # Falls Ersatz gewählt wurde: Neue Schicht erstellen
        if replacement_user_id:
            replacement_user = db.session.get(User, replacement_user_id)
            if replacement_user:
                new_shift = Shift(
                    user_id=replacement_user.id,
                    date=shift.date,
                    shifttype_id=backup_shifttype_id,  # Ersatz bekommt die alte Schichtart (z.B. Früh)
                    variant_id=shift.variant_id,
                    is_locked=shift.is_locked
                )
                db.session.add(new_shift)

        db.session.commit()

        return jsonify({'message': 'Krankmeldung eingetragen und Plan sofort aktualisiert.', 'status': 'success'}), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler Shift-Request: {e}")
        return jsonify({'message': f"Serverfehler: {str(e)}"}), 500


# --- 2. Liste laden ---
@shift_change_bp.route('/list', methods=['GET'])
def list_shift_change_requests():
    try:
        requests = ShiftChangeRequest.query.filter_by(status='pending').order_by(
            ShiftChangeRequest.created_at.desc()).all()
        data = []
        for req in requests:
            try:
                data.append(req.to_dict())
            except Exception as e:
                continue
        return jsonify(data), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500


# --- 3. Antrag BESTÄTIGEN (Nur abhaken) ---
@shift_change_bp.route('/<int:request_id>/approve', methods=['POST'])
def approve_shift_change_request(request_id):
    """
    Der Admin bestätigt, dass die Änderung korrekt war.
    Die Änderung ist ja schon passiert, also setzen wir nur den Status auf 'approved'.
    """
    try:
        req = db.session.get(ShiftChangeRequest, request_id)
        if not req or req.status != 'pending':
            return jsonify({'message': 'Antrag nicht gefunden oder schon bearbeitet.'}), 404

        req.status = 'approved'
        req.processed_at = datetime.utcnow()
        if hasattr(current_user, 'id'):
            req.processed_by_id = current_user.id

        db.session.commit()
        return jsonify({'message': 'Änderung bestätigt und archiviert.', 'status': 'success'}), 200

    except Exception as e:
        db.session.rollback()
        return jsonify({'message': f"Serverfehler: {str(e)}"}), 500


# --- 4. RÜCKGÄNGIG MACHEN (Revert) ---
@shift_change_bp.route('/<int:request_id>/reject', methods=['POST'])
def reject_shift_change_request(request_id):
    """
    Der Admin macht die Änderung RÜCKGÄNGIG.
    """
    try:
        req = db.session.get(ShiftChangeRequest, request_id)
        if not req or req.status != 'pending':
            return jsonify({'message': 'Antrag nicht gefunden oder schon bearbeitet.'}), 404

        original_shift = db.session.get(Shift, req.original_shift_id)
        if not original_shift:
            # Wenn Schicht weg ist, können wir nur den Antrag schließen
            req.status = 'rejected'
            db.session.commit()
            return jsonify({'message': 'Originalschicht existiert nicht mehr. Antrag geschlossen.'}), 200

        # --- REVERT LOGIC ---

        # 1. Original-Schicht wiederherstellen (von "K" zurück zum Backup)
        if req.backup_shifttype_id:
            original_shift.shifttype_id = req.backup_shifttype_id
        else:
            # Fallback, falls kein Backup da ist (sollte nicht passieren)
            return jsonify({'message': 'Fehler: Kein Backup-Status vorhanden.'}), 500

        # 2. Falls Ersatz erstellt wurde -> Löschen
        if req.replacement_user_id:
            # Wir suchen die Schicht des Ersatzmannes am gleichen Tag
            replacement_shift = Shift.query.filter_by(
                user_id=req.replacement_user_id,
                date=original_shift.date,
                variant_id=original_shift.variant_id
            ).first()

            if replacement_shift:
                db.session.delete(replacement_shift)

        # 3. Request Status auf rejected setzen
        req.status = 'rejected'
        req.note = (req.note or "") + " [Vom Admin rückgängig gemacht]"
        req.processed_at = datetime.utcnow()
        if hasattr(current_user, 'id'):
            req.processed_by_id = current_user.id

        db.session.commit()
        return jsonify({'message': 'Änderung wurde erfolgreich rückgängig gemacht.', 'status': 'success'}), 200

    except Exception as e:
        db.session.rollback()
        return jsonify({'message': f"Fehler beim Rückgängigmachen: {str(e)}"}), 500