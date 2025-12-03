from flask import Blueprint, request, jsonify, current_app
from .models import PlanVariant, Shift, UpdateLog
from .extensions import db
from .utils import admin_required
from datetime import datetime
from sqlalchemy import extract, insert, select, literal, and_

# Blueprint erstellen
variants_bp = Blueprint('variants', __name__, url_prefix='/api/variants')


def _log_update_event(area, description):
    """
    Erstellt einen Eintrag im UpdateLog.
    """
    try:
        new_log = UpdateLog(
            area=area,
            description=description,
            updated_at=datetime.utcnow()
        )
        db.session.add(new_log)
    except Exception as e:
        current_app.logger.error(f"Fehler beim Loggen: {e}")


@variants_bp.route('', methods=['GET'])
@admin_required
def get_variants():
    """
    Holt alle Varianten für einen bestimmten Monat/Jahr.
    Query-Params: year, month
    """
    try:
        year = request.args.get('year', type=int)
        month = request.args.get('month', type=int)

        if not year or not month:
            return jsonify({"message": "Jahr und Monat sind erforderlich."}), 400

        variants = PlanVariant.query.filter_by(year=year, month=month).order_by(PlanVariant.created_at).all()

        return jsonify([v.to_dict() for v in variants]), 200

    except Exception as e:
        current_app.logger.error(f"Fehler beim Laden der Varianten: {e}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


@variants_bp.route('', methods=['POST'])
@admin_required
def create_variant():
    """
    Erstellt eine neue Variante.
    Kopiert dabei ALLE Schichten aus dem aktuellen Hauptplan (oder einer anderen Basis) in die neue Variante.
    """
    data = request.get_json()
    name = data.get('name')
    year = data.get('year')
    month = data.get('month')
    # Optional: Basis-Variante (None = Hauptplan)
    source_variant_id = data.get('source_variant_id')

    if not name or not year or not month:
        return jsonify({"message": "Name, Jahr und Monat sind erforderlich."}), 400

    try:
        # 1. Neue Variante anlegen
        new_variant = PlanVariant(name=name, year=year, month=month)
        db.session.add(new_variant)
        db.session.flush()  # Damit wir die ID erhalten

        # 2. Performantes Kopieren der Schichten (SQL INSERT ... SELECT)
        # Wir kopieren: user_id, shifttype_id, date, is_locked
        # Neu gesetzt wird: variant_id

        # Filter für die Quelle
        source_filter = and_(
            extract('year', Shift.date) == year,
            extract('month', Shift.date) == month,
            Shift.variant_id == source_variant_id  # None für Hauptplan, ID für andere Variante
        )

        select_stmt = select(
            Shift.user_id,
            Shift.shifttype_id,
            Shift.date,
            Shift.is_locked,
            literal(new_variant.id)  # Die neue variant_id setzen
        ).where(source_filter)

        insert_stmt = insert(Shift).from_select(
            ['user_id', 'shifttype_id', 'date', 'is_locked', 'variant_id'],
            select_stmt
        )

        result = db.session.execute(insert_stmt)
        rows_copied = result.rowcount

        _log_update_event("Planung",
                          f"Variante '{name}' für {month}/{year} erstellt ({rows_copied} Schichten kopiert).")

        db.session.commit()
        return jsonify({
            "message": f"Variante '{name}' erstellt.",
            "variant": new_variant.to_dict(),
            "shifts_copied": rows_copied
        }), 201

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler beim Erstellen der Variante: {e}")
        return jsonify({"message": f"Fehler: {str(e)}"}), 500


@variants_bp.route('/<int:variant_id>/publish', methods=['POST'])
@admin_required
def publish_variant(variant_id):
    """
    Macht eine Variante zum neuen Hauptplan.
    1. Löscht den aktuellen Hauptplan für den Zeitraum.
    2. Setzt variant_id der Variante auf NULL (damit wird sie zum Hauptplan).
    3. Löscht den Varianten-Eintrag.
    """
    variant = db.session.get(PlanVariant, variant_id)
    if not variant:
        return jsonify({"message": "Variante nicht gefunden."}), 404

    year = variant.year
    month = variant.month

    try:
        # 1. Alten Hauptplan löschen (Performantes Bulk Delete)
        # Wir löschen alles, wo variant_id IS NULL im betroffenen Monat
        delete_count = Shift.query.filter(
            extract('year', Shift.date) == year,
            extract('month', Shift.date) == month,
            Shift.variant_id == None
        ).delete(synchronize_session=False)

        # 2. Die Schichten der Variante "befördern" (variant_id -> NULL)
        # Wir nutzen update() für Performance
        update_count = Shift.query.filter(
            Shift.variant_id == variant_id
        ).update({Shift.variant_id: None}, synchronize_session=False)

        # 3. Das Varianten-Objekt selbst löschen
        db.session.delete(variant)

        _log_update_event("Planung",
                          f"Variante '{variant.name}' wurde als Hauptplan für {month}/{year} veröffentlicht.")

        db.session.commit()
        return jsonify({
            "message": f"Variante '{variant.name}' ist jetzt der Hauptplan.",
            "deleted_old_shifts": delete_count,
            "promoted_shifts": update_count
        }), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler beim Veröffentlichen der Variante: {e}")
        return jsonify({"message": f"Fehler: {str(e)}"}), 500


@variants_bp.route('/<int:variant_id>', methods=['DELETE'])
@admin_required
def delete_variant(variant_id):
    """
    Löscht eine Variante und alle zugehörigen Schichten.
    """
    variant = db.session.get(PlanVariant, variant_id)
    if not variant:
        return jsonify({"message": "Variante nicht gefunden."}), 404

    try:
        name = variant.name
        # Durch cascade="all, delete-orphan" im Model sollten die Schichten automatisch gelöscht werden.
        # Zur Sicherheit und Performance kann man es explizit tun, aber das Model regelt es meist.
        db.session.delete(variant)

        _log_update_event("Planung", f"Variante '{name}' gelöscht.")

        db.session.commit()
        return jsonify({"message": "Variante gelöscht."}), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler beim Löschen der Variante: {e}")
        return jsonify({"message": f"Fehler: {str(e)}"}), 500