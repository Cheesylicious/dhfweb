import sys
import os
import datetime
import imgkit
from sqlalchemy import extract
from flask_mail import Message

# Pfad zur App finden
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

try:
    # Laden der App-Infrastruktur
    from dhf_app import create_app
    from dhf_app.extensions import db, mail
    from dhf_app.models import User, Shift
except ImportError as e:
    print(f"FEHLER: App konnte nicht geladen werden: {e}")
    sys.exit(1)

from data_processor import process_roster_data
from html_generator import generate_roster_html


def run_export_job():
    # 1. App-Kontext starten (lädt Datenbank & E-Mail-Settings)
    app = create_app()

    with app.app_context():
        # --- ZEITRAUM BESTIMMEN ---
        heute = datetime.date.today()
        # Logik: Wenn wir nach dem 20. sind, planen wir für den NÄCHSTEN Monat
        if heute.day > 20:
            ziel_datum = heute.replace(day=28) + datetime.timedelta(days=4)  # Sprung in nächsten Monat
            YEAR = ziel_datum.year
            MONTH = ziel_datum.month
        else:
            # Sonst nehmen wir den aktuellen
            YEAR = heute.year
            MONTH = heute.month

        print(f"--- Starte Export für {MONTH}/{YEAR} ---")

        # --- DATEN HOLEN ---
        # Alle aktiven User mit E-Mail
        users = User.query.filter(
            User.shift_plan_visible == True,
            User.email != None,
            User.email != ""
        ).all()

        # Schichten laden
        shifts_db = Shift.query.filter(
            extract('year', Shift.date) == YEAR,
            extract('month', Shift.date) == MONTH
        ).all()

        # Daten aufbereiten (für das Bild)
        employees_list = [{'id': u.id, 'name': f"{u.vorname} {u.name}", 'is_active': True} for u in users]
        shifts_dict = {}
        for s in shifts_db:
            if not s.shift_type: continue
            if s.user_id not in shifts_dict: shifts_dict[s.user_id] = []

            time_str = f"{s.shift_type.start_time}-{s.shift_type.end_time}" if s.shift_type.start_time else ""
            shifts_dict[s.user_id].append({
                'date': s.date,
                'time': time_str,
                'location': s.shift_type.abbreviation
            })

        # --- BILD GENERIEREN ---
        final_data = process_roster_data(employees_list, shifts_dict)
        html_source = generate_roster_html(final_data)

        filename = f"dienstplan_{YEAR}_{MONTH:02d}.png"
        options = {'format': 'png', 'encoding': "UTF-8", 'width': 450, 'quiet': ''}

        try:
            # Pfad zu wkhtmltoimage explizit setzen (hilft bei Cronjobs)
            config = imgkit.config(wkhtmltoimage='/usr/bin/wkhtmltoimage')
            imgkit.from_string(html_source, filename, options=options, config=config)
            print(f"Bild erstellt: {filename}")
        except Exception as e:
            print(f"Fehler bei Bildgenerierung: {e}")
            return

        # --- E-MAIL VERSAND ---
        print(f"Sende E-Mails an {len(users)} Mitarbeiter...")

        with open(filename, "rb") as f:
            img_data = f.read()

        for user in users:
            try:
                msg = Message(
                    subject=f"Dienstplan für {MONTH}/{YEAR}",
                    sender=app.config.get('MAIL_DEFAULT_SENDER'),
                    recipients=[user.email]
                )
                msg.body = f"Hallo {user.vorname},\n\nanbei der aktuelle Dienstplan für den kommenden Monat.\n\nViele Grüße,\nDHF-Planer"

                # Bild anhängen
                msg.attach(filename, "image/png", img_data)

                mail.send(msg)
                print(f" -> Gesendet an: {user.email}")
            except Exception as e:
                print(f" -> Fehler bei {user.email}: {e}")

        print("--- Fertig ---")


if __name__ == "__main__":
    run_export_job()