# dhf_app/routes_market.py

from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user
from datetime import datetime, date, timedelta
from .extensions import db
from .models import Shift, ShiftType, User
from .models_market import ShiftMarketOffer, ShiftMarketResponse
from .services_shift_change import ShiftChangeService
from .services_market import MarketService
from .utils import admin_required

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
    Liefert Angebote zurück.
    Führt vorher einen Cleanup alter Angebote durch.
    Enthält Zusatzinfos: Hat der User bereits reagiert? Wie viele Interessenten (für Owner)?
    """
    if not _is_allowed():
        return jsonify({"message": "Zugriff verweigert."}), 403

    # Cleanup Task bei jedem Laden triggern
    MarketService.cleanup_old_offers()

    # Filter auslesen (Default: active)
    status_filter = request.args.get('status', 'active')

    query = ShiftMarketOffer.query.join(Shift).filter(
        Shift.variant_id == None  # <--- NUR HAUPTPLAN
    )

    if status_filter == 'own':
        # Eigene Angebote (active oder pending)
        query = query.filter(
            ShiftMarketOffer.offering_user_id == current_user.id,
            ShiftMarketOffer.status.in_(['active', 'pending'])
        )
    elif status_filter == 'pending':
        # Laufende Genehmigungsverfahren
        query = query.filter(ShiftMarketOffer.status == 'pending')
    else:
        # Standard: Nur aktive Angebote im Markt
        query = query.filter(ShiftMarketOffer.status == 'active')

    offers = query.order_by(ShiftMarketOffer.created_at.desc()).all()

    results = []
    for offer in offers:
        data = offer.to_dict()
        data['is_my_offer'] = (offer.offering_user_id == current_user.id)

        # NEU: Meine Reaktion hinzufügen (falls ich Kandidat bin)
        my_response = ShiftMarketResponse.query.filter_by(offer_id=offer.id, user_id=current_user.id).first()
        data['my_response'] = my_response.response_type if my_response else None

        # NEU: Für den Owner: Anzahl Interessenten zählen (für Badge im Frontend)
        if data['is_my_offer']:
            interested_count = ShiftMarketResponse.query.filter_by(offer_id=offer.id,
                                                                   response_type='interested').count()
            data['interested_count'] = interested_count

        # Für Pending-Angebote fügen wir hinzu, wer angenommen hat (falls sichtbar)
        if status_filter == 'pending' and offer.accepted_by_user:
            data['accepted_by_name'] = f"{offer.accepted_by_user.vorname} {offer.accepted_by_user.name}"

        results.append(data)

    return jsonify(results), 200


@market_bp.route('/offer/<int:offer_id>/react', methods=['POST'])
@login_required
def react_to_offer(offer_id):
    """
    Kandidat bekundet Interesse oder lehnt ab.
    """
    if not _is_allowed():
        return jsonify({"message": "Zugriff verweigert"}), 403

    offer = db.session.get(ShiftMarketOffer, offer_id)
    if not offer or offer.status != 'active':
        return jsonify({"message": "Angebot nicht verfügbar."}), 400

    if offer.offering_user_id == current_user.id:
        return jsonify({"message": "Eigene Angebote können nicht kommentiert werden."}), 400

    data = request.get_json()
    response_type = data.get('response_type')  # 'interested' or 'declined'
    note = data.get('note', '')

    if response_type not in ['interested', 'declined']:
        return jsonify({"message": "Ungültiger Status."}), 400

    # Bestehende Antwort prüfen/aktualisieren
    existing = ShiftMarketResponse.query.filter_by(offer_id=offer_id, user_id=current_user.id).first()
    if existing:
        existing.response_type = response_type
        existing.note = note
        existing.created_at = datetime.utcnow()
    else:
        new_resp = ShiftMarketResponse(
            offer_id=offer_id,
            user_id=current_user.id,
            response_type=response_type,
            note=note
        )
        db.session.add(new_resp)

    db.session.commit()

    # Check: Wenn abgelehnt, prüfen ob alle abgelehnt haben -> Archivieren
    if response_type == 'declined':
        MarketService.check_and_archive_if_all_declined(offer_id)

    return jsonify({"message": "Reaktion gespeichert."}), 200


@market_bp.route('/offer/<int:offer_id>/responses', methods=['GET'])
@login_required
def get_offer_responses(offer_id):
    """
    Für den Besitzer: Liste der Reaktionen laden.
    """
    offer = db.session.get(ShiftMarketOffer, offer_id)
    if not offer:
        return jsonify({"message": "Nicht gefunden"}), 404

    # Nur Besitzer oder Admin darf das sehen
    if offer.offering_user_id != current_user.id and current_user.role.name != 'admin':
        return jsonify({"message": "Zugriff verweigert"}), 403

    responses = ShiftMarketResponse.query.filter_by(offer_id=offer_id).all()
    # Sortieren: Interessierte zuerst
    responses.sort(key=lambda x: (0 if x.response_type == 'interested' else 1, x.created_at))

    return jsonify([r.to_dict() for r in responses]), 200


@market_bp.route('/offer/<int:offer_id>/select_candidate', methods=['POST'])
@login_required
def select_candidate(offer_id):
    """
    Besitzer wählt einen Kandidaten aus -> Startet den Tauschprozess.
    Erstellt einen ChangeRequest und setzt Offer auf pending.
    """
    data = request.get_json()
    candidate_id = data.get('candidate_id')

    offer = db.session.get(ShiftMarketOffer, offer_id)
    if not offer or offer.status != 'active':
        return jsonify({"message": "Angebot nicht verfügbar."}), 400

    if offer.offering_user_id != current_user.id:
        return jsonify({"message": "Nur der Anbieter kann einen Kandidaten auswählen."}), 403

    # Kandidaten User laden
    candidate = db.session.get(User, candidate_id)
    if not candidate:
        return jsonify({"message": "Kandidat nicht gefunden."}), 404

    # Status Update
    offer.status = 'pending'
    offer.accepted_by_id = candidate_id
    offer.accepted_at = datetime.utcnow()

    # Change Request erstellen
    res, code = ShiftChangeService.create_request(
        shift_id=offer.shift_id,
        requester_id=offer.offering_user_id,
        replacement_user_id=candidate_id,
        note=f"Marktplatz Match: {offer.offering_user.name} -> {candidate.name}. Notiz: {offer.note}",
        reason_type='trade'
    )

    if code not in [200, 201]:
        db.session.rollback()
        return jsonify(res), code

    db.session.commit()
    return jsonify({"message": f"Tausch mit {candidate.vorname} {candidate.name} eingeleitet! Warte auf Admin."}), 200


@market_bp.route('/history', methods=['GET'])
@login_required
def get_market_history():
    if not _is_allowed():
        return jsonify({"message": "Zugriff verweigert."}), 403

    try:
        limit = request.args.get('limit', 50, type=int)
        history = MarketService.get_market_history(limit)
        return jsonify(history), 200
    except Exception as e:
        return jsonify({"message": f"Fehler beim Laden der Historie: {str(e)}"}), 500


@market_bp.route('/history/<int:offer_id>', methods=['DELETE'])
@admin_required
def delete_history_entry(offer_id):
    success, msg = MarketService.delete_history_entry(offer_id)
    if success:
        return jsonify({"message": msg}), 200
    else:
        return jsonify({"message": msg}), 400


@market_bp.route('/offer/<int:offer_id>/candidates', methods=['GET'])
@login_required
def get_offer_candidates(offer_id):
    if not _is_allowed():
        return jsonify({"message": "Zugriff verweigert."}), 403

    try:
        candidates = MarketService.get_potential_candidates(offer_id)
        return jsonify(candidates), 200
    except Exception as e:
        return jsonify({"message": f"Fehler bei Kandidatensuche: {str(e)}"}), 500


@market_bp.route('/offer', methods=['POST'])
@login_required
def create_market_offer():
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

    if shift.variant_id is not None:
        return jsonify(
            {"message": "Schichten aus Varianten/Entwürfen können nicht in der Tauschbörse angeboten werden."}), 400

    if shift.date < date.today():
        return jsonify({"message": "Vergangene Schichten können nicht getauscht werden."}), 400

    ALLOWED_MARKET_SHIFTS = ['T.', 'N.', '6', '24', 'S', 'QA']
    if not shift.shift_type or shift.shift_type.abbreviation not in ALLOWED_MARKET_SHIFTS:
        return jsonify({"message": f"Diese Schichtart darf nicht getauscht werden."}), 400

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