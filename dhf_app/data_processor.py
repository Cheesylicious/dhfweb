import logging
from datetime import datetime, date

# Logging konfigurieren
logger = logging.getLogger(__name__)


def process_roster_data(employees, shifts_data):
    """
    Verarbeitet Mitarbeiter- und Schichtdaten für den Render-Prozess.
    Wandelt eine flache Liste von Schichten effizient in eine gruppierte Struktur um.

    Args:
        employees (list): Liste der Mitarbeiter-Objekte oder Dictionaries.
        shifts_data (list or dict): Rohdaten der Schichten.

    Returns:
        list: Strukturierte Daten für den Renderer.
    """
    try:
        # 1. Performance-Optimierung: Schichtdaten in Dictionary umwandeln
        # Wir gruppieren Schichten nach employee_id, um O(1) Zugriffe zu ermöglichen
        shifts_by_employee = {}

        if isinstance(shifts_data, list):
            # Wenn es eine Liste ist (z.B. SQLAlchemy Result), gruppieren wir manuell
            for shift in shifts_data:
                # Robustheit: Zugriff auf employee_id sowohl für Dicts als auch Objekte
                e_id = None
                if isinstance(shift, dict):
                    e_id = shift.get('employee_id')
                elif hasattr(shift, 'employee_id'):
                    e_id = shift.employee_id

                if e_id is not None:
                    if e_id not in shifts_by_employee:
                        shifts_by_employee[e_id] = []
                    shifts_by_employee[e_id].append(shift)

        elif isinstance(shifts_data, dict):
            # Wenn es bereits ein Dictionary ist, übernehmen wir es
            shifts_by_employee = shifts_data
        else:
            logger.warning(f"[DataProcessor] Unerwartetes Format für shifts_data: {type(shifts_data)}")
            shifts_by_employee = {}

        formatted_result = []

        # 2. Daten zusammenführen
        for staff in employees:
            # ID des Mitarbeiters extrahieren (robust für Dict oder Objekt)
            staff_id = staff.get('id') if isinstance(staff, dict) else getattr(staff, 'id', None)

            if staff_id is None:
                continue

            # Hier trat der Fehler auf: Jetzt greifen wir auf das vorbereitete Dictionary zu
            staff_shifts = shifts_by_employee.get(staff_id, [])

            # Schichten sortieren (optional, aber gut für die Darstellung)
            # Wir nehmen an, dass Schichten ein 'date' oder 'start' Attribut haben
            try:
                staff_shifts.sort(key=lambda s: s.get('date') if isinstance(s, dict) else getattr(s, 'date', getattr(s,
                                                                                                                     'start_time',
                                                                                                                     '')))
            except Exception:
                pass  # Sortierung überspringen, falls Daten unvollständig

            # Eintrag erstellen
            formatted_result.append({
                'employee': staff,
                'shifts': staff_shifts,
                'shift_count': len(staff_shifts)
            })

        logger.info(f"[DataProcessor] {len(formatted_result)} Mitarbeiter mit Schichten verarbeitet.")
        return formatted_result

    except Exception as e:
        logger.error(f"[DataProcessor] Kritischer Fehler bei der Datenverarbeitung: {str(e)}", exc_info=True)
        # Im Fehlerfall leere Liste zurückgeben, damit der Server nicht crasht
        return []


def format_date_german(date_obj):
    """Hilfsfunktion: Formatiert Datum in deutsches Format."""
    if not date_obj:
        return ""
    if isinstance(date_obj, str):
        try:
            date_obj = datetime.strptime(date_obj, '%Y-%m-%d').date()
        except ValueError:
            return date_obj
    return date_obj.strftime('%d.%m.%Y')