from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user
from dhf_app.services_shift_change import ShiftChangeService
from dhf_app.models_shift_change import ShiftChangeRequest

# Blueprint definieren
shift_change_bp = Blueprint('shift_change_bp', __name__)


# --- 1. Neuen Antrag erstellen (Krank oder Tausch) ---
@shift_change_bp.route('/request', methods=['POST'])
@login_required
def create_shift_change_request():
    try:
        data = request.get_json()
        shift_id = data.get('shift_id')
        replacement_user_id = data.get('replacement_user_id')
        note = data.get('note')

        # WICHTIG: Fallback auf 'sickness', damit alte Krankmeldungen weiterhin funktionieren.
        # Der Marktplatz sendet hier explizit 'trade'.
        reason_type = data.get('reason_type', 'sickness')

        if not shift_id:
            return jsonify({"error": "Schicht-ID fehlt"}), 400

        # Wir rufen den Service auf. Dieser erstellt den Antrag.
        # HINWEIS: Bei 'trade' führt der Service einen AUTO-APPROVE durch und liefert direkt 200 zurück.
        result, status_code = ShiftChangeService.create_request(
            shift_id=shift_id,
            requester_id=current_user.id,
            replacement_user_id=replacement_user_id,
            note=note,
            reason_type=reason_type
        )

        # --- NEU: Auto-Approve für Planschreiber und Admins (nur für manuelle Krankmeldungen relevant) ---
        # Wenn der Service 201 zurückgibt (noch pending) UND es ein Admin ist, genehmigen wir sofort.
        if status_code == 201:
            user_role = current_user.role.name if current_user.role else ""

            if user_role in ['admin', 'Planschreiber']:
                # ID des neuen Antrags aus der Antwort holen
                req_data = result.get('request', {})
                new_req_id = req_data.get('id')

                if new_req_id:
                    # Sofort genehmigen (Self-Approval)
                    approve_res, approve_code = ShiftChangeService.approve_request(new_req_id, current_user.id)

                    # Wenn erfolgreich, geben wir direkt das Approval-Ergebnis zurück,
                    # damit das Frontend sofort Bescheid weiß (und Sockets feuern).
                    if approve_code == 200:
                        return jsonify(approve_res), 200

        # Falls keine Auto-Genehmigung (normaler User) oder Fehler dabei, geben wir das normale Ergebnis zurück
        return jsonify(result), status_code

    except Exception as e:
        return jsonify({"error": f"Serverfehler: {str(e)}"}), 500


# --- 2. Liste aller offenen Anträge laden ---
@shift_change_bp.route('/list', methods=['GET'])
@login_required
def get_pending_requests():
    # Zeigt alle offenen UND genehmigten Anträge für Admin/Planschreiber
    # Damit können auch bereits genehmigte Tausche rückgängig gemacht werden.
    requests = ShiftChangeRequest.query.filter(
        ShiftChangeRequest.status.in_(['pending', 'approved'])
    ).order_by(ShiftChangeRequest.created_at.desc()).limit(100).all()

    results = []
    for req in requests:
        try:
            # to_dict() ruft Daten von verknüpften Objekten ab.
            # Falls ein User oder eine Schicht gelöscht wurde, fangen wir Fehler ab.
            results.append(req.to_dict())
        except Exception:
            continue

    return jsonify(results), 200


# --- 3. Antrag GENEHMIGEN (Hier passiert die Magie) ---
@shift_change_bp.route('/<int:request_id>/approve', methods=['POST'])
@login_required
def approve_request(request_id):
    # Nur Admins oder Planschreiber
    if current_user.role.name not in ['admin', 'Planschreiber']:
        return jsonify({"error": "Keine Berechtigung"}), 403

    # Der Service führt die Logik aus (Krank->K, Tausch->Löschen) und sendet Sockets
    result, status_code = ShiftChangeService.approve_request(request_id, current_user.id)
    return jsonify(result), status_code


# --- 4. Antrag ABLEHNEN / RÜCKGÄNGIG MACHEN ---
@shift_change_bp.route('/<int:request_id>/reject', methods=['POST'])
@login_required
def reject_request(request_id):
    if current_user.role.name not in ['admin', 'Planschreiber']:
        return jsonify({"error": "Keine Berechtigung"}), 403

    # Der Service prüft nun, ob es 'pending' (Ablehnen) oder 'approved' (Rollback) ist
    result, status_code = ShiftChangeService.reject_request(request_id, current_user.id)
    return jsonify(result), status_code