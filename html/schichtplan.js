// --- Globales Setup ---
const API_URL = 'http://46.224.63.203:5000';
const SHORTCUT_STORAGE_KEY = 'dhf_shortcuts';
const COLOR_STORAGE_KEY = 'dhf_color_settings';
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
let currentPlanStatus = {}; // <-- NEU: Speichert den Status des Plans

let shortcutMap = {};
const defaultShortcuts = { 'T.': 't', 'N.': 'n', '6': '6', 'FREI': 'f', 'X': 'x', 'U': 'u' };
let isVisitor = false;
let isAdmin = false;

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
// const legend = document.getElementById('plan-legende'); // <-- VERALTET / ENTFERNT
const monthLabel = document.getElementById('current-month-label');
const prevMonthBtn = document.getElementById('prev-month-btn');
const nextMonthBtn = document.getElementById('next-month-btn');
const staffingSortToggleBtn = document.getElementById('staffing-sort-toggle');

// --- NEUE DOM Elemente für Plan Status ---
const planStatusContainer = document.getElementById('plan-status-container');
const planStatusBadge = document.getElementById('plan-status-badge');
const planLockBtn = document.getElementById('plan-lock-btn');
const planStatusToggleBtn = document.getElementById('plan-status-toggle-btn');
// --- ENDE NEU ---

const shiftModal = document.getElementById('shift-modal');
const shiftModalTitle = document.getElementById('shift-modal-title');
const shiftModalInfo = document.getElementById('shift-modal-info');
const shiftSelection = document.getElementById('shift-selection');
const closeShiftModalBtn = document.getElementById('close-shift-modal');
let modalContext = { userId: null, dateStr: null };

// --- KORREKTUR: Spaltenbreiten auf "Inhalt entscheidet" (max-content) gesetzt ---
const COL_WIDTH_NAME = 'minmax(160px, max-content)';
const COL_WIDTH_DETAILS = 'minmax(110px, max-content)';
// --- ENDE KORREKTUR ---

// --- NEU: Globale Variablen für berechnete Spaltenbreiten (für Bündigkeit) ---
let computedColWidthName = COL_WIDTH_NAME;
let computedColWidthDetails = COL_WIDTH_DETAILS;
// --- ENDE NEU ---

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

    // --- NEU: Admin-Klasse zum Body hinzufügen ---
    if (isAdmin) {
        document.body.classList.add('admin-mode');
    }
    // --- ENDE NEU ---

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
    } else {
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

    // --- NEU: Angepasste Fehlerbehandlung für 401/403 ---
    if (response.status === 401 || response.status === 403) {
        if (response.status === 401) {
            logout(); // Nur bei 401 (Unauthorized) ausloggen
        }
        // Versuche, die JSON-Fehlermeldung zu lesen (z.B. "Aktion blockiert")
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Sitzung ungültig oder fehlende Rechte.');
        }
        throw new Error('Sitzung ungültig oder fehlende Rechte.');
    }
    // --- ENDE NEU ---

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
function openShiftModal(userId, dateStr, userName) {
    // --- NEU: Prüfen, ob Admin UND ob Plan gesperrt ist ---
    if (!isAdmin) { return; }
    if (currentPlanStatus && currentPlanStatus.is_locked) {
        // console.warn("Plan ist gesperrt. Bearbeitung nicht möglich.");
        return;
    }
    // --- ENDE NEU ---

    const d = new Date(dateStr);
    const dateDisplay = d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' });
    modalContext = { userId, dateStr };
    shiftModalTitle.textContent = "Schicht zuweisen";
    shiftModalInfo.textContent = `Für: ${userName} am ${dateDisplay}`;
    shiftModal.style.display = 'block';
}
closeShiftModalBtn.onclick = () => closeModal(shiftModal);
window.onclick = (event) => { if (event.target == shiftModal) closeModal(shiftModal); }

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


async function renderGrid() {
    monthLabel.textContent = "Lade...";
    grid.innerHTML = '<div style="padding: 20px; text-align: center; color: #333;">Lade Daten...</div>';
    staffingGrid.innerHTML = '';

    // --- NEU: Status-Container beim Neuladen verstecken ---
    if (planStatusContainer) {
        planStatusContainer.style.display = 'none';
    }
    document.body.classList.remove('plan-locked'); // Sperre standardmäßig aufheben
    // --- ENDE NEU ---

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

        const [shiftPayload, userData, specialDatesResult] = await Promise.all([shiftDataPromise, userDataPromise, specialDatesPromise]);

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

        // --- NEU: Plan-Status speichern und UI aktualisieren ---
        currentPlanStatus = shiftPayload.plan_status || {
            year: currentYear,
            month: currentMonth,
            status: "In Bearbeitung",
            is_locked: false
        };
        updatePlanStatusUI(currentPlanStatus);
        // --- ENDE NEU ---

        buildGridDOM();
        buildStaffingTable();

    } catch (error) {
        grid.innerHTML = `<div style="padding: 20px; text-align: center; color: red;">Fehler beim Laden des Plans: ${error.message}</div>`;
        // --- NEU: Bei Fehler Status-UI trotzdem anzeigen (mit Fehler) ---
        updatePlanStatusUI({
            status: "Fehler",
            is_locked: true // Bei Fehler sicherheitshalber sperren
        });
        // --- ENDE NEU ---
    }
}

// --- NEUE FUNKTION: Aktualisiert die Status-Anzeige im Header ---
function updatePlanStatusUI(statusData) {
    if (!planStatusContainer) return;

    planStatusContainer.style.display = 'flex';

    // 1. Status-Badge (für alle sichtbar)
    if (statusData.status === "Fertiggestellt") {
        planStatusBadge.textContent = "Fertiggestellt";
        planStatusBadge.className = 'status-fertiggestellt';
    } else {
        // Standard ist "In Bearbeitung" oder "Fehler"
        planStatusBadge.textContent = statusData.status || "In Bearbeitung";
        planStatusBadge.className = 'status-in-bearbeitung';
    }

    // 2. Lock-Button (nur für Admins)
    if (statusData.is_locked) {
        planLockBtn.textContent = "Gesperrt";
        planLockBtn.title = "Plan entsperren, um Bearbeitung zu erlauben";
        planLockBtn.classList.add('locked');
        document.body.classList.add('plan-locked'); // CSS-Klasse für UI-Sperre
    } else {
        planLockBtn.textContent = "Offen";
        planLockBtn.title = "Plan sperren, um Bearbeitung zu verhindern";
        planLockBtn.classList.remove('locked');
        document.body.classList.remove('plan-locked'); // CSS-Klasse entfernen
    }

    // 3. Status-Toggle-Button (nur für Admins)
    if (statusData.status === "Fertiggestellt") {
        planStatusToggleBtn.textContent = "Als 'In Bearbeitung' markieren";
        planStatusToggleBtn.title = "Status auf 'In Bearbeitung' zurücksetzen";
    } else {
        planStatusToggleBtn.textContent = "Als 'Fertiggestellt' markieren";
        planStatusToggleBtn.title = "Plan als 'Fertiggestellt' markieren";
    }
}
// --- ENDE NEUE FUNKTION ---

// --- NEUE FUNKTION: Sendet Status-Änderungen an die API ---
async function handleUpdatePlanStatus(newStatus, newLockState) {
    if (!isAdmin) return;

    const payload = {
        year: currentYear,
        month: currentMonth,
        status: newStatus,
        is_locked: newLockState
    };

    // UI sofort deaktivieren
    planLockBtn.disabled = true;
    planStatusToggleBtn.disabled = true;

    try {
        const updatedStatus = await apiFetch('/api/shifts/status', 'PUT', payload);

        // API-Antwort in globalem Status speichern
        currentPlanStatus = updatedStatus;
        // UI mit den neuen Daten aktualisieren
        updatePlanStatusUI(currentPlanStatus);

    } catch (error) {
        alert(`Fehler beim Aktualisieren des Status: ${error.message}`);
        // Bei Fehler: UI mit dem *alten* Status wiederherstellen
        updatePlanStatusUI(currentPlanStatus);
    } finally {
        // Buttons wieder aktivieren
        planLockBtn.disabled = false;
        planStatusToggleBtn.disabled = false;
    }
}
// --- ENDE NEUE FUNKTION ---


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

    // --- ZEILE 1: Wochentage ---
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

    // --- ZEILE 2: Mitarbeiter/Nummern/Std (HIER kommt der Strich) ---
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

            if (shiftType) {
                cell.textContent = shiftType.abbreviation;
                if (shiftType.prioritize_background && dayHasSpecialBg) {

                    if (eventType === 'holiday') {
                        cellClasses += ` day-color-${eventType}`;
                    } else if (isWeekend) {
                        cellClasses += ' weekend';
                    }
                } else {
                    cellColor = shiftType.color;
                    textColor = isColorDark(shiftType.color) ? 'white' : 'black';
                }
            } else {
                cell.textContent = '';
                if (eventType === 'holiday') {
                     cellClasses += ` day-color-${eventType}`;
                } else if (isWeekend) {
                    cellClasses += ' weekend';
                }
            }

            cell.className = cellClasses + currentUserClass;

            if (currentYear === today.getFullYear() && (currentMonth - 1) === today.getMonth() && day === today.getDate()) {
                cell.classList.add('current-day-highlight');
            }

            if (cellColor) { cell.style.backgroundColor = cellColor; }
            if (textColor) { cell.style.color = textColor; }
            cell.dataset.key = key;

            if (isAdmin) {
                cell.onclick = () => {
                    openShiftModal(user.id, dateStr, `${user.vorname} ${user.name}`);
                };
                cell.onmouseenter = () => {
                    cell.classList.add('hovered');
                    hoveredCellContext = {
                        userId: user.id, dateStr: dateStr,
                        userName: `${user.vorname} ${user.name}`,
                        cellElement: cell
                    };
                };
                cell.onmouseleave = () => {
                    cell.classList.remove('hovered');
                    hoveredCellContext = null;
                };
            } else {
                cell.style.cursor = 'default';
            }
            grid.appendChild(cell);
        }
        const totalCell = document.createElement('div');
        totalCell.className = 'grid-user-total' + currentUserClass;
        totalCell.id = `total-hours-${user.id}`;
        const userTotalHours = currentTotals[user.id] || 0.0;
        totalCell.textContent = userTotalHours.toFixed(1);
        grid.appendChild(totalCell);
    });

    // --- NEU: Spaltenbreiten messen für das Besetzungs-Grid (Regel 2) ---
    // Wir messen die *tatsächliche* Breite der 'max-content'-Spalten,
    // damit das untere Grid (Besetzung) exakt bündig ist.
    try {
        // nameHeader2 und dogHeader sind die <div> Elemente aus Zeile 2 (definiert um Zeile 320)
        if (nameHeader2 && dogHeader) {
            // offsetWidth ist die zuverlässigste Messung (inkl. padding/border)
            computedColWidthName = `${nameHeader2.offsetWidth}px`;
            computedColWidthDetails = `${dogHeader.offsetWidth}px`;
        } else {
            // Fallback, falls die Header nicht gefunden wurden
            computedColWidthName = COL_WIDTH_NAME;
            computedColWidthDetails = COL_WIDTH_DETAILS;
        }
    } catch (e) {
        console.error("Fehler beim Messen der Spaltenbreiten:", e);
        // Fallback auf die String-Konstanten
        computedColWidthName = COL_WIDTH_NAME;
        computedColWidthDetails = COL_WIDTH_DETAILS;
    }
    // --- ENDE NEU ---
}

// --- buildStaffingTable (FIXED: Jede Zeile ist ein eigenes Grid) ---
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

    // Wir definieren das Template, das jede Zeile (als eigenes Grid) nutzen wird
    // --- KORREKTUR: Verwende die berechneten Pixel-Breiten ---
    const gridTemplateColumns = `${computedColWidthName} ${computedColWidthDetails} ${COL_WIDTH_UEBERTRAG} repeat(${daysInMonth}, ${COL_WIDTH_DAY}) ${COL_WIDTH_TOTAL}`;
    // --- ENDE KORREKTUR ---

    const dayKeyMap = [
        'min_staff_so', // 0
        'min_staff_mo', // 1
        'min_staff_di', // 2
        'min_staff_mi', // 3
        'min_staff_do', // 4
        'min_staff_fr', // 5
        'min_staff_sa'  // 6
    ];

    relevantShiftTypes.forEach(st => {
        const st_id = st.id;

        // Jede Zeile ist jetzt ein DIV mit display:grid (durch CSS .staffing-row)
        const row = document.createElement('div');
        row.className = 'staffing-row';
        row.dataset.id = st_id;
        // Das Inline-Style überschreibt das CSS, falls nötig, und sorgt für korrekte Spalten
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
        // <<< KORREKTUR: forceFallback: true + CSS-Grid im Fallback >>>
        forceFallback: true,
        fallbackClass: 'sortable-fallback',
        fallbackOnBody: true,
        swapThreshold: 0.65,
        invertSwap: true, // Wichtig für Hoch/Runter Tausch
        direction: 'vertical',

        // Events für das CSS 'dragging' auf dem Body
        onStart: function (evt) {
            document.body.classList.add('dragging');
            // Wir müssen sicherstellen, dass der "Ghost" (die Kopie) auch das Grid-Layout behält
            // Da die Kopie in den Body appended wird, kopieren wir die Spalten-Definition
            const originalRow = evt.item;
            const ghostRow = document.querySelector('.sortable-fallback');
            if (ghostRow) {
                ghostRow.style.gridTemplateColumns = originalRow.style.gridTemplateColumns;
                ghostRow.style.width = originalRow.offsetWidth + 'px'; // Breite fixieren
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

            // Klasse entfernen (zur Sicherheit)
            document.querySelectorAll('.staffing-row').forEach(r => r.classList.remove('sort-mode-active'));
        }

    } else {
        isStaffingSortingMode = true;

        staffingSortToggleBtn.textContent = 'Reihenfolge speichern';
        staffingSortToggleBtn.classList.remove('btn-primary');
        staffingSortToggleBtn.classList.add('btn-secondary');

        document.querySelectorAll('.staffing-drag-handle').forEach(h => h.style.display = 'inline-block');

        // Klasse für CSS (user-select: none) hinzufügen
        document.querySelectorAll('.staffing-row').forEach(r => r.classList.add('sort-mode-active'));

        if (staffingGrid) {
            initializeSortableStaffing(staffingGrid);
        }
    }
}

async function saveStaffingOrder() {
    // Selektor auf die neuen Klassen angepasst
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


// --- Helligkeitsprüfung (unverändert) ---
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

// --- START: ÜBERARBEITETE populateStaticElements ---
async function populateStaticElements(forceReload = false) {
    if (Object.keys(allShiftTypes).length === 0 || forceReload) {
        const typeData = await apiFetch('/api/shifttypes');
        allShiftTypesList = typeData;
        allShiftTypes = {};
        typeData.forEach(st => allShiftTypes[st.id] = st);
    }

    // Hole die neuen Container
    const legendeArbeit = document.getElementById('legende-arbeit');
    const legendeAbwesenheit = document.getElementById('legende-abwesenheit');
    const legendeSonstiges = document.getElementById('legende-sonstiges');

    // Leere die Container
    if (legendeArbeit) legendeArbeit.innerHTML = '';
    if (legendeAbwesenheit) legendeAbwesenheit.innerHTML = '';
    if (legendeSonstiges) legendeSonstiges.innerHTML = '';
    shiftSelection.innerHTML = ''; // Modal bleibt gleich

    const sortedTypes = allShiftTypesList;

    // Harte Definition der Sonderdienste (basierend auf Screenshot)
    const specialAbbreviations = ['QA', 'S', 'DPG'];

    sortedTypes.forEach(st => {
        const item = document.createElement('div');
        item.className = 'legende-item';

        // (Hintergrund prior.) entfernt
        item.innerHTML = `
            <div class="legende-color" style="background-color: ${st.color};"></div>
            <span class="legende-name"><strong>${st.abbreviation}</strong> (${st.name})</span>
        `;

        // Sortiere in Gruppen (Regel 4)
        if (specialAbbreviations.includes(st.abbreviation)) {
            if (legendeSonstiges) legendeSonstiges.appendChild(item);
        } else if (st.is_work_shift) {
            if (legendeArbeit) legendeArbeit.appendChild(item);
        } else {
            if (legendeAbwesenheit) legendeAbwesenheit.appendChild(item);
        }

        // Modal-Button-Logik (unverändert)
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
// --- ENDE: ÜBERARBEITETE populateStaticElements ---


// --- DATEN SPEICHERN ---
async function saveShift(shifttypeId, userId, dateStr) {
    if (!isAdmin) {
        console.error("Nicht-Admins dürfen keine Schichten speichern.");
        return;
    }
    // --- NEU: Sperr-Check (redundant zur API, aber gut für UX) ---
    if (currentPlanStatus && currentPlanStatus.is_locked) {
        console.warn("Plan ist gesperrt. Speichern blockiert.");
        return;
    }
    // --- ENDE NEU ---

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

        // --- START KORREKTUR (Regel 1 & 2) ---
        // Aktualisiere den Frontend-State (currentTotals)
        // BEVOR das Grid neu gezeichnet wird.
        if (savedData.new_total_hours !== undefined) {
            currentTotals[userId] = savedData.new_total_hours;
        }
        if (savedData.new_total_hours_next_month !== undefined) {
            // (Wir müssen den Benutzer des nächsten Monats hier nicht aktualisieren,
            // da die Neuberechnung des Folgemonats nur bei Monatsletzten
            // relevant ist und ein Neuladen im nächsten Monat die Daten korrigiert.)
        }
        // --- ENDE KORREKTUR ---

        buildGridDOM(); // <-- Zeichnet jetzt das Grid mit dem frischen Total für userId
        buildStaffingTable();

        // --- KORREKTUR (Regel 1) ---
        // Die manuelle Aktualisierung HIER ist nicht mehr nötig (und fehlerhaft),
        // da buildGridDOM() dies bereits korrekt aus currentTotals getan hat.
        /*
        const totalCell = document.getElementById(`total-hours-${userId}`);
        if (totalCell) {
            totalCell.textContent = (savedData.new_total_hours || 0.0).toFixed(1);
        }
        */

    } catch (error) {
        if (cell) cell.textContent = 'Fehler!';
        // --- NEU: Sperr-Fehlermeldung anzeigen ---
        let errorMsg = `Fehler beim Speichern: ${error.message}`;
        if (error.message.includes("Aktion blockiert")) {
            errorMsg = error.message;
            // UI-Status aktualisieren, falls der Server 'gesperrt' sagt, die UI aber noch 'offen' war
            currentPlanStatus.is_locked = true;
            updatePlanStatusUI(currentPlanStatus);
        }
        // --- ENDE NEU ---

        alert(errorMsg); // Zeigt die Sperr-Meldung an
        if (shiftModal.style.display === 'block') {
            shiftModalInfo.textContent = `Fehler: ${error.message}`;
        }
    }
}

function findCellByKey(key) {
    return grid.querySelector(`[data-key="${key}"]`);
}

// --- NAVIGATIONS-EVENTS ---
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

// --- NEUE EVENT HANDLER FÜR PLAN STATUS BUTTONS ---
if (planLockBtn) {
    planLockBtn.onclick = () => {
        if (!isAdmin) return;

        const newLockState = !currentPlanStatus.is_locked;
        // Beim Sperren/Entsperren bleibt der Text-Status (Fertig/In Bearbeitung) gleich
        handleUpdatePlanStatus(currentPlanStatus.status, newLockState);
    };
}

if (planStatusToggleBtn) {
    planStatusToggleBtn.onclick = () => {
        if (!isAdmin) return;

        const newStatus = (currentPlanStatus.status === "Fertiggestellt") ? "In Bearbeitung" : "Fertiggestellt";
        // Beim Ändern des Status bleibt der Lock-Status gleich
        handleUpdatePlanStatus(newStatus, currentPlanStatus.is_locked);
    };
}
// --- ENDE NEUE EVENT HANDLER ---


// --- Shortcut Ladefunktion ---
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

// --- KEYBOARD SHORTCUT LISTENER ---
window.addEventListener('keydown', async (event) => {
    if (!isAdmin) return;
    // --- NEU: Sperr-Check ---
    if (currentPlanStatus && currentPlanStatus.is_locked) return;
    // --- ENDE NEU ---

    if (shiftModal.style.display === 'block') return;
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

// --- Initialisierung ---
async function initialize() {
    await loadColorSettings();
    await populateStaticElements();
    loadShortcuts();
    await renderGrid();
}

initialize();