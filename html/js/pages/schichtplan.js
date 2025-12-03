// html/js/pages/schichtplan.js

import { DHF_HIGHLIGHT_KEY, SHORTCUT_STORAGE_KEY, DEFAULT_COLORS, DEFAULT_SHORTCUTS } from '../utils/constants.js';
import { initAuthCheck } from '../utils/auth.js';
import { isColorDark } from '../utils/helpers.js';
import { apiFetch } from '../utils/api.js';

// Module importieren
import { PlanState } from '../modules/schichtplan_state.js';
import { PlanApi } from '../modules/schichtplan_api.js';
import { PlanRenderer } from '../modules/schichtplan_renderer.js';
import { StaffingModule } from '../modules/schichtplan_staffing.js';
import { PlanHandlers } from '../modules/schichtplan_handlers.js';

// --- DOM Elemente ---
const prevMonthBtn = document.getElementById('prev-month-btn');
const nextMonthBtn = document.getElementById('next-month-btn');
const monthLabel = document.getElementById('current-month-label');
const planLockBtn = document.getElementById('plan-lock-btn');
const planStatusToggleBtn = document.getElementById('plan-status-toggle-btn');
const planSendMailBtn = document.getElementById('plan-send-mail-btn');
const planBulkModeBtn = document.getElementById('plan-bulk-mode-btn');
const bulkActionBarPlan = document.getElementById('bulk-action-bar-plan');
const bulkCancelBtn = document.getElementById('bulk-cancel-btn');
const bulkApproveBtn = document.getElementById('bulk-approve-btn');
const bulkRejectBtn = document.getElementById('bulk-reject-btn');
const staffingSortToggleBtn = document.getElementById('staffing-sort-toggle');

// Modals & Links
const openGeneratorLink = document.getElementById('open-generator-modal');
const openGenSettingsLink = document.getElementById('open-gen-settings-modal');
const deletePlanLink = document.getElementById('delete-plan-link');
const closeGeneratorModalBtn = document.getElementById('close-generator-modal');
const startGeneratorBtn = document.getElementById('start-generator-btn');
const closeGenSettingsModalBtn = document.getElementById('close-gen-settings-modal');
const saveGenSettingsBtn = document.getElementById('save-gen-settings-btn');
const generatorModal = document.getElementById('generator-modal');
const genSettingsModal = document.getElementById('gen-settings-modal');
const shiftModal = document.getElementById('shift-modal');
const closeShiftModalBtn = document.getElementById('close-shift-modal');
const queryModal = document.getElementById('query-modal');
const closeQueryModalBtn = document.getElementById('close-query-modal');
const querySubmitBtn = document.getElementById('query-submit-btn');
const queryResolveBtn = document.getElementById('query-resolve-btn');
const queryDeleteBtn = document.getElementById('query-delete-btn');
const replySubmitBtn = document.getElementById('reply-submit-btn');
const clickActionModal = document.getElementById('click-action-modal');

// Varianten Elemente
const variantModal = document.getElementById('variant-modal');
const closeVariantModalBtn = document.getElementById('close-variant-modal');
const createVariantBtn = document.getElementById('create-variant-btn');
const variantTabsContainer = document.getElementById('variant-tabs-container');

// Klick-Modal Actions
const camLinkNotiz = document.getElementById('cam-link-notiz');
const camLinkDelete = document.getElementById('cam-link-delete');
const camBtnApprove = document.getElementById('cam-btn-approve');
const camBtnReject = document.getElementById('cam-btn-reject');

// Generator State lokal
let generatorInterval = null;
let visualInterval = null;
let visualQueue = [];
let processedLogCount = 0; // Zähler für bereits geladene Logs

// --- 1. Initialisierung ---

async function initialize() {
    try {
        injectWarningStyles();

        // Auth Check
        const authData = initAuthCheck();
        PlanState.loggedInUser = authData.user;
        PlanState.isAdmin = authData.isAdmin;
        PlanState.isVisitor = authData.isVisitor;
        PlanState.isPlanschreiber = authData.isPlanschreiber;
        PlanState.isHundefuehrer = authData.isHundefuehrer;

        // State für Varianten
        PlanState.currentVariantId = null;
        PlanState.variants = [];

        // UI Setup
        setupUIByRole();

        // Handler Init
        PlanHandlers.init(renderGrid);

        // Daten laden
        await loadColorSettings();
        await populateStaticElements();
        loadShortcuts();

        // Highlight Check
        checkHighlights();

        // Varianten laden
        await loadVariants();

        // Grid rendern
        await renderGrid();

        // Events binden
        attachGlobalListeners();

    } catch (e) {
        console.error("Initialisierung gestoppt:", e);
    }
}

function injectWarningStyles() {
    const style = document.createElement('style');
    style.innerHTML = `
        .hud-day-box.warning {
            border-color: #e74c3c !important;
            background: rgba(231, 76, 60, 0.3) !important;
            color: #fff !important;
            box-shadow: 0 0 10px #e74c3c !important;
        }
        .hud-terminal::-webkit-scrollbar { width: 8px; }
        .hud-terminal::-webkit-scrollbar-track { background: #000; }
        .hud-terminal::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; }
        .hud-terminal::-webkit-scrollbar-thumb:hover { background: #555; }
    `;
    document.head.appendChild(style);
}

function setupUIByRole() {
    if (staffingSortToggleBtn) {
        staffingSortToggleBtn.style.display = PlanState.isAdmin ? 'inline-block' : 'none';
    }

    if (!PlanState.isAdmin) {
        if (openGeneratorLink) openGeneratorLink.style.display = 'none';
        if (openGenSettingsLink) openGenSettingsLink.style.display = 'none';
        if (deletePlanLink) deletePlanLink.style.display = 'none';
        const settingsDropdown = document.getElementById('settings-dropdown');
        if (settingsDropdown) settingsDropdown.style.display = 'none';
        if (planBulkModeBtn) planBulkModeBtn.style.display = 'none';
        if (planSendMailBtn) planSendMailBtn.style.display = 'none';
        if (variantTabsContainer) variantTabsContainer.style.display = 'none';
    } else {
        if (planBulkModeBtn) planBulkModeBtn.style.display = 'inline-block';
        if (variantTabsContainer) variantTabsContainer.style.display = 'flex';
    }
}

// --- 2. Daten laden ---

async function loadColorSettings() {
    let fetchedColors = DEFAULT_COLORS;
    try {
        const data = await PlanApi.fetchSettings();
        for (const key in DEFAULT_COLORS) {
            if (data[key] !== undefined && data[key] !== null) {
                fetchedColors[key] = data[key];
            }
        }
        PlanState.colorSettings = fetchedColors;
    } catch (error) {
        console.error("Fehler beim Laden der Einstellungen:", error);
    }
    const root = document.documentElement.style;
    for (const key in PlanState.colorSettings) {
        root.setProperty(`--${key.replace(/_/g, '-')}`, PlanState.colorSettings[key]);
    }
}

function loadShortcuts() {
    let savedShortcuts = {};
    try {
        const data = localStorage.getItem(SHORTCUT_STORAGE_KEY);
        if (data) savedShortcuts = JSON.parse(data);
    } catch (e) { console.error(e); }

    const mergedShortcuts = {};
    if(PlanState.allShiftTypesList) {
        PlanState.allShiftTypesList.forEach(st => {
            const key = savedShortcuts[st.abbreviation] || DEFAULT_SHORTCUTS[st.abbreviation];
            if (key) mergedShortcuts[st.abbreviation] = key;
        });
    }
    PlanState.shortcutMap = Object.fromEntries(
        Object.entries(mergedShortcuts).map(([abbrev, key]) => [key, abbrev])
    );
}

function checkHighlights() {
    let highlightData = null;
    try {
        const data = localStorage.getItem(DHF_HIGHLIGHT_KEY);
        if (data) {
            highlightData = JSON.parse(data);
            localStorage.removeItem(DHF_HIGHLIGHT_KEY);
            const parts = highlightData.date.split('-');
            PlanState.currentYear = parseInt(parts[0]);
            PlanState.currentMonth = parseInt(parts[1]);
        }
    } catch (e) {}
    PlanState.pendingHighlight = highlightData;
}

// --- Varianten Logic ---
async function loadVariants() {
    if (!PlanState.isAdmin) return;
    try {
        const variants = await apiFetch(`/api/variants?year=${PlanState.currentYear}&month=${PlanState.currentMonth}`);
        PlanState.variants = variants;
        renderVariantTabs();
    } catch (e) {
        PlanState.variants = [];
        renderVariantTabs();
    }
}

function renderVariantTabs() {
    if (!variantTabsContainer || !PlanState.isAdmin) return;
    variantTabsContainer.innerHTML = '';

    const mainTab = document.createElement('button');
    mainTab.className = `variant-tab ${PlanState.currentVariantId === null ? 'active' : ''}`;
    mainTab.textContent = 'Hauptplan';
    mainTab.onclick = () => switchVariant(null);
    variantTabsContainer.appendChild(mainTab);

    PlanState.variants.forEach(v => {
        const tab = document.createElement('button');
        tab.className = `variant-tab ${PlanState.currentVariantId === v.id ? 'active' : ''}`;
        tab.textContent = v.name;
        tab.onclick = () => switchVariant(v.id);
        variantTabsContainer.appendChild(tab);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'variant-tab variant-tab-add';
    addBtn.textContent = '+';
    addBtn.title = "Neue Variante erstellen";
    addBtn.onclick = () => {
        if(variantModal) {
            document.getElementById('variant-name').value = '';
            variantModal.style.display = 'block';
        }
    };
    variantTabsContainer.appendChild(addBtn);
}

async function switchVariant(variantId) {
    if (PlanState.currentVariantId === variantId) return;
    PlanState.currentVariantId = variantId;
    renderVariantTabs();
    await renderGrid();
}

// --- 3. Render Grid ---

async function renderGrid() {
    const grid = document.getElementById('schichtplan-grid');
    const monthLabel = document.getElementById('current-month-label');
    const staffingGrid = document.getElementById('staffing-grid');

    if(monthLabel) monthLabel.textContent = "Lade...";
    if(grid) grid.innerHTML = '<div style="padding: 20px; text-align: center; color: #333;">Lade Daten...</div>';
    if(staffingGrid) staffingGrid.innerHTML = '';

    const planStatusContainer = document.getElementById('plan-status-container');
    if (planStatusContainer) planStatusContainer.style.display = 'none';
    document.body.classList.remove('plan-locked');

    PlanState.isStaffingSortingMode = false;
    if (staffingSortToggleBtn) {
        staffingSortToggleBtn.textContent = 'Besetzung sortieren';
        staffingSortToggleBtn.classList.remove('btn-secondary');
        staffingSortToggleBtn.classList.add('btn-primary');
    }
    if (PlanState.sortableStaffingInstance) {
        PlanState.sortableStaffingInstance.destroy();
        PlanState.sortableStaffingInstance = null;
    }

    try {
        const [shiftPayload, specialDatesResult, queriesResult] = await Promise.all([
            PlanApi.fetchShiftData(PlanState.currentYear, PlanState.currentMonth, PlanState.currentVariantId),
            PlanApi.fetchSpecialDates(PlanState.currentYear, 'holiday'),
            (PlanState.isAdmin || PlanState.isPlanschreiber || PlanState.isHundefuehrer)
                ? PlanApi.fetchOpenQueries(PlanState.currentYear, PlanState.currentMonth)
                : Promise.resolve([])
        ]);

        PlanState.allUsers = shiftPayload.users;
        PlanState.currentShifts = {};
        shiftPayload.shifts.forEach(s => {
            const key = `${s.user_id}-${s.date}`;
            const fullShiftType = PlanState.allShiftTypes[s.shifttype_id];
            PlanState.currentShifts[key] = { ...s, shift_type: fullShiftType };
        });

        PlanState.currentShiftsLastMonth = {};
        if (shiftPayload.shifts_last_month) {
            shiftPayload.shifts_last_month.forEach(s => {
                const fullShiftType = PlanState.allShiftTypes[s.shifttype_id];
                PlanState.currentShiftsLastMonth[s.user_id] = { ...s, shift_type: fullShiftType };
            });
        }

        PlanState.currentTotals = shiftPayload.totals;
        PlanState.currentViolations.clear();
        if (shiftPayload.violations) {
            shiftPayload.violations.forEach(v => PlanState.currentViolations.add(`${v[0]}-${v[1]}`));
        }

        PlanState.currentStaffingActual = shiftPayload.staffing_actual || {};
        PlanState.currentPlanStatus = shiftPayload.plan_status || {
            year: PlanState.currentYear, month: PlanState.currentMonth,
            status: "In Bearbeitung", is_locked: false
        };

        PlanState.currentSpecialDates = {};
        await loadFullSpecialDates();

        PlanState.currentShiftQueries = queriesResult;

        updatePlanStatusUI(PlanState.currentPlanStatus);

        PlanRenderer.buildGridDOM({
            onCellClick: handleCellClick,
            onCellEnter: (user, dateStr, cell) => {
                PlanState.hoveredCellContext = { userId: user.id, dateStr, userName: `${user.vorname} ${user.name}`, cellElement: cell };
                if (!PlanState.isVisitor) cell.classList.add('hovered');
            },
            onCellLeave: () => {
                if (PlanState.hoveredCellContext && PlanState.hoveredCellContext.cellElement) {
                    PlanState.hoveredCellContext.cellElement.classList.remove('hovered');
                }
                PlanState.hoveredCellContext = null;
            }
        });

        StaffingModule.buildStaffingTable();

        if(PlanState.pendingHighlight) {
            setTimeout(() => {
                PlanRenderer.highlightCells(PlanState.pendingHighlight.date, PlanState.pendingHighlight.targetUserId);
                PlanState.pendingHighlight = null;
            }, 300);
        }

    } catch (error) {
        if(grid) grid.innerHTML = `<div style="padding: 20px; text-align: center; color: red;">Fehler beim Laden des Plans: ${error.message}</div>`;
        console.error(error);
    }
}

async function loadFullSpecialDates() {
    try {
        const year = PlanState.currentYear;
        const [holidays, training, shooting] = await Promise.all([
            PlanApi.fetchSpecialDates(year, 'holiday'),
            PlanApi.fetchSpecialDates(year, 'training'),
            PlanApi.fetchSpecialDates(year, 'shooting')
        ]);
        training.forEach(d => { if(d.date) PlanState.currentSpecialDates[d.date] = d.type; });
        shooting.forEach(d => { if(d.date) PlanState.currentSpecialDates[d.date] = d.type; });
        holidays.forEach(d => { if(d.date) PlanState.currentSpecialDates[d.date] = 'holiday'; });
    } catch (e) {}
}

function updatePlanStatusUI(statusData) {
    const container = document.getElementById('plan-status-container');
    if (!container) return;
    const existingVarBtns = container.querySelectorAll('.variant-action-btn');
    existingVarBtns.forEach(btn => btn.remove());

    container.style.display = 'flex';
    const isVariant = (PlanState.currentVariantId !== null);

    if (planStatusToggleBtn) {
        if (isVariant) {
            planStatusToggleBtn.style.display = 'none';
        } else {
            planStatusToggleBtn.style.display = 'inline-block';
            planStatusToggleBtn.textContent = statusData.status || "In Bearbeitung";
            planStatusToggleBtn.className = '';
            if (statusData.status === "Fertiggestellt") planStatusToggleBtn.classList.add('status-fertiggestellt');
            else planStatusToggleBtn.classList.add('status-in-bearbeitung');
            planStatusToggleBtn.disabled = !PlanState.isAdmin;
        }
    }

    if (planLockBtn) {
        if (isVariant) {
            planLockBtn.style.display = 'none';
        } else {
            planLockBtn.style.display = PlanState.isAdmin ? 'inline-block' : 'none';
            if (statusData.is_locked) {
                planLockBtn.textContent = "Gesperrt";
                planLockBtn.classList.add('locked');
                document.body.classList.add('plan-locked');
            } else {
                planLockBtn.textContent = "Offen";
                planLockBtn.classList.remove('locked');
                document.body.classList.remove('plan-locked');
            }
        }
    }

    if (planSendMailBtn) {
        planSendMailBtn.style.display = (PlanState.isAdmin && !isVariant && statusData.status === "Fertiggestellt" && statusData.is_locked) ? 'inline-block' : 'none';
    }

    if (isVariant && PlanState.isAdmin) {
        const delBtn = document.createElement('button');
        delBtn.textContent = "🗑 Variante Löschen";
        delBtn.className = "btn-admin-action variant-action-btn";
        delBtn.style.backgroundColor = "#e74c3c";
        delBtn.style.color = "white";
        delBtn.onclick = async () => {
            if(confirm("Möchten Sie diese Variante wirklich löschen?")) {
                try {
                    await apiFetch(`/api/variants/${PlanState.currentVariantId}`, 'DELETE');
                    PlanState.currentVariantId = null;
                    await loadVariants();
                    await renderGrid();
                } catch(e) { alert("Fehler: " + e.message); }
            }
        };
        container.appendChild(delBtn);

        const pubBtn = document.createElement('button');
        pubBtn.textContent = "🚀 Als Hauptplan übernehmen";
        pubBtn.className = "btn-admin-action variant-action-btn";
        pubBtn.style.backgroundColor = "#27ae60";
        pubBtn.style.color = "white";
        pubBtn.onclick = async () => {
            if(confirm("ACHTUNG: Dies überschreibt den aktuellen Hauptplan mit dieser Variante. Fortfahren?")) {
                try {
                    await apiFetch(`/api/variants/${PlanState.currentVariantId}/publish`, 'POST');
                    alert("Variante wurde veröffentlicht!");
                    PlanState.currentVariantId = null;
                    await loadVariants();
                    await renderGrid();
                } catch(e) { alert("Fehler: " + e.message); }
            }
        };
        container.appendChild(pubBtn);
    }
}

async function populateStaticElements() {
    try {
        const types = await PlanApi.fetchShiftTypes();
        PlanState.allShiftTypesList = types;
        PlanState.allShiftTypes = {};
        types.forEach(st => PlanState.allShiftTypes[st.id] = st);
    } catch(e) { return; }

    const legendeArbeit = document.getElementById('legende-arbeit');
    const legendeAbwesenheit = document.getElementById('legende-abwesenheit');
    const legendeSonstiges = document.getElementById('legende-sonstiges');
    const shiftSelection = document.getElementById('shift-selection');

    if(legendeArbeit) legendeArbeit.innerHTML = '';
    if(legendeAbwesenheit) legendeAbwesenheit.innerHTML = '';
    if(legendeSonstiges) legendeSonstiges.innerHTML = '';
    if(shiftSelection) shiftSelection.innerHTML = '';

    const specialAbbreviations = ['QA', 'S', 'DPG'];

    PlanState.allShiftTypesList.forEach(st => {
        const item = document.createElement('div');
        item.className = 'legende-item';
        item.innerHTML = `
            <div class="legende-color" style="background-color: ${st.color};"></div>
            <span class="legende-name"><strong>${st.abbreviation}</strong> (${st.name})</span>
        `;
        if (specialAbbreviations.includes(st.abbreviation)) legendeSonstiges.appendChild(item);
        else if (st.is_work_shift) legendeArbeit.appendChild(item);
        else legendeAbwesenheit.appendChild(item);

        if (!PlanState.isVisitor && shiftSelection) {
            const btn = document.createElement('button');
            btn.textContent = `${st.abbreviation} (${st.name})`;
            btn.style.backgroundColor = st.color;
            btn.style.color = isColorDark(st.color) ? 'white' : 'black';
            btn.onclick = () => {
                PlanHandlers.saveShift(st.id, PlanState.modalContext.userId, PlanState.modalContext.dateStr, () => {
                    document.getElementById('shift-modal').style.display = 'none';
                    if(clickActionModal) clickActionModal.style.display = 'none';
                });
            };
            shiftSelection.appendChild(btn);
        }
    });
}

// --- 4. Event Handling ---
function handleCellClick(e, user, dateStr, cell, isOwnRow) {
    if (PlanState.isBulkMode) {
        e.preventDefault();
        PlanHandlers.handleBulkCellClick(cell);
        const count = PlanState.selectedQueryIds.size;
        const statusText = document.getElementById('bulk-status-text');
        if(statusText) statusText.textContent = `${count} ausgewählt`;
        if(bulkApproveBtn) bulkApproveBtn.disabled = count === 0;
        if(bulkRejectBtn) bulkRejectBtn.disabled = count === 0;
        return;
    }
    e.preventDefault();
    if (PlanState.isVisitor) return;
    showClickActionModal(e, user, dateStr, cell, isOwnRow);
}

function showClickActionModal(event, user, dateStr, cell, isCellOnOwnRow) {
    if (PlanState.isBulkMode) return;
    if(clickActionModal) clickActionModal.style.display = 'none';

    const userName = `${user.vorname} ${user.name}`;
    const d = new Date(dateStr);
    const dateDisplay = d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });

    PlanState.clickModalContext = {
        userId: user.id, dateStr, userName,
        isPlanGesperrt: PlanState.currentPlanStatus.is_locked && PlanState.currentVariantId === null
    };

    const camTitle = document.getElementById('cam-title');
    const camSubtitle = document.getElementById('cam-subtitle');
    const camAdminWunschActions = document.getElementById('cam-admin-wunsch-actions');
    const camAdminShifts = document.getElementById('cam-admin-shifts');
    const camHundefuehrerRequests = document.getElementById('cam-hundefuehrer-requests');
    const camNotizActions = document.getElementById('cam-notiz-actions');
    const camHundefuehrerDelete = document.getElementById('cam-hundefuehrer-delete');

    camTitle.textContent = userName;
    camSubtitle.textContent = dateDisplay;

    [camAdminWunschActions, camAdminShifts, camHundefuehrerRequests, camNotizActions, camHundefuehrerDelete].forEach(el => el.style.display = 'none');

    const queries = PlanState.currentShiftQueries.filter(q =>
        (q.target_user_id === user.id && q.shift_date === dateStr && q.status === 'offen')
    );
    const wunsch = queries.find(q => q.sender_role_name === 'Hundeführer' && q.message.startsWith("Anfrage für:"));
    const notiz = queries.find(q => !(q.sender_role_name === 'Hundeführer' && q.message.startsWith("Anfrage für:")));

    PlanState.clickModalContext.wunschQuery = wunsch;
    PlanState.clickModalContext.notizQuery = notiz;

    let hasContent = false;

    if (PlanState.isAdmin) {
        if (wunsch && !PlanState.clickModalContext.isPlanGesperrt) {
            camAdminWunschActions.style.display = 'grid';
            document.getElementById('cam-btn-approve').textContent = `Genehmigen (${wunsch.message.replace('Anfrage für:', '').trim()})`;
            hasContent = true;
        }
        if (!PlanState.clickModalContext.isPlanGesperrt) {
            camAdminShifts.style.display = 'grid';
            populateAdminShiftButtons();
            hasContent = true;
        }
        camNotizActions.style.display = 'block';
        camLinkNotiz.textContent = notiz ? '❓ Text-Notiz ansehen...' : '❓ Text-Notiz erstellen...';
        camLinkNotiz.dataset.targetQueryId = notiz ? notiz.id : "";
        hasContent = true;

    } else if (PlanState.isPlanschreiber) {
        camNotizActions.style.display = 'block';
        camLinkNotiz.textContent = notiz ? '❓ Text-Notiz ansehen...' : '❓ Text-Notiz erstellen...';
        camLinkNotiz.dataset.targetQueryId = notiz ? notiz.id : "";
        hasContent = true;

    } else if (PlanState.isHundefuehrer && isCellOnOwnRow) {
        if (wunsch && wunsch.sender_user_id === PlanState.loggedInUser.id && !PlanState.clickModalContext.isPlanGesperrt) {
            camHundefuehrerDelete.style.display = 'block';
            camLinkDelete.textContent = 'Wunsch-Anfrage zurückziehen';
            camLinkDelete.dataset.targetQueryId = wunsch.id;
            hasContent = true;
        } else if (!wunsch && !PlanState.clickModalContext.isPlanGesperrt) {
            camHundefuehrerRequests.style.display = 'flex';
            populateHfButtons();
            hasContent = true;
        }
    }

    if (!hasContent) return;

    const cellRect = cell.getBoundingClientRect();
    const modalWidth = 300;
    let left = cellRect.left + window.scrollX;
    let top = cellRect.bottom + window.scrollY + 5;
    if (left + modalWidth > document.documentElement.clientWidth) left = document.documentElement.clientWidth - modalWidth - 10;

    clickActionModal.style.left = `${left}px`;
    clickActionModal.style.top = `${top}px`;
    clickActionModal.style.display = 'block';
}

function populateAdminShiftButtons() {
    const container = document.getElementById('cam-admin-shifts');
    container.innerHTML = `<div class="cam-section-title">Schicht zuweisen</div>`;
    const defs = [{ abbrev: 'T.', title: 'Tag' }, { abbrev: 'N.', title: 'Nacht' }, { abbrev: '6', title: 'Kurz' }, { abbrev: 'FREI', title: 'Frei' }, { abbrev: 'U', title: 'Urlaub' }, { abbrev: 'X', title: 'Wunschfrei' }, { abbrev: 'Alle...', title: 'Alle', isAll: true }];

    defs.forEach(def => {
        const btn = document.createElement('button');
        btn.className = def.isAll ? 'cam-shift-button all' : 'cam-shift-button';
        btn.textContent = def.abbrev;
        btn.onclick = () => {
            if (def.isAll) {
                PlanState.modalContext = { userId: PlanState.clickModalContext.userId, dateStr: PlanState.clickModalContext.dateStr };
                document.getElementById('shift-modal-title').textContent = "Alle Schichten";
                document.getElementById('shift-modal-info').textContent = `Für: ${PlanState.clickModalContext.userName}`;
                document.getElementById('shift-modal').style.display = 'block';
            } else {
                const st = PlanState.allShiftTypesList.find(s => s.abbreviation === def.abbrev);
                if (st) {
                    PlanHandlers.saveShift(st.id, PlanState.clickModalContext.userId, PlanState.clickModalContext.dateStr, () => {
                        clickActionModal.style.display = 'none';
                    });
                }
            }
            clickActionModal.style.display = 'none';
        };
        container.appendChild(btn);
    });
}

async function populateHfButtons() {
    const container = document.getElementById('cam-hundefuehrer-requests');
    container.innerHTML = '<div style="color:#bbb; font-size:12px;">Lade...</div>';
    try {
        const usage = await PlanApi.fetchQueryUsage(PlanState.currentYear, PlanState.currentMonth);
        container.innerHTML = `<div class="cam-section-title">Wunsch-Anfrage</div>`;
        const buttons = [{ label: 'T.?', abbr: 'T.' }, { label: 'N.?', abbr: 'N.' }, { label: '6?', abbr: '6' }, { label: 'X?', abbr: 'X' }];
        buttons.forEach(def => {
            const btn = document.createElement('button');
            btn.className = 'cam-shift-button';
            const limit = usage[def.abbr];
            let disabled = false; let info = '';
            if (limit) {
                if (limit.remaining <= 0) { disabled = true; info = '(0)'; } else { info = `(${limit.remaining})`; }
            }
            if (def.abbr === '6') {
                const d = new Date(PlanState.clickModalContext.dateStr);
                const isFri = d.getDay() === 5;
                const isHol = PlanState.currentSpecialDates[PlanState.clickModalContext.dateStr] === 'holiday';
                if (!isFri || isHol) { disabled = true; info = 'Nur Fr'; }
            }
            btn.textContent = `${def.label} ${info}`;
            if (disabled) { btn.disabled = true; btn.style.opacity = 0.5; }
            else {
                btn.onclick = () => {
                    PlanHandlers.requestShift(def.label, PlanState.clickModalContext.userId, PlanState.clickModalContext.dateStr);
                    clickActionModal.style.display = 'none';
                };
            }
            container.appendChild(btn);
        });
    } catch(e) { container.innerHTML = 'Fehler beim Laden.'; }
}

// --- 5. Global Listeners ---

function attachGlobalListeners() {
    if(prevMonthBtn) prevMonthBtn.onclick = () => { PlanHandlers.handleMonthChange(-1); setTimeout(loadVariants, 100); };
    if(nextMonthBtn) nextMonthBtn.onclick = () => { PlanHandlers.handleMonthChange(1); setTimeout(loadVariants, 100); };

    if(planLockBtn) planLockBtn.onclick = () => {
        const newLocked = !PlanState.currentPlanStatus.is_locked;
        PlanApi.updatePlanStatus(PlanState.currentYear, PlanState.currentMonth, PlanState.currentPlanStatus.status, newLocked)
            .then(status => { PlanState.currentPlanStatus = status; updatePlanStatusUI(status); });
    };
    if(planStatusToggleBtn) planStatusToggleBtn.onclick = () => {
        const newStatus = (PlanState.currentPlanStatus.status === "Fertiggestellt") ? "In Bearbeitung" : "Fertiggestellt";
        PlanApi.updatePlanStatus(PlanState.currentYear, PlanState.currentMonth, newStatus, PlanState.currentPlanStatus.is_locked)
            .then(status => { PlanState.currentPlanStatus = status; updatePlanStatusUI(status); });
    };
    if(planSendMailBtn) planSendMailBtn.onclick = () => {
        if(confirm("Rundmail senden?")) {
            PlanApi.sendCompletionNotification(PlanState.currentYear, PlanState.currentMonth)
                .then(res => alert(res.message)).catch(e => alert("Fehler: " + e.message));
        }
    };

    if(planBulkModeBtn) planBulkModeBtn.onclick = (e) => { e.preventDefault(); PlanHandlers.toggleBulkMode(planBulkModeBtn, bulkActionBarPlan); };
    if(bulkCancelBtn) bulkCancelBtn.onclick = () => PlanHandlers.toggleBulkMode(planBulkModeBtn, bulkActionBarPlan);
    if(bulkApproveBtn) bulkApproveBtn.onclick = () => PlanHandlers.performPlanBulkAction('approve');
    if(bulkRejectBtn) bulkRejectBtn.onclick = () => PlanHandlers.performPlanBulkAction('reject');

    if(staffingSortToggleBtn) staffingSortToggleBtn.onclick = () => StaffingModule.toggleStaffingSortMode();

    // 1. Schichtplan Löschen
    if (deletePlanLink) {
        deletePlanLink.onclick = async (e) => {
            e.preventDefault();
            const planName = PlanState.currentVariantId ? "diese Variante" : "den Hauptplan";
            if(confirm(`Möchten Sie wirklich ${planName} für ${PlanState.currentMonth}/${PlanState.currentYear} leeren?`)) {
                try {
                    await PlanApi.clearShiftPlan(PlanState.currentYear, PlanState.currentMonth, PlanState.currentVariantId);
                    await renderGrid();
                } catch(err) { alert("Fehler: " + err.message); }
            }
        };
    }

    // 2. Generator Öffnen (NEU: HUD Initialisierung)
    if (openGeneratorLink) {
        openGeneratorLink.onclick = (e) => {
            e.preventDefault();
            if(!PlanState.isAdmin) return;

            const label = document.getElementById('gen-target-month');
            if(label) label.textContent = `${PlanState.currentMonth}/${PlanState.currentYear}`;

            generateHudGrid(); // Gitter erstellen

            // Reset Visual
            const logContainer = document.getElementById('generator-log-container');
            if(logContainer) logContainer.innerHTML = '<div class="hud-log-line">System bereit...</div>';

            const progFill = document.getElementById('gen-progress-fill');
            if(progFill) progFill.style.width = '0%';

            const statusText = document.getElementById('gen-status-text');
            if(statusText) {
                statusText.textContent = "BEREIT";
                statusText.style.color = "#bdc3c7";
            }

            if(startGeneratorBtn) {
                startGeneratorBtn.disabled = false;
                startGeneratorBtn.textContent = "INITIALISIEREN";
            }

            if(generatorModal) generatorModal.style.display = 'block';
        };
    }

    // 3. Generator Starten (NEU: Queue System & Reset)
    if (startGeneratorBtn) {
        startGeneratorBtn.onclick = async () => {
            startGeneratorBtn.disabled = true;
            startGeneratorBtn.textContent = "LÄUFT...";

            // --- RESET ---
            visualQueue = [];
            processedLogCount = 0; // Reset Index-Counter

            // Grid Reset (Alle Farben entfernen)
            document.querySelectorAll('.hud-day-box').forEach(b => {
                b.classList.remove('done', 'processing', 'warning');
            });

            // Progress Reset
            const progFill = document.getElementById('gen-progress-fill');
            if(progFill) progFill.style.width = '0%';

            // Log Reset
            const logContainer = document.getElementById('generator-log-container');
            logContainer.innerHTML = '';
            visualQueue.push('<div class="hud-log-line highlight">> Startsequenz initiiert...</div>');

            const statusText = document.getElementById('gen-status-text');
            if(statusText) {
                statusText.textContent = "AKTIV";
                statusText.style.color = "#2ecc71";
            }

            // Starte Visual Loop
            if (visualInterval) clearInterval(visualInterval);
            visualInterval = setInterval(processVisualQueue, 40); // 40ms

            try {
                await PlanApi.startGenerator(PlanState.currentYear, PlanState.currentMonth, PlanState.currentVariantId);
                if (generatorInterval) clearInterval(generatorInterval);
                generatorInterval = setInterval(pollGeneratorStatus, 1000);
            } catch (error) {
                visualQueue.push(`<div class="hud-log-line error">[FEHLER] ${error.message}</div>`);
                startGeneratorBtn.disabled = false;
                startGeneratorBtn.textContent = "RETRY";
            }
        };
    }

    if (openGenSettingsLink) {
        openGenSettingsLink.onclick = async (e) => {
            e.preventDefault();
            if(!PlanState.isAdmin) return;
            const statusEl = document.getElementById('gen-settings-status');
            if(statusEl) statusEl.textContent = "Lade...";
            if(genSettingsModal) genSettingsModal.style.display = 'block';
            try {
                const config = await PlanApi.getGeneratorConfig();
                if(document.getElementById('gen-max-consecutive')) document.getElementById('gen-max-consecutive').value = config.max_consecutive_same_shift || 4;
                if(document.getElementById('gen-rest-days')) document.getElementById('gen-rest-days').value = config.mandatory_rest_days_after_max_shifts || 2;
                if(document.getElementById('gen-fill-rounds')) document.getElementById('gen-fill-rounds').value = config.generator_fill_rounds || 3;
                if(document.getElementById('gen-max-hours')) document.getElementById('gen-max-hours').value = config.max_monthly_hours || 170;
                if(document.getElementById('gen-fairness-threshold')) document.getElementById('gen-fairness-threshold').value = config.fairness_threshold_hours || 10;
                if(document.getElementById('gen-min-hours-bonus')) document.getElementById('gen-min-hours-bonus').value = config.min_hours_score_multiplier || 5;
                const container = document.getElementById('gen-shifts-container');
                if (container) {
                    container.innerHTML = '';
                    const activeShifts = config.shifts_to_plan || ["6", "T.", "N."];
                    PlanState.allShiftTypesList.forEach(st => {
                        if (!st.is_work_shift) return;
                        const div = document.createElement('div');
                        div.className = 'gen-shift-checkbox';
                        const input = document.createElement('input');
                        input.type = 'checkbox';
                        input.value = st.abbreviation;
                        input.id = `gen-shift-${st.id}`;
                        if (activeShifts.includes(st.abbreviation)) input.checked = true;
                        const label = document.createElement('label');
                        label.htmlFor = `gen-shift-${st.id}`;
                        label.textContent = `${st.abbreviation}`;
                        div.appendChild(input);
                        div.appendChild(label);
                        container.appendChild(div);
                    });
                }
                if(statusEl) statusEl.textContent = "";
            } catch (err) { if(statusEl) statusEl.textContent = "Fehler beim Laden."; }
        };
    }

    if (saveGenSettingsBtn) {
        saveGenSettingsBtn.onclick = async () => {
            saveGenSettingsBtn.disabled = true;
            const statusEl = document.getElementById('gen-settings-status');
            statusEl.textContent = "Speichere...";
            const selectedShifts = [];
            document.querySelectorAll('#gen-shifts-container input[type="checkbox"]').forEach(cb => {
                if(cb.checked) selectedShifts.push(cb.value);
            });
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
                await PlanApi.saveGeneratorConfig(payload);
                statusEl.textContent = "Gespeichert!";
                statusEl.style.color = "#2ecc71";
                setTimeout(() => { if(genSettingsModal) genSettingsModal.style.display = 'none'; statusEl.textContent = ""; }, 1000);
            } catch(e) { statusEl.textContent = "Fehler: " + e.message; } finally { saveGenSettingsBtn.disabled = false; }
        };
    }

    const modals = [shiftModal, queryModal, generatorModal, genSettingsModal, variantModal];
    modals.forEach(m => {
        if(m) {
            const closeBtn = m.querySelector('.close');
            if(closeBtn) closeBtn.onclick = () => m.style.display = 'none';
        }
    });
    window.onclick = (e) => {
        if (modals.includes(e.target)) e.target.style.display = 'none';
        if (!e.target.closest('.grid-cell') && !e.target.closest('#click-action-modal') && !e.target.closest('#bulk-action-bar-plan') && !e.target.closest('#plan-bulk-mode-btn')) {
            if(clickActionModal) clickActionModal.style.display = 'none';
        }
    };

    if(createVariantBtn) createVariantBtn.onclick = async () => {
        const name = document.getElementById('variant-name').value;
        if(!name) { alert("Name erforderlich"); return; }
        createVariantBtn.disabled = true; createVariantBtn.textContent = "Erstelle...";
        try {
            await apiFetch('/api/variants', 'POST', { name: name, year: PlanState.currentYear, month: PlanState.currentMonth, source_variant_id: PlanState.currentVariantId });
            if(variantModal) variantModal.style.display = 'none';
            await loadVariants();
            const newVar = PlanState.variants[PlanState.variants.length - 1];
            if(newVar) await switchVariant(newVar.id);
        } catch(e) { alert("Fehler: " + e.message); } finally { createVariantBtn.disabled = false; createVariantBtn.textContent = "Erstellen"; }
    };

    window.addEventListener('keydown', (e) => PlanHandlers.handleKeyboardShortcut(e));

    if(camLinkNotiz) camLinkNotiz.onclick = () => {
        const ctx = PlanState.clickModalContext;
        PlanState.modalQueryContext = { userId: ctx.userId, dateStr: ctx.dateStr, userName: ctx.userName, queryId: camLinkNotiz.dataset.targetQueryId || null };
        document.getElementById('query-modal-title').textContent = "Schicht-Notiz";
        document.getElementById('query-modal-info').textContent = `Für: ${ctx.userName}`;
        document.getElementById('query-existing-container').style.display = PlanState.modalQueryContext.queryId ? 'block' : 'none';
        document.getElementById('query-new-container').style.display = PlanState.modalQueryContext.queryId ? 'none' : 'block';
        queryModal.style.display = 'block';
        clickActionModal.style.display = 'none';
    };
    if(camLinkDelete) camLinkDelete.onclick = () => { PlanHandlers.deleteShiftQuery(camLinkDelete.dataset.targetQueryId, () => clickActionModal.style.display = 'none'); };
    if(camBtnApprove) camBtnApprove.onclick = () => { renderGrid(); };
    if(querySubmitBtn) querySubmitBtn.onclick = () => { const msg = document.getElementById('query-message-input').value; PlanHandlers.saveShiftQuery(msg, () => queryModal.style.display = 'none'); };
    if(queryResolveBtn) queryResolveBtn.onclick = () => { PlanHandlers.resolveShiftQuery(PlanState.modalQueryContext.queryId, () => queryModal.style.display = 'none'); };
    if(queryDeleteBtn) queryDeleteBtn.onclick = () => { PlanHandlers.deleteShiftQuery(PlanState.modalQueryContext.queryId, () => queryModal.style.display = 'none'); };
}

// --- HUD HELPER ---
function generateHudGrid() {
    const grid = document.getElementById('gen-day-grid');
    if(!grid) return;
    grid.innerHTML = '';
    const daysInMonth = new Date(PlanState.currentYear, PlanState.currentMonth, 0).getDate();
    for (let i = 1; i <= daysInMonth; i++) {
        const box = document.createElement('div');
        box.className = 'hud-day-box';
        box.id = `day-box-${i}`;
        box.textContent = i;
        grid.appendChild(box);
    }
}

function processVisualQueue() {
    if (visualQueue.length === 0) return;

    const item = visualQueue.shift();

    // Spezial-Befehle
    if (item.type === 'finish') {
        clearInterval(visualInterval);
        visualInterval = null;

        const statusText = document.getElementById('gen-status-text');
        if(statusText) { statusText.textContent = "FERTIG"; statusText.style.color = "#2ecc71"; }

        const startBtn = document.getElementById('start-generator-btn');
        if(startBtn) {
             startBtn.disabled = false;
             startBtn.textContent = "ABGESCHLOSSEN";
        }

        // Aufräumen (Grün setzen, wenn keine Warnung)
        const daysInMonth = new Date(PlanState.currentYear, PlanState.currentMonth, 0).getDate();
        for (let i = 1; i <= daysInMonth; i++) {
            const box = document.getElementById(`day-box-${i}`);
            if(box && !box.classList.contains('warning')) {
                box.classList.remove('processing');
                box.classList.add('done');
            }
        }

        // Grid neu laden
        setTimeout(() => { renderGrid(); }, 1000);
        return;
    }

    // Normaler Text-Log
    if (item.type === 'log') {
        const logContainer = document.getElementById('generator-log-container');
        const div = document.createElement('div');
        div.innerHTML = item.content;
        logContainer.appendChild(div);
        logContainer.scrollTop = logContainer.scrollHeight;

        const text = div.textContent;

        // Visualisierung der Tage
        const dayMatch = text.match(/Plane Tag (\d+)/);
        if (dayMatch) {
            const day = parseInt(dayMatch[1]);
            // Vorherige aufräumen
            for (let d = 1; d < day; d++) {
                const box = document.getElementById(`day-box-${d}`);
                if (box && !box.classList.contains('warning')) {
                    box.classList.add('done');
                }
                if (box) box.classList.remove('processing');
            }
            // Aktuellen markieren
            const currentBox = document.getElementById(`day-box-${day}`);
            if (currentBox) {
                currentBox.classList.remove('done');
                currentBox.classList.add('processing');
            }
        }

        // Warnung erkennen
        if (text.includes('[WARN]') && text.includes('Tag')) {
             const warnDayMatch = text.match(/Tag (\d+):/);
             if (warnDayMatch) {
                 const day = parseInt(warnDayMatch[1]);
                 const box = document.getElementById(`day-box-${day}`);
                 if (box) {
                     box.classList.remove('processing');
                     box.classList.remove('done');
                     box.classList.add('warning');
                 }
             }
        }
    }
}

async function pollGeneratorStatus() {
    try {
        const statusData = await PlanApi.getGeneratorStatus();
        const progFill = document.getElementById('gen-progress-fill');
        if(progFill) progFill.style.width = `${statusData.progress || 0}%`;

        if (statusData.logs && statusData.logs.length > 0) {
            // Neue Logs holen (Index basiert)
            const newLogs = statusData.logs;
            const startIdx = processedLogCount; // Starten wo wir aufgehört haben

            // Falls Server rotiert hat (Array kürzer als unser Zähler), Reset
            // Oder falls wir mehr Logs haben als das Array lang ist (unwahrscheinlich hier, da wir sammeln)
            // Wir nehmen einfach alle ab dem Offset.

            for (let i = startIdx; i < newLogs.length; i++) {
                const logMsg = newLogs[i];
                let className = 'hud-log-line';
                if (logMsg.includes('[FEHLER]')) className += ' error';
                else if (logMsg.includes('[WARN]')) className += ' highlight';
                else if (logMsg.includes('erfolgreich')) className += ' success';

                visualQueue.push({
                    type: 'log',
                    content: `<div class="${className}">&gt; ${logMsg}</div>`
                });
            }

            processedLogCount = newLogs.length;
        }

        if (statusData.status === 'finished' || statusData.status === 'error') {
            if (generatorInterval) clearInterval(generatorInterval);
            generatorInterval = null;

            if (statusData.status === 'finished') {
                // Erfolgsmeldung und Finish-Signal in die Queue
                visualQueue.push({
                    type: 'log',
                    content: '<div class="hud-log-line success">> VORGANG ABGESCHLOSSEN.</div>'
                });
                visualQueue.push({ type: 'finish' });

            } else {
                const statusText = document.getElementById('gen-status-text');
                if(statusText) { statusText.textContent = "ABBRUCH"; statusText.style.color = "#e74c3c"; }
                const startBtn = document.getElementById('start-generator-btn');
                if(startBtn) { startBtn.disabled = false; startBtn.textContent = "FEHLER"; }
            }
        }
    } catch (e) { console.error("Poll Error:", e); }
}

// Start
initialize();