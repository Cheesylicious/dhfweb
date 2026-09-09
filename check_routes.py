import ssl
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

from dhf_app import create_app
import sys

print("\n" + "="*50)
print("DIAGNOSE GESTARTET...")
print("="*50)

try:
    app = create_app()
    print("App erfolgreich geladen. Prüfe Routen...\n")
    
    found = False
    for rule in app.url_map.iter_rules():
        rule_str = str(rule)
        # Wir suchen nach allem, was 'shift' oder 'request' enthält
        if "shift" in rule_str or "request" in rule_str:
            print(f"GEFUNDEN: {rule_str:<40} -> Endpunkt: {rule.endpoint}")
            found = True
            
    if not found:
        print("WARNUNG: Keine Route mit 'shift' oder 'request' gefunden!")
    else:
        print("-" * 50)
        print("Suchen Sie oben nach: /api/shift-change/request")
    
    print("="*50 + "\n")

except Exception as e:
    print(f"\nKRITISCHER FEHLER: {e}")
