# dhf_app/routes_email_preview.py

from flask import Blueprint, request, Response, current_app
from .utils import admin_required
from .roster_logic import prepare_roster_render_data
from .plan_renderer import generate_roster_image_bytes
from datetime import datetime

# Blueprint für die E-Mail-Vorschau (Regel 4)
preview_bp = Blueprint('email_preview', __name__, url_prefix='/api/emails/preview')


@preview_bp.route('/roster_image', methods=['GET'])
@admin_required
def get_roster_preview_image():
    """
    Generiert ein aktuelles Dienstplan-Bild als Live-Vorschau für den Admin-Bereich.
    Nutzt die zentrale Logik, um exakt das Bild zu zeigen, das auch versendet wird.
    """
    now = datetime.now()
    # Standardmäßig wird der aktuelle Monat genommen, falls nichts übergeben wird
    year = request.args.get('year', now.year, type=int)
    month = request.args.get('month', now.month, type=int)

    try:
        # 1. Daten über die zentrale Logik-Datei aufbereiten (Regel 1 & 4)
        render_data = prepare_roster_render_data(year, month)

        # 2. Ein spezielles Highlight für die Vorschau setzen
        render_data['highlight_user_name'] = "VORSCHAU"

        # 3. Bild-Bytes generieren
        image_bytes = generate_roster_image_bytes(render_data, year, month)

        if not image_bytes:
            current_app.logger.error("[Preview] Bildgenerierung fehlgeschlagen.")
            return "Fehler bei der Bildgenerierung", 500

        # 4. Bild direkt als JPEG-Stream zurückgeben
        return Response(image_bytes, mimetype='image/jpeg')

    except Exception as e:
        current_app.logger.error(f"[Preview Error] {str(e)}")
        return f"Interner Fehler: {str(e)}", 500