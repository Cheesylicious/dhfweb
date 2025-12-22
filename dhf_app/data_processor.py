import datetime

# Mapping für deutsche Wochentage (schneller als locale-Setzung, da kein Systemaufruf nötig)
GERMAN_WEEKDAYS = {
    0: 'Mo', 1: 'Di', 2: 'Mi', 3: 'Do', 4: 'Fr', 5: 'Sa', 6: 'So'
}


def filter_active_employees(employees_list):
    """
    Filtert die Mitarbeiterliste und entfernt inaktive Einträge.
    Dies verhindert unnötige Iterationen in der Darstellungsschicht.
    """
    # Innovative List Comprehension für maximale Geschwindigkeit
    active_employees = [
        emp for emp in employees_list
        if emp.get('is_active', True)  # Fallback auf True, falls Key fehlt, um Fehler zu vermeiden
    ]

    if not active_employees:
        print("WARNUNG: Keine aktiven Mitarbeiter gefunden.")

    return active_employees


def format_date_with_weekday(date_obj):
    """
    Formatiert ein Datumsobjekt zu 'Mo, 05.12.'
    """
    if isinstance(date_obj, str):
        # Falls String übergeben wird, versuchen zu parsen (Sicherheitsnetz)
        try:
            date_obj = datetime.datetime.strptime(date_obj, "%Y-%m-%d")
        except ValueError:
            return date_obj  # Rückgabe des Originals bei Fehler

    weekday = GERMAN_WEEKDAYS[date_obj.weekday()]
    date_str = date_obj.strftime("%d.%m.")

    return f"{weekday}, {date_str}"


def process_roster_data(employees, shift_data):
    """
    Verbindet Mitarbeiter und Schichten und bereitet die Daten für den Export vor.
    """
    active_staff = filter_active_employees(employees)
    processed_data = []

    for staff in active_staff:
        staff_shifts = shift_data.get(staff['id'], [])

        # Hier könnten weitere Optimierungen stattfinden, z.B. Leere Zeilen filtern
        row = {
            'name': staff['name'],
            'shifts': []
        }

        for shift in staff_shifts:
            formatted_date = format_date_with_weekday(shift['date'])
            row['shifts'].append({
                'formatted_date': formatted_date,
                'time': shift['time'],
                'location': shift.get('location', '')
            })

        processed_data.append(row)

    return processed_data