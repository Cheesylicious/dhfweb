/**
 * DHF-Planer - Geteiltes Feedback-Modul
 * * Dieses Skript wird auf allen Seiten geladen. Es fügt dynamisch hinzu:
 * 1. Den CSS-Style für das Feedback-Modal und die Blink-Animation.
 * 2. Den HTML-Body für das Feedback-Modal.
 * 3. Die Event-Listener für das Öffnen, Schließen und Senden des Modals.
 * 4. Die Logik zur Anzeige der neuen Meldungen und zur Navigationskorrektur.
 * 5. NEU: Einen globalen Inaktivitäts-Timer für den Auto-Logout.
 * * (Regel 4: Vermeidet Codeduplizierung in allen HTML-Dateien)
 */

(function() {
    // Stellt sicher, dass das Skript nur einmal ausgeführt wird
    if (document.getElementById('feedback-modal-styles')) {
        return;
    }

    const API_URL = 'http://46.224.63.203:5000';
    let user;
    let isAdmin = false;
    // --- START: NEU ---
    let isPlanschreiber = false;
    let isHundefuehrer = false;
    // --- ENDE: NEU ---

    // Versuche, den User zu laden und die Admin-Rolle zu bestimmen
    try {
        user = JSON.parse(localStorage.getItem('dhf_user'));
        isAdmin = user && user.role && user.role.name === 'admin';
        // --- START: NEU ---
        isPlanschreiber = user && user.role && user.role.name === 'Planschreiber';
        isHundefuehrer = user && user.role && user.role.name === 'Hundeführer';
        // --- ENDE: NEU ---
    } catch (e) {
        // Ignoriere Fehler, falls localStorage leer/ungültig
    }

    // --- 1. CSS-Stile dynamisch injizieren (Inkl. Blink-Animation) ---
    const styles = `
        .feedback-modal {
            display: none;
            position: fixed;
            z-index: 200000; /* (Über allem) */
            left: 0; top: 0;
            width: 100%; height: 100%;
            overflow: auto;
            background-color: rgba(0,0,0,0.6);
        }
        .feedback-modal-content {
            background: rgba(30, 30, 30, 0.8); /* (Dunkles Glas) */
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            margin: 10% auto;
            padding: 0;
            width: 90%;
            max-width: 550px;
            border-radius: 8px;
            box-shadow: 0 4px 30px rgba(0, 0, 0, 0.4);
            color: #ffffff;
        }
        .feedback-modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px 25px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }
        .feedback-modal-header h2 {
            margin: 0;
            color: #ffffff;
            font-weight: 600;
            font-size: 1.2rem;
        }
        .feedback-close {
            color: #bdc3c7;
            font-size: 28px;
            font-weight: bold;
            cursor: pointer;
            transition: color 0.3s;
        }
        .feedback-close:hover { color: #ffffff; }
        .feedback-modal-body { padding: 25px; }
        .feedback-modal-footer {
            padding: 15px 25px;
            background: rgba(0, 0, 0, 0.2);
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            text-align: right;
            border-radius: 0 0 8px 8px;
        }

        /* (Formular-Styling) */
        .feedback-form-group { margin-bottom: 15px; }
        .feedback-form-group label {
            display: block;
            margin-bottom: 8px;
            font-weight: 300;
            color: #bdc3c7;
        }
        .feedback-form-group input[type="text"],
        .feedback-form-group select,
        .feedback-form-group textarea {
            width: 100%;
            padding: 10px;
            box-sizing: border-box;
            background: rgba(0, 0, 0, 0.2);
            border: 1px solid #3498db;
            border-radius: 5px;
            color: #ffffff;
            font-family: 'Poppins', sans-serif;
            font-size: 14px;
        }
        .feedback-form-group textarea {
            min-height: 120px;
            resize: vertical;
        }
        .feedback-form-group select {
             -webkit-appearance: none;
             -moz-appearance: none;
             appearance: none;
             background-image: url('data:image/svg+xml;utf8,<svg fill="white" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M7 10l5 5 5-5z"/></svg>');
             background-repeat: no-repeat;
             background-position-x: 98%;
             background-position-y: 50%;
             padding-right: 30px;
        }

        /* (Innovatives Button-Auswahl-Design) */
        .feedback-type-selection {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 10px;
            margin-bottom: 15px;
        }
        .feedback-type-selection input[type="radio"] {
            display: none; /* (Radio-Button verstecken) */
        }
        .feedback-type-selection label {
            display: block;
            padding: 12px;
            background: rgba(0,0,0,0.2);
            border: 1px solid #555;
            border-radius: 5px;
            text-align: center;
            cursor: pointer;
            transition: background-color 0.3s, border-color 0.3s;
            font-weight: 500;
            color: #bdc3c7;
        }
        .feedback-type-selection input[type="radio"]:checked + label {
            background: #3498db;
            border-color: #3498db;
            color: white;
            box-shadow: 0 0 10px rgba(52, 152, 219, 0.5);
        }

        /* (Status-Nachricht im Modal) */
        #feedback-modal-status {
            text-align: left;
            font-weight: 500;
            float: left;
            line-height: 38px; /* (Höhe des Buttons) */
        }

        /* (Buttons) */
        .feedback-btn-primary {
            background: #007bff; color: white; padding: 10px 15px; border: none;
            border-radius: 5px; cursor: pointer; font-size: 15px; transition: opacity 0.3s;
        }
        .feedback-btn-primary:hover { opacity: 0.8; }
        .feedback-btn-primary:disabled { background: #555; opacity: 0.7; cursor: not-allowed; }

        /* --- NEU: Blink-Animation --- */
        @keyframes blink-animation {
            0%, 100% { background-color: #e74c3c; transform: scale(1); }
            50% { background-color: #f1c40f; transform: scale(1.1); }
        }
        .nav-badge.blinking {
            animation: blink-animation 1.5s infinite;
            display: inline-flex !important; /* WICHTIG: Setzt die Sichtbarkeit */
            transform-origin: center center;
        }
    `;

    const styleSheet = document.createElement("style");
    styleSheet.id = "feedback-modal-styles";
    styleSheet.innerText = styles;
    document.head.appendChild(styleSheet);

    // --- GEÄNDERTE HILFSFUNKTION: Generiert Kategorien dynamisch ---
    function generateDynamicCategories() {
        // Set zur Verfolgung bereits hinzugefügter Kategorien (vermeidet Duplikate)
        const addedCategories = new Set();
        let optionsHtml = '';
        let activeContextName = null;
        let mainCategoriesHtml = '';

        // 1. Finde den aktuellen, aktiven Seitenkontext (Unter- oder Hauptnavigation)
        // Prüfe zuerst den Sub-Nav (einstellungen.html, roles.html, schichtarten.html etc.)
        const subNav = document.querySelector('.sub-nav');
        if (subNav) {
            const activeLink = subNav.querySelector('a.active, .dropdown .dropbtn.active');
            if (activeLink) {
                 // Entfernt "&raquo;" und Leerzeichen, um den reinen Namen zu erhalten
                 activeContextName = activeLink.textContent.trim().replace(/\s*&raquo;$/, '');
                 optionsHtml += `<option value="${activeContextName}" selected>Aktueller Kontext: ${activeContextName}</option>`;
                 addedCategories.add(activeContextName);
            }
        }

        // 2. Durchlaufe die Hauptnavigation, um VERFÜGBARE Bereiche zu finden
        const mainNav = document.querySelector('header nav');
        if (mainNav) {
            mainNav.querySelectorAll('a').forEach(link => {
                // Nur wenn der Link VISUELL sichtbar ist (offsetWidth > 0)
                // Dies ist robuster als nur link.style.display
                if (link.offsetWidth > 0 && link.offsetHeight > 0) {
                    // Verwende den Text des Links als Kategorie und bereinige ihn
                    const categoryName = link.textContent.trim().replace('Meldungen', '').trim();

                    if (categoryName && !addedCategories.has(categoryName)) {
                        const isSelected = categoryName === activeContextName ? 'selected' : ''; // Sollte nur bei Fehlen von Schritt 1 greifen
                        mainCategoriesHtml += `<option value="${categoryName}" ${isSelected}>${categoryName}</option>`;
                        addedCategories.add(categoryName);
                    }
                }
            });
        }

        // 3. Füge statische Kategorien hinzu
        let staticOptionsHtml = '';
        // Füge Dashboard hinzu, falls es nicht in der sichtbaren Navigation erkannt wurde (z.B. weil es die aktive Seite ist oder nicht im Haupt-Nav-Block)
        if (!addedCategories.has('Dashboard')) {
             staticOptionsHtml += '<option value="Dashboard">Dashboard</option>';
        }
        staticOptionsHtml += '<option value="Login">Login / Startseite</option>';
        staticOptionsHtml += '<option value="Allgemein">Allgemein / Sonstiges</option>';


        // 4. Kombiniere und returniere
        return optionsHtml + mainCategoriesHtml + staticOptionsHtml;
    }
    // --- ENDE GEÄNDERTE HILFSFUNKTION ---

    // --- 2. HTML-Struktur dynamisch injizieren ---
    const modalHTML = `
        <div id="feedback-modal" class="feedback-modal">
            <div class="feedback-modal-content">
                <div class="feedback-modal-header">
                    <h2>Problem melden / Vorschlag</h2>
                    <span class="feedback-close" id="feedback-close-btn">&times;</span>
                </div>
                <div class="feedback-modal-body">

                    <div class="feedback-form-group">
                        <label>Art der Meldung:</label>
                        <div class="feedback-type-selection">
                            <input type="radio" id="feedback-type-bug" name="feedback_type" value="bug" checked>
                            <label for="feedback-type-bug">🐞 Fehler (Bug)</label>

                            <input type="radio" id="feedback-type-improvement" name="feedback_type" value="improvement">
                            <label for="feedback-type-improvement">💡 Vorschlag</label>

                            <input type="radio" id="feedback-type-other" name="feedback_type" value="other">
                            <label for="feedback-type-other">💬 Sonstiges</label>
                        </div>
                    </div>

                    <div class="feedback-form-group">
                        <label for="feedback-category">Welchen Bereich betrifft es?</label>
                        <select id="feedback-category">
                            </select>
                    </div>

                    <div class="feedback-form-group">
                        <label for="feedback-message">Ihre Nachricht:</label>
                        <textarea id="feedback-message" placeholder="Bitte beschreiben Sie den Fehler oder Ihre Idee so genau wie möglich..."></textarea>
                    </div>

                </div>
                <div class="feedback-modal-footer">
                    <span id="feedback-modal-status"></span>
                    <button class="feedback-btn-primary" id="feedback-submit-btn">Absenden</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    // Nach dem Einfügen: Die Dropdown-Liste sofort befüllen
    document.getElementById('feedback-category').innerHTML = generateDynamicCategories();


    // --- 3. Event-Listener und Logik ---

    const modal = document.getElementById('feedback-modal');
    const openBtn = document.getElementById('global-report-btn');
    const closeBtn = document.getElementById('feedback-close-btn');
    const submitBtn = document.getElementById('feedback-submit-btn');
    const statusEl = document.getElementById('feedback-modal-status');
    const navBadge = document.getElementById('feedback-badge');

    // --- NEU: Hilfsfunktion für robusten API-Aufruf ---
    async function apiFetchNew(endpoint, method = 'GET', body = null) {
        const options = {
            method,
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
        };
        if (body) { options.body = JSON.stringify(body); }
        const response = await fetch(API_URL + endpoint, options);
        if (!response.ok) {
            // Wirft einen Fehler, wenn der Status nicht OK ist
            throw new Error(response.statusText);
        }
        return response.json();
    }

    // --- START: NEU: Funktion zur Korrektur der Admin-Navigation (Angepasst) ---
    function fixAdminNavigation() {
        const navDashboard = document.getElementById('nav-dashboard');
        const navUsers = document.getElementById('nav-users');
        const navFeedback = document.getElementById('nav-feedback');

        if (isAdmin) {
            // Admin sieht alles
            if (navDashboard) navDashboard.style.display = 'inline-flex';
            if (navUsers) navUsers.style.display = 'inline-flex';
            if (navFeedback) navFeedback.style.display = 'inline-flex';
        } else if (isPlanschreiber) {
            // Planschreiber sieht Dashboard und Meldungen (Anfragen)
            if (navDashboard) navDashboard.style.display = 'inline-flex';
            if (navUsers) navUsers.style.display = 'none';
            if (navFeedback) navFeedback.style.display = 'inline-flex';
        } else {
            // Hundeführer, User, Besucher sehen nur Dashboard
            // (Besucher wird auf Dashboard-Seite/Schichtplan selbst blockiert, aber Link ist hier ok)
            if (navDashboard) navDashboard.style.display = 'inline-flex';
            if (navUsers) navUsers.style.display = 'none';
            if (navFeedback) navFeedback.style.display = 'none';
        }
    }
    // --- ENDE: NEU ---

    // --- NEU: Funktion zum Abrufen und Aktualisieren der Meldungsanzahl ---
    async function updateFeedbackCount() {
        // --- START: ANPASSUNG (Nur Admin sieht Bug-Zähler) ---
        // (Planschreiber sehen ihren Zähler via shared_notifications.js)
        if (!isAdmin || !navBadge) {
            // Wenn kein Admin oder Badge-Element nicht gefunden, abbrechen
            return;
        }
        // --- ENDE: ANPASSUNG ---


        // Führt die Navigationskorrektur bei jedem Abruf durch
        fixAdminNavigation();

        try {
            const data = await apiFetchNew('/api/feedback/count_new', 'GET');
            const count = data.count || 0;

            if (count > 0) {
                navBadge.textContent = count;
                navBadge.classList.add('blinking');
                navBadge.style.display = 'inline-flex'; // Sicherstellen, dass es sichtbar ist
            } else {
                navBadge.textContent = 0;
                navBadge.classList.remove('blinking');
                navBadge.style.display = 'none';
            }
        } catch (error) {
            // Bei 401/403 Fehler (z.B. Session abgelaufen) den Badge ausblenden
            navBadge.style.display = 'none';
            navBadge.classList.remove('blinking');
            console.error("Fehler beim Abruf der Meldungsanzahl:", error);
        }
    }

    // Initialisierung und Interval-Setup
    // --- START: ANPASSUNG (Nur Admin braucht Zähler) ---
    if (isAdmin) {
        // Erste Ausführung zur sofortigen Anzeige des Badges
        updateFeedbackCount();
        // Regelmäßiger Check alle 30 Sekunden
        setInterval(updateFeedbackCount, 30000);
    } else {
        // Alle anderen Rollen führen nur die Navigationskorrektur einmalig aus
        fixAdminNavigation();
    }
    // --- ENDE: ANPASSUNG ---
    // --- ENDE NEU ---


    // Öffnen
    if (openBtn) {
        openBtn.onclick = () => {
            modal.style.display = 'block';
            statusEl.textContent = '';
            statusEl.style.color = '';
            document.getElementById('feedback-message').value = ''; // (Immer leeren)

            // NEU: Kategorien beim Öffnen neu laden, um dynamische Links zu erfassen
            document.getElementById('feedback-category').innerHTML = generateDynamicCategories();
        };
    }

    // Schließen
    closeBtn.onclick = () => {
        modal.style.display = 'none';
    };
    window.onclick = (event) => {
        if (event.target == modal) {
            modal.style.display = 'none';
        }
    };

    // Senden
    submitBtn.onclick = async () => {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sende...';
        statusEl.textContent = '';

        try {
            const payload = {
                report_type: document.querySelector('input[name="feedback_type"]:checked').value,
                category: document.getElementById('feedback-category').value,
                message: document.getElementById('feedback-message').value,
                page_context: window.location.pathname // (Kontext, wo der User war)
            };

            if (!payload.message) {
                throw new Error("Bitte geben Sie eine Nachricht ein.");
            }

            // (API-Aufruf)
            const response = await fetch(API_URL + '/api/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                credentials: 'include'
            });

            if (response.status === 401) { throw new Error("Sitzung abgelaufen. Bitte neu einloggen."); }


            // *** KORRIGIERTE FEHLERBEHANDLUNG (von vorherigem Schritt) ***
            let data;

            if (!response.ok) {
                let errorData;
                let textResponse = await response.text();

                try {
                    errorData = JSON.parse(textResponse);
                } catch (e) {
                    if (textResponse.trim().toLowerCase().startsWith('<!doctype')) {
                        throw new Error(`Sitzung abgelaufen. Bitte erneut versuchen oder neu einloggen. (Status: ${response.status})`);
                    }
                    throw new Error(`Serverfehler ${response.status}: ${response.statusText}`);
                }
                throw new Error(errorData.message || 'Unbekannter API-Fehler');
            }

            // Erfolgspfad (response.ok)
            try {
                 data = await response.json();
            } catch (e) {
                 data = {};
            }
            // *** ENDE KORRIGIERTE FEHLERBEHANDLUNG ***

            // --- NEU: Nach erfolgreichem Senden den Zähler aktualisieren ---
            if (isAdmin) {
                await updateFeedbackCount();
            }
            // --- ENDE NEU ---

            // Erfolg
            statusEl.textContent = 'Vielen Dank! Meldung gesendet.';
            statusEl.style.color = '#2ecc71';
            submitBtn.textContent = 'Gesendet!';

            setTimeout(() => {
                modal.style.display = 'none';
                submitBtn.disabled = false;
                submitBtn.textContent = 'Absenden';
            }, 2000);

        } catch (error) {
            // (Fehlerbehandlung für alle Fehler)
            statusEl.textContent = `Fehler: ${error.message}`;
            statusEl.style.color = '#e74c3c';
            submitBtn.disabled = false;
            submitBtn.textContent = 'Absenden';
        }
    };


    // --- START: NEUE LOGIK FÜR AUTO-LOGOUT ---

    // 1. Führe dies nur aus, wenn die 'user' Variable oben erfolgreich geladen wurde
    //    (d.h. wir sind NICHT auf der Login-Seite).
    if (!user) {
        return;
    }

    const LOGOUT_TIMEOUT_MS = 5 * 60 * 1000; // 5 Minuten (5 * 60 * 1000)
    let inactivityTimer;

    // 2. Die Funktion, die den Logout durchführt
    function performAutoLogout() {
        console.log("Inaktivität für 5 Minuten erkannt. Führe automatischen Logout durch.");

        // Wir rufen nicht die API auf, da die Server-Session ohnehin abläuft.
        // Wichtig ist das Leeren des LocalStorage, um den Login-Screen zu erzwingen.
        localStorage.removeItem('dhf_user');

        // Wir leiten zur Index-Seite um und fügen einen Grund hinzu.
        // Die 'index.html' könnte diesen 'reason' anzeigen, z.B. "Sie wurden wegen Inaktivität abgemeldet."
        window.location.href = 'index.html?logout=true&reason=inactivity';
    }

    // 3. Die Funktion, die den Timer zurücksetzt
    function resetInactivityTimer() {
        clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(performAutoLogout, LOGOUT_TIMEOUT_MS);
    }

    // 4. Die Events, die auf Benutzer-Aktivität lauschen
    const activityEvents = [
        'mousemove',
        'mousedown',
        'keydown',
        'touchstart', // Wichtig für Mobilgeräte
        'scroll'      // Zählt Scrollen auch als Aktivität
    ];

    // 5. Hänge die Event-Listener an das 'window'-Objekt,
    //    damit sie auf der gesamten Seite funktionieren.
    activityEvents.forEach(event => {
        window.addEventListener(event, resetInactivityTimer, true);
    });

    // 6. Den Timer beim Laden der Seite initial starten
    resetInactivityTimer();

    // --- ENDE: NEUE LOGIK FÜR AUTO-LOGOUT ---


})(); // (Skript sofort ausführen)