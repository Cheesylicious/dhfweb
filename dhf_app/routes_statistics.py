# dhf_app/routes_statistics.py

from flask import Blueprint, request, jsonify, current_app
from sqlalchemy import func, extract, desc, and_, or_
from .models import Shift, ShiftType, User
from .extensions import db
from .utils import stats_permission_required
from datetime import datetime, date

# Erstellt einen Blueprint für Statistik-Routen
statistics_bp = Blueprint('statistics', __name__, url_prefix='/api/statistics')


@statistics_bp.route('/rankings', methods=['GET'])
@stats_permission_required
def get_shift_rankings():
    """
    Liefert eine Rangliste (Ranking) der Mitarbeiter pro Schichtart.
    Filtert archivierte Mitarbeiter aus, die vor dem gewählten Jahr inaktiv wurden.
    """
    try:
        # Filter-Parameter auslesen
        year = request.args.get('year')
        month = request.args.get('month')

        if not year:
            year = datetime.now().year
        else:
            year = int(year)

        # Startdatum des Jahres für den Inaktivitäts-Check
        start_of_year = date(year, 1, 1)

        # Basis-Query erstellen
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

        # Filterliste
        filters = []

        # 1. Jahr (Pflicht)
        filters.append(extract('year', Shift.date) == year)

        # 2. Monat (Optional)
        if month:
            filters.append(extract('month', Shift.date) == int(month))

        # 3. Keine Entwürfe/Varianten zählen
        filters.append(Shift.variant_id.is_(None))

        # 4. KORREKTUR: Archivierte User ausblenden
        # Ein User wird angezeigt, wenn er:
        # a) Kein Inaktiv-Datum hat (inaktiv_ab_datum IS NULL)
        # b) ODER das Inaktiv-Datum im aktuellen Jahr oder in der Zukunft liegt
        filters.append(or_(
            User.inaktiv_ab_datum.is_(None),
            User.inaktiv_ab_datum >= start_of_year
        ))

        # Filter anwenden
        query = query.filter(and_(*filters))

        # Gruppierung: Erst nach Schichtart, dann nach User
        query = query.group_by(ShiftType.id, User.id)

        # Sortierung: Erst nach Schicht-Kürzel, dann wer die meisten hat (absteigend)
        results = query.order_by(ShiftType.staffing_sort_order, ShiftType.abbreviation, desc('count')).all()

        # Datenstrukturieren für das Frontend
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
@stats_permission_required
def get_user_statistics(user_id):
    """
    Liefert detaillierte Statistiken für einen einzelnen Benutzer (Drill-Down).
    Liefert auch die konkreten Datumswerte (dates) zurück, um 'Geister-Einträge' zu identifizieren.
    """
    try:
        year = request.args.get('year')
        if not year:
            year = datetime.now().year
        else:
            year = int(year)

        # Wir holen die echten Schicht-Objekte, um die Daten zu sammeln
        shifts = db.session.query(Shift, ShiftType).join(
            ShiftType, Shift.shifttype_id == ShiftType.id
        ).filter(
            Shift.user_id == user_id,
            extract('year', Shift.date) == year,
            Shift.variant_id.is_(None)  # WICHTIG: Keine Varianten
        ).order_by(Shift.date).all()

        # Daten in Python aggregieren
        stats_map = {}  # shifttype_id -> {meta, count, hours, dates list}

        for shift, shift_type in shifts:
            sid = shift_type.id
            if sid not in stats_map:
                stats_map[sid] = {
                    "type": shift_type.abbreviation,
                    "name": shift_type.name,
                    "color": shift_type.color,
                    "count": 0,
                    "hours": 0.0,
                    "dates": []
                }

            # Werte addieren
            stats_map[sid]["count"] += 1
            if shift_type.hours:
                stats_map[sid]["hours"] += shift_type.hours

            # Datum hinzufügen
            stats_map[sid]["dates"].append(shift.date.isoformat())

        # In Liste umwandeln
        details = list(stats_map.values())

        # Gesamtstunden berechnen
        total_year_hours = sum(d['hours'] for d in details)

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