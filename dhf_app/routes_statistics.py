# dhf_app/routes_statistics.py

from flask import Blueprint, request, jsonify, current_app
from sqlalchemy import func, extract, desc, and_
from .models import Shift, ShiftType, User
from .extensions import db
from .utils import admin_required
from datetime import datetime

# Erstellt einen Blueprint für Statistik-Routen
statistics_bp = Blueprint('statistics', __name__, url_prefix='/api/statistics')


@statistics_bp.route('/rankings', methods=['GET'])
@admin_required
def get_shift_rankings():
    """
    Liefert eine Rangliste (Ranking) der Mitarbeiter pro Schichtart.
    Berechnet die Anzahl der Schichten pro Typ effizient über SQL-Aggregation.

    Parameter (Query String):
    - year: (Optional) Filtert nach Jahr (z.B. 2025). Standard: Aktuelles Jahr.
    - month: (Optional) Filtert nach Monat. Wenn weggelassen, wird das ganze Jahr betrachtet.
    """
    try:
        # Filter-Parameter auslesen
        year = request.args.get('year')
        month = request.args.get('month')

        if not year:
            year = datetime.now().year
        else:
            year = int(year)

        # Basis-Query erstellen
        # Wir wählen: Schichtkürzel, User-Daten und die Anzahl (COUNT)
        # Performance: Wir lassen die Datenbank zählen, statt Python-Loops zu nutzen.
        query = db.session.query(
            ShiftType.abbreviation,
            ShiftType.name.label('type_name'),
            ShiftType.color,
            User.id.label('user_id'),
            User.vorname,
            User.name,
            func.count(Shift.id).label('count')
        ).join(
            ShiftType, Shift.shifttype_id == ShiftType.id
        ).join(
            User, Shift.user_id == User.id
        )

        # Filter anwenden
        filters = [extract('year', Shift.date) == year]

        if month:
            filters.append(extract('month', Shift.date) == int(month))

        # WICHTIG: Durch den JOIN mit der Shift-Tabelle fallen User,
        # die KEINE Schichten in diesem Zeitraum haben, automatisch heraus.
        # Das erfüllt die Anforderung, Besucher oder inaktive User ohne Schichten nicht anzuzeigen.

        query = query.filter(and_(*filters))

        # Gruppierung: Erst nach Schichtart, dann nach User
        query = query.group_by(ShiftType.id, User.id)

        # Sortierung: Erst nach Schicht-Kürzel, dann wer die meisten hat (absteigend)
        results = query.order_by(ShiftType.staffing_sort_order, ShiftType.abbreviation, desc('count')).all()

        # Datenstrukturieren für das Frontend
        # Zielformat: { "T.": { "meta": {...}, "rankings": [ {user, count}, ... ] }, "N.": ... }
        stats_data = {}

        for row in results:
            abbr = row.abbreviation

            if abbr not in stats_data:
                stats_data[abbr] = {
                    "meta": {
                        "name": row.type_name,
                        "color": row.color,
                        "abbreviation": abbr
                    },
                    "rankings": []
                }

            # Füge den User zur Rangliste dieser Schichtart hinzu
            stats_data[abbr]["rankings"].append({
                "user_id": row.user_id,
                "name": f"{row.vorname} {row.name}",
                "count": row.count
            })

        return jsonify({
            "year": year,
            "month": month,
            "data": stats_data
        }), 200

    except Exception as e:
        current_app.logger.error(f"Fehler beim Laden der Statistiken: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


@statistics_bp.route('/user_details/<int:user_id>', methods=['GET'])
@admin_required
def get_user_statistics(user_id):
    """
    Liefert detaillierte Statistiken für einen einzelnen Benutzer (Drill-Down).
    Zeigt die Verteilung aller Schichten dieses Users an.
    """
    try:
        year = request.args.get('year')
        if not year:
            year = datetime.now().year
        else:
            year = int(year)

        # Gesamtanzahl Schichten pro Typ für diesen User
        query = db.session.query(
            ShiftType.abbreviation,
            ShiftType.name,
            ShiftType.color,
            func.count(Shift.id).label('count'),
            func.sum(ShiftType.hours).label('total_hours')  # Berechnet auch gleich die Stunden
        ).join(
            ShiftType, Shift.shifttype_id == ShiftType.id
        ).filter(
            Shift.user_id == user_id,
            extract('year', Shift.date) == year
        ).group_by(ShiftType.id).all()

        details = []
        total_year_hours = 0.0

        for row in query:
            h = row.total_hours if row.total_hours else 0.0
            total_year_hours += h
            details.append({
                "type": row.abbreviation,
                "name": row.name,
                "color": row.color,
                "count": row.count,
                "hours": round(h, 1)
            })

        # Sortieren nach Häufigkeit
        details.sort(key=lambda x: x['count'], reverse=True)

        return jsonify({
            "user_id": user_id,
            "year": year,
            "total_hours": round(total_year_hours, 1),
            "breakdown": details
        }), 200

    except Exception as e:
        current_app.logger.error(f"Fehler bei User-Statistik: {str(e)}")
        return jsonify({"message": f"Fehler: {str(e)}"}), 500