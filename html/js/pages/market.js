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

// Modal Elemente (müssen im HTML existieren)
const responseModal = document.getElementById('response-modal');
const candidatesModal = document.getElementById('candidates-modal');
const candidatesListUl = document.getElementById('candidates-list-ul');

// --- 1. Initialisierung ---
try {
    const authData = initAuthCheck();
    user = authData.user;
    isAdmin = authData.isAdmin;

    // Sicherheitscheck
    const role = user.role ? user.role.name : '';
    if (role !== 'Hundeführer' && role !== 'admin') {
        const main = document.querySelector('main');
        if (main) {
            main.innerHTML = `
                <div style="text-align:center; padding:50px; color:#e74c3c;">
                    <h2>Zugriff verweigert</h2>
                    <p>Die Tauschbörse steht nur Diensthundeführern zur Verfügung.</p>
                    <a href="schichtplan.html" style="color:#bdc3c7;">Zurück zum Plan</a>
                </div>
            `;
        }
        throw new Error("Kein Zugriff auf Tauschbörse");
    }

    if (isAdmin) {
        document.body.classList.add('admin-mode');
    }

    // *** WICHTIG: GLOBALE ZUWEISUNGEN FÜR DIE MARKT-SEITE ***
    // Dadurch können die Funktionen vom Schichtplan (schichtplan_market.js) und von inline-onclick aufgerufen werden.
    window.loadHistory = loadHistory;
    window.deleteHistoryItem = deleteHistoryItem;

    // Diese Funktionen werden von schichtplan_market.js aufgerufen
    window.openReactionModalMarket = openReactionModal;
    window.openCandidatesModalMarket = openCandidatesModal;

    // Die Aktionsfunktionen, die im HTML oder JS verwendet werden
    window.selectCandidate = selectCandidate;
    window.cancelOffer = cancelOffer;
    window.jumpToOffer = jumpToOffer;

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

    // Nur aktive anzeigen (Pending sind oben separat)
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

        // HAB ICH SCHON REAGIERT?
        if (offer.my_response === 'interested') {
            actionsHtml = `
                <span class="status-badge status-done" title="Warte auf Bestätigung durch Anbieter"><i class="fas fa-check"></i> Interesse</span>
                ${jumpBtnHtml}
            `;
        } else if (offer.my_response === 'declined') {
            actionsHtml = `
                <span class="status-badge status-rejected"><i class="fas fa-times"></i> Abgesagt</span>
                ${jumpBtnHtml}
            `;
        } else {
            // Noch keine Reaktion -> Buttons zeigen
            actionsHtml = `
                <button class="btn-mini btn-accept" onclick="window.openReactionModalMarket(${offer.id}, 'interested')">
                    <i class="fas fa-thumbs-up"></i> Interesse
                </button>
                <button class="btn-mini btn-cancel" onclick="window.openReactionModalMarket(${offer.id}, 'declined')">
                    <i class="fas fa-thumbs-down"></i>
                </button>
                ${jumpBtnHtml}
            `;
        }

    } else if (type === 'mine') {
        // Eigenes Angebot

        // Badge für Anzahl Interessenten
        let interestBadge = '';
        if (offer.interested_count > 0) {
            interestBadge = `<span class="nav-badge" style="display:inline-block; position:relative; top:0; margin-left:5px; background:#2ecc71;">${offer.interested_count}</span>`;
        }

        actionsHtml = `
            <button class="btn-mini btn-candidates" onclick="window.openCandidatesModalMarket(${offer.id})" title="Interessenten verwalten">
                <i class="fas fa-users"></i> ${interestBadge}
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


// --- 3. REAKTION (Kandidat) ---

let currentOfferId = null;
let currentResponseType = null;

function openReactionModal(offerId, type) {
    if (!responseModal) return;

    currentOfferId = offerId;
    currentResponseType = type;

    const title = document.getElementById('response-modal-title');
    const noteInput = document.getElementById('response-note');

    if(title) title.textContent = type === 'interested' ? 'Interesse bekunden' : 'Kein Interesse';
    if(title) title.style.color = type === 'interested' ? '#2ecc71' : '#e74c3c';

    if (noteInput) {
        noteInput.value = '';
        noteInput.placeholder = type === 'interested'
            ? "Optional: Bemerkung für den Kollegen (z.B. 'Gerne, passt gut')"
            : "Optional: Grund (z.B. 'Habe schon Dienst', 'Privater Termin')";
    }

    if(responseModal) responseModal.style.display = 'block';
}

// Event Listener für Submit Button im Modal
const submitRespBtn = document.getElementById('submit-response-btn');
if (submitRespBtn) {
    submitRespBtn.onclick = async () => {
        const noteInput = document.getElementById('response-note');
        const note = noteInput ? noteInput.value : '';

        // Button sperren
        submitRespBtn.disabled = true;
        submitRespBtn.textContent = 'Sende...';

        try {
            await apiFetch(`/api/market/offer/${currentOfferId}/react`, 'POST', {
                response_type: currentResponseType,
                note: note
            });
            if(responseModal) responseModal.style.display = 'none';
            loadMarketView(); // Refresh um Badge anzuzeigen
        } catch(e) {
            alert("Fehler: " + e.message);
        } finally {
            submitRespBtn.disabled = false;
            submitRespBtn.textContent = 'Absenden';
        }
    };
}


// --- 4. KANDIDATEN VERWALTEN (Anbieter) ---

async function openCandidatesModal(offerId) {
    if (!candidatesModal || !candidatesListUl) return;

    candidatesModal.style.display = 'block';
    candidatesListUl.innerHTML = '<li class="empty-state"><i class="fas fa-spinner fa-spin"></i> Lade Daten...</li>';

    try {
        // 1. Hole Reaktionen (Wer will, wer will nicht)
        const responses = await apiFetch(`/api/market/offer/${offerId}/responses`);

        // 2. Hole Potenzielle (Wer dürfte theoretisch)
        const potentials = await apiFetch(`/api/market/offer/${offerId}/candidates`);

        candidatesListUl.innerHTML = '';

        // Map Responses by UserID für schnellen Zugriff
        const respMap = {};
        responses.forEach(r => respMap[r.user_id] = r);

        // A. Zuerst Interessenten anzeigen (Wichtigste Gruppe)
        const interested = responses.filter(r => r.response_type === 'interested');
        if (interested.length > 0) {
            candidatesListUl.innerHTML += '<li class="group-header" style="color:#2ecc71; font-weight:bold; margin-top:5px; padding:5px;">Interessiert:</li>';
            interested.forEach(r => {
                const li = document.createElement('li');
                li.className = 'candidate-item';
                li.innerHTML = `
                    <div style="flex-grow:1;">
                        <strong style="color:#fff;">${escapeHtml(r.user_name)}</strong>
                        <div style="font-size:0.8rem; color:#aaa;">"${escapeHtml(r.note || '-')}"</div>
                    </div>
                    <button class="btn-mini btn-accept" onclick="window.selectCandidate(${offerId}, ${r.user_id}, '${escapeHtml(r.user_name)}')">
                        <i class="fas fa-check"></i> Akzeptieren
                    </button>
                `;
                candidatesListUl.appendChild(li);
            });
        }

        // B. Dann Abgelehnte (nur Info)
        const declined = responses.filter(r => r.response_type === 'declined');
        if (declined.length > 0) {
             candidatesListUl.innerHTML += '<li class="group-header" style="color:#e74c3c; font-weight:bold; margin-top:15px; padding:5px; border-top:1px solid rgba(255,255,255,0.1);">Abgesagt:</li>';
             declined.forEach(r => {
                const li = document.createElement('li');
                li.className = 'candidate-item';
                li.style.opacity = '0.6';
                li.innerHTML = `
                    <div>
                        <span>${escapeHtml(r.user_name)}</span>
                        <span style="font-size:0.8rem; color:#aaa; margin-left:5px;">(${escapeHtml(r.note || 'k.A.')})</span>
                    </div>
                `;
                candidatesListUl.appendChild(li);
             });
        }

        // C. Dann "Noch offen" (Potenzielle, die noch nicht reagiert haben)
        const potentialIdsNotResponded = potentials.filter(p => !respMap[p.id]);
        if (potentialIdsNotResponded.length > 0) {
            candidatesListUl.innerHTML += '<li class="group-header" style="color:#bdc3c7; font-weight:bold; margin-top:15px; padding:5px; border-top:1px solid rgba(255,255,255,0.1);">Noch keine Antwort:</li>';
            potentialIdsNotResponded.forEach(p => {
                 const li = document.createElement('li');
                 li.className = 'candidate-item';
                 li.style.opacity = '0.8';

                 const dogInfo = p.dog ? `<small style="color:#aaa;">(${p.dog})</small>` : '';

                 li.innerHTML = `
                    <span>${escapeHtml(p.name)} ${dogInfo}</span>
                    <span style="font-size:0.8rem; color:#777; font-style:italic;">Offen</span>
                `;
                candidatesListUl.appendChild(li);
            });
        }

        if (candidatesListUl.innerHTML === '') {
            candidatesListUl.innerHTML = '<li class="empty-state">Keine Kandidaten gefunden.</li>';
        }

    } catch(e) {
        candidatesListUl.innerHTML = `<li class="empty-state" style="color:#e74c3c">Fehler: ${e.message}</li>`;
    }
}

async function selectCandidate(offerId, candidateId, candidateName) {
    if(!confirm(`Möchtest du die Schicht wirklich an ${candidateName} übergeben?`)) return;

    try {
        await apiFetch(`/api/market/offer/${offerId}/select_candidate`, 'POST', { candidate_id: candidateId });
        if(candidatesModal) candidatesModal.style.display = 'none';
        loadMarketView();
        alert("Tausch eingeleitet! Der Admin wurde informiert.");
    } catch(e) {
        alert("Fehler: " + e.message);
    }
}


// --- 5. Historie & Helpers ---

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

            let statusBadge = `<span class="status-badge status-${entry.raw_status}">${entry.status}</span>`;
            if(entry.raw_status === 'done') statusBadge = `<span class="status-badge status-done">Getauscht</span>`;
            if(entry.raw_status === 'cancelled') statusBadge = `<span class="status-badge status-cancelled">Zurückgezogen</span>`;
            if(entry.raw_status === 'rejected') statusBadge = `<span class="status-badge status-rejected">Abgelehnt</span>`;
            if(entry.raw_status === 'expired' || entry.raw_status === 'archived_no_interest') statusBadge = `<span class="status-badge status-cancelled" style="background:#555; border-color:#777;">${entry.status}</span>`;

            let actionHtml = '';
            if (isAdmin) {
                actionHtml = `<button class="btn-mini btn-cancel" onclick="window.deleteHistoryItem(${entry.id})" title="Eintrag löschen">×</button>`;
            } else {
                actionHtml = '-';
            }

            tr.innerHTML = `
                <td>${dateStr}</td>
                <td>${escapeHtml(entry.shift_info)}</td>
                <td>${escapeHtml(entry.offering_user)}</td>
                <td>${escapeHtml(entry.accepted_by)}</td>
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

// --- Global Actions ---

function jumpToOffer(dateStr, userId) {
    const highlightData = { date: dateStr, targetUserId: userId };
    localStorage.setItem('dhf_highlight_goto', JSON.stringify(highlightData));
    window.location.href = 'schichtplan.html';
}

async function cancelOffer(offerId) {
    if(!confirm("Angebot zurückziehen?")) return;
    try {
        await apiFetch(`/api/market/offer/${offerId}`, 'DELETE');
        loadMarketView();
    } catch (e) {
        alert("Fehler: " + e.message);
    }
}

function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}