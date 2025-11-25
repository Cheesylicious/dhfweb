// html/js/pages/anfragen.js

// --- IMPORTE ---
import { API_URL, DHF_HIGHLIGHT_KEY } from '../utils/constants.js';
import { apiFetch } from '../utils/api.js';
import { initAuthCheck, logout } from '../utils/auth.js';

// --- Globales Setup ---
let user;
let isAdmin = false;
let isScheduler = false; // "Planschreiber"
let isHundefuehrer = false;

// Fallback, falls Konstante nicht importiert werden kann
const LOCAL_HIGHLIGHT_KEY = 'dhf_highlight_goto';

// --- 1. Authentifizierung & Zugriffsschutz ---
try {
    const authData = initAuthCheck();
    user = authData.user;
    isAdmin = authData.isAdmin;
    isScheduler = authData.isPlanschreiber;
    isHundefuehrer = authData.isHundefuehrer;

    // *** Zugriffsschutz ***
    if (!isAdmin && !isScheduler && !isHundefuehrer) {
        const wrapper = document.getElementById('content-wrapper');
        if (wrapper) {
            wrapper.classList.add('restricted-view');
            wrapper.innerHTML = `
                <h2 style="color: #e74c3c;">Zugriff verweigert</h2>
                <p>Nur Administratoren, Planschreiber oder Hundeführer dürfen auf die Anfragen-Verwaltung zugreifen.</p>
            `;
        }
        const subNav = document.getElementById('sub-nav-tasks');
        if (subNav) subNav.style.display = 'none';

        throw new Error("Keine berechtigte Rolle für Anfragen-Verwaltung.");
    }

    // Sub-Nav anpassen
    const subNavFeedback = document.getElementById('sub-nav-feedback');
    if (isAdmin) {
        if (subNavFeedback) subNavFeedback.style.display = 'inline-block';
    } else {
        if (subNavFeedback) subNavFeedback.style.display = 'none';
    }

} catch (e) {
    console.error("Initialisierung Anfragen gestoppt:", e.message);
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

// --- NEU: BULK ELEMENTS (ANFRAGEN) ---
const bulkBarAnfragen = document.getElementById('bulk-bar-anfragen');
const selectAllAnfragen = document.getElementById('select-all-anfragen');
const btnBulkDoneAnfragen = document.getElementById('btn-bulk-done-anfragen');
const btnBulkDeleteAnfragen = document.getElementById('btn-bulk-delete-anfragen');

// --- NEU: BULK ELEMENTS (WÜNSCHE) ---
const bulkBarWunsch = document.getElementById('bulk-bar-wunsch');
const selectAllWunsch = document.getElementById('select-all-wunsch');
const btnBulkApproveWunsch = document.getElementById('btn-bulk-approve-wunsch');
const btnBulkRejectWunsch = document.getElementById('btn-bulk-reject-wunsch');
const btnBulkDeletePureWunsch = document.getElementById('btn-bulk-delete-pure-wunsch'); // NEU

let currentFilterAnfragen = "offen";
let currentFilterWunsch = "offen";
let currentView = 'anfragen';

let allQueriesCache = [];
let allShiftTypesList = [];

function triggerNotificationUpdate() {
    window.dispatchEvent(new CustomEvent('dhf:notification_update'));
}

async function loadAllShiftTypes() {
    try {
        allShiftTypesList = await apiFetch('/api/shifttypes');
    } catch (e) {
        console.error("Fehler beim Laden der Schichtarten:", e);
    }
}

async function loadQueries() {
    const currentList = (currentView === 'anfragen') ? queryListAnfragen : queryListWunsch;
    if(currentList) currentList.innerHTML = '<li>Lade Anfragen...</li>';

    // Reset Bulk Bars beim Laden
    resetBulkSelection();

    try {
        // Wir laden ALLE Status, um auch erledigte in der Liste zu haben (wichtig für Löschen)
        const queries = await apiFetch(`/api/queries`);
        allQueriesCache = queries;
        renderQueries();
    } catch (error) {
        if(currentList) currentList.innerHTML = `<li style="color: var(--status-offen); padding: 20px;">Fehler beim Laden: ${error.message}</li>`;
    }
}

function resetBulkSelection() {
    if(bulkBarAnfragen) bulkBarAnfragen.classList.remove('visible');
    if(bulkBarWunsch) bulkBarWunsch.classList.remove('visible');
    if(selectAllAnfragen) selectAllAnfragen.checked = false;
    if(selectAllWunsch) selectAllWunsch.checked = false;
}

// --- Konversations-Logik (unverändert) ---
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

    if (!itemBody || !originalQuery || itemBody.dataset.loaded === 'true') return;

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

    if (message.length < 3) { alert("Nachricht ist zu kurz."); return; }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sende...';

    try {
        await apiFetch(`/api/queries/${queryId}/replies`, 'POST', { message });
        messageInput.value = '';
        const itemBody = document.querySelector(`.query-item[data-id="${queryId}"] .item-body`);
        itemBody.dataset.loaded = 'false'; // Reload trigger
        triggerNotificationUpdate();
        await loadQueries();
    } catch (e) {
        alert(`Fehler beim Senden: ${e.message}`);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Antwort senden';
    }
}

function handleGoToDate(queryId) {
    const query = allQueriesCache.find(q => q.id == queryId);
    if (!query) return;
    const highlightData = { date: query.shift_date, targetUserId: query.target_user_id };
    try {
        localStorage.setItem(DHF_HIGHLIGHT_KEY || LOCAL_HIGHLIGHT_KEY, JSON.stringify(highlightData));
        window.location.href = 'schichtplan.html';
    } catch (e) { console.error(e); }
}

const isWunschAnfrage = (q) => q.sender_role_name === 'Hundeführer' && q.message.startsWith("Anfrage für:");

// --- (ANGEPASST) Render Element mit Checkbox ---
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

    if (isWunsch && query.status === 'offen' && isAdmin) {
        // WICHTIG: Alle drei Buttons müssen hier sein
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
    } else if (isHundefuehrer && query.sender_user_id === user.id) {
         actionButtons += `<button class="btn-delete-query" data-action="delete">Anfrage zurückziehen</button>`;
    }

    const conversationSection = `
        <div class="conversation-container">
            <div id="replies-loader-${query.id}" style="text-align: center; color: #888; margin: 10px; display: none;">Lade Konversation...</div>
            <ul id="replies-${query.id}" class="query-replies-list"></ul>
        </div>
        <div class="reply-form" style="margin-top: 20px; padding-top: 10px; border-top: 1px dashed #ddd; margin-bottom: 20px;">
            <label for="reply-input-${query.id}" style="font-size: 13px; color: #3498db; font-weight: 600;">Antwort senden:</label>
            <textarea id="reply-input-${query.id}" rows="2"></textarea>
            <button type="button" class="btn-primary btn-reply-submit" data-id="${query.id}" id="reply-submit-${query.id}" style="margin-top: 10px; padding: 10px 15px; font-size: 14px; font-weight: 600;">Antwort senden</button>
        </div>
    `;

    // --- NEU: Checkbox ---
    let checkboxHtml = '';
    // Admin und Scheduler dürfen immer, HF nur wenns eigene sind (aber HF hat kein Bulk Delete im UI Design oben)
    // Wir beschränken Bulk auf Admin/Scheduler für jetzt
    const canBulk = isAdmin || (isScheduler && !isWunsch);

    // WICHTIGE ÄNDERUNG: Checkbox immer anzeigen, wenn User berechtigt ist
    if (canBulk) {
        // Checkbox IMMER rendern, damit sie Platz einnimmt und Layout nicht springt
        checkboxHtml = `<div onclick="event.stopPropagation()" style="display:flex; align-items:center; padding-right: 10px;">
                            <input type="checkbox" class="item-chk" value="${query.id}" style="width: 18px; height: 18px; cursor: pointer;">
                        </div>`;
    } else {
        checkboxHtml = `<div></div>`;
    }

    li.innerHTML = `
        <div class="item-header" data-action="toggle-body">
            ${checkboxHtml}
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
    if(queryListAnfragen) queryListAnfragen.innerHTML = '';
    if(queryListWunsch) queryListWunsch.innerHTML = '';

    const queriesWunsch = allQueriesCache.filter(q => {
        if (currentFilterWunsch !== '' && q.status !== currentFilterWunsch) return false;
        return isWunschAnfrage(q);
    });

    const queriesAnfragen = allQueriesCache.filter(q => {
        if (currentFilterAnfragen !== '' && q.status !== currentFilterAnfragen) return false;
        return !isWunschAnfrage(q);
    });

    if (queriesAnfragen.length === 0 && queryListAnfragen) {
        queryListAnfragen.innerHTML = '<li style="color: #bdc3c7; padding: 20px; text-align: center;">Keine Anfragen gefunden.</li>';
    } else if (queryListAnfragen) {
        queriesAnfragen.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        queriesAnfragen.forEach(query => queryListAnfragen.appendChild(createQueryElement(query)));
    }

    if (isAdmin || isHundefuehrer) {
        if (queriesWunsch.length === 0 && queryListWunsch) {
            queryListWunsch.innerHTML = '<li style="color: #bdc3c7; padding: 20px; text-align: center;">Keine Wunsch-Anfragen gefunden.</li>';
        } else if (queryListWunsch) {
            queriesWunsch.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            queriesWunsch.forEach(query => queryListWunsch.appendChild(createQueryElement(query)));
        }
    }

    // Checkbox Listener anhängen
    attachCheckboxListeners();
}

// --- BULK ACTIONS LOGIK ---

function attachCheckboxListeners() {
    const checkboxes = document.querySelectorAll('.item-chk');
    checkboxes.forEach(cb => {
        cb.addEventListener('change', updateBulkBarVisibility);
        cb.addEventListener('click', (e) => e.stopPropagation());
    });
}

function updateBulkBarVisibility() {
    if (currentView === 'anfragen' && bulkBarAnfragen) {
        const selected = queryListAnfragen.querySelectorAll('.item-chk:checked');
        if (selected.length > 0) {
            bulkBarAnfragen.classList.add('visible');
            if(btnBulkDeleteAnfragen) btnBulkDeleteAnfragen.textContent = `Löschen (${selected.length})`;
        } else {
            bulkBarAnfragen.classList.remove('visible');
        }
    }
    else if (currentView === 'wunsch' && bulkBarWunsch) {
        const selected = queryListWunsch.querySelectorAll('.item-chk:checked');
        if (selected.length > 0) {
            bulkBarWunsch.classList.add('visible');
            // Button Texts anpassen
            if(btnBulkRejectWunsch) btnBulkRejectWunsch.textContent = `Markierte Ablehnen`;
            if(btnBulkDeletePureWunsch) btnBulkDeletePureWunsch.textContent = `Markierte Löschen (${selected.length})`;
        } else {
            bulkBarWunsch.classList.remove('visible');
        }
    }
}

if (selectAllAnfragen) {
    selectAllAnfragen.addEventListener('change', (e) => {
        const checkboxes = queryListAnfragen.querySelectorAll('.item-chk');
        checkboxes.forEach(cb => cb.checked = e.target.checked);
        updateBulkBarVisibility();
    });
}
if (selectAllWunsch) {
    selectAllWunsch.addEventListener('change', (e) => {
        const checkboxes = queryListWunsch.querySelectorAll('.item-chk');
        checkboxes.forEach(cb => cb.checked = e.target.checked);
        updateBulkBarVisibility();
    });
}

async function performBulkAction(endpoint, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const checkboxes = container.querySelectorAll('.item-chk:checked');
    const ids = Array.from(checkboxes).map(cb => parseInt(cb.value));

    if (ids.length === 0) return;

    if (!confirm(`Sind Sie sicher, dass Sie diese Aktion für ${ids.length} Elemente durchführen möchten?`)) return;

    try {
        const response = await apiFetch(endpoint, 'POST', { query_ids: ids });
        alert(response.message);
        await loadQueries();
        triggerNotificationUpdate();
    } catch (error) {
        alert("Fehler: " + error.message);
    }
}

// Buttons binden
if (btnBulkDoneAnfragen) btnBulkDoneAnfragen.onclick = () => performBulkAction('/api/queries/bulk_approve', 'query-list-anfragen');
if (btnBulkDeleteAnfragen) btnBulkDeleteAnfragen.onclick = () => performBulkAction('/api/queries/bulk_delete', 'query-list-anfragen');

if (btnBulkApproveWunsch) btnBulkApproveWunsch.onclick = () => performBulkAction('/api/queries/bulk_approve', 'query-list-wunsch');
if (btnBulkRejectWunsch) btnBulkRejectWunsch.onclick = () => performBulkAction('/api/queries/bulk_delete', 'query-list-wunsch');
if (btnBulkDeletePureWunsch) btnBulkDeletePureWunsch.onclick = () => performBulkAction('/api/queries/bulk_delete', 'query-list-wunsch'); // Auch Löschen nutzt bulk_delete, aber Backend filtert die Mails


// --- Einzel-Aktionen ---

async function handleUpdateStatus(id, newStatus) {
    try {
        await apiFetch(`/api/queries/${id}/status`, 'PUT', { status: newStatus });
        await loadQueries();
        triggerNotificationUpdate();
    } catch (error) {
        alert(`Fehler: ${error.message}`);
    }
}

async function handleDelete(id) {
    if (!confirm("Wirklich löschen?")) return;
    try {
        await apiFetch(`/api/queries/${id}`, 'DELETE');
        await loadQueries();
        triggerNotificationUpdate();
    } catch (error) {
        alert(`Fehler: ${error.message}`);
    }
}

async function handleApprove(queryId) {
    const query = allQueriesCache.find(q => q.id == queryId);
    if (!query) return;

    const prefix = "Anfrage für:";
    let abbrev = query.message.substring(prefix.length).trim().replace('?', '');
    const shiftType = allShiftTypesList.find(st => st.abbreviation === abbrev);

    if (!shiftType) { alert(`Fehler: Schichtart "${abbrev}" nicht gefunden.`); return; }

    try {
        await apiFetch('/api/shifts', 'POST', {
            user_id: query.target_user_id,
            date: query.shift_date,
            shifttype_id: shiftType.id
        });
        await handleUpdateStatus(queryId, 'erledigt');
    } catch (error) {
        alert(`Fehler: ${error.message}`);
    }
}

async function handleReject(queryId) {
    // WICHTIG: Dies ist die "Ablehnen" Logik, die Sie angesprochen haben.
    // Sie leert die Schicht UND löscht die Anfrage.
    if (!confirm("Anfrage ablehnen (Schicht leeren und Anfrage löschen)?")) return;
    try {
        // Zuerst Schicht leeren (falls schon was drin war)
        await apiFetch('/api/shifts', 'POST', {
            user_id: allQueriesCache.find(q=>q.id==queryId).target_user_id,
            date: allQueriesCache.find(q=>q.id==queryId).shift_date,
            shifttype_id: null
        });
        // Dann löschen (löst Mail aus)
        await apiFetch(`/api/queries/${queryId}`, 'DELETE');
        await loadQueries();
        triggerNotificationUpdate();
    } catch (error) {
        alert(`Fehler: ${error.message}`);
    }
}

function escapeHTML(str) {
    return str.replace(/[&<>"']/g, function(m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
}

// --- Init ---

async function initializePage() {
    if (isAdmin || isHundefuehrer) {
        if(tabWunsch) tabWunsch.style.display = 'inline-block';
        if(tabContentWunsch) tabContentWunsch.style.display = 'none';
    }
    if (isHundefuehrer) {
        if(tabAnfragen) tabAnfragen.style.display = 'none';
    }

    const urlParams = new URLSearchParams(window.location.search);
    const tabParam = urlParams.get('tab');

    if ((tabParam === 'wunsch' || isHundefuehrer) && (isAdmin || isHundefuehrer)) {
         currentView = 'wunsch';
         if(tabWunsch) tabWunsch.classList.add('active');
         if(tabAnfragen) tabAnfragen.classList.remove('active');
         if(tabContentAnfragen) tabContentAnfragen.style.display = 'none';
         if(tabContentWunsch) tabContentWunsch.style.display = 'block';
    } else {
         if(tabAnfragen) tabAnfragen.classList.add('active');
         if(tabContentAnfragen) tabContentAnfragen.style.display = 'block';
    }

    if(tabAnfragen) {
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
    }

    if ((isAdmin || isHundefuehrer) && tabWunsch) {
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

    if(filterButtonsAnfragen) {
        filterButtonsAnfragen.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON') {
                filterButtonsAnfragen.querySelector('button.active')?.classList.remove('active');
                e.target.classList.add('active');
                currentFilterAnfragen = e.target.dataset.filter;
                loadQueries();
            }
        });
    }

    if ((isAdmin || isHundefuehrer) && filterButtonsWunsch) {
        filterButtonsWunsch.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON') {
                filterButtonsWunsch.querySelector('button.active')?.classList.remove('active');
                e.target.classList.add('active');
                currentFilterWunsch = e.target.dataset.filter;
                loadQueries();
            }
        });
    }

    if(contentWrapper) {
        contentWrapper.addEventListener('click', (e) => {
            // Checkbox Click abfangen, damit das Accordion nicht aufklappt
            if (e.target.classList.contains('item-chk') || e.target.closest('.item-chk')) {
                // Kein e.stopPropagation() hier, da der Listener direkt an der Checkbox das schon macht
                updateBulkBarVisibility();
                return;
            }

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
    }

    await loadAllShiftTypes();
    loadQueries();
}

if (user && (isAdmin || isScheduler || isHundefuehrer)) {
    initializePage();
}