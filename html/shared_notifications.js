/**
 * DHF-Planer - Geteiltes Benachrichtigungs-Modul
 *
 * Dieses Skript wird auf allen Seiten geladen (außer Login/Passwortänderung).
 * Es prüft die API auf "Handlungsbedarf" (neue Meldungen, offene Anfragen)
 * und blendet dynamisch eine Benachrichtigungsleiste ("Subheader") ein,
 * wenn Handlungsbedarf besteht.
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

    try {
        user = JSON.parse(localStorage.getItem('dhf_user'));
        if (!user || !user.role) {
            // Nicht eingeloggt (z.B. auf Login-Seite), Skript beenden.
            return;
        }
        isAdmin = user.role.name === 'admin';
        isScheduler = user.role.name === 'Planschreiber';
    } catch (e) {
        // Fehler (z.B. Login-Seite), Skript beenden.
        return;
    }

    // Nur Admins oder Planschreiber benötigen diese Leiste
    if (!isAdmin && !isScheduler) {
        return;
    }

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
            if (existingSubheader) {
                existingSubheader.remove();
            }
            // --- ENDE ANPASSUNG ---


            if (!response.ok) {
                // Bei 401 (Session abgelaufen) oder 403 (Keine Rechte) nichts tun
                return;
            }

            const counts = await response.json();

            const feedbackCount = counts.new_feedback_count || 0;
            const queryCount = counts.open_shift_queries_count || 0;

            // HINWEIS: Schichtplan-Konflikte (Violations/Staffing)
            // werden hier (noch) nicht gezählt, da dies ein sehr
            // langsamer API-Aufruf wäre.

            const totalCount = feedbackCount + queryCount;

            // Wenn es nichts zu tun gibt, Leiste nicht anzeigen
            if (totalCount === 0) {
                return;
            }

            // --- 3. HTML-Struktur aufbauen ---

            // Container (Subheader)
            const subheader = document.createElement('div');
            subheader.className = 'notification-subheader';
            subheader.id = 'notification-subheader';

            // Linke Seite (Text + Badge)
            const leftDiv = document.createElement('div');
            leftDiv.className = 'notification-subheader-left';
            leftDiv.innerHTML = `
                <span class="notification-badge">${totalCount}</span>
                <span>Handlungsbedarf (Offene Aufgaben)</span>
            `;

            // Rechte Seite (Pfeil)
            const rightDiv = document.createElement('div');
            rightDiv.className = 'notification-chevron';
            rightDiv.innerHTML = '&#9660;'; // Pfeil nach unten ▼

            // Dropdown-Liste
            const dropdown = document.createElement('div');
            dropdown.className = 'notification-dropdown';

            let listHtml = '<ul>';
            if (isAdmin && feedbackCount > 0) {
                listHtml += `
                    <li>
                        <a href="feedback.html">
                            <span>Neue Meldungen / Feedback</span>
                            <span class="badge-detail">${feedbackCount}</span>
                        </a>
                    </li>
                `;
            }
            if ((isAdmin || isScheduler) && queryCount > 0) {
                listHtml += `
                    <li>
                        <a href="anfragen.html">
                            <span>Offene Schicht-Anfragen</span>
                            <span class="badge-detail">${queryCount}</span>
                        </a>
                    </li>
                `;
            }
            listHtml += '</ul>';
            dropdown.innerHTML = listHtml;

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

    // --- START ANPASSUNG (Regel 2: Innovatives Event-Handling) ---
    // Füge einen globalen Listener hinzu, der auf das benutzerdefinierte Event wartet.
    window.addEventListener('dhf:notification_update', () => {
        console.log("Event 'dhf:notification_update' empfangen. Lade Zähler neu.");
        fetchAndBuildNotifications();
    });
    // --- ENDE ANPASSUNG ---

})();