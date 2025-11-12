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