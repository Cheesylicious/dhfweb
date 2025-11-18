// cheesylicious/dhfweb/dhfweb-ec604d738e9bd121b65cc8557f8bb98d2aa18062/html/schichtplan.js
// --- Globales Setup ---
const API_URL = 'http://46.224.63.203:5000';
const SHORTCUT_STORAGE_KEY = 'dhf_shortcuts';
const COLOR_STORAGE_KEY = 'dhf_color_settings';
const DHF_HIGHLIGHT_KEY = 'dhf_highlight_goto';
let loggedInUser;
let currentDate = new Date();
let currentYear = currentDate.getFullYear();
let currentMonth = currentDate.getMonth() + 1;
let allUsers = [];
let allShiftTypes = {};
let allShiftTypesList = [];
let currentShifts = {};
let currentShiftsLastMonth = {};
let currentTotals = {};
let currentViolations = new Set();
let currentSpecialDates = {};
let colorSettings = {};
let hoveredCellContext = null;

let currentStaffingActual = {};
let currentPlanStatus = {};
let currentShiftQueries = [];

let shortcutMap = {};
const defaultShortcuts = { 'T.': 't', 'N.': 'n', '6': '6', 'FREI': 'f', 'X': 'x', 'U': 'u' };
let isVisitor = false;
let isAdmin = false;
let isPlanschreiber = false;
let isHundefuehrer = false;

let isStaffingSortingMode = false;
let sortableStaffingInstance = null;

const DEFAULT_COLORS = {
    'weekend_bg_color': '#fff8f8',
    'weekend_text_color': '#333333',
    'holiday_bg_color': '#ffddaa',
    'training_bg_color': '#daffdb',
    'shooting_bg_color': '#ffb0b0'
};

const gridContainer = document.getElementById('schichtplan-grid-container');
const grid = document.getElementById('schichtplan-grid');
const staffingGridContainer = document.getElementById('staffing-grid-container');
const staffingGrid = document.getElementById('staffing-grid');
const monthLabel = document.getElementById('current-month-label');
const prevMonthBtn = document.getElementById('prev-month-btn');
const nextMonthBtn = document.getElementById('next-month-btn');
const staffingSortToggleBtn = document.getElementById('staffing-sort-toggle');

const planStatusContainer = document.getElementById('plan-status-container');
const planStatusBadge = document.getElementById('plan-status-badge');
const planLockBtn = document.getElementById('plan-lock-btn');
const planStatusToggleBtn = document.getElementById('plan-status-toggle-btn');

const shiftModal = document.getElementById('shift-modal');
const shiftModalTitle = document.getElementById('shift-modal-title');
const shiftModalInfo = document.getElementById('shift-modal-info');
const shiftSelection = document.getElementById('shift-selection');
const closeShiftModalBtn = document.getElementById('close-shift-modal');
let modalContext = { userId: null, dateStr: null };

const queryModal = document.getElementById('query-modal');
const closeQueryModalBtn = document.getElementById('close-query-modal');
const queryModalTitle = document.getElementById('query-modal-title');
const queryModalInfo = document.getElementById('query-modal-info');
const queryExistingContainer = document.getElementById('query-existing-container');
const queryExistingMessage = document.getElementById('query-existing-message');
const queryAdminActions = document.getElementById('query-admin-actions');
const queryResolveBtn = document.getElementById('query-resolve-btn');
const queryDeleteBtn = document.getElementById('query-delete-btn');
const queryNewContainer = document.getElementById('query-new-container');
const queryMessageInput = document.getElementById('query-message-input');
const querySubmitBtn = document.getElementById('query-submit-btn');
const queryModalStatus = document.getElementById('query-modal-status');
const queryTargetSelection = document.getElementById('query-target-selection');
const targetTypeUser = document.getElementById('target-type-user');
const targetTypeDay = document.getElementById('target-type-day');

const queryReplyForm = document.getElementById('query-reply-form');
const replyMessageInput = document.getElementById('reply-message-input');
const replySubmitBtn = document.getElementById('reply-submit-btn');
const queryRepliesList = document.getElementById('query-replies-list');

// --- CLICK-MODAL Elemente ---
const clickActionModal = document.getElementById('click-action-modal');
const camTitle = document.getElementById('cam-title');
const camSubtitle = document.getElementById('cam-subtitle');
const camAdminWunschActions = document.getElementById('cam-admin-wunsch-actions');
const camAdminShifts = document.getElementById('cam-admin-shifts');
const camHundefuehrerRequests = document.getElementById('cam-hundefuehrer-requests');
const camNotizActions = document.getElementById('cam-notiz-actions');
const camHundefuehrerDelete = document.getElementById('cam-hundefuehrer-delete');
const camBtnApprove = document.getElementById('cam-btn-approve');
const camBtnReject = document.getElementById('cam-btn-reject');
const camLinkNotiz = document.getElementById('cam-link-notiz');
const camLinkDelete = document.getElementById('cam-link-delete');
let clickModalContext = null;

let modalQueryContext = { userId: null, dateStr: null, userName: null, queryId: null };

const COL_WIDTH_NAME = 'minmax(160px, max-content)';
const COL_WIDTH_DETAILS = 'minmax(110px, max-content)';
let computedColWidthName = COL_WIDTH_NAME;
let computedColWidthDetails = COL_WIDTH_DETAILS;

const COL_WIDTH_UEBERTRAG = 'minmax(50px, 0.5fr)';
const COL_WIDTH_DAY = 'minmax(45px, 1fr)';
const COL_WIDTH_TOTAL = 'minmax(60px, 0.5fr)';


// --- Basis-Funktionen ---
async function logout() {
    try { await apiFetch('/api/logout', 'POST'); }
    catch (e) { console.error(e); }
    finally {
        localStorage.removeItem('dhf_user');
        window.location.href = 'index.html?logout=true';
    }
}
try {
    loggedInUser = JSON.parse(localStorage.getItem('dhf_user'));
    if (!loggedInUser || !loggedInUser.vorname || !loggedInUser.role) { throw new Error("Kein User"); }
    document.getElementById('welcome-user').textContent = `Willkommen, ${loggedInUser.vorname}!`;

    isAdmin = loggedInUser.role.name === 'admin';
    isVisitor = loggedInUser.role.name === 'Besucher';
    isPlanschreiber = loggedInUser.role.name === 'Planschreiber';
    isHundefuehrer = loggedInUser.role.name === 'Hundeführer';

    if (isAdmin) document.body.classList.add('admin-mode');
    if (isPlanschreiber) document.body.classList.add('planschreiber-mode');
    if (isHundefuehrer) document.body.classList.add('hundefuehrer-mode');

    const navDashboard = document.getElementById('nav-dashboard');
    const navUsers = document.getElementById('nav-users');
    const settingsDropdown = document.getElementById('settings-dropdown');
    const settingsDropdownContent = document.getElementById('settings-dropdown-content');
    const navFeedback = document.getElementById('nav-feedback');

    if (!isVisitor) navDashboard.style.display = 'block';
    else navDashboard.style.display = 'none';

    if (isAdmin) {
        navUsers.style.display = 'block';
        navFeedback.style.display = 'inline-flex';
        if (staffingSortToggleBtn) staffingSortToggleBtn.style.display = 'inline-block';
    } else if (isPlanschreiber) {
        navUsers.style.display = 'none';
        navFeedback.style.display = 'inline-flex';
        if (staffingSortToggleBtn) staffingSortToggleBtn.style.display = 'none';
    } else {
        navUsers.style.display = 'none';
        navFeedback.style.display = 'none';
        if (staffingSortToggleBtn) staffingSortToggleBtn.style.display = 'none';
    }

    if (isVisitor) {
        isVisitor = true;
        document.body.classList.add('visitor-mode');
        navDashboard.style.display = 'none';
        navUsers.style.display = 'none';
    }

    if (settingsDropdownContent) {
        const sortingLink = settingsDropdownContent.querySelector('a[href="schichtartensortierung.html"]');
        if (sortingLink) sortingLink.remove();

        if (!isAdmin) {
            document.querySelectorAll('#settings-dropdown-content .admin-only').forEach(el => {
                el.style.display = 'none';
            });
            const visibleLinks = settingsDropdownContent.querySelectorAll('a:not([style*="display: none"])');
            if (visibleLinks.length === 0) {
                 if (settingsDropdown) settingsDropdown.style.display = 'none';
            }
        }
    }

} catch (e) {
    logout();
}
document.getElementById('logout-btn').onclick = logout;

async function apiFetch(endpoint, method = 'GET', body = null) {
    const options = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include' };
    if (body) { options.body = JSON.stringify(body); }
    const response = await fetch(API_URL + endpoint, options);

    if (response.status === 401 || response.status === 403) {
        if (response.status === 401) { logout(); }
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Sitzung ungültig oder fehlende Rechte.');
        }
        throw new Error('Sitzung ungültig oder fehlende Rechte.');
    }

    const contentType = response.headers.get("content-type");
    let data;
    if (contentType && contentType.indexOf("application/json") !== -1) { data = await response.json(); } else { data = { message: await response.text() }; }
    if (!response.ok) { throw new Error(data.message || 'API-Fehler'); }
    return data;
}

async function loadColorSettings() {
     let fetchedColors = DEFAULT_COLORS;
    try {
        const data = await apiFetch('/api/settings', 'GET');
        for(const key in DEFAULT_COLORS) {
            if (data[key] !== undefined && data[key] !== null) {
                fetchedColors[key] = data[key];
            } else {
                 fetchedColors[key] = DEFAULT_COLORS[key];
            }
        }
        colorSettings = fetchedColors;
    } catch (error) {
         console.error("Fehler beim Laden der globalen Einstellungen:", error.message);
         colorSettings = DEFAULT_COLORS;
    }
    const root = document.documentElement.style;
    for (const key in colorSettings) {
        root.setProperty(`--${key.replace(/_/g, '-')}`, colorSettings[key]);
    }
}

function closeModal(modalEl) { modalEl.style.display = 'none'; }

// --- CLICK-MODAL FUNKTIONEN ---

function hideClickActionModal() {
    if (clickActionModal) {
        clickActionModal.style.display = 'none';
    }
    clickModalContext = null;
}

const isWunschAnfrage = (q) => {
    return q.sender_role_name === 'Hundeführer' && q.message.startsWith("Anfrage für:");
};

function showClickActionModal(event, user, dateStr, cell, isCellOnOwnRow) {
    event.preventDefault();
    hideClickActionModal();

    const userName = `${user.vorname} ${user.name}`;
    const d = new Date(dateStr);
    const dateDisplay = d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });

    // Suche BEIDE Arten von Queries für diese Zelle
    const allQueriesForCell = currentShiftQueries.filter(q =>
        q.target_user_id === user.id && q.shift_date === dateStr && q.status === 'offen'
    );

    // Finde Wunsch und Notiz
    const wunschQuery = allQueriesForCell.find(q => isWunschAnfrage(q));
    const notizQuery = allQueriesForCell.find(q => !isWunschAnfrage(q));

    const planGesperrt = (currentPlanStatus && currentPlanStatus.is_locked);

    clickModalContext = {
        userId: user.id,
        dateStr: dateStr,
        userName: userName,
        wunschQuery: wunschQuery,
        notizQuery: notizQuery,
        queryId: null,
        isPlanGesperrt: planGesperrt
    };

    camTitle.textContent = `${userName}`;
    camSubtitle.textContent = `${dateDisplay}`;

    // Reset sections
    camAdminWunschActions.style.display = 'none';
    camAdminShifts.style.display = 'none';
    camHundefuehrerRequests.style.display = 'none';
    camNotizActions.style.display = 'none';
    camHundefuehrerDelete.style.display = 'none';

    let hasContent = false;

    // --- RECHTE-LOGIK ---

    if (isAdmin) {
        // ADMIN: Sieht BEIDES (Wunsch und Notiz)

        // 1. Wunsch-Aktionen
        if (wunschQuery && !planGesperrt) {
            camAdminWunschActions.style.display = 'grid';
            camBtnApprove.textContent = `Genehmigen (${wunschQuery.message.replace('Anfrage für:', '').trim()})`;
            hasContent = true;
        }

        // 2. Schichtzuweisung
        if (!planGesperrt) {
            camAdminShifts.style.display = 'grid';
            populateClickModalShiftButtons('admin');
            hasContent = true;
        }

        // 3. Notiz-Aktion (Bezieht sich jetzt auf 'notizQuery')
        camNotizActions.style.display = 'block';
        camLinkNotiz.textContent = notizQuery ? '❓ Text-Notiz ansehen...' : '❓ Text-Notiz erstellen...';
        // Wir merken uns die relevante ID für den Klick
        camLinkNotiz.dataset.targetQueryId = notizQuery ? notizQuery.id : "";
        hasContent = true;

    } else if (isPlanschreiber) {
        // --- PLANSCHREIBER-LOGIK (STRIKTE TRENNUNG) ---
        // Sieht KEINE Wunsch-Optionen.
        // Interagiert NUR mit 'notizQuery'.

        camNotizActions.style.display = 'block';
        camLinkNotiz.textContent = notizQuery ? '❓ Text-Notiz ansehen...' : '❓ Text-Notiz erstellen...';
        camLinkNotiz.dataset.targetQueryId = notizQuery ? notizQuery.id : "";
        hasContent = true;

    } else if (isHundefuehrer && isCellOnOwnRow) {
        // HUNDEFÜHRER: Interagiert primär mit 'wunschQuery'

        if (wunschQuery && wunschQuery.sender_user_id === loggedInUser.id && !planGesperrt) {
            camHundefuehrerDelete.style.display = 'block';
            camLinkDelete.textContent = 'Wunsch-Anfrage zurückziehen';
            camLinkDelete.dataset.targetQueryId = wunschQuery.id;
            hasContent = true;

        } else if (notizQuery && notizQuery.sender_user_id === loggedInUser.id && !planGesperrt) {
             // Fallback: Falls er eine Notiz erstellt hat statt Wunsch
             camHundefuehrerDelete.style.display = 'block';
             camLinkDelete.textContent = 'Notiz löschen';
             camLinkDelete.dataset.targetQueryId = notizQuery.id;
             hasContent = true;

        } else if (!wunschQuery && !planGesperrt) {
            camHundefuehrerRequests.style.display = 'grid';
            populateClickModalShiftButtons('hundefuehrer');
            hasContent = true;
        }
    }

    if (!hasContent) {
        hideClickActionModal();
        return;
    }

    // Positionierung
    const cellRect = cell.getBoundingClientRect();
    const modalWidth = clickActionModal.offsetWidth || 300;
    const modalHeight = clickActionModal.offsetHeight;
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

    clickActionModal.style.left = `${left}px`;
    clickActionModal.style.top = `${top}px`;
    clickActionModal.style.display = 'block';
}

function populateClickModalShiftButtons(mode) {
    let targetContainer;
    let buttonDefs;

    if (mode === 'admin') {
        targetContainer = camAdminShifts;
        buttonDefs = [
            { abbrev: 'T.', title: 'Tag (T.)' },
            { abbrev: 'N.', title: 'Nacht (N.)' },
            { abbrev: '6', title: 'Kurz (6)' },
            { abbrev: 'FREI', title: 'FREI' },
            { abbrev: 'U', title: 'Urlaub (U)' },
            { abbrev: 'X', title: 'Wunschfrei (X)' },
            { abbrev: 'Alle...', title: 'Alle Schichten anzeigen', isAll: true }
        ];
    } else {
        targetContainer = camHundefuehrerRequests;
        buttonDefs = [
            { abbrev: 'T.?', title: 'Tag-Wunsch' },
            { abbrev: 'N.?', title: 'Nacht-Wunsch' },
            { abbrev: '6?', title: 'Kurz-Wunsch' },
            { abbrev: 'X?', title: 'Wunschfrei' },
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
                    openShiftModal(clickModalContext.userId, clickModalContext.dateStr, clickModalContext.userName);
                } else {
                    const shiftType = allShiftTypesList.find(st => st.abbreviation === def.abbrev);
                    if (shiftType) {
                        saveShift(shiftType.id, clickModalContext.userId, clickModalContext.dateStr);
                    }
                }
            } else {
                requestShift(def.abbrev, clickModalContext.userId, clickModalContext.dateStr);
            }
            hideClickActionModal();
        };
        targetContainer.appendChild(btn);
    });
}

window.addEventListener('click', (e) => {
    if (!e.target.closest('.grid-cell') && !e.target.closest('#click-action-modal')) {
        hideClickActionModal();
    }
}, true);

// --- FALLBACK MODAL ---

function openShiftModal(userId, dateStr, userName) {
    if (!isAdmin || (currentPlanStatus && currentPlanStatus.is_locked)) {
        return;
    }

    const d = new Date(dateStr);
    const dateDisplay = d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' });
    modalContext = { userId, dateStr };
    shiftModalTitle.textContent = "Alle Schichten zuweisen";
    shiftModalInfo.textContent = `Für: ${userName} am ${dateDisplay}`;
    shiftModal.style.display = 'block';
}
closeShiftModalBtn.onclick = () => closeModal(shiftModal);

if (closeQueryModalBtn) {
    closeQueryModalBtn.onclick = () => closeModal(queryModal);
}
if (querySubmitBtn) {
    querySubmitBtn.onclick = () => saveShiftQuery();
}
if (queryResolveBtn) {
    queryResolveBtn.onclick = () => resolveShiftQuery();
}
if (queryDeleteBtn) {
    queryDeleteBtn.onclick = () => deleteShiftQueryFromModal();
}
if (replySubmitBtn) {
    replySubmitBtn.onclick = () => sendReply();
}

// Listeners für Klick-Modal Aktionen
if (camLinkNotiz) {
    camLinkNotiz.onclick = () => {
        const specificId = camLinkNotiz.dataset.targetQueryId || null;
        openQueryModal(clickModalContext.userId, clickModalContext.dateStr, clickModalContext.userName, specificId);
        hideClickActionModal();
    };
}
if (camLinkDelete) {
    camLinkDelete.onclick = () => {
        const specificId = camLinkDelete.dataset.targetQueryId;
        deleteShiftQueryFromModal(specificId, false);
        hideClickActionModal();
    };
}
if (camBtnApprove) {
    camBtnApprove.onclick = () => {
        handleAdminApprove(clickModalContext.wunschQuery);
        hideClickActionModal();
    };
}
if (camBtnReject) {
    camBtnReject.onclick = () => {
        handleAdminReject(clickModalContext.wunschQuery);
        hideClickActionModal();
    };
}

window.onclick = (event) => {
    if (event.target == shiftModal) closeModal(shiftModal);
    if (event.target == queryModal) closeModal(queryModal);
    if (!event.target.closest('.grid-cell') && !event.target.closest('#click-action-modal')) {
        hideClickActionModal();
    }
}

async function loadSpecialDates(year) {
     try {
        const holidays = await apiFetch(`/api/special_dates?type=holiday&year=${year}`);
        const training = await apiFetch(`/api/special_dates?type=training&year=${year}`);
        const shooting = await apiFetch(`/api/special_dates?type=shooting&year=${year}`);

        currentSpecialDates = {};
        training.forEach(d => { if(d.date) currentSpecialDates[d.date] = d.type; });
        shooting.forEach(d => { if(d.date) currentSpecialDates[d.date] = d.type; });
        holidays.forEach(d => { if(d.date) currentSpecialDates[d.date] = 'holiday'; });

    } catch (error) {
         console.error("Fehler beim Laden der Sondertermine:", error.message);
    }
}

async function loadShiftQueries() {
    if (!isAdmin && !isPlanschreiber && !isHundefuehrer) return;
    try {
        const queries = await apiFetch(`/api/queries?year=${currentYear}&month=${currentMonth}&status=offen`);
        currentShiftQueries = queries;
    } catch (e) {
        console.error("Fehler beim Laden der Schicht-Anfragen", e);
        currentShiftQueries = [];
    }
}

async function renderGrid() {
    monthLabel.textContent = "Lade...";
    grid.innerHTML = '<div style="padding: 20px; text-align: center; color: #333;">Lade Daten...</div>';
    staffingGrid.innerHTML = '';

    if (planStatusContainer) {
        planStatusContainer.style.display = 'none';
    }
    document.body.classList.remove('plan-locked');

    isStaffingSortingMode = false;
    if (staffingSortToggleBtn) {
        staffingSortToggleBtn.textContent = 'Besetzung sortieren';
        staffingSortToggleBtn.classList.remove('btn-secondary');
        staffingSortToggleBtn.classList.add('btn-primary');
    }
    if (sortableStaffingInstance) sortableStaffingInstance.destroy();


    try {
        const shiftDataPromise = apiFetch(`/api/shifts?year=${currentYear}&month=${currentMonth}`);
        const userDataPromise = apiFetch('/api/users');
        const specialDatesPromise = loadSpecialDates(currentYear);
        const queriesPromise = loadShiftQueries();

        const [shiftPayload, userData, specialDatesResult, queriesResult] = await Promise.all([
            shiftDataPromise,
            userDataPromise,
            specialDatesPromise,
            queriesPromise
        ]);

        allUsers = userData;

        currentShifts = {};
        shiftPayload.shifts.forEach(s => {
            const key = `${s.user_id}-${s.date}`;
            const fullShiftType = allShiftTypes[s.shifttype_id];
            currentShifts[key] = {
                ...s,
                shift_type: fullShiftType
            };
        });

        currentShiftsLastMonth = {};
        if (shiftPayload.shifts_last_month) {
            shiftPayload.shifts_last_month.forEach(s => {
                const fullShiftType = allShiftTypes[s.shifttype_id];
                currentShiftsLastMonth[s.user_id] = {
                    ...s,
                    shift_type: fullShiftType
                };
            });
        }

        currentTotals = shiftPayload.totals;

        currentViolations.clear();
        if (shiftPayload.violations) {
            shiftPayload.violations.forEach(v => {
                currentViolations.add(`${v[0]}-${v[1]}`);
            });
        }

        currentStaffingActual = shiftPayload.staffing_actual || {};

        currentPlanStatus = shiftPayload.plan_status || {
            year: currentYear,
            month: currentMonth,
            status: "In Bearbeitung",
            is_locked: false
        };
        updatePlanStatusUI(currentPlanStatus);

        buildGridDOM();
        buildStaffingTable();

    } catch (error) {
        grid.innerHTML = `<div style="padding: 20px; text-align: center; color: red;">Fehler beim Laden des Plans: ${error.message}</div>`;
        updatePlanStatusUI({
            status: "Fehler",
            is_locked: true
        });
    }
}

function updatePlanStatusUI(statusData) {
    if (!planStatusContainer) return;

    planStatusContainer.style.display = 'flex';

    if (statusData.status === "Fertiggestellt") {
        planStatusBadge.textContent = "Fertiggestellt";
        planStatusBadge.className = 'status-fertiggestellt';
    } else {
        planStatusBadge.textContent = statusData.status || "In Bearbeitung";
        planStatusBadge.className = 'status-in-bearbeitung';
    }

    if (statusData.is_locked) {
        planLockBtn.textContent = "Gesperrt";
        planLockBtn.title = "Plan entsperren, um Bearbeitung zu erlauben";
        planLockBtn.classList.add('locked');
        document.body.classList.add('plan-locked');
    } else {
        planLockBtn.textContent = "Offen";
        planLockBtn.title = "Plan sperren, um Bearbeitung zu verhindern";
        planLockBtn.classList.remove('locked');
        document.body.classList.remove('plan-locked');
    }

    if (statusData.status === "Fertiggestellt") {
        planStatusToggleBtn.textContent = "Als 'In Bearbeitung' markieren";
        planStatusToggleBtn.title = "Status auf 'In Bearbeitung' zurücksetzen";
    } else {
        planStatusToggleBtn.textContent = "Als 'Fertiggestellt' markieren";
        planStatusToggleBtn.title = "Plan als 'Fertiggestellt' markieren";
    }
}

async function handleUpdatePlanStatus(newStatus, newLockState) {
    if (!isAdmin) return;

    const payload = {
        year: currentYear,
        month: currentMonth,
        status: newStatus,
        is_locked: newLockState
    };

    planLockBtn.disabled = true;
    planStatusToggleBtn.disabled = true;

    try {
        const updatedStatus = await apiFetch('/api/shifts/status', 'PUT', payload);
        currentPlanStatus = updatedStatus;
        updatePlanStatusUI(currentPlanStatus);
    } catch (error) {
        alert(`Fehler beim Aktualisieren des Status: ${error.message}`);
        updatePlanStatusUI(currentPlanStatus);
    } finally {
        planLockBtn.disabled = false;
        planStatusToggleBtn.disabled = false;
    }
}


function buildGridDOM() {
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    const monthName = new Date(currentYear, currentMonth - 1, 1).toLocaleString('de-DE', { month: 'long', year: 'numeric' });
    monthLabel.textContent = monthName;

    const today = new Date();

    grid.style.gridTemplateColumns = `${COL_WIDTH_NAME} ${COL_WIDTH_DETAILS} ${COL_WIDTH_UEBERTRAG} repeat(${daysInMonth}, ${COL_WIDTH_DAY}) ${COL_WIDTH_TOTAL}`;

    grid.innerHTML = '';
    const weekdays = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

    const renderDayHeader = (day, isWeekend, dateStr) => {
        const eventType = currentSpecialDates[dateStr];
        const headerCell = document.createElement('div');
        let headerClasses = 'grid-header';
        if (eventType) {
            headerClasses += ` day-color-${eventType}`;
        } else if (isWeekend) {
            headerClasses += ' weekend';
        }
        headerCell.className = headerClasses;
        return headerCell;
    };

    let nameHeader1 = document.createElement('div');
    nameHeader1.className = 'grid-header';
    grid.appendChild(nameHeader1);
    let dogHeader1 = document.createElement('div');
    dogHeader1.className = 'grid-header';
    grid.appendChild(dogHeader1);

    let uebertragHeader1 = document.createElement('div');
    uebertragHeader1.className = 'grid-header-uebertrag';
    grid.appendChild(uebertragHeader1);

    for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(currentYear, currentMonth - 1, day);
        const dayName = weekdays[d.getDay()];
        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
        const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const headerCell = renderDayHeader(day, isWeekend, dateStr);
        headerCell.textContent = dayName;

        if (currentYear === today.getFullYear() && (currentMonth - 1) === today.getMonth() && day === today.getDate()) {
            headerCell.classList.add('current-day-highlight');
        }

        grid.appendChild(headerCell);
    }
    let totalHeader1 = document.createElement('div');
    totalHeader1.className = 'grid-header-total';
    grid.appendChild(totalHeader1);

    let nameHeader2 = document.createElement('div');
    nameHeader2.className = 'grid-header-dog header-separator-bottom';
    nameHeader2.textContent = 'Mitarbeiter';
    grid.appendChild(nameHeader2);

    const dogHeader = document.createElement('div');
    dogHeader.className = 'grid-header-dog header-separator-bottom';
    dogHeader.textContent = 'Diensthund';
    grid.appendChild(dogHeader);

    const uebertragHeader = document.createElement('div');
    uebertragHeader.className = 'grid-header-uebertrag header-separator-bottom';
    uebertragHeader.textContent = 'Ü';
    uebertragHeader.title = 'Übertrag Vormonat';
    grid.appendChild(uebertragHeader);

    for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(currentYear, currentMonth - 1, day);
        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
        const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const headerCell = renderDayHeader(day, isWeekend, dateStr);
        headerCell.classList.add('header-separator-bottom');
        headerCell.textContent = day;

        if (currentYear === today.getFullYear() && (currentMonth - 1) === today.getMonth() && day === today.getDate()) {
            headerCell.classList.add('current-day-highlight');
        }

        grid.appendChild(headerCell);
    }
    const totalHeader = document.createElement('div');
    totalHeader.className = 'grid-header-total header-separator-bottom';
    totalHeader.textContent = 'Std.';
    grid.appendChild(totalHeader);

    const visibleUsers = allUsers.filter(user => user.shift_plan_visible === true);
    visibleUsers.forEach(user => {

        const isCurrentUser = (loggedInUser && loggedInUser.id === user.id);
        const currentUserClass = isCurrentUser ? ' current-user-row' : '';

        const nameCell = document.createElement('div');
        nameCell.className = 'grid-user-name' + currentUserClass;
        nameCell.textContent = `${user.vorname} ${user.name}`;
        grid.appendChild(nameCell);

        const dogCell = document.createElement('div');
        dogCell.className = 'grid-user-dog' + currentUserClass;
        dogCell.textContent = user.diensthund || '---';
        grid.appendChild(dogCell);

        const uebertragCell = document.createElement('div');
        uebertragCell.className = 'grid-user-uebertrag' + currentUserClass;
        const lastMonthShift = currentShiftsLastMonth[user.id];
        if (lastMonthShift && lastMonthShift.shift_type) {
            uebertragCell.textContent = lastMonthShift.shift_type.abbreviation;
            uebertragCell.title = `Schicht am Vormonat: ${lastMonthShift.shift_type.name}`;
        } else {
            uebertragCell.textContent = '---';
        }
        grid.appendChild(uebertragCell);

        for (let day = 1; day <= daysInMonth; day++) {
            const d = new Date(currentYear, currentMonth - 1, day);
            const isWeekend = d.getDay() === 0 || d.getDay() === 6;
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const dayOfMonth = String(d.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${dayOfMonth}`;
            const key = `${user.id}-${dateStr}`;
            const violationKey = `${user.id}-${day}`;
            const eventType = currentSpecialDates[dateStr];
            const shift = currentShifts[key];
            const shiftType = shift ? shift.shift_type : null;
            const cell = document.createElement('div');
            let cellClasses = 'grid-cell';
            let cellColor = null;
            let textColor = null;

            if (currentViolations.has(violationKey)) {
                 cellClasses += ' violation';
            }
            const dayHasSpecialBg = eventType || isWeekend;

            // --- START: LOGIK FÜR QUERIES ---

            // Wir suchen ALLE Queries für diese Zelle
            const queriesForCell = currentShiftQueries.filter(q =>
                (q.target_user_id === user.id && q.shift_date === dateStr && q.status === 'offen') ||
                (q.target_user_id === null && q.shift_date === dateStr && q.status === 'offen')
            );

            // Trenne in Wunsch (Hundeführer) und Notiz (Andere)
            const wunschQuery = queriesForCell.find(q => isWunschAnfrage(q));
            const notizQuery = queriesForCell.find(q => !isWunschAnfrage(q));

            let shiftRequestText = "";
            let showQuestionMark = false;
            let isShiftRequestCell = false;

            // --- ANSICHTS-LOGIK ---

            if (isPlanschreiber) {
                // Planschreiber sieht Wünsche NICHT als Text/Farbe, nur Notizen
                if (notizQuery) {
                    showQuestionMark = true;
                }
            } else if (isHundefuehrer) {
                // Hundeführer sieht NUR seine Wünsche (Text/Farbe), KEINE Notizen (Fragezeichen)
                if (wunschQuery) {
                    isShiftRequestCell = true;
                    shiftRequestText = wunschQuery.message.substring("Anfrage für:".length).trim();
                }
                // showQuestionMark bleibt false
            } else {
                // Admin (sieht alles)
                if (wunschQuery) {
                    isShiftRequestCell = true;
                    shiftRequestText = wunschQuery.message.substring("Anfrage für:".length).trim();
                }
                if (notizQuery) {
                    showQuestionMark = true;
                }
            }

            // --- RENDER-LOGIK ---

            if (shiftType) {
                cell.textContent = shiftType.abbreviation;
                if (shiftType.prioritize_background && dayHasSpecialBg) {
                    if (eventType === 'holiday') cellClasses += ` day-color-${eventType}`;
                    else if (isWeekend) cellClasses += ' weekend';
                } else {
                    cellColor = shiftType.color;
                    textColor = isColorDark(shiftType.color) ? 'white' : 'black';
                }
            } else if (isShiftRequestCell) {
                cell.textContent = shiftRequestText;
                cellClasses += ' shift-request-cell';
            } else {
                 cell.textContent = '';
                 if (eventType === 'holiday') cellClasses += ` day-color-${eventType}`;
                 else if (isWeekend) cellClasses += ' weekend';
            }

            if (showQuestionMark) {
                 cell.innerHTML += `<span class="shift-query-icon">❓</span>`;
            }

            // Wir setzen KEINE queryId mehr direkt ins Dataset, da es mehrere geben kann.
            // showClickActionModal sucht sich die IDs selbst.

            // --- ENDE: LOGIK FÜR QUERIES ---


            cell.className = cellClasses + currentUserClass;

            if (currentYear === today.getFullYear() && (currentMonth - 1) === today.getMonth() && day === today.getDate()) {
                cell.classList.add('current-day-highlight');
            }

            if (cellColor) { cell.style.backgroundColor = cellColor; }
            if (textColor) { cell.style.color = textColor; }
            cell.dataset.key = key;


            const isCellOnOwnRow = isCurrentUser;

            const handleClick = (e) => {
                e.preventDefault();
                if (isVisitor) return;

                showClickActionModal(e, user, dateStr, cell, isCellOnOwnRow);
            };

            const handleMouseEnter = () => {
                hoveredCellContext = {
                    userId: user.id, dateStr: dateStr,
                    userName: `${user.vorname} ${user.name}`,
                    cellElement: cell
                };
                if (!(currentPlanStatus && currentPlanStatus.is_locked) || isVisitor || isPlanschreiber || isHundefuehrer) {
                     cell.classList.add('hovered');
                }
            };
            const handleMouseLeave = () => {
                hoveredCellContext = null;
                cell.classList.remove('hovered');
            };

            if (isVisitor) {
                cell.addEventListener('mouseenter', handleMouseEnter);
                cell.addEventListener('mouseleave', handleMouseLeave);
            } else {
                cell.addEventListener('click', handleClick);
                cell.addEventListener('mouseenter', handleMouseEnter);
                cell.addEventListener('mouseleave', handleMouseLeave);
            }

            cell.addEventListener('contextmenu', e => e.preventDefault());

            grid.appendChild(cell);
        }
        const totalCell = document.createElement('div');
        totalCell.className = 'grid-user-total' + currentUserClass;
        totalCell.id = `total-hours-${user.id}`;
        const userTotalHours = currentTotals[user.id] || 0.0;
        totalCell.textContent = userTotalHours.toFixed(1);
        grid.appendChild(totalCell);
    });

    try {
        if (nameHeader2 && dogHeader) {
            computedColWidthName = `${nameHeader2.offsetWidth}px`;
            computedColWidthDetails = `${dogHeader.offsetWidth}px`;
        } else {
            computedColWidthName = COL_WIDTH_NAME;
            computedColWidthDetails = COL_WIDTH_DETAILS;
        }
    } catch (e) {
        console.error("Fehler beim Messen der Spaltenbreiten:", e);
        computedColWidthName = COL_WIDTH_NAME;
        computedColWidthDetails = COL_WIDTH_DETAILS;
    }
}

function buildStaffingTable() {
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();

    const relevantShiftTypes = allShiftTypesList.filter(st =>
        (st.min_staff_mo || 0) > 0 || (st.min_staff_di || 0) > 0 ||
        (st.min_staff_mi || 0) > 0 || (st.min_staff_do || 0) > 0 ||
        (st.min_staff_fr || 0) > 0 || (st.min_staff_sa || 0) > 0 ||
        (st.min_staff_so || 0) > 0 || (st.min_staff_holiday || 0) > 0
    );

    if (relevantShiftTypes.length === 0) {
        staffingGridContainer.style.display = 'none';
        return;
    }

    staffingGridContainer.style.display = 'block';
    staffingGrid.innerHTML = '';

    const gridTemplateColumns = `${computedColWidthName} ${computedColWidthDetails} ${COL_WIDTH_UEBERTRAG} repeat(${daysInMonth}, ${COL_WIDTH_DAY}) ${COL_WIDTH_TOTAL}`;

    const dayKeyMap = [
        'min_staff_so',
        'min_staff_mo',
        'min_staff_di',
        'min_staff_mi',
        'min_staff_do',
        'min_staff_fr',
        'min_staff_sa'
    ];

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
        dragHandle.style.display = isStaffingSortingMode ? 'inline-block' : 'none';

        labelCell.appendChild(dragHandle);

        const labelText = document.createElement('span');
        labelText.textContent = `${st.abbreviation} (${st.name})`;
        labelCell.appendChild(labelText);

        labelCell.style.fontWeight = '700';
        labelCell.style.color = '#333';
        row.appendChild(labelCell);

        let emptyCell = document.createElement('div');
        emptyCell.className = 'staffing-cell staffing-untracked';
        row.appendChild(emptyCell);

        let emptyCellUebertrag = document.createElement('div');
        emptyCellUebertrag.className = 'staffing-cell staffing-untracked';
        emptyCellUebertrag.style.borderRight = '1px solid #ffcc99';
        row.appendChild(emptyCellUebertrag);

        let totalIst = 0;
        let totalSoll = 0;

        for (let day = 1; day <= daysInMonth; day++) {
            const d = new Date(currentYear, currentMonth - 1, day);
            const dayOfWeek = d.getDay();
            const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isHoliday = currentSpecialDates[dateStr] === 'holiday';

            let sollValue = 0;

            if (isHoliday) {
                sollValue = st.min_staff_holiday || 0;
            } else {
                const dayKey = dayKeyMap[dayOfWeek];
                sollValue = st[dayKey] || 0;
            }
            totalSoll += sollValue;

            const istValue = (currentStaffingActual[st_id] && currentStaffingActual[st_id][day] !== undefined)
                             ? currentStaffingActual[st_id][day]
                             : 0;
            totalIst += istValue;

            const istCell = document.createElement('div');
            let cellClasses = 'staffing-cell';

            const eventType = currentSpecialDates[dateStr];
            if (dayOfWeek === 0 || dayOfWeek === 6) {
                cellClasses += ' weekend';
            }

            if (sollValue === 0) {
                istCell.textContent = '';
                cellClasses += ' staffing-untracked';
            } else {
                istCell.textContent = istValue;
                if (istValue === sollValue) {
                    cellClasses += ' staffing-ok';
                } else if (istValue > sollValue) {
                     cellClasses += ' staffing-warning';
                } else if (istValue > 0) {
                    cellClasses += ' staffing-warning';
                } else {
                    cellClasses += ' staffing-violation';
                }
            }

            istCell.className = cellClasses;
            row.appendChild(istCell);
        }

        let totalIstCell = document.createElement('div');
        totalIstCell.className = 'staffing-total-header';
        totalIstCell.textContent = totalIst;
        if (totalIst < totalSoll) {
            totalIstCell.style.color = '#c00000';
        } else if (totalIst > totalSoll && totalSoll > 0) {
             totalIstCell.style.color = '#856404';
        }
        row.appendChild(totalIstCell);

        staffingGrid.appendChild(row);
    });

    if (isAdmin && isStaffingSortingMode) {
        initializeSortableStaffing(staffingGrid);
    }
}

function initializeSortableStaffing(container) {
    if (sortableStaffingInstance) {
        sortableStaffingInstance.destroy();
    }

    sortableStaffingInstance = new Sortable(container, {
        group: 'staffing',
        handle: '.staffing-drag-handle',
        animation: 150,
        forceFallback: true,
        fallbackClass: 'sortable-fallback',
        fallbackOnBody: true,
        swapThreshold: 0.65,
        invertSwap: true,
        direction: 'vertical',

        onStart: function (evt) {
            document.body.classList.add('dragging');
            const originalRow = evt.item;
            const ghostRow = document.querySelector('.sortable-fallback');
            if (ghostRow) {
                ghostRow.style.gridTemplateColumns = originalRow.style.gridTemplateColumns;
                ghostRow.style.width = originalRow.offsetWidth + 'px';
            }
        },
        onEnd: function () {
            document.body.classList.remove('dragging');
        },

        filter: (e) => {
            return !e.target.classList.contains('staffing-drag-handle');
        },
        draggable: '.staffing-row',
        ghostClass: 'sortable-ghost'
    });
}

async function toggleStaffingSortMode() {
    if (!isAdmin) return;

    if (isStaffingSortingMode) {
        const success = await saveStaffingOrder();
        if (success) {
            isStaffingSortingMode = false;
            if (sortableStaffingInstance) sortableStaffingInstance.destroy();

            staffingSortToggleBtn.textContent = 'Besetzung sortieren';
            staffingSortToggleBtn.classList.remove('btn-secondary');
            staffingSortToggleBtn.classList.add('btn-primary');

            document.querySelectorAll('.staffing-drag-handle').forEach(h => h.style.display = 'none');

            document.querySelectorAll('.staffing-row').forEach(r => r.classList.remove('sort-mode-active'));
        }

    } else {
        isStaffingSortingMode = true;

        staffingSortToggleBtn.textContent = 'Reihenfolge speichern';
        staffingSortToggleBtn.classList.remove('btn-primary');
        staffingSortToggleBtn.classList.add('btn-secondary');

        document.querySelectorAll('.staffing-drag-handle').forEach(h => h.style.display = 'inline-block');

        document.querySelectorAll('.staffing-row').forEach(r => r.classList.add('sort-mode-active'));

        if (staffingGrid) {
            initializeSortableStaffing(staffingGrid);
        }
    }
}

async function saveStaffingOrder() {
    const rows = document.querySelectorAll('#staffing-grid .staffing-row');
    const payload = [];

    rows.forEach((row, index) => {
        payload.push({
            id: parseInt(row.dataset.id),
            order: index
        });
    });

    staffingSortToggleBtn.textContent = 'Speichere...';
    staffingSortToggleBtn.disabled = true;

    try {
        await apiFetch('/api/shifttypes/staffing_order', 'PUT', payload);

        const newOrderMap = payload.reduce((acc, item) => {
            acc[item.id] = item.order;
            return acc;
        }, {});

        allShiftTypesList.sort((a, b) => newOrderMap[a.id] - newOrderMap[b.id]);

        staffingSortToggleBtn.disabled = false;
        return true;

    } catch (error) {
        alert('Fehler beim Speichern der Sortierung: ' + error.message);
        staffingSortToggleBtn.textContent = 'Fehler!';
        staffingSortToggleBtn.disabled = false;
        return false;
    }
}

if (staffingSortToggleBtn) {
    staffingSortToggleBtn.onclick = toggleStaffingSortMode;
}


function isColorDark(hexColor) {
    if (!hexColor) return false;
    const hex = hexColor.replace('#', '');
    if (hex.length !== 6) return false;
    try {
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminance < 0.5;
    } catch (e) {
        return false;
    }
}

async function populateStaticElements(forceReload = false) {
    if (Object.keys(allShiftTypes).length === 0 || forceReload) {
        const typeData = await apiFetch('/api/shifttypes');
        allShiftTypesList = typeData;
        allShiftTypes = {};
        typeData.forEach(st => allShiftTypes[st.id] = st);
    }

    const legendeArbeit = document.getElementById('legende-arbeit');
    const legendeAbwesenheit = document.getElementById('legende-abwesenheit');
    const legendeSonstiges = document.getElementById('legende-sonstiges');

    if (legendeArbeit) legendeArbeit.innerHTML = '';
    if (legendeAbwesenheit) legendeAbwesenheit.innerHTML = '';
    if (legendeSonstiges) legendeSonstiges.innerHTML = '';
    shiftSelection.innerHTML = '';

    const sortedTypes = allShiftTypesList;

    const specialAbbreviations = ['QA', 'S', 'DPG'];

    sortedTypes.forEach(st => {
        const item = document.createElement('div');
        item.className = 'legende-item';

        item.innerHTML = `
            <div class="legende-color" style="background-color: ${st.color};"></div>
            <span class="legende-name"><strong>${st.abbreviation}</strong> (${st.name})</span>
        `;

        if (specialAbbreviations.includes(st.abbreviation)) {
            if (legendeSonstiges) legendeSonstiges.appendChild(item);
        } else if (st.is_work_shift) {
            if (legendeArbeit) legendeArbeit.appendChild(item);
        } else {
            if (legendeAbwesenheit) legendeAbwesenheit.appendChild(item);
        }

        if (!isVisitor) {
            const btn = document.createElement('button');
            btn.textContent = `${st.abbreviation} (${st.name})`;
            btn.style.backgroundColor = st.color;
            if (isColorDark(st.color)) {
                btn.style.color = 'white';
            } else {
                btn.style.color = 'black';
            }
            btn.onclick = () => saveShift(st.id, modalContext.userId, modalContext.dateStr);
            shiftSelection.appendChild(btn);
        }
    });
}

async function saveShift(shifttypeId, userId, dateStr) {
    if (!isAdmin) {
        console.error("Nicht-Admins dürfen keine Schichten speichern.");
        return;
    }
    if (currentPlanStatus && currentPlanStatus.is_locked) {
        console.warn("Plan ist gesperrt. Speichern blockiert.");
        alert(`Aktion blockiert: Der Schichtplan für ${currentMonth}/${currentYear} ist gesperrt.`);
        return;
    }

    if (!userId || !dateStr) return;
    const key = `${userId}-${dateStr}`;
    const cell = findCellByKey(key);
    try {
        if(cell) cell.textContent = '...';
        const savedData = await apiFetch('/api/shifts', 'POST', {
            user_id: userId,
            date: dateStr,
            shifttype_id: shifttypeId
        });

        closeModal(shiftModal);
        hideClickActionModal();

        const shiftType = allShiftTypes[savedData.shifttype_id];
        const shiftWasDeleted = savedData.message && (savedData.message.includes("gelöscht") || savedData.message.includes("bereits Frei"));

        if (shiftWasDeleted) {
            currentShifts[key] = null;
        } else if (shiftType) {
            currentShifts[key] = {
                ...savedData,
                shift_type: shiftType
            };
        } else {
             currentShifts[key] = savedData;
        }

        currentViolations.clear();
        if (savedData.violations) {
            savedData.violations.forEach(v => {
                currentViolations.add(`${v[0]}-${v[1]}`);
            });
        }

        currentStaffingActual = savedData.staffing_actual || {};

        if (savedData.new_total_hours !== undefined) {
            currentTotals[userId] = savedData.new_total_hours;
        }

        await loadShiftQueries();

        buildGridDOM();
        buildStaffingTable();

    } catch (error) {
        if (cell) cell.textContent = 'Fehler!';
        let errorMsg = `Fehler beim Speichern: ${error.message}`;
        if (error.message.includes("Aktion blockiert")) {
            errorMsg = error.message;
            currentPlanStatus.is_locked = true;
            updatePlanStatusUI(currentPlanStatus);
        }

        alert(errorMsg);
        if (shiftModal.style.display === 'block') {
            shiftModalInfo.textContent = `Fehler: ${error.message}`;
        }
    }
}

function findCellByKey(key) {
    return grid.querySelector(`[data-key="${key}"]`);
}

prevMonthBtn.onclick = () => {
    currentMonth--;
    if (currentMonth < 1) { currentMonth = 12; currentYear--; }
    loadColorSettings();
    renderGrid();
};
nextMonthBtn.onclick = () => {
    currentMonth++;
    if (currentMonth > 12) { currentMonth = 1; currentYear++; }
    loadColorSettings();
    renderGrid();
};

if (planLockBtn) {
    planLockBtn.onclick = () => {
        if (!isAdmin) return;

        const newLockState = !currentPlanStatus.is_locked;
        handleUpdatePlanStatus(currentPlanStatus.status, newLockState);
    };
}

if (planStatusToggleBtn) {
    planStatusToggleBtn.onclick = () => {
        if (!isAdmin) return;

        const newStatus = (currentPlanStatus.status === "Fertiggestellt") ? "In Bearbeitung" : "Fertiggestellt";
        handleUpdatePlanStatus(newStatus, currentPlanStatus.is_locked);
    };
}

function loadShortcuts() {
    let savedShortcuts = {};
    try {
        const data = localStorage.getItem(SHORTCUT_STORAGE_KEY);
        if (data) {
            savedShortcuts = JSON.parse(data);
        }
    } catch (e) {
        console.error("Fehler beim Laden der Shortcuts aus localStorage, verwende Standards.", e);
    }
    const mergedShortcuts = {};
    const allAbbrevs = Object.values(allShiftTypes).map(st => st.abbreviation);
    allAbbrevs.forEach(abbrev => {
        const key = savedShortcuts[abbrev] || defaultShortcuts[abbrev];
        if (key) {
            mergedShortcuts[abbrev] = key;
        }
    });
    shortcutMap = Object.fromEntries(
        Object.entries(mergedShortcuts).map(([abbrev, key]) => [key, abbrev])
    );
}

window.addEventListener('keydown', async (event) => {
    if (!isAdmin) return;
    if (currentPlanStatus && currentPlanStatus.is_locked) return;

    if (shiftModal.style.display === 'block' ||
        queryModal.style.display === 'block' ||
        (clickActionModal && clickActionModal.style.display === 'block')) {
        return;
    }

    if (!hoveredCellContext || !hoveredCellContext.userId) return;

    const key = event.key.toLowerCase();
    const abbrev = shortcutMap[key];

    if (abbrev !== undefined) {
        event.preventDefault();
        const shiftType = Object.values(allShiftTypes).find(st => st.abbreviation === abbrev);
        if (shiftType) {
            await saveShift(shiftType.id, hoveredCellContext.userId, hoveredCellContext.dateStr);
        } else {
            console.warn(`Shortcut "${key}" (Abk.: "${abbrev}") nicht in allShiftTypes gefunden.`);
        }
    }
});

async function requestShift(shiftAbbrev, userId, dateStr) {
    if (isVisitor || (currentPlanStatus && currentPlanStatus.is_locked)) {
        return;
    }

    const cell = findCellByKey(`${userId}-${dateStr}`);
    if(cell) {
        cell.textContent = '...';
    }

    try {
        const payload = {
            target_user_id: userId,
            shift_date: dateStr,
            message: `Anfrage für: ${shiftAbbrev}`
        };

        await apiFetch('/api/queries', 'POST', payload);

        await loadShiftQueries();
        buildGridDOM();

        triggerNotificationUpdate();

    } catch (e) {
        alert(`Fehler beim Erstellen der Anfrage: ${e.message}`);
        buildGridDOM();
    }
}

function triggerNotificationUpdate() {
    window.dispatchEvent(new CustomEvent('dhf:notification_update'));
}

function updateQueryModalInfo(dateDisplay) {
     const selectedTypeEl = document.querySelector('input[name="query-target-type"]:checked');
     const selectedType = selectedTypeEl ? selectedTypeEl.value : 'user';

     let targetText;
     if (selectedType === 'user' && modalQueryContext.userName) {
         targetText = modalQueryContext.userName;
     } else {
         targetText = "Thema des Tages / Allgemein";
     }
     queryModalInfo.textContent = `Für: ${targetText} am ${dateDisplay}`;
}

function attachQueryTypeListeners(userName, dateDisplay) {
    if (!queryTargetSelection) return;

    queryTargetSelection.removeEventListener('change', handleQueryTypeChange);

    function handleQueryTypeChange(event) {
        if (event.target.name === 'query-target-type') {
            updateQueryModalInfo(dateDisplay);
        }
    }
    queryTargetSelection.addEventListener('change', handleQueryTypeChange);
}

function renderReplies(replies, originalQuery) {
    if (!queryRepliesList) return;

    const originalQueryItem = document.getElementById('initial-query-item');
    if (originalQueryItem) {
        const senderName = originalQuery.sender_name || "Unbekannt";
        const formattedDate = new Date(originalQuery.created_at).toLocaleTimeString('de-DE', {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'});

        originalQueryItem.innerHTML = `
            <div class="reply-meta">
                <strong>${senderName} (Erstanfrage)</strong> am ${formattedDate} Uhr
            </div>
            <div class="reply-text" style="font-style: italic;">
                ${originalQuery.message}
            </div>
        `;
    }

    let currentChild = queryRepliesList.lastElementChild;
    while (currentChild) {
        const prev = currentChild.previousElementSibling;
        if (currentChild.id !== 'initial-query-item') {
            queryRepliesList.removeChild(currentChild);
        }
        currentChild = prev;
    }

    replies.forEach(reply => {
        const li = document.createElement('li');
        li.className = 'reply-item';
        const isSelf = reply.user_id === loggedInUser.id;
        const formattedDate = new Date(reply.created_at).toLocaleTimeString('de-DE', {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'});

        li.innerHTML = `
            <div class="reply-meta" style="color: ${isSelf ? '#3498db' : '#888'};">
                <strong>${reply.user_name}</strong> am ${formattedDate} Uhr
            </div>
            <div class="reply-text">
                ${reply.message}
            </div>
        `;
        queryRepliesList.appendChild(li);
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
        if(queryRepliesList) queryRepliesList.innerHTML = `<li style="color:red; list-style: none; padding: 10px 0;">Fehler beim Laden der Antworten: ${e.message}</li>`;
    }
}

function openQueryModal(userId, dateStr, userName, queryId) {
    const d = new Date(dateStr);
    const dateDisplay = d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' });

    modalQueryContext = { userId, dateStr, userName, queryId: queryId || null };

    queryModalStatus.textContent = "";
    queryMessageInput.value = "";
    document.getElementById('reply-message-input').value = '';

    queryReplyForm.style.display = 'none';
    const conversationContainer = document.getElementById('query-conversation-container');
    if(conversationContainer) conversationContainer.style.display = 'none';

    if (queryTargetSelection) {
        targetTypeUser.checked = true;
        const isNewQuery = !queryId;
        queryTargetSelection.style.display = isNewQuery ? 'block' : 'none';

        if (isHundefuehrer && !isAdmin && !isPlanschreiber) {
             queryTargetSelection.style.display = 'none';
        }

        attachQueryTypeListeners(userName, dateDisplay);
    }

    const query = queryId ? currentShiftQueries.find(q => q.id == queryId) : null;

    if (query) {
        // --- START: SICHERHEITSCHECK FÜR PLANSCHREIBER (Wunsch-Anfrage) ---
        const isWunsch = isWunschAnfrage(query);

        // Wenn Planschreiber eine Wunsch-Anfrage öffnet (z.B. über direkten Link oder Fehler),
        // darf er den Inhalt NICHT sehen und keine Aktionen ausführen.
        // Er sieht stattdessen das "Neue Anfrage"-Formular, als ob nichts da wäre.
        if (isPlanschreiber && isWunsch) {
             // Reset zu "Neue Anfrage"
             modalQueryContext.queryId = null; // ID löschen
             queryExistingContainer.style.display = 'none';
             queryAdminActions.style.display = 'none';
             queryNewContainer.style.display = 'block';
             queryReplyForm.style.display = 'none';

             let targetName = "Thema des Tages / Allgemein"; // Fallback
             queryModalInfo.textContent = `Für: ${targetName} am ${dateDisplay}`;

             queryModal.style.display = 'block';
             return; // Abbruch der normalen "Bestehende Anfrage"-Logik
        }
        // --- ENDE SICHERHEITSCHECK ---

        queryExistingContainer.style.display = 'block';
        queryNewContainer.style.display = 'none';

        loadQueryConversation(queryId, query);
        if(conversationContainer) conversationContainer.style.display = 'block';
        queryReplyForm.style.display = 'block';

        // --- START: ANGEPASSTE SICHTBARKEITSLOGIK (Buttons) ---

        // Standard: Admin-Actions ausblenden
        queryAdminActions.style.display = 'none';

        if (isAdmin) {
            // Admin sieht Actions immer
            queryAdminActions.style.display = 'flex';
            if (queryResolveBtn) queryResolveBtn.style.display = 'block';
            if (queryDeleteBtn) queryDeleteBtn.textContent = 'Anfrage löschen';
        } else if (isPlanschreiber) {
            // Planschreiber sieht Actions NUR bei NICHT-Wunsch-Anfragen
            if (!isWunsch) {
                queryAdminActions.style.display = 'flex';
                if (queryResolveBtn) queryResolveBtn.style.display = 'block';
                if (queryDeleteBtn) queryDeleteBtn.textContent = 'Anfrage löschen';
            }
        } else if (isHundefuehrer && query.sender_user_id === loggedInUser.id) {
             queryAdminActions.style.display = 'flex';
             if (queryResolveBtn) queryResolveBtn.style.display = 'none';
             if (queryDeleteBtn) queryDeleteBtn.textContent = 'Anfrage zurückziehen';
        }
        // --- ENDE: ANGEPASSTE SICHTBARKEITSLOGIK ---

        let targetName = query.target_name || "Thema des Tages / Allgemein";
        queryModalInfo.textContent = `Für: ${targetName} am ${dateDisplay}`;

    } else {
        queryExistingContainer.style.display = 'none';
        queryAdminActions.style.display = 'none';
        queryNewContainer.style.display = 'block';
        queryReplyForm.style.display = 'none';

        updateQueryModalInfo(dateDisplay);
    }

    queryModal.style.display = 'block';
}


async function saveShiftQuery() {
    querySubmitBtn.disabled = true;
    queryModalStatus.textContent = "Sende...";
    queryModalStatus.style.color = '#555';

    let selectedType = 'user';
    if (queryTargetSelection.style.display === 'block') {
         selectedType = document.querySelector('input[name="query-target-type"]:checked').value;
    }

    try {
        let targetUserId = null;

        if (isHundefuehrer && !isAdmin && !isPlanschreiber) {
            targetUserId = modalQueryContext.userId;
        } else {
             targetUserId = selectedType === 'user' ? modalQueryContext.userId : null;
        }


        const payload = {
            target_user_id: targetUserId,
            shift_date: modalQueryContext.dateStr,
            message: queryMessageInput.value
        };

        if (payload.message.length < 3) {
            throw new Error("Nachricht ist zu kurz.");
        }

        await apiFetch('/api/queries', 'POST', payload);

        queryModalStatus.textContent = "Gespeichert!";
        queryModalStatus.style.color = '#2ecc71';

        await loadShiftQueries();
        buildGridDOM();

        triggerNotificationUpdate();

        setTimeout(() => {
            closeModal(queryModal);
            querySubmitBtn.disabled = false;
        }, 1000);

    } catch (e) {
        queryModalStatus.textContent = `Fehler: ${e.message}`;
        queryModalStatus.style.color = '#e74c3c';
        querySubmitBtn.disabled = false;
    }
}

async function sendReply() {
    const queryId = modalQueryContext.queryId;
    const message = replyMessageInput.value.trim();

    if (!queryId || message.length < 3) {
        queryModalStatus.textContent = "Nachricht ist zu kurz.";
        queryModalStatus.style.color = '#e74c3c';
        return;
    }

    replySubmitBtn.disabled = true;
    queryModalStatus.textContent = "Sende Antwort...";
    queryModalStatus.style.color = '#555';

    try {
        const payload = { message: message };
        await apiFetch(`/api/queries/${queryId}/replies`, 'POST', payload);

        const originalQuery = currentShiftQueries.find(q => q.id == queryId);

        replyMessageInput.value = '';
        await loadQueryConversation(queryId, originalQuery);

        queryModalStatus.textContent = "Antwort gesendet!";
        queryModalStatus.style.color = '#2ecc71';

        triggerNotificationUpdate();

        setTimeout(() => {
            queryModalStatus.textContent = '';
        }, 2000);

    } catch (e) {
        queryModalStatus.textContent = `Fehler: ${e.message}`;
        queryModalStatus.style.color = '#e74c3c';
    } finally {
        replySubmitBtn.disabled = false;
    }
}

async function resolveShiftQuery() {
    if (!isAdmin && !isPlanschreiber || !modalQueryContext.queryId) return;

    queryResolveBtn.disabled = true;
    queryModalStatus.textContent = "Speichere Status...";
    queryModalStatus.style.color = '#555';

    try {
        await apiFetch(`/api/queries/${modalQueryContext.queryId}/status`, 'PUT', {
            status: 'erledigt'
        });

        await loadShiftQueries();
        buildGridDOM();

        triggerNotificationUpdate();

        closeModal(queryModal);

    } catch (e) {
         queryModalStatus.textContent = `Fehler: ${e.message}`;
         queryModalStatus.style.color = '#e74c3c';
    } finally {
        queryResolveBtn.disabled = false;
    }
}

async function deleteShiftQueryFromModal(queryId, force = false) {
    const qId = queryId || modalQueryContext.queryId;
    if (!qId) return;

    if (!isAdmin && !isPlanschreiber && !isHundefuehrer) return;

    if (isHundefuehrer && !isAdmin && !isPlanschreiber) {
        const query = currentShiftQueries.find(q => q.id == qId);
        if (!query || query.sender_user_id !== loggedInUser.id) {
            alert("Fehler: Sie dürfen nur Ihre eigenen Anfragen löschen.");
            return;
        }
    }

    if (!force && !confirm("Sind Sie sicher, dass Sie diese Anfrage endgültig löschen/zurückziehen möchten?")) {
        return;
    }

    if(queryDeleteBtn) queryDeleteBtn.disabled = true;
    if(queryModalStatus) queryModalStatus.textContent = "Lösche Anfrage...";
    if(queryModalStatus) queryModalStatus.style.color = '#e74c3c';

    try {
        await apiFetch(`/api/queries/${qId}`, 'DELETE');

        await loadShiftQueries();
        buildGridDOM();

        triggerNotificationUpdate();

        closeModal(queryModal);

    } catch (e) {
         if(queryModalStatus) queryModalStatus.textContent = `Fehler beim Löschen: ${e.message}`;
         if(queryModalStatus) queryModalStatus.style.color = '#e74c3c';
    } finally {
        if(queryDeleteBtn) queryDeleteBtn.disabled = false;
    }
}

async function handleAdminApprove(query) {
    if (!isAdmin || !query) {
        alert("Fehler: Nur Admins können genehmigen."); return;
    }
    if (clickModalContext.isPlanGesperrt) {
        alert(`Aktion blockiert: Der Schichtplan für ${currentMonth}/${currentYear} ist gesperrt.`);
        return;
    }

    const prefix = "Anfrage für:";
    let abbrev = query.message.substring(prefix.length).trim();
    abbrev = abbrev.endsWith('?') ? abbrev.slice(0, -1) : abbrev;

    const shiftType = allShiftTypesList.find(st => st.abbreviation === abbrev);
    if (!shiftType) {
        alert(`Fehler: Schichtart "${abbrev}" nicht im System gefunden. Kann nicht genehmigen.`);
        return;
    }

    const cell = findCellByKey(`${query.target_user_id}-${query.shift_date}`);
    if (cell) cell.textContent = '...';

    try {
        await apiFetch('/api/shifts', 'POST', {
            user_id: query.target_user_id,
            date: query.shift_date,
            shifttype_id: shiftType.id
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
    if (!isAdmin || !query) {
        alert("Fehler: Nur Admins können ablehnen."); return;
    }
    if (clickModalContext.isPlanGesperrt) {
        alert(`Aktion blockiert: Der Schichtplan für ${currentMonth}/${currentYear} ist gesperrt.`);
        return;
    }

    if (!confirm("Sind Sie sicher, dass Sie diese Anfrage ABLEHNEN möchten? \n(Die Schicht im Plan wird auf 'FREI' gesetzt und die Anfrage gelöscht.)")) {
        return;
    }

    const cell = findCellByKey(`${query.target_user_id}-${query.shift_date}`);
    if (cell) cell.textContent = '...';

    try {
        await apiFetch('/api/shifts', 'POST', {
            user_id: query.target_user_id,
            date: query.shift_date,
            shifttype_id: null
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

async function initialize() {
    await loadColorSettings();
    await populateStaticElements();
    loadShortcuts();

    let highlightData = null;
    try {
        const data = localStorage.getItem(DHF_HIGHLIGHT_KEY);
        if (data) {
            highlightData = JSON.parse(data);
            localStorage.removeItem(DHF_HIGHLIGHT_KEY);

            const targetDate = new Date(highlightData.date);
            currentYear = targetDate.getFullYear();
            currentMonth = targetDate.getMonth() + 1;
        }
    } catch (e) {
        console.error("Fehler beim Lesen der Highlight-Daten:", e);
        highlightData = null;
    }

    await renderGrid();

    if (highlightData) {
        highlightCells(highlightData.date, highlightData.targetUserId);
    }
}

function highlightCells(dateStr, targetUserId) {
    const day = new Date(dateStr).getDate();

    const highlightClass = 'grid-cell-highlight';

    let cellsToHighlight = [];

    if (targetUserId) {
        const key = `${targetUserId}-${dateStr}`;
        const cell = findCellByKey(key);
        if (cell) cellsToHighlight.push(cell);

    } else {
        const allCellsInDay = document.querySelectorAll(`.grid-cell[data-key$="-${dateStr}"]`);
        cellsToHighlight = Array.from(allCellsInDay);
    }

    if (cellsToHighlight.length > 0) {
        cellsToHighlight[0].scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'center'
        });

        cellsToHighlight.forEach(cell => {
            cell.classList.add(highlightClass);
        });

        setTimeout(() => {
            cellsToHighlight.forEach(cell => {
                cell.classList.remove(highlightClass);
            });
        }, 5000);
    }
}

initialize();