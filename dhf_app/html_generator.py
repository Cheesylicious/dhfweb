def generate_roster_html(roster_data):
    """
    Erzeugt einen HTML-String, der für mobile Ansichten (Hochformat) optimiert ist.
    """

    # CSS für 'Mobile First' Lesbarkeit:
    # - Sans-Serif Fonts für Klarheit
    # - border-collapse für Platzeinsparung
    # - padding: 4px statt Standard 10px+ (löst das Platzproblem)
    # - Kontrastreiche Farben für Lesbarkeit bei kleinerem Display

    html_content = """
    <!DOCTYPE html>
    <html>
    <head>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-color: #f4f4f4;
            margin: 0;
            padding: 10px;
            /* Begrenzung der Breite erzwingt Umbruch oder Skalierung, ideal für Screenshots */
            max-width: 800px; 
        }
        .container {
            background-color: white;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }
        h2 {
            background-color: #2c3e50;
            color: white;
            padding: 10px;
            margin: 0;
            text-align: center;
            font-size: 18px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px; /* Kleinere Schrift für mobile Übersicht */
        }
        th, td {
            text-align: left;
            padding: 5px 8px; /* Reduziertes Padding für Kompaktheit */
            border-bottom: 1px solid #ddd;
        }
        th {
            background-color: #ecf0f1;
            color: #333;
            font-weight: bold;
        }
        tr:last-child td {
            border-bottom: none;
        }
        .date-col {
            white-space: nowrap; /* Datum nicht umbrechen */
            width: 80px;
            color: #555;
            font-weight: 600;
        }
        .name-row {
            background-color: #e8f4fc;
            font-weight: bold;
            color: #2980b9;
        }
    </style>
    </head>
    <body>
        <div class="container">
            <h2>Aktueller Dienstplan</h2>
            <table>
                <thead>
                    <tr>
                        <th>Tag</th>
                        <th>Zeit</th>
                        <th>Ort</th>
                    </tr>
                </thead>
                <tbody>
    """

    # Wir ändern die Logik: Statt einer breiten Matrix (Mitarbeiter als Spalten),
    # die auf Handys schlecht lesbar ist, gruppieren wir vertikal nach Mitarbeiter.
    # Das ist auf dem Handy durch einfaches Scrollen viel besser erfassbar.

    for staff in roster_data:
        # Kopfzeile für den Mitarbeiter
        html_content += f"""
        <tr class="name-row">
            <td colspan="3">{staff['name']}</td>
        </tr>
        """

        if not staff['shifts']:
            html_content += """
            <tr>
                <td colspan="3" style="color: #999; font-style: italic;">Keine Schichten</td>
            </tr>
            """

        for shift in staff['shifts']:
            html_content += f"""
            <tr>
                <td class="date-col">{shift['formatted_date']}</td>
                <td>{shift['time']}</td>
                <td>{shift['location']}</td>
            </tr>
            """

    html_content += """
                </tbody>
            </table>
        </div>
    </body>
    </html>
    """

    return html_content