// cheesylicious/dhfweb/dhfweb-ec604d738e9bd121b65cc8557f8bb98d2aa18062/html/anfragen.js

// --- Globales Setup ---
const API_URL = 'http://46.224.63.203:5000';
let user;
let isAdmin = false;
let isScheduler = false; // "Planschreiber"
let isHundefuehrer = false;

// Key für localStorage (zum Springen in den Schichtplan)
const DHF_HIGHLIGHT_KEY = 'dhf_highlight_goto';

// --- Auth-Check und Logout-Setup ---
async function logout() {
    try { await apiFetch('/api/logout', 'POST'); }
    catch (e) { console.error(e); }
    finally {
        localStorage.removeItem('dhf_user');
        window.location.href = 'index.html?logout=true';
    }
}

try {
    user = JSON.parse(localStorage.getItem('dhf_user'));
    if (!user || !user.vorname || !user.role) { throw new Error("Kein User oder fehlende Rolle"); }
    document.getElementById('welcome-user').textContent = `Willkommen, ${user.vorname}!`;

    isAdmin = user.role.name === 'admin';
    isScheduler = user.role.name === 'Planschreiber';
    isHundefuehrer = user.role.name === 'Hundeführer';

    // *** Zugriffsschutz ***
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

    // UI-Anpassung
    if (isAdmin) {
        document.getElementById('nav-users').style.display = 'inline-flex';
        document.getElementById('nav-feedback').style.display = 'inline-flex';
        document.getElementById('sub-nav-feedback').style.display = 'inline-block';
    } else {
        document.getElementById('nav-users').style.display = 'none';
        if (isScheduler) {
             document.getElementById('nav-feedback').style.display = 'inline-flex';
             document.getElementById('sub-nav-feedback').style.display = 'none';
        } else {
             document.getElementById('nav-feedback').style.display = 'none';
             document.getElementById('sub-nav-feedback').style.display = 'none';
        }
    }
    document.getElementById('nav-dashboard').style.display = 'inline-flex';

    document.getElementById('logout-btn').onclick = logout;

} catch (e) {
    if (!e.message.includes("berechtigte Rolle")) {
         logout();
    }
}

// --- Globale API-Funktion ---
async function apiFetch(endpoint, method = 'GET', body = null) {
    const options = {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
    };
    if (body) { options.body = JSON.stringify(body); }
    const response = await fetch(API_URL + endpoint, options);
    if (response.status === 401 || response.status === 403) {
        if (response.status === 401) { logout(); }
        throw new Error('Sitzung ungültig oder fehlende Rechte.');
    }
    const contentType = response.headers.get("content-type");
    let data;
    if (contentType && contentType.indexOf("application/json") !== -1) {
        data = await response.json();
    } else {
        data = { message: await response.text() };
    }
    if (!response.ok) {
        throw new Error(data.message || 'API-Fehler');
    }
    return data;
}


// --- Seitenlogik ---

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

function triggerNotificationUpdate() {
    window.dispatchEvent(new CustomEvent('dhf:notification_update'));
}

/**
 * Lädt Schichtarten für Genehmigung (Admin only)
 */
async function loadAllShiftTypes() {
    try {
        allShiftTypesList = await apiFetch('/api/shifttypes');
    } catch (e) {
        console.error("Fehler beim Laden der Schichtarten:", e);
    }
}

/**
 * Lädt Anfragen
 */
async function loadQueries() {
    const currentList = (currentView === 'anfragen') ? queryListAnfragen : queryListWunsch;

    currentList.innerHTML = '<li>Lade Anfragen...</li>';

    try {
        // Lade ALLE, Filterung erfolgt im Client (renderQueries)
        const queries = await apiFetch(`/api/queries?status=`);
        allQueriesCache = queries;
        renderQueries();
    } catch (error) {
        currentList.innerHTML = `<li style="color: var(--status-offen); padding: 20px;">Fehler beim Laden: ${error.message}</li>`;
    }
}

// --- Konversations-Logik ---

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

        triggerNotificationUpdate();
        await loadQueries();

        if (itemBody.style.display === 'block') {
            const originalQuery = allQueriesCache.find(q => q.id == queryId);
            if(originalQuery) await loadConversation(queryId);
        }
    } catch (e) {
        alert(`Fehler beim Senden der Antwort: ${e.message}`);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Antwort senden';
    }
}

// --- Helper ---

function handleGoToDate(queryId) {
    const query = allQueriesCache.find(q => q.id == queryId);
    if (!query) { alert("Fehler: Anfrage nicht im Cache."); return; }

    const highlightData = {
        date: query.shift_date,
        targetUserId: query.target_user_id
    };
    try {
        localStorage.setItem(DHF_HIGHLIGHT_KEY, JSON.stringify(highlightData));
        window.location.href = 'schichtplan.html';
    } catch (e) {
        console.error("LocalStorage Fehler:", e);
    }
}

const isWunschAnfrage = (q) => {
    return q.sender_role_name === 'Hundeführer' && q.message.startsWith("Anfrage für:");
};

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
    const isWunsch = isWunschAnfrage(query);

    actionButtons += `<button class="btn-goto-date" data-action="goto-date">Zum Termin</button>`;

    if (isWunsch && query.status === 'offen' && (isAdmin)) {
        actionButtons += `<button class="btn-approve" data-action="approve">Genehmigen</button>`;
        actionButtons += `<button class="btn-reject" data-action="reject">Ablehnen</button>`;
        actionButtons += `<button class="btn-delete-query" data-action="delete">Löschen</button>`;
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
        return isWunschAnfrage(q);
    });

    const queriesAnfragen = allQueriesCache.filter(q => {
        if (currentFilterAnfragen !== '' && q.status !== currentFilterAnfragen) return false;
        return !isWunschAnfrage(q);
    });

    if (queriesAnfragen.length === 0) {
        queryListAnfragen.innerHTML = '<li style="color: #bdc3c7; padding: 20px; text-align: center;">Keine Anfragen für diesen Filter gefunden.</li>';
    } else {
        queriesAnfragen.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        queriesAnfragen.forEach(query => queryListAnfragen.appendChild(createQueryElement(query)));
    }

    if (isAdmin || isHundefuehrer) {
        if (queriesWunsch.length === 0) {
            queryListWunsch.innerHTML = '<li style="color: #bdc3c7; padding: 20px; text-align: center;">Keine Wunsch-Anfragen für diesen Filter gefunden.</li>';
        } else {
            queriesWunsch.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            queriesWunsch.forEach(query => queryListWunsch.appendChild(createQueryElement(query)));
        }
    }
}

// --- Actions ---

async function handleUpdateStatus(id, newStatus) {
    try {
        const updatedQuery = await apiFetch(`/api/queries/${id}/status`, 'PUT', { status: newStatus });
        await loadQueries();
        triggerNotificationUpdate();
    } catch (error) {
        alert(`Fehler beim Aktualisieren: ${error.message}`);
    }
}

async function handleDelete(id) {
    if (!confirm("Sind Sie sicher, dass Sie diese Anfrage endgültig löschen/zurückziehen möchten?")) return;
    try {
        await apiFetch(`/api/queries/${id}`, 'DELETE');
        await loadQueries();
        triggerNotificationUpdate();
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
        alert(`Fehler: Schichtart "${abbrev}" nicht im System gefunden.`);
        return;
    }

    try {
        await apiFetch('/api/shifts', 'POST', {
            user_id: query.target_user_id,
            date: query.shift_date,
            shifttype_id: shiftType.id
        });
        await handleUpdateStatus(queryId, 'erledigt');
    } catch (error) {
        alert(`Fehler beim Genehmigen: ${error.message}`);
    }
}

async function handleReject(queryId) {
    const query = allQueriesCache.find(q => q.id == queryId);
    if (!query) { alert("Fehler: Anfrage nicht gefunden."); return; }
    if (!confirm("Sind Sie sicher, dass Sie diese Anfrage ABLEHNEN möchten? \n(Die Schicht im Plan wird auf 'FREI' gesetzt und die Anfrage gelöscht.)")) return;

    try {
        await apiFetch('/api/shifts', 'POST', {
            user_id: query.target_user_id,
            date: query.shift_date,
            shifttype_id: null
        });
        await apiFetch(`/api/queries/${queryId}`, 'DELETE');
        await loadQueries();
        triggerNotificationUpdate();
    } catch (error) {
        alert(`Fehler beim Ablehnen: ${error.message}`);
    }
}

function escapeHTML(str) {
    return str.replace(/[&<>"']/g, function(m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
}

// --- Init ---

async function initializePage() {
    // --- KORREKTUR: Tab-Steuerung für Hundeführer ---
    if (isAdmin || isHundefuehrer) {
        tabWunsch.style.display = 'inline-block';
        tabContentWunsch.style.display = 'none';
    }

    if (isHundefuehrer) {
        // Hundeführer sieht den "Alle Anfragen"-Tab nicht
        tabAnfragen.style.display = 'none';
    }

    const urlParams = new URLSearchParams(window.location.search);
    const tabParam = urlParams.get('tab');

    // --- KORREKTUR: Automatischer Tab-Wechsel ---
    // Wenn (Parameter gesetzt ODER Hundeführer) UND Berechtigung
    if ((tabParam === 'wunsch' || isHundefuehrer) && (isAdmin || isHundefuehrer)) {
         currentView = 'wunsch';
         tabWunsch.classList.add('active');
         tabAnfragen.classList.remove('active');
         tabContentAnfragen.style.display = 'none';
         tabContentWunsch.style.display = 'block';
    } else {
         // Standard (nur Admin/Planschreiber)
         tabAnfragen.classList.add('active');
         tabContentAnfragen.style.display = 'block';
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

    if (isAdmin || isHundefuehrer) {
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
            loadQueries();
        }
    });

    if (isAdmin || isHundefuehrer) {
        filterButtonsWunsch.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON') {
                filterButtonsWunsch.querySelector('button.active')?.classList.remove('active');
                e.target.classList.add('active');
                currentFilterWunsch = e.target.dataset.filter;
                loadQueries();
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
            if (submitBtn && !submitBtn.disabled) submitBtn.click();
        }
    });

    await loadAllShiftTypes();
    loadQueries();
}

if (isAdmin || isScheduler || isHundefuehrer) {
    initializePage();
}