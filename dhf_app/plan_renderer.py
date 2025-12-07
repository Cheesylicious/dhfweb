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
    Generiert ein für Smartphones optimiertes Bild des Dienstplans.
    Lädt Konfiguration aus der DB für Farben und Größe.
    """

    # 1. Pfad-Fix
    os.environ['PATH'] = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:" + os.environ.get('PATH', '')

    # 2. Temp File
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

        # --- CONFIG LADEN ---
        img_settings = {
            'img_width': '2800',
            'img_zoom': '1.5',
            'img_quality': '85',
            # Default Farben (passend zum Web-Design)
            'img_header_bg': '#e0e0e0',
            'img_user_row_bg': '#f0f0f0',
            'img_weekend_bg': '#ffd6d6',
            'img_holiday_bg': '#ffddaa',
            'img_training_bg': '#ff00ff',
            'img_shooting_bg': '#e2e600',
            'img_dpo_border': '#ff0000'
        }

        try:
            saved_settings = GlobalSetting.query.filter(GlobalSetting.key.in_(img_settings.keys())).all()
            for s in saved_settings:
                if s.value:
                    img_settings[s.key] = s.value
        except Exception as e:
            current_app.logger.warning(f"[PlanRenderer] Settings-Fehler, nutze Defaults: {e}")

        # Config ins Template geben
        render_data['config'] = img_settings

        # 3. HTML rendern
        html_content = render_template(
            'email_plan_mobile.html',
            data=render_data
        )

        # 4. imgkit
        wkhtml_path = shutil.which('wkhtmltoimage')
        if not wkhtml_path:
            # Fallbacks für verschiedene Server-Umgebungen
            potential = ['/usr/local/bin/wkhtmltoimage-xvfb', '/usr/bin/wkhtmltoimage', '/usr/local/bin/wkhtmltoimage']
            for p in potential:
                if os.path.exists(p):
                    wkhtml_path = p
                    break

        if not wkhtml_path:
            current_app.logger.error("wkhtmltoimage nicht gefunden!")
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

        # 5. Generieren
        imgkit.from_string(html_content, temp_path, options=options, config=config)

        # 6. Lesen
        with open(temp_path, 'rb') as f:
            image_bytes = f.read()

        return image_bytes

    except Exception as e:
        current_app.logger.error(f"[PlanRenderer] Fehler: {str(e)}")
        return None

    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except:
                pass