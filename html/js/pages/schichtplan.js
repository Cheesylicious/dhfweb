// html/js/pages/schichtplan.js

import { DHF_HIGHLIGHT_KEY, SHORTCUT_STORAGE_KEY, DEFAULT_COLORS, DEFAULT_SHORTCUTS } from '../utils/constants.js';
import { initAuthCheck } from '../utils/auth.js';
import { apiFetch } from '../utils/api.js';
import { initPetDisplay } from '../utils/pet_renderer.js';

// Core Modules (Daten & State)
import { PlanState } from '../modules/schichtplan_state.js';
import { PlanApi } from '../modules/schichtplan_api.js';
import { PlanRenderer } from '../modules/schichtplan_renderer.js';
import { StaffingModule } from '../modules/schichtplan_staffing.js';
import { PlanHandlers } from '../modules/schichtplan_handlers.js';
import { PredictionUI } from '../modules/prediction_ui.js';

// Feature Modules (Neu ausgelagert)
import { PlanUIHelper } from '../modules/schichtplan_ui_helper.js';
import { PlanNavigation } from '../modules/schichtplan_navigation.js';
import { PlanBanner } from '../modules/schichtplan_banner.js';
import { PlanInteraction } from '../modules/schichtplan_interaction.js';
import { PlanGeneratorUI } from '../modules/schichtplan_generator_ui.js';
import { PlanSocket } from '../modules/schichtplan_socket.js';


// --- 1. HAUPTFUNKTIONEN (Startup) ---

async function initialize() {
    try {
        // 1. Visuelle Basis (CSS Injection)
        PlanUIHelper.injectWarningStyles();

        // 2. Auth & User State
        const authData = initAuthCheck();
        PlanState.loggedInUser = authData.user;
        PlanState.isAdmin = authData.isAdmin;
        PlanState.isVisitor = authData.isVisitor;
        PlanState.isPlanschreiber = authData.isPlanschreiber;
        PlanState.isHundefuehrer = authData.isHundefuehrer;

        // Initiale State-Werte
        PlanState.currentVariantId = null;
        PlanState.variants = [];
        PlanState.generatorConfig = {};

        // Feature-Inits (Unabhängige Module)
        PredictionUI.init();
        initPetDisplay(PlanState.loggedInUser);

        // --- 3. MODULE INITIALISIEREN & VERKNÜPFEN ---

        // UI Helper: Braucht Callbacks für Varianten-Reload und Grid-Reload
        PlanUIHelper.setupUIByRole();
        PlanUIHelper.init(
            () => PlanNavigation.loadVariants(),
            renderGrid
        );

        // Handlers: Basis-Logik für API-Calls
        PlanHandlers.init(renderGrid);

        // Navigation: Zeitsteuerung und Varianten-Tabs
        PlanNavigation.init(renderGrid);

        // Interaction: Klicks auf Zellen, Modals, Tausch-Logik
        PlanInteraction.init(renderGrid);

        // Generator UI: HUD und Steuerung
        PlanGeneratorUI.init(renderGrid);

        // Socket: Echtzeit-Updates (Verbindet Grid-Reload und Status-UI Update)
        PlanSocket.init(
            renderGrid,
            PlanUIHelper.updatePlanStatusUI.bind(PlanUIHelper)
        );


        // --- 4. DATEN LADEN ---

        // Einstellungen & Statics
        await loadColorSettings();
        await PlanUIHelper.populateStaticElements();
        loadShortcuts();

        // Generator Config vorladen (nur für Admins relevant)
        if (PlanState.isAdmin) {
            try {
                PlanState.generatorConfig = await PlanApi.getGeneratorConfig();
            } catch(e) { console.warn("Generator-Config nicht geladen", e); }
        }

        // Highlight Check (Hat der User von "Anfragen" hierher geklickt?)
        checkHighlights();

        // Varianten laden (Startet auch die Tab-Anzeige)
        await PlanNavigation.loadVariants();

        // ERSTES RENDERING DES GRIDS
        await renderGrid();

    } catch (e) {
        console.error("Initialisierung gestoppt:", e);
    }
}


// --- 2. ZENTRALE RENDER-LOGIK ---

/**
 * Lädt alle Schichtdaten neu und aktualisiert das gesamte Grid.
 * Diese Funktion wird an fast alle Module als Callback übergeben.
 * * @param {boolean} isSilent - Wenn true, wird kein Lade-Blur angezeigt (für Live-Updates).
 */
async function renderGrid(isSilent = false) {
    const grid = document.getElementById('schichtplan-grid');
    const monthLabel = document.getElementById('current-month-label');
    const staffingGrid = document.getElementById('staffing-grid');

    // Animation Start (Blur Effekt)
    if(!isSilent) {
        if(grid) grid.classList.add('blur-loading');
        if(staffingGrid) staffingGrid.classList.add('blur-loading');
        if(monthLabel) monthLabel.textContent = "Lade...";
    }

    // Reset UI State
    document.body.classList.remove('plan-locked');

    // Sortiermodus der Besetzungstabelle zurücksetzen
    if (PlanState.isStaffingSortingMode) {
        const toggleBtn = document.getElementById('staffing-sort-toggle');
        if(toggleBtn) {
            toggleBtn.textContent = 'Besetzung sortieren';
            toggleBtn.classList.remove('btn-secondary');
            toggleBtn.classList.add('btn-primary');
        }
        PlanState.isStaffingSortingMode = false;
        PlanState.sortableStaffingInstance = null;
    }

    try {
        // --- PARALLEL DATEN LADEN ---
        // Wir nutzen Promise.all für maximale Geschwindigkeit
        const [shiftPayload, specialDatesResult, queriesResult, marketOffersResult, pendingRequestsResult] = await Promise.all([
            // 1. Schichten & Status
            PlanApi.fetchShiftData(PlanState.currentYear, PlanState.currentMonth, PlanState.currentVariantId),
            // 2. Feiertage
            PlanApi.fetchSpecialDates(PlanState.currentYear, 'holiday'),
            // 3. Queries (Text-Notizen & Wünsche) - Nur für Berechtigte
            (PlanState.isAdmin || PlanState.isPlanschreiber || PlanState.isHundefuehrer)
                ? PlanApi.fetchOpenQueries(PlanState.currentYear, PlanState.currentMonth)
                : Promise.resolve([]),
            // 4. Marktplatz Angebote
            (PlanState.isAdmin || PlanState.isHundefuehrer)
                ? PlanApi.fetchMarketOffers()
                : Promise.resolve([]),
            // 5. Change Requests (Offene Anträge für Visualisierung)
            (PlanState.isAdmin || PlanState.isPlanschreiber || PlanState.isHundefuehrer)
                ? PlanApi.fetchPendingShiftChangeRequests()
                : Promise.resolve([])
        ]);

        // --- STATE UPDATE ---

        // Users & Shifts ins State-Objekt mappen
        PlanState.allUsers = shiftPayload.users;
        PlanState.currentShifts = {};
        shiftPayload.shifts.forEach(s => {
            const key = `${s.user_id}-${s.date}`;
            const fullShiftType = PlanState.allShiftTypes[s.shifttype_id];
            PlanState.currentShifts[key] = { ...s, shift_type: fullShiftType };
        });

        // Last Month (für Übertrag-Anzeige)
        PlanState.currentShiftsLastMonth = {};
        if (shiftPayload.shifts_last_month) {
            shiftPayload.shifts_last_month.forEach(s => {
                const fullShiftType = PlanState.allShiftTypes[s.shifttype_id];
                PlanState.currentShiftsLastMonth[s.user_id] = { ...s, shift_type: fullShiftType };
            });
        }

        // Stats & Violations
        PlanState.currentTotals = shiftPayload.totals;
        PlanState.currentViolations.clear();
        if (shiftPayload.violations) {
            shiftPayload.violations.forEach(v => PlanState.currentViolations.add(`${v[0]}-${v[1]}`));
        }

        // Market Offers
        PlanState.currentMarketOffers = {};
        if (marketOffersResult && Array.isArray(marketOffersResult)) {
            marketOffersResult.forEach(offer => {
                // Key format: userId-dateStr
                const d = offer.shift_date.split('T')[0];
                const key = `${offer.offering_user_id}-${d}`;
                PlanState.currentMarketOffers[key] = offer;
            });
        }

        // Change Requests (Pending)
        PlanState.currentChangeRequests = pendingRequestsResult || [];

        // Staffing (Ist-Zustand) & Plan-Status
        PlanState.currentStaffingActual = shiftPayload.staffing_actual || {};
        PlanState.currentPlanStatus = shiftPayload.plan_status || {
            year: PlanState.currentYear, month: PlanState.currentMonth,
            status: "In Bearbeitung", is_locked: false
        };

        // Special Dates (Vollständiger Load inkl. Training/DPO)
        PlanState.currentSpecialDates = {};
        await loadFullSpecialDates();

        // Queries
        PlanState.currentShiftQueries = queriesResult;


        // --- UI UPDATES ---

        // 1. Status Bar aktualisieren (Sperren/Varianten Buttons)
        PlanUIHelper.updatePlanStatusUI(PlanState.currentPlanStatus);

        // 2. Grid DOM bauen
        // Wir übergeben den Click-Handler aus dem Interaction Modul
        PlanRenderer.buildGridDOM({
            onCellClick: (e, user, dateStr, cell, isOwn) =>
                PlanInteraction.handleCellClick(e, user, dateStr, cell, isOwn),

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

        // 3. Staffing Table aufbauen
        StaffingModule.buildStaffingTable();

        // 4. Highlight (falls User von "Anfragen" kam)
        if(PlanState.pendingHighlight) {
            setTimeout(() => {
                PlanRenderer.highlightCells(PlanState.pendingHighlight.date, PlanState.pendingHighlight.targetUserId);
                PlanState.pendingHighlight = null;
            }, 300);
        }

        // 5. Banner & Visuals (Marktplatz, Offene Anträge)
        PlanBanner.renderUnifiedBanner();
        PlanBanner.markPendingTakeovers();

        // 6. Market Badge im Header updaten
        const badge = document.getElementById('market-badge');
        if (badge && PlanState.currentMarketOffers) {
             const count = Object.keys(PlanState.currentMarketOffers).length;
             badge.textContent = count;
             badge.style.display = count > 0 ? 'inline-block' : 'none';
        }

    } catch (error) {
        if(grid) grid.innerHTML = `<div style="padding: 20px; text-align: center; color: red;">Fehler beim Laden des Plans: ${error.message}</div>`;
        console.error(error);
    } finally {
        // Animation Ende (Blur entfernen)
        if(grid) grid.classList.remove('blur-loading');
        if(staffingGrid) staffingGrid.classList.remove('blur-loading');
    }
}


// --- 3. HELPER FUNCTIONS (Startup-related) ---

async function loadFullSpecialDates() {
    try {
        const year = PlanState.currentYear;
        // Parallel laden aller Typen für maximale Performance
        const [holidays, training, shooting, dpo] = await Promise.all([
            PlanApi.fetchSpecialDates(year, 'holiday'),
            PlanApi.fetchSpecialDates(year, 'training'),
            PlanApi.fetchSpecialDates(year, 'shooting'),
            PlanApi.fetchSpecialDates(year, 'dpo')
        ]);

        // In State merken
        training.forEach(d => { if(d.date) PlanState.currentSpecialDates[d.date] = d.type; });
        shooting.forEach(d => { if(d.date) PlanState.currentSpecialDates[d.date] = d.type; });
        holidays.forEach(d => { if(d.date) PlanState.currentSpecialDates[d.date] = 'holiday'; });
        dpo.forEach(d => { if(d.date) PlanState.currentSpecialDates[d.date] = 'dpo'; });
    } catch (e) {
        console.warn("Fehler beim Laden der Sondertermine", e);
    }
}

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

            // FIX: Datum bereinigen
            if (highlightData.date && highlightData.date.includes('T')) {
                highlightData.date = highlightData.date.split('T')[0];
            }

            const parts = highlightData.date.split('-');
            PlanState.currentYear = parseInt(parts[0]);
            PlanState.currentMonth = parseInt(parts[1]);
        }
    } catch (e) {}
    PlanState.pendingHighlight = highlightData;
}


// --- 4. START ---

// Global Keydown (Shortcuts)
window.addEventListener('keydown', (e) => PlanHandlers.handleKeyboardShortcut(e));

// Global Click (Modals schließen)
window.addEventListener('click', (e) => {
    // Liste der Modals, die geschlossen werden sollen bei Klick auf Hintergrund
    const modals = [
        document.getElementById('shift-modal'),
        document.getElementById('query-modal'),
        document.getElementById('generator-modal'),
        document.getElementById('gen-settings-modal'),
        document.getElementById('variant-modal')
    ];

    modals.forEach(m => {
        if(m && e.target === m) m.style.display = 'none';
    });
});

// App Start
initialize();