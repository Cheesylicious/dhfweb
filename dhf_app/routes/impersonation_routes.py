# dhf_app/routes/impersonation_routes.py

from flask import Blueprint, jsonify, session, request, make_response
from flask_login import login_user, current_user
from ..models import User
from ..extensions import db
from ..utils import login_required
from ..models_audit import log_audit
import traceback

impersonation_bp = Blueprint('impersonation', __name__, url_prefix='/api/impersonate')


def add_cors_headers(response):
    """
    Hilfsfunktion, um CORS-Header manuell hinzuzufügen,
    falls Flask-CORS bei einem 500er Fehler versagt.
    Orientiert sich an deiner utils.py.
    """
    origin = request.headers.get('Origin', '*')
    response.headers.add("Access-Control-Allow-Origin", origin)
    response.headers.add("Access-Control-Allow-Credentials", "true")
    response.headers.add("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
    response.headers.add("Access-Control-Allow-Headers", "Content-Type,Authorization")
    return response


@impersonation_bp.route('/start/<int:user_id>', methods=['POST', 'OPTIONS'])
@login_required
def start_impersonation(user_id):
    """
    Ermöglicht es einem Admin, die Identität eines anderen Benutzers anzunehmen.
    """
    try:
        # 1. Sicherheitscheck: Nur Admins dürfen das
        if not current_user.role or current_user.role.name != 'admin':
            resp = make_response(jsonify({"message": "Nicht autorisiert."}), 403)
            return add_cors_headers(resp)

        # 2. Zielbenutzer finden
        target_user = db.session.get(User, user_id)
        if not target_user:
            resp = make_response(jsonify({"message": "Benutzer nicht gefunden."}), 404)
            return add_cors_headers(resp)

        if target_user.id == current_user.id:
            resp = make_response(jsonify({"message": "Selbst-Wechsel nicht möglich."}), 400)
            return add_cors_headers(resp)

        # 3. Admin-Daten sichern BEVOR wir die Identität wechseln
        # Wir holen eine frische Instanz aus der DB, um Proxy-Fehler zu vermeiden
        admin_id = current_user.id
        admin_user_obj = db.session.get(User, admin_id)

        # 4. Audit-Log schreiben (WICHTIG: Vor dem Wechsel, mit dem echten Admin-Objekt)
        log_audit(
            action="IMPERSONATION_START",
            details={"target_user": f"{target_user.vorname} {target_user.name}"},
            user=admin_user_obj
        )

        # 5. Identitätswechsel vollziehen
        login_user(target_user)

        # Echte Admin-ID in der Session speichern
        session['impersonator_id'] = admin_id
        session.modified = True

        resp = make_response(jsonify({
            "message": f"Identität gewechselt zu {target_user.vorname} {target_user.name}.",
            "user": target_user.to_dict()
        }), 200)
        return add_cors_headers(resp)

    except Exception as e:
        # Fehlersuche: Wir geben den Fehler im Server-Log aus
        print(f"KRITISCHER FEHLER in start_impersonation: {str(e)}")
        traceback.print_exc()
        resp = make_response(jsonify({"message": f"Serverfehler: {str(e)}"}), 500)
        return add_cors_headers(resp)


@impersonation_bp.route('/stop', methods=['POST', 'OPTIONS'])
@login_required
def stop_impersonation():
    """
    Beendet die Impersonation und kehrt zum Admin-Account zurück.
    """
    try:
        admin_id = session.get('impersonator_id')
        if not admin_id:
            resp = make_response(jsonify({"message": "Keine aktive Impersonation."}), 400)
            return add_cors_headers(resp)

        admin_user = db.session.get(User, admin_id)
        if not admin_user:
            session.pop('impersonator_id', None)
            resp = make_response(jsonify({"message": "Admin-Account nicht gefunden."}), 404)
            return add_cors_headers(resp)

        # Zurückwechseln
        login_user(admin_user)
        session.pop('impersonator_id', None)
        session.modified = True

        # Audit-Log schreiben
        log_audit(action="IMPERSONATION_STOP", user=admin_user)

        resp = make_response(jsonify({
            "message": "Zurück zum Admin-Konto.",
            "user": admin_user.to_dict()
        }), 200)
        return add_cors_headers(resp)

    except Exception as e:
        print(f"KRITISCHER FEHLER in stop_impersonation: {str(e)}")
        traceback.print_exc()
        resp = make_response(jsonify({"message": f"Serverfehler: {str(e)}"}), 500)
        return add_cors_headers(resp)