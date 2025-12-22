// html/shared_notifications.js

/**
 * DHF-Planer - Geteiltes Benachrichtigungs-Modul
 * V7: Kooperativer Modus (Slots für Global & Plan)
 */
(function() {
    // Alte Styles aufräumen
    const oldIds = ['notification-styles', 'notification-styles-v2', 'notification-styles-v3', 'notification-styles-v4', 'notification-styles-v5', 'notification-styles-v6'];
    oldIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.remove();
    });

    if (document.getElementById('notification-styles-v7')) { return; }

    if (window.location.pathname.endsWith('change_password.html')) {
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
        /* Haupt-Container für ALLE Banner */
        #notification-container {
            display: flex;
            flex-direction: row;
            flex-wrap: wrap;
            width: 100%;
            z-index: 100003;
            position: relative;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            /* Hintergrund für die Leiste, falls Lücken entstehen */
            background-color: rgba(30, 30, 30, 0.5);
        }

        /* Slots (damit sich Skripte nicht gegenseitig überschreiben) */
        .notification-slot {
            display: contents; /* WICHTIG: Damit die Kinder direkt im Flex-Grid des Containers liegen */
        }

        /* Gemeinsames Design für ALLE Banner-Typen */
        .notification-banner, .unified-banner-item {
            flex: 1 1 auto;
            min-width: 200px;
            padding: 0;
            display: flex;
            align-items: stretch;
            justify-content: center; /* Zentriert Inhalt */
            font-weight: 600;
            font-size: 14px;
            color: white !important;
            border-right: 1px solid rgba(255,255,255,0.1);
            transition: all 0.2s ease-in-out;
            position: relative;
            cursor: pointer;
            text-decoration: none;
        }

        /* Hover-Effekt für alle */
        .notification-banner:hover, .unified-banner-item:hover {
            filter: brightness(1.15);
            z-index: 10;
            box-shadow: inset 0 0 20px rgba(255,255,255,0.1);
        }

        /* Farben (Global) */
        .banner-wishes { background-color: #f39c12; color: #1a1a1a !important; }
        .banner-notes { background-color: #3498db; }
        .banner-feedback { background-color: #e74c3c; }
        .banner-waiting { background-color: #7f8c8d; }

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

    // --- 2. Container & Slot erstellen ---
    function ensureStructure() {
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

        // Slot für GLOBALE Notifications (dieses Skript)
        let slot = document.getElementById('global-notifications-slot');
        if (!slot) {
            slot = document.createElement('div');
            slot.id = 'global-notifications-slot';
            slot.className = 'notification-slot';
            // Globaler Slot immer ZUERST
            container.prepend(slot);
        }
        return slot;
    }

    // --- 3. API Abruf & Render ---
    async function fetchAndBuildNotifications() {
        try {
            const response = await fetch(API_URL + '/api/queries/notifications_summary', {
                method: 'GET', credentials: 'include'
            });

            if (!response.ok) return;

            const counts = await response.json();
            const slot = ensureStructure();
            slot.innerHTML = ''; // Nur den eigenen Slot leeren!

            // 1. FEEDBACK (Admin only)
            if (isAdmin && counts.new_feedback_count > 0) {
                const div = document.createElement('div');
                div.className = 'notification-banner banner-feedback';
                div.innerHTML = `
                    <a href="feedback.html" class="banner-link">
                        <div class="notification-content">
                            <span class="notification-count">${counts.new_feedback_count}</span>
                            <span>Meldungen</span>
                        </div>
                    </a>
                `;
                slot.appendChild(div);
            }

            // 2. WUNSCH-ANFRAGEN (Admin + HF)
            if (counts.new_wishes_count > 0) {
                const div = document.createElement('div');
                div.className = 'notification-banner banner-wishes';
                div.innerHTML = `
                    <a href="anfragen.html?tab=wunsch" class="banner-link">
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
                slot.appendChild(div);
            }

            // 3. SCHICHT-NOTIZEN (Admin + Planschreiber)
            if (!isHundefuehrer && counts.new_notes_count > 0) {
                const div = document.createElement('div');
                div.className = 'notification-banner banner-notes';
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
                slot.appendChild(div);
            }

            // 4. WARTE AUF ANTWORT
            if (!isHundefuehrer && counts.waiting_on_others_count > 0) {
                const div = document.createElement('div');
                div.className = 'notification-banner banner-waiting';
                div.innerHTML = `
                    <a href="anfragen.html" class="banner-link">
                        <div class="notification-content">
                            <span class="notification-count">${counts.waiting_on_others_count}</span>
                            <span>Wartend</span>
                        </div>
                    </a>
                `;
                slot.appendChild(div);
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