// --- Globales Setup ---
const API_URL = 'http://46.224.63.203:5000';
const SHORTCUT_STORAGE_KEY = 'dhf_shortcuts';
const COLOR_STORAGE_KEY = 'dhf_color_settings';
let loggedInUser; // <-- ANPASSUNG (Regel 2): Umbenannt von 'user'
let currentDate = new Date();
let currentYear = currentDate.getFullYear();
let currentMonth = currentDate.getMonth() + 1;
let allUsers = [];
let allShiftTypes = {};
let allShiftTypesList = []; // <<< NEU: Speichert die sortierte Liste für die Besetzung
let currentShifts = {};
let currentShiftsLastMonth = {};
let currentTotals = {};
let currentViolations = new Set();
let currentSpecialDates = {};
let colorSettings = {};
let hoveredCellContext = null;

let currentStaffingActual = {};

let shortcutMap = {};
const defaultShortcuts = { 'T.': 't', 'N.': 'n', '6': '6', 'FREI': 'f', 'X': 'x', 'U': 'u' };
let isVisitor = false;
let isAdmin = false;

let staffingSortable = null;

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
const legend = document.getElementById('plan-legende');
const monthLabel = document.getElementById('current-month-label');
const prevMonthBtn = document.getElementById('prev-month-btn');
const nextMonthBtn = document.getElementById('next-month-btn');
const saveStaffingOrderBtn = document.getElementById('save-staffing-order-btn');

const shiftModal = document.getElementById('shift-modal');
const shiftModalTitle = document.getElementById('shift-modal-title');
const shiftModalInfo = document.getElementById('shift-modal-info');
const shiftSelection = document.getElementById('shift-selection');
const closeShiftModalBtn = document.getElementById('close-shift-modal');
let modalContext = { userId: null, dateStr: null };

const COL_WIDTH_NAME = 'minmax(150px, 1.5fr)';
const COL_WIDTH_DETAILS = 'minmax(80px, 1fr)';
const COL_WIDTH_UEBERTRAG = 'minmax(50px, 0.5fr)';
const COL_WIDTH_DAY = 'minmax(45px, 1fr)';
const COL_WIDTH_TOTAL = 'minmax(60px, 0.5fr)';


// --- Basis-Funktionen (Logout, Auth-Check) (ANGEPASST) ---
async function logout() {
    try { await apiFetch('/api/logout', 'POST'); }
    catch (e) { console.error(e); }
    finally {
        localStorage.removeItem('dhf_user');
        window.location.href = 'index.html?logout=true';
    }
}
try {
    // --- ANPASSUNG (Regel 2): 'user' -> 'loggedInUser' ---
    loggedInUser = JSON.parse(localStorage.getItem('dhf_user'));
    if (!loggedInUser || !loggedInUser.vorname || !loggedInUser.role) { throw new Error("Kein User"); }
    document.getElementById('welcome-user').textContent = `Willkommen, ${loggedInUser.vorname}!`;

    isAdmin = loggedInUser.role.name === 'admin';
    isVisitor = loggedInUser.role.name === 'Besucher';
    // --- ENDE ANPASSUNG ---

    const navDashboard = document.getElementById('nav-dashboard');
    const navUsers = document.getElementById('nav-users');
    const settingsDropdown = document.getElementById('settings-dropdown');
    const settingsDropdownContent = document.getElementById('settings-dropdown-content');

    // --- NEU: Feedback-Link ---
    const navFeedback = document.getElementById('nav-feedback');

    // KORRIGIERTE LOGIK: Dashboard ist für alle NICHT-Besucher sichtbar
    if (!isVisitor) {
         navDashboard.style.display = 'block';
    } else {
         // Dies wird später durch die isVisitor-Prüfung überschrieben, aber für Konsistenz hier beibehalten.
         navDashboard.style.display = 'none';
    }

    if (isAdmin) {
        navUsers.style.display = 'block';
        navFeedback.style.display = 'inline-flex'; // (NEU)
    }
    if (isVisitor) {
        isVisitor = true;
        document.body.classList.add('visitor-mode');
        navDashboard.style.display = 'none';
        navUsers.style.display = 'none';
    }
    if (!isAdmin) {
        document.querySelectorAll('#settings-dropdown-content .admin-only').forEach(el => {
            el.style.display = 'none';
        });
        const visibleLinks = settingsDropdownContent.querySelectorAll('a:not([style*="display: none"])');
        if (visibleLinks.length === 0) {
             settingsDropdown.style.display = 'none';
        }
    } else {
         document.body.classList.add('admin-mode');
    }
} catch (e) {
    logout();
}
document.getElementById('logout-btn').onclick = logout;

// --- Globale API-Funktion (unverändert) ---
async function apiFetch(endpoint, method = 'GET', body = null) {
    const options = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include' };
    if (body) { options.body = JSON.stringify(body); }
    const response = await fetch(API_URL + endpoint, options);
    if (response.status === 401 || response.status === 403) { logout(); throw new Error('Sitzung ungültig oder fehlende Rechte.'); }
    const contentType = response.headers.get("content-type");
    let data;
    if (contentType && contentType.indexOf("application/json") !== -1) { data = await response.json(); } else { data = { message: await response.text() }; }
    if (!response.ok) { throw new Error(data.message || 'API-Fehler'); }
    return data;
}

// --- Laden der Farbeinstellungen (unverändert) ---
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

// --- MODAL-LOGIK (unverändert) ---
function closeModal(modalEl) {
    modalEl.style.display = 'none';
}
function openShiftModal(userId, dateStr, userName) {
    if (!isAdmin) { return; }
    const d = new Date(dateStr);
    const dateDisplay = d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' });
    modalContext = { userId, dateStr };
    shiftModalTitle.textContent = "Schicht zuweisen";
    shiftModalInfo.textContent = `Für: ${userName} am ${dateDisplay}`;
    shiftModal.style.display = 'block';
}
closeShiftModalBtn.onclick = () => closeModal(shiftModal);
window.onclick = (event) => {
    if (event.target == shiftModal) closeModal(shiftModal);
}

// --- Laden aller Sondertermine (unverändert) ---
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


// --- HAUPT-RENDER-LOGIK (ANGEPASST) ---
async function renderGrid() {
    monthLabel.textContent = "Lade...";
    grid.innerHTML = '<div style="padding: 20px; text-align: center; color: #333;">Lade Daten...</div>';
    staffingGrid.innerHTML = '';
    try {
        const shiftDataPromise = apiFetch(`/api/shifts?year=${currentYear}&month=${currentMonth}`);
        const userDataPromise = apiFetch('/api/users');
        const specialDatesPromise = loadSpecialDates(currentYear);

        const [shiftPayload, userData, specialDatesResult] = await Promise.all([shiftDataPromise, userDataPromise, specialDatesPromise]);

        allUsers = userData;

        // Schichten DIESES Monats
        currentShifts = {};
        shiftPayload.shifts.forEach(s => {
            const key = `${s.user_id}-${s.date}`;
            const fullShiftType = allShiftTypes[s.shifttype_id];
            currentShifts[key] = {
                ...s,
                shift_type: fullShiftType
            };
        });

        // --- NEU: Schichten VORMONAT (Übertrag) ---
        currentShiftsLastMonth = {};
        if (shiftPayload.shifts_last_month) {
            shiftPayload.shifts_last_month.forEach(s => {
                // Wir brauchen nur eine Schicht pro User (die letzte)
                const fullShiftType = allShiftTypes[s.shifttype_id];
                currentShiftsLastMonth[s.user_id] = {
                    ...s,
                    shift_type: fullShiftType
                };
            });
        }
        // --- ENDE NEU ---

        currentTotals = shiftPayload.totals;

        currentViolations.clear();
        if (shiftPayload.violations) {
            shiftPayload.violations.forEach(v => {
                currentViolations.add(`${v[0]}-${v[1]}`);
            });
        }

        currentStaffingActual = shiftPayload.staffing_actual || {};

        buildGridDOM();
        buildStaffingTable();

        // (Sortierung in dieser Version deaktiviert)
        // initializeSortable();

    } catch (error) {
        grid.innerHTML = `<div style="padding: 20px; text-align: center; color: red;">Fehler beim Laden des Plans: ${error.message}</div>`;
    }
}

// --- buildGridDOM (ANGEPASST) ---
function buildGridDOM() {
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    const monthName = new Date(currentYear, currentMonth - 1, 1).toLocaleString('de-DE', { month: 'long', year: 'numeric' });
    monthLabel.textContent = monthName;

    // --- ANPASSUNG (Regel 2): gridTemplateColumns ---
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

    // --- ANPASSUNG: Header-Zeile 1 (Wochentage) ---
    let nameHeader1 = document.createElement('div');
    nameHeader1.className = 'grid-header';
    grid.appendChild(nameHeader1);
    let dogHeader1 = document.createElement('div');
    dogHeader1.className = 'grid-header';
    grid.appendChild(dogHeader1);

    // NEU: Header 1 für Übertrag
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
        grid.appendChild(headerCell);
    }
    let totalHeader1 = document.createElement('div');
    totalHeader1.className = 'grid-header-total';
    grid.appendChild(totalHeader1);

    // --- ANPASSUNG: Header-Zeile 2 (Tage) ---
    let nameHeader2 = document.createElement('div');
    nameHeader2.className = 'grid-header-dog';
    nameHeader2.textContent = 'Mitarbeiter';
    grid.appendChild(nameHeader2);
    const dogHeader = document.createElement('div');
    dogHeader.className = 'grid-header-dog';
    dogHeader.textContent = 'Diensthund';
    grid.appendChild(dogHeader);

    // NEU: Header 2 für Übertrag
    const uebertragHeader = document.createElement('div');
    uebertragHeader.className = 'grid-header-uebertrag';
    uebertragHeader.textContent = 'Ü';
    uebertragHeader.title = 'Übertrag Vormonat';
    grid.appendChild(uebertragHeader);

    for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(currentYear, currentMonth - 1, day);
        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
        const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const headerCell = renderDayHeader(day, isWeekend, dateStr);
        headerCell.textContent = day;
        grid.appendChild(headerCell);
    }
    const totalHeader = document.createElement('div');
    totalHeader.className = 'grid-header-total';
    totalHeader.textContent = 'Std.';
    grid.appendChild(totalHeader);

    // --- ANPASSUNG: Benutzer-Zellen ---
    const visibleUsers = allUsers.filter(user => user.shift_plan_visible === true);
    visibleUsers.forEach(user => { // 'user' hier ist der gerenderte Benutzer

        // --- NEU (Regel 3): Prüfen, ob dies der eingeloggte Benutzer ist ---
        const isCurrentUser = (loggedInUser && loggedInUser.id === user.id);
        const currentUserClass = isCurrentUser ? ' current-user-row' : '';
        // --- ENDE NEU ---

        const nameCell = document.createElement('div');
        // --- ANPASSUNG ---
        nameCell.className = 'grid-user-name' + currentUserClass;
        nameCell.textContent = `${user.vorname} ${user.name}`;
        grid.appendChild(nameCell);

        const dogCell = document.createElement('div');
        // --- ANPASSUNG ---
        dogCell.className = 'grid-user-dog' + currentUserClass;
        dogCell.textContent = user.diensthund || '---';
        grid.appendChild(dogCell);

        // NEU: Übertrag-Zelle
        const uebertragCell = document.createElement('div');
        // --- ANPASSUNG ---
        uebertragCell.className = 'grid-user-uebertrag' + currentUserClass;
        const lastMonthShift = currentShiftsLastMonth[user.id];
        if (lastMonthShift && lastMonthShift.shift_type) {
            uebertragCell.textContent = lastMonthShift.shift_type.abbreviation;
            uebertragCell.title = `Schicht am Vormonat: ${lastMonthShift.shift_type.name}`;
        } else {
            uebertragCell.textContent = '---';
        }
        grid.appendChild(uebertragCell);
        // --- ENDE NEU ---

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

            // --- ANPASSUNG (Regel 3) ---
            cell.className = cellClasses + currentUserClass;
            // --- ENDE ANPASSUNG ---

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
        // --- ANPASSUNG (Regel 3) ---
        totalCell.className = 'grid-user-total' + currentUserClass;
        // --- ENDE ANPASSUNG ---
        totalCell.id = `total-hours-${user.id}`;
        const userTotalHours = currentTotals[user.id] || 0.0;
        totalCell.textContent = userTotalHours.toFixed(1);
        grid.appendChild(totalCell);
    });
}

// --- buildStaffingTable (ANGEPASST FÜR SORTIERUNG) ---
function buildStaffingTable() {
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();

    // 1. Finde relevante Schichtarten (Verwendet jetzt die VOM API SORTIERTE LISTE)
    // Die Sortierung ist bereits im Backend nach staffing_sort_order erfolgt.
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

    // --- ANPASSUNG (Regel 2): gridTemplateColumns ---
    staffingGrid.style.gridTemplateColumns = `${COL_WIDTH_NAME} ${COL_WIDTH_DETAILS} ${COL_WIDTH_UEBERTRAG} repeat(${daysInMonth}, ${COL_WIDTH_DAY}) ${COL_WIDTH_TOTAL}`;
    staffingGrid.innerHTML = ''; // (Grid leeren, nicht den Body)

    // Map für Wochentage (JS: 0=So, 1=Mo... 6=Sa) zu unseren DB-Feldern
    const dayKeyMap = [
        'min_staff_so', // 0
        'min_staff_mo', // 1
        'min_staff_di', // 2
        'min_staff_mi', // 3
        'min_staff_do', // 4
        'min_staff_fr', // 5
        'min_staff_sa'  // 6
    ];

    // --- Daten-Zeilen (pro Schichtart) ---
    // WICHTIG: Iteriert über die VOM API SORTIERTE Liste
    relevantShiftTypes.forEach(st => {
        const st_id = st.id;

        // 1. Label-Zelle
        let labelCell = document.createElement('div');
        labelCell.className = 'staffing-label';

        // NEU (Feedback 1): Bessere Beschriftung
        labelCell.textContent = `${st.abbreviation} (${st.name})`;
        labelCell.style.fontWeight = '700';
        labelCell.style.color = '#333';
        staffingGrid.appendChild(labelCell);

        // 2. Leere Zelle (für Bündigkeit "Diensthund")
        let emptyCell = document.createElement('div');
        emptyCell.className = 'staffing-cell staffing-untracked';
        staffingGrid.appendChild(emptyCell);

        // --- NEU: Leere Zelle (für Bündigkeit "Ü") ---
        let emptyCellUebertrag = document.createElement('div');
        emptyCellUebertrag.className = 'staffing-cell staffing-untracked';
        emptyCellUebertrag.style.borderRight = '1px solid #ffcc99'; // (Passt zur orangen Spalte)
        staffingGrid.appendChild(emptyCellUebertrag);
        // --- ENDE NEU ---

        let totalIst = 0;
        let totalSoll = 0;

        // 3. Tages-Zellen
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

            // --- ANPASSUNG (Regel 4) ---
            const eventType = currentSpecialDates[dateStr];
            if (dayOfWeek === 0 || dayOfWeek === 6) {
                cellClasses += ' weekend';
            }
            // --- ENDE ANPASSUNG ---


            // --- NEUE AMPEL-LOGIK + AUSBLENDEN (Feedback 1 & 4) ---
            if (sollValue === 0) {
                istCell.textContent = '';
                cellClasses += ' staffing-untracked'; // Grau
            } else {
                istCell.textContent = istValue;
                if (istValue === sollValue) {
                    cellClasses += ' staffing-ok'; // Grün
                } else if (istValue > sollValue) {
                     cellClasses += ' staffing-warning'; // Gelb (Überbesetzt)
                } else if (istValue > 0) {
                    cellClasses += ' staffing-warning'; // Gelb (Unterbesetzt)
                } else {
                    cellClasses += ' staffing-violation'; // Rot
                }
            }
            // --- ENDE NEUE AMPEL-LOGIK ---

            istCell.className = cellClasses;
            staffingGrid.appendChild(istCell);
        }

        // 4. Total-Zelle
        let totalIstCell = document.createElement('div');
        totalIstCell.className = 'staffing-total-header';
        totalIstCell.textContent = totalIst;
        if (totalIst < totalSoll) {
            totalIstCell.style.color = '#c00000';
        } else if (totalIst > totalSoll && totalSoll > 0) {
             totalIstCell.style.color = '#856404';
        }
        staffingGrid.appendChild(totalIstCell);
    });
}
// --- ENDE KORREKTUR ---

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

// --- populateStaticElements (ANGEPASST FÜR SORTIERUNG) ---
async function populateStaticElements(forceReload = false) {
    if (Object.keys(allShiftTypes).length === 0 || forceReload) {
        const typeData = await apiFetch('/api/shifttypes'); // <-- Liefert sortiert

        // 1. Sortierte Liste speichern
        allShiftTypesList = typeData;

        // 2. Map erstellen (nötig für schnellen Lookup nach ID)
        allShiftTypes = {};
        typeData.forEach(st => allShiftTypes[st.id] = st);
    }

    legend.innerHTML = '<b>Legende:</b>';
    shiftSelection.innerHTML = '';

    // (Verwendet jetzt die sortierte Liste für die Legende und die Modalauswahl)
    const sortedTypes = allShiftTypesList; // <<< WICHTIG: Nutzt die sortierte Liste

    sortedTypes.forEach(st => {
        const item = document.createElement('div');
        item.className = 'legende-item';
        const priorityIndicator = st.prioritize_background ? ' (Hintergrund prior.)' : '';
        item.innerHTML = `<div class="legende-color" style="background-color: ${st.color};"></div> ${st.abbreviation} (${st.name}${priorityIndicator})`;
        legend.appendChild(item);
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

// --- DATEN SPEICHERN (unverändert) ---
async function saveShift(shifttypeId, userId, dateStr) {
// ... (Funktion bleibt unverändert) ...
    if (!isAdmin) {
        console.error("Nicht-Admins dürfen keine Schichten speichern.");
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

        buildGridDOM();
        buildStaffingTable();

        const totalCell = document.getElementById(`total-hours-${userId}`);
        if (totalCell) {
            totalCell.textContent = (savedData.new_total_hours || 0.0).toFixed(1);
        }

    } catch (error) {
        if (cell) cell.textContent = 'Fehler!';
        alert(`Fehler beim Speichern: ${error.message}`);
        if (shiftModal.style.display === 'block') {
            shiftModalInfo.textContent = `Fehler: ${error.message}`;
        }
    }
}

// (findCellByKey - unverändert)
function findCellByKey(key) {
    return grid.querySelector(`[data-key="${key}"]`);
}

// --- NAVIGATIONS-EVENTS (unverändert) ---
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

// --- Shortcut Ladefunktion (unverändert) ---
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

// --- KEYBOARD SHORTCUT LISTENER (unverändert) ---
window.addEventListener('keydown', async (event) => {
    if (!isAdmin) return;
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

// --- Initialisierung (unverändert) ---
async function initialize() {
    await loadColorSettings();
    await populateStaticElements();
    loadShortcuts();
    await renderGrid();
}

initialize();