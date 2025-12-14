// html/js/pages/market.js

import { apiFetch } from '../utils/api.js';
import { initAuthCheck } from '../utils/auth.js';

let user;
let isAdmin = false;

// DOM Elemente
const marketList = document.getElementById('market-offers-list');
const myList = document.getElementById('my-offers-list');
const pendingList = document.getElementById('pending-offers-list');
const pendingCard = document.getElementById('pending-card');

// Modal Elemente
const candidateModal = document.getElementById('candidate-modal');
const candidateListUl = document.getElementById('candidate-list-ul');

// --- 1. Initialisierung ---
try {
    const authData = initAuthCheck();
    user = authData.user;
    isAdmin = authData.isAdmin;

    // Sicherheitscheck
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

    if (isAdmin) {
        document.body.classList.add('admin-mode');
    }

    // Globale Funktionen registrieren (für HTML OnClick)
    window.loadHistory = loadHistory;
    window.deleteHistoryItem = deleteHistoryItem;
    window.showCandidates = showCandidates;

    // Start: Daten laden
    loadMarketView();

} catch (e) {
    console.error("Market Init Error:", e);
}

// --- 2. Haupt-View (Markt) ---

async function loadMarketView() {
    setLoadingState();

    try {
        // Parallel alle relevanten Listen abrufen
        const [activeOffers, myOffers, pendingOffers] = await Promise.all([
            apiFetch('/api/market/offers?status=active'),
            apiFetch('/api/market/offers?status=own'),
            apiFetch('/api/market/offers?status=pending')
        ]);

        renderActiveOffers(activeOffers);
        renderMyOffers(myOffers);
        renderPendingOffers(pendingOffers);

    } catch (e) {
        console.error(e);
        if(marketList) marketList.innerHTML = `<li class="empty-state" style="color:#e74c3c;">Fehler: ${e.message}</li>`;
    }
}

function setLoadingState() {
    if (marketList) marketList.innerHTML = '<li class="empty-state"><i class="fas fa-spinner fa-spin"></i> Lade Markt...</li>';
    if (myList) myList.innerHTML = '<li class="empty-state"><i class="fas fa-spinner fa-spin"></i> Lade eigene...</li>';
    if (pendingList) pendingList.innerHTML = '<li class="empty-state"><i class="fas fa-spinner fa-spin"></i> Lade Status...</li>';
}

// --- Render Funktionen ---

function renderActiveOffers(offers) {
    if(!marketList) return;
    marketList.innerHTML = '';

    // Filtere eigene raus (die sind rechts)
    const othersOffers = offers.filter(o => !o.is_my_offer);

    if (othersOffers.length === 0) {
        marketList.innerHTML = '<li class="empty-state">Derzeit keine Angebote verfügbar.</li>';
        return;
    }

    othersOffers.forEach(offer => {
        const el = createOfferElement(offer, 'market');
        marketList.appendChild(el);
    });
}

function renderMyOffers(offers) {
    if(!myList) return;
    myList.innerHTML = '';

    // Nur aktive anzeigen
    const myActive = offers.filter(o => o.status === 'active');

    if (myActive.length === 0) {
        myList.innerHTML = '<li class="empty-state">Keine eigenen Angebote aktiv.</li>';
        return;
    }

    myActive.forEach(offer => {
        const el = createOfferElement(offer, 'mine');
        myList.appendChild(el);
    });
}

function renderPendingOffers(offers) {
    if(!pendingList) return;
    pendingList.innerHTML = '';

    if (!offers || offers.length === 0) {
        if(pendingCard) pendingCard.style.display = 'none';
        return;
    }

    if(pendingCard) pendingCard.style.display = 'flex';

    offers.forEach(offer => {
        const el = createOfferElement(offer, 'pending');
        pendingList.appendChild(el);
    });
}

function createOfferElement(offer, type) {
    const li = document.createElement('li');
    li.className = 'offer-item';
    if(type === 'pending') li.classList.add('pending-row');

    // Datum formatieren
    const shiftDate = new Date(offer.shift_date);
    const dayName = shiftDate.toLocaleDateString('de-DE', { weekday: 'short' });
    const dayDate = shiftDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });

    // Notiz
    const noteHtml = offer.note ? `<div class="offer-note"><i class="fas fa-quote-left"></i> ${escapeHtml(offer.note)}</div>` : '';

    let userLine = '';
    if (type === 'mine') {
        userLine = `<div class="offer-user" style="color:#3498db;">Dein Angebot</div>`;
    } else if (type === 'pending') {
        const from = offer.is_my_offer ? "Du" : escapeHtml(offer.offering_user_name);
        const to = offer.accepted_by_name ? `an <strong>${escapeHtml(offer.accepted_by_name)}</strong>` : "wartet...";
        userLine = `<div class="offer-user">${from} ➔ ${to}</div>`;
    } else {
        userLine = `<div class="offer-user">Von: <strong>${escapeHtml(offer.offering_user_name)}</strong></div>`;
    }

    // Jump-Button (Lupe)
    const rawDate = offer.shift_date;
    const dateOnly = rawDate.includes('T') ? rawDate.split('T')[0] : rawDate;
    const jumpBtnHtml = `
        <button class="btn-mini btn-jump" title="Im Plan anzeigen" onclick="window.jumpToOffer('${dateOnly}', ${offer.offering_user_id})">
            <i class="fas fa-search"></i>
        </button>
    `;

    // Action Buttons
    let actionsHtml = '';

    if (type === 'market') {
        // Fremdes Angebot
        actionsHtml = `
            <button class="btn-mini btn-candidates" onclick="window.showCandidates(${offer.id})" title="Kandidaten anzeigen">
                <i class="fas fa-users"></i>
            </button>
            ${jumpBtnHtml}
            <button class="btn-mini btn-accept" onclick="window.acceptOffer(${offer.id}, '${offer.shift_date}', '${offer.shift_type_abbr}')">
                <i class="fas fa-check"></i> Übernehmen
            </button>
        `;
    } else if (type === 'mine') {
        // Eigenes Angebot (JETZT MIT KANDIDATEN BUTTON)
        actionsHtml = `
            <button class="btn-mini btn-candidates" onclick="window.showCandidates(${offer.id})" title="Wer könnte das übernehmen?">
                <i class="fas fa-users"></i>
            </button>
            ${jumpBtnHtml}
            <button class="btn-mini btn-cancel" onclick="window.cancelOffer(${offer.id})" title="Zurückziehen">
                <i class="fas fa-trash"></i>
            </button>
        `;
    } else if (type === 'pending') {
        // Wartend
        actionsHtml = `
            <span style="font-size:0.8rem; color:#f39c12; margin-right:10px; font-style:italic;">
                <i class="fas fa-clock"></i> Prüfung...
            </span>
            ${jumpBtnHtml}
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
                ${actionsHtml}
            </div>
        </div>
    `;
    return li;
}

// --- 3. Feature: Kandidaten anzeigen ---

async function showCandidates(offerId) {
    if (!candidateModal || !candidateListUl) return;

    candidateModal.style.display = 'block';
    candidateListUl.innerHTML = '<li class="empty-state"><i class="fas fa-spinner fa-spin"></i> Prüfe Regeln & Dienstpläne...</li>';

    try {
        const candidates = await apiFetch(`/api/market/offer/${offerId}/candidates`);

        candidateListUl.innerHTML = '';
        if (candidates.length === 0) {
            candidateListUl.innerHTML = '<li class="empty-state">Keine passenden Kandidaten gefunden.<br><small>(Alle anderen haben Dienst, Ruhezeit oder Hundekonflikt)</small></li>';
            return;
        }

        candidates.forEach(c => {
            const li = document.createElement('li');
            li.className = 'candidate-item';

            const dogInfo = c.dog ? `<span class="candidate-dog"><i class="fas fa-paw"></i> ${c.dog}</span>` : '';

            li.innerHTML = `
                <span class="candidate-name">${c.name}</span>
                ${dogInfo}
            `;
            candidateListUl.appendChild(li);
        });

    } catch (e) {
        candidateListUl.innerHTML = `<li class="empty-state" style="color:#e74c3c;">Fehler: ${e.message}</li>`;
    }
}

// --- 4. Historie Logik ---

async function loadHistory() {
    const tbody = document.getElementById('history-table-body');
    if(!tbody) return;

    tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><i class="fas fa-spinner fa-spin"></i> Lade Chronik...</td></tr>';

    try {
        const history = await apiFetch('/api/market/history?limit=50');

        tbody.innerHTML = '';
        if (history.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Keine Einträge vorhanden.</td></tr>';
            return;
        }

        history.forEach(entry => {
            const tr = document.createElement('tr');
            const dateStr = new Date(entry.created_at).toLocaleDateString('de-DE');

            let statusBadge = `<span class="status-badge status-${entry.status}">${entry.status}</span>`;
            if(entry.status === 'done') statusBadge = `<span class="status-badge status-done">Getauscht</span>`;
            if(entry.status === 'cancelled') statusBadge = `<span class="status-badge status-cancelled">Zurückgezogen</span>`;
            if(entry.status === 'rejected') statusBadge = `<span class="status-badge status-rejected">Abgelehnt</span>`;

            let actionHtml = '';
            if (isAdmin) {
                actionHtml = `<button class="btn-mini btn-cancel" onclick="window.deleteHistoryItem(${entry.id})" title="Eintrag löschen">×</button>`;
            } else {
                actionHtml = '-';
            }

            tr.innerHTML = `
                <td>${dateStr}</td>
                <td>${entry.shift_info}</td>
                <td>${entry.offering_user}</td>
                <td>${entry.accepted_by}</td>
                <td>${statusBadge}</td>
                <td class="admin-only">${actionHtml}</td>
            `;
            tbody.appendChild(tr);
        });

        if (isAdmin) {
            document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'table-cell');
        }

    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6" style="color:#e74c3c;">Fehler: ${e.message}</td></tr>`;
    }
}

async function deleteHistoryItem(id) {
    if(!confirm("Eintrag endgültig aus der Chronik löschen?")) return;
    try {
        await apiFetch(`/api/market/history/${id}`, 'DELETE');
        loadHistory();
    } catch(e) {
        alert("Fehler: " + e.message);
    }
}


// --- 5. Global Actions (Standard) ---

window.jumpToOffer = function(dateStr, userId) {
    const highlightData = { date: dateStr, targetUserId: userId };
    localStorage.setItem('dhf_highlight_goto', JSON.stringify(highlightData));
    window.location.href = 'schichtplan.html';
};

window.acceptOffer = async function(offerId, dateStr, type) {
    const formattedDate = new Date(dateStr).toLocaleDateString('de-DE');
    if(!confirm(`Möchtest du die Schicht ${type} am ${formattedDate} übernehmen?`)) return;

    try {
        const res = await apiFetch(`/api/market/accept/${offerId}`, 'POST');
        alert(res.message || "Erfolg!");
        loadMarketView();
    } catch (e) {
        alert("Fehler: " + e.message);
    }
};

window.cancelOffer = async function(offerId) {
    if(!confirm("Angebot zurückziehen?")) return;
    try {
        await apiFetch(`/api/market/offer/${offerId}`, 'DELETE');
        loadMarketView();
    } catch (e) {
        alert("Fehler: " + e.message);
    }
};

function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}