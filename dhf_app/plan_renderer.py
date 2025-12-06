import imgkit
from flask import render_template, current_app
import locale
import os
import uuid
import shutil

# Versuchen, deutsche Datumsformate zu setzen
try:
    locale.setlocale(locale.LC_TIME, 'de_DE.UTF-8')
except locale.Error:
    pass


def generate_roster_image_bytes(render_data, year, month):
    """
    Generiert ein für Smartphones optimiertes Bild des Dienstplans (MATRIX-ANSICHT).
    """

    # 1. Pfad-Fix für Systemd / Umgebung
    os.environ['PATH'] = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:" + os.environ.get('PATH', '')

    # 2. Temporärer Dateiname (JPG)
    temp_filename = f"roster_{uuid.uuid4()}.jpg"
    temp_path = os.path.join('/tmp', temp_filename)

    try:
        # Monat als Name
        if 'month_name' not in render_data:
            try:
                render_data['month_name'] = locale.nl_langinfo(locale.MON_1 + month - 1) if hasattr(locale,
                                                                                                    'nl_langinfo') else f"{month:02d}"
            except:
                render_data['month_name'] = f"{month:02d}"

        # 3. HTML rendern
        html_content = render_template(
            'email_plan_mobile.html',
            data=render_data
        )

        # 4. imgkit Konfiguration
        wkhtml_path = shutil.which('wkhtmltoimage')

        # Fallbacks
        if not wkhtml_path:
            potential_paths = ['/usr/local/bin/wkhtmltoimage-xvfb', '/usr/bin/wkhtmltoimage',
                               '/usr/local/bin/wkhtmltoimage']
            for p in potential_paths:
                if os.path.exists(p):
                    wkhtml_path = p
                    break

        if not wkhtml_path:
            current_app.logger.error("[PlanRenderer] CRITICAL: 'wkhtmltoimage' nicht gefunden!")
            return None

        config = imgkit.config(wkhtmltoimage=wkhtml_path)

        # WICHTIG: Breite massiv erhöht, damit Tag 31 nicht abgeschnitten wird
        options = {
            'format': 'jpg',
            'quality': '85',
            'encoding': "UTF-8",
            'width': '2800',  # Erhöht auf 2800px für Sicherheit bei 31 Tagen
            'disable-smart-width': '',
            'zoom': '1.5',  # Zoom erhöht für bessere Lesbarkeit auf Mobile
            'quiet': '',
            'enable-local-file-access': ''
        }

        # 5. Bild generieren
        imgkit.from_string(html_content, temp_path, options=options, config=config)

        # 6. Datei einlesen
        with open(temp_path, 'rb') as f:
            image_bytes = f.read()

        file_size = len(image_bytes)
        current_app.logger.info(f"[PlanRenderer] Bild generiert ({file_size} bytes).")

        return image_bytes

    except Exception as e:
        current_app.logger.error(f"[PlanRenderer] FEHLER bei Bildgenerierung: {str(e)}")
        return None

    finally:
        # 7. Aufräumen
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass