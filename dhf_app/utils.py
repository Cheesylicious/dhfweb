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


# --- START: NEUER DECORATOR FÜR ANFRAGEN (Regel 4) ---
def query_roles_required(fn):
    """
    Decorator: Lässt Admins, Planschreiber UND Hundeführer zu.
    Dies ist der allgemeine Zugriff-Check für das Anfrage-Modul.
    Die spezifische Filterung (z.B. "nur eigene Anfragen")
    muss in der Route selbst erfolgen.
    """
    @wraps(fn)
    @login_required
    def decorator(*args, **kwargs):
        if not current_user.role or current_user.role.name not in ['admin', 'Planschreiber', 'Hundeführer']:
            return jsonify({"message": "Zugriff auf diese Funktion nicht gestattet."}), 403
        return fn(*args, **kwargs)

    return decorator
# --- ENDE: NEUER DECORATOR ---


# --- NEU: DECORATOR FÜR STATISTIK (Admin ODER Explizite Freigabe) ---
def stats_permission_required(fn):
    """
    Decorator: Zugriff, wenn Admin ODER wenn das Feld 'can_see_statistics' True ist.
    """
    @wraps(fn)
    @login_required
    def decorator(*args, **kwargs):
        is_admin = (current_user.role and current_user.role.name == 'admin')
        if not is_admin and not current_user.can_see_statistics:
            return jsonify({"message": "Zugriff auf Statistiken verweigert."}), 403
        return fn(*args, **kwargs)

    return decorator
# --- ENDE NEU ---