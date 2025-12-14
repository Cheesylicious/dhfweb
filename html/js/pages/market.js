// html/js/pages/market.js

import { apiFetch } from '../utils/api.js';
import { initAuthCheck } from '../utils/auth.js';

// Konstante für den Highlight-Key (muss mit schichtplan.js übereinstimmen)
const DHF_HIGHLIGHT_KEY = 'dhf_highlight_goto';

let user;

// DOM Elemente
const marketList = document.getElementById('market-offers-list');
const myList = document.getElementById('my-offers-list');

// 1. Initialisierung
try {
    const authData = initAuthCheck();
    user = authData.user;

    // Sicherheitscheck: Nur Hundeführer oder Admin
    const role = user.role ? user.role.name : '';
    if (role !== 'Hundeführer' && role !== 'admin') {
        document.querySelector('main').innerHTML = `
            <div style="text-align:center; padding:50px; color:#e74c3c;">
                <h2>Zugriff verweigert</h2>
                <p>Die Tauschbörse steht nur Diensthundeführern zur Verfügung.</p>
                <a href="schichtplan.html" style="color:#bdc3c7;">Zurück zum Plan</a>
            </div>
        `;
        throw new Error("Kein Zugriff auf Tauschbörse");
    }

    // --- NEU: Custom Modal Initialisieren (falls nicht via ui_helper geladen, hier manuell) ---
    // Da market.js keine Module aus schichtplan_* importiert, müssen wir sicherstellen,
    // dass die Funktionen da sind. Normalerweise über plan_ui_helper.
    // Aber da dies eine eigene Seite ist, importieren wir den UI Helper hier NICHT (um Abhängigkeiten klein zu halten),
    // SONDERN verlassen uns darauf, dass er bereits GLOBAL verfügbar ist ODER wir kopieren die Init-Logik.
    // BESSER: Wir importieren den Helper auch hier.

    // Wir nutzen hier dynamischen Import, falls er verfügbar ist, oder implementieren die Globals.
    // DA WIR ABER OBEN KEINEN IMPORT HABEN -> Wir fügen ihn hinzu!

    import('../modules/schichtplan_ui_helper.js').then(module => {
        // Init nur für Modal-Styles
        module.PlanUIHelper.initCustomModal();
    });

    // Daten laden
    loadOffers();

} catch (e) {
    console.error("Market Init Error:", e);
}

// 2. Daten laden
async function loadOffers() {
    setLoadingState();

    try {
        const offers = await apiFetch('/api/market/offers');
        renderOffers(offers);
    } catch (e) {
        showError(e.message);
    }
}

function setLoadingState() {
    if (marketList) marketList.innerHTML = '<li class="empty-state"><i class="fas fa-spinner fa-spin"></i> Lade Markt...</li>';
    if (myList) myList.innerHTML = '<li class="empty-state"><i class="fas fa-spinner fa-spin"></i> Lade eigene...</li>';
}

function showError(msg) {
    if (marketList) marketList.innerHTML = `<li class="empty-state" style="color:#e74c3c;">Fehler: ${msg}</li>`;
}

// 3. Rendering
function renderOffers(offers) {
    const myOffers = [];
    const marketOffers = [];

    // Sortierung: Neueste zuerst
    offers.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    offers.forEach(o => {
        if (o.is_my_offer) {
            myOffers.push(o);
        } else {
            marketOffers.push(o);
        }
    });

    // --- Markt-Angebote rendern ---
    marketList.innerHTML = '';
    if (marketOffers.length === 0) {
        marketList.innerHTML = '<li class="empty-state">Derzeit keine Angebote verfügbar.</li>';
    } else {
        marketOffers.forEach(offer => {
            const el = createOfferElement(offer, false);
            marketList.appendChild(el);
        });
    }

    // --- Eigene Angebote rendern ---
    myList.innerHTML = '';
    if (myOffers.length === 0) {
        myList.innerHTML = '<li class="empty-state">Du hast keine Schichten eingestellt.</li>';
    } else {
        myOffers.forEach(offer => {
            const el = createOfferElement(offer, true);
            myList.appendChild(el);
        });
    }
}

function createOfferElement(offer, isMine) {
    const li = document.createElement('li');
    li.className = 'offer-item';

    // "Neu"-Effekt für Angebote jünger als 24h
    const created = new Date(offer.created_at);
    const now = new Date();
    const isNew = (now - created) < (24 * 60 * 60 * 1000); // 24h
    if (isNew && !isMine) li.classList.add('new');

    // Datum formatieren
    const shiftDate = new Date(offer.shift_date);
    const dayName = shiftDate.toLocaleDateString('de-DE', { weekday: 'short' });
    const dayDate = shiftDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });

    // HTML zusammenbauen
    const noteHtml = offer.note
        ? `<div class="offer-note"><i class="fas fa-quote-left"></i> ${escapeHtml(offer.note)}</div>`
        : '';

    const userLine = isMine
        ? `<div class="offer-user" style="color:#3498db;">Dein Angebot</div>`
        : `<div class="offer-user">Von: <strong>${escapeHtml(offer.offering_user_name)}</strong></div>`;


    // --- KORREKTUR: Datum bereinigen (Nur YYYY-MM-DD) für Jump Funktion ---
    const rawDate = offer.shift_date; // z.B. "2025-05-12T00:00:00"
    const dateOnly = rawDate.includes('T') ? rawDate.split('T')[0] : rawDate;

    // Jump-Button HTML
    const jumpBtnHtml = `
        <button class="btn-jump" title="Im Plan anzeigen" onclick="window.jumpToOffer('${dateOnly}', ${offer.offering_user_id})">
            <i class="fas fa-search"></i>
        </button>
    `;

    // Buttons zusammensetzen
    let actionBtn = '';
    if (isMine) {
        actionBtn = `
            ${jumpBtnHtml}
            <button class="btn-cancel" onclick="window.cancelOffer(${offer.id})">
                <i class="fas fa-trash"></i> Zurückziehen
            </button>
        `;
    } else {
        actionBtn = `
            ${jumpBtnHtml}
            <button class="btn-accept" onclick="window.acceptOffer(${offer.id}, '${offer.shift_date}', '${offer.shift_type_abbr}')">
                <i class="fas fa-check"></i> Übernehmen
            </button>
        `;
    }

    li.innerHTML = `
        <div style="display:flex; align-items:center; width:100%;">
            <div class="offer-date-box">
                <span class="offer-day">${dayName}</span>
                <span class="offer-date">${dayDate}</span>
            </div>

            <div class="offer-details">
                <span class="offer-shift-badge" style="background-color: ${offer.shift_type_color};">
                    ${offer.shift_type_abbr}
                </span>
                ${userLine}
                ${noteHtml}
            </div>

            <div class="offer-actions">
                ${actionBtn}
            </div>
        </div>
    `;

    return li;
}

// 4. Global Functions (für OnClick)

// --- Funktion zum Springen in den Schichtplan ---
window.jumpToOffer = function(dateStr, userId) {
    // 1. Daten für den Schichtplan vorbereiten
    const highlightData = {
        date: dateStr,          // Muss "YYYY-MM-DD" sein
        targetUserId: userId    // Die ID des Users, dessen Zeile wir suchen
    };

    // 2. Im LocalStorage speichern, damit der Schichtplan es beim Laden findet
    try {
        localStorage.setItem(DHF_HIGHLIGHT_KEY, JSON.stringify(highlightData));
        // 3. Weiterleitung
        window.location.href = 'schichtplan.html';
    } catch (e) {
        console.error("Fehler beim Speichern des Sprungziels:", e);
        window.dhfAlert("Fehler", "Konnte Sprungziel nicht speichern.", "error");
    }
};

window.acceptOffer = async function(offerId, dateStr, type) {
    const formattedDate = new Date(dateStr).toLocaleDateString('de-DE');
    const msg = `Möchtest du die Schicht ${type} am ${formattedDate} wirklich übernehmen?\n\nDies erstellt einen Antrag, den der Admin noch genehmigen muss.`;

    // FIX: dhfConfirm
    window.dhfConfirm("Schicht übernehmen", msg, async () => {
        try {
            const res = await apiFetch(`/api/market/accept/${offerId}`, 'POST');
            window.dhfAlert("Erfolg", res.message || "Erfolgreich beantragt!", "success");
            loadOffers(); // Reload UI
            // Event feuern für Notifications Update
            window.dispatchEvent(new CustomEvent('dhf:notification_update'));
        } catch (e) {
            window.dhfAlert("Fehler", e.message, "error");
        }
    });
};

window.cancelOffer = async function(offerId) {
    // FIX: dhfConfirm
    window.dhfConfirm("Angebot zurückziehen", "Möchtest du dieses Angebot wirklich aus der Tauschbörse entfernen?", async () => {
        try {
            const res = await apiFetch(`/api/market/offer/${offerId}`, 'DELETE');
            // Keine Meldung bei Erfolg, nur Reload, ist flüssiger
            loadOffers();
        } catch (e) {
            window.dhfAlert("Fehler", e.message, "error");
        }
    });
};

// Helper
function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}