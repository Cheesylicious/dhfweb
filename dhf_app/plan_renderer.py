import logging
import imgkit
import os
import base64
from .data_processor import process_roster_data
from .html_generator import generate_roster_html

# Logging konfigurieren
logger = logging.getLogger(__name__)


def generate_roster_image_bytes(employees_list, shifts_raw_list, month=None, year=None):
    """
    Orchestrierende Funktion:
    1. Daten verarbeiten
    2. HTML generieren
    3. HTML zu JPG konvertieren (High Res)
    4. Bytes zurückgeben

    Args:
        employees_list: Liste der Mitarbeiter
        shifts_raw_list: Rohdaten der Schichten
        month: Der Monat (int oder str), optional
        year: Das Jahr (int oder str), optional
    """
    try:
        # 1. Daten aufbereiten (nutzt data_processor.py)
        # Verhindert den 'list object has no attribute get' Fehler durch korrekte Verarbeitung
        formatted_data = process_roster_data(employees_list, shifts_raw_list)

        if not formatted_data:
            logger.warning("[PlanRenderer] Keine Daten zum Rendern vorhanden.")
            return None

        # 2. HTML als Matrix/Raster erstellen (nutzt html_generator.py)
        # Wir geben jetzt Monat und Jahr weiter, damit der Titel im Bild stimmt
        html_content = generate_roster_html(formatted_data, month, year)

        # 3. Konfiguration für imgkit (wkhtmltoimage Wrapper)
        # WICHTIG: Hohe Breite setzen, damit die Tabelle lesbar ist und nicht umbricht
        options = {
            'format': 'jpg',
            'encoding': "UTF-8",
            'quality': '100',  # Maximale JPG Qualität
            'width': '2480',  # Breite ca. wie A4 Querformat in High DPI
            'disable-smart-width': '',  # Verhindert automatische Skalierung
            'quiet': ''  # Unterdrückt Konsolen-Output von wkhtmltoimage
        }

        # imgkit.from_string gibt bytes zurück, wenn output_path=False
        img_bytes = imgkit.from_string(html_content, False, options=options)

        logger.info(f"[PlanRenderer] Bild erfolgreich generiert ({len(img_bytes)} bytes).")
        return img_bytes

    except Exception as e:
        logger.error(f"[PlanRenderer] FEHLER beim Rendern des Bildes: {str(e)}", exc_info=True)
        return None