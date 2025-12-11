from flask import Blueprint, jsonify, request
from flask_login import current_user
from dhf_app.services_shop import ShopService
from dhf_app.utils import login_required, admin_required

shop_bp = Blueprint('shop', __name__)


@shop_bp.route('/api/shop/items', methods=['GET'])
@login_required
def get_items():
    """
    Liefert alle Shop-Items und die aktiven Effekte.
    FIX: Holen Sie ALLE Items (include_inactive=True), damit Benutzer den Grund sehen.
    """
    try:
        user_id = current_user.id
        is_admin = current_user.role and current_user.role.name == 'admin'

        # KRITISCHE KORREKTUR: Wir rufen immer alle Items ab (True), damit auch deaktivierte Items im Frontend sichtbar sind.
        items = ShopService.get_all_items(include_inactive=True)
        active_effects = ShopService.get_user_active_effects(user_id)

        return jsonify({
            "items": items,
            "active_effects": active_effects,
            "is_admin": is_admin
        }), 200
    except Exception as e:
        print(f"Fehler beim Laden der Shop-Items: {e}")
        return jsonify({"message": f"Interner Fehler beim Laden des Shops: {e}"}), 500


@shop_bp.route('/api/shop/buy', methods=['POST'])
@login_required
def buy_item():
    data = request.json
    item_id = data.get('item_id')
    user_id = current_user.id

    if not item_id:
        return jsonify({"success": False, "message": "Item ID fehlt."}), 400

    result = ShopService.buy_item(user_id, item_id)
    if result['success']:
        return jsonify(result), 200
    else:
        return jsonify(result), 400


@shop_bp.route('/api/shop/update_price', methods=['POST'])
@login_required
@admin_required
def update_price():
    """
    Erlaubt Admins, den Preis eines Shop-Items zu aktualisieren.
    """
    data = request.json
    item_id = data.get('item_id')
    new_price = data.get('new_price')
    admin_user_id = current_user.id

    if not item_id or new_price is None:
        return jsonify({"success": False, "message": "Item ID oder neuer Preis fehlt."}), 400

    result = ShopService.update_item_price(item_id, new_price, admin_user_id)
    return jsonify(result)


@shop_bp.route('/api/shop/toggle_active', methods=['POST'])
@login_required
@admin_required
def toggle_item_active():
    """
    Admin-Funktion zum Aktivieren oder Deaktivieren eines Shop-Items.
    """
    data = request.json
    item_id = data.get('item_id')
    is_active = data.get('is_active', False)  # Erwartet Boolean
    message = data.get('message', '')  # Nachricht für den Grund

    if item_id is None:
        return jsonify({"success": False, "message": "Item ID fehlt."}), 400

    result = ShopService.toggle_item_active_status(item_id, is_active, message)
    return jsonify(result)