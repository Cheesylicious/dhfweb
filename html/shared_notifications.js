/**
 * DHF-Planer - Geteiltes Benachrichtigungs-Modul (Refaktorisiert)
 *
 * Nutzt jetzt importierte Module für Auth und API (Regel 4).
 */

// --- IMPORTE (Regel 4) ---
// (Pfade sind relativ zur HTML-Datei, die dieses Skript lädt)
import { API_URL } from './js/utils/constants.js';
import { apiFetch } from './js/utils/api.js';
import { initAuthCheck } from './js/utils/auth.js';

(function() {
    // Stellt sicher, dass das Skript nur einmal ausgeführt wird
    if (document.getElementById('notification-subheader-styles')) {
        return;
    }

    let user, isAdmin, isScheduler, isHundefuehrer;

    // 1. Authentifizierung (Regel 4: Wiederverwendung)
    try {
        // Wir rufen die zentrale Auth-Prüfung auf.
        // Diese Funktion kümmert sich um:
        // 1. User-Prüfung (localStorage)
        // 2. Rollen-Zuweisung (isAdmin, etc.)
        // 3. Navigations-Anpassung
        // 4. Logout-Button-Listener
        // 5. Auto-Logout-Timer
        const authData = initAuthCheck();
        user = authData.user;
        isAdmin = authData.isAdmin;
        isScheduler = authData.isPlanschreiber;
        isHundefuehrer = authData.isHundefuehrer;

    } catch (e) {
        // Auth-Fehler (z.B. auf Login-Seite oder Session abgelaufen)
        // Die Benachrichtigungsleiste wird nicht initialisiert.
        console.log("shared_notifications.js: Auth-Check fehlgeschlagen, Leiste wird nicht geladen.");
        return;
    }

    // (Der manuelle Check für change_password.html ist nicht mehr nötig,
    // da initAuthCheck() dort fehlschlägt und 'return' auslöst)

    // Nur Admins, Planschreiber oder Hundeführer benötigen diese Leiste
    if (!isAdmin && !isScheduler && !isHundefuehrer) {
        return;
    }

    // --- 2. CSS-Stile dynamisch injizieren ---
    // (Unverändert, 1:1 kopiert)
    const styles = `
        .notification-subheader {
            background: #f0ad4e; color: #1a1a1a; padding: 10px 30px;
            display: flex; justify-content: space-between; align-items: center;
            font-weight: 600; font-size: 15px; cursor: pointer;
            position: relative; z-index: 100003;
            border-bottom: 1px solid rgba(0,0,0,0.2);
        }
        .notification-subheader:hover { background: #e69524; }
        .notification-subheader-left { display: flex; align-items: center; gap: 10px; }
        .notification-badge {
            background-color: #e74c3c; color: white; font-size: 12px; font-weight: 700;
            padding: 3px 8px; border-radius: 10px; min-width: 10px; text-align: center;
        }
        .notification-chevron { font-size: 20px; transition: transform 0.2s; }
        .notification-subheader.open .notification-chevron { transform: rotate(180deg); }
        .notification-dropdown {
            display: none; position: absolute; top: 100%; left: 0; right: 0;
            background: rgba(40, 40, 40, 0.95); backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px); border: 1px solid rgba(255, 255, 255, 0.1);
            color: #ffffff; box-shadow: 0 8px 16px rgba(0,0,0,0.3); z-index: 1;
        }
        .notification-subheader.open .notification-dropdown { display: block; }
        .notification-dropdown ul { list-style: none; padding: 10px 0; margin: 0; }
        .notification-dropdown li { padding: 12px 30px; border-bottom: 1px solid rgba(255, 255, 255, 0.1); }
        .notification-dropdown li:last-child { border-bottom: none; }
        .notification-dropdown a {
            color: #ffffff; text-decoration: none; display: flex;
            justify-content: space-between; align-items: center; font-weight: 400;
        }
        .notification-dropdown a:hover { color: #3498db; }
        .notification-dropdown a .badge-detail {
            background: #3498db; color: white; padding: 4px 8px;
            border-radius: 5px; font-size: 13px;
        }
        .notification-dropdown a .badge-detail.priority-high { background: #e74c3c; }
        .notification-dropdown a .badge-detail.priority-low { background: #95a5a6; }
    `;
    const styleSheet = document.createElement("style");
    styleSheet.id = "notification-subheader-styles";
    styleSheet.innerText = styles;
    document.head.appendChild(styleSheet);


    // --- 3. API-Aufruf und DOM-Erstellung ---
    async function fetchAndBuildNotifications() {
        try {
            // Regel 4: Nutzt die importierte, zentrale apiFetch-Funktion
            const counts = await apiFetch('/api/queries/notifications_summary');

            const existingSubheader = document.getElementById('notification-subheader');

            const feedbackCount = counts.new_feedback_count || 0;
            const newRepliesCount = counts.new_replies_count || 0;
            const waitingCount = counts.waiting_on_others_count || 0;
            const totalActionRequiredCount = feedbackCount + newRepliesCount;

            // Wenn es nichts zu tun gibt, Leiste entfernen und stoppen
            if (totalActionRequiredCount + waitingCount === 0) {
                if (existingSubheader) existingSubheader.remove();
                return;
            }

            if (existingSubheader) existingSubheader.remove();

            // --- 4. HTML-Struktur aufbauen (Unverändert) ---
            const subheader = document.createElement('div');
            subheader.className = 'notification-subheader';
            subheader.id = 'notification-subheader';
            const leftDiv = document.createElement('div');
            leftDiv.className = 'notification-subheader-left';

            const messages = [];
            if (newRepliesCount > 0) messages.push(`Neue Antworten / Aufgaben: ${newRepliesCount}`);
            if (isAdmin && feedbackCount > 0) messages.push(`Neue Meldungen: ${feedbackCount}`);
            if (waitingCount > 0) messages.push(`Warte auf Antwort: ${waitingCount}`);
            const headerText = messages.join('  |  ');

            leftDiv.innerHTML = `
                <span class"notification-badge">${totalActionRequiredCount}</span>
                <span>${headerText}</span>
            `;

            const rightDiv = document.createElement('div');
            rightDiv.className = 'notification-chevron';
            rightDiv.innerHTML = '&#9660;';
            const dropdown = document.createElement('div');
            dropdown.className = 'notification-dropdown';

            let listHtml = '<ul>';
            if (newRepliesCount > 0) {
                listHtml += `<li><a href="anfragen.html"><span>Neue Antworten / Aufgaben</span><span class="badge-detail priority-high">${newRepliesCount}</span></a></li>`;
            }
            if (isAdmin && feedbackCount > 0) {
                listHtml += `<li><a href="feedback.html"><span>Neue Meldungen / Feedback</span><span class="badge-detail priority-high">${feedbackCount}</span></a></li>`;
            }
            if (waitingCount > 0) {
                 listHtml += `<li><a href="anfragen.html"><span>Warte auf Antwort</span><span class="badge-detail priority-low">${waitingCount}</span></a></li>`;
            }
            listHtml += '</ul>';
            dropdown.innerHTML = listHtml;

            subheader.appendChild(leftDiv);
            subheader.appendChild(rightDiv);
            subheader.appendChild(dropdown);

            subheader.onclick = (e) => {
                if (e.target.closest('a')) return;
                e.currentTarget.classList.toggle('open');
            };

            const mainHeader = document.querySelector('header');
            if (mainHeader) {
                mainHeader.insertAdjacentElement('afterend', subheader);
            } else {
                document.body.prepend(subheader);
            }

        } catch (error) {
            // apiFetch kümmert sich um 401/403. Dies fängt Server-Fehler (500)
            // oder Netzwerkprobleme ab.
            console.error("Fehler beim Laden der Benachrichtigungen:", error);
            const existingSubheader = document.getElementById('notification-subheader');
            if (existingSubheader) existingSubheader.remove();
        }
    }

    // Führe die Funktion aus, sobald das DOM geladen ist
    document.addEventListener('DOMContentLoaded', fetchAndBuildNotifications);

    // Polling (Unverändert)
    setInterval(fetchAndBuildNotifications, 30000);

    // Globaler Event-Listener (Unverändert)
    window.addEventListener('dhf:notification_update', () => {
        console.log("Event 'dhf:notification_update' empfangen. Lade Zähler neu.");
        setTimeout(fetchAndBuildNotifications, 100);
    });

})();