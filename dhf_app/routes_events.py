from flask import Blueprint, request, jsonify, current_app
from .models import SpecialDate
from .extensions import db
from .routes_admin import admin_required  # Wir nutzen den Admin-Decorator
from flask_login import login_required
from datetime import datetime
from sqlalchemy import extract
from dateutil.easter import easter
from datetime import datetime, timedelta

# Erstellt einen Blueprint. Alle Routen hier beginnen mit /api
events_bp = Blueprint('events', __name__, url_prefix='/api')


def none_if_empty(value):
    return None if value == '' else value


@events_bp.route('/special_dates', methods=['GET'])
@login_required
def get_special_dates():
    """
    Holt alle Sondertermine, optional gefiltert nach Typ UND JAHR.
    """
    date_type = request.args.get('type')
    year = request.args.get('year')

    query = SpecialDate.query

    if date_type in ['holiday', 'training', 'shooting']:
        query = query.filter_by(type=date_type)

    if year:
        try:
            query = query.filter(
                db.or_(
                    extract('year', SpecialDate.date) == int(year),
                    SpecialDate.date == None
                )
            )
        except ValueError:
            return jsonify({"message": "Ungültiges Jahr-Format"}), 400

    dates = query.order_by(
        SpecialDate.date.is_(None).desc(),
        SpecialDate.date.asc(),
        SpecialDate.name
    ).all()

    return jsonify([d.to_dict() for d in dates]), 200


@events_bp.route('/special_dates', methods=['POST'])
@admin_required
def create_special_date():
    """
    Erstellt einen neuen Sondertermin.
    ANGEPASST: Akzeptiert "namenlose" Eingaben für Training/Schießen.
    """
    data = request.get_json()
    date_type = data.get('type')
    name = data.get('name')

    # --- NEUE LOGIK (REGEL 2) ---
    # Weist automatisch einen Namen zu, falls keiner gesendet wurde
    if not name:
        if date_type == 'training':
            name = "Quartals Ausbildung"
        elif date_type == 'shooting':
            name = "Schießen"
    # --- ENDE NEUE LOGIK ---

    if not name or not date_type:
        return jsonify({"message": "Name und Typ sind erforderlich"}), 400
    if date_type not in ['holiday', 'training', 'shooting']:
        return jsonify({"message": "Ungültiger Typ"}), 400

    date_str = none_if_empty(data.get('date'))
    parsed_date = None
    if date_str:
        try:
            parsed_date = datetime.strptime(date_str, '%d.%m.%Y').date()
        except ValueError:
            try:
                parsed_date = datetime.strptime(date_str, '%Y-%m-%d').date()
            except ValueError:
                return jsonify({"message": "Ungültiges Datumsformat. Erwartet: TT.MM.YYYY"}), 400

    if not parsed_date:
        return jsonify({"message": "Datum ist erforderlich"}), 400

    new_date = SpecialDate(
        name=name,
        date=parsed_date,
        type=date_type
    )

    try:
        db.session.add(new_date)
        db.session.commit()
        return jsonify(new_date.to_dict()), 201
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler beim Erstellen von SpecialDate: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


@events_bp.route('/special_dates/<int:date_id>', methods=['PUT'])
@admin_required
def update_special_date(date_id):
    """
    Aktualisiert einen Sondertermin (Name oder Datum).
    (Unverändert)
    """
    event = db.session.get(SpecialDate, date_id)
    if not event:
        return jsonify({"message": "Termin nicht gefunden"}), 404

    data = request.get_json()
    event.name = data.get('name', event.name)

    date_str = none_if_empty(data.get('date', event.date))
    parsed_date = None
    if isinstance(date_str, datetime.date):
        parsed_date = date_str
    elif date_str:
        try:
            parsed_date = datetime.strptime(date_str, '%d.%m.%Y').date()
        except ValueError:
            try:
                parsed_date = datetime.strptime(date_str, '%Y-%m-%d').date()
            except ValueError:
                return jsonify({"message": "Ungültiges Datumsformat. Erwartet: TT.MM.YYYY"}), 400

    event.date = parsed_date

    try:
        db.session.commit()
        return jsonify(event.to_dict()), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler beim Update von SpecialDate: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


@events_bp.route('/special_dates/<int:date_id>', methods=['DELETE'])
@admin_required
def delete_special_date(date_id):
    """
    Löscht einen Sondertermin.
    (Unverändert)
    """
    event = db.session.get(SpecialDate, date_id)
    if not event:
        return jsonify({"message": "Termin nicht gefunden"}), 404

    try:
        db.session.delete(event)
        db.session.commit()
        return jsonify({"message": "Termin gelöscht"}), 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler beim Löschen von SpecialDate: {str(e)}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


@events_bp.route('/special_dates/calculate_holidays', methods=['POST'])
@admin_required
def calculate_holidays():
    """
    Berechnet die Daten für alle MV-Feiertage für ein bestimmtes Jahr.
    (Unverändert)
    """
    data = request.get_json()
    try:
        year = int(data['year'])
    except (TypeError, KeyError, ValueError):
        return jsonify({"message": "Gültiges Jahr erforderlich."}), 400

    try:
        easter_sunday = easter(year)
        holidays_mv = {
            "Neujahr": datetime(year, 1, 1).date(),
            "Internationaler Frauentag": datetime(year, 3, 8).date(),
            "Tag der Arbeit": datetime(year, 5, 1).date(),
            "Tag der Deutschen Einheit": datetime(year, 10, 3).date(),
            "Reformationstag": datetime(year, 10, 31).date(),
            "Erster Weihnachtsfeiertag": datetime(year, 12, 25).date(),
            "Zweiter Weihnachtsfeiertag": datetime(year, 12, 26).date(),
            "Karfreitag": easter_sunday - timedelta(days=2),
            "Ostermontag": easter_sunday + timedelta(days=1),
            "Christi Himmelfahrt": easter_sunday + timedelta(days=39),
            "Pfingstmontag": easter_sunday + timedelta(days=50),
        }

        updated_count = 0
        created_count = 0

        for name, date in holidays_mv.items():
            event = SpecialDate.query.filter_by(type='holiday', name=name).first()

            if event:
                event.date = date
                updated_count += 1
            else:
                new_event = SpecialDate(name=name, date=date, type='holiday')
                db.session.add(new_event)
                created_count += 1

        db.session.commit()

        return jsonify({
            "message": f"Feiertage für {year} erfolgreich berechnet.",
            "updated": updated_count,
            "created": created_count
        }), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler bei Feiertagsberechnung: {str(e)}")
        return jsonify({"message": f"Serverfehler bei Berechnung: {str(e)}"}), 500