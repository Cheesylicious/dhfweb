from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user
from datetime import datetime, date  # <<< WICHTIG: date importieren
from .extensions import db
from .models import Shift
from .models_market import ShiftMarketOffer
from .services_shift_change import ShiftChangeService

market_bp = Blueprint('market', __name__, url_prefix='/api/market')


def _is_allowed():
    """
    Prüft, ob der User Zugriff auf den Markt hat (Hundeführer oder Admin).
    """
    if not current_user.is_authenticated:
        return False
    if current_user.role.name in ['admin', 'Hundeführer']:
        return True
    return False


@market_bp.route('/offers', methods=['GET'])
@login_required
def get_market_offers():
    """
    Liefert alle AKTIVEN Angebote.
    """
    if not _is_allowed():
        return jsonify({"message": "Zugriff verweigert."}), 403

    offers = ShiftMarketOffer.query.filter_by(status='active') \
        .order_by(ShiftMarketOffer.created_at.desc()).all()

    results = []
    for offer in offers:
        data = offer.to_dict()
        data['is_my_offer'] = (offer.offering_user_id == current_user.id)
        results.append(data)

    return jsonify(results), 200


@market_bp.route('/offer', methods=['POST'])
@login_required
def create_market_offer():
    """
    Erstellt ein neues Angebot (Schicht in die Börse stellen).
    """
    if not _is_allowed():
        return jsonify({"message": "Nur Hundeführer können die Tauschbörse nutzen."}), 403

    data = request.get_json()
    shift_id = data.get('shift_id')
    note = data.get('note', '')

    if not shift_id:
        return jsonify({"message": "Schicht-ID fehlt."}), 400

    shift = db.session.get(Shift, shift_id)
    if not shift:
        return jsonify({"message": "Schicht nicht gefunden."}), 404

    # --- NEU: Zeit-Check (Vergangenheit blockieren) ---
    if shift.date < date.today():
        return jsonify({"message": "Vergangene Schichten können nicht getauscht werden."}), 400
    # --------------------------------------------------

    if shift.user_id != current_user.id:
        return jsonify({"message": "Sie können nur eigene Schichten anbieten."}), 403

    existing = ShiftMarketOffer.query.filter_by(shift_id=shift_id, status='active').first()
    if existing:
        return jsonify({"message": "Diese Schicht ist bereits in der Tauschbörse."}), 400

    new_offer = ShiftMarketOffer(
        shift_id=shift_id,
        offering_user_id=current_user.id,
        note=note,
        status='active'
    )
    db.session.add(new_offer)
    db.session.commit()

    return jsonify(new_offer.to_dict()), 201


@market_bp.route('/offer/<int:offer_id>', methods=['DELETE'])
@login_required
def cancel_market_offer(offer_id):
    """
    Zieht ein Angebot zurück.
    """
    offer = db.session.get(ShiftMarketOffer, offer_id)
    if not offer:
        return jsonify({"message": "Angebot nicht gefunden."}), 404

    is_owner = (offer.offering_user_id == current_user.id)
    is_admin = (current_user.role.name == 'admin')

    if not (is_owner or is_admin):
        return jsonify({"message": "Nicht berechtigt."}), 403

    if offer.status != 'active':
        return jsonify({"message": "Angebot ist nicht mehr aktiv und kann nicht gelöscht werden."}), 400

    offer.status = 'cancelled'
    db.session.commit()
    return jsonify({"message": "Angebot zurückgezogen."}), 200


@market_bp.route('/accept/<int:offer_id>', methods=['POST'])
@login_required
def accept_market_offer(offer_id):
    """
    Ein anderer User nimmt das Angebot an.
    """
    if not _is_allowed():
        return jsonify({"message": "Zugriff verweigert."}), 403

    offer = db.session.get(ShiftMarketOffer, offer_id)
    if not offer:
        return jsonify({"message": "Angebot nicht gefunden."}), 404

    if offer.status != 'active':
        return jsonify({"message": "Angebot ist leider schon weg oder nicht mehr verfügbar."}), 400

    # --- NEU: Auch hier sicherheitshalber Datum prüfen ---
    if offer.shift.date < date.today():
        return jsonify({"message": "Diese Schicht liegt in der Vergangenheit."}), 400
    # ----------------------------------------------------

    if offer.offering_user_id == current_user.id:
        return jsonify({"message": "Sie können Ihr eigenes Angebot nicht selbst annehmen."}), 400

    # Konflikt-Check (Doppelbelegung)
    target_date = offer.shift.date
    existing_shift = Shift.query.filter_by(
        user_id=current_user.id,
        date=target_date,
        variant_id=offer.shift.variant_id
    ).first()

    if existing_shift and existing_shift.shifttype_id is not None:
        return jsonify({
            "message": f"Nicht möglich: Sie haben am {target_date.strftime('%d.%m.%Y')} bereits einen Dienst eingetragen!"
        }), 409

    try:
        offer.status = 'pending'
        offer.accepted_by_id = current_user.id
        offer.accepted_at = datetime.utcnow()

        service_result, status_code = ShiftChangeService.create_request(
            shift_id=offer.shift_id,
            requester_id=offer.offering_user_id,
            replacement_user_id=current_user.id,
            note=f"Marktplatz-Deal (Angebot #{offer.id}): {offer.note}",
            reason_type='trade'
        )

        if status_code != 201:
            db.session.rollback()
            return jsonify(service_result), status_code

        db.session.commit()

        return jsonify({
            "message": "Angebot angenommen! Der Antrag liegt nun zur Genehmigung vor.",
            "offer": offer.to_dict()
        }), 200

    except Exception as e:
        db.session.rollback()
        return jsonify({"message": f"Fehler beim Annehmen: {str(e)}"}), 500