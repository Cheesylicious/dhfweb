from functools import wraps
# DIESE IMPORTS SIND FÜR DEN CORS-FIX KRITISCH
from flask import jsonify, request, make_response
from flask_login import current_user


# HINWEIS: Wir verwenden NICHT flask_login.login_required, sondern definieren es selbst neu.


# --- HELPER: CORS Preflight Handling ---
def _handle_options():
    """
    Stellt sicher, dass OPTIONS-Requests (CORS Preflight) mit 200 OK beantwortet werden.
    """
    if request.method == 'OPTIONS':
        response = make_response()
        # Dies sind die minimal benötigten Headers, um den Preflight-Check zu bestehen
        response.headers.add("Access-Control-Allow-Origin", request.headers.get('Origin', '*'))
        response.headers.add("Access-Control-Allow-Headers", "Content-Type,Authorization")
        response.headers.add("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
        response.headers.add("Access-Control-Allow-Credentials", "true")
        return response
    return None


# --- Custom Login Required (CORS FIX) ---
def login_required(fn):
    """
    Ersetzt flask_login.login_required, um:
    1. OPTIONS-Requests (CORS) immer durchzulassen.
    2. JSON-Antworten (401) mit notwendigen CORS-Headern zu senden.
    """

    @wraps(fn)
    def decorator(*args, **kwargs):
        # 1. CORS Check (MUSS VOR dem Auth Check erfolgen)
        opt_resp = _handle_options()
        if opt_resp:
            return opt_resp

        # 2. Auth Check
        if not current_user.is_authenticated:
            # KRITISCHE KORREKTUR: Wir erstellen die 401-Antwort und fügen die Header manuell hinzu.
            # Dadurch wird der Preflight-Check nicht blockiert, auch wenn ein 401 zurückkommt.

            # 1. Erstelle die JSON-Antwort
            response = jsonify({"message": "Nicht authentifiziert"}), 401

            # 2. Konvertiere in ein echtes Response-Objekt, um Header zu manipulieren
            resp = make_response(response)

            # 3. Füge CORS-Header hinzu (Failsafe)
            resp.headers.add("Access-Control-Allow-Origin", request.headers.get('Origin', '*'))
            resp.headers.add("Access-Control-Allow-Credentials", "true")
            # ACHTUNG: Der Header Access-Control-Allow-Methods/Headers MUSS HIER NICHT ERGÄNZT WERDEN,
            # da der Preflight-Check bereits im _handle_options() die Method-Header geholt hat.

            return resp

        return fn(*args, **kwargs)

    return decorator


# --- ROLLEN-BASIERTE DECORATORS (nutzen den gefixten login_required) ---
# (Unverändert, da sie alle den korrigierten login_required nutzen)

def admin_required(fn):
    @wraps(fn)
    @login_required
    def decorator(*args, **kwargs):
        if not current_user.role or current_user.role.name != 'admin':
            return jsonify({"message": "Admin-Rechte erforderlich"}), 403
        return fn(*args, **kwargs)

    return decorator


def scheduler_or_admin_required(fn):
    @wraps(fn)
    @login_required
    def decorator(*args, **kwargs):
        if not current_user.role or current_user.role.name not in ['admin', 'Planschreiber']:
            return jsonify({"message": "Admin- oder Planschreiber-Rechte erforderlich"}), 403
        return fn(*args, **kwargs)

    return decorator


def query_roles_required(fn):
    @wraps(fn)
    @login_required
    def decorator(*args, **kwargs):
        allowed_roles = ['admin', 'Planschreiber', 'Hundeführer']
        user_role = current_user.role.name if current_user.role else ''

        if user_role not in allowed_roles:
            return jsonify({"message": "Zugriff auf diese Funktion nicht gestattet."}), 403
        return fn(*args, **kwargs)

    return decorator


def stats_permission_required(fn):
    @wraps(fn)
    @login_required
    def decorator(*args, **kwargs):
        is_admin = (current_user.role and current_user.role.name == 'admin')
        can_see = getattr(current_user, 'can_see_statistics', False)

        if not is_admin and not can_see:
            return jsonify({"message": "Zugriff auf Statistiken verweigert."}), 403
        return fn(*args, **kwargs)

    return decorator