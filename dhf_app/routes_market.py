# dhf_app/routes_market.py

from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user
from datetime import datetime, date, timedelta
from .extensions import db
from .models import Shift, ShiftType, User
from .models_market import ShiftMarketOffer
from .services_shift_change import ShiftChangeService
# NEU: Import des neuen MarketService und Admin-Check
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


def _check_overlap(st1, st2):
    """
    Hilfsfunktion: Prüft, ob sich zwei Schichtarten zeitlich überschneiden.
    Erwartet ShiftType-Objekte.
    (Wird weiterhin für die direkte Prüfung beim Annehmen benötigt)
    """
    if not st1 or not st2: return False
    if not st1.start_time or not st1.end_time or not st2.start_time or not st2.end_time:
        return False  # Keine Zeiten definiert (z.B. Urlaub)

    try:
        def to_min(t_str):
            h, m = map(int, t_str.split(':'))
            return h * 60 + m

        s1, e1 = to_min(st1.start_time), to_min(st1.end_time)
        s2, e2 = to_min(st2.start_time), to_min(st2.end_time)

        # Nachtschicht-Handling (Ende < Start bedeutet Folgetag)
        if e1 <= s1: e1 += 24 * 60
        if e2 <= s2: e2 += 24 * 60

        # Überlappung: Start1 < Ende2 UND Start2 < Ende1
        return s1 < e2 and s2 < e1
    except:
        return False


@market_bp.route('/offers', methods=['GET'])
@login_required
def get_market_offers():
    """
    Liefert Angebote zurück.
    Parameter 'status' steuert, welche Angebote geladen werden (active, pending, own).
    """
    if not _is_allowed():
        return jsonify({"message": "Zugriff verweigert."}), 403

    # Filter auslesen (Default: active)
    status_filter = request.args.get('status', 'active')

    query = ShiftMarketOffer.query.join(Shift).filter(
        Shift.variant_id == None  # <--- NUR HAUPTPLAN
    )

    if status_filter == 'own':
        # Eigene Angebote (egal welcher Status, außer gelöscht)
        query = query.filter(ShiftMarketOffer.offering_user_id == current_user.id)
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

        # Für Pending-Angebote fügen wir hinzu, wer angenommen hat (falls sichtbar)
        if status_filter == 'pending' and offer.accepted_by_user:
            data['accepted_by_name'] = f"{offer.accepted_by_user.vorname} {offer.accepted_by_user.name}"

        results.append(data)

    return jsonify(results), 200


@market_bp.route('/history', methods=['GET'])
@login_required
def get_market_history():
    """
    NEU: Liefert die Historie der Tauschbörse.
    """
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
    """
    NEU: Löscht einen Eintrag aus der Historie (Admin only).
    """
    success, msg = MarketService.delete_history_entry(offer_id)
    if success:
        return jsonify({"message": msg}), 200
    else:
        return jsonify({"message": msg}), 400


@market_bp.route('/offer/<int:offer_id>/candidates', methods=['GET'])
@login_required
def get_offer_candidates(offer_id):
    """
    NEU: Liefert potenzielle Kandidaten für ein Angebot.
    """
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
    """
    Erstellt ein neues Angebot (Schicht in die Börse stellen).
    NEU: Verhindert Erstellung für Varianten.
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

    # --- WICHTIG: Tauschbörse nur für Hauptplan ---
    if shift.variant_id is not None:
        return jsonify(
            {"message": "Schichten aus Varianten/Entwürfen können nicht in der Tauschbörse angeboten werden."}), 400

    # --- 1. Zeit-Check ---
    if shift.date < date.today():
        return jsonify({"message": "Vergangene Schichten können nicht getauscht werden."}), 400

    # --- 2. Whitelist-Check ---
    ALLOWED_MARKET_SHIFTS = ['T.', 'N.', '6', '24', 'S', 'QA']  # Erweitert falls nötig

    if not shift.shift_type:
        return jsonify({"message": "Schicht-Typ konnte nicht ermittelt werden."}), 400

    if shift.shift_type.abbreviation not in ALLOWED_MARKET_SHIFTS:
        return jsonify({
            "message": f"Diese Schichtart darf nicht getauscht werden."
        }), 400

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
    Führt Konfliktprüfungen durch (Ruhezeiten, Hundedopperlung).
    WICHTIG: Prüft NUR im Kontext der aktuellen Variante (meistens Hauptplan).
    """
    if not _is_allowed():
        return jsonify({"message": "Zugriff verweigert."}), 403

    offer = db.session.get(ShiftMarketOffer, offer_id)
    if not offer:
        return jsonify({"message": "Angebot nicht gefunden."}), 404

    if offer.status != 'active':
        return jsonify({"message": "Angebot ist leider schon weg oder nicht mehr verfügbar."}), 400

    if offer.shift.date < date.today():
        return jsonify({"message": "Diese Schicht liegt in der Vergangenheit."}), 400

    if offer.offering_user_id == current_user.id:
        return jsonify({"message": "Sie können Ihr eigenes Angebot nicht selbst annehmen."}), 400

    target_date = offer.shift.date
    target_shift_type = offer.shift.shift_type

    # --- WICHTIG: Wir holen uns die Variante der angebotenen Schicht ---
    # Wenn die Schicht im Hauptplan ist, ist variant_id None.
    # Wir prüfen Konflikte NUR gegen Schichten mit derselben variant_id.
    target_variant_id = offer.shift.variant_id

    if target_variant_id is not None:
        # Sollte durch create_market_offer verhindert sein, aber sicher ist sicher.
        return jsonify({"message": "Fehler: Angebot gehört zu einer Variante."}), 400

    # --- 1. Doppelbelegungs-Check (User hat schon was im HAUPTPLAN?) ---
    existing_shift = Shift.query.filter_by(
        user_id=current_user.id,
        date=target_date,
        variant_id=target_variant_id  # <--- FIX: Nur im gleichen Plan prüfen (None)
    ).first()

    if existing_shift and existing_shift.shifttype_id is not None:
        return jsonify({
            "message": f"Nicht möglich: Sie haben am {target_date.strftime('%d.%m.%Y')} bereits einen Dienst eingetragen!"
        }), 409

    # --- 2. Ruhezeit-Check (N. -> T.) ---
    # Prüfe den Tag DAVOR
    prev_date = target_date - timedelta(days=1)

    # <--- FIX: Nur im gleichen Plan prüfen
    prev_shift = Shift.query.filter_by(
        user_id=current_user.id,
        date=prev_date,
        variant_id=target_variant_id
    ).first()

    if prev_shift and prev_shift.shift_type and target_shift_type:
        # Wenn Gestern = Nacht und Heute = Tag
        if prev_shift.shift_type.abbreviation == 'N.' and target_shift_type.abbreviation in ['T.', '6', 'S', 'QA']:
            return jsonify({
                "message": "Konflikt: Ruhezeitverletzung! Sie können keine Tag-Schicht direkt nach einer Nachtschicht übernehmen."
            }), 409

    # --- 3. Diensthund-Check (Doppelbelegung des Hundes) ---
    if current_user.diensthund and current_user.diensthund != '---' and target_shift_type:
        # Suche alle Schichten am Zieltag, wo der User denselben Hund hat (außer mir selbst)
        # <--- FIX: Nur im gleichen Plan prüfen (variant_id)
        same_dog_shifts = db.session.query(Shift).join(User).filter(
            Shift.date == target_date,
            User.diensthund == current_user.diensthund,
            User.id != current_user.id,
            Shift.shifttype_id != None,
            Shift.variant_id == target_variant_id  # <--- HIER WERDEN DIE GEISTER-SCHICHTEN RAUSGEFILTERT
        ).all()

        for other_s in same_dog_shifts:
            # Prüfe Zeitüberlappung mit diesem Kollegen
            if other_s.shift_type and _check_overlap(target_shift_type, other_s.shift_type):
                return jsonify({
                    "message": f"Konflikt: Ihr Diensthund '{current_user.diensthund}' ist an diesem Tag bereits durch {other_s.user.vorname} {other_s.user.name} im Einsatz ({other_s.shift_type.abbreviation})."
                }), 409

    # --- OK: Tausch durchführen (Antrag erstellen) ---
    try:
        offer.status = 'pending'
        offer.accepted_by_id = current_user.id
        offer.accepted_at = datetime.utcnow()

        # Automatischen Änderungsantrag erstellen
        service_result, status_code = ShiftChangeService.create_request(
            shift_id=offer.shift_id,
            requester_id=offer.offering_user_id,
            replacement_user_id=current_user.id,
            note=f"Marktplatz-Deal (Angebot #{offer.id}): {offer.note}",
            reason_type='trade'
        )

        if status_code != 201 and status_code != 200:  # 200 ist bei Auto-Approve auch ok
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