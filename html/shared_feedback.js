/**
 * DHF-Planer - Geteiltes Feedback-Modul
 * Steuert den "Problem melden" Button und das Modal global auf allen Seiten.
 */

import { API_URL } from './js/utils/constants.js';
import { apiFetch } from './js/utils/api.js';
import { initAuthCheck } from './js/utils/auth.js';

(function() {
    // Verhindert doppeltes Laden des Skripts
    if (document.getElementById('feedback-modal-styles')) {
        return;
    }

    // Auf der Passwort-Seite das Modal deaktivieren, um Fokus nicht zu stören
    if (window.location.href.indexOf('change_password.html') > -1) {
        return;
    }

    let user, isAdmin;

    // 1. Auth-Check
    try {
        const authData = initAuthCheck();
        user = authData.user;
        isAdmin = authData.isAdmin;
    } catch (e) {
        // Falls Auth fehlschlägt (z.B. Login-Seite), brechen wir stillschweigend ab
        return;
    }

    // --- 2. CSS Styles ---
    const styles = `
        .feedback-modal { display: none; position: fixed; z-index: 200000; left: 0; top: 0; width: 100%; height: 100%; overflow: auto; background-color: rgba(0,0,0,0.6); }
        .feedback-modal-content { background: rgba(30, 30, 30, 0.8); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); border: 1px solid rgba(255, 255, 255, 0.1); margin: 10% auto; padding: 0; width: 90%; max-width: 550px; border-radius: 8px; box-shadow: 0 4px 30px rgba(0, 0, 0, 0.4); color: #ffffff; }
        .feedback-modal-header { display: flex; justify-content: space-between; align-items: center; padding: 15px 25px; border-bottom: 1px solid rgba(255, 255, 255, 0.1); }
        .feedback-modal-header h2 { margin: 0; color: #ffffff; font-weight: 600; font-size: 1.2rem; }
        .feedback-close { color: #bdc3c7; font-size: 28px; font-weight: bold; cursor: pointer; transition: color 0.3s; }
        .feedback-close:hover { color: #ffffff; }
        .feedback-modal-body { padding: 25px; }
        .feedback-modal-footer { padding: 15px 25px; background: rgba(0, 0, 0, 0.2); border-top: 1px solid rgba(255, 255, 255, 0.1); text-align: right; border-radius: 0 0 8px 8px; }
        .feedback-form-group { margin-bottom: 15px; }
        .feedback-form-group label { display: block; margin-bottom: 8px; font-weight: 300; color: #bdc3c7; }
        .feedback-form-group input[type="text"], .feedback-form-group select, .feedback-form-group textarea { width: 100%; padding: 10px; box-sizing: border-box; background: rgba(0, 0, 0, 0.2); border: 1px solid #3498db; border-radius: 5px; color: #ffffff; font-family: 'Poppins', sans-serif; font-size: 14px; }
        .feedback-form-group textarea { min-height: 120px; resize: vertical; }
        .feedback-form-group select { -webkit-appearance: none; -moz-appearance: none; appearance: none; background-image: url('data:image/svg+xml;utf8,<svg fill="white" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M7 10l5 5 5-5z"/></svg>'); background-repeat: no-repeat; background-position-x: 98%; background-position-y: 50%; padding-right: 30px; }
        .feedback-type-selection { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 15px; }
        .feedback-type-selection input[type="radio"] { display: none; }
        .feedback-type-selection label { display: block; padding: 12px; background: rgba(0,0,0,0.2); border: 1px solid #555; border-radius: 5px; text-align: center; cursor: pointer; transition: background-color 0.3s, border-color 0.3s; font-weight: 500; color: #bdc3c7; }
        .feedback-type-selection input[type="radio"]:checked + label { background: #3498db; border-color: #3498db; color: white; box-shadow: 0 0 10px rgba(52, 152, 219, 0.5); }
        #feedback-modal-status { text-align: left; font-weight: 500; float: left; line-height: 38px; }
        .feedback-btn-primary { background: #007bff; color: white; padding: 10px 15px; border: none; border-radius: 5px; cursor: pointer; font-size: 15px; transition: opacity 0.3s; }
        .feedback-btn-primary:hover { opacity: 0.8; }
        .feedback-btn-primary:disabled { background: #555; opacity: 0.7; cursor: not-allowed; }
        @keyframes blink-animation { 0%, 100% { background-color: #e74c3c; transform: scale(1); } 50% { background-color: #f1c40f; transform: scale(1.1); } }
        .nav-badge.blinking { animation: blink-animation 1.5s infinite; display: inline-flex !important; transform-origin: center center; }
    `;

    const styleSheet = document.createElement("style");
    styleSheet.id = "feedback-modal-styles";
    styleSheet.innerText = styles;
    document.head.appendChild(styleSheet);

    // --- 3. Kategorien dynamisch auslesen (KORRIGIERT) ---
    function generateDynamicCategories() {
        const addedCategories = new Set();
        let optionsHtml = '';
        let activeContextName = null;
        let mainCategoriesHtml = '';

        // 1. Kontext aus Sub-Nav holen
        const subNav = document.querySelector('.sub-nav');
        if (subNav) {
            const activeLink = subNav.querySelector('a.active, .dropdown .dropbtn.active');
            if (activeLink) {
                 // Wir nehmen nur den Textknoten, um evtl. Icons zu ignorieren
                 if (activeLink.firstChild && activeLink.firstChild.nodeType === 3) {
                     activeContextName = activeLink.firstChild.textContent.trim();
                 } else {
                     activeContextName = activeLink.textContent.trim().replace(/\s*&raquo;$/, '');
                 }
                 optionsHtml += `<option value="${activeContextName}" selected>Aktueller Kontext: ${activeContextName}</option>`;
                 addedCategories.add(activeContextName);
            }
        }

        // 2. Kontext aus Haupt-Nav holen
        const mainNav = document.querySelector('header nav');
        if (mainNav) {
            mainNav.querySelectorAll('a').forEach(link => {
                if (link.offsetWidth > 0 && link.offsetHeight > 0) { // Nur sichtbare Links
                    let categoryName = "";

                    // KORREKTUR: Wir holen NUR den direkten Text, ignorieren Badges (<span>)
                    // Das behebt das Problem, dass "Meldungen 0" zu "0" wurde.
                    if (link.firstChild && link.firstChild.nodeType === 3) { // 3 = Text Node
                        categoryName = link.firstChild.textContent.trim();
                    } else {
                        // Fallback: Alles holen und Zahlen am Ende entfernen
                        categoryName = link.textContent.replace(/\d+$/, '').trim();
                    }

                    if (categoryName && !addedCategories.has(categoryName)) {
                        const isSelected = categoryName === activeContextName ? 'selected' : '';
                        mainCategoriesHtml += `<option value="${categoryName}" ${isSelected}>${categoryName}</option>`;
                        addedCategories.add(categoryName);
                    }
                }
            });
        }

        // 3. Statische Fallbacks
        let staticOptionsHtml = '';
        if (!addedCategories.has('Dashboard')) staticOptionsHtml += '<option value="Dashboard">Dashboard</option>';
        staticOptionsHtml += '<option value="Login">Login / Startseite</option>';
        staticOptionsHtml += '<option value="Allgemein">Allgemein / Sonstiges</option>';

        return optionsHtml + mainCategoriesHtml + staticOptionsHtml;
    }

    // Modal HTML
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
                        <select id="feedback-category"></select>
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

    // Initiale Befüllung
    const catSelect = document.getElementById('feedback-category');
    if(catSelect) catSelect.innerHTML = generateDynamicCategories();

    // --- 4. Logik ---

    const modal = document.getElementById('feedback-modal');
    const openBtn = document.getElementById('global-report-btn');
    const closeBtn = document.getElementById('feedback-close-btn');
    const submitBtn = document.getElementById('feedback-submit-btn');
    const statusEl = document.getElementById('feedback-modal-status');
    const navBadge = document.getElementById('feedback-badge');

    // Badge Update Funktion
    async function updateFeedbackCount() {
        if (!isAdmin || !navBadge) return;
        try {
            const data = await apiFetch('/api/feedback/count_new', 'GET');
            const count = data.count || 0;
            if (count > 0) {
                navBadge.textContent = count;
                navBadge.classList.add('blinking');
                navBadge.style.display = 'inline-flex';
            } else {
                navBadge.textContent = 0;
                navBadge.classList.remove('blinking');
                navBadge.style.display = 'none';
            }
        } catch (error) {
            navBadge.style.display = 'none';
        }
    }

    // Intervall starten für Admins
    if (isAdmin) {
        updateFeedbackCount();
        setInterval(updateFeedbackCount, 30000);
    }

    // Öffnen
    if (openBtn) {
        openBtn.onclick = (e) => {
            e.preventDefault(); // Verhindert Konflikte
            modal.style.display = 'block';
            statusEl.textContent = '';
            statusEl.style.color = '';
            document.getElementById('feedback-message').value = '';
            // Kategorien neu laden (falls Kontext geändert)
            document.getElementById('feedback-category').innerHTML = generateDynamicCategories();
        };
    }

    // Schließen
    if(closeBtn) closeBtn.onclick = () => { modal.style.display = 'none'; };
    window.addEventListener('click', (event) => {
        if (event.target == modal) modal.style.display = 'none';
    });

    // Senden
    if(submitBtn) submitBtn.onclick = async () => {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sende...';
        statusEl.textContent = '';

        try {
            const payload = {
                report_type: document.querySelector('input[name="feedback_type"]:checked').value,
                category: document.getElementById('feedback-category').value,
                message: document.getElementById('feedback-message').value,
                page_context: window.location.pathname
            };

            if (!payload.message) throw new Error("Bitte geben Sie eine Nachricht ein.");

            await apiFetch('/api/feedback', 'POST', payload);

            if (isAdmin) await updateFeedbackCount();

            statusEl.textContent = 'Vielen Dank! Meldung gesendet.';
            statusEl.style.color = '#2ecc71';
            submitBtn.textContent = 'Gesendet!';

            setTimeout(() => {
                modal.style.display = 'none';
                submitBtn.disabled = false;
                submitBtn.textContent = 'Absenden';
            }, 2000);

        } catch (error) {
            statusEl.textContent = `Fehler: ${error.message}`;
            statusEl.style.color = '#e74c3c';
            submitBtn.disabled = false;
            submitBtn.textContent = 'Absenden';
        }
    };
})();