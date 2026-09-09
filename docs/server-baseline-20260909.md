# Serverstand vom 9. September 2026

Quelle: lokaler Download `serverstand-20260909-101048`; Vergleich mit GitHub main `0b5af623b0cfd6e3be9b7f3e0ca016c05b77a779`.

142 Dateien erfasst: 101 identisch, 32 verändert, 9 zusätzlich. Alle 60 Python-Dateien lassen sich syntaktisch parsen. SHA-256-Prüfsummen stehen im begleitenden Manifest. Der Download ist eine Dateikopie während des laufenden Betriebs, kein atomarer Vollbackup.

## Bedeutung der Unterschiede

Der Server enthält bereits zusammenhängende Änderungen an Sitzungsprüfung, Login und Logout. `initAuthCheck` ist asynchron; die aufrufenden Seiten warten mit `await` auf das Ergebnis. Einige Verwaltungsseiten nutzen gemeinsame API-Module und laden JavaScript als Module. Diese Änderungen werden unverändert als Ausgangsbasis übernommen.

`app.py` verwendet beim direkten Aufruf `app.run` statt `socketio.run`. Der bekannte Produktivbetrieb importiert jedoch `app:app` über Gunicorn; der direkte Startblock wird dabei nicht ausgeführt.

Zusätzlich vorhanden: `check_routes.py`, `create_tables.py`, `sync_db.py`, `models.py`, `requirements.txt`, `dhf_app/routes/impersonation_routes.py`, `html/index.nginx-debian.html`, `html/schichtartensortierung.html`, `html/statistik.js`. Die bloße Existenz belegt nicht, dass eine Datei aktiv verwendet wird. Insbesondere werden die Datenbank-Hilfsskripte nicht ausgeführt oder automatisch in ein Deployment aufgenommen.

## Grenzen und nächster Schritt

Die Suche nach typischen fest eingetragenen Zugangsdaten ergab in den heruntergeladenen Dateien keine Treffer. Das ist keine Garantie auf vollständige Geheimnisfreiheit. `config.py`, Umgebungsdateien, Uploads, Datenbanken und die virtuelle Python-Umgebung wurden bewusst nicht heruntergeladen. Die bisherige GitHub-Konfiguration ist deshalb kein bestätigter Serverstand und darf nicht auf den Server kopiert werden.

`requirements.txt` enthält weder Gunicorn noch Eventlet noch Flask-SocketIO. Vor reproduzierbaren Tests und automatischer Bereitstellung benötigen wir deshalb eine Liste der tatsächlich installierten Python-Pakete. Es wurden keine Pakete installiert, keine Anwendung gestartet und keine Datenbanken verändert. Die frühere Bugprüfung muss anhand dieses Ausgangsstands erneut bewertet werden.

Die GitHub-Übernahme dient zunächst als Entwurf zur Dokumentation des Servercodes. Sie ist kein freigegebenes Deployment und keine Zusicherung, dass bestehende Fehler behoben sind.
