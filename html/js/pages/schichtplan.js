// js/pages/schichtplan.js
// --- IMPORTE (Regel 4: Modularisierung) ---

// Utilities
import { apiFetch } from '../utils/api.js';
import { initAuthCheck, logout } from '../utils/auth.js';
import { isColorDark, isWunschAnfrage, triggerNotificationUpdate } from '../utils/helpers.js';
import {
    API_URL,
    SHORTCUT_STORAGE_KEY,
    COLOR_STORAGE_KEY,
    DHF_HIGHLIGHT_KEY,
    DEFAULT_SHORTCUTS,
    DEFAULT_COLORS,
    COL_WIDTH_NAME,
    COL_WIDTH_DETAILS,
    COL_WIDTH_UEBERTRAG,
    COL_WIDTH_DAY,
    COL_WIDTH_TOTAL
} from '../utils/constants.js';

// --- (Globale Variablen sind jetzt gekapselt) ---

/**
 * Gekapselter Status der Anwendung (vermeidet globale Variablen)
 */
const state = {
    loggedInUser: null,
    currentDate: new Date(),
    currentYear: new Date().getFullYear(),
    currentMonth: new Date().getMonth() + 1,
    allUsers: [],
    allShiftTypes: {},
    allShiftTypesList: [],
    currentShifts: {},
    currentShiftsLastMonth: {},
    currentTotals: {},
    currentViolations: new Set(),
    currentSpecialDates: {},
    colorSettings: {},
    hoveredCellContext: null,
    currentStaffingActual: {},
    currentPlanStatus: {},
    currentShiftQueries: [],
    shortcutMap: {},
    isVisitor: false,
    isAdmin: false,
    isPlanschreiber: false,
    isHundefuehrer: false,
    isStaffingSortingMode: false,
    sortableStaffingInstance: null,
    computedColWidthName: COL_WIDTH_NAME, // Berechnete Breite
    computedColWidthDetails: COL_WIDTH_DETAILS, // Berechnete Breite
    modalContext: { userId: null, dateStr: null },
    clickModalContext: null,
    modalQueryContext: { userId: null, dateStr: null, userName: null, queryId: null }
};

/**
 * Sammlung aller DOM-Elemente (vermeidet globale Konstanten)
 */
const dom = {
    gridContainer: document.getElementById('schichtplan-grid-container'),
    grid: document.getElementById('schichtplan-grid'),
    staffingGridContainer: document.getElementById('staffing-grid-container'),
    staffingGrid: document.getElementById('staffing-grid'),
    monthLabel: document.getElementById('current-month-label'),
    prevMonthBtn: document.getElementById('prev-month-btn'),
    nextMonthBtn: document.getElementById('next-month-btn'),
    staffingSortToggleBtn: document.getElementById('staffing-sort-toggle'),
    planStatusContainer: document.getElementById('plan-status-container'),
    planStatusBadge: document.getElementById('plan-status-badge'),
    planLockBtn: document.getElementById('plan-lock-btn'),
    planStatusToggleBtn: document.getElementById('plan-status-toggle-btn'),
    shiftModal: document.getElementById('shift-modal'),
    shiftModalTitle: document.getElementById('shift-modal-title'),
    shiftModalInfo: document.getElementById('shift-modal-info'),
    shiftSelection: document.getElementById('shift-selection'),
    closeShiftModalBtn: document.getElementById('close-shift-modal'),
    queryModal: document.getElementById('query-modal'),
    closeQueryModalBtn: document.getElementById('close-query-modal'),
    queryModalTitle: document.getElementById('query-modal-title'),
    queryModalInfo: document.getElementById('query-modal-info'),
    queryExistingContainer: document.getElementById('query-existing-container'),
    queryExistingMessage: document.getElementById('query-existing-message'),
    queryAdminActions: document.getElementById('query-admin-actions'),
    queryResolveBtn: document.getElementById('query-resolve-btn'),
    queryDeleteBtn: document.getElementById('query-delete-btn'),
    queryNewContainer: document.getElementById('query-new-container'),
    queryMessageInput: document.getElementById('query-message-input'),
    querySubmitBtn: document.getElementById('query-submit-btn'),
    queryModalStatus: document.getElementById('query-modal-status'),
    queryTargetSelection: document.getElementById('query-target-selection'),
    targetTypeUser: document.getElementById('target-type-user'),
    targetTypeDay: document.getElementById('target-type-day'),
    queryReplyForm: document.getElementById('query-reply-form'),
    replyMessageInput: document.getElementById('reply-message-input'),
    replySubmitBtn: document.getElementById('reply-submit-btn'),
    queryRepliesList: document.getElementById('query-replies-list'),
    clickActionModal: document.getElementById('click-action-modal'),
    camTitle: document.getElementById('cam-title'),
    camSubtitle: document.getElementById('cam-subtitle'),
    camAdminWunschActions: document.getElementById('cam-admin-wunsch-actions'),
    camAdminShifts: document.getElementById('cam-admin-shifts'),
    camHundefuehrerRequests: document.getElementById('cam-hundefuehrer-requests'),
    camNotizActions: document.getElementById('cam-notiz-actions'),
    camHundefuehrerDelete: document.getElementById('cam-hundefuehrer-delete'),
    camBtnApprove: document.getElementById('cam-btn-approve'),
    camBtnReject: document.getElementById('cam-btn-reject'),
    camLinkNotiz: document.getElementById('cam-link-notiz'),
    camLinkDelete: document.getElementById('cam-link-delete')
};

// --- HILFSFUNKTIONEN (Spezifisch für diese Seite) ---

/**
 * Findet eine Zelle anhand ihres data-key Attributs.
 * (Regel 2: Effizienter als document.querySelector)
 * @param {string} key - z.B. "1-2025-11-17"
 * @returns {HTMLElement|null}
 */
function findCellByKey(key) {
    return dom.grid.querySelector(`[data-key="${key}"]`);
}

/**
 * Schließt ein beliebiges Modal
 * @param {HTMLElement} modalEl
 */
function closeModal(modalEl) {
    if (modalEl) {
        modalEl.style.display = 'none';
    }
}

// --- CLICK-MODAL FUNKTIONEN (Logik 1:1 übernommen) ---

function hideClickActionModal() {
    if (dom.clickActionModal) {
        dom.clickActionModal.style.display = 'none';
    }
    state.clickModalContext = null;
}

function showClickActionModal(event, user, dateStr, cell, isCellOnOwnRow) {
    event.preventDefault();
    hideClickActionModal(); // Schließe alle vorherigen

    const userName = `${user.vorname} ${user.name}`;
    const d = new Date(dateStr);
    const dateDisplay = d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });

    const queryId = cell.dataset.queryId;
    const query = queryId ? state.currentShiftQueries.find(q => q.id == queryId) : null;
    const isWunsch = query && isWunschAnfrage(query);
    const planGesperrt = (state.currentPlanStatus && state.currentPlanStatus.is_locked);

    state.clickModalContext = {
        userId: user.id, dateStr: dateStr, userName: userName,
        queryId: queryId, query: query, isWunsch: isWunsch,
        isPlanGesperrt: planGesperrt
    };

    dom.camTitle.textContent = `${userName}`;
    dom.camSubtitle.textContent = `${dateDisplay}`;

    dom.camAdminWunschActions.style.display = 'none';
    dom.camAdminShifts.style.display = 'none';
    dom.camHundefuehrerRequests.style.display = 'none';
    dom.camNotizActions.style.display = 'none';
    dom.camHundefuehrerDelete.style.display = 'none';

    let hasContent = false;

    if (state.isAdmin) {
        if (isWunsch && query.status === 'offen' && !planGesperrt) {
            dom.camAdminWunschActions.style.display = 'grid';
            dom.camBtnApprove.textContent = `Genehmigen (${query.message.replace('Anfrage für:', '').trim()})`;
            hasContent = true;
        }
        if (!planGesperrt) {
            dom.camAdminShifts.style.display = 'grid';
            populateClickModalShiftButtons('admin');
            hasContent = true;
        }
        dom.camNotizActions.style.display = 'block';
        dom.camLinkNotiz.textContent = queryId ? '❓ Anfrage/Notiz ansehen...' : '❓ Text-Notiz erstellen...';
        hasContent = true;

    } else if (state.isPlanschreiber) {
        dom.camNotizActions.style.display = 'block';
        dom.camLinkNotiz.textContent = queryId ? '❓ Anfrage/Notiz ansehen...' : '❓ Text-Notiz erstellen...';
        hasContent = true;

    } else if (state.isHundefuehrer && isCellOnOwnRow) {
        if (query && query.sender_user_id === state.loggedInUser.id && !planGesperrt) {
            dom.camHundefuehrerDelete.style.display = 'block';
            dom.camLinkDelete.textContent = isWunsch ? 'Wunsch-Anfrage zurückziehen' : 'Notiz löschen';
            hasContent = true;
        } else if (!query && !planGesperrt) {
            dom.camHundefuehrerRequests.style.display = 'grid';
            populateClickModalShiftButtons('hundefuehrer');
            hasContent = true;
        }
    }

    if (!hasContent) {
        hideClickActionModal();
        return;
    }

    const cellRect = cell.getBoundingClientRect();
    const modalWidth = dom.clickActionModal.offsetWidth || 300;
    const modalHeight = dom.clickActionModal.offsetHeight;
    const docWidth = document.documentElement.clientWidth;
    const docHeight = document.documentElement.clientHeight;

    let left = cellRect.left + window.scrollX;
    let top = cellRect.bottom + window.scrollY + 5;

    if (left + modalWidth > docWidth) {
        left = docWidth - modalWidth - 10;
    }
    if (cellRect.bottom + modalHeight + 5 > docHeight) {
        top = cellRect.top + window.scrollY - modalHeight - 5;
    }

    dom.clickActionModal.style.left = `${left}px`;
    dom.clickActionModal.style.top = `${top}px`;
    dom.clickActionModal.style.display = 'block';
}

function populateClickModalShiftButtons(mode) {
    let targetContainer;
    let buttonDefs;

    if (mode === 'admin') {
        targetContainer = dom.camAdminShifts;
        buttonDefs = [
            { abbrev: 'T.', title: 'Tag (T.)' }, { abbrev: 'N.', title: 'Nacht (N.)' },
            { abbrev: '6', title: 'Kurz (6)' }, { abbrev: 'FREI', title: 'FREI' },
            { abbrev: 'U', title: 'Urlaub (U)' }, { abbrev: 'X', title: 'Wunschfrei (X)' },
            { abbrev: 'Alle...', title: 'Alle Schichten anzeigen', isAll: true }
        ];
    } else {
        targetContainer = dom.camHundefuehrerRequests;
        buttonDefs = [
            { abbrev: 'T.?', title: 'Tag-Wunsch' }, { abbrev: 'N.?', title: 'Nacht-Wunsch' },
            { abbrev: '6?', title: 'Kurz-Wunsch' }, { abbrev: 'X?', title: 'Wunschfrei' },
            { abbrev: '24?', title: '24h-Wunsch' }
        ];
    }

    targetContainer.innerHTML = `<div class="cam-section-title">${mode === 'admin' ? 'Schicht zuweisen' : 'Wunsch-Anfrage'}</div>`;

    buttonDefs.forEach(def => {
        const btn = document.createElement('button');
        btn.className = def.isAll ? 'cam-shift-button all' : 'cam-shift-button';
        btn.textContent = def.abbrev;
        btn.title = def.title;

        btn.onclick = () => {
            if (mode === 'admin') {
                if (def.isAll) {
                    openShiftModal(state.clickModalContext.userId, state.clickModalContext.dateStr, state.clickModalContext.userName);
                } else {
                    const shiftType = state.allShiftTypesList.find(st => st.abbreviation === def.abbrev);
                    if (shiftType) {
                        saveShift(shiftType.id, state.clickModalContext.userId, state.clickModalContext.dateStr);
                    }
                }
            } else {
                requestShift(def.abbrev, state.clickModalContext.userId, state.clickModalContext.dateStr);
            }
            hideClickActionModal();
        };
        targetContainer.appendChild(btn);
    });
}

// --- LEGACY SHIFT MODAL (FALLBACK) ---
function openShiftModal(userId, dateStr, userName) {
    if (!state.isAdmin || (state.currentPlanStatus && state.currentPlanStatus.is_locked)) {
        return;
    }
    const d = new Date(dateStr);
    const dateDisplay = d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' });
    state.modalContext = { userId, dateStr };
    dom.shiftModalTitle.textContent = "Alle Schichten zuweisen";
    dom.shiftModalInfo.textContent = `Für: ${userName} am ${dateDisplay}`;
    dom.shiftModal.style.display = 'block';
}

// --- QUERY MODAL FUNKTIONEN (Logik 1:1 übernommen) ---

function renderReplies(replies, originalQuery) {
    if (!dom.queryRepliesList) return;
    const originalQueryItem = document.getElementById('initial-query-item');
    if (originalQueryItem) {
        const senderName = originalQuery.sender_name || "Unbekannt";
        const formattedDate = new Date(originalQuery.created_at).toLocaleTimeString('de-DE', {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'});
        originalQueryItem.innerHTML = `
            <div class="reply-meta"><strong>${senderName} (Erstanfrage)</strong> am ${formattedDate} Uhr</div>
            <div class="reply-text" style="font-style: italic;">${originalQuery.message}</div>`;
    }
    let currentChild = dom.queryRepliesList.lastElementChild;
    while (currentChild) {
        const prev = currentChild.previousElementSibling;
        if (currentChild.id !== 'initial-query-item') {
            dom.queryRepliesList.removeChild(currentChild);
        }
        currentChild = prev;
    }
    replies.forEach(reply => {
        const li = document.createElement('li');
        li.className = 'reply-item';
        const isSelf = reply.user_id === state.loggedInUser.id;
        const formattedDate = new Date(reply.created_at).toLocaleTimeString('de-DE', {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'});
        li.innerHTML = `
            <div class="reply-meta" style="color: ${isSelf ? '#3498db' : '#888'};"><strong>${reply.user_name}</strong> am ${formattedDate} Uhr</div>
            <div class="reply-text">${reply.message}</div>`;
        dom.queryRepliesList.appendChild(li);
    });
    const conversationContainer = document.getElementById('query-conversation-container');
    if(conversationContainer) {
        conversationContainer.scrollTop = conversationContainer.scrollHeight;
    }
}

async function loadQueryConversation(queryId, originalQuery) {
    if (!queryId || !originalQuery) return;
    try {
        const replies = await apiFetch(`/api/queries/${queryId}/replies`);
        renderReplies(replies, originalQuery);
    } catch (e) {
        console.error("Fehler beim Laden der Konversation:", e);
        if(dom.queryRepliesList) dom.queryRepliesList.innerHTML = `<li style="color:red; list-style: none; padding: 10px 0;">Fehler beim Laden der Antworten: ${e.message}</li>`;
    }
}

function updateQueryModalInfo(dateDisplay) {
     const selectedTypeEl = document.querySelector('input[name="query-target-type"]:checked');
     const selectedType = selectedTypeEl ? selectedTypeEl.value : 'user';
     let targetText = (selectedType === 'user' && state.modalQueryContext.userName) ? state.modalQueryContext.userName : "Thema des Tages / Allgemein";
     dom.queryModalInfo.textContent = `Für: ${targetText} am ${dateDisplay}`;
}

function attachQueryTypeListeners(userName, dateDisplay) {
    if (!dom.queryTargetSelection) return;
    function handleQueryTypeChange(event) {
        if (event.target.name === 'query-target-type') {
            updateQueryModalInfo(dateDisplay);
        }
    }
    // Remove old listener to avoid duplicates
    dom.queryTargetSelection.removeEventListener('change', handleQueryTypeChange);
    dom.queryTargetSelection.addEventListener('change', handleQueryTypeChange);
}

function openQueryModal(userId, dateStr, userName, queryId) {
    const d = new Date(dateStr);
    const dateDisplay = d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' });

    state.modalQueryContext = { userId, dateStr, userName, queryId: queryId || null };
    dom.queryModalStatus.textContent = "";
    dom.queryMessageInput.value = "";
    dom.replyMessageInput.value = '';
    dom.queryReplyForm.style.display = 'none';
    const conversationContainer = document.getElementById('query-conversation-container');
    if(conversationContainer) conversationContainer.style.display = 'none';

    if (dom.queryTargetSelection) {
        dom.targetTypeUser.checked = true;
        const isNewQuery = !queryId;
        dom.queryTargetSelection.style.display = isNewQuery ? 'block' : 'none';
        if (state.isHundefuehrer && !state.isAdmin && !state.isPlanschreiber) {
             dom.queryTargetSelection.style.display = 'none';
        }
        attachQueryTypeListeners(userName, dateDisplay);
    }

    const query = queryId ? state.currentShiftQueries.find(q => q.id == queryId) : null;

    if (query) {
        dom.queryExistingContainer.style.display = 'block';
        dom.queryNewContainer.style.display = 'none';
        loadQueryConversation(queryId, query);
        if(conversationContainer) conversationContainer.style.display = 'block';
        dom.queryReplyForm.style.display = 'block';

        if (state.isAdmin || state.isPlanschreiber) {
            dom.queryAdminActions.style.display = 'flex';
            if (dom.queryResolveBtn) dom.queryResolveBtn.style.display = 'block';
            if (dom.queryDeleteBtn) dom.queryDeleteBtn.textContent = 'Anfrage löschen';
        } else if (state.isHundefuehrer && query.sender_user_id === state.loggedInUser.id) {
             dom.queryAdminActions.style.display = 'flex';
             if (dom.queryResolveBtn) dom.queryResolveBtn.style.display = 'none';
             if (dom.queryDeleteBtn) dom.queryDeleteBtn.textContent = 'Anfrage zurückziehen';
        } else {
            dom.queryAdminActions.style.display = 'none';
        }
        let targetName = query.target_name || "Thema des Tages / Allgemein";
        dom.queryModalInfo.textContent = `Für: ${targetName} am ${dateDisplay}`;
    } else {
        dom.queryExistingContainer.style.display = 'none';
        dom.queryAdminActions.style.display = 'none';
        dom.queryNewContainer.style.display = 'block';
        dom.queryReplyForm.style.display = 'none';
        updateQueryModalInfo(dateDisplay);
    }
    dom.queryModal.style.display = 'block';
}

// --- DATENLADE-FUNKTIONEN ---

async function loadColorSettings() {
    let fetchedColors = { ...DEFAULT_COLORS }; // Kopie erstellen
    try {
        const data = await apiFetch('/api/settings');
        for(const key in DEFAULT_COLORS) {
            if (data[key] !== undefined && data[key] !== null) {
                fetchedColors[key] = data[key];
            }
        }
        state.colorSettings = fetchedColors;
    } catch (error) {
         console.error("Fehler beim Laden der globalen Einstellungen:", error.message);
         state.colorSettings = { ...DEFAULT_COLORS };
    }
    const root = document.documentElement.style;
    for (const key in state.colorSettings) {
        root.setProperty(`--${key.replace(/_/g, '-')}`, state.colorSettings[key]);
    }
}

async function loadSpecialDates(year) {
     try {
        const holidays = await apiFetch(`/api/special_dates?type=holiday&year=${year}`);
        const training = await apiFetch(`/api/special_dates?type=training&year=${year}`);
        const shooting = await apiFetch(`/api/special_dates?type=shooting&year=${year}`);

        state.currentSpecialDates = {};
        training.forEach(d => { if(d.date) state.currentSpecialDates[d.date] = d.type; });
        shooting.forEach(d => { if(d.date) state.currentSpecialDates[d.date] = d.type; });
        holidays.forEach(d => { if(d.date) state.currentSpecialDates[d.date] = 'holiday'; });
    } catch (error) {
         console.error("Fehler beim Laden der Sondertermine:", error.message);
    }
}

async function loadShiftQueries() {
    if (!state.isAdmin && !state.isPlanschreiber && !state.isHundefuehrer) return;
    try {
        const queries = await apiFetch(`/api/queries?year=${state.currentYear}&month=${state.currentMonth}&status=offen`);
        state.currentShiftQueries = queries;
    } catch (e) {
        console.error("Fehler beim Laden der Schicht-Anfragen", e);
        state.currentShiftQueries = [];
    }
}

async function populateStaticElements(forceReload = false) {
    if (Object.keys(state.allShiftTypes).length === 0 || forceReload) {
        const typeData = await apiFetch('/api/shifttypes');
        state.allShiftTypesList = typeData;
        state.allShiftTypes = {};
        typeData.forEach(st => state.allShiftTypes[st.id] = st);
    }

    const legendeArbeit = document.getElementById('legende-arbeit');
    const legendeAbwesenheit = document.getElementById('legende-abwesenheit');
    const legendeSonstiges = document.getElementById('legende-sonstiges');

    if (legendeArbeit) legendeArbeit.innerHTML = '';
    if (legendeAbwesenheit) legendeAbwesenheit.innerHTML = '';
    if (legendeSonstiges) legendeSonstiges.innerHTML = '';
    dom.shiftSelection.innerHTML = '';

    const sortedTypes = state.allShiftTypesList;
    const specialAbbreviations = ['QA', 'S', 'DPG'];

    sortedTypes.forEach(st => {
        const item = document.createElement('div');
        item.className = 'legende-item';
        item.innerHTML = `
            <div class="legende-color" style="background-color: ${st.color};"></div>
            <span class="legende-name"><strong>${st.abbreviation}</strong> (${st.name})</span>`;

        if (specialAbbreviations.includes(st.abbreviation)) {
            if (legendeSonstiges) legendeSonstiges.appendChild(item);
        } else if (st.is_work_shift) {
            if (legendeArbeit) legendeArbeit.appendChild(item);
        } else {
            if (legendeAbwesenheit) legendeAbwesenheit.appendChild(item);
        }

        if (!state.isVisitor) {
            const btn = document.createElement('button');
            btn.textContent = `${st.abbreviation} (${st.name})`;
            btn.style.backgroundColor = st.color;
            btn.style.color = isColorDark(st.color) ? 'white' : 'black';
            btn.onclick = () => saveShift(st.id, state.modalContext.userId, state.modalContext.dateStr);
            dom.shiftSelection.appendChild(btn);
        }
    });
}

function loadShortcuts() {
    let savedShortcuts = {};
    try {
        const data = localStorage.getItem(SHORTCUT_STORAGE_KEY);
        if (data) savedShortcuts = JSON.parse(data);
    } catch (e) {
        console.error("Fehler beim Laden der Shortcuts, verwende Standards.", e);
    }
    const mergedShortcuts = {};
    const allAbbrevs = Object.values(state.allShiftTypes).map(st => st.abbreviation);
    allAbbrevs.forEach(abbrev => {
        const key = savedShortcuts[abbrev] || DEFAULT_SHORTCUTS[abbrev];
        if (key) mergedShortcuts[abbrev] = key;
    });
    state.shortcutMap = Object.fromEntries(
        Object.entries(mergedShortcuts).map(([abbrev, key]) => [key, abbrev])
    );
}

// --- KERNFUNKTION: RENDER GRID ---

/**
 * Lädt alle Daten für den Monat und rendert das Grid und die Besetzungstabelle.
 */
async function renderGrid() {
    dom.monthLabel.textContent = "Lade...";
    dom.grid.innerHTML = '<div style="padding: 20px; text-align: center; color: #333;">Lade Daten...</div>';
    dom.staffingGrid.innerHTML = '';

    if (dom.planStatusContainer) dom.planStatusContainer.style.display = 'none';
    document.body.classList.remove('plan-locked');
    state.isStaffingSortingMode = false;
    if (dom.staffingSortToggleBtn) {
        dom.staffingSortToggleBtn.textContent = 'Besetzung sortieren';
        dom.staffingSortToggleBtn.classList.remove('btn-secondary');
        dom.staffingSortToggleBtn.classList.add('btn-primary');
    }
    if (state.sortableStaffingInstance) state.sortableStaffingInstance.destroy();

    try {
        const shiftDataPromise = apiFetch(`/api/shifts?year=${state.currentYear}&month=${state.currentMonth}`);
        const userDataPromise = apiFetch('/api/users');
        const specialDatesPromise = loadSpecialDates(state.currentYear);
        const queriesPromise = loadShiftQueries();

        const [shiftPayload, userData] = await Promise.all([
            shiftDataPromise,
            userDataPromise,
            specialDatesPromise,
            queriesPromise
        ]);

        state.allUsers = userData;
        state.currentShifts = {};
        shiftPayload.shifts.forEach(s => {
            const key = `${s.user_id}-${s.date}`;
            state.currentShifts[key] = { ...s, shift_type: state.allShiftTypes[s.shifttype_id] };
        });

        state.currentShiftsLastMonth = {};
        if (shiftPayload.shifts_last_month) {
            shiftPayload.shifts_last_month.forEach(s => {
                state.currentShiftsLastMonth[s.user_id] = { ...s, shift_type: state.allShiftTypes[s.shifttype_id] };
            });
        }

        state.currentTotals = shiftPayload.totals;
        state.currentViolations.clear();
        if (shiftPayload.violations) {
            shiftPayload.violations.forEach(v => state.currentViolations.add(`${v[0]}-${v[1]}`));
        }
        state.currentStaffingActual = shiftPayload.staffing_actual || {};
        state.currentPlanStatus = shiftPayload.plan_status || {
            year: state.currentYear, month: state.currentMonth,
            status: "In Bearbeitung", is_locked: false
        };

        updatePlanStatusUI(state.currentPlanStatus);
        buildGridDOM();
        buildStaffingTable();

    } catch (error) {
        dom.grid.innerHTML = `<div style="padding: 20px; text-align: center; color: red;">Fehler beim Laden des Plans: ${error.message}</div>`;
        updatePlanStatusUI({ status: "Fehler", is_locked: true });
    }
}

// --- DOM-RENDER FUNKTIONEN ---

function updatePlanStatusUI(statusData) {
    if (!dom.planStatusContainer) return;
    dom.planStatusContainer.style.display = 'flex';

    if (statusData.status === "Fertiggestellt") {
        dom.planStatusBadge.textContent = "Fertiggestellt";
        dom.planStatusBadge.className = 'status-fertiggestellt';
    } else {
        dom.planStatusBadge.textContent = statusData.status || "In Bearbeitung";
        dom.planStatusBadge.className = 'status-in-bearbeitung';
    }

    if (statusData.is_locked) {
        dom.planLockBtn.textContent = "Gesperrt";
        dom.planLockBtn.title = "Plan entsperren, um Bearbeitung zu erlauben";
        dom.planLockBtn.classList.add('locked');
        document.body.classList.add('plan-locked');
    } else {
        dom.planLockBtn.textContent = "Offen";
        dom.planLockBtn.title = "Plan sperren, um Bearbeitung zu verhindern";
        dom.planLockBtn.classList.remove('locked');
        document.body.classList.remove('plan-locked');
    }

    if (statusData.status === "Fertiggestellt") {
        dom.planStatusToggleBtn.textContent = "Als 'In Bearbeitung' markieren";
        dom.planStatusToggleBtn.title = "Status auf 'In Bearbeitung' zurücksetzen";
    } else {
        dom.planStatusToggleBtn.textContent = "Als 'Fertiggestellt' markieren";
        dom.planStatusToggleBtn.title = "Plan als 'Fertiggestellt' markieren";
    }
}

function buildGridDOM() {
    const daysInMonth = new Date(state.currentYear, state.currentMonth, 0).getDate();
    const monthName = new Date(state.currentYear, state.currentMonth - 1, 1).toLocaleString('de-DE', { month: 'long', year: 'numeric' });
    dom.monthLabel.textContent = monthName;
    const today = new Date();
    dom.grid.style.gridTemplateColumns = `${COL_WIDTH_NAME} ${COL_WIDTH_DETAILS} ${COL_WIDTH_UEBERTRAG} repeat(${daysInMonth}, ${COL_WIDTH_DAY}) ${COL_WIDTH_TOTAL}`;
    dom.grid.innerHTML = '';
    const weekdays = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

    const renderDayHeader = (day, isWeekend, dateStr) => {
        const eventType = state.currentSpecialDates[dateStr];
        const headerCell = document.createElement('div');
        let headerClasses = 'grid-header';
        if (eventType) headerClasses += ` day-color-${eventType}`;
        else if (isWeekend) headerClasses += ' weekend';
        headerCell.className = headerClasses;
        return headerCell;
    };

    // ZEILE 1: Wochentage
    dom.grid.appendChild(document.createElement('div')).className = 'grid-header';
    dom.grid.appendChild(document.createElement('div')).className = 'grid-header';
    dom.grid.appendChild(document.createElement('div')).className = 'grid-header-uebertrag';
    for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(state.currentYear, state.currentMonth - 1, day);
        const dateStr = `${state.currentYear}-${String(state.currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const headerCell = renderDayHeader(day, d.getDay() === 0 || d.getDay() === 6, dateStr);
        headerCell.textContent = weekdays[d.getDay()];
        if (state.currentYear === today.getFullYear() && (state.currentMonth - 1) === today.getMonth() && day === today.getDate()) {
            headerCell.classList.add('current-day-highlight');
        }
        dom.grid.appendChild(headerCell);
    }
    dom.grid.appendChild(document.createElement('div')).className = 'grid-header-total';

    // ZEILE 2: Tage (Nummern)
    const nameHeader2 = document.createElement('div');
    nameHeader2.className = 'grid-header-dog header-separator-bottom';
    nameHeader2.textContent = 'Mitarbeiter';
    dom.grid.appendChild(nameHeader2);
    const dogHeader = document.createElement('div');
    dogHeader.className = 'grid-header-dog header-separator-bottom';
    dogHeader.textContent = 'Diensthund';
    dom.grid.appendChild(dogHeader);
    const uebertragHeader = document.createElement('div');
    uebertragHeader.className = 'grid-header-uebertrag header-separator-bottom';
    uebertragHeader.textContent = 'Ü';
    uebertragHeader.title = 'Übertrag Vormonat';
    dom.grid.appendChild(uebertragHeader);
    for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(state.currentYear, state.currentMonth - 1, day);
        const dateStr = `${state.currentYear}-${String(state.currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const headerCell = renderDayHeader(day, d.getDay() === 0 || d.getDay() === 6, dateStr);
        headerCell.classList.add('header-separator-bottom');
        headerCell.textContent = day;
        if (state.currentYear === today.getFullYear() && (state.currentMonth - 1) === today.getMonth() && day === today.getDate()) {
            headerCell.classList.add('current-day-highlight');
        }
        dom.grid.appendChild(headerCell);
    }
    dom.grid.appendChild(document.createElement('div')).className = 'grid-header-total header-separator-bottom';
    dom.grid.querySelector('.grid-header-total.header-separator-bottom').textContent = 'Std.';

    // DATENZEILEN
    const visibleUsers = state.allUsers.filter(user => user.shift_plan_visible === true);
    visibleUsers.forEach(user => {
        const isCurrentUser = (state.loggedInUser && state.loggedInUser.id === user.id);
        const currentUserClass = isCurrentUser ? ' current-user-row' : '';

        const nameCell = document.createElement('div');
        nameCell.className = 'grid-user-name' + currentUserClass;
        nameCell.textContent = `${user.vorname} ${user.name}`;
        dom.grid.appendChild(nameCell);

        const dogCell = document.createElement('div');
        dogCell.className = 'grid-user-dog' + currentUserClass;
        dogCell.textContent = user.diensthund || '---';
        dom.grid.appendChild(dogCell);

        const uebertragCell = document.createElement('div');
        uebertragCell.className = 'grid-user-uebertrag' + currentUserClass;
        const lastMonthShift = state.currentShiftsLastMonth[user.id];
        uebertragCell.textContent = (lastMonthShift && lastMonthShift.shift_type) ? lastMonthShift.shift_type.abbreviation : '---';
        if (lastMonthShift && lastMonthShift.shift_type) uebertragCell.title = `Schicht am Vormonat: ${lastMonthShift.shift_type.name}`;
        dom.grid.appendChild(uebertragCell);

        for (let day = 1; day <= daysInMonth; day++) {
            const d = new Date(state.currentYear, state.currentMonth - 1, day);
            const isWeekend = d.getDay() === 0 || d.getDay() === 6;
            const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const key = `${user.id}-${dateStr}`;
            const violationKey = `${user.id}-${day}`;
            const eventType = state.currentSpecialDates[dateStr];
            const shift = state.currentShifts[key];
            const shiftType = shift ? shift.shift_type : null;
            const cell = document.createElement('div');
            let cellClasses = 'grid-cell';
            let cellColor = null, textColor = null;

            if (state.currentViolations.has(violationKey)) cellClasses += ' violation';

            let queryForCell = state.currentShiftQueries.find(q => q.target_user_id === user.id && q.shift_date === dateStr && q.status === 'offen');
            if (!queryForCell) queryForCell = state.currentShiftQueries.find(q => q.target_user_id === null && q.shift_date === dateStr && q.status === 'offen');

            const isShiftRequest = queryForCell && isWunschAnfrage(queryForCell);

            if (shiftType) {
                cell.textContent = shiftType.abbreviation;
                if (shiftType.prioritize_background && (eventType || isWeekend)) {
                    if (eventType === 'holiday') cellClasses += ` day-color-${eventType}`;
                    else if (isWeekend) cellClasses += ' weekend';
                } else {
                    cellColor = shiftType.color;
                    textColor = isColorDark(shiftType.color) ? 'white' : 'black';
                }
                if (queryForCell && !isShiftRequest) {
                    cell.innerHTML += `<span class="shift-query-icon">❓</span>`;
                    cell.dataset.queryId = queryForCell.id;
                }
            } else if (isShiftRequest) {
                cell.textContent = queryForCell.message.substring("Anfrage für:".length).trim();
                cellClasses += ' shift-request-cell';
                cell.dataset.queryId = queryForCell.id;
            } else if (queryForCell) {
                cell.textContent = '';
                if (eventType === 'holiday') cellClasses += ` day-color-${eventType}`;
                else if (isWeekend) cellClasses += ' weekend';
                cell.innerHTML += `<span class="shift-query-icon">❓</span>`;
                cell.dataset.queryId = queryForCell.id;
            } else {
                cell.textContent = '';
                if (eventType === 'holiday') cellClasses += ` day-color-${eventType}`;
                else if (isWeekend) cellClasses += ' weekend';
            }

            cell.className = cellClasses + currentUserClass;
            if (state.currentYear === today.getFullYear() && (state.currentMonth - 1) === today.getMonth() && day === today.getDate()) {
                cell.classList.add('current-day-highlight');
            }
            if (cellColor) cell.style.backgroundColor = cellColor;
            if (textColor) cell.style.color = textColor;
            cell.dataset.key = key;

            // Event Listeners (Regel 2: Effizient)
            const isCellOnOwnRow = isCurrentUser;
            const handleClick = (e) => {
                e.preventDefault();
                if (state.isVisitor) return;
                showClickActionModal(e, user, dateStr, cell, isCellOnOwnRow);
            };
            const handleMouseEnter = () => {
                state.hoveredCellContext = { userId: user.id, dateStr: dateStr, userName: `${user.vorname} ${user.name}`, cellElement: cell };
                if (!(state.currentPlanStatus && state.currentPlanStatus.is_locked) || state.isVisitor || state.isPlanschreiber || state.isHundefuehrer) {
                     cell.classList.add('hovered');
                }
            };
            const handleMouseLeave = () => {
                state.hoveredCellContext = null;
                cell.classList.remove('hovered');
            };

            if (state.isVisitor) {
                cell.addEventListener('mouseenter', handleMouseEnter);
                cell.addEventListener('mouseleave', handleMouseLeave);
            } else {
                cell.addEventListener('click', handleClick);
                cell.addEventListener('mouseenter', handleMouseEnter);
                cell.addEventListener('mouseleave', handleMouseLeave);
            }
            cell.addEventListener('contextmenu', e => e.preventDefault());
            dom.grid.appendChild(cell);
        }

        const totalCell = document.createElement('div');
        totalCell.className = 'grid-user-total' + currentUserClass;
        totalCell.id = `total-hours-${user.id}`;
        totalCell.textContent = (state.currentTotals[user.id] || 0.0).toFixed(1);
        dom.grid.appendChild(totalCell);
    });

    // Spaltenbreiten für Besetzungstabelle messen (Regel 2)
    try {
        if (nameHeader2 && dogHeader) {
            state.computedColWidthName = `${nameHeader2.offsetWidth}px`;
            state.computedColWidthDetails = `${dogHeader.offsetWidth}px`;
        }
    } catch (e) {
        console.error("Fehler beim Messen der Spaltenbreiten:", e);
        state.computedColWidthName = COL_WIDTH_NAME;
        state.computedColWidthDetails = COL_WIDTH_DETAILS;
    }
}

function buildStaffingTable() {
    const daysInMonth = new Date(state.currentYear, state.currentMonth, 0).getDate();
    const relevantShiftTypes = state.allShiftTypesList.filter(st =>
        (st.min_staff_mo || 0) > 0 || (st.min_staff_di || 0) > 0 ||
        (st.min_staff_mi || 0) > 0 || (st.min_staff_do || 0) > 0 ||
        (st.min_staff_fr || 0) > 0 || (st.min_staff_sa || 0) > 0 ||
        (st.min_staff_so || 0) > 0 || (st.min_staff_holiday || 0) > 0
    );

    if (relevantShiftTypes.length === 0) {
        dom.staffingGridContainer.style.display = 'none';
        return;
    }

    dom.staffingGridContainer.style.display = 'block';
    dom.staffingGrid.innerHTML = '';

    const gridTemplateColumns = `${state.computedColWidthName} ${state.computedColWidthDetails} ${COL_WIDTH_UEBERTRAG} repeat(${daysInMonth}, ${COL_WIDTH_DAY}) ${COL_WIDTH_TOTAL}`;
    const dayKeyMap = ['min_staff_so', 'min_staff_mo', 'min_staff_di', 'min_staff_mi', 'min_staff_do', 'min_staff_fr', 'min_staff_sa'];

    relevantShiftTypes.forEach(st => {
        const st_id = st.id;
        const row = document.createElement('div');
        row.className = 'staffing-row';
        row.dataset.id = st_id;
        row.style.gridTemplateColumns = gridTemplateColumns;

        let labelCell = document.createElement('div');
        labelCell.className = 'staffing-label';
        const dragHandle = document.createElement('span');
        dragHandle.className = 'staffing-drag-handle';
        dragHandle.innerHTML = '☰';
        dragHandle.style.display = state.isStaffingSortingMode ? 'inline-block' : 'none';
        labelCell.appendChild(dragHandle);
        const labelText = document.createElement('span');
        labelText.textContent = `${st.abbreviation} (${st.name})`;
        labelCell.appendChild(labelText);
        row.appendChild(labelCell);

        row.appendChild(document.createElement('div')).className = 'staffing-cell staffing-untracked';
        row.appendChild(document.createElement('div')).className = 'staffing-cell staffing-untracked';
        row.querySelector('.staffing-untracked:last-of-type').style.borderRight = '1px solid #ffcc99';

        let totalIst = 0, totalSoll = 0;

        for (let day = 1; day <= daysInMonth; day++) {
            const d = new Date(state.currentYear, state.currentMonth - 1, day);
            const dateStr = `${state.currentYear}-${String(state.currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isHoliday = state.currentSpecialDates[dateStr] === 'holiday';
            let sollValue = isHoliday ? (st.min_staff_holiday || 0) : (st[dayKeyMap[d.getDay()]] || 0);
            totalSoll += sollValue;

            const istValue = (state.currentStaffingActual[st_id] && state.currentStaffingActual[st_id][day] !== undefined) ? state.currentStaffingActual[st_id][day] : 0;
            totalIst += istValue;

            const istCell = document.createElement('div');
            let cellClasses = 'staffing-cell';
            if (d.getDay() === 0 || d.getDay() === 6) cellClasses += ' weekend';

            if (sollValue === 0) {
                istCell.textContent = '';
                cellClasses += ' staffing-untracked';
            } else {
                istCell.textContent = istValue;
                if (istValue === sollValue) cellClasses += ' staffing-ok';
                else if (istValue > sollValue) cellClasses += ' staffing-warning';
                else if (istValue > 0) cellClasses += ' staffing-warning';
                else cellClasses += ' staffing-violation';
            }
            istCell.className = cellClasses;
            row.appendChild(istCell);
        }

        let totalIstCell = document.createElement('div');
        totalIstCell.className = 'staffing-total-header';
        totalIstCell.textContent = totalIst;
        if (totalIst < totalSoll) totalIstCell.style.color = '#c00000';
        else if (totalIst > totalSoll && totalSoll > 0) totalIstCell.style.color = '#856404';
        row.appendChild(totalIstCell);

        dom.staffingGrid.appendChild(row);
    });

    if (state.isAdmin && state.isStaffingSortingMode) {
        initializeSortableStaffing();
    }
}

// --- AKTIONEN & HANDLER ---

function initializeSortableStaffing() {
    if (state.sortableStaffingInstance) state.sortableStaffingInstance.destroy();
    state.sortableStaffingInstance = new Sortable(dom.staffingGrid, {
        group: 'staffing', handle: '.staffing-drag-handle', animation: 150,
        forceFallback: true, fallbackClass: 'sortable-fallback', fallbackOnBody: true,
        swapThreshold: 0.65, invertSwap: true, direction: 'vertical',
        onStart: (evt) => {
            document.body.classList.add('dragging');
            const ghostRow = document.querySelector('.sortable-fallback');
            if (ghostRow) {
                ghostRow.style.gridTemplateColumns = evt.item.style.gridTemplateColumns;
                ghostRow.style.width = evt.item.offsetWidth + 'px';
            }
        },
        onEnd: () => document.body.classList.remove('dragging'),
        filter: (e) => !e.target.classList.contains('staffing-drag-handle'),
        draggable: '.staffing-row', ghostClass: 'sortable-ghost'
    });
}

async function saveStaffingOrder() {
    const rows = dom.staffingGrid.querySelectorAll('.staffing-row');
    const payload = Array.from(rows).map((row, index) => ({
        id: parseInt(row.dataset.id),
        order: index
    }));

    dom.staffingSortToggleBtn.textContent = 'Speichere...';
    dom.staffingSortToggleBtn.disabled = true;

    try {
        await apiFetch('/api/shifttypes/staffing_order', 'PUT', payload);
        const newOrderMap = payload.reduce((acc, item) => (acc[item.id] = item.order, acc), {});
        state.allShiftTypesList.sort((a, b) => newOrderMap[a.id] - newOrderMap[b.id]);
        dom.staffingSortToggleBtn.disabled = false;
        return true;
    } catch (error) {
        alert('Fehler beim Speichern der Sortierung: ' + error.message);
        dom.staffingSortToggleBtn.textContent = 'Fehler!';
        dom.staffingSortToggleBtn.disabled = false;
        return false;
    }
}

async function toggleStaffingSortMode() {
    if (!state.isAdmin) return;
    if (state.isStaffingSortingMode) {
        const success = await saveStaffingOrder();
        if (success) {
            state.isStaffingSortingMode = false;
            if (state.sortableStaffingInstance) state.sortableStaffingInstance.destroy();
            dom.staffingSortToggleBtn.textContent = 'Besetzung sortieren';
            dom.staffingSortToggleBtn.classList.remove('btn-secondary');
            dom.staffingSortToggleBtn.classList.add('btn-primary');
            document.querySelectorAll('.staffing-drag-handle').forEach(h => h.style.display = 'none');
            document.querySelectorAll('.staffing-row').forEach(r => r.classList.remove('sort-mode-active'));
        }
    } else {
        state.isStaffingSortingMode = true;
        dom.staffingSortToggleBtn.textContent = 'Reihenfolge speichern';
        dom.staffingSortToggleBtn.classList.remove('btn-primary');
        dom.staffingSortToggleBtn.classList.add('btn-secondary');
        document.querySelectorAll('.staffing-drag-handle').forEach(h => h.style.display = 'inline-block');
        document.querySelectorAll('.staffing-row').forEach(r => r.classList.add('sort-mode-active'));
        initializeSortableStaffing();
    }
}

async function handleUpdatePlanStatus(newStatus, newLockState) {
    if (!state.isAdmin) return;
    const payload = { year: state.currentYear, month: state.currentMonth, status: newStatus, is_locked: newLockState };
    dom.planLockBtn.disabled = true;
    dom.planStatusToggleBtn.disabled = true;
    try {
        state.currentPlanStatus = await apiFetch('/api/shifts/status', 'PUT', payload);
        updatePlanStatusUI(state.currentPlanStatus);
    } catch (error) {
        alert(`Fehler beim Aktualisieren des Status: ${error.message}`);
        updatePlanStatusUI(state.currentPlanStatus); // Reset auf alten Status
    } finally {
        dom.planLockBtn.disabled = false;
        dom.planStatusToggleBtn.disabled = false;
    }
}

async function saveShift(shifttypeId, userId, dateStr) {
    if (!state.isAdmin) {
        console.error("Nicht-Admins dürfen keine Schichten speichern."); return;
    }
    if (state.currentPlanStatus && state.currentPlanStatus.is_locked) {
        alert(`Aktion blockiert: Der Schichtplan für ${state.currentMonth}/${state.currentYear} ist gesperrt.`);
        return;
    }
    if (!userId || !dateStr) return;

    const key = `${userId}-${dateStr}`;
    const cell = findCellByKey(key);
    try {
        if(cell) cell.textContent = '...';
        const savedData = await apiFetch('/api/shifts', 'POST', {
            user_id: userId, date: dateStr, shifttype_id: shifttypeId
        });

        closeModal(dom.shiftModal);
        hideClickActionModal();

        const shiftType = state.allShiftTypes[savedData.shifttype_id];
        const shiftWasDeleted = savedData.message && (savedData.message.includes("gelöscht") || savedData.message.includes("bereits Frei"));

        state.currentShifts[key] = (shiftWasDeleted || !shiftType) ? null : { ...savedData, shift_type: shiftType };

        state.currentViolations.clear();
        if (savedData.violations) {
            savedData.violations.forEach(v => state.currentViolations.add(`${v[0]}-${v[1]}`));
        }
        state.currentStaffingActual = savedData.staffing_actual || {};
        if (savedData.new_total_hours !== undefined) {
            state.currentTotals[userId] = savedData.new_total_hours;
        }

        await loadShiftQueries(); // Wichtig: Anfragen neu laden
        buildGridDOM();
        buildStaffingTable();

    } catch (error) {
        if (cell) cell.textContent = 'Fehler!';
        let errorMsg = `Fehler beim Speichern: ${error.message}`;
        if (error.message.includes("Aktion blockiert")) {
            errorMsg = error.message;
            state.currentPlanStatus.is_locked = true;
            updatePlanStatusUI(state.currentPlanStatus);
        }
        alert(errorMsg);
        if (dom.shiftModal.style.display === 'block') dom.shiftModalInfo.textContent = `Fehler: ${error.message}`;
    }
}

async function requestShift(shiftAbbrev, userId, dateStr) {
    if (state.isVisitor || (state.currentPlanStatus && state.currentPlanStatus.is_locked)) {
        return;
    }
    const cell = findCellByKey(`${userId}-${dateStr}`);
    if(cell) cell.textContent = '...';
    try {
        const payload = { target_user_id: userId, shift_date: dateStr, message: `Anfrage für: ${shiftAbbrev}` };
        await apiFetch('/api/queries', 'POST', payload);
        await loadShiftQueries();
        buildGridDOM();
        triggerNotificationUpdate();
    } catch (e) {
        alert(`Fehler beim Erstellen der Anfrage: ${e.message}`);
        buildGridDOM();
    }
}

async function saveShiftQuery() {
    dom.querySubmitBtn.disabled = true;
    dom.queryModalStatus.textContent = "Sende...";
    dom.queryModalStatus.style.color = '#555';
    let selectedType = 'user';
    if (dom.queryTargetSelection.style.display === 'block') {
         selectedType = document.querySelector('input[name="query-target-type"]:checked').value;
    }
    try {
        let targetUserId = null;
        if (state.isHundefuehrer && !state.isAdmin && !state.isPlanschreiber) {
            targetUserId = state.modalQueryContext.userId;
        } else {
             targetUserId = selectedType === 'user' ? state.modalQueryContext.userId : null;
        }
        const payload = {
            target_user_id: targetUserId,
            shift_date: state.modalQueryContext.dateStr,
            message: dom.queryMessageInput.value
        };
        if (payload.message.length < 3) throw new Error("Nachricht ist zu kurz.");

        await apiFetch('/api/queries', 'POST', payload);
        dom.queryModalStatus.textContent = "Gespeichert!";
        dom.queryModalStatus.style.color = '#2ecc71';

        await loadShiftQueries();
        buildGridDOM();
        triggerNotificationUpdate();

        setTimeout(() => {
            closeModal(dom.queryModal);
            dom.querySubmitBtn.disabled = false;
        }, 1000);
    } catch (e) {
        dom.queryModalStatus.textContent = `Fehler: ${e.message}`;
        dom.queryModalStatus.style.color = '#e74c3c';
        dom.querySubmitBtn.disabled = false;
    }
}

async function sendReply() {
    const queryId = state.modalQueryContext.queryId;
    const message = dom.replyMessageInput.value.trim();
    if (!queryId || message.length < 3) {
        dom.queryModalStatus.textContent = "Nachricht ist zu kurz.";
        dom.queryModalStatus.style.color = '#e74c3c';
        return;
    }
    dom.replySubmitBtn.disabled = true;
    dom.queryModalStatus.textContent = "Sende Antwort...";
    dom.queryModalStatus.style.color = '#555';
    try {
        await apiFetch(`/api/queries/${queryId}/replies`, 'POST', { message });
        const originalQuery = state.currentShiftQueries.find(q => q.id == queryId);
        dom.replyMessageInput.value = '';
        await loadQueryConversation(queryId, originalQuery);
        dom.queryModalStatus.textContent = "Antwort gesendet!";
        dom.queryModalStatus.style.color = '#2ecc71';
        triggerNotificationUpdate();
        setTimeout(() => dom.queryModalStatus.textContent = '', 2000);
    } catch (e) {
        dom.queryModalStatus.textContent = `Fehler: ${e.message}`;
        dom.queryModalStatus.style.color = '#e74c3c';
    } finally {
        dom.replySubmitBtn.disabled = false;
    }
}

async function resolveShiftQuery() {
    if (!state.isAdmin && !state.isPlanschreiber || !state.modalQueryContext.queryId) return;
    dom.queryResolveBtn.disabled = true;
    dom.queryModalStatus.textContent = "Speichere Status...";
    dom.queryModalStatus.style.color = '#555';
    try {
        await apiFetch(`/api/queries/${state.modalQueryContext.queryId}/status`, 'PUT', { status: 'erledigt' });
        await loadShiftQueries();
        buildGridDOM();
        triggerNotificationUpdate();
        closeModal(dom.queryModal);
    } catch (e) {
         dom.queryModalStatus.textContent = `Fehler: ${e.message}`;
         dom.queryModalStatus.style.color = '#e74c3c';
    } finally {
        dom.queryResolveBtn.disabled = false;
    }
}

async function deleteShiftQueryFromModal(queryId, force = false) {
    const qId = queryId || state.modalQueryContext.queryId;
    if (!qId) return;
    if (!state.isAdmin && !state.isPlanschreiber && !state.isHundefuehrer) return;

    if (state.isHundefuehrer && !state.isAdmin && !state.isPlanschreiber) {
        const query = state.currentShiftQueries.find(q => q.id == qId);
        if (!query || query.sender_user_id !== state.loggedInUser.id) {
            alert("Fehler: Sie dürfen nur Ihre eigenen Anfragen löschen.");
            return;
        }
    }
    if (!force && !confirm("Sind Sie sicher, dass Sie diese Anfrage endgültig löschen/zurückziehen möchten?")) {
        return;
    }
    if(dom.queryDeleteBtn) dom.queryDeleteBtn.disabled = true;
    if(dom.queryModalStatus) dom.queryModalStatus.textContent = "Lösche Anfrage...";
    if(dom.queryModalStatus) dom.queryModalStatus.style.color = '#e74c3c';
    try {
        await apiFetch(`/api/queries/${qId}`, 'DELETE');
        await loadShiftQueries();
        buildGridDOM();
        triggerNotificationUpdate();
        closeModal(dom.queryModal);
    } catch (e) {
         if(dom.queryModalStatus) dom.queryModalStatus.textContent = `Fehler beim Löschen: ${e.message}`;
         if(dom.queryModalStatus) dom.queryModalStatus.style.color = '#e74c3c';
    } finally {
        if(dom.queryDeleteBtn) dom.queryDeleteBtn.disabled = false;
    }
}

async function handleAdminApprove(query) {
    if (!state.isAdmin || !query || state.clickModalContext.isPlanGesperrt) {
        alert(state.clickModalContext.isPlanGesperrt ? `Aktion blockiert: Der Schichtplan für ${state.currentMonth}/${state.currentYear} ist gesperrt.` : "Fehler: Nur Admins können genehmigen.");
        return;
    }
    const prefix = "Anfrage für:";
    let abbrev = query.message.substring(prefix.length).trim().replace('?', '');
    const shiftType = state.allShiftTypesList.find(st => st.abbreviation === abbrev);
    if (!shiftType) {
        alert(`Fehler: Schichtart "${abbrev}" nicht gefunden.`); return;
    }
    const cell = findCellByKey(`${query.target_user_id}-${query.shift_date}`);
    if (cell) cell.textContent = '...';
    try {
        await apiFetch('/api/shifts', 'POST', {
            user_id: query.target_user_id, date: query.shift_date, shifttype_id: shiftType.id
        });
        await apiFetch(`/api/queries/${query.id}/status`, 'PUT', { status: 'erledigt' });
        await loadShiftQueries();
        await renderGrid();
        triggerNotificationUpdate();
    } catch (error) {
        alert(`Fehler beim Genehmigen: ${error.message}`);
        buildGridDOM();
    }
}

async function handleAdminReject(query) {
    if (!state.isAdmin || !query || state.clickModalContext.isPlanGesperrt) {
        alert(state.clickModalContext.isPlanGesperrt ? `Aktion blockiert: Der Schichtplan für ${state.currentMonth}/${state.currentYear} ist gesperrt.` : "Fehler: Nur Admins können ablehnen.");
        return;
    }
    if (!confirm("Sind Sie sicher, dass Sie diese Anfrage ABLEHNEN möchten? \n(Die Schicht im Plan wird auf 'FREI' gesetzt und die Anfrage gelöscht.)")) {
        return;
    }
    const cell = findCellByKey(`${query.target_user_id}-${query.shift_date}`);
    if (cell) cell.textContent = '...';
    try {
        await apiFetch('/api/shifts', 'POST', {
            user_id: query.target_user_id, date: query.shift_date, shifttype_id: null
        });
        await apiFetch(`/api/queries/${query.id}`, 'DELETE');
        await loadShiftQueries();
        await renderGrid();
        triggerNotificationUpdate();
    } catch (error) {
        alert(`Fehler beim Ablehnen: ${error.message}`);
        buildGridDOM();
    }
}

function highlightCells(dateStr, targetUserId) {
    const highlightClass = 'grid-cell-highlight';
    let cellsToHighlight = [];
    if (targetUserId) {
        const key = `${targetUserId}-${dateStr}`;
        const cell = findCellByKey(key);
        if (cell) cellsToHighlight.push(cell);
    } else {
        cellsToHighlight = Array.from(document.querySelectorAll(`.grid-cell[data-key$="-${dateStr}"]`));
    }
    if (cellsToHighlight.length > 0) {
        cellsToHighlight[0].scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        cellsToHighlight.forEach(cell => cell.classList.add(highlightClass));
        setTimeout(() => {
            cellsToHighlight.forEach(cell => cell.classList.remove(highlightClass));
        }, 5000);
    }
}

// --- EVENT LISTENERS (Regel 2: Effizient gekapselt) ---

function attachEventListeners() {
    // Navigation
    dom.prevMonthBtn.onclick = () => {
        state.currentMonth--;
        if (state.currentMonth < 1) { state.currentMonth = 12; state.currentYear--; }
        loadColorSettings();
        renderGrid();
    };
    dom.nextMonthBtn.onclick = () => {
        state.currentMonth++;
        if (state.currentMonth > 12) { state.currentMonth = 1; state.currentYear++; }
        loadColorSettings();
        renderGrid();
    };

    // Plan-Status (Admin)
    if (dom.planLockBtn) {
        dom.planLockBtn.onclick = () => {
            if (!state.isAdmin) return;
            handleUpdatePlanStatus(state.currentPlanStatus.status, !state.currentPlanStatus.is_locked);
        };
    }
    if (dom.planStatusToggleBtn) {
        dom.planStatusToggleBtn.onclick = () => {
            if (!state.isAdmin) return;
            const newStatus = (state.currentPlanStatus.status === "Fertiggestellt") ? "In Bearbeitung" : "Fertiggestellt";
            handleUpdatePlanStatus(newStatus, state.currentPlanStatus.is_locked);
        };
    }

    // Sortierung (Admin)
    if (dom.staffingSortToggleBtn) {
        dom.staffingSortToggleBtn.onclick = toggleStaffingSortMode;
    }

    // Modale schließen
    if (dom.closeShiftModalBtn) dom.closeShiftModalBtn.onclick = () => closeModal(dom.shiftModal);
    if (dom.closeQueryModalBtn) dom.closeQueryModalBtn.onclick = () => closeModal(dom.queryModal);

    // Query-Modal Aktionen
    if (dom.querySubmitBtn) dom.querySubmitBtn.onclick = saveShiftQuery;
    if (dom.queryResolveBtn) dom.queryResolveBtn.onclick = resolveShiftQuery;
    if (dom.queryDeleteBtn) dom.queryDeleteBtn.onclick = () => deleteShiftQueryFromModal();
    if (dom.replySubmitBtn) dom.replySubmitBtn.onclick = sendReply;

    // Click-Modal Aktionen
    if (dom.camLinkNotiz) dom.camLinkNotiz.onclick = () => {
        openQueryModal(state.clickModalContext.userId, state.clickModalContext.dateStr, state.clickModalContext.userName, state.clickModalContext.queryId);
        hideClickActionModal();
    };
    if (dom.camLinkDelete) dom.camLinkDelete.onclick = () => {
        deleteShiftQueryFromModal(state.clickModalContext.queryId, false);
        hideClickActionModal();
    };
    if (dom.camBtnApprove) dom.camBtnApprove.onclick = () => {
        handleAdminApprove(state.clickModalContext.query);
        hideClickActionModal();
    };
    if (dom.camBtnReject) dom.camBtnReject.onclick = () => {
        handleAdminReject(state.clickModalContext.query);
        hideClickActionModal();
    };

    // Globale Listener
    window.onclick = (event) => {
        if (event.target == dom.shiftModal) closeModal(dom.shiftModal);
        if (event.target == dom.queryModal) closeModal(dom.queryModal);
        if (!event.target.closest('.grid-cell') && !event.target.closest('#click-action-modal')) {
            hideClickActionModal();
        }
    };

    window.addEventListener('keydown', (event) => {
        if (!state.isAdmin || (state.currentPlanStatus && state.currentPlanStatus.is_locked)) return;
        if (dom.shiftModal.style.display === 'block' || dom.queryModal.style.display === 'block' || (dom.clickActionModal && dom.clickActionModal.style.display === 'block')) {
            return;
        }
        if (!state.hoveredCellContext || !state.hoveredCellContext.userId) return;

        const key = event.key.toLowerCase();
        const abbrev = state.shortcutMap[key];
        if (abbrev !== undefined) {
            event.preventDefault();
            const shiftType = Object.values(state.allShiftTypes).find(st => st.abbreviation === abbrev);
            if (shiftType) {
                saveShift(shiftType.id, state.hoveredCellContext.userId, state.hoveredCellContext.dateStr);
            } else {
                console.warn(`Shortcut "${key}" (Abk.: "${abbrev}") nicht in allShiftTypes gefunden.`);
            }
        }
    });
}

// --- INITIALISIERUNG ---

/**
 * Haupt-Initialisierungsfunktion der Seite
 */
async function initialize() {
    try {
        // 1. Auth-Prüfung. Bricht bei Fehler ab.
        const authData = initAuthCheck();
        state.loggedInUser = authData.user;
        state.isAdmin = authData.isAdmin;
        state.isVisitor = authData.isVisitor;
        state.isPlanschreiber = authData.isPlanschreiber;
        state.isHundefuehrer = authData.isHundefuehrer;

        // 2. Event-Listener anhängen
        attachEventListeners();

        // 3. Statische Daten laden (Farben, Schichtarten, Legende, Shortcuts)
        await loadColorSettings();
        await populateStaticElements();
        loadShortcuts();

        // 4. Highlight-Logik (Regel 1)
        let highlightData = null;
        try {
            const data = localStorage.getItem(DHF_HIGHLIGHT_KEY);
            if (data) {
                highlightData = JSON.parse(data);
                localStorage.removeItem(DHF_HIGHLIGHT_KEY); // Nur einmal verwenden
                state.currentYear = new Date(highlightData.date).getFullYear();
                state.currentMonth = new Date(highlightData.date).getMonth() + 1;
            }
        } catch (e) { console.error("Fehler beim Lesen der Highlight-Daten:", e); }

        // 5. Haupt-Grid rendern (lädt jetzt den korrekten Monat)
        await renderGrid();

        // 6. Highlight-Blinken auslösen (falls vorhanden)
        if (highlightData) {
            highlightCells(highlightData.date, highlightData.targetUserId);
        }

    } catch (e) {
        // Wenn initAuthCheck() fehlschlägt, wird der Benutzer bereits umgeleitet.
        // Wir müssen hier nichts weiter tun.
        console.error("Initialisierung der Seite fehlgeschlagen (Auth-Problem):", e.message);
    }
}

// Startet die Anwendung
initialize();