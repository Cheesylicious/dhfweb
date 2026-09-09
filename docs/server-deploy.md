# Manuelle Bereitstellung aus GitHub

Voraussetzung: Der Servercode-Entwurf muss zuerst in main übernommen werden. Der bisherige main enthält ältere Anwendungsversionen und darf nicht als Deployment-Quelle verwendet werden. Dieser Workflow startet ausschließlich manuell auf main. Er erzeugt standardmäßig eine Vorschau; apply verlangt die vollständige SHA des ausgewählten Commits.

## Einmalige Einrichtung

Der geprüfte Server läuft als dhf-app:www-data mit Python 3.12.3. Die 136 bekannten Ziel-Dateien stimmen mit dem Download vom 9. September 2026 überein und liegen in root-eigenen, für den Dienst nicht beschreibbaren Zielpfaden.

`scripts/deploy/install.py` wird einmal als root auf diesem Server ausgeführt. Der Installer wiederholt die Rechte- und Prüfsummenprüfung. Er installiert den root-eigenen Empfänger, einen root-eigenen Prüfsummenbestand, einen eigenen Benutzer dhf-deploy sowie einen neuen SSH-Schlüssel. Bestehende Installationspfade oder Benutzer werden nicht überschrieben. Bei einem Installationsfehler ist die Teilinstallation zu prüfen, nicht blind zu löschen oder zu wiederholen.

Der SSH-Schlüssel erlaubt nur den festgelegten Empfängeraufruf via sudo; kein frei wählbares Remote-Kommando, SFTP, Port-Forwarding oder Terminal. Der Benutzer erhält keine Schreibrechte auf Programmdateien oder den Empfänger. Die Anwendung selbst wird als dhf-app gestartet. Der bestehende Preview-Zugang wird nicht verändert.

In GitHub eine separate Umgebung `production-deploy` anlegen. Secrets: DHF_SSH_HOST (46.224.63.203), DHF_SSH_USER (dhf-deploy), DHF_SSH_KEY (vollständiger neu erzeugter privater Schlüssel), DHF_SSH_KNOWN_HOSTS (bereits authentifiziert geprüfter Hostschlüssel). Private Schlüssel ausschließlich als Secret speichern. Den privaten Schlüsselpfad zeigt der Installer an. Nach der Einrichtung zuerst den Workflow im Modus preview starten; beim unveränderten Servercode muss die Dateiliste leer sein.

## Ablauf und Grenzen

Der Client liest Git-Dateien aus dem ausgewählten Commit. Server und Client akzeptieren nur die 136 bekannten Dateien. Neue oder gelöschte Anwendungsdateien erfordern einen gesondert geprüften Ausbau der Liste. config.py, Datenbanken, Uploads, Paketinstallationen und Dienstkonfiguration sind ausgeschlossen.

Der Empfänger vergleicht die aktuellen Serverdateien mit seinem gespeicherten Zustand, prüft Pfade und Python-Syntax und erzeugt eine Vorschau. Vor Änderungen wird ein Wiederherstellungsjournal unter /var/lib/dhf-deploy gesichert. Bei Änderungen wird der Dienst angehalten, die Dateien werden einzeln atomar ersetzt, anschließend wird der Dienst gestartet. Der erwartete Prozessbenutzer und die lokale Session-API müssen drei aufeinanderfolgende Prüfungen bestehen. Ein Lauf ohne Inhaltsänderungen löst keinen Neustart aus.

Bei erkannten Fehlern werden vorherige Dateien und Prüfsummen wiederhergestellt und der Dienst neu gestartet. Bei einer unbestätigten Rücknahme oder einem abrupten Prozess-/Serverausfall bleibt pending.json stehen; weitere Deployments sind gesperrt. Ein Administrator muss dann das gesicherte Journal prüfen und mit dem installierten receiver.restore(journal) die Wiederherstellung ausführen; pending.json erst nach bestätigtem Erfolg entfernen. Journale enthalten Anwendungscode und verbleiben root-geschützt auf dem Server. Es erfolgt keine automatische Löschung alter Sicherungen.

Die automatische Rücknahme betrifft Dateien, nicht Datenbankänderungen oder externe Nebenwirkungen. Deshalb müssen Änderungen mit Migrationen oder geänderter Startlogik separat geprüft werden. Die Session-API-Prüfung ist kein Login-, Upload-, Datenbank- oder Bilderzeugungs-Funktionstest; diese Tests sind nach relevanten Änderungen zusätzlich nötig. Während eines schreibenden Laufs gibt es eine kurze Unterbrechung; statische Dateien werden nacheinander aktualisiert, es handelt sich nicht um einen atomaren Release-Wechsel.

Lokale Tests simulieren Erfolgs- und Fehlerabläufe, Pfadschutz, fremde Serveränderungen, Syntaxfehler, Vorschau und Rücknahme. Die reale SSH-Einrichtung und der erste Preview-Lauf müssen noch auf dem Server/GitHub bestätigt werden. Der Installer verändert keine Anwendung und startet keinen Dienst neu.
