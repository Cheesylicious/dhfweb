// --- Globales Setup ---
const API_URL = 'http://46.224.63.203:5000';
const SHORTCUT_STORAGE_KEY = 'dhf_shortcuts';
const COLOR_STORAGE_KEY = 'dhf_color_settings';
// --- NEU: Key für localStorage (Regel 4) ---
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
let currentPlanStatus = {}; // <-- NEU: Speichert den Status des Plans
let currentShiftQueries = []; // <<< NEU: Speichert offene Schicht-Anfragen

let shortcutMap = {};
const defaultShortcuts = { 'T.': 't', 'N.': 'n', '6': '6', 'FREI': 'f', 'X': 'x', 'U': 'u' };
let isVisitor = false;
let isAdmin = false;
let isPlanschreiber = false; // <<< NEU: Für die neue Rolle
let isHundefuehrer = false; // <<< NEU: Für die Hundeführer-Rolle

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

// --- NEUE DOM Elemente für Schicht-Anfragen (Query Modal) ---
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
const queryTargetSelection = document.getElementById('query-target-selection'); // NEU
const targetTypeUser = document.getElementById('target-type-user'); // NEU
const targetTypeDay = document.getElementById('target-type-day'); // NEU

// NEU: Elemente für Antworten
const queryReplyForm = document.getElementById('query-reply-form');
const replyMessageInput = document.getElementById('reply-message-input');
const replySubmitBtn = document.getElementById('reply-submit-btn');
const queryRepliesList = document.getElementById('query-replies-list');

// --- START: NEUES KONTEXTMENÜ ---
const contextMenu = document.getElementById('shift-context-menu');
// --- ENDE: NEUES KONTEXTMENÜ ---

let modalQueryContext = { userId: null, dateStr: null, userName: null, queryId: null };
// --- ENDE NEU ---


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
    isPlanschreiber = loggedInUser.role.name === 'Planschreiber'; // <<< NEU
    isHundefuehrer = loggedInUser.role.name === 'Hundeführer'; // <<< NEU

    // --- NEU: Admin-Klasse zum Body hinzufügen ---
    if (isAdmin) {
        document.body.classList.add('admin-mode');
    }
    // --- NEU: Planschreiber-Klasse hinzufügen ---
    if (isPlanschreiber) {
        document.body.classList.add('planschreiber-mode');
    }
    // --- START: NEU: Hundeführer-Klasse hinzufügen ---
    if (isHundefuehrer) {
        document.body.classList.add('hundefuehrer-mode');
    }
    // --- ENDE: NEU ---


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
        navFeedback.style.display = 'inline-flex'; // Planschreiber darf Meldungen sehen
        if (staffingSortToggleBtn) staffingSortToggleBtn.style.display = 'none';
    } else {
        navUsers.style.display = 'none';
        // --- START: NEU: Hundeführer/Standard-User ---
        navFeedback.style.display = 'none'; // Nur Admins/Planschreiber sehen den Hauptlink
        // --- ENDE: NEU ---
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

// --- START: KONTEXTMENÜ-FUNKTIONEN ---
/**
 * Versteckt das benutzerdefinierte Kontextmenü
 */
function hideContextMenu() {
    if (contextMenu) {
        contextMenu.style.display = 'none';
    }
}

/**
 * Zeigt das benutzerdefinierte Kontextmenü für eine Zelle an
 * NEU: Parameter 'isCellOnOwnRow' hinzugefügt
 */
function showContextMenu(event, user, dateStr, cell, isCellOnOwnRow) {
    event.preventDefault();
    hideContextMenu(); // Schließe alle vorherigen

    // Kontext für Klick-Aktionen speichern
    const userName = `${user.vorname} ${user.name}`;
    const queryId = cell.dataset.queryId;
    const query = queryId ? currentShiftQueries.find(q => q.id == queryId) : null;

    // Menü leeren
    contextMenu.innerHTML = '';
    let hasContent = false;

    // 1. Admin-Aktionen (Schichtzuweisung)
    if (isAdmin && !(currentPlanStatus && currentPlanStatus.is_locked)) {
        hasContent = true;
        // Finde die Top 6 Schichten (basierend auf der Shortcut-Map)
        const topAbbrevs = ['T.', 'N.', '6', 'FREI', 'U', 'X'];

        topAbbrevs.forEach(abbrev => {
            const shiftType = allShiftTypesList.find(st => st.abbreviation === abbrev);
            if (shiftType) {
                const item = document.createElement('div');
                item.className = 'context-menu-item';
                // Finde Shortcut-Taste (z.B. 't') über Abkürzung (z.B. 'T.')
                const shortcutKey = Object.keys(shortcutMap).find(key => shortcutMap[key] === abbrev) || '';

                item.innerHTML = `
                    <span><strong>${shiftType.abbreviation}</strong> (${shiftType.name})</span>
                    ${shortcutKey ? `<span class="shortcut-hint">${shortcutKey}</span>` : ''}
                `;
                item.onclick = () => {
                    saveShift(shiftType.id, user.id, dateStr);
                    // hideContextMenu(); // Wird von saveShift() erledigt
                };
                contextMenu.appendChild(item);
            }
        });

        // Trennlinie
        contextMenu.appendChild(document.createElement('div')).className = 'context-menu-divider';

        // "Alle Schichten..." (öffnet das alte Modal)
        const allItem = document.createElement('div');
        allItem.className = 'context-menu-item';
        allItem.textContent = 'Alle Schichten...';
        allItem.onclick = () => {
            openShiftModal(user.id, dateStr, userName); // Ruft das alte Modal auf
            hideContextMenu();
        };
        contextMenu.appendChild(allItem);
    }
    // --- START: ANGEPASSTER BLOCK FÜR HUNDEFÜHRER ---
    // Zeige dieses Menü, wenn der Benutzer ein Hundeführer ist,
    // es seine eigene Zeile ist UND der Plan offen ist.
    else if (isHundefuehrer && isCellOnOwnRow && !(currentPlanStatus && currentPlanStatus.is_locked)) {
        hasContent = true;

        if (query && query.sender_user_id === loggedInUser.id) {
            // FALL 1: Es GIBT eine EIGENE Anfrage auf dieser Zelle
            const deleteItem = document.createElement('div');
            deleteItem.className = 'context-menu-item';

            // Text anpassen: Wenn es eine Schicht-Anfrage war (z.B. "T.?"), zeige "Zurückziehen"
            // Wenn es eine Text-Notiz war, zeige "Notiz löschen"
            const isShiftRequest = query.message.startsWith("Anfrage für:");
            const deleteText = isShiftRequest ? "Anfrage zurückziehen" : "Notiz löschen";

            deleteItem.innerHTML = `<span><strong style="color: #e74c3c;">${deleteText}</strong></span>`;
            deleteItem.onclick = () => {
                // Ruft die bestehende Löschfunktion auf (OHNE POPUP)
                deleteShiftQueryFromModal(queryId, true); // true = force delete
                hideContextMenu();
            };
            contextMenu.appendChild(deleteItem);

        } else if (!query) {
            // FALL 2: Es gibt KEINE Anfrage (leere Zelle oder Admin-Schicht)
            // Zeige die Standard-Wunschliste
            const requestAbbrevs = ['T.?', 'N.?', '6?', 'X?', '24?'];

            requestAbbrevs.forEach(abbrev => {
                const item = document.createElement('div');
                item.className = 'context-menu-item';
                item.innerHTML = `<span>Anfrage: <strong>${abbrev}</strong></span>`;
                item.onclick = () => {
                    requestShift(abbrev, user.id, dateStr);
                    hideContextMenu();
                };
                contextMenu.appendChild(item);
            });
        }
        // (Wenn eine Anfrage existiert, die NICHT vom Hundeführer ist (z.B. Admin-Notiz),
        // wird hier nichts angezeigt, was korrekt ist.)
    }
    // --- ENDE: ANGEPASSTER BLOCK FÜR HUNDEFÜHRER ---


    // 2. Admin ODER Planschreiber Aktionen (Anfrage/Notiz)
    // --- START: ANPASSUNG (Hundeführer sieht das nicht mehr) ---
    if (isAdmin || isPlanschreiber) {
    // --- ENDE: ANPASSUNG ---
        if (hasContent) {
            // Trennlinie, wenn schon Aktionen da sind
            contextMenu.appendChild(document.createElement('div')).className = 'context-menu-divider';
        }
        hasContent = true;

        const queryItem = document.createElement('div');
        queryItem.className = 'context-menu-item query-item'; // Spezielle Klasse für Anfragen
        queryItem.textContent = queryId ? '❓ Anfrage/Notiz ansehen...' : '❓ Text-Notiz erstellen...';
        queryItem.onclick = () => {
            openQueryModal(user.id, dateStr, userName, queryId);
            hideContextMenu();
        };
        contextMenu.appendChild(queryItem);
    }

    // 3. Positionieren und anzeigen (nur wenn Inhalt vorhanden)
    if (!hasContent) {
        hideContextMenu(); // Nichts zu zeigen
        return;
    }

    // Verhindern, dass das Menü außerhalb des Bildschirms gerendert wird
    const menuWidth = contextMenu.offsetWidth || 200;
    const menuHeight = contextMenu.offsetHeight || 150;
    const docWidth = document.documentElement.clientWidth;
    const docHeight = document.documentElement.clientHeight;

    let left = event.pageX;
    let top = event.pageY;

    if (event.pageX + menuWidth > docWidth) {
        left = docWidth - menuWidth - 5; // 5px Puffer
    }
    if (event.pageY + menuHeight > docHeight) {
        top = docHeight - menuHeight - 5; // 5px Puffer
    }

    contextMenu.style.left = `${left}px`;
    contextMenu.style.top = `${top}px`;
    contextMenu.style.display = 'block';
}

// Globaler Klick-Listener, um das Kontextmenü zu schließen
window.addEventListener('click', (e) => {
    // Schließe das Kontextmenü, wenn der Klick NICHT auf einem Menü-Item war
    if (e.target.closest('#shift-context-menu') === null) {
        hideContextMenu();
    }
}, true); // Use capture phase

// --- ENDE: KONTEXTMENÜ-FUNKTIONEN ---


/**
 * Öffnet das (alte) Modal für "Alle Schichten..."
 */
function openShiftModal(userId, dateStr, userName) {
    // Diese Funktion wird jetzt nur noch als Fallback vom Kontextmenü aufgerufen
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
// --- NEU: Query-Modal Listener ---
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
// NEU: Listener für Antworten
if (replySubmitBtn) {
    replySubmitBtn.onclick = () => sendReply();
}
// --- ENDE NEU ---

window.onclick = (event) => {
    if (event.target == shiftModal) closeModal(shiftModal);
    if (event.target == queryModal) closeModal(queryModal); // <<< NEU

    // --- NEU: Kontextmenü schließen ---
    if (event.target.closest('#shift-context-menu') === null) {
        hideContextMenu();
    }
    // --- ENDE NEU ---

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

// --- NEUE FUNKTION: Lädt offene Schicht-Anfragen ---
async function loadShiftQueries() {
    // --- START: NEU: Auch Hundeführer dürfen ihre Anfragen laden ---
    // Nur laden, wenn der User die Berechtigung hat, sie zu sehen
    if (!isAdmin && !isPlanschreiber && !isHundefuehrer) return;
    // --- ENDE: NEU ---
    try {
        // Lade alle offenen Anfragen für den Monat
        // (Die API wird später gefiltert, sodass Hundeführer nur ihre eigenen sehen)
        const queries = await apiFetch(`/api/queries?year=${currentYear}&month=${currentMonth}&status=offen`);
        currentShiftQueries = queries;
    } catch (e) {
        console.error("Fehler beim Laden der Schicht-Anfragen", e);
        currentShiftQueries = [];
    }
}
// --- ENDE NEU ---


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
        const queriesPromise = loadShiftQueries(); // <<< NEU

        const [shiftPayload, userData, specialDatesResult, queriesResult] = await Promise.all([ // <<< NEU
            shiftDataPromise,
            userDataPromise,
            specialDatesPromise,
            queriesPromise // <<< NEU
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

            // --- START: ANGEPASSTE LOGIK (Anfragen vs. Schichten) ---

            // Finde eine relevante Anfrage FÜR DIESE ZELLE
            let queryForCell = currentShiftQueries.find(q =>
                q.target_user_id === user.id && q.shift_date === dateStr && q.status === 'offen'
            );
            if (!queryForCell) {
                queryForCell = currentShiftQueries.find(q =>
                    q.target_user_id === null && q.shift_date === dateStr && q.status === 'offen'
                );
            }

            // Prüfen, ob es eine Schicht-Anfrage ist (z.B. "Anfrage für: T.?")
            const requestPrefix = "Anfrage für: ";
            let isShiftRequest = false;
            let shiftRequestText = "";

            if (queryForCell && queryForCell.message.startsWith(requestPrefix)) {
                isShiftRequest = true;
                // Schneidet "Anfrage für: " ab, z.B. "T.?"
                shiftRequestText = queryForCell.message.substring(requestPrefix.length);
            }

            if (shiftType) {
                // FALL 1: Es ist eine reguläre Schicht eingetragen
                cell.textContent = shiftType.abbreviation;
                if (shiftType.prioritize_background && dayHasSpecialBg) {
                    if (eventType === 'holiday') cellClasses += ` day-color-${eventType}`;
                    else if (isWeekend) cellClasses += ' weekend';
                } else {
                    cellColor = shiftType.color;
                    textColor = isColorDark(shiftType.color) ? 'white' : 'black';
                }

                // Wenn ZUSÄTZLICH eine TEXT-Notiz (nicht Schicht-Anfrage) existiert, zeige ❓
                if (queryForCell && !isShiftRequest) {
                    cell.innerHTML += `<span class="shift-query-icon">❓</span>`;
                    cell.dataset.queryId = queryForCell.id;
                }

            } else if (isShiftRequest) {
                // FALL 2: Keine Schicht, ABER eine Schicht-Anfrage
                cell.textContent = shiftRequestText; // z.B. "T.?"
                cellClasses += ' shift-request-cell'; // Orange Hintergrund
                cell.dataset.queryId = queryForCell.id;

            } else if (queryForCell) {
                // FALL 3: Keine Schicht, keine Schicht-Anfrage, ABER eine Text-Notiz
                cell.textContent = '';
                if (eventType === 'holiday') cellClasses += ` day-color-${eventType}`;
                else if (isWeekend) cellClasses += ' weekend';

                cell.innerHTML += `<span class="shift-query-icon">❓</span>`;
                cell.dataset.queryId = queryForCell.id;

            } else {
                // FALL 4: Zelle ist komplett leer
                cell.textContent = '';
                if (eventType === 'holiday') cellClasses += ` day-color-${eventType}`;
                else if (isWeekend) cellClasses += ' weekend';
            }
            // --- ENDE: ANGEPASSTE LOGIK ---


            cell.className = cellClasses + currentUserClass;

            if (currentYear === today.getFullYear() && (currentMonth - 1) === today.getMonth() && day === today.getDate()) {
                cell.classList.add('current-day-highlight');
            }

            if (cellColor) { cell.style.backgroundColor = cellColor; }
            if (textColor) { cell.style.color = textColor; }
            cell.dataset.key = key;

            // --- START: ÜBERARBEITETE EVENT HANDLER (MIT HUNDEFÜHRER) ---

            const isCellOnOwnRow = isCurrentUser;

            // Rechtsklick-Handler (Kontextmenü)
            const handleContextMenu = (e) => {
                e.preventDefault();
                // Wir übergeben den *Zeilen-Benutzer* (user) und ob es die *eigene Zeile* ist (isCellOnOwnRow)
                showContextMenu(e, user, dateStr, cell, isCellOnOwnRow);
            };

            // Maus-Hover-Handler (für Shortcuts & Visuelles Feedback)
            const handleMouseEnter = () => {
                hoveredCellContext = {
                    userId: user.id, dateStr: dateStr,
                    userName: `${user.vorname} ${user.name}`,
                    cellElement: cell
                };
                // Visueller Hover-Effekt nur für Admins mit offenem Plan
                if (isAdmin && !(currentPlanStatus && currentPlanStatus.is_locked)) {
                    cell.classList.add('hovered');
                }
            };
            const handleMouseLeave = () => {
                hoveredCellContext = null;
                cell.classList.remove('hovered');
            };

            // Wer darf was?
            if (isAdmin || isPlanschreiber) {
                // Admins & Planschreiber: Rechtsklick überall, Hover überall
                cell.addEventListener('contextmenu', handleContextMenu);
                cell.addEventListener('mouseenter', handleMouseEnter);
                cell.addEventListener('mouseleave', handleMouseLeave);
            } else if (isHundefuehrer && isCellOnOwnRow) {
                // Hundeführer: Rechtsklick nur auf eigener Zeile, Hover nur auf eigener Zeile
                cell.addEventListener('contextmenu', handleContextMenu);
                cell.addEventListener('mouseenter', handleMouseEnter);
                cell.addEventListener('mouseleave', handleMouseLeave);
            }

            // --- ENDE: ÜBERARBEITETE EVENT HANDLER ---

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

        // Modal-Button-Logik (unverändert - für das Fallback-Modal)
        if (!isVisitor) {
            const btn = document.createElement('button');
            btn.textContent = `${st.abbreviation} (${st.name})`;
            btn.style.backgroundColor = st.color;
            if (isColorDark(st.color)) {
                btn.style.color = 'white';
            } else {
                btn.style.color = 'black';
            }
            // KORREKTUR: Das Modal muss den globalen modalContext verwenden
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

        // --- START: MODAL/MENÜ SCHLIESSEN ---
        // Schließe EGAL WELCHES Menü offen war (altes Modal oder neues Kontextmenü)
        closeModal(shiftModal);
        hideContextMenu();
        // --- ENDE: MODAL/MENÜ SCHLIESSEN ---


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

        // --- START: NEU (Regel 1) ---
        // Wenn eine Schicht gespeichert wird (von Admin), MUSS eine eventuell
        // vorhandene Anfrage für diese Zelle neu geladen werden (sie ist jetzt hinfällig)
        await loadShiftQueries();
        // --- ENDE: NEU ---

        buildGridDOM(); // <-- Zeichnet jetzt das Grid mit dem frischen Total für userId
        buildStaffingTable();

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
    // Map wird jetzt umgedreht: { t: 'T.', n: 'N.' }
    shortcutMap = Object.fromEntries(
        Object.entries(mergedShortcuts).map(([abbrev, key]) => [key, abbrev])
    );
}

// --- KEYBOARD SHORTCUT LISTENER ---
window.addEventListener('keydown', async (event) => {
    // --- WICHTIG: Nur Admins dürfen Shortcuts verwenden ---
    // (Planschreiber und Hundeführer dürfen nicht)
    if (!isAdmin) return;
    // --- ENDE ANPASSUNG ---

    // --- NEU: Sperr-Check ---
    if (currentPlanStatus && currentPlanStatus.is_locked) return;
    // --- ENDE NEU ---

    // Blockieren, wenn ein Modal (alt oder neu) offen ist ODER das Kontextmenü
    if (shiftModal.style.display === 'block' || queryModal.style.display === 'block' || contextMenu.style.display === 'block') {
        return;
    }

    if (!hoveredCellContext || !hoveredCellContext.userId) return;

    const key = event.key.toLowerCase();
    const abbrev = shortcutMap[key]; // Finde Abkürzung (z.B. 'T.') über die Taste (z.B. 't')

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


// --- START: NEUE FUNKTION FÜR HUNDEFÜHRER-ANFRAGEN ---
/**
 * Sendet eine SCHICHT-Anfrage (z.B. "T.?") über das Query-System.
 */
async function requestShift(shiftAbbrev, userId, dateStr) {
    // (Doppelter Check, aber sicher ist sicher)
    if (!isHundefuehrer || (currentPlanStatus && currentPlanStatus.is_locked)) {
        return;
    }

    const cell = findCellByKey(`${userId}-${dateStr}`);
    if(cell) {
        // Optimistisches UI-Update: Zeige "..."
        // (Das ❓ Icon kommt erst nach dem Neuladen)
        cell.textContent = '...';
    }

    try {
        const payload = {
            target_user_id: userId,
            shift_date: dateStr,
            message: `Anfrage für: ${shiftAbbrev}` // Die Nachricht, die der Admin sieht
        };

        // API-Aufruf (POST /api/queries)
        // (Wir müssen sicherstellen, dass die API-Route dies für Hundeführer erlaubt)
        await apiFetch('/api/queries', 'POST', payload);

        // Daten neu laden und Grid neu zeichnen, um das ❓ Icon anzuzeigen
        await loadShiftQueries();
        buildGridDOM(); // Baut das Grid neu auf

        // --- START ANPASSUNG (Regel 2: Event-Dispatching) ---
        triggerNotificationUpdate();
        // --- ENDE ANPASSUNG ---

    } catch (e) {
        alert(`Fehler beim Erstellen der Anfrage: ${e.message}`);
        // Bei Fehler das Grid neu laden, um den "..." Text zu entfernen
        buildGridDOM();
    }
}
// --- ENDE: NEUE FUNKTION ---


// --- NEUE FUNKTIONEN FÜR SCHICHT-ANFRAGEN (QUERY MODAL) ---

// --- START ANPASSUNG (Regel 2: Event-Dispatching) ---
/**
 * Löst das globale Event aus, um den Notification-Header zu aktualisieren.
 */
function triggerNotificationUpdate() {
    window.dispatchEvent(new CustomEvent('dhf:notification_update'));
}
// --- ENDE ANPASSUNG ---


/**
 * Aktualisiert den Infotext im Query Modal basierend auf der Auswahl.
 */
function updateQueryModalInfo(dateDisplay) {
     // Wir holen den Wert vom Radio-Button, falls er existiert (bei neuer Anfrage)
     const selectedTypeEl = document.querySelector('input[name="query-target-type"]:checked');
     const selectedType = selectedTypeEl ? selectedTypeEl.value : 'user';

     let targetText;
     if (selectedType === 'user' && modalQueryContext.userName) {
         targetText = modalQueryContext.userName;
     } else {
         targetText = "Thema des Tages / Allgemein";
     }
     // Nur den User-Teil aktualisieren, der Datumsteil ist immer gleich
     queryModalInfo.textContent = `Für: ${targetText} am ${dateDisplay}`;
}

/**
 * Fügt Listener für die Anfrageart-Auswahl hinzu.
 */
function attachQueryTypeListeners(userName, dateDisplay) {
    // Wenn die Auswahl nicht existiert (z.b. bei bestehender Anfrage), nichts tun
    if (!queryTargetSelection) return;

    // Listener entfernen, um Duplikate zu vermeiden
    queryTargetSelection.removeEventListener('change', handleQueryTypeChange);

    // Listener für die Radio-Buttons hinzufügen
    function handleQueryTypeChange(event) {
        if (event.target.name === 'query-target-type') {
            // Infotext aktualisieren, wenn die Auswahl wechselt
            updateQueryModalInfo(dateDisplay);
        }
    }
    queryTargetSelection.addEventListener('change', handleQueryTypeChange);
}


/**
 * NEU: Rendert die Konversation (Originalanfrage + Antworten).
 */
function renderReplies(replies, originalQuery) {
    if (!queryRepliesList) return;

    // 1. Ursprüngliche Anfrage (als erster Eintrag)
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

    // 2. Bestehende Antworten entfernen (außer der ursprünglichen)
    let currentChild = queryRepliesList.lastElementChild;
    while (currentChild) {
        const prev = currentChild.previousElementSibling;
        if (currentChild.id !== 'initial-query-item') {
            queryRepliesList.removeChild(currentChild);
        }
        currentChild = prev;
    }

    // 3. Neue Antworten hinzufügen
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

    // Auto-scroll to bottom
    const conversationContainer = document.getElementById('query-conversation-container');
    if(conversationContainer) {
        conversationContainer.scrollTop = conversationContainer.scrollHeight;
    }
}


/**
 * NEU: Lädt die Konversation für eine Anfrage.
 */
async function loadQueryConversation(queryId, originalQuery) {
    if (!queryId || !originalQuery) return;
    try {
        const replies = await apiFetch(`/api/queries/${queryId}/replies`);
        // Wir übergeben nur die dynamischen Antworten (replies) zusammen mit der Originalanfrage (originalQuery)
        renderReplies(replies, originalQuery);

    } catch (e) {
        console.error("Fehler beim Laden der Konversation:", e);
        if(queryRepliesList) queryRepliesList.innerHTML = `<li style="color:red; list-style: none; padding: 10px 0;">Fehler beim Laden der Antworten: ${e.message}</li>`;
    }
}


/**
 * Öffnet das Anfrage-Modal (Rechtsklick)
 */
function openQueryModal(userId, dateStr, userName, queryId) {
    const d = new Date(dateStr);
    const dateDisplay = d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' });

    // 1. Globalen Kontext setzen
    modalQueryContext = { userId, dateStr, userName, queryId: queryId || null };

    // 2. Zustand des Modals setzen
    queryModalStatus.textContent = "";
    queryMessageInput.value = "";
    document.getElementById('reply-message-input').value = ''; // Antwortfeld leeren

    // NEU: Reply-Formular und Konversation zunächst verstecken
    queryReplyForm.style.display = 'none';
    const conversationContainer = document.getElementById('query-conversation-container');
    if(conversationContainer) conversationContainer.style.display = 'none';

    // NEU: Auswahlfelder initialisieren
    if (queryTargetSelection) {
        // Bei Rechtsklick auf eine Zelle ist es standardmäßig ein User-Thema
        targetTypeUser.checked = true;
        // Die Auswahl ist nur bei einer NEUEN Anfrage sichtbar
        const isNewQuery = !queryId;
        queryTargetSelection.style.display = isNewQuery ? 'block' : 'none';

        // --- START: NEU: Auswahl für Hundeführer verstecken ---
        // Hundeführer dürfen nur für "Spezifischer Mitarbeiter" (sich selbst) anfragen,
        // oder für "Thema des Tages". Die Radio-Buttons sind für sie verwirrend,
        // da sie sowieso nur auf der eigenen Zeile klicken können.
        if (isHundefuehrer && !isAdmin && !isPlanschreiber) {
             queryTargetSelection.style.display = 'none';
        }
        // --- ENDE: NEU ---

        // Listener neu anfügen/aktualisieren
        attachQueryTypeListeners(userName, dateDisplay);
    }

    // 3. Bestehende Anfrage prüfen
    const query = queryId ? currentShiftQueries.find(q => q.id == queryId) : null;

    if (query) {
        // --- FALL 1: Es gibt eine offene Anfrage (Konversation) ---
        queryExistingContainer.style.display = 'block';
        queryNewContainer.style.display = 'none';

        // Konversation und Antworten laden
        loadQueryConversation(queryId, query);
        if(conversationContainer) conversationContainer.style.display = 'block';
        queryReplyForm.style.display = 'block'; // Antwortformular aktivieren

        // Admin-Aktionen (Erledigt/Löschen) anzeigen
        // --- START: NEU: Auch Hundeführer dürfen ihre eigenen Anfragen löschen (falls sie der Sender sind) ---
        if (isAdmin || isPlanschreiber) {
            queryAdminActions.style.display = 'flex';
            // Stelle sicher, dass beide Buttons sichtbar sind (falls vorher von HF ausgeblendet)
            if (queryResolveBtn) queryResolveBtn.style.display = 'block';
            if (queryDeleteBtn) queryDeleteBtn.textContent = 'Anfrage löschen';

        } else if (isHundefuehrer && query.sender_user_id === loggedInUser.id) {
             queryAdminActions.style.display = 'flex';
             // Hundeführer dürfen aber nicht "Erledigt" markieren
             if (queryResolveBtn) queryResolveBtn.style.display = 'none';
             // Hundeführer sehen "Zurückziehen"
             if (queryDeleteBtn) queryDeleteBtn.textContent = 'Anfrage zurückziehen';

        }
        // --- ENDE: NEU ---
        else {
            queryAdminActions.style.display = 'none';
        }

        // Infotext anpassen
        let targetName = query.target_name || "Thema des Tages / Allgemein";
        queryModalInfo.textContent = `Für: ${targetName} am ${dateDisplay}`;

    } else {
        // --- FALL 2: Keine offene Anfrage (Neues Formular) ---
        queryExistingContainer.style.display = 'none';
        queryAdminActions.style.display = 'none';
        queryNewContainer.style.display = 'block';
        queryReplyForm.style.display = 'none';

        // Infotext initialisieren
        updateQueryModalInfo(dateDisplay);
    }

    queryModal.style.display = 'block';
}


/**
 * Sendet eine neue Anfrage oder aktualisiert eine bestehende.
 * (Diese Funktion ist jetzt NUR für TEXT-Anfragen)
 */
async function saveShiftQuery() {
    querySubmitBtn.disabled = true;
    queryModalStatus.textContent = "Sende...";
    queryModalStatus.style.color = '#555';

    // NEU: Anfrageart bestimmen
    let selectedType = 'user'; // Standard
    if (queryTargetSelection.style.display === 'block') {
         selectedType = document.querySelector('input[name="query-target-type"]:checked').value;
    }

    const isNewQuery = queryTargetSelection.style.display === 'block';

    try {
        let targetUserId = null;

        // --- START: NEUE LOGIK FÜR ZIEL-ID ---
        if (isHundefuehrer && !isAdmin && !isPlanschreiber) {
            // Hundeführer klickt immer auf eigene Zeile, also ist target_user_id immer die eigene ID
            targetUserId = modalQueryContext.userId;
        } else {
            // Admin/Planschreiber verwenden die Radio-Buttons
             targetUserId = selectedType === 'user' ? modalQueryContext.userId : null;
        }
        // --- ENDE: NEUE LOGIK ---


        const payload = {
            target_user_id: targetUserId,
            shift_date: modalQueryContext.dateStr,
            message: queryMessageInput.value
        };

        if (payload.message.length < 3) {
            throw new Error("Nachricht ist zu kurz.");
        }

        // API-Aufruf (POST /api/queries)
        await apiFetch('/api/queries', 'POST', payload);

        queryModalStatus.textContent = "Gespeichert!";
        queryModalStatus.style.color = '#2ecc71'; // Grün

        // Daten neu laden und Grid neu zeichnen, um das ❓ Icon anzuzeigen
        await loadShiftQueries();
        buildGridDOM();

        // --- START ANPASSUNG (Regel 2: Event-Dispatching) ---
        triggerNotificationUpdate();
        // --- ENDE ANPASSUNG ---

        setTimeout(() => {
            closeModal(queryModal);
            querySubmitBtn.disabled = false;
        }, 1000);

    } catch (e) {
        queryModalStatus.textContent = `Fehler: ${e.message}`;
        queryModalStatus.style.color = '#e74c3c'; // Rot
        querySubmitBtn.disabled = false;
    }
}


/**
 * NEU: Sendet eine Antwort auf eine bestehende Anfrage.
 */
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

        // Finde die Originalanfrage im Cache, um sie an den Renderer zu übergeben
        const originalQuery = currentShiftQueries.find(q => q.id == queryId);

        // UI aktualisieren: Nachricht leeren, Konversation neu laden
        replyMessageInput.value = '';
        await loadQueryConversation(queryId, originalQuery);

        queryModalStatus.textContent = "Antwort gesendet!";
        queryModalStatus.style.color = '#2ecc71';

        // --- START ANPASSUNG (Regel 2: Event-Dispatching) ---
        // Header aktualisieren (z.B. "Warte auf Antwort" Zähler anpassen)
        triggerNotificationUpdate();
        // --- ENDE ANPASSUNG ---

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


/**
 * (Admin ODER Planschreiber) Markiert eine Anfrage als 'erledigt'.
 */
async function resolveShiftQuery() {
    // (Hundeführer dürfen das nicht, Button wird per CSS/JS ausgeblendet)
    if (!isAdmin && !isPlanschreiber || !modalQueryContext.queryId) return;

    queryResolveBtn.disabled = true;
    queryModalStatus.textContent = "Speichere Status...";
    queryModalStatus.style.color = '#555';

    try {
        // API-Aufruf (PUT /api/queries/<id>/status)
        await apiFetch(`/api/queries/${modalQueryContext.queryId}/status`, 'PUT', {
            status: 'erledigt'
        });

        // Daten neu laden und Grid neu zeichnen (Icon wird verschwinden)
        await loadShiftQueries();
        buildGridDOM();

        // --- START ANPASSUNG (Regel 2: Event-Dispatching) ---
        triggerNotificationUpdate();
        // --- ENDE ANPASSUNG ---

        closeModal(queryModal);

    } catch (e) {
         queryModalStatus.textContent = `Fehler: ${e.message}`;
         queryModalStatus.style.color = '#e74c3c'; // Rot
    } finally {
        queryResolveBtn.disabled = false;
    }
}

/**
 * (Admin ODER Planschreiber ODER HUNDEFÜHRER (für eigene)) Löscht eine Anfrage endgültig.
 * NEU: Parameter 'force' hinzugefügt, um confirm() zu überspringen.
 */
async function deleteShiftQueryFromModal(queryId, force = false) {

    // --- START: ANPASSUNG (Verwende Parameter oder globalen Kontext) ---
    const qId = queryId || modalQueryContext.queryId;
    if (!qId) return;

    // (Berechtigungscheck)
    if (!isAdmin && !isPlanschreiber && !isHundefuehrer) return;
    // --- ENDE: ANPASSUNG ---

    // (Hundeführer-Check: Darf er diese löschen?)
    if (isHundefuehrer && !isAdmin && !isPlanschreiber) {
        const query = currentShiftQueries.find(q => q.id == qId);
        if (!query || query.sender_user_id !== loggedInUser.id) {
            alert("Fehler: Sie dürfen nur Ihre eigenen Anfragen löschen.");
            return;
        }
    }

    // --- START: NEUE LOGIK (Confirm überspringen) ---
    // 'force' wird vom Hundeführer-Kontextmenü gesetzt (true)
    // Admins/Planschreiber rufen dies vom Modal auf (force = false)
    if (!force && !confirm("Sind Sie sicher, dass Sie diese Anfrage endgültig löschen/zurückziehen möchten?")) {
        return;
    }
    // --- ENDE: NEUE LOGIK ---

    if(queryDeleteBtn) queryDeleteBtn.disabled = true;
    if(queryModalStatus) queryModalStatus.textContent = "Lösche Anfrage...";
    if(queryModalStatus) queryModalStatus.style.color = '#e74c3c'; // Rot

    try {
        // API-Aufruf (DELETE /api/queries/<id>)
        await apiFetch(`/api/queries/${qId}`, 'DELETE');

        // Daten neu laden und Grid neu zeichnen (Icon wird verschwinden)
        await loadShiftQueries();
        buildGridDOM();

        // --- START ANPASSUNG (Regel 2: Event-Dispatching) ---
        triggerNotificationUpdate();
        // --- ENDE ANPASSUNG ---

        closeModal(queryModal);

    } catch (e) {
         if(queryModalStatus) queryModalStatus.textContent = `Fehler beim Löschen: ${e.message}`;
         if(queryModalStatus) queryModalStatus.style.color = '#e74c3c'; // Rot
    } finally {
        if(queryDeleteBtn) queryDeleteBtn.disabled = false;
    }
}
// --- ENDE NEUE FUNKTIONEN ---


// --- Initialisierung ---
async function initialize() {
    await loadColorSettings();
    await populateStaticElements();
    loadShortcuts();

    // --- START ANPASSUNG (Regel 1: Highlight-Logik) ---
    let highlightData = null;
    try {
        const data = localStorage.getItem(DHF_HIGHLIGHT_KEY);
        if (data) {
            highlightData = JSON.parse(data);
            localStorage.removeItem(DHF_HIGHLIGHT_KEY); // Wichtig: Nur einmal verwenden

            // Setze den globalen Monat/Jahr auf das Datum der Anfrage
            const targetDate = new Date(highlightData.date);
            currentYear = targetDate.getFullYear();
            currentMonth = targetDate.getMonth() + 1;
        }
    } catch (e) {
        console.error("Fehler beim Lesen der Highlight-Daten:", e);
        highlightData = null;
    }

    // Führe renderGrid aus (lädt jetzt den korrekten Monat)
    await renderGrid();

    // Wenn Highlight-Daten vorhanden waren, führe das Blinken aus
    if (highlightData) {
        highlightCells(highlightData.date, highlightData.targetUserId);
    }
    // --- ENDE ANPASSUNG ---
}

// --- START: NEUE FUNKTION (Regel 2: Innovatives Blinken) ---
/**
 * Hebt die relevanten Zellen im Grid hervor (blinkend).
 */
function highlightCells(dateStr, targetUserId) {
    const day = new Date(dateStr).getDate();

    // (CSS-Klasse .grid-cell-highlight muss in schichtplan.html definiert sein)
    const highlightClass = 'grid-cell-highlight';

    let cellsToHighlight = [];

    if (targetUserId) {
        // Spezifische Zelle
        const key = `${targetUserId}-${dateStr}`;
        const cell = findCellByKey(key);
        if (cell) cellsToHighlight.push(cell);

    } else {
        // Allgemeine Anfrage: Alle Zellen des Tages
        const allCellsInDay = document.querySelectorAll(`.grid-cell[data-key$="-${dateStr}"]`);
        cellsToHighlight = Array.from(allCellsInDay);
    }

    if (cellsToHighlight.length > 0) {
        // Scrollt die erste gefundene Zelle ins Sichtfeld
        cellsToHighlight[0].scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'center'
        });

        // Füge die Blink-Klasse hinzu
        cellsToHighlight.forEach(cell => {
            cell.classList.add(highlightClass);
        });

        // Entferne die Klasse nach 5 Sekunden
        setTimeout(() => {
            cellsToHighlight.forEach(cell => {
                cell.classList.remove(highlightClass);
            });
        }, 5000); // 5 Sekunden
    }
}
// --- ENDE: NEUE FUNKTION ---

initialize();