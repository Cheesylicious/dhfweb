# dhf_app/utils.py

from functools import wraps
from flask import jsonify
from flask_login import current_user, login_required


def admin_required(fn):
    """
    Decorator, der sicherstellt, dass nur angemeldete Benutzer mit der Rolle 'admin'
    auf die Funktion zugreifen können.
    (Regel 4: Ausgelagert, um zirkuläre Abhängigkeiten zu vermeiden)
    """
    @wraps(fn)
    @login_required
    def decorator(*args, **kwargs):
        if not current_user.role or current_user.role.name != 'admin':
            return jsonify({"message": "Admin-Rechte erforderlich"}), 403
        return fn(*args, **kwargs)

    return decorator


# --- NEUE FUNKTION ---
def scheduler_or_admin_required(fn):
    """
    Decorator: Lässt nur Admins oder Benutzer mit der Rolle 'Planschreiber' zu.
    (Prüft anhand des Namens, die Rolle muss in der DB existieren)
    """
    @wraps(fn)
    @login_required
    def decorator(*args, **kwargs):
        if not current_user.role or current_user.role.name not in ['admin', 'Planschreiber']:
            return jsonify({"message": "Admin- oder Planschreiber-Rechte erforderlich"}), 403
        return fn(*args, **kwargs)

    return decorator
# --- ENDE NEUE FUNKTION ---