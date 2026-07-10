# dhf_app/routes_variants.py

from flask import Blueprint, request, jsonify, current_app
from flask_login import login_required  
from .models import PlanVariant, Shift, UpdateLog, ShiftPlanStatus  
from .models_market import ShiftMarketOffer
from .models_shift_change import ShiftChangeRequest
from .models_gamification import GamificationLog
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
@login_required  
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
    Zusätzlich werden die aktuellen Filter-Einstellungen geerbt.
    """
    data = request.get_json()
    name = data.get('name')
    year = data.get('year')
    month = data.get('month')
    source_variant_id = data.get('source_variant_id')

    if not name or not year or not month:
        return jsonify({"message": "Name, Jahr und Monat sind erforderlich."}), 400

    try:
        # --- Filter-Einstellungen aus Quelle erben ---
        source_show_12er = True
        source_show_24er = True
        
        if source_variant_id:
            source_var = db.session.get(PlanVariant, source_variant_id)
            if source_var:
                source_show_12er = source_var.show_12er
                source_show_24er = source_var.show_24er
        else:
            source_status = ShiftPlanStatus.query.filter_by(year=year, month=month).first()
            if source_status:
                source_show_12er = source_status.show_12er
                source_show_24er = source_status.show_24er

        new_variant = PlanVariant(
            name=name, 
            year=year, 
            month=month,
            show_12er=source_show_12er,
            show_24er=source_show_24er
        )
        db.session.add(new_variant)
        db.session.flush()  

        source_filter = and_(
            extract('year', Shift.date) == year,
            extract('month', Shift.date) == month,
            Shift.variant_id == source_variant_id  
        )

        select_stmt = select(
            Shift.user_id,
            Shift.shifttype_id,
            Shift.date,
            Shift.is_locked,
            literal(new_variant.id)  
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
    """
    variant = db.session.get(PlanVariant, variant_id)
    if not variant:
        return jsonify({"message": "Variante nicht gefunden."}), 404

    year = variant.year
    month = variant.month

    try:
        shifts_to_delete_query = db.session.query(Shift.id).filter(
            extract('year', Shift.date) == year,
            extract('month', Shift.date) == month,
            Shift.variant_id == None
        )

        ShiftMarketOffer.query.filter(
            ShiftMarketOffer.shift_id.in_(shifts_to_delete_query)
        ).update({ShiftMarketOffer.shift_id: None, ShiftMarketOffer.status: 'archived_overwrite'}, synchronize_session=False)

        ShiftChangeRequest.query.filter(
            ShiftChangeRequest.original_shift_id.in_(shifts_to_delete_query)
        ).update({ShiftChangeRequest.original_shift_id: None, ShiftChangeRequest.status: 'archived_overwrite'}, synchronize_session=False)

        GamificationLog.query.filter(
            GamificationLog.shift_id.in_(shifts_to_delete_query)
        ).update({GamificationLog.shift_id: None}, synchronize_session=False)

        db.session.flush()

        delete_count = Shift.query.filter(
            extract('year', Shift.date) == year,
            extract('month', Shift.date) == month,
            Shift.variant_id == None
        ).delete(synchronize_session=False)

        update_count = Shift.query.filter(
            Shift.variant_id == variant_id
        ).update({Shift.variant_id: None}, synchronize_session=False)

        status = ShiftPlanStatus.query.filter_by(year=year, month=month).first()
        if not status:
            status = ShiftPlanStatus(year=year, month=month, status='In Bearbeitung')
            db.session.add(status)
        
        status.show_12er = variant.show_12er
        status.show_24er = variant.show_24er

        # Beim Veröffentlichen einer Variante überschreiben wir auch den Hauptplan-Namen mit dem Varianten-Namen
        status.plan_name = variant.name

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
        db.session.delete(variant)

        _log_update_event("Planung", f"Variante '{name}' gelöscht.")

        db.session.commit()
        return jsonify({"message": "Variante gelöscht."}), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler beim Löschen der Variante: {e}")
        return jsonify({"message": f"Fehler: {str(e)}"}), 500


@variants_bp.route('/filters', methods=['PUT'])
@admin_required
def update_filters():
    """
    Speichert die Checkboxen (12er / 24er) für eine spezifische Variante (oder den Hauptplan) auf dem Server.
    """
    data = request.get_json()
    year = data.get('year')
    month = data.get('month')
    variant_id = data.get('variant_id') 
    show_12er = data.get('show_12er', True)
    show_24er = data.get('show_24er', True)

    if not year or not month:
        return jsonify({"message": "Jahr und Monat fehlen."}), 400

    try:
        if variant_id:
            variant = db.session.get(PlanVariant, variant_id)
            if variant:
                variant.show_12er = show_12er
                variant.show_24er = show_24er
        else:
            status = ShiftPlanStatus.query.filter_by(year=year, month=month).first()
            if not status:
                status = ShiftPlanStatus(year=year, month=month, status='In Bearbeitung', show_12er=show_12er, show_24er=show_24er)
                db.session.add(status)
            else:
                status.show_12er = show_12er
                status.show_24er = show_24er

        db.session.commit()
        return jsonify({"message": "Filter-Einstellungen erfolgreich gespeichert."}), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler beim Speichern der Filter: {e}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500


# --- NEU: Endpunkt zum Umbenennen ---
@variants_bp.route('/rename', methods=['PUT'])
@admin_required
def rename_variant():
    """
    Benennt eine Variante oder den Hauptplan um.
    """
    data = request.get_json()
    year = data.get('year')
    month = data.get('month')
    variant_id = data.get('variant_id') # Wenn Null, betrifft es den Hauptplan
    new_name = data.get('new_name')

    if not year or not month or not new_name:
        return jsonify({"message": "Jahr, Monat und neuer Name fehlen."}), 400

    try:
        if variant_id:
            # Variante aktualisieren
            variant = db.session.get(PlanVariant, variant_id)
            if variant:
                old_name = variant.name
                variant.name = new_name
                _log_update_event("Planung", f"Variante '{old_name}' in '{new_name}' umbenannt.")
            else:
                return jsonify({"message": "Variante nicht gefunden."}), 404
        else:
            # Hauptplan (ShiftPlanStatus) aktualisieren
            status = ShiftPlanStatus.query.filter_by(year=year, month=month).first()
            if not status:
                status = ShiftPlanStatus(year=year, month=month, status='In Bearbeitung', plan_name=new_name)
                db.session.add(status)
            else:
                old_name = status.plan_name or "Hauptplan"
                status.plan_name = new_name
                _log_update_event("Planung", f"Hauptplan '{old_name}' in '{new_name}' umbenannt.")

        db.session.commit()
        return jsonify({"message": "Name erfolgreich geändert."}), 200

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Fehler beim Umbenennen: {e}")
        return jsonify({"message": f"Datenbankfehler: {str(e)}"}), 500