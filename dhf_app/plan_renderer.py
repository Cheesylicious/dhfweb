import imgkit
from flask import render_template, current_app
import locale
import os
import uuid
import shutil
from .models import GlobalSetting

# Versuchen, deutsche Datumsformate zu setzen
try:
    locale.setlocale(locale.LC_TIME, 'de_DE.UTF-8')
except locale.Error:
    pass


def generate_roster_image_bytes(render_data, year, month):
    """
    Generiert ein für Smartphones optimiertes Bild des Dienstplans (MATRIX-ANSICHT).
    Die Konfiguration (Größe, Zoom, Farben) wird aus der Datenbank geladen.
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

        # --- EINSTELLUNGEN LADEN ---

        # NEUE STANDARDWERTE FÜR MAXIMALE QUALITÄT
        img_settings = {
            # Dimensionen (Erhöht für Schärfe)
            'img_width': '3800',  # Breiter, da Zoom höher ist
            'img_zoom': '3.0',  # Verdreifachte Auflösung für gestochen scharfen Zoom
            'img_quality': '100',  # Maximale JPG Qualität

            # Farben (Defaults)
            'img_header_bg': '#e0e0e0',
            'img_user_row_bg': '#f0f0f0',
            'img_weekend_bg': '#ffd6d6',
            'img_holiday_bg': '#ffddaa',
            'img_training_bg': '#ff00ff',
            'img_shooting_bg': '#e2e600',
            'img_dpo_border': '#ff0000',
            'img_staffing_ok': '#d4edda',
            'img_staffing_warn': '#fff3cd',
            'img_staffing_err': '#ffcccc',
            'img_self_row_bg': '#eaf2ff'
        }

        try:
            # Versuche, gespeicherte Werte zu laden
            saved_settings = GlobalSetting.query.filter(GlobalSetting.key.in_(img_settings.keys())).all()
            for s in saved_settings:
                if s.value:
                    img_settings[s.key] = s.value
        except Exception as e:
            current_app.logger.warning(f"[PlanRenderer] Konnte Einstellungen nicht laden, nutze Defaults: {e}")

        # Konfiguration in render_data injizieren, damit das Template Zugriff hat
        render_data['config'] = img_settings

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

        options = {
            'format': 'jpg',
            'quality': img_settings['img_quality'],
            'encoding': "UTF-8",
            'width': img_settings['img_width'],
            'disable-smart-width': '',
            'zoom': img_settings['img_zoom'],
            'quiet': '',
            'enable-local-file-access': ''
        }

        # 5. Bild generieren
        imgkit.from_string(html_content, temp_path, options=options, config=config)

        # 6. Datei einlesen
        with open(temp_path, 'rb') as f:
            image_bytes = f.read()

        file_size = len(image_bytes)
        current_app.logger.info(f"[PlanRenderer] Bild generiert ({file_size} bytes). Config: {img_settings}")

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