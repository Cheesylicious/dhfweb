import logging
from datetime import datetime, date

# Logging konfigurieren
logger = logging.getLogger(__name__)


def generate_roster_html(formatted_data, month=None, year=None):
    """
    Erstellt das HTML für das Schichtplan-Bild als Matrix (Raster-Ansicht).
    Zeilen: Mitarbeiter
    Spalten: Tage des Monats

    Args:
        formatted_data (list): Liste von Dictionaries mit 'employee', 'shifts'.
        month (int/str): Monat für den Titel.
        year (int/str): Jahr für den Titel.

    Returns:
        str: Vollständiger HTML-String.
    """
    try:
        # 1. Alle vorkommenden Datumswerte sammeln, um die Spalten zu bauen
        all_dates = set()
        for entry in formatted_data:
            for shift in entry.get('shifts', []):
                # Robustes Auslesen des Datums (Dict oder Objekt)
                d = shift.get('date') if isinstance(shift, dict) else getattr(shift, 'date', None)
                if d:
                    # Falls String, in Date-Objekt wandeln
                    if isinstance(d, str):
                        try:
                            d = datetime.strptime(d, '%Y-%m-%d').date()
                        except ValueError:
                            continue
                    all_dates.add(d)

        if not all_dates:
            return "<html><body style='font-family: Arial;'><h3>Keine Schichtdaten für diesen Zeitraum vorhanden.</h3></body></html>"

        # Sortieren für die Spaltenreihenfolge
        sorted_dates = sorted(list(all_dates))

        # Titel generieren (Deutsch)
        german_months = [
            "Unbekannt", "Januar", "Februar", "März", "April", "Mai", "Juni",
            "Juli", "August", "September", "Oktober", "November", "Dezember"
        ]

        if month and year:
            try:
                m_idx = int(month)
                month_name = german_months[m_idx] if 1 <= m_idx <= 12 else str(month)
                title_str = f"{month_name} {year}"
            except:
                title_str = f"{month}/{year}"
        else:
            # Fallback: Monat aus dem ersten Datum extrahieren
            # %B gibt den englischen Namen, wir wollen es sauber
            first_date = sorted_dates[0]
            month_name = german_months[first_date.month]
            title_str = f"{month_name} {first_date.year}"

        # 2. HTML und CSS aufbauen (Matrix-Design)
        # Optimiertes CSS für wkhtmltoimage Rendering
        css_styles = """
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #fff; padding: 20px; }
            h2 { text-align: center; color: #333; margin-bottom: 20px; font-size: 24px; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; table-layout: fixed; }
            th, td { border: 1px solid #ccc; padding: 4px; text-align: center; vertical-align: middle; white-space: nowrap; overflow: hidden; }

            /* Kopfzeile */
            th { background-color: #f2f2f2; color: #333; font-weight: bold; height: 40px; }

            /* Mitarbeiter-Spalte fixiert links */
            .col-name { width: 160px; text-align: left; padding-left: 10px; background-color: #e8f0fe; font-weight: bold; font-size: 13px; }

            /* Wochenenden hervorheben */
            .weekend { background-color: #ffe6e6; }

            /* Schicht-Zellen */
            .shift-cell { font-weight: bold; color: #000; }
            .shift-time { font-size: 9px; color: #555; display: block; margin-top: 2px; }
            .shift-type { font-size: 12px; font-weight: bold; display: block; }

            /* Kürzel Farben (Optional, Beispiel) */
            .type-T { color: #2e7d32; } /* Tag */
            .type-N { color: #1565c0; } /* Nacht */
        </style>
        """

        html_parts = [
            "<!DOCTYPE html>",
            "<html><head><meta charset='UTF-8'>",
            css_styles,
            "</head><body>",
            f"<h2>Dienstplan Übersicht: {title_str}</h2>",
            "<table>",
            "<thead>",
            "<tr>",
            "<th class='col-name'>Mitarbeiter</th>"
        ]

        # Spaltenköpfe (Tage)
        for d in sorted_dates:
            # Wochentag kurz (Mo, Di...) und Tag (01, 02...)
            # Wir nutzen eine Hilfsliste für deutsche Wochentage, da locale oft nicht installiert ist
            de_days = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
            day_name = de_days[d.weekday()]
            day_num = d.strftime('%d')

            # Wochenende markieren (Samstag=5, Sonntag=6)
            css_class = "weekend" if d.weekday() >= 5 else ""
            html_parts.append(f"<th class='{css_class}'>{day_num}<br>{day_name}</th>")

        html_parts.append("</tr></thead><tbody>")

        # 3. Zeilen pro Mitarbeiter generieren
        for entry in formatted_data:
            staff = entry.get('employee')
            shifts = entry.get('shifts', [])

            # Name ermitteln
            staff_name = "Unbekannt"
            if staff:
                if isinstance(staff, dict):
                    staff_name = staff.get('name') or staff.get('username') or "MA"
                else:
                    staff_name = getattr(staff, 'name', getattr(staff, 'username', 'MA'))

            # Schichten dieses Mitarbeiters in ein Dictionary mappen für schnellen Zugriff: Datum -> Schicht
            staff_shift_map = {}
            for s in shifts:
                sd = s.get('date') if isinstance(s, dict) else getattr(s, 'date', None)
                if isinstance(sd, str):
                    try:
                        sd = datetime.strptime(sd, '%Y-%m-%d').date()
                    except:
                        continue
                if sd:
                    staff_shift_map[sd] = s

            # Zeile starten
            html_parts.append("<tr>")
            html_parts.append(f"<td class='col-name'>{staff_name}</td>")

            # Zellen für jeden Tag
            for d in sorted_dates:
                css_class = "weekend" if d.weekday() >= 5 else ""
                content = ""

                shift = staff_shift_map.get(d)
                if shift:
                    # Daten extrahieren
                    if isinstance(shift, dict):
                        typ = shift.get('type', '')  # z.B. "T", "N", "S"
                        start = str(shift.get('start_time', ''))[:5]
                        end = str(shift.get('end_time', ''))[:5]
                    else:
                        typ = getattr(shift, 'type', '')
                        start = str(getattr(shift, 'start_time', ''))[:5]
                        end = str(getattr(shift, 'end_time', ''))[:5]

                    # Darstellung
                    type_class = f"type-{typ}" if typ else ""

                    if typ:
                        content = f"<span class='shift-type {type_class}'>{typ}</span>"
                        # Wenn Start/Ende abweichend von Standard ist, könnte man es hier anzeigen
                        # content += f"<span class='shift-time'>{start}-{end}</span>"
                    elif start and end:
                        content = f"<span class='shift-time'>{start}<br>-<br>{end}</span>"
                    else:
                        content = "D"

                html_parts.append(f"<td class='shift-cell {css_class}'>{content}</td>")

            html_parts.append("</tr>")

        html_parts.append("</tbody></table></body></html>")

        return "".join(html_parts)

    except Exception as e:
        logger.error(f"[HTMLGenerator] Kritischer Fehler: {str(e)}", exc_info=True)
        return "<html><body>Fehler bei der Erstellung des Plans.</body></html>"