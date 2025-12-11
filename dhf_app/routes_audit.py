from flask import Blueprint, jsonify, request
from .models_audit import AuditLog
from .utils import admin_required
from sqlalchemy import desc

audit_bp = Blueprint('audit', __name__, url_prefix='/api/audit')


@audit_bp.route('/', methods=['GET'])
@admin_required
def get_logs():
    try:
        # Parameter aus der URL lesen
        limit = request.args.get('limit', 100, type=int)
        action_filter = request.args.get('action')
        user_filter = request.args.get('user')

        # Basis-Query
        query = AuditLog.query

        # 1. Filter: Aktion (z.B. "LOGIN" oder "SHIFT_UPDATE")
        if action_filter:
            # ilike macht die Suche groß/kleinschreibung-unabhängig
            query = query.filter(AuditLog.action.ilike(f"%{action_filter}%"))

        # 2. Filter: Benutzername
        if user_filter:
            query = query.filter(AuditLog.user_name.ilike(f"%{user_filter}%"))

        # Sortierung: Neueste zuerst
        logs = query.order_by(desc(AuditLog.timestamp)).limit(limit).all()

        return jsonify([log.to_dict() for log in logs]), 200
    except Exception as e:
        return jsonify({"message": str(e)}), 500