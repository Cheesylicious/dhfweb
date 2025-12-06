import imgkit
from flask import render_template, current_app
import locale
import os
import uuid

# Versuchen, deutsche Datumsformate zu setzen
try:
    locale.setlocale(locale.LC_TIME, 'de_DE.UTF-8')
except locale.Error:
    pass


def generate_roster_image_bytes(grouped_shifts, year, month):
    """
    Generiert ein für Smartphones optimiertes Bild des Dienstplans.
    Nutzt JPG-Kompression, um die Dateigröße drastisch zu reduzieren.
    """

    # 1. Pfad-Fix für Systemd
    os.environ['PATH'] = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:" + os.environ.get('PATH', '')

    # 2. Temporärer Dateiname (jetzt als JPG)
    temp_filename = f"roster_{uuid.uuid4()}.jpg"
    temp_path = os.path.join('/tmp', temp_filename)

    try:
        # Monat als Name
        month_name = locale.nl_langinfo(locale.MON_1 + month - 1) if hasattr(locale, 'nl_langinfo') else f"{month:02d}"
    except:
        month_name = f"{month:02d}"

    try:
        # 3. HTML rendern
        html_content = render_template(
            'email_plan_mobile.html',
            grouped_shifts=grouped_shifts,
            year=year,
            month_name=month_name
        )

        # 4. imgkit Konfiguration (Auf JPG umgestellt)
        options = {
            'format': 'jpg',  # WICHTIG: JPG statt PNG spart 95% Speicherplatz
            'quality': '70',  # Gute Lesbarkeit, kleine Datei
            'encoding': "UTF-8",
            'width': '600',
            'disable-smart-width': '',
            'quiet': '',
            'enable-local-file-access': ''
        }

        # Wrapper-Skript Pfad
        wkhtml_path = '/usr/local/bin/wkhtmltoimage-xvfb'
        if not os.path.exists(wkhtml_path):
            current_app.logger.warning(f"[PlanRenderer] Wrapper {wkhtml_path} fehlt! Nutze Standard.")
            wkhtml_path = '/usr/bin/wkhtmltoimage'

        config = imgkit.config(wkhtmltoimage=wkhtml_path)

        current_app.logger.info(f"[PlanRenderer] Generiere JPG nach: {temp_path}")

        # 5. Bild generieren (in Datei speichern)
        imgkit.from_string(html_content, temp_path, options=options, config=config)

        # 6. Datei einlesen
        with open(temp_path, 'rb') as f:
            image_bytes = f.read()

        file_size = len(image_bytes)
        current_app.logger.info(f"[PlanRenderer] Bild erfolgreich geladen ({file_size} bytes).")

        # Sicherheitscheck (Limit auf 15MB erhöht, aber JPG sollte < 1MB sein)
        if file_size > 15 * 1024 * 1024:
            current_app.logger.error(
                f"[PlanRenderer] ALARM: Bild ist immer noch riesig ({file_size} bytes). Wird nicht gesendet.")
            return None

        return image_bytes

    except Exception as e:
        current_app.logger.error(f"[PlanRenderer] FEHLER: {str(e)}")
        if "127" in str(e):
            current_app.logger.error("[PlanRenderer] HINWEIS: Wrapper-Skript wurde nicht gefunden.")
        return None

    finally:
        # 7. Aufräumen
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass