// html/shared_notifications.js
/**
 * DHF-Planer - Geteiltes Benachrichtigungs-Modul
 * V7: Deaktiviert sich selbst auf schichtplan.html (verhindert Dopplung/Flackern).
 */
(function() {
    // Alte Styles aufräumen
    const oldIds = ['notification-styles', 'notification-styles-v2', 'notification-styles-v3', 'notification-styles-v4', 'notification-styles-v5', 'notification-styles-v6'];
    oldIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.remove();
    });

    if (document.getElementById('notification-styles-v7')) { return; }

    // --- NEU: Auf der Schichtplan-Seite brechen wir hier ab ---
    // Der 'schichtplan_banner.js' übernimmt dort die Anzeige im Grid-Layout.
    // Das verhindert das "Aufblitzen" und doppelte API-Calls.
    if (window.location.pathname.includes('schichtplan.html') || window.location.pathname.endsWith('change_password.html')) {
        return;
    }

    const API_URL = 'http://46.224.63.203:5000';
    let user, isAdmin = false, isScheduler = false, isHundefuehrer = false;

    try {
        user = JSON.parse(localStorage.getItem('dhf_user'));
        if (!user || !user.role) return;
        isAdmin = user.role.name === 'admin';
        isScheduler = user.role.name === 'Planschreiber';
        isHundefuehrer = user.role.name === 'Hundeführer';
    } catch (e) { return; }

    if (!isAdmin && !isScheduler && !isHundefuehrer) return;

    // --- 1. CSS ---
    const styles = `
        #notification-container {
            display: flex;
            flex-direction: row;
            flex-wrap: wrap;
            width: 100%;
            z-index: 100003;
            position: relative;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
        }

        .notification-banner {
            flex: 1 1 auto;
            min-width: 200px;
            padding: 0;
            display: flex;
            align-items: stretch;
            font-weight: 600;
            font-size: 14px;
            color: white;
            border-right: 1px solid rgba(255,255,255,0.1);
            transition: all 0.2s ease-in-out;
            position: relative;
        }
        .notification-banner:last-child {
            border-right: none;
        }

        /* HOVER-EFFEKT */
        .notification-banner:hover {
            filter: brightness(1.15);
            transform: scale(1.05);
            z-index: 10;
            box-shadow: 0 4px 15px rgba(0,0,0,0.3);
            border-right-color: transparent;
        }

        /* Farben */
        .banner-wishes { background-color: #f39c12; color: #1a1a1a; } /* Orange */
        .banner-notes { background-color: #3498db; } /* Blau */
        .banner-feedback { background-color: #e74c3c; } /* Rot */
        .banner-waiting { background-color: #7f8c8d; } /* Grau */

        .banner-link {
            text-decoration: none;
            color: inherit;
            display: flex;
            width: 100%;
            justify-content: center;
            align-items: center;
            padding: 12px 15px;
        }

        .notification-content {
            display: flex;
            gap: 10px;
            align-items: center;
            white-space: nowrap;
        }

        .notification-count {
            background: rgba(0,0,0,0.25);
            padding: 2px 8px;
            border-radius: 10px;
            font-weight: 700;
            font-size: 12px;
        }
    `;

    const styleSheet = document.createElement("style");
    styleSheet.id = "notification-styles-v7";
    styleSheet.innerText = styles;
    document.head.appendChild(styleSheet);

    // --- 2. Container erstellen ---
    function ensureContainer() {
        let container = document.getElementById('notification-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'notification-container';
            const mainHeader = document.querySelector('header');
            if (mainHeader) {
                mainHeader.insertAdjacentElement('afterend', container);
            } else {
                document.body.prepend(container);
            }
        }
        return container;
    }

    // --- 3. API Abruf & Render ---
    async function fetchAndBuildNotifications() {
        try {
            const response = await fetch(API_URL + '/api/queries/notifications_summary', {
                method: 'GET', credentials: 'include'
            });

            if (!response.ok) {
                const container = document.getElementById('notification-container');
                if(container) container.innerHTML = '';
                return;
            }

            const counts = await response.json();
            const container = ensureContainer();
            container.innerHTML = ''; // Reset

            // 1. FEEDBACK (Admin only)
            if (isAdmin && counts.new_feedback_count > 0) {
                const div = document.createElement('div');
                div.className = 'notification-banner banner-feedback';
                div.title = "Neue Meldungen / Bugs";
                div.innerHTML = `
                    <a href="feedback.html" class="banner-link">
                        <div class="notification-content">
                            <span class="notification-count">${counts.new_feedback_count}</span>
                            <span>Meldungen</span>
                        </div>
                    </a>
                `;
                container.appendChild(div);
            }

            // 2. WUNSCH-ANFRAGEN (Admin + HF)
            if (counts.new_wishes_count > 0) {
                const div = document.createElement('div');
                div.className = 'notification-banner banner-wishes';
                div.title = "Offene Wunsch-Anfragen";
                const targetUrl = "anfragen.html?tab=wunsch";
                div.innerHTML = `
                    <a href="${targetUrl}" class="banner-link">
                        <div class="notification-content">
                            <span class="notification-count">${counts.new_wishes_count}</span>
                            <span>Wünsche</span>
                        </div>
                    </a>
                `;

                if (isAdmin || isHundefuehrer) {
                    div.onclick = (e) => {
                        if (window.location.pathname.endsWith('anfragen.html')) {
                            e.preventDefault();
                            const tabBtn = document.getElementById('sub-nav-wunsch');
                            if(tabBtn) tabBtn.click();
                        }
                    };
                }
                container.appendChild(div);
            }

            // 3. SCHICHT-NOTIZEN (Admin + Planschreiber) - HF AUSGEBLENDET
            if (!isHundefuehrer && counts.new_notes_count > 0) {
                const div = document.createElement('div');
                div.className = 'notification-banner banner-notes';
                div.title = "Neue Schicht-Notizen / Aufgaben";
                div.innerHTML = `
                    <a href="anfragen.html" class="banner-link">
                        <div class="notification-content">
                            <span class="notification-count">${counts.new_notes_count}</span>
                            <span>Aufgaben</span>
                        </div>
                    </a>
                `;
                if (isAdmin && window.location.pathname.endsWith('anfragen.html')) {
                     div.onclick = (e) => {
                        const tabBtn = document.getElementById('sub-nav-anfragen');
                        if(tabBtn) tabBtn.click();
                    };
                }
                container.appendChild(div);
            }

            // 4. WARTE AUF ANTWORT (Admin + Planschreiber) - HF AUSGEBLENDET
            if (!isHundefuehrer && counts.waiting_on_others_count > 0) {
                const div = document.createElement('div');
                div.className = 'notification-banner banner-waiting';
                div.title = "Warte auf Antwort";
                div.innerHTML = `
                    <a href="anfragen.html" class="banner-link">
                        <div class="notification-content">
                            <span class="notification-count">${counts.waiting_on_others_count}</span>
                            <span>Wartend</span>
                        </div>
                    </a>
                `;
                container.appendChild(div);
            }

        } catch (error) {
            console.error("Fehler bei Notifications:", error);
        }
    }

    document.addEventListener('DOMContentLoaded', fetchAndBuildNotifications);
    setInterval(fetchAndBuildNotifications, 30000);
    window.addEventListener('dhf:notification_update', () => {
        setTimeout(fetchAndBuildNotifications, 100);
    });

})();