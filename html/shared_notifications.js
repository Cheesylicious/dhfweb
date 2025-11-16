/**
 * DHF-Planer - Geteiltes Benachrichtigungs-Modul
 *
 * Dieses Skript wird auf allen Seiten geladen (außer Login/Passwortänderung).
 * Es prüft die API auf "Handlungsbedarf" (neue Meldungen, offene Anfragen)
 * und blendet dynamisch eine Benachrichtigungsleiste ("Subheader") ein,
 * wenn Handlungsbedarf besteht.
 *
 * NEU: Zeigt jetzt auch persönliche Benachrichtigungen für den Admin/Planschreiber
 * (z.B. "Neue Antworten" oder "Warte auf Antwort").
 *
 * NEU: Polling alle 30 Sekunden, um Antworten von anderen Benutzern zu empfangen.
 */
(function() {
    // Stellt sicher, dass das Skript nur einmal ausgeführt wird
    if (document.getElementById('notification-subheader-styles')) {
        return;
    }

    // --- START ANPASSUNG (Regel 1: Bugfix) ---
    // Wenn wir auf der Passwort-Änderungs-Seite sind, darf
    // dieses Skript NICHTS tun (sonst kann man es umgehen).
    if (window.location.pathname.endsWith('change_password.html')) {
        console.log("shared_notifications.js: Stoppt Ausführung auf change_password.html.");
        return; // Komplette Ausführung des Skripts abbrechen
    }
    // --- ENDE ANPASSUNG ---

    const API_URL = 'http://46.224.63.203:5000';
    let user;
    let isAdmin = false;
    let isScheduler = false; // "Planschreiber"
    let isHundefuehrer = false; // <<< NEU

    try {
        user = JSON.parse(localStorage.getItem('dhf_user'));
        if (!user || !user.role) {
            // Nicht eingeloggt (z.B. auf Login-Seite), Skript beenden.
            return;
        }
        isAdmin = user.role.name === 'admin';
        isScheduler = user.role.name === 'Planschreiber';
        isHundefuehrer = user.role.name === 'Hundeführer'; // <<< NEU
    } catch (e) {
        // Fehler (z.B. Login-Seite), Skript beenden.
        return;
    }

    // --- START: ANPASSUNG (Hundeführer darf die Leiste sehen) ---
    // Nur Admins, Planschreiber oder Hundeführer benötigen diese Leiste
    if (!isAdmin && !isScheduler && !isHundefuehrer) {
        return;
    }
    // --- ENDE: ANPASSUNG ---

    // --- 1. CSS-Stile dynamisch injizieren ---
    const styles = `
        /* Der "Subheader" als Warnleiste */
        .notification-subheader {
            background: #f0ad4e; /* Warn-Gelb */
            color: #1a1a1a; /* Dunkler Text für Kontrast */
            padding: 10px 30px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-weight: 600;
            font-size: 15px;
            cursor: pointer;
            position: relative; /* Für das Dropdown */

            /* --- KORREKTUR: Z-Index erhöht --- */
            /* (Liegt über dem .sub-nav (100000) und .dropdown-content (100002)
               aus schichtplan.html, aber unter feedback-modal (200000)) */
            z-index: 100003;

            border-bottom: 1px solid rgba(0,0,0,0.2);
        }
        .notification-subheader:hover {
            background: #e69524;
        }

        .notification-subheader-left {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        /* Roter Zähler-Badge */
        .notification-badge {
            background-color: #e74c3c;
            color: white;
            font-size: 12px;
            font-weight: 700;
            padding: 3px 8px;
            border-radius: 10px;
            min-width: 10px;
            text-align: center;
        }

        /* Pfeil-Icon */
        .notification-chevron {
            font-size: 20px;
            transition: transform 0.2s;
        }
        .notification-subheader.open .notification-chevron {
            transform: rotate(180deg);
        }

        /* Das Dropdown-Menü */
        .notification-dropdown {
            display: none; /* Standardmäßig versteckt */
            position: absolute;
            top: 100%; /* Direkt unter der Leiste */
            left: 0;
            right: 0;
            background: rgba(40, 40, 40, 0.95); /* Dunkles Glas */
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            color: #ffffff;
            box-shadow: 0 8px 16px rgba(0,0,0,0.3);

             /* --- KORREKTUR: Z-Index relativ zur Leiste --- */
            z-index: 1; /* (Liegt über dem Text der Leiste, bleibt im 100003 Kontext) */
        }
        .notification-subheader.open .notification-dropdown {
            display: block;
        }

        .notification-dropdown ul {
            list-style: none;
            padding: 10px 0;
            margin: 0;
        }
        .notification-dropdown li {
            padding: 12px 30px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }
        .notification-dropdown li:last-child {
            border-bottom: none;
        }
        .notification-dropdown a {
            color: #ffffff;
            text-decoration: none;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-weight: 400;
        }
        .notification-dropdown a:hover {
            color: #3498db;
        }
        .notification-dropdown a .badge-detail {
            background: #3498db;
            color: white;
            padding: 4px 8px;
            border-radius: 5px;
            font-size: 13px;
        }

        /* --- NEU: Farbige Badges je nach Priorität --- */
        .notification-dropdown a .badge-detail.priority-high {
            background: #e74c3c; /* Rot (passend zum Haupt-Badge) */
        }
        .notification-dropdown a .badge-detail.priority-low {
            background: #95a5a6; /* Grau (für "Warte auf Antwort") */
        }
    `;

    const styleSheet = document.createElement("style");
    styleSheet.id = "notification-subheader-styles";
    styleSheet.innerText = styles;
    document.head.appendChild(styleSheet);


    // --- 2. API-Aufruf und DOM-Erstellung ---
    async function fetchAndBuildNotifications() {
        try {
            const response = await fetch(API_URL + '/api/queries/notifications_summary', {
                method: 'GET',
                credentials: 'include'
            });

            // --- START ANPASSUNG (Regel 1, Regel 2: Wiederverwendbarkeit) ---

            // 1. (NEU) Alte Leiste immer entfernen, falls vorhanden.
            //    Dies stellt sicher, dass beim Neuladen (z.B. durch Event)
            //    die Leiste verschwindet, wenn der Zähler 0 ist.
            const existingSubheader = document.getElementById('notification-subheader');

            // --- ENDE ANPASSUNG ---


            if (!response.ok) {
                 // Bei 401/403 (z.B. Session abgelaufen)
                 if (existingSubheader) existingSubheader.remove();
                return;
            }

            const counts = await response.json();

            // --- START: NEUE ZÄHLER-LOGIK ---
            const feedbackCount = counts.new_feedback_count || 0;
            const newRepliesCount = counts.new_replies_count || 0; // (Action Required)
            const waitingCount = counts.waiting_on_others_count || 0; // (Waiting)

            // Der ROTE Badge zählt nur die "Action Required" Aufgaben
            // (feedbackCount ist für Hundeführer immer 0, API-seitig)
            const totalActionRequiredCount = feedbackCount + newRepliesCount;
            // --- ENDE: NEUE ZÄHLER-LOGIK ---

            // Wenn es nichts zu tun gibt, Leiste nicht anzeigen
            if (totalActionRequiredCount + waitingCount === 0) {
                if (existingSubheader) existingSubheader.remove();
                return;
            }

            // Wenn die Leiste bereits existiert, entfernen wir sie, um sie neu aufzubauen
            // (einfacher als den Inhalt zu aktualisieren)
            if (existingSubheader) {
                existingSubheader.remove();
            }

            // --- 3. HTML-Struktur aufbauen ---

            // Container (Subheader)
            const subheader = document.createElement('div');
            subheader.className = 'notification-subheader';
            subheader.id = 'notification-subheader';

            // Linke Seite (Text + Badge)
            const leftDiv = document.createElement('div');
            leftDiv.className = 'notification-subheader-left';

            // --- START: DYNAMISCHER HEADER-TEXT ---
            const messages = [];

            // 1. Action Required (Rot)
            if (newRepliesCount > 0) {
                messages.push(`Neue Antworten / Aufgaben: ${newRepliesCount}`);
            }
            if (isAdmin && feedbackCount > 0) {
                messages.push(`Neue Meldungen: ${feedbackCount}`);
            }

            // 2. Waiting (Grau/Blau)
            if (waitingCount > 0) {
                messages.push(`Warte auf Antwort: ${waitingCount}`);
            }

            const headerText = messages.join('  |  '); // Trennzeichen

            leftDiv.innerHTML = `
                <span class="notification-badge">${totalActionRequiredCount}</span>
                <span>${headerText}</span>
            `;
            // --- ENDE: DYNAMISCHER HEADER-TEXT ---


            // Rechte Seite (Pfeil)
            const rightDiv = document.createElement('div');
            rightDiv.className = 'notification-chevron';
            rightDiv.innerHTML = '&#9660;'; // Pfeil nach unten ▼

            // Dropdown-Liste
            const dropdown = document.createElement('div');
            dropdown.className = 'notification-dropdown';

            // --- START: DYNAMISCHES DROPDOWN ---
            let listHtml = '<ul>';

            // Priorität 1: Action Required (Rote Badges)
            if (newRepliesCount > 0) {
                listHtml += `
                    <li>
                        <a href="anfragen.html">
                            <span>Neue Antworten / Aufgaben</span>
                            <span class="badge-detail priority-high">${newRepliesCount}</span>
                        </a>
                    </li>
                `;
            }
            if (isAdmin && feedbackCount > 0) {
                listHtml += `
                    <li>
                        <a href="feedback.html">
                            <span>Neue Meldungen / Feedback</span>
                            <span class="badge-detail priority-high">${feedbackCount}</span>
                        </a>
                    </li>
                `;
            }

            // Priorität 2: Waiting (Graue Badges)
            if (waitingCount > 0) {
                 listHtml += `
                    <li>
                        <a href="anfragen.html">
                            <span>Warte auf Antwort</span>
                            <span class="badge-detail priority-low">${waitingCount}</span>
                        </a>
                    </li>
                `;
            }

            listHtml += '</ul>';
            dropdown.innerHTML = listHtml;
            // --- ENDE: DYNAMISCHES DROPDOWN ---

            // Zusammenbauen
            subheader.appendChild(leftDiv);
            subheader.appendChild(rightDiv);
            subheader.appendChild(dropdown); // Dropdown ist Kind von Subheader

            // Klick-Logik
            subheader.onclick = (e) => {
                // Verhindern, dass Klicks auf Links im Dropdown das Menü schließen
                if (e.target.closest('a')) {
                    return;
                }
                e.currentTarget.classList.toggle('open');
            };

            // --- 4. Ins DOM einfügen ---
            const mainHeader = document.querySelector('header');
            if (mainHeader) {
                // Fügt die Leiste direkt *nach* dem <header> ein
                mainHeader.insertAdjacentElement('afterend', subheader);
            } else {
                // Fallback: Fügt es oben im body ein
                document.body.prepend(subheader);
            }

        } catch (error) {
            console.error("Fehler beim Laden der Benachrichtigungen:", error);
            // Bei Fehler (z.B. Server down) einfach nichts anzeigen.
        }
    }

    // Führe die Funktion aus, sobald das DOM geladen ist
    document.addEventListener('DOMContentLoaded', fetchAndBuildNotifications);

    // --- START ANPASSUNG: Periodisches Polling ---
    // Prüfe alle 30 Sekunden auf neue Benachrichtigungen (z.B. Antworten von anderen)
    setInterval(fetchAndBuildNotifications, 30000); // 30.000 ms = 30 Sekunden
    // --- ENDE ANPASSUNG ---

    // --- START ANPASSUNG (Regel 2: Innovatives Event-Handling) ---
    // Füge einen globalen Listener hinzu, der auf das benutzerdefinierte Event wartet.
    window.addEventListener('dhf:notification_update', () => {
        console.log("Event 'dhf:notification_update' empfangen. Lade Zähler neu.");
        // Kurze Verzögerung (100ms), um sicherzustellen, dass der DB-Commit der auslösenden Aktion abgeschlossen ist
        setTimeout(fetchAndBuildNotifications, 100);
    });
    // --- ENDE ANPASSUNG ---

})();