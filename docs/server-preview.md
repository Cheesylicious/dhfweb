# Serververgleich vor der automatischen Bereitstellung

Dieser erste Workflow vergleicht den gewählten GitHub-Stand mit dem Hetzner-Server.
Er hat ausschließlich einen Lesemodus. Alle vier rsync-Aufrufe verwenden
`--dry-run --checksum`; es gibt keinen Upload-, Lösch-, Neustart- oder Migrationsschritt.
Dateiinhalte und Zugangsdaten werden nicht ausgegeben. Im öffentlichen Repository
können die Workflow-Logs für andere sichtbar sein; sie enthalten Dateinamen und
Änderungskennzeichen. Zusätzliche Dateien nur auf dem Server werden nicht aufgelistet.

## Bekannte Installation

- Backend: `/var/www/dhf_planer_web/app.py` und `dhf_app/`
- Frontend: `/var/www/html/`
- Dienst: `dhf-planer.service`; läuft derzeit als root mit Gruppe www-data
- Python-Umgebung: `/var/www/dhf_planer_web/venv`
- Uploads: `/var/www/dhf_planer_web/dhf_app/static/uploads`
- Vorhandene Datei: `/var/www/dhf_planer_web/planer.db`, Nutzung nicht bestätigt
- Der Servercode enthält eine MySQL-Konfiguration; DATABASE_URL, FLASK_CONFIG und
  SECRET_KEY sind laut Prozessumgebung nicht gesetzt. Tatsächliche Zugangsdaten
  und der wirksame Sitzungsschlüssel wurden nicht ausgelesen.

## Einrichtung

1. Einen eigenen SSH-Benutzer `dhf-preview` ohne sudo-Rechte einrichten. Er benötigt
   ausschließlich Leserechte auf die verglichenen Dateien und Verzeichnisse sowie
   einen ausführbaren rsync. Keinen vorhandenen Account oder SSH-Schlüssel überschreiben.
   Die bekannten root-eigenen Verzeichnisse sind bereits allgemein lesbar/betretbar;
   unbekannte Dateirechte werden durch den ersten Lauf geprüft. Keine pauschale
   rekursive Rechteänderung an der Anwendung durchführen.
2. Einen eigenen Ed25519-Schlüssel für diesen Vergleich erzeugen und den öffentlichen
   Teil in den authorized_keys dieses Kontos eintragen, möglichst mit `restrict`.
   Dieser Zusatz verhindert Forwarding/PTY, beschränkt aber keine Shell-Befehle.
   Der Account erhält keine Schreibrechte auf die Anwendung. Der Schlüssel gewährt
   die normalen Leserechte dieses Unix-Kontos; er ist kein späterer Deployment-Zugang.
3. GitHub-Environment `production-preview` einrichten und diese Secrets hinterlegen:

   | Name | Inhalt |
   | --- | --- |
   | DHF_SSH_HOST | 46.224.63.203 |
   | DHF_SSH_USER | dhf-preview |
   | DHF_SSH_KEY | Privater Schlüssel, nur im GitHub-Secret speichern |
   | DHF_SSH_KNOWN_HOSTS | Verifizierter SSH-Hostschlüssel für 46.224.63.203 |

   Den Hostschlüssel aus einer bereits vertrauenswürdigen SSH-Sitzung bzw. der
   Hetzner-Konsole auslesen. Nicht ungeprüft den ersten Netzwerk-Scan übernehmen.
   Die SSH-Verbindung verwendet Port 22 und erzwingt die Hostschlüsselprüfung.
4. Den geprüften Workflow in `main` übernehmen. GitHub benötigt workflow_dispatch
   auf dem Default-Branch, bevor der manuelle Start verfügbar ist.
5. Actions → „Server-Dateivergleich (nur lesen)“ → Run workflow. Den gewünschten
   Branch auswählen. Es gibt keinen automatischen Trigger durch Push oder PR.

Quelle: https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow

## Ergebnis auswerten

rsync zeigt Unterschiede anhand von Prüfsummen an. Ein erfolgreicher Lauf mit
Unterschieden ist normal und keine Freigabe, diese ungeprüft zu überschreiben.
`config.py` wird getrennt nur verglichen. Uploads, Datenbankdateien, venv, .env,
Cachedateien und weitere Laufzeitverzeichnisse sind aus dem regulären Vergleich
ausgeschlossen. Fehler bei Rechten, Hostprüfung oder Verbindung brechen den Lauf ab.

## Noch nicht implementiert

Die tatsächliche Bereitstellung wird erst nach Sichtung der Unterschiede ergänzt.
Sie benötigt einen bewusst eingerichteten Schreibzugang, Codebackup und Wiederherstellung,
Erhalt der Serverkonfiguration und Laufzeitdaten, kontrollierten Dienstneustart sowie
Anwendungsprüfung. Ein Code-Rollback ist kein Datenbank-Rollback. Schemaänderungen
benötigen gesonderte Sicherungs- und Migrationsschritte. Da die Anwendung derzeit als
root läuft, bedeutet die Berechtigung zum Austauschen ihres Python-Codes effektiv
auch die Möglichkeit zur Codeausführung als root. Das muss bei der nächsten Stufe
berücksichtigt werden; dieser Vergleich erteilt diese Berechtigung nicht.

## Lokale Prüfung

`bash -n scripts/server-preview.sh`

`python3 -m unittest discover -s tests -p 'test_server_preview.py' -v`

Die Tests verwenden nachgebildete SSH-/rsync-Kommandos. Sie prüfen Parameter,
Abbruchverhalten und Geheimnisbehandlung; sie ersetzen keinen echten SSH-Lauf.
