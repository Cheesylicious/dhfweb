from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user
from .services_shift_change import ShiftChangeService
from .models_shift_change import ShiftChangeRequest

shift_change_bp = Blueprint('shift_change', __name__)


@shift_change_bp.route('/api/shift-change/request', methods=['POST'])
@login_required
def create_shift_change_request():
    # Berechtigung: Nur Planschreiber oder Admin
    # Wir prüfen hier sicherheitshalber auf den Rollennamen
    if not (current_user.role.name in ['Admin', 'Planschreiber']):
        return jsonify({"error": "Keine Berechtigung"}), 403

    data = request.json
    shift_id = data.get('shift_id')
    replacement_user_id = data.get('replacement_user_id')  # Kann None sein
    note = data.get('note')

    if not shift_id:
        return jsonify({"error": "Shift ID fehlt"}), 400

    result, status_code = ShiftChangeService.create_request(
        shift_id=shift_id,
        requester_id=current_user.id,
        replacement_user_id=replacement_user_id,
        note=note
    )
    return jsonify(result), status_code


@shift_change_bp.route('/api/shift-change/pending', methods=['GET'])
@login_required
def get_pending_requests():
    # Zeigt alle offenen Anfragen
    requests = ShiftChangeRequest.query.filter_by(status='pending').order_by(ShiftChangeRequest.created_at.desc()).all()
    return jsonify([r.to_dict() for r in requests]), 200


@shift_change_bp.route('/api/shift-change/<int:request_id>/approve', methods=['POST'])
@login_required
def approve_request(request_id):
    if current_user.role.name != 'Admin':
        return jsonify({"error": "Nur Admins dürfen genehmigen"}), 403

    result, status_code = ShiftChangeService.approve_request(request_id, current_user.id)
    return jsonify(result), status_code


@shift_change_bp.route('/api/shift-change/<int:request_id>/reject', methods=['POST'])
@login_required
def reject_request(request_id):
    if current_user.role.name != 'Admin':
        return jsonify({"error": "Nur Admins dürfen ablehnen"}), 403

    result, status_code = ShiftChangeService.reject_request(request_id, current_user.id)
    return jsonify(result), status_code