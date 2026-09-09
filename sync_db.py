from app import app
from dhf_app.extensions import db
from sqlalchemy import text

with app.app_context():
    print("Starte Datenbank-Update für planer.db...")
    
    # 1. Spalte für Fehlversuche
    try:
        db.session.execute(text("ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER DEFAULT 0 NOT NULL"))
        print("✓ Spalte 'failed_login_attempts' hinzugefügt.")
    except Exception as e:
        print(f"info: 'failed_login_attempts' existiert evtl. schon: {e}")

    # 2. Spalte für den Zeitstempel (Timer)
    try:
        db.session.execute(text("ALTER TABLE users ADD COLUMN last_failed_login DATETIME"))
        print("✓ Spalte 'last_failed_login' hinzugefügt.")
    except Exception as e:
        print(f"info: 'last_failed_login' existiert evtl. schon: {e}")

    db.session.commit()
    print("Datenbank-Update erfolgreich abgeschlossen.")
