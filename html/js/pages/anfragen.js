// js/pages/anfragen.js

// --- IMPORTE (Regel 4: Wiederverwendung) ---
import { API_URL, DHF_HIGHLIGHT_KEY } from '../utils/constants.js';
import { apiFetch } from '../utils/api.js';
import { initAuthCheck, logout } from '../utils/auth.js';
import { triggerNotificationUpdate, isWunschAnfrage, escapeHTML } from '../utils/helpers.js';

// --- Globales Setup ---
let user;
let isAdmin = false;
let isScheduler = false; // "Planschreiber"
let isHundefuehrer = false;

// --- Auth-Check (Regel 4: Zentralisiert) ---
try {
    // Ruft die zentrale Auth-Prüfung auf.
    // Diese Funktion kümmert sich um:
    // 1. User-Prüfung (localStorage)
    // 2. Rollen-Zuweisung (isAdmin, etc.)
    // 3. Navigations-Anpassung (Links ein/ausblenden)
    // 4. Logout-Button-Listener
    // 5. Auto-Logout-Timer (aus shared_feedback.js)
    const authData = initAuthCheck();
    user = authData.user;
    isAdmin = authData.isAdmin;
    isScheduler = authData.isPlanschreiber;
    isHundefuehrer = authData.isHundefuehrer;

    // *** SEHR WICHTIG: Zugriffsschutz (Spezifisch für diese Seite) ***
    if (!isAdmin && !isScheduler && !isHundefuehrer) {
        const wrapper = document.getElementById('content-wrapper');
        wrapper.classList.add('restricted-view');
        wrapper.innerHTML = `
            <h2 style="color: #e74c3c;">Zugriff verweigert</h2>
            <p>Nur Administratoren, Planschreiber oder Hundeführer dürfen auf die Anfragen-Verwaltung zugreifen.</p>
        `;
        document.getElementById('sub-nav-tasks').style.display = 'none';
        throw new Error("Keine berechtigte Rolle für Anfragen-Verwaltung.");
    }

    // UI-Anpassung (spezifisch für diese Seite)
    if (isAdmin) {
         document.getElementById('sub-nav-feedback').style.display = 'inline-block';
    } else {
        if (isScheduler) {
             // Planschreiber sieht Feedback-Hauptlink (wg. initAuthCheck), aber nicht den Sub-Nav-Link
             document.getElementById('sub-nav-feedback').style.display = 'none';
        } else {
             // Hundeführer sieht beides nicht (wg. initAuthCheck)
             document.getElementById('sub-nav-feedback').style.display = 'none';
        }
    }

} catch (e) {
    // Wenn initAuthCheck fehlschlägt (z.B. kein User) ODER der Zugriffsschutz oben greift,
    // wird die Ausführung dieser Datei gestoppt. Der User wird bereits umgeleitet (via auth.js).
    console.error("Fehler bei der Initialisierung von anfragen.js:", e.message);

    // Wir stoppen die weitere Ausführung des Skripts, indem wir einen leeren Error werfen
    // (um zu verhindern, dass initializePage() unten aufgerufen wird)
    throw new Error("Initialisierung gestoppt.");
}

// (Die redundante apiFetch-Funktion wurde entfernt)

// --- Seitenlogik für Anfragen-Verwaltung ---

const queryListAnfragen = document.getElementById('query-list-anfragen');
const queryListWunsch = document.getElementById('query-list-wunsch');
const filterButtonsAnfragen = document.getElementById('filter-buttons-anfragen');
const filterButtonsWunsch = document.getElementById('filter-buttons-wunsch');
const tabAnfragen = document.getElementById('sub-nav-anfragen');
const tabWunsch = document.getElementById('sub-nav-wunsch');
const tabContentAnfragen = document.getElementById('tab-content-anfragen');
const tabContentWunsch = document.getElementById('tab-content-wunsch');
const contentWrapper = document.getElementById('content-wrapper');

let currentFilterAnfragen = "offen";
let currentFilterWunsch = "offen";
let currentView = 'anfragen';
let allQueriesCache = [];
let allShiftTypesList = [];

// (Die redundante triggerNotificationUpdate-Funktion wurde entfernt)

/**
 * Lädt alle Schichtarten, damit wir "T.?" zu einer ID zuordnen können.
 */
async function loadAllShiftTypes() {
    try {
        allShiftTypesList = await apiFetch('/api/shifttypes');
    } catch (e) {
        console.error("Fehler beim Laden der Schichtarten:", e);
        alert("Kritischer Fehler: Schichtarten konnten nicht geladen werden. Genehmigen/Ablehnen ist deaktiviert.");
    }
}

/**
 * Lädt die Anfragen von der API (wird bei Tab-Wechsel und Initialisierung aufgerufen)
 */
async function loadQueries() {
    const currentList = (currentView === 'anfragen') ? queryListAnfragen : queryListWunsch;
    currentList.innerHTML = '<li>Lade Anfragen...</li>';

    try {
        // Lade IMMER alle, der Cache wird in renderQueries() gefiltert (Regel 2: Effizient)
        const queries = await apiFetch(`/api/queries?status=`);
        allQueriesCache = queries;
        renderQueries();
    } catch (error) {
        currentList.innerHTML = `<li style="color: var(--status-offen); padding: 20px;">Fehler beim Laden: ${error.message}</li>`;
    }
}

// --- Konversations-Logik (Seiten-spezifisch) ---

function renderReplies(queryId, originalQuery, replies) {
    const repliesContainer = document.getElementById(`replies-${queryId}`);
    if (!repliesContainer) return;

    repliesContainer.innerHTML = '';

    const queryDate = new Date(originalQuery.created_at).toLocaleString('de-DE', {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'});

    const originalItem = document.createElement('li');
    originalItem.className = 'reply-item';
    originalItem.style.borderBottom = '1px solid #777';
    originalItem.style.marginBottom = '5px';
    originalItem.innerHTML = `
        <div class="reply-meta" style="color: #3498db;">
            <strong>${originalQuery.sender_name} (Erstanfrage)</strong> am ${queryDate} Uhr
        </div>
        <div class="reply-text" style="font-style: italic;">
            ${escapeHTML(originalQuery.message)}
        </div>
    `;
    repliesContainer.appendChild(originalItem);

    replies.forEach(reply => {
        const li = document.createElement('li');
        li.className = 'reply-item';
        const isSelf = reply.user_id === user.id;
        const formattedDate = new Date(reply.created_at).toLocaleTimeString('de-DE', {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'});

        li.innerHTML = `
            <div class="reply-meta" style="color: ${isSelf ? '#3498db' : '#888'};">
                <strong>${reply.user_name}</strong> am ${formattedDate} Uhr
            </div>
            <div class="reply-text">
                ${escapeHTML(reply.message)}
            </div>
        `;
        repliesContainer.appendChild(li);
    });
}

async function loadConversation(queryId) {
    const itemBody = document.querySelector(`.query-item[data-id="${queryId}"] .item-body`);
    const originalQuery = allQueriesCache.find(q => q.id == queryId);

    if (!itemBody || !originalQuery || itemBody.dataset.loaded === 'true') {
        if (!originalQuery) console.error(`Konnte Query ${queryId} nicht im Cache finden.`);
        return;
    }

    const loader = itemBody.querySelector(`#replies-loader-${queryId}`);
    if (loader) loader.style.display = 'block';

    try {
        const replies = await apiFetch(`/api/queries/${queryId}/replies`);
        renderReplies(queryId, originalQuery, replies);
        itemBody.dataset.loaded = 'true';
    } catch (e) {
        const repliesContainer = itemBody.querySelector(`#replies-${queryId}`);
        if (repliesContainer) {
            repliesContainer.innerHTML = `<li style="color: red; list-style: none;">Fehler beim Laden der Konversation.</li>`;
        }
    } finally {
        if (loader) loader.style.display = 'none';
    }
}

async function sendReply(queryId) {
    const messageInput = document.getElementById(`reply-input-${queryId}`);
    const submitBtn = document.getElementById(`reply-submit-${queryId}`);
    const message = messageInput.value.trim();

    if (message.length < 3) {
        alert("Nachricht ist zu kurz.");
        return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sende...';

    try {
        await apiFetch(`/api/queries/${queryId}/replies`, 'POST', { message });
        messageInput.value = '';

        const itemBody = document.querySelector(`.query-item[data-id="${queryId}"] .item-body`);
        itemBody.dataset.loaded = 'false';

        triggerNotificationUpdate(); // (Importiert)
        await loadQueries(); // (Importiert)

        if (itemBody.style.display === 'block') {
            const originalQuery = allQueriesCache.find(q => q.id == queryId);
            if(originalQuery) {
                 await loadConversation(queryId);
            }
        }
    } catch (e) {
        alert(`Fehler beim Senden der Antwort: ${e.message}`);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Antwort senden';
    }
}

// --- Navigations- & Render-Logik (Seiten-spezifisch) ---

function handleGoToDate(queryId) {
    const query = allQueriesCache.find(q => q.id == queryId);
    if (!query) {
        alert("Fehler: Anfrage nicht im Cache gefunden."); return;
    }
    const highlightData = {
        date: query.shift_date,
        targetUserId: query.target_user_id
    };
    try {
        localStorage.setItem(DHF_HIGHLIGHT_KEY, JSON.stringify(highlightData));
        window.location.href = 'schichtplan.html';
    } catch (e) {
        console.error("Fehler beim Speichern im localStorage:", e);
        alert("Fehler bei der Weiterleitung.");
    }
}

// (Die redundante isWunschAnfrage-Funktion wurde entfernt)

function createQueryElement(query) {
    const li = document.createElement('li');
    li.className = 'query-item';
    li.dataset.id = query.id;

    let actionRequired = false;
    if (query.status === 'offen') {
        if (query.last_replier_id === null) {
            if (query.sender_user_id !== user.id) actionRequired = true;
        } else if (query.last_replier_id !== user.id) {
            actionRequired = true;
        }
    }
    if (actionRequired) li.classList.add('action-required-highlight');

    const queryDate = new Date(query.created_at).toLocaleString('de-DE', {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'});
    const shiftDate = new Date(query.shift_date).toLocaleDateString('de-DE', {day: '2-digit', month: '2-digit', year: 'numeric'});

    let actionButtons = '';
    const isWunsch = isWunschAnfrage(query); // (Importiert)

    actionButtons += `<button class="btn-goto-date" data-action="goto-date" title="Zum Tag im Schichtplan springen">Zum Termin</button>`;

    if (isWunsch && query.status === 'offen' && (isAdmin)) {
        actionButtons += `<button class="btn-approve" data-action="approve" title="Trägt die Schicht '${query.message.replace('Anfrage für:', '').trim()}' im Plan ein und schließt die Anfrage.">Genehmigen</button>`;
        actionButtons += `<button class="btn-reject" data-action="reject" title="Lehnt die Anfrage ab, setzt die Schicht auf 'FREI' und löscht die Anfrage.">Ablehnen</button>`;
        actionButtons += `<button class="btn-delete-query" data-action="delete" title="Löscht die Anfrage, ändert aber NICHTS am Schichtplan.">Löschen</button>`;
    } else if (isAdmin || isScheduler) {
        if (query.status === 'offen') {
            actionButtons += `<button class="btn-done" data-action="erledigt">Als 'erledigt' markieren</button>`;
        } else {
            actionButtons += `<button class="btn-reopen" data-action="offen">Wieder öffnen</button>`;
        }
        actionButtons += `<button class="btn-delete-query" data-action="delete">Löschen</button>`;
    } else if (isHundefuehrer) {
        if (query.sender_user_id === user.id) {
             actionButtons += `<button class="btn-delete-query" data-action="delete">Anfrage zurückziehen</button>`;
        }
    }

    const conversationSection = `
        <div class="conversation-container">
            <div id="replies-loader-${query.id}" style="text-align: center; color: #888; margin: 10px; display: none;">Lade Konversation...</div>
            <ul id="replies-${query.id}" class="query-replies-list"></ul>
        </div>
        <div class="reply-form" style="margin-top: 20px; padding-top: 10px; border-top: 1px dashed #ddd; margin-bottom: 20px;">
            <label for="reply-input-${query.id}" style="font-size: 13px; color: #3498db; font-weight: 600;">Antwort senden:</label>
            <textarea id="reply-input-${query.id}" rows="2" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 5px; font-size: 14px; box-sizing: border-box; resize: vertical;"></textarea>
            <button type="button" class="btn-primary btn-reply-submit" data-id="${query.id}" id="reply-submit-${query.id}" style="margin-top: 10px; padding: 10px 15px; font-size: 14px; font-weight: 600;">Antwort senden</button>
        </div>
    `;

    li.innerHTML = `
        <div class="item-header" data-action="toggle-body">
            <span>Von: <strong>${query.sender_name}</strong></span>
            <span>Für: <strong>${query.target_name}</strong></span>
            <span>Anfrage für Datum: <strong>${shiftDate}</strong></span>
            <span>Gesendet am: <strong>${queryDate} Uhr</strong></span>
            <span class="item-status" data-status="${query.status}">${query.status}</span>
        </div>
        <div class="item-body" data-loaded="false" data-query-id="${query.id}">
            ${conversationSection}
            <div class="item-actions" style="margin-top: 20px;">
                ${actionButtons}
            </div>
        </div>
    `;
    return li;
}

function renderQueries() {
    queryListAnfragen.innerHTML = '';
    queryListWunsch.innerHTML = '';

    const queriesWunsch = allQueriesCache.filter(q => {
        if (currentFilterWunsch !== '' && q.status !== currentFilterWunsch) return false;
        return isWunschAnfrage(q); // (Importiert)
    });

    const queriesAnfragen = allQueriesCache.filter(q => {
        if (currentFilterAnfragen !== '' && q.status !== currentFilterAnfragen) return false;
        return !isWunschAnfrage(q); // (Importiert)
    });

    if (queriesAnfragen.length === 0) {
        queryListAnfragen.innerHTML = '<li style="color: #bdc3c7; padding: 20px; text-align: center;">Keine Anfragen für diesen Filter gefunden.</li>';
    } else {
        queriesAnfragen.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        queriesAnfragen.forEach(query => queryListAnfragen.appendChild(createQueryElement(query)));
    }

    if (isAdmin) {
        if (queriesWunsch.length === 0) {
            queryListWunsch.innerHTML = '<li style="color: #bdc3c7; padding: 20px; text-align: center;">Keine Wunsch-Anfragen für diesen Filter gefunden.</li>';
        } else {
            queriesWunsch.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            queriesWunsch.forEach(query => queryListWunsch.appendChild(createQueryElement(query)));
        }
    }
}

// --- Aktions-Handler (Seiten-spezifisch) ---

async function handleUpdateStatus(id, newStatus) {
    const item = document.querySelector(`.query-item[data-id="${id}"]`);
    if (!item) return;
    try {
        const updatedQuery = await apiFetch(`/api/queries/${id}/status`, 'PUT', { status: newStatus });
        const index = allQueriesCache.findIndex(q => q.id === updatedQuery.id);
        if (index > -1) allQueriesCache[index] = updatedQuery;
        else allQueriesCache.push(updatedQuery);
        await loadQueries(); // Neu laden, um Highlights korrekt zu setzen
        triggerNotificationUpdate(); // (Importiert)
    } catch (error) {
        alert(`Fehler beim Aktualisieren: ${error.message}`);
    }
}

async function handleDelete(id) {
    const item = document.querySelector(`.query-item[data-id="${id}"]`);
    if (!item) return;
    if (!confirm("Sind Sie sicher, dass Sie diese Anfrage endgültig löschen/zurückziehen möchten?")) return;
    try {
        await apiFetch(`/api/queries/${id}`, 'DELETE');
        allQueriesCache = allQueriesCache.filter(q => q.id !== parseInt(id));
        renderQueries();
        triggerNotificationUpdate(); // (Importiert)
    } catch (error) {
        alert(`Fehler beim Löschen: ${error.message}`);
    }
}

async function handleApprove(queryId) {
    const query = allQueriesCache.find(q => q.id == queryId);
    if (!query) { alert("Fehler: Anfrage nicht gefunden."); return; }

    const prefix = "Anfrage für:";
    let abbrev = query.message.substring(prefix.length).trim().replace('?', '');
    const shiftType = allShiftTypesList.find(st => st.abbreviation === abbrev);

    if (!shiftType) {
        alert(`Fehler: Schichtart "${abbrev}" nicht im System gefunden. Kann nicht genehmigen.`);
        return;
    }
    const item = document.querySelector(`.query-item[data-id="${queryId}"]`);
    const approveBtn = item ? item.querySelector('[data-action="approve"]') : null;
    if (approveBtn) { approveBtn.disabled = true; approveBtn.textContent = 'Speichere...'; }

    try {
        await apiFetch('/api/shifts', 'POST', {
            user_id: query.target_user_id,
            date: query.shift_date,
            shifttype_id: shiftType.id
        });
        await handleUpdateStatus(queryId, 'erledigt'); // Diese Funktion lädt neu
    } catch (error) {
        alert(`Fehler beim Genehmigen: ${error.message}`);
        if (approveBtn) { approveBtn.disabled = false; approveBtn.textContent = 'Genehmigen'; }
    }
}

async function handleReject(queryId) {
    const query = allQueriesCache.find(q => q.id == queryId);
    if (!query) { alert("Fehler: Anfrage nicht gefunden."); return; }
    if (!confirm("Sind Sie sicher, dass Sie diese Anfrage ABLEHNEN möchten? \n(Die Schicht im Plan wird auf 'FREI' gesetzt und die Anfrage gelöscht.)")) return;

    const item = document.querySelector(`.query-item[data-id="${queryId}"]`);
    const rejectBtn = item ? item.querySelector('[data-action="reject"]') : null;
    if (rejectBtn) { rejectBtn.disabled = true; rejectBtn.textContent = 'Lehne ab...'; }

    try {
        await apiFetch('/api/shifts', 'POST', {
            user_id: query.target_user_id,
            date: query.shift_date,
            shifttype_id: null
        });
        await apiFetch(`/api/queries/${queryId}`, 'DELETE');
        allQueriesCache = allQueriesCache.filter(q => q.id !== parseInt(queryId));
        renderQueries();
        triggerNotificationUpdate();
    } catch (error) {
        alert(`Fehler beim Ablehnen: ${error.message}`);
        if (rejectBtn) { rejectBtn.disabled = false; rejectBtn.textContent = 'Ablehnen'; }
    }
}

// (Die redundante escapeHTML-Funktion wurde entfernt)

// --- Event-Listener (Seiten-spezifisch) ---

function initializePage() {
    if (isAdmin) {
        tabWunsch.style.display = 'inline-block';
        tabContentWunsch.style.display = 'none';
    }

    tabAnfragen.addEventListener('click', (e) => {
        e.preventDefault();
        if (currentView === 'anfragen') { loadQueries(); return; }
        currentView = 'anfragen';
        tabAnfragen.classList.add('active');
        tabWunsch.classList.remove('active');
        tabContentAnfragen.style.display = 'block';
        tabContentWunsch.style.display = 'none';
        loadQueries();
    });

    if (isAdmin) {
        tabWunsch.addEventListener('click', (e) => {
            e.preventDefault();
            if (currentView === 'wunsch') { loadQueries(); return; }
            currentView = 'wunsch';
            tabWunsch.classList.add('active');
            tabAnfragen.classList.remove('active');
            tabContentAnfragen.style.display = 'none';
            tabContentWunsch.style.display = 'block';
            loadQueries();
        });
    }

    filterButtonsAnfragen.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') {
            filterButtonsAnfragen.querySelector('button.active')?.classList.remove('active');
            e.target.classList.add('active');
            currentFilterAnfragen = e.target.dataset.filter;
            renderQueries();
        }
    });

    if (isAdmin) {
        filterButtonsWunsch.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON') {
                filterButtonsWunsch.querySelector('button.active')?.classList.remove('active');
                e.target.classList.add('active');
                currentFilterWunsch = e.target.dataset.filter;
                renderQueries();
            }
        });
    }

    contentWrapper.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        const header = e.target.closest('.item-header');
        const queryItem = e.target.closest('.query-item');

        if (!queryItem) {
             if (button && button.classList.contains('btn-reply-submit')) {
                 e.preventDefault();
                 sendReply(button.dataset.id);
             }
             return;
        }

        const id = queryItem.dataset.id;
        if (button) {
            const action = button.dataset.action;
            if (action === 'offen' || action === 'erledigt') handleUpdateStatus(id, action);
            else if (action === 'delete') handleDelete(id);
            else if (action === 'goto-date') handleGoToDate(id);
            else if (action === 'approve') handleApprove(id);
            else if (action === 'reject') handleReject(id);
            else if (button.classList.contains('btn-reply-submit')) {
                e.preventDefault();
                sendReply(id);
            }
        } else if (header) {
            const itemBody = header.nextElementSibling;
            const isCollapsed = itemBody.style.display !== 'block';
            itemBody.style.display = isCollapsed ? 'block' : 'none';
            if (isCollapsed && itemBody.dataset.loaded === 'false') {
                loadConversation(itemBody.dataset.queryId);
            }
        }
    });

    contentWrapper.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'TEXTAREA' && e.target.id.startsWith('reply-input-') && e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const queryId = e.target.closest('.item-body').dataset.queryId;
            const submitBtn = document.getElementById(`reply-submit-${queryId}`);
            if (submitBtn && !submitBtn.disabled) {
                submitBtn.click();
            }
        }
    });

    // Erster Ladevorgang
    loadAllShiftTypes().then(() => {
        loadQueries();
    });
}

// Startet die Initialisierung (der Auth-Check oben hat bereits stattgefunden)
initializePage();