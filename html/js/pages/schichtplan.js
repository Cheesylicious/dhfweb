// html/js/pages/schichtplan.js

// --- IMPORTE ---
import { API_URL, COL_WIDTH_NAME, COL_WIDTH_DETAILS, COL_WIDTH_UEBERTRAG, COL_WIDTH_DAY, COL_WIDTH_TOTAL, SHORTCUT_STORAGE_KEY, COLOR_STORAGE_KEY, DHF_HIGHLIGHT_KEY, DEFAULT_COLORS, DEFAULT_SHORTCUTS } from '../utils/constants.js';
import { apiFetch } from '../utils/api.js';
import { initAuthCheck, logout } from '../utils/auth.js';
import { isColorDark, isWunschAnfrage, triggerNotificationUpdate, escapeHTML } from '../utils/helpers.js';

// --- Globales Setup ---
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

let computedColWidthName = COL_WIDTH_NAME;
let computedColWidthDetails = COL_WIDTH_DETAILS;

let shortcutMap = {};

let isVisitor = false;
let isAdmin = false;
let isPlanschreiber = false;
let isHundefuehrer = false;

let isStaffingSortingMode = false;
let sortableStaffingInstance = null;

// --- GENERATOR VARIABLEN ---
let generatorInterval = null;
let isGenerating = false;

// --- BULK MODE VARIABLEN ---
let isBulkMode = false;
let selectedQueryIds = new Set();

// --- DOM ELEMENTE ---
const gridContainer = document.getElementById('schichtplan-grid-container');
const grid = document.getElementById('schichtplan-grid');
const staffingGridContainer = document.getElementById('staffing-grid-container');
const staffingGrid = document.getElementById('staffing-grid');
const monthLabel = document.getElementById('current-month-label');
const prevMonthBtn = document.getElementById('prev-month-btn');
const nextMonthBtn = document.getElementById('next-month-btn');
const staffingSortToggleBtn = document.getElementById('staffing-sort-toggle');

const planStatusContainer = document.getElementById('plan-status-container');
// planStatusBadge entfernt!
const planLockBtn = document.getElementById('plan-lock-btn');
const planStatusToggleBtn = document.getElementById('plan-status-toggle-btn');

// NEU: E-Mail Senden Button
const planSendMailBtn = document.getElementById('plan-send-mail-btn');

// Bulk Mode Elemente
const planBulkModeBtn = document.getElementById('plan-bulk-mode-btn');
const bulkActionBarPlan = document.getElementById('bulk-action-bar-plan');
const bulkStatusText = document.getElementById('bulk-status-text');
const bulkApproveBtn = document.getElementById('bulk-approve-btn');
const bulkRejectBtn = document.getElementById('bulk-reject-btn');
const bulkCancelBtn = document.getElementById('bulk-cancel-btn');

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

// --- GENERATOR DOM ELEMENTE ---
const generatorModal = document.getElementById('generator-modal');
const closeGeneratorModalBtn = document.getElementById('close-generator-modal');
const startGeneratorBtn = document.getElementById('start-generator-btn');
const generatorLogContainer = document.getElementById('generator-log-container');
const genProgressFill = document.getElementById('gen-progress-fill');
const genTargetMonthLabel = document.getElementById('gen-target-month');

const genSettingsModal = document.getElementById('gen-settings-modal');
const closeGenSettingsModalBtn = document.getElementById('close-gen-settings-modal');
const saveGenSettingsBtn = document.getElementById('save-gen-settings-btn');
const genSettingsStatus = document.getElementById('gen-settings-status');
const genShiftsContainer = document.getElementById('gen-shifts-container');

// --- MONTH PICKER DOM ELEMENTE ---
const monthPickerDropdown = document.getElementById('month-picker-dropdown');
const mpYearDisplay = document.getElementById('mp-year-display');
const mpPrevYearBtn = document.getElementById('mp-prev-year');
const mpNextYearBtn = document.getElementById('mp-next-year');
const mpMonthsGrid = document.getElementById('mp-months-grid');
let pickerYear = currentYear;

// Links im Dropdown & Hauptmenüs
const openGeneratorLink = document.getElementById('open-generator-modal');
const openGenSettingsLink = document.getElementById('open-gen-settings-modal');
const deletePlanLink = document.getElementById('delete-plan-link');
const settingsDropdown = document.getElementById('settings-dropdown');


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

// --- 1. Authentifizierung ---
try {
    const authData = initAuthCheck();
    loggedInUser = authData.user;
    isAdmin = authData.isAdmin;
    isVisitor = authData.isVisitor;
    isPlanschreiber = authData.isPlanschreiber;
    isHundefuehrer = authData.isHundefuehrer;

    if (staffingSortToggleBtn) {
        staffingSortToggleBtn.style.display = isAdmin ? 'inline-block' : 'none';
    }

    if (!isAdmin) {
        if (openGeneratorLink) openGeneratorLink.style.display = 'none';
        if (openGenSettingsLink) openGenSettingsLink.style.display = 'none';
        if (deletePlanLink) deletePlanLink.style.display = 'none';
        if (settingsDropdown) settingsDropdown.style.display = 'none';
        if (planBulkModeBtn) planBulkModeBtn.style.display = 'none';
        if (planSendMailBtn) planSendMailBtn.style.display = 'none'; // Button nur für Admin
    } else {
        if (planBulkModeBtn) planBulkModeBtn.style.display = 'inline-block';
    }

} catch (e) {
    console.error("Initialisierung gestoppt:", e);
}

// --- 2. Hilfsfunktionen ---

function closeModal(modalEl) {
    if (modalEl) modalEl.style.display = 'none';
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

// --- Helper für schnelle lokale Updates ---

function refreshSingleCell(userId, dateStr) {
    const key = `${userId}-${dateStr}`;
    const cell = grid.querySelector(`.grid-cell[data-key="${key}"]`);
    if (!cell) return;

    const d = new Date(dateStr);
    const day = d.getDate();
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const eventType = currentSpecialDates[dateStr];
    const shift = currentShifts[key];
    const shiftType = shift ? shift.shift_type : null;
    const violationKey = `${userId}-${day}`;

    let cellClasses = 'grid-cell';
    if (loggedInUser.id === userId) cellClasses += ' current-user-row';
    if (currentViolations.has(violationKey)) cellClasses += ' violation';
    if (shift && shift.is_locked) cellClasses += ' locked-shift';

    cell.textContent = '';
    cell.style.backgroundColor = '';
    cell.style.color = '';
    delete cell.dataset.queryId; // Reset

    const queriesForCell = currentShiftQueries.filter(q =>
        (q.target_user_id === userId && q.shift_date === dateStr && q.status === 'offen')
    );
    const wunschQuery = queriesForCell.find(q => isWunschAnfrage(q));
    const notizQuery = queriesForCell.find(q => !isWunschAnfrage(q));

    let shiftRequestText = "";
    let showQuestionMark = false;
    let isShiftRequestCell = false;

    if (isPlanschreiber) {
        if (notizQuery) showQuestionMark = true;
    } else if (isHundefuehrer) {
        if (wunschQuery) {
            isShiftRequestCell = true;
            shiftRequestText = wunschQuery.message.substring("Anfrage für:".length).trim();
        }
    } else {
        if (wunschQuery) {
            isShiftRequestCell = true;
            shiftRequestText = wunschQuery.message.substring("Anfrage für:".length).trim();
        }
        if (notizQuery) showQuestionMark = true;
    }

    const dayHasSpecialBg = eventType || isWeekend;

    if (shiftType) {
        cell.textContent = shiftType.abbreviation;
        if (shiftType.prioritize_background && dayHasSpecialBg) {
            if (eventType === 'holiday') cellClasses += ` day-color-${eventType}`;
            else if (isWeekend) cellClasses += ' weekend';
        } else {
            cell.style.backgroundColor = shiftType.color;
            cell.style.color = isColorDark(shiftType.color) ? 'white' : 'black';
        }
    } else if (isShiftRequestCell) {
        cell.textContent = shiftRequestText;
        cellClasses += ' shift-request-cell';
        if (wunschQuery) cell.dataset.queryId = wunschQuery.id;
    } else {
         if (eventType === 'holiday') cellClasses += ` day-color-${eventType}`;
         else if (isWeekend) cellClasses += ' weekend';
    }

    if (showQuestionMark) {
         cell.innerHTML += `<span class="shift-query-icon">❓</span>`;
    }

    cell.className = cellClasses;

    if (isBulkMode && wunschQuery && selectedQueryIds.has(wunschQuery.id)) {
        cell.classList.add('selected');
    }
}

function updateUserTotalHours(userId, delta) {
    const totalCell = document.getElementById(`total-hours-${userId}`);
    if (!totalCell) return;

    let currentVal = parseFloat(totalCell.textContent);
    if (isNaN(currentVal)) currentVal = 0;

    const newVal = currentVal + delta;
    currentTotals[userId] = newVal;

    totalCell.textContent = newVal.toFixed(1);

    totalCell.style.backgroundColor = '#eaf2ff';
    setTimeout(() => { totalCell.style.backgroundColor = ''; }, 500);
}

function updateLocalStaffing(shiftAbbrev, dateStr, delta) {
    const cleanAbbrev = shiftAbbrev.replace('?', '').trim();
    const st = allShiftTypesList.find(s => s.abbreviation === cleanAbbrev);
    if (!st) return;

    const d = new Date(dateStr);
    const day = d.getDate();

    if (!currentStaffingActual[st.id]) currentStaffingActual[st.id] = {};
    if (!currentStaffingActual[st.id][day]) currentStaffingActual[st.id][day] = 0;

    currentStaffingActual[st.id][day] += delta;

    if (currentStaffingActual[st.id][day] < 0) currentStaffingActual[st.id][day] = 0;
}

function refreshStaffingGrid() {
    if (!staffingGrid) return;
    const rows = staffingGrid.querySelectorAll('.staffing-row');

    rows.forEach(row => {
        const stId = parseInt(row.dataset.id);
        const shiftType = allShiftTypes[stId];
        if (!shiftType) return;

        const cells = row.children;
        const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();

        let totalIst = 0;
        let totalSoll = 0;

        const dayKeyMap = ['min_staff_so', 'min_staff_mo', 'min_staff_di', 'min_staff_mi', 'min_staff_do', 'min_staff_fr', 'min_staff_sa'];

        for (let d = 1; d <= daysInMonth; d++) {
            const cellIndex = d + 2;
            if (cellIndex >= cells.length) break;

            const cell = cells[cellIndex];

            const dateObj = new Date(currentYear, currentMonth - 1, d);
            const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const dayOfWeek = dateObj.getDay();
            const isHoliday = currentSpecialDates[dateStr] === 'holiday';

            let soll = 0;
            if (isHoliday) soll = shiftType.min_staff_holiday || 0;
            else soll = shiftType[dayKeyMap[dayOfWeek]] || 0;

            totalSoll += soll;

            const ist = (currentStaffingActual[stId] && currentStaffingActual[stId][d]) || 0;
            totalIst += ist;

            if (soll === 0) {
                 cell.textContent = '';
                 cell.className = 'staffing-cell staffing-untracked';
                 if (dayOfWeek === 0 || dayOfWeek === 6) cell.classList.add('weekend');
            } else {
                cell.textContent = ist;
                let cls = 'staffing-cell';
                if (dayOfWeek === 0 || dayOfWeek === 6) cls += ' weekend';

                if (ist === soll) cls += ' staffing-ok';
                else if (ist > soll) cls += ' staffing-warning';
                else if (ist > 0) cls += ' staffing-warning';
                else cls += ' staffing-violation';

                cell.className = cls;
            }
        }

        const totalCell = cells[cells.length - 1];
        totalCell.textContent = totalIst;

        if (totalIst < totalSoll) totalCell.style.color = '#c00000';
        else if (totalIst > totalSoll && totalSoll > 0) totalCell.style.color = '#856404';
        else totalCell.style.color = '#333';
    });
}

async function toggleShiftLock(userId, dateStr) {
    if (!isAdmin) return;
    if (currentPlanStatus && currentPlanStatus.is_locked) {
        alert("Globaler Plan ist gesperrt. Einzelne Schichten können nicht geändert werden.");
        return;
    }

    const key = `${userId}-${dateStr}`;
    const cell = findCellByKey(key);

    try {
        const response = await apiFetch('/api/shifts/toggle_lock', 'POST', {
            user_id: userId,
            date: dateStr
        });

        if (response.deleted) {
            currentShifts[key] = null;
            refreshSingleCell(userId, dateStr);
        } else {
            const shiftType = response.shifttype_id ? allShiftTypes[response.shifttype_id] : null;
            currentShifts[key] = {
                ...response,
                shift_type: shiftType
            };
            refreshSingleCell(userId, dateStr);
        }

    } catch (e) {
        console.error(e);
        alert("Fehler beim Sperren/Entsperren: " + e.message);
    }
}

async function clearShiftPlan() {
    if (!isAdmin) return;

    if (currentPlanStatus && currentPlanStatus.is_locked) {
        alert("Aktion blockiert: Der Schichtplan ist gesperrt.");
        return;
    }

    if (!confirm(`Sind Sie sicher, dass Sie den Schichtplan für ${currentMonth}/${currentYear} leeren möchten?\n\nHinweis: Alle NICHT gesperrten Schichten werden gelöscht. Manuell gesperrte Schichten (Schloss-Symbol) bleiben erhalten.`)) {
        return;
    }

    try {
        const response = await apiFetch('/api/shifts/clear', 'DELETE', {
            year: currentYear,
            month: currentMonth
        });
        alert(response.message);
        renderGrid();
    } catch (e) {
        alert(`Fehler beim Löschen des Plans: ${e.message}`);
    }
}


// --- GENERATOR FUNKTIONEN ---

async function openGeneratorModal() {
    if (!isAdmin) return;
    if (currentPlanStatus && currentPlanStatus.is_locked) {
        alert("Der Plan ist gesperrt. Generator kann nicht gestartet werden.");
        return;
    }

    generatorLogContainer.innerHTML = '<div class="log-entry info">Bereit zum Start...</div>';
    genProgressFill.style.width = '0%';
    genTargetMonthLabel.textContent = `${currentMonth}/${currentYear}`;
    startGeneratorBtn.disabled = false;
    startGeneratorBtn.textContent = "Generator Starten";
    isGenerating = false;

    generatorModal.style.display = 'block';
}

async function startGenerator() {
    if (isGenerating) return;
    isGenerating = true;
    startGeneratorBtn.disabled = true;
    startGeneratorBtn.textContent = "Läuft...";
    generatorLogContainer.innerHTML = '<div class="log-entry info">Starte Generator-Prozess...</div>';

    try {
        const payload = { year: currentYear, month: currentMonth };
        await apiFetch('/api/generator/start', 'POST', payload);

        if (generatorInterval) clearInterval(generatorInterval);
        generatorInterval = setInterval(pollGeneratorStatus, 1000);

    } catch (error) {
        generatorLogContainer.innerHTML += `<div class="log-entry error">Fehler beim Starten: ${error.message}</div>`;
        isGenerating = false;
        startGeneratorBtn.disabled = false;
        startGeneratorBtn.textContent = "Neustart versuchen";
    }
}

async function pollGeneratorStatus() {
    try {
        const statusData = await apiFetch('/api/generator/status');
        const progress = statusData.progress || 0;
        genProgressFill.style.width = `${progress}%`;

        if (statusData.logs && statusData.logs.length > 0) {
            generatorLogContainer.innerHTML = '';
            statusData.logs.forEach(logMsg => {
                let className = 'log-entry';
                if (logMsg.includes('[FEHLER]')) className += ' error';
                else if (logMsg.includes('[WARN]')) className += ' warning';
                else if (logMsg.includes('erfolgreich')) className += ' success';
                else className += ' info';

                const div = document.createElement('div');
                div.className = className;
                div.textContent = logMsg;
                generatorLogContainer.appendChild(div);
            });
            generatorLogContainer.scrollTop = generatorLogContainer.scrollHeight;
        }

        if (statusData.status === 'finished' || statusData.status === 'error') {
            clearInterval(generatorInterval);
            isGenerating = false;
            startGeneratorBtn.disabled = false;
            startGeneratorBtn.textContent = (statusData.status === 'finished') ? "Fertig" : "Fehler";

            if (statusData.status === 'finished') {
                 setTimeout(() => { renderGrid(); }, 1000);
            }
        }
    } catch (e) {
        console.error("Polling Fehler:", e);
    }
}

async function openGenSettingsModal() {
    if (!isAdmin) return;
    genSettingsStatus.textContent = "Lade Einstellungen...";
    genSettingsModal.style.display = 'block';

    try {
        const config = await apiFetch('/api/generator/config');

        document.getElementById('gen-max-consecutive').value = config.max_consecutive_same_shift || 4;
        document.getElementById('gen-rest-days').value = config.mandatory_rest_days_after_max_shifts || 2;
        document.getElementById('gen-fill-rounds').value = config.generator_fill_rounds || 3;
        document.getElementById('gen-fairness-threshold').value = config.fairness_threshold_hours || 10;
        document.getElementById('gen-min-hours-bonus').value = config.min_hours_score_multiplier || 5;
        document.getElementById('gen-max-hours').value = config.max_monthly_hours || 170;

        genShiftsContainer.innerHTML = '';
        const activeShifts = config.shifts_to_plan || ["6", "T.", "N."];

        allShiftTypesList.forEach(st => {
            if (!st.is_work_shift) return;
            const div = document.createElement('div');
            div.className = 'gen-shift-checkbox';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.value = st.abbreviation;
            input.id = `gen-shift-${st.id}`;
            if (activeShifts.includes(st.abbreviation)) { input.checked = true; }
            const label = document.createElement('label');
            label.htmlFor = `gen-shift-${st.id}`;
            label.textContent = `${st.abbreviation} (${st.name})`;
            div.appendChild(input);
            div.appendChild(label);
            genShiftsContainer.appendChild(div);
        });
        genSettingsStatus.textContent = "";
    } catch (error) {
        genSettingsStatus.textContent = "Fehler beim Laden: " + error.message;
    }
}

async function saveGenSettings() {
    saveGenSettingsBtn.disabled = true;
    genSettingsStatus.textContent = "Speichere...";

    const selectedShifts = [];
    const checkboxes = genShiftsContainer.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => { if (cb.checked) selectedShifts.push(cb.value); });

    if (selectedShifts.length === 0) {
         genSettingsStatus.textContent = "Fehler: Mindestens eine Schicht muss aktiviert sein.";
         genSettingsStatus.style.color = "#e74c3c";
         saveGenSettingsBtn.disabled = false;
         return;
    }

    const payload = {
        max_consecutive_same_shift: parseInt(document.getElementById('gen-max-consecutive').value),
        mandatory_rest_days_after_max_shifts: parseInt(document.getElementById('gen-rest-days').value),
        generator_fill_rounds: parseInt(document.getElementById('gen-fill-rounds').value),
        fairness_threshold_hours: parseFloat(document.getElementById('gen-fairness-threshold').value),
        min_hours_score_multiplier: parseFloat(document.getElementById('gen-min-hours-bonus').value),
        max_monthly_hours: parseFloat(document.getElementById('gen-max-hours').value),
        shifts_to_plan: selectedShifts
    };

    try {
        await apiFetch('/api/generator/config', 'PUT', payload);
        genSettingsStatus.textContent = "Gespeichert!";
        genSettingsStatus.style.color = "#2ecc71";
        setTimeout(() => {
            closeModal(genSettingsModal);
            saveGenSettingsBtn.disabled = false;
            genSettingsStatus.textContent = "";
        }, 1000);
    } catch (error) {
        genSettingsStatus.textContent = "Fehler: " + error.message;
        genSettingsStatus.style.color = "#e74c3c";
        saveGenSettingsBtn.disabled = false;
    }
}

// --- MONTH PICKER LOGIK ---

function renderMonthPicker(year) {
    mpYearDisplay.textContent = year;
    mpMonthsGrid.innerHTML = '';

    const months = [
        "Januar", "Februar", "März", "April", "Mai", "Juni",
        "Juli", "August", "September", "Oktober", "November", "Dezember"
    ];

    months.forEach((name, index) => {
        const monthNum = index + 1;
        const btn = document.createElement('div');
        btn.className = 'mp-month-btn';
        btn.textContent = name;

        if (year === currentYear && monthNum === currentMonth) {
            btn.classList.add('active');
        }

        btn.onclick = () => {
            currentYear = year;
            currentMonth = monthNum;
            monthPickerDropdown.style.display = 'none';
            loadColorSettings();
            renderGrid();
        };

        mpMonthsGrid.appendChild(btn);
    });
}

function toggleMonthPicker() {
    if (monthPickerDropdown.style.display === 'block') {
        monthPickerDropdown.style.display = 'none';
    } else {
        pickerYear = currentYear;
        renderMonthPicker(pickerYear);
        monthPickerDropdown.style.display = 'block';
    }
}

if (monthLabel) {
    monthLabel.onclick = (e) => {
        e.stopPropagation();
        toggleMonthPicker();
    };
}
if (mpPrevYearBtn) {
    mpPrevYearBtn.onclick = (e) => {
        e.stopPropagation();
        pickerYear--;
        renderMonthPicker(pickerYear);
    };
}
if (mpNextYearBtn) {
    mpNextYearBtn.onclick = (e) => {
        e.stopPropagation();
        pickerYear++;
        renderMonthPicker(pickerYear);
    };
}

window.addEventListener('click', (e) => {
    if (monthPickerDropdown && monthPickerDropdown.style.display === 'block') {
        if (!e.target.closest('#month-picker-dropdown') && !e.target.closest('#current-month-label')) {
            monthPickerDropdown.style.display = 'none';
        }
    }
});


// --- CLICK-MODAL FUNKTIONEN ---

function hideClickActionModal() {
    if (clickActionModal) {
        clickActionModal.style.display = 'none';
    }
    clickModalContext = null;
}

function showClickActionModal(event, user, dateStr, cell, isCellOnOwnRow) {
    if (isBulkMode) return;

    event.preventDefault();
    hideClickActionModal();

    const userName = `${user.vorname} ${user.name}`;
    const d = new Date(dateStr);
    const dateDisplay = d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });

    const allQueriesForCell = currentShiftQueries.filter(q =>
        q.target_user_id === user.id && q.shift_date === dateStr && q.status === 'offen'
    );

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

    camAdminWunschActions.style.display = 'none';
    camAdminShifts.style.display = 'none';
    camHundefuehrerRequests.style.display = 'none';
    camNotizActions.style.display = 'none';
    camHundefuehrerDelete.style.display = 'none';

    let hasContent = false;

    if (isAdmin) {
        if (wunschQuery && !planGesperrt) {
            camAdminWunschActions.style.display = 'grid';
            camBtnApprove.textContent = `Genehmigen (${wunschQuery.message.replace('Anfrage für:', '').trim()})`;
            hasContent = true;
        }
        if (!planGesperrt) {
            camAdminShifts.style.display = 'grid';
            populateClickModalShiftButtons('admin');
            hasContent = true;
        }
        camNotizActions.style.display = 'block';
        camLinkNotiz.textContent = notizQuery ? '❓ Text-Notiz ansehen...' : '❓ Text-Notiz erstellen...';
        camLinkNotiz.dataset.targetQueryId = notizQuery ? notizQuery.id : "";
        hasContent = true;

    } else if (isPlanschreiber) {
        camNotizActions.style.display = 'block';
        camLinkNotiz.textContent = notizQuery ? '❓ Text-Notiz ansehen...' : '❓ Text-Notiz erstellen...';
        camLinkNotiz.dataset.targetQueryId = notizQuery ? notizQuery.id : "";
        hasContent = true;

    } else if (isHundefuehrer && isCellOnOwnRow) {
        if (wunschQuery && wunschQuery.sender_user_id === loggedInUser.id && !planGesperrt) {
            camHundefuehrerDelete.style.display = 'block';
            camLinkDelete.textContent = 'Wunsch-Anfrage zurückziehen';
            camLinkDelete.dataset.targetQueryId = wunschQuery.id;
            hasContent = true;
        } else if (notizQuery && notizQuery.sender_user_id === loggedInUser.id && !planGesperrt) {
             camHundefuehrerDelete.style.display = 'block';
             camLinkDelete.textContent = 'Notiz löschen';
             camLinkDelete.dataset.targetQueryId = notizQuery.id;
             hasContent = true;
        } else if (!wunschQuery && !planGesperrt) {
            camHundefuehrerRequests.style.display = 'flex';
            camHundefuehrerRequests.style.flexDirection = 'column';
            camHundefuehrerRequests.style.gap = '8px';

            populateClickModalShiftButtons('hundefuehrer');
            hasContent = true;
        }
    }

    if (!hasContent) {
        hideClickActionModal();
        return;
    }

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

async function populateClickModalShiftButtons(mode) {
    let targetContainer;
    let buttonDefs;

    if (mode === 'admin') {
        targetContainer = camAdminShifts;
        targetContainer.innerHTML = `<div class="cam-section-title">Schicht zuweisen</div>`;

        buttonDefs = [
            { abbrev: 'T.', title: 'Tag (T.)' },
            { abbrev: 'N.', title: 'Nacht (N.)' },
            { abbrev: '6', title: 'Kurz (6)' },
            { abbrev: 'FREI', title: 'FREI' },
            { abbrev: 'U', title: 'Urlaub (U)' },
            { abbrev: 'X', title: 'Wunschfrei (X)' },
            { abbrev: 'Alle...', title: 'Alle Schichten anzeigen', isAll: true }
        ];

        buttonDefs.forEach(def => {
            const btn = document.createElement('button');
            btn.className = def.isAll ? 'cam-shift-button all' : 'cam-shift-button';
            btn.textContent = def.abbrev;
            btn.title = def.title;

            btn.onclick = () => {
                if (def.isAll) {
                    openShiftModal(clickModalContext.userId, clickModalContext.dateStr, clickModalContext.userName);
                } else {
                    const shiftType = allShiftTypesList.find(st => st.abbreviation === def.abbrev);
                    if (shiftType) {
                        saveShift(shiftType.id, clickModalContext.userId, clickModalContext.dateStr);
                    }
                }
                hideClickActionModal();
            };
            targetContainer.appendChild(btn);
        });

    } else {
        targetContainer = camHundefuehrerRequests;

        targetContainer.innerHTML = '<div class="cam-section-title">Wunsch-Anfrage</div><div style="color:#bbb; font-size:12px; padding:5px;">Lade Limits...</div>';

        const hfButtonDefs = [
            { abbrev: 'T.?', realAbbr: 'T.', title: 'Tag-Wunsch' },
            { abbrev: 'N.?', realAbbr: 'N.', title: 'Nacht-Wunsch' },
            { abbrev: '6?', realAbbr: '6', title: 'Kurz-Wunsch' },
            { abbrev: 'X?', realAbbr: 'X', title: 'Wunschfrei' },
            { abbrev: '24?', realAbbr: '24', title: '24h-Wunsch' }
        ];

        try {
            const limits = await apiFetch(`/api/queries/usage?year=${currentYear}&month=${currentMonth}`);

            targetContainer.innerHTML = `<div class="cam-section-title">Wunsch-Anfrage</div>`;

            hfButtonDefs.forEach(def => {
                const btn = document.createElement('button');
                btn.className = 'cam-shift-button';
                btn.style.width = '100%';
                btn.style.textAlign = 'left';
                btn.style.display = 'flex';
                btn.style.justifyContent = 'space-between';
                btn.style.alignItems = 'center';
                btn.style.padding = '10px';

                btn.title = def.title;

                let labelHtml = `<span style="font-weight:bold; font-size: 14px;">${def.abbrev}</span>`;
                let limitInfoHtml = '';
                let isDisabled = false;

                if (def.realAbbr === '6') {
                    const d = new Date(clickModalContext.dateStr);
                    const dayOfWeek = d.getDay();
                    const isHoliday = currentSpecialDates[clickModalContext.dateStr] === 'holiday';

                    if (dayOfWeek !== 5 || isHoliday) {
                        isDisabled = true;
                        limitInfoHtml = `<span style="font-size:12px; color: #e74c3c;">Nur Freitags (Werktag)</span>`;
                    }
                }

                if (!isDisabled) {
                    const limitData = limits[def.realAbbr];
                    if (limitData) {
                        const remaining = limitData.remaining;
                        const totalLimit = limitData.limit;

                        if (totalLimit > 0) {
                            let colorStyle = "color: #bdc3c7;";
                            if (remaining <= 0) {
                                colorStyle = "color: #e74c3c;";
                                isDisabled = true;
                            } else if (remaining <= 1) {
                                colorStyle = "color: #f39c12;";
                            }

                            limitInfoHtml = `<span style="font-size:12px; font-weight:normal; ${colorStyle}">(${remaining}x) verfügbar</span>`;
                        } else {
                            limitInfoHtml = `<span style="font-size:12px; color: #e74c3c;">Nicht verfügbar</span>`;
                            isDisabled = true;
                        }
                    } else {
                        limitInfoHtml = `<span style="font-size:12px; color: #bdc3c7;">(∞)</span>`;
                    }
                }

                btn.innerHTML = labelHtml + limitInfoHtml;

                if (isDisabled) {
                    btn.disabled = true;
                    btn.style.opacity = '0.5';
                    btn.style.cursor = 'not-allowed';
                } else {
                    btn.onclick = () => {
                        requestShift(def.abbrev, clickModalContext.userId, clickModalContext.dateStr);
                        hideClickActionModal();
                    };
                }

                targetContainer.appendChild(btn);
            });

        } catch (error) {
            console.error("Fehler beim Laden der Limits:", error);
            targetContainer.innerHTML = `<div class="cam-section-title">Wunsch-Anfrage</div><div style="color:#e74c3c; font-size:12px;">Fehler beim Laden der Limits.</div>`;
        }
    }
}

window.addEventListener('click', (e) => {
    if (!e.target.closest('.grid-cell') && !e.target.closest('#click-action-modal') && !e.target.closest('#plan-bulk-mode-btn') && !e.target.closest('#bulk-action-bar-plan')) {
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

// --- Listeners für Modal-Buttons ---
if (closeShiftModalBtn) closeShiftModalBtn.onclick = () => closeModal(shiftModal);
if (closeQueryModalBtn) closeQueryModalBtn.onclick = () => closeModal(queryModal);
if (querySubmitBtn) querySubmitBtn.onclick = () => saveShiftQuery();
if (queryResolveBtn) queryResolveBtn.onclick = () => resolveShiftQuery();
if (queryDeleteBtn) queryDeleteBtn.onclick = () => deleteShiftQueryFromModal();
if (replySubmitBtn) replySubmitBtn.onclick = () => sendReply();

// GENERATOR LISTENERS
if (openGeneratorLink) {
    openGeneratorLink.onclick = (e) => {
        e.preventDefault();
        openGeneratorModal();
    };
}
if (openGenSettingsLink) {
    openGenSettingsLink.onclick = (e) => {
        e.preventDefault();
        openGenSettingsModal();
    };
}
if (deletePlanLink) {
    deletePlanLink.onclick = (e) => {
        e.preventDefault();
        clearShiftPlan();
    };
}

if (closeGeneratorModalBtn) closeGeneratorModalBtn.onclick = () => closeModal(generatorModal);
if (startGeneratorBtn) startGeneratorBtn.onclick = startGenerator;
if (closeGenSettingsModalBtn) closeGenSettingsModalBtn.onclick = () => closeModal(genSettingsModal);
if (saveGenSettingsBtn) saveGenSettingsBtn.onclick = saveGenSettings;


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
        deleteShiftQueryFromModal(specificId, true, clickModalContext);
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
    if (event.target == generatorModal) closeModal(generatorModal);
    if (event.target == genSettingsModal) closeModal(genSettingsModal);
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
        const specialDatesPromise = loadSpecialDates(currentYear);
        const queriesPromise = loadShiftQueries();

        const [shiftPayload, specialDatesResult, queriesResult] = await Promise.all([
            shiftDataPromise,
            specialDatesPromise,
            queriesPromise
        ]);

        allUsers = shiftPayload.users;

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

    // --- STATUS BUTTON (Kombiniert Anzeige & Toggle) ---
    if (planStatusToggleBtn) {
        // Text setzen
        planStatusToggleBtn.textContent = statusData.status || "In Bearbeitung";

        // Klasse setzen (für Farbe)
        planStatusToggleBtn.className = ''; // Reset
        if (statusData.status === "Fertiggestellt") {
            planStatusToggleBtn.classList.add('status-fertiggestellt');
            planStatusToggleBtn.title = isAdmin ? "Klicken, um auf 'In Bearbeitung' zu setzen" : "Plan ist fertiggestellt";
        } else {
            planStatusToggleBtn.classList.add('status-in-bearbeitung');
            planStatusToggleBtn.title = isAdmin ? "Klicken, um auf 'Fertiggestellt' zu setzen" : "Plan ist in Bearbeitung";
        }

        // Admin-Check: Nur Admins können klicken
        planStatusToggleBtn.disabled = !isAdmin;
    }

    if (statusData.is_locked) {
        planLockBtn.textContent = "Gesperrt";
        planLockBtn.title = "Plan entsperren, um Bearbeitung zu erlauben";
        planLockBtn.classList.add('locked');
        document.body.classList.add('plan-locked');
        if(isBulkMode) toggleBulkMode();
    } else {
        planLockBtn.textContent = "Offen";
        planLockBtn.title = "Plan sperren, um Bearbeitung zu verhindern";
        planLockBtn.classList.remove('locked');
        document.body.classList.remove('plan-locked');
    }

    // FIX 1: Sichtbarkeit für Alle erzwingen (Class Removal und Display Setzen)
    if (planLockBtn) {
        planLockBtn.classList.remove('btn-admin-action');
        planLockBtn.style.display = 'inline-block';
        planLockBtn.disabled = !isAdmin;
    }

    // --- NEU: Button nur anzeigen, wenn fertiggestellt UND gesperrt ---
    if (planSendMailBtn) {
        // FIX 2: Nur für Admins sichtbar
        if (isAdmin && statusData.status === "Fertiggestellt" && statusData.is_locked) {
             planSendMailBtn.style.display = 'inline-block';
        } else {
             planSendMailBtn.style.display = 'none';
        }
    }
    // --- ENDE NEU ---
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

// --- NEU: Logik für den Rundmail-Button ---
async function sendCompletionNotification() {
    if (!confirm("Möchten Sie wirklich eine Rundmail an alle Mitarbeiter senden, dass der Plan fertiggestellt ist?")) return;

    planSendMailBtn.disabled = true;
    planSendMailBtn.textContent = "Sende...";

    try {
        const response = await apiFetch('/api/shifts/send_completion_notification', 'POST', {
            year: currentYear,
            month: currentMonth
        });
        alert(response.message);
    } catch (e) {
        alert("Fehler beim Senden: " + e.message);
    } finally {
        planSendMailBtn.disabled = false;
        planSendMailBtn.textContent = "📧 Rundmail";
    }
}

if (planSendMailBtn) {
    planSendMailBtn.onclick = sendCompletionNotification;
}
// --- ENDE NEU ---


function buildGridDOM() {
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    const monthName = new Date(currentYear, currentMonth - 1, 1).toLocaleString('de-DE', { month: 'long', year: 'numeric' });
    monthLabel.textContent = monthName;

    const today = new Date();

    grid.style.gridTemplateColumns = `${computedColWidthName} ${computedColWidthDetails} ${COL_WIDTH_UEBERTRAG} repeat(${daysInMonth}, ${COL_WIDTH_DAY}) ${COL_WIDTH_TOTAL}`;

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

            // --- LOGIK FÜR QUERIES ---

            const queriesForCell = currentShiftQueries.filter(q =>
                (q.target_user_id === user.id && q.shift_date === dateStr && q.status === 'offen') ||
                (q.target_user_id === null && q.shift_date === dateStr && q.status === 'offen')
            );

            const wunschQuery = queriesForCell.find(q => isWunschAnfrage(q));
            const notizQuery = queriesForCell.find(q => !isWunschAnfrage(q));

            let shiftRequestText = "";
            let showQuestionMark = false;
            let isShiftRequestCell = false;

            if (isPlanschreiber) {
                if (notizQuery) {
                    showQuestionMark = true;
                }
            } else if (isHundefuehrer) {
                if (wunschQuery) {
                    isShiftRequestCell = true;
                    shiftRequestText = wunschQuery.message.substring("Anfrage für:".length).trim();
                }
            } else {
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

                // --- NEU: Data ID für Bulk Select ---
                if (wunschQuery) {
                     cell.dataset.queryId = wunschQuery.id;
                }

            } else {
                 cell.textContent = '';
                 if (eventType === 'holiday') cellClasses += ` day-color-${eventType}`;
                 else if (isWeekend) cellClasses += ' weekend';
            }

            if (showQuestionMark) {
                 cell.innerHTML += `<span class="shift-query-icon">❓</span>`;
            }

            // --- NEU: Schloss-Symbol ---
            if (shift && shift.is_locked) {
                cellClasses += ' locked-shift';
            }
            // --- ENDE NEU ---

            cell.className = cellClasses + currentUserClass;

            if (currentYear === today.getFullYear() && (currentMonth - 1) === today.getMonth() && day === today.getDate()) {
                cell.classList.add('current-day-highlight');
            }

            if (cellColor) { cell.style.backgroundColor = cellColor; }
            if (textColor) { cell.style.color = textColor; }
            cell.dataset.key = key;


            const isCellOnOwnRow = isCurrentUser;

            const handleClick = (e) => {
                // --- NEU: Bulk Mode Check ---
                if (isBulkMode) {
                     e.preventDefault();
                     handleBulkCellClick(cell, user.id, dateStr);
                     return;
                }

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

        // --- NEU: OPTIMIERTES UPDATE STATT RE-RENDER ---

        // 1. Einzelne Zelle aktualisieren
        refreshSingleCell(userId, dateStr);

        // 2. Violations aktualisieren (nur im Speicher, wird beim Hover relevant oder beim nächsten Reload)
        currentViolations.clear();
        if (savedData.violations) {
            savedData.violations.forEach(v => {
                currentViolations.add(`${v[0]}-${v[1]}`);
            });
        }

        // 3. Staffing (Besetzung) aktualisieren (nur im Speicher, evtl. gezieltes DOM Update nötig?)
        currentStaffingActual = savedData.staffing_actual || {};

        // 3b. Staffing Grid aktualisieren (NEU)
        refreshStaffingGrid();

        // 4. Gesamtstunden aktualisieren (falls vom Backend geliefert)
        if (savedData.new_total_hours !== undefined) {
            const oldTotal = currentTotals[userId] || 0;
            const diff = savedData.new_total_hours - oldTotal;
            updateUserTotalHours(userId, diff);
        }

        await loadShiftQueries();
        // buildGridDOM(); // <<< NICHT MEHR AUFRUFEN!
        // buildStaffingTable(); // <<< NICHT MEHR AUFRUFEN (Performance)!

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
        (clickActionModal && clickActionModal.style.display === 'block') ||
        (generatorModal && generatorModal.style.display === 'block') ||
        (genSettingsModal && genSettingsModal.style.display === 'block')) {
        return;
    }

    if (!hoveredCellContext || !hoveredCellContext.userId) return;

    // --- NEU: Leertaste zum Sperren/Entsperren ---
    if (event.code === 'Space') {
        event.preventDefault(); // Verhindert Scrollen
        await toggleShiftLock(hoveredCellContext.userId, hoveredCellContext.dateStr);
        return;
    }
    // --- ENDE NEU ---

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

// --- OPTIMIERTE FUNKTION: requestShift ---
async function requestShift(shiftAbbrev, userId, dateStr) {
    if (isVisitor || (currentPlanStatus && currentPlanStatus.is_locked)) {
        return;
    }

    const cell = findCellByKey(`${userId}-${dateStr}`);
    if(cell) {
        // cell.textContent = '...'; // Visuelles Feedback kurzzeitig deaktivieren um Flackern zu vermeiden
    }

    try {
        const payload = {
            target_user_id: userId,
            shift_date: dateStr,
            message: `Anfrage für: ${shiftAbbrev}`
        };

        await apiFetch('/api/queries', 'POST', payload);

        // 1. Daten aktualisieren
        await loadShiftQueries();

        // 2. Zelle aktualisieren (lokal)
        refreshSingleCell(userId, dateStr);

        // 3. Stunden aktualisieren (lokal)
        const cleanAbbrev = shiftAbbrev.replace('?', '');
        const shiftType = allShiftTypesList.find(st => st.abbreviation === cleanAbbrev);
        if (shiftType) {
            updateUserTotalHours(userId, shiftType.hours);
            // 4. Staffing aktualisieren (lokal)
            updateLocalStaffing(shiftAbbrev, dateStr, 1); // +1 Anfrage
            refreshStaffingGrid();
        }

        triggerNotificationUpdate();

    } catch (e) {
        alert(`Fehler beim Erstellen der Anfrage: ${e.message}`);
        refreshSingleCell(userId, dateStr); // Reset bei Fehler
    }
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
                ${escapeHTML(reply.message)}
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
        const isWunsch = isWunschAnfrage(query);
        if (isPlanschreiber && isWunsch) {
             modalQueryContext.queryId = null;
             queryExistingContainer.style.display = 'none';
             queryAdminActions.style.display = 'none';
             queryNewContainer.style.display = 'block';
             queryReplyForm.style.display = 'none';

             let targetName = "Thema des Tages / Allgemein";
             queryModalInfo.textContent = `Für: ${targetName} am ${dateDisplay}`;

             queryModal.style.display = 'block';
             return;
        }

        queryExistingContainer.style.display = 'block';
        queryNewContainer.style.display = 'none';

        loadQueryConversation(queryId, query);
        if(conversationContainer) conversationContainer.style.display = 'block';
        queryReplyForm.style.display = 'block';

        queryAdminActions.style.display = 'none';

        if (isAdmin) {
            queryAdminActions.style.display = 'flex';
            if (queryResolveBtn) queryResolveBtn.style.display = 'block';
            if (queryDeleteBtn) queryDeleteBtn.textContent = 'Anfrage löschen';
        } else if (isPlanschreiber) {
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
        // Nur neu zeichnen, kein renderGrid
        if(targetUserId) refreshSingleCell(targetUserId, modalQueryContext.dateStr);

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
        // Zelle updaten
        refreshSingleCell(modalQueryContext.userId, modalQueryContext.dateStr);

        triggerNotificationUpdate();

        closeModal(queryModal);

    } catch (e) {
         queryModalStatus.textContent = `Fehler: ${e.message}`;
         queryModalStatus.style.color = '#e74c3c';
    } finally {
        queryResolveBtn.disabled = false;
    }
}

// --- OPTIMIERTE FUNKTION: deleteShiftQueryFromModal ---
async function deleteShiftQueryFromModal(queryId, force = false, context = null) {
    const qId = queryId || modalQueryContext.queryId;
    if (!qId) return;

    // Context ermitteln (entweder direkt übergeben oder aus globalem Modal-Kontext)
    const userId = context ? context.userId : (modalQueryContext ? modalQueryContext.userId : null);
    const dateStr = context ? context.dateStr : (modalQueryContext ? modalQueryContext.dateStr : null);

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

    // Vorab-Daten für Stunden-Korrektur holen (bevor gelöscht wird)
    const queryToDelete = currentShiftQueries.find(q => q.id == qId);
    let deletedShiftAbbrev = null;
    if (queryToDelete && queryToDelete.message.startsWith("Anfrage für:")) {
        deletedShiftAbbrev = queryToDelete.message.substring("Anfrage für:".length).trim().replace('?', '');
    }

    try {
        await apiFetch(`/api/queries/${qId}`, 'DELETE');

        // 1. Daten aktualisieren
        await loadShiftQueries();

        // 2. Zelle aktualisieren (lokal)
        if (userId && dateStr) {
            refreshSingleCell(userId, dateStr);
        } else {
            // Fallback: Nur wenn wir den Context nicht haben (sollte nicht passieren)
            renderGrid();
        }

        // 3. Stunden & Staffing korrigieren (lokal)
        if (deletedShiftAbbrev && userId) {
            const shiftType = allShiftTypesList.find(st => st.abbreviation === deletedShiftAbbrev);
            if (shiftType) {
                // Negative Stunden, da wir eine Anfrage entfernen
                updateUserTotalHours(userId, -shiftType.hours);
                // Staffing reduzieren
                if (dateStr) {
                    updateLocalStaffing(deletedShiftAbbrev, dateStr, -1);
                    refreshStaffingGrid();
                }
            }
        }

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

        // Hier nutzen wir weiter renderGrid, da Genehmigen komplexer ist (Shift setzen + Query status)
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

// --- BULK MODE LOGIK ---

function toggleBulkMode() {
    isBulkMode = !isBulkMode;

    if (isBulkMode) {
        // Aktivieren
        if (planBulkModeBtn) {
            planBulkModeBtn.classList.add('active');
            planBulkModeBtn.textContent = "Modus Beenden";
        }
        document.body.classList.add('bulk-mode-active');
        if(bulkActionBarPlan) bulkActionBarPlan.classList.add('visible');
        selectedQueryIds.clear();
        updateBulkStatus();
    } else {
        // Deaktivieren
        if (planBulkModeBtn) {
            planBulkModeBtn.classList.remove('active');
            planBulkModeBtn.textContent = "✅ Anfragen verwalten";
        }
        document.body.classList.remove('bulk-mode-active');
        if(bulkActionBarPlan) bulkActionBarPlan.classList.remove('visible');

        // Selektionen entfernen
        document.querySelectorAll('.grid-cell.selected').forEach(el => el.classList.remove('selected'));
        selectedQueryIds.clear();
    }
}

function handleBulkCellClick(cell, userId, dateStr) {
    const queryId = cell.dataset.queryId;
    if (!queryId) return; // Nur Zellen mit Anfrage sind klickbar

    const id = parseInt(queryId);
    if (selectedQueryIds.has(id)) {
        selectedQueryIds.delete(id);
        cell.classList.remove('selected');
    } else {
        selectedQueryIds.add(id);
        cell.classList.add('selected');
    }
    updateBulkStatus();
}

function updateBulkStatus() {
    const count = selectedQueryIds.size;
    if(bulkStatusText) bulkStatusText.textContent = `${count} ausgewählt`;

    // Buttons aktivieren/deaktivieren
    if(bulkApproveBtn) bulkApproveBtn.disabled = count === 0;
    if(bulkRejectBtn) bulkRejectBtn.disabled = count === 0;
}

async function performPlanBulkAction(actionType) {
    if (selectedQueryIds.size === 0) return;

    const actionName = actionType === 'approve' ? 'Genehmigen' : 'Ablehnen';
    if (!confirm(`${selectedQueryIds.size} Anfragen ${actionName}?`)) return;

    const endpoint = actionType === 'approve' ? '/api/queries/bulk_approve' : '/api/queries/bulk_delete';

    // UI sperren
    if(bulkApproveBtn) bulkApproveBtn.disabled = true;
    if(bulkRejectBtn) bulkRejectBtn.disabled = true;
    if(bulkStatusText) bulkStatusText.textContent = "Verarbeite...";

    try {
        const response = await apiFetch(endpoint, 'POST', {
            query_ids: Array.from(selectedQueryIds)
        });

        alert(response.message);

        // Bulk Mode beenden und neu laden
        toggleBulkMode();
        await loadShiftQueries(); // Daten neu holen
        await renderGrid();       // Grid komplett neu zeichnen (um Schichten anzuzeigen)
        triggerNotificationUpdate();

    } catch (error) {
        alert("Fehler: " + error.message);
        updateBulkStatus(); // Reset buttons
    }
}

// --- EVENT LISTENER FÜR BULK MODE ---
if (planBulkModeBtn) {
    planBulkModeBtn.onclick = (e) => {
        e.preventDefault();
        toggleBulkMode();
    };
}
if (bulkCancelBtn) bulkCancelBtn.onclick = toggleBulkMode;
if (bulkApproveBtn) bulkApproveBtn.onclick = () => performPlanBulkAction('approve');
if (bulkRejectBtn) bulkRejectBtn.onclick = () => performPlanBulkAction('reject');

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

            const parts = highlightData.date.split('-'); // YYYY-MM-DD
            const year = parseInt(parts[0]);
            const month = parseInt(parts[1]);

            currentYear = year;
            currentMonth = month;
        }
    } catch (e) {
        console.error("Fehler beim Lesen der Highlight-Daten:", e);
        highlightData = null;
    }

    await renderGrid();

    if (highlightData) {
        setTimeout(() => {
            highlightCells(highlightData.date, highlightData.targetUserId);
        }, 300);
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

// Init-Start
initialize();