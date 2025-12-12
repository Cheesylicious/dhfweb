// html/js/pages/market.js

import { apiFetch } from '../utils/api.js';
import { initAuthCheck } from '../utils/auth.js';

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

    // Buttons
    let actionBtn = '';
    if (isMine) {
        actionBtn = `
            <button class="btn-cancel" onclick="window.cancelOffer(${offer.id})">
                <i class="fas fa-trash"></i> Zurückziehen
            </button>
        `;
    } else {
        actionBtn = `
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
window.acceptOffer = async function(offerId, dateStr, type) {
    const formattedDate = new Date(dateStr).toLocaleDateString('de-DE');

    if (!confirm(`Möchtest du die Schicht ${type} am ${formattedDate} wirklich übernehmen?\n\nDies erstellt einen Antrag, den der Admin noch genehmigen muss.`)) {
        return;
    }

    try {
        const res = await apiFetch(`/api/market/accept/${offerId}`, 'POST');
        alert(res.message);
        loadOffers(); // Reload UI
        // Event feuern für Notifications Update
        window.dispatchEvent(new CustomEvent('dhf:notification_update'));
    } catch (e) {
        alert("Fehler: " + e.message);
    }
};

window.cancelOffer = async function(offerId) {
    if (!confirm("Möchtest du dieses Angebot wirklich aus der Tauschbörse entfernen?")) {
        return;
    }

    try {
        const res = await apiFetch(`/api/market/offer/${offerId}`, 'DELETE');
        alert(res.message);
        loadOffers();
    } catch (e) {
        alert("Fehler: " + e.message);
    }
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