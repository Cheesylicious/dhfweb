// html/js/pages/dashboard.js

import { API_URL } from '../utils/constants.js';
import { apiFetch } from '../utils/api.js';
import { initAuthCheck, logout } from '../utils/auth.js';
// NEU: Theme Manager importieren
import { applyTheme, startThemePreview } from '../utils/theme_manager.js';

let user;
let isAdmin = false;

// --- DOM-Elemente (Standard) ---
const manualLogBtn = document.getElementById('manual-log-btn');
const logList = document.getElementById('update-log-list');
const manualModal = document.getElementById('manual-update-modal');
const closeManualModalBtn = document.getElementById('close-manual-log-modal');
const saveManualLogBtn = document.getElementById('save-manual-log-btn');
const logDescriptionField = document.getElementById('log-description');
const logAreaField = document.getElementById('log-area');
const manualLogStatus = document.getElementById('manual-log-status');

// --- NEWS ELEMENTE ---
const newsContainer = document.getElementById('news-container');
const newsText = document.getElementById('news-text');
const newsCheckbox = document.getElementById('news-ack-checkbox');
const newsAdminBtn = document.getElementById('news-admin-btn');
const newsEditModal = document.getElementById('news-edit-modal');
const newsEditTextarea = document.getElementById('news-edit-textarea');
const saveNewsBtn = document.getElementById('save-news-btn');
const closeNewsModalBtn = document.getElementById('close-news-modal');
const newsModalStatus = document.getElementById('news-modal-status');

// --- Gamification Elemente ---
const gamificationCard = document.getElementById('gamification-card');
const userLevelEl = document.getElementById('user-level');
const xpDisplayEl = document.getElementById('xp-display');
const xpProgressEl = document.getElementById('xp-progress');
const balanceMarkerEl = document.getElementById('balance-marker');
const balanceTextEl = document.getElementById('balance-text');
const gamificationLogList = document.getElementById('gamification-log-list');

// --- Balance Elemente (Admin Dashboard) ---
const balanceCard = document.getElementById('balance-card');

// --- NEU: Elemente für animierten Begleiter ---
const activePetContainer = document.getElementById('active-pet-container');
// --- ENDE NEU ---


// --- NEUE HELFER FUNKTION ---
// Escape-Funktion, um HTML-Sonderzeichen zu verhindern (z.B. bei 'Grund' Text)
const escapeHtml = (unsafe) => {
    if (!unsafe) return '';
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}
// --- ENDE NEUE HELFER FUNKTION ---


// --- NEU: HELPER FUNKTIONEN FÜR LOTTIE-ANIMATIONEN ---

/**
 * Initialisiert und rendert die aktive Lottie-Figur im Header.
 * @param {string | null} assetKey - Der Pfad zur Lottie JSON Datei.
 */
function renderPetAnimation(assetKey) {
    if (!activePetContainer) return;

    // Nur fortfahren, wenn Lottie global verfügbar ist (aus dashboard.html geladen)
    if (assetKey && typeof lottie !== 'undefined') {
        // Zuerst eine eventuell vorhandene Animation zerstören
        if (activePetContainer.lottieAnimation) {
            activePetContainer.lottieAnimation.destroy();
        }

        activePetContainer.style.display = 'block';

        // Lottie Animation initialisieren und speichern
        activePetContainer.lottieAnimation = lottie.loadAnimation({
            container: activePetContainer,
            renderer: 'svg',
            loop: true,
            autoplay: true,
            path: assetKey // Der Pfad zum Lottie JSON Asset
        });
    } else {
        // Keine Figur ausgewählt oder Lottie nicht geladen, Container ausblenden
        if (activePetContainer.lottieAnimation) {
            activePetContainer.lottieAnimation.destroy();
        }
        activePetContainer.style.display = 'none';
    }
}

/**
 * Globaler Helfer, um Lottie Preview in Shop-Karten zu rendern.
 * @param {string} containerId - Die ID des DOM-Containers.
 * @param {string} assetKey - Der Pfad zur Lottie JSON Datei.
 */
window.renderPetPreview = function(containerId, assetKey) {
    const container = document.getElementById(containerId);
    if (!container || !assetKey || typeof lottie === 'undefined') return;

    // Animation initialisieren
    lottie.loadAnimation({
        container: container,
        renderer: 'svg',
        loop: true,
        autoplay: true,
        path: assetKey
    });
}
// --- ENDE LOTTIE HELPER ---

// --- NEU: Globaler Helfer für Theme Preview (wird vom Button im Shop aufgerufen) ---
window.previewTheme = function(themeKey) {
    startThemePreview(themeKey);
};


// --- 1. Authentifizierung & Init ---
try {
    const authData = initAuthCheck();
    user = authData.user;
    isAdmin = authData.isAdmin;

    if (authData.isVisitor) {
        window.location.href = 'schichtplan.html';
        throw new Error("Besucher dürfen das Dashboard nicht sehen.");
    }

    // --- NEU: Theme anwenden (Priorität: Preview > User-Einstellung > Default) ---
    applyTheme(user);

    const welcomeMsg = document.getElementById('welcome-message');
    if (welcomeMsg) welcomeMsg.textContent = `Willkommen, ${user.vorname}!`;

    // NEU: Aktive Figur beim Laden anzeigen
    if (user.active_pet_asset) {
        renderPetAnimation(user.active_pet_asset);
    }
    // --- Admin UI (Obere Karte & Buttons) ---
    if (isAdmin) {
        if(manualLogBtn) manualLogBtn.classList.remove('hidden');
        if(newsAdminBtn) newsAdminBtn.style.display = 'block';

        // Button zum Neuberechnen der Fairness einfügen
        if (document.getElementById('update-log-header')) {
            const headerDiv = document.getElementById('update-log-header');
            if (!headerDiv.querySelector('.recalc-btn')) {
                const recalcBtn = document.createElement('button');
                recalcBtn.textContent = "Fairness neu berechnen";
                recalcBtn.className = "btn-secondary recalc-btn";
                recalcBtn.style.marginLeft = "10px";
                recalcBtn.style.backgroundColor = "#e67e22";
                recalcBtn.onclick = triggerFairnessRecalc;
                headerDiv.appendChild(recalcBtn);
            }
        }

        // Admin-Widget (Obere Liste) laden und anzeigen
        if (balanceCard) {
            balanceCard.style.display = 'grid';
            loadDashboardBalance();
        }

        // --- NEU: Settings Button für Gamification anzeigen ---
        const settingsBtn = document.getElementById('btn-gamification-settings');
        if(settingsBtn) settingsBtn.style.display = 'inline-block';

    } else {
        if(manualLogBtn) manualLogBtn.classList.add('hidden');
        if (balanceCard) balanceCard.style.display = 'none';

        // Settings Button sicherheitshalber ausblenden
        const settingsBtn = document.getElementById('btn-gamification-settings');
        if(settingsBtn) settingsBtn.style.display = 'none';
    }

    // --- Nudging (E-Mail Check) ---
    checkProfileCompleteness(user);

    // --- Standard Daten laden ---
    loadUpdateLog();
    loadAnnouncement();

    // --- FIX: Gamification Widget nur für Hundeführer & Admins ---
    const roleName = (user.role && user.role.name) ? user.role.name.toLowerCase() : '';
    const isAllowedForGamification = ['admin', 'hundeführer', 'hundefuehrer', 'diensthundeführer'].includes(roleName);

    if (isAllowedForGamification) {
        if (gamificationCard) gamificationCard.style.display = 'grid';
        loadGamificationData();
    } else {
        if (gamificationCard) gamificationCard.style.display = 'none';
    }

} catch (e) {
    console.error("Fehler bei der Initialisierung von dashboard.js:", e.message);
}

// --- NEU: Umschalt-Funktion (Persönlich / Rangliste / Shop / Historie) ---
window.switchGamificationView = async function(view) {
    const viewPersonal = document.getElementById('view-personal');
    const viewRanking = document.getElementById('view-ranking');
    const viewHistory = document.getElementById('view-history');
    const viewShop = document.getElementById('view-shop'); // NEU

    const btnPersonal = document.getElementById('btn-view-personal');
    const btnRanking = document.getElementById('btn-view-ranking');
    const btnHistory = document.getElementById('btn-view-history');
    const btnShop = document.getElementById('btn-view-shop'); // NEU

    // 1. Alle ausblenden
    if(viewPersonal) viewPersonal.style.display = 'none';
    if(viewRanking) viewRanking.style.display = 'none';
    if(viewHistory) viewHistory.style.display = 'none';
    if(viewShop) viewShop.style.display = 'none';

    // 2. Buttons resetten
    if(btnPersonal) btnPersonal.classList.remove('active');
    if(btnRanking) btnRanking.classList.remove('active');
    if(btnHistory) btnHistory.classList.remove('active');
    if(btnShop) btnShop.classList.remove('active');

    // 3. Ansicht wählen
    if (view === 'ranking') {
        if(viewRanking) viewRanking.style.display = 'block';
        if(btnRanking) btnRanking.classList.add('active');
        await loadRankingData();

    } else if (view === 'history') {
        if(viewHistory) viewHistory.style.display = 'block';
        if(btnHistory) btnHistory.classList.add('active');
        await loadHistoryData();

    } else if (view === 'shop') { // NEU
        if(viewShop) viewShop.style.display = 'block';
        if(btnShop) btnShop.classList.add('active');
        await loadShopData();

    } else {
        // Persönlich (Default)
        if(viewPersonal) viewPersonal.style.display = 'contents';
        if(btnPersonal) btnPersonal.classList.add('active');
    }
};

// Globale Funktion für Admin Preis-Update
window.updateShopPrice = async function(itemId) {
    const input = document.getElementById(`price-input-${itemId}`);
    if(!input) return;
    const newPrice = input.value;

    try {
        const result = await apiFetch('/api/shop/update_price', 'POST', {
            item_id: itemId,
            new_price: newPrice
        });

        if(result.success) {
            alert("Preis aktualisiert!");
            loadShopData(); // Refresh UI
        } else {
            alert("Fehler: " + result.message);
        }
    } catch(e) {
        alert("Update fehlgeschlagen: " + e.message);
    }
};

// NEUE GLOBALE FUNKTION: Item aktivieren/deaktivieren
window.toggleItemActiveStatus = async function(itemId, currentStatus, currentMessage, itemName) {
    const newStatus = !currentStatus;
    let message = '';

    if (newStatus) {
        // Wird aktiviert
        if (!confirm(`Sicher, dass Sie das Item '${itemName}' wieder AKTIVIEREN möchten?`)) return;

    } else {
        // Wird deaktiviert
        message = prompt(`Item '${itemName}' wird DEAKTIVIERT. Geben Sie eine Nachricht ein (z.B. "Wieder verfügbar ab 1. Jan"):`, currentMessage || '');
        if (message === null) return; // Abbruch durch Admin

        // Finaler Check, falls der Admin einen leeren Text eingegeben hat, aber bestätigen will
        if (message.trim() === '') {
            message = 'Aktuell nicht verfügbar.';
        }

        if (!confirm(`Item DEAKTIVIEREN mit Nachricht: "${message}"`)) return;
    }

    try {
        const result = await apiFetch('/api/shop/toggle_active', 'POST', {
            item_id: itemId,
            is_active: newStatus,
            message: message
        });

        if(result.success) {
            alert(result.message);
            loadShopData(); // UI aktualisieren
        } else {
            alert("Fehler: " + result.message);
        }
    } catch(e) {
        alert("Operation fehlgeschlagen: " + e.message);
    }
};


// --- NEU: Shop Funktionen ---
async function loadShopData() {
    const grid = document.getElementById('shop-items-grid');
    const activeContainer = document.getElementById('active-effects-container');
    if (!grid) return;

    try {
        const response = await apiFetch('/api/shop/items');

        const items = response.items;
        const activeEffects = response.active_effects;
        const userIsAdmin = response.is_admin;

        const lottieInitQueue = []; // NEU: Queue für Lottie Initialisierungen

        // 1. Aktive Effekte rendern
        if(activeContainer) {
            activeContainer.innerHTML = '';
            if(activeEffects && activeEffects.length > 0) {
                activeEffects.forEach(eff => {
                    const badge = document.createElement('div');
                    badge.className = 'active-effect-badge';
                    const multiplier = eff.multiplier ? eff.multiplier.toFixed(1) : '1.0';
                    badge.innerHTML = `
                        <i class="fas fa-bolt" style="font-size:1.5em;"></i>
                        <div>
                            <strong>${eff.name} aktiv!</strong><br>
                            <span style="font-size:0.9em;">Noch ${eff.days_left} Tage gültig (Boost: x${multiplier})</span>
                        </div>
                    `;
                    activeContainer.appendChild(badge);
                });
            }
        }

        // 2. Items rendern
        grid.innerHTML = '';
        if(!items || items.length === 0) {
            grid.innerHTML = '<p>Aktuell keine Angebote verfügbar.</p>';
            return;
        }

        const prof = await apiFetch('/api/user/profile');
        const currentXp = prof.experience_points || 0;

        items.forEach(item => {
            const card = document.createElement('div');
            card.className = 'shop-item-card';

            const canAfford = currentXp >= item.cost_xp;
            const isDisabledByAdmin = !item.is_active;
            const btnClass = 'buy-btn';
            const itemColor = isDisabledByAdmin ? '#e74c3c' : '#3498db';


            // NEUE LOGIK FÜR VISUALISIERUNG
            let itemVisualHtml = '';

            if (item.item_type === 'cosmetic_pet' && item.asset_key) {
                const petPreviewId = `pet-preview-${item.id}`;
                itemVisualHtml = `
                    <div id="${petPreviewId}" style="width: 100px; height: 100px; margin: 0 auto 15px;"></div>
                `;
                // Füge zur Initialisierungs-Queue hinzu
                lottieInitQueue.push({ containerId: petPreviewId, assetKey: item.asset_key });
            } else {
                // Standard Icon für alle anderen Item-Typen
                itemVisualHtml = `<div class="shop-icon" style="color:${itemColor};"><i class="${item.icon_class}"></i></div>`;
            }
            // ENDE NEUE LOGIK

            const priceStatus = isDisabledByAdmin
                ? `<span style="color:#e74c3c; font-weight:bold;">NICHT VERFÜGBAR</span>`
                : (item.cost_xp === 0 ? `<span style="color:#2ecc71;">KOSTENLOS</span>` : `<span style="color:#FFD700;">${item.cost_xp} <i class="fas fa-star"></i> XP</span>`);

            const btnText = isDisabledByAdmin
                ? 'Deaktiviert'
                : (item.cost_xp === 0 ? 'Aktivieren' : (canAfford ? `Kaufen (${item.cost_xp} XP)` : `Benötigt ${item.cost_xp} XP`));

            const disabledAttr = isDisabledByAdmin || (!canAfford && item.cost_xp > 0) ? 'disabled' : '';
            const bgStyle = isDisabledByAdmin ? 'background:#333; cursor:not-allowed; border: 1px dashed #e74c3c;' : '';

            let adminHtml = '';
            let deactMessageHtml = '';

            // --- KRITISCHE KORREKTUR DER ANZEIGE (Bestehende Logik) ---
            if (isDisabledByAdmin) {
                const messageText = item.deactivation_message || 'Aktuell nicht verfügbar.';
                const escapedMessage = escapeHtml(messageText);

                deactMessageHtml = `
                    <div style="background:rgba(231, 76, 60, 0.2); border-radius:5px; padding:10px; margin-bottom:10px; font-size:12px; color:#e74c3c; text-align:left;">
                        <strong>Grund:</strong> ${escapedMessage}
                    </div>
                `;
            }

            if (userIsAdmin) {
                // Admin Button Logik
                const toggleBtnColor = isDisabledByAdmin ? 'background:#2ecc71;' : 'background:#e74c3c;';
                const toggleBtnText = isDisabledByAdmin ? '✅ Aktivieren' : '❌ Deaktivieren';

                // Escape simple quotes for inline JS function call
                const cleanMessage = item.deactivation_message ? item.deactivation_message.replace(/'/g, "\\'") : '';
                const cleanName = item.name ? item.name.replace(/'/g, "\\'") : '';


                adminHtml = `
                    <div style="margin-top:10px; border-top:1px solid #444; padding-top:10px; text-align:center;">
                        <button style="${toggleBtnColor} color:white; border:none; padding: 5px 10px; border-radius: 5px; cursor:pointer; width: 100%;"
                            onclick="window.toggleItemActiveStatus(${item.id}, ${item.is_active}, '${cleanMessage}', '${cleanName}')">
                            ${toggleBtnText}
                        </button>
                    </div>
                    <div style="margin-top:10px; text-align:left;">
                        <small style="color:#aaa;">Preis:</small>
                        <input type="number" id="price-input-${item.id}" value="${item.cost_xp}" class="admin-price-input">
                        <button onclick="window.updateShopPrice(${item.id})" class="admin-price-save">OK</button>
                    </div>
                `;
            }
            // --- ENDE KRITISCHE KORREKTUR ---

            // --- NEU: Preview Button Logic für Themes ---
            let previewBtnHtml = '';
            if (item.item_type === 'theme' && item.asset_key !== 'theme-default' && !isDisabledByAdmin) {
                previewBtnHtml = `
                    <button class="btn-secondary" style="margin-top: 5px; width: 100%; background: #95a5a6; border: none; padding: 6px; border-radius: 4px; cursor: pointer; color: white;"
                            onclick="window.previewTheme('${item.asset_key}')">
                        <i class="fas fa-eye"></i> 5 Min. Testen
                    </button>
                `;
            }
            // ---------------------------------------------

            card.innerHTML = `
                <div>
                    ${itemVisualHtml}
                    <div class="shop-title">${item.name}</div>
                    ${deactMessageHtml}
                    <div class="shop-desc">${item.description}</div>
                </div>
                <div>
                    <div class="shop-price">${priceStatus}</div>
                    <button class="${btnClass}" style="${bgStyle}" ${disabledAttr} onclick="window.buyShopItem(${item.id}, '${item.item_type}', ${item.cost_xp})">
                        ${btnText}
                    </button>
                    ${previewBtnHtml}
                    ${adminHtml}
                </div>
            `;
            grid.appendChild(card);
        });

        // Initialisiere nun alle Lottie-Vorschauen, nachdem die Elemente im DOM sind
        lottieInitQueue.forEach(initData => {
            window.renderPetPreview(initData.containerId, initData.assetKey);
        });


    } catch (e) {
        grid.innerHTML = `<p style="color:#e74c3c">Laden fehlgeschlagen: ${e.message}</p>`;
    }
}


// Globale Funktion für den Kaufen-Button (Angepasst für Orakel-Loop & Dynamischen Preis)
window.buyShopItem = async function(itemId, itemType, itemCost) {
    // Wenn das Orakel-Modal NICHT offen ist (oder ein anderes Item gekauft wird), fragen wir nach Bestätigung.
    // Wenn es bereits offen ist (Loop-Kauf), überspringen wir die Bestätigung für besseren Flow.
    const oracleModal = document.getElementById('oracle-modal');
    const isOracleLoop = (itemType === 'oracle' && oracleModal && oracleModal.style.display === 'block');

    if(!isOracleLoop) {
        // Nur fragen, wenn es etwas kostet. Bei 0 XP (Standard Theme) einfach machen.
        if (itemCost > 0) {
            if(!confirm("Möchtest du dieses Item wirklich kaufen? Deine XP werden abgezogen.")) return;
        }
    }

    try {
        const result = await apiFetch('/api/shop/buy', 'POST', { item_id: itemId });

        if (result.success) {

            // SPEZIALBEHANDLUNG FÜR ORAKEL
            if (itemType === 'oracle') {
                const modal = document.getElementById('oracle-modal');
                const textEl = document.getElementById('oracle-result-text');
                const againBtn = document.getElementById('oracle-buy-again-btn');

                // Wir entfernen das Präfix, da wir eine Überschrift im Modal haben
                // und entfernen Anführungszeichen für eine schönere Optik
                let cleanMsg = result.message.replace('🔮 Das Orakel spricht:\n\n', '').replace(/"/g, '');

                if(textEl) {
                    // Kleiner Fade-Effekt für den Text
                    textEl.style.opacity = '0';
                    textEl.style.transition = 'opacity 0.2s';
                    setTimeout(() => {
                        textEl.textContent = cleanMsg;
                        textEl.style.opacity = '1';
                    }, 200);
                }

                // WICHTIG: Dem "Noch eins"-Button die Funktion für DIESES Item geben und den Preis anzeigen
                if (againBtn) {
                    // Falls itemCost übergeben wurde, nutzen wir es, sonst Fallback
                    const costText = itemCost ? itemCost : '??';
                    againBtn.textContent = `Noch eins (${costText} XP)`;

                    againBtn.onclick = function() {
                        window.buyShopItem(itemId, itemType, itemCost);
                    };
                }

                if(modal) modal.style.display = 'block';
            }
            // SPEZIALBEHANDLUNG FÜR COSMETIC PET
            else if (itemType === 'cosmetic_pet') {
                 // Hier reicht ein kleiner Alert
                 alert(result.message);
            }
            // SPEZIALBEHANDLUNG FÜR THEMES
            else if (itemType === 'theme') {
                 alert(result.message);
                 // Testphase beenden (falls aktiv)
                 localStorage.removeItem('dhf_theme_preview');

                 // User neu laden und Theme sofort anwenden
                 const updatedProfile = await apiFetch('/api/user/profile');
                 if (updatedProfile) {
                     localStorage.setItem('dhf_user', JSON.stringify(updatedProfile));
                     user = updatedProfile;
                     applyTheme(user);
                 }
            }
            else {
                // Standard Alert für Booster etc.
                alert(result.message);
            }

            // 1. Reload Shop & Gamification Data um neue XP anzuzeigen
            await loadShopData();
            await loadGamificationData();

            // 2. Benutzerprofil neu laden (für Pets & Themes wichtig)
            const updatedProfile = await apiFetch('/api/user/profile');
            if (updatedProfile) {
                localStorage.setItem('dhf_user', JSON.stringify(updatedProfile));
                user = updatedProfile;
                // Pet updaten
                if (typeof renderPetAnimation === 'function') {
                    renderPetAnimation(user.active_pet_asset);
                }
            }

        } else {
            alert("Fehler: " + result.message);
        }
    } catch (e) {
        alert("Kauf fehlgeschlagen: " + e.message);
    }
};

// Globale Funktion für Admin Preis-Update
window.updateShopPrice = async function(itemId) {
    const input = document.getElementById(`price-input-${itemId}`);
    if(!input) return;
    const newPrice = input.value;

    try {
        const result = await apiFetch('/api/shop/update_price', 'POST', {
            item_id: itemId,
            new_price: newPrice
        });

        if(result.success) {
            alert("Preis aktualisiert!");
            loadShopData(); // Refresh UI
        } else {
            alert("Fehler: " + result.message);
        }
    } catch(e) {
        alert("Update fehlgeschlagen: " + e.message);
    }
};

// --- NEU: Admin Settings Logik (bestehend) ---
window.openGamificationSettings = async function() {
    const modal = document.getElementById('gamification-settings-modal');
    if(modal) modal.style.display = 'block';

    // Aktuelle Werte laden
    try {
        const settings = await apiFetch('/api/gamification/settings');
        document.getElementById('xp-tag-workday').value = settings.xp_tag_workday;
        document.getElementById('xp-tag-weekend').value = settings.xp_tag_weekend;
        document.getElementById('xp-night').value = settings.xp_night;
        document.getElementById('xp-24h').value = settings.xp_24h;
        document.getElementById('xp-friday-6').value = settings.xp_friday_6;
        document.getElementById('xp-health-bonus').value = settings.xp_health_bonus;
        document.getElementById('xp-holiday-mult').value = settings.xp_holiday_mult;
    } catch(e) {
        console.error("Error loading settings", e);
        alert("Fehler beim Laden der Einstellungen: " + e.message);
    }
};

window.closeGamificationSettings = function() {
    const modal = document.getElementById('gamification-settings-modal');
    if(modal) modal.style.display = 'none';
};

const saveSettingsBtn = document.getElementById('save-gamification-settings-btn');
if(saveSettingsBtn) {
    saveSettingsBtn.onclick = async function() {
        const btn = this;
        btn.disabled = true;
        const statusEl = document.getElementById('gamification-settings-status');
        if(statusEl) {
            statusEl.textContent = "Speichere und berechne neu...";
            statusEl.style.color = "#bdc3c7";
        }

        const payload = {
            xp_tag_workday: document.getElementById('xp-tag-workday').value,
            xp_tag_weekend: document.getElementById('xp-tag-weekend').value,
            xp_night: document.getElementById('xp-night').value,
            xp_24h: document.getElementById('xp-24h').value,
            xp_friday_6: document.getElementById('xp-friday-6').value,
            xp_health_bonus: document.getElementById('xp-health-bonus').value,
            xp_holiday_mult: document.getElementById('xp-holiday-mult').value
        };

        try {
            await apiFetch('/api/gamification/settings', 'PUT', payload);
            if(statusEl) {
                statusEl.textContent = "Erfolgreich!";
                statusEl.style.color = "#2ecc71";
            }

            setTimeout(() => {
                window.closeGamificationSettings();
                alert("Einstellungen gespeichert. Punkte wurden für alle Benutzer neu berechnet.");
                window.location.reload();
            }, 500);
        } catch(e) {
            if(statusEl) {
                statusEl.textContent = "Fehler: " + e.message;
                statusEl.style.color = "#e74c3c";
            }
            btn.disabled = false;
        }
    };
}

// --- Ranking Daten laden ---
async function loadRankingData() {
    const tbody = document.getElementById('ranking-table-body');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:#bdc3c7;">Lade Rangliste...</td></tr>';

    try {
        const ranking = await apiFetch('/api/gamification/ranking');
        tbody.innerHTML = '';

        if (!ranking || ranking.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px;">Keine Daten verfügbar.</td></tr>';
            return;
        }

        ranking.forEach(entry => {
            const tr = document.createElement('tr');

            if (user && user.id === entry.user_id) {
                tr.style.backgroundColor = "rgba(52, 152, 219, 0.2)";
            } else {
                tr.style.borderBottom = "1px solid rgba(255,255,255,0.05)";
            }

            let rankIcon = `<span style="color:#7f8c8d; font-weight:bold; font-size: 0.9em;">${entry.position}.</span>`;
            if (entry.position === 1) rankIcon = '🥇';
            if (entry.position === 2) rankIcon = '🥈';
            if (entry.position === 3) rankIcon = '🥉';

            tr.innerHTML = `
                <td style="padding: 12px 10px; font-size: 1.2em; text-align: center;">${rankIcon}</td>
                <td style="padding: 12px 10px;">
                    <div style="font-weight: 600; color: #fff;">${entry.name} ${user && user.id === entry.user_id ? '(Du)' : ''}</div>
                </td>
                <td style="padding: 12px 10px;">
                    <span style="color: ${entry.rank_color}; border: 1px solid ${entry.rank_color}; padding: 2px 6px; border-radius: 4px; font-size: 0.85em; white-space: nowrap;">
                        ${entry.rank_title} <span style="opacity:0.7; font-size:0.9em;">(Lvl ${entry.level})</span>
                    </span>
                </td>
                <td style="padding: 12px 10px; text-align: right; font-family: monospace; font-size: 1.1em; color: #FFD700;">
                    ${entry.points.toLocaleString()} XP
                </td>
            `;
            tbody.appendChild(tr);
        });

    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="4" style="color:#e74c3c; text-align:center; padding:20px;">Fehler: ${e.message}</td></tr>`;
    }
}

// --- Historie laden ---
async function loadHistoryData() {
    const tbody = document.getElementById('history-table-body');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:20px; color:#bdc3c7;">Lade Historie...</td></tr>';

    try {
        const history = await apiFetch('/api/gamification/history');
        tbody.innerHTML = '';

        if (!history || history.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:20px; font-style:italic;">Noch keine Punkte gesammelt.</td></tr>';
            return;
        }

        history.forEach(entry => {
            const tr = document.createElement('tr');

            const isPositive = entry.points_awarded > 0;
            const sign = isPositive ? '+' : '';
            const colorClass = isPositive ? 'text-green' : (entry.points_awarded < 0 ? 'text-red' : '');

            tr.style.borderBottom = "1px solid rgba(255,255,255,0.05)";

            tr.innerHTML = `
                <td style="padding: 12px 10px; font-size: 0.9em; color: #bdc3c7;">
                    ${entry.created_at}
                </td>
                <td style="padding: 12px 10px;">
                    ${entry.description || '-'}
                </td>
                <td style="padding: 12px 10px; text-align: right; font-weight: bold;" class="${colorClass}">
                    ${sign}${entry.points_awarded} XP
                </td>
            `;
            tbody.appendChild(tr);
        });

    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="3" style="color:#e74c3c; text-align:center; padding:20px;">Fehler: ${e.message}</td></tr>`;
    }
}

// --- Admin Widget: Jahresbilanz ---
async function loadDashboardBalance() {
    const year = new Date().getFullYear();
    const badge = document.getElementById('balance-year-badge');
    if(badge) badge.innerText = `Jahr ${year}`;

    const loadingDiv = document.getElementById('balanceLoading');
    const contentDiv = document.getElementById('balanceTableContainer');
    const errorDiv = document.getElementById('dashboardBalanceError');
    const tbody = document.getElementById('dashboardBalanceBody');

    try {
        const response = await apiFetch(`/api/shift-plans/0/weekend-balance?year=${year}`);

        if(tbody) tbody.innerHTML = '';
        const users = response.data;

        if (!users || users.length === 0) {
            if(tbody) tbody.innerHTML = '<tr><td colspan="3" class="text-center py-3">Keine Daten verfügbar</td></tr>';
        } else {
            users.forEach(user => {
                const tr = document.createElement('tr');

                let barClass = 'bg-green';
                let textClass = 'text-green';

                if (user.percentage > 45) {
                    barClass = 'bg-red';
                    textClass = 'text-red';
                } else if (user.percentage > 30) {
                    barClass = 'bg-yellow';
                    textClass = 'text-yellow';
                }

                let nameBadge = '';
                if (user.possible_weekends < 12) {
                    nameBadge = '<span style="background:#3498db; color:white; font-size:10px; padding:2px 5px; border-radius:4px; margin-left:5px;">Neu</span>';
                }

                const fInitial = user.first_name ? user.first_name.charAt(0) : '?';
                const lInitial = user.last_name ? user.last_name.charAt(0) : '?';
                const initials = (fInitial + lInitial).toUpperCase();

                tr.innerHTML = `
                    <td>
                        <div style="display:flex; align-items:center;">
                            <div class="avatar-circle">${initials}</div>
                            <div>
                                <span style="display:block; font-weight:600; font-size:14px; color:#fff;">
                                    ${user.last_name}, ${user.first_name.charAt(0)}.${nameBadge}
                                </span>
                                <small style="color:#7f8c8d; font-size:11px;">
                                    ${user.actual_weekends} von ${user.possible_weekends} WE
                                </small>
                            </div>
                        </div>
                    </td>
                    <td style="text-align: center;">
                        <span class="${textClass}" style="font-weight:bold; font-size:13px;">${user.percentage}%</span>
                    </td>
                    <td>
                        <div class="table-progress">
                            <div class="table-progress-bar ${barClass}" style="width: ${user.percentage}%"></div>
                        </div>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }

        if(loadingDiv) loadingDiv.style.display = 'none';
        if(contentDiv) contentDiv.style.display = 'block';

    } catch (error) {
        console.error("Dashboard Balance Fehler:", error);
        if(loadingDiv) loadingDiv.style.display = 'none';
        if(errorDiv) {
            errorDiv.innerText = "Daten konnten nicht geladen werden.";
            errorDiv.style.display = 'block';
        }
    }
}

// --- Helper: Nudge (Profil vervollständigen) ---
function checkProfileCompleteness(currentUser) {
    if (!currentUser.email || currentUser.email.trim() === "") {
        const cardSection = document.querySelector('.card-section');
        if (cardSection && !document.getElementById('email-nudge')) {
            const alertDiv = document.createElement('div');
            alertDiv.id = 'email-nudge';
            alertDiv.style.backgroundColor = "rgba(243, 156, 18, 0.2)";
            alertDiv.style.border = "1px solid #f39c12";
            alertDiv.style.borderRadius = "8px";
            alertDiv.style.padding = "15px";
            alertDiv.style.marginBottom = "20px";
            alertDiv.style.color = "#ffffff";
            alertDiv.style.display = "flex";
            alertDiv.style.alignItems = "center";
            alertDiv.style.justifyContent = "space-between";

            alertDiv.innerHTML = `
                <div>
                    <strong style="color: #f39c12;">Profil unvollständig!</strong><br>
                    <span style="font-size: 13px; color: #ddd;">
                        Bitte hinterlegen Sie Ihre E-Mail-Adresse.
                    </span>
                </div>
                <a href="profile.html" class="btn-primary" style="text-decoration:none; font-size:13px; padding: 8px 15px; margin-left: 10px;">Jetzt eintragen</a>
            `;
            cardSection.prepend(alertDiv);
        }
    }
}

// --- Admin Button Action (Fallback Manuell) ---
async function triggerFairnessRecalc() {
    if(!confirm("Möchten Sie die Fairness-Werte (Wochenend-Dienste) für ALLE Mitarbeiter basierend auf dem aktuellen Jahr neu berechnen? Dies kann einen Moment dauern.")) return;

    try {
        const response = await apiFetch('/api/gamification/recalc', 'POST');
        alert("Erfolg: " + response.message);
        window.location.reload();
    } catch (e) {
        alert("Fehler bei der Berechnung: " + e.message);
    }
}

// --- Persönliches Gamification Widget ---
async function loadGamificationData() {
    if (!gamificationCard) return;

    try {
        const data = await apiFetch('/api/gamification/dashboard');

        // Level & XP
        if(userLevelEl) userLevelEl.textContent = data.stats.current_level;

        // NEU: XP Max dynamisch (aus API) oder fix 1000
        const xpMax = data.stats.xp_max || 1000;
        const currentLevelXp = data.stats.xp_current;

        if(xpDisplayEl) xpDisplayEl.textContent = `${currentLevelXp} / ${xpMax} XP`;
        if(xpProgressEl) xpProgressEl.style.width = `${(currentLevelXp / xpMax) * 100}%`;

        // Balance
        let balanceVal = data.stats.weekend_balance || 0;
        let displayVal = Math.max(-48, Math.min(48, balanceVal));

        if(balanceMarkerEl) {
            balanceMarkerEl.style.left = `${50 + displayVal}%`;
            if (balanceVal > 20) balanceMarkerEl.style.borderColor = "#e74c3c";
            else if (balanceVal < -20) balanceMarkerEl.style.borderColor = "#f1c40f";
            else balanceMarkerEl.style.borderColor = "#2ecc71";
        }

        if(balanceTextEl) {
            const sign = balanceVal > 0 ? '+' : '';
            const percentStr = `(${sign}${balanceVal}%)`;

            if (balanceVal > 5) {
                balanceTextEl.textContent = `Du übernimmst ${balanceVal}% mehr Wochenend-Dienste als der Durchschnitt. Vielen Dank für deinen Einsatz!`;
                balanceTextEl.style.color = "#2ecc71";
            } else if (balanceVal < -5) {
                balanceTextEl.textContent = `Du hast aktuell ${Math.abs(balanceVal)}% weniger Wochenend-Dienste als der Durchschnitt.`;
                balanceTextEl.style.color = "#bdc3c7";
            } else {
                balanceTextEl.textContent = `Deine Wochenend-Bilanz ist perfekt ausgeglichen ${percentStr}.`;
                balanceTextEl.style.color = "#3498db";
            }
        }

        // Logs
        if(gamificationLogList) {
            gamificationLogList.innerHTML = '';
            if (data.logs && data.logs.length > 0) {
                data.logs.forEach(log => {
                    const div = document.createElement('div');
                    div.className = 'gamification-log-item';
                    const dateObj = new Date(log.created_at);

                    div.innerHTML = `
                        <div>
                            <span style="display:block; font-weight:600; color:#ecf0f1;">${log.description || log.action_type}</span>
                            <span style="font-size:11px; color:#7f8c8d;">${log.created_at}</span>
                        </div>
                        <div class="points-positive">+${log.points_awarded} XP</div>
                    `;
                    gamificationLogList.appendChild(div);
                });
            } else {
                gamificationLogList.innerHTML = '<p style="color: #777; font-style: italic; font-size:13px;">Noch keine Punkte gesammelt.</p>';
            }
        }

        // NEU: Anzeige für aktiven Multiplikator im Header der Karte
        if (data.stats.active_multiplier && data.stats.active_multiplier > 1.0) {
            // Wir fügen ein kleines Badge neben dem Level hinzu, falls noch nicht da
            if (!document.getElementById('boost-badge')) {
                const badge = document.createElement('span');
                badge.id = 'boost-badge';
                badge.style.background = '#e74c3c';
                badge.style.color = 'white';
                badge.style.padding = '2px 8px';
                badge.style.borderRadius = '12px';
                badge.style.fontSize = '12px';
                badge.style.marginLeft = '10px';
                badge.innerHTML = `<i class="fas fa-bolt"></i> Boost x${data.stats.active_multiplier}`;
                document.querySelector('.gamification-header').appendChild(badge);
            }
        }

        if (gamificationCard) gamificationCard.style.display = 'grid';

    } catch (error) {
        console.error("Konnte Gamification-Daten nicht laden:", error);
    }
}

// --- Standard News Logic & Event Listeners (Unverändert) ---

async function loadAnnouncement() {
    if (!newsText) return;

    try {
        const data = await apiFetch('/api/announcement');

        if (!data.message) {
            newsText.textContent = "Keine aktuellen Mitteilungen.";
            newsText.style.color = "#777";
            if(newsCheckbox) {
                newsCheckbox.checked = true;
                newsCheckbox.disabled = true;
            }
            document.body.classList.remove('nav-locked');
            return;
        }

        newsText.textContent = data.message;
        newsText.style.color = "#ecf0f1";

        if (data.is_read) {
            if(newsCheckbox) newsCheckbox.checked = true;
            if(newsContainer) newsContainer.classList.remove('unread');
            document.body.classList.remove('nav-locked');
        } else {
            if(newsCheckbox) newsCheckbox.checked = false;
            if(newsContainer) newsContainer.classList.add('unread');
            document.body.classList.add('nav-locked');
        }

    } catch (error) {
        if(newsText) newsText.textContent = "Fehler beim Laden der Mitteilungen.";
        console.error(error);
    }
}

if (newsCheckbox) {
    newsCheckbox.addEventListener('change', async (e) => {
        if (e.target.checked) {
            try {
                await apiFetch('/api/announcement/ack', 'POST');
                if(newsContainer) newsContainer.classList.remove('unread');
                document.body.classList.remove('nav-locked');
            } catch (error) {
                alert("Fehler beim Bestätigen: " + error.message);
                e.target.checked = false;
            }
        }
    });
}

if (newsAdminBtn) {
    newsAdminBtn.onclick = () => {
        if (newsEditTextarea) {
            newsEditTextarea.value = (newsText.textContent === "Keine aktuellen Mitteilungen." || newsText.textContent === "Fehler beim Laden der Mitteilungen.") ? "" : newsText.textContent;
        }
        if (newsEditModal) {
            newsEditModal.style.display = 'block';
            if(newsModalStatus) newsModalStatus.textContent = '';
        }
    };
}

if (closeNewsModalBtn) {
    closeNewsModalBtn.onclick = () => {
        if (newsEditModal) newsEditModal.style.display = 'none';
    };
}

if (saveNewsBtn) {
    saveNewsBtn.onclick = async () => {
        saveNewsBtn.disabled = true;
        if(newsModalStatus) {
            newsModalStatus.textContent = 'Speichere...';
            newsModalStatus.style.color = '#bdc3c7';
        }

        try {
            await apiFetch('/api/announcement', 'PUT', {
                message: newsEditTextarea.value
            });
            if(newsModalStatus) {
                newsModalStatus.textContent = 'Gespeichert!';
                newsModalStatus.style.color = '#2ecc71';
            }

            setTimeout(() => {
                if (newsEditModal) newsEditModal.style.display = 'none';
                loadAnnouncement();
            }, 1000);
        } catch (error) {
            if(newsModalStatus) {
                newsModalStatus.textContent = 'Fehler: ' + error.message;
                newsModalStatus.style.color = '#e74c3c';
            }
        } finally {
            saveNewsBtn.disabled = false;
        }
    };
}

async function loadUpdateLog() {
    if (!logList) return;

    try {
        const logs = await apiFetch('/api/updatelog');

        if (logs.length === 0) {
            logList.innerHTML = '<li style="padding: 10px 0;">Keine Update-Einträge gefunden.</li>';
            return;
        }

        logList.innerHTML = '';
        logs.forEach(log => {
            const date = new Date(log.updated_at);
            const formattedDate = date.toLocaleDateString('de-DE', {
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit'
            });

            const deleteButtonHTML = isAdmin
                                   ? `<button class="delete-log-btn" data-log-id="${log.id}">×</button>`
                                   : '';
            const li = document.createElement('li');
            li.className = 'log-item';
            li.dataset.logId = log.id;
            li.innerHTML = `
                <div class="log-content">
                    <span class="log-area">${log.area}</span>
                    <span>${log.description}</span>
                    <span class="log-date">${formattedDate} Uhr</span>
                </div>
                ${deleteButtonHTML}
            `;
            logList.appendChild(li);
        });

    } catch (error) {
        logList.innerHTML = `<li style="color: #e74c3c; padding: 10px 0;">Fehler beim Laden der Updates: ${error.message}</li>`;
    }
}

async function deleteLogEntry(logId, listItem) {
    if (!confirm(`Sicher, dass Sie den Log-Eintrag #${logId} löschen möchten?`)) {
        return;
    }
    try {
        await apiFetch(`/api/updatelog/${logId}`, 'DELETE');
        listItem.style.opacity = 0;
        setTimeout(() => listItem.remove(), 300);
    } catch (error) {
        alert('Fehler beim Löschen des Eintrags: ' + error.message);
    }
}

document.addEventListener('click', (event) => {
    const target = event.target;
    if (isAdmin && target.classList.contains('delete-log-btn')) {
        const logId = target.dataset.logId;
        const listItem = target.closest('.log-item');
        if (logId && listItem) {
            deleteLogEntry(logId, listItem);
        }
    }
});

if (manualLogBtn) {
    manualLogBtn.onclick = () => {
        if (!isAdmin || !manualModal) return;
        if(logDescriptionField) logDescriptionField.value = '';
        if(logAreaField) logAreaField.value = '';
        if(manualLogStatus) manualLogStatus.textContent = '';
        manualModal.style.display = 'block';
    };
}

if (closeManualModalBtn) {
    closeManualModalBtn.onclick = () => {
        if(manualModal) manualModal.style.display = 'none';
    };
}

if (saveManualLogBtn) {
    saveManualLogBtn.onclick = async () => {
        const description = logDescriptionField.value.trim();
        const area = logAreaField.value.trim();
        if (description.length < 5) {
            if(manualLogStatus) manualLogStatus.textContent = "Bitte geben Sie eine detailliertere Beschreibung ein (min. 5 Zeichen).";
            return;
        }

        saveManualLogBtn.disabled = true;
        if(manualLogStatus) {
            manualLogStatus.textContent = 'Speichere Protokoll...';
            manualLogStatus.style.color = '#bdc3c7';
        }

        const payload = { description: description };
        if (area) payload.area = area;

        try {
            await apiFetch('/api/manual_update_log', 'POST', payload);
            if(manualLogStatus) {
                manualLogStatus.textContent = 'Protokoll erfolgreich gespeichert!';
                manualLogStatus.style.color = '#2ecc71';
            }
            await loadUpdateLog();
            setTimeout(() => { if(manualModal) manualModal.style.display = 'none'; }, 1000);
        } catch (error) {
            if(manualLogStatus) {
                 manualLogStatus.textContent = 'Fehler beim Speichern: ' + error.message;
                 manualLogStatus.style.color = '#e74c3c';
            }
        } finally {
            saveManualLogBtn.disabled = false;
        }
    };
}

window.onclick = (event) => {
    // Schließen aller möglichen Modals bei Klick außerhalb
    const rModal = document.getElementById('ranking-modal');
    const manualModal = document.getElementById('manual-update-modal');
    const newsEditModal = document.getElementById('news-edit-modal');
    const settingsModal = document.getElementById('gamification-settings-modal');

    if (event.target == manualModal && manualModal) manualModal.style.display = 'none';
    if (event.target == newsEditModal && newsEditModal) newsEditModal.style.display = 'none';
    if (event.target == settingsModal && settingsModal) settingsModal.style.display = 'none';
};