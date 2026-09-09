import ssl
import sys
import os

# --- FIX START: Fehlende Funktion für Python 3.12 simulieren ---
if not hasattr(ssl, 'wrap_socket'):
    def dummy_wrap_socket(sock, keyfile=None, certfile=None,
                          server_side=False, cert_reqs=ssl.CERT_NONE,
                          ssl_version=ssl.PROTOCOL_TLS, ca_certs=None,
                          do_handshake_on_connect=True,
                          suppress_ragged_eofs=True,
                          ciphers=None):
        context = ssl.SSLContext(ssl_version)
        if certfile: context.load_cert_chain(certfile, keyfile)
        if ca_certs: context.load_verify_locations(ca_certs)
        context.verify_mode = cert_reqs
        if ciphers: context.set_ciphers(ciphers)
        return context.wrap_socket(
            sock, server_side=server_side,
            do_handshake_on_connect=do_handshake_on_connect,
            suppress_ragged_eofs=suppress_ragged_eofs
        )
    ssl.wrap_socket = dummy_wrap_socket
# --- FIX ENDE ---

# Pfad hinzufügen, damit Module gefunden werden
sys.path.append(os.getcwd())

from dhf_app import create_app, db
# WICHTIG: Das Modell muss importiert sein, damit SQLAlchemy es kennt
from dhf_app.models_shift_change import ShiftChangeRequest

app = create_app()

print("="*40)
print("Prüfe Datenbank-Tabellen...")
print("="*40)

with app.app_context():
    try:
        # Versucht, alle noch nicht existierenden Tabellen zu erstellen
        db.create_all()
        print("SUCCESS: Befehl 'db.create_all()' ausgeführt.")
        
        # Prüfen, ob die Tabelle jetzt wirklich existiert
        inspector = db.inspect(db.engine)
        tables = inspector.get_table_names()
        
        if 'shift_change_requests' in tables:
            print("OK: Tabelle 'shift_change_requests' wurde erfolgreich erstellt!")
        else:
            print("FEHLER: Tabelle 'shift_change_requests' fehlt immer noch!")
            print("Vorhandene Tabellen:", tables)

    except Exception as e:
        print(f"KRITISCHER FEHLER: {e}")

print("="*40)
