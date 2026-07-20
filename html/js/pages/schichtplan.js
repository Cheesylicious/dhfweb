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
import { MarketModule } from '../modules/schichtplan_market.js';

// Feature Modules
import { PlanUIHelper } from '../modules/schichtplan_ui_helper.js';
import { PlanNavigation } from '../modules/schichtplan_navigation.js';
import { PlanBanner } from '../modules/schichtplan_banner.js';
import { PlanInteraction } from '../modules/schichtplan_interaction.js';
import { PlanGeneratorUI } from '../modules/schichtplan_generator_ui.js';
import { PlanSocket } from '../modules/schichtplan_socket.js';
import { initImpersonation } from '../modules/admin_impersonation.js';


// --- MONATSBEZOGENE ANZEIGE- UND DRUCKFILTER ---

const PLAN_DISPLAY_FILTER_STORAGE_KEY = 'dhf_plan_display_filters_v1';

function getPlanDisplayFilterKey() {
    const userId = PlanState.loggedInUser?.id || 'anonymous';
    const variant = PlanState.currentVariantId === null ? 'main' : `variant-${PlanState.currentVariantId}`;
    return `${userId}:${PlanState.currentYear}-${String(PlanState.currentMonth).padStart(2, '0')}:${variant}`;
}

function readPlanDisplayFilterStates() {
    try {
        const stored = JSON.parse(localStorage.getItem(PLAN_DISPLAY_FILTER_STORAGE_KEY) || '{}');
        return stored && typeof stored === 'object' ? stored : {};
    } catch (error) {
        console.warn('Gespeicherte Darstellungsfilter konnten nicht gelesen werden:', error);
        return {};
    }
}

function savePlanDisplayFilterState() {
    const hideWishMarkers = document.getElementById('hide-wish-markers');
    const hideXShifts = document.getElementById('hide-x-shifts');
    if (!hideWishMarkers || !hideXShifts) return;

    try {
        const allStates = readPlanDisplayFilterStates();
        const filterKey = getPlanDisplayFilterKey();
        const previousState = allStates[filterKey] || {};
        allStates[filterKey] = {
            ...previousState,
            hideWishMarkers: hideWishMarkers.checked,
            hideXShifts: hideXShifts.checked
        };
        localStorage.setItem(PLAN_DISPLAY_FILTER_STORAGE_KEY, JSON.stringify(allStates));
    } catch (error) {
        console.warn('Darstellungsfilter konnten nicht gespeichert werden:', error);
    }
}

function getDogAlertStorageKey(alert) {
    return JSON.stringify([
        String(alert.dog_id ?? ''),
        String(alert.event_type ?? ''),
        String(alert.due_date ?? ''),
        String(alert.details ?? '')
    ]);
}

function getHiddenDogAlertKeys() {
    const state = readPlanDisplayFilterStates()[getPlanDisplayFilterKey()] || {};
    return new Set(Array.isArray(state.hiddenDogAlerts) ? state.hiddenDogAlerts : []);
}

function setDogAlertHidden(alertKey, hidden) {
    try {
        const allStates = readPlanDisplayFilterStates();
        const filterKey = getPlanDisplayFilterKey();
        const currentState = allStates[filterKey] || {};
        const hiddenAlerts = new Set(
            Array.isArray(currentState.hiddenDogAlerts) ? currentState.hiddenDogAlerts : []
        );

        if (hidden) hiddenAlerts.add(alertKey);
        else hiddenAlerts.delete(alertKey);

        allStates[filterKey] = {
            ...currentState,
            hiddenDogAlerts: [...hiddenAlerts]
        };
        localStorage.setItem(PLAN_DISPLAY_FILTER_STORAGE_KEY, JSON.stringify(allStates));
    } catch (error) {
        console.warn('Ausgeblendete Hundeinfos konnten nicht gespeichert werden:', error);
    }
}

function loadPlanDisplayFilterState() {
    const hideWishMarkers = document.getElementById('hide-wish-markers');
    const hideXShifts = document.getElementById('hide-x-shifts');
    if (!hideWishMarkers || !hideXShifts) return;

    const state = readPlanDisplayFilterStates()[getPlanDisplayFilterKey()] || {};
    hideWishMarkers.checked = state.hideWishMarkers === true;
    hideXShifts.checked = state.hideXShifts === true;
    applyPlanDisplayFilters();
}

function updatePlanFilterSummary() {
    const filter24er = document.getElementById('filter-24er');
    const filter12er = document.getElementById('filter-12er');
    const hideWishMarkers = document.getElementById('hide-wish-markers');
    const hideXShifts = document.getElementById('hide-x-shifts');
    const badge = document.getElementById('plan-filter-active-count');
    if (!filter24er || !filter12er || !hideWishMarkers || !hideXShifts || !badge) return;

    const changedCount = Number(!filter24er.checked)
        + Number(!filter12er.checked)
        + Number(hideWishMarkers.checked)
        + Number(hideXShifts.checked);

    badge.textContent = String(changedCount);
    badge.style.display = changedCount > 0 ? 'inline-flex' : 'none';
}

function initializePlanFilterMenu() {
    const container = document.getElementById('shift-filter-container');
    const button = document.getElementById('plan-filter-menu-button');
    const menu = document.getElementById('plan-filter-menu');
    if (!container || !button || !menu) return;

    const closeMenu = () => {
        menu.classList.remove('open');
        button.setAttribute('aria-expanded', 'false');
    };

    button.addEventListener('click', event => {
        event.stopPropagation();
        const shouldOpen = !menu.classList.contains('open');
        menu.classList.toggle('open', shouldOpen);
        button.setAttribute('aria-expanded', String(shouldOpen));
    });

    menu.addEventListener('click', event => event.stopPropagation());
    document.addEventListener('click', event => {
        if (!event.target.closest('#shift-filter-container')) closeMenu();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') closeMenu();
    });
}

async function saveFilterState() {
    const filter24er = document.getElementById('filter-24er');
    const filter12er = document.getElementById('filter-12er');
    
    // Nur Admins dürfen den Server-Status der Filter überschreiben!
    if (!filter24er || !filter12er || !PlanState.isAdmin) return;
    
    const show24 = filter24er.checked;
    const show12 = filter12er.checked;

    // Lokalen Zustand sofort updaten, damit es keine Verzögerungen gibt
    if (PlanState.currentPlanStatus) {
        PlanState.currentPlanStatus.show_24er = show24;
        PlanState.currentPlanStatus.show_12er = show12;
    }

    // Die Änderung im Hintergrund an unseren neuen API-Endpunkt senden
    try {
        await apiFetch('/api/variants/filters', 'PUT', {
            year: PlanState.currentYear,
            month: PlanState.currentMonth,
            variant_id: PlanState.currentVariantId,
            show_12er: show12,
            show_24er: show24
        });
    } catch (error) {
        console.error("Fehler beim Speichern der Filter auf dem Server:", error);
    }
}

function loadFilterState() {
    const filter24er = document.getElementById('filter-24er');
    const filter12er = document.getElementById('filter-12er');
    if (!filter24er || !filter12er) return;

    // Werte kommen jetzt direkt vom Backend (ShiftPlanStatus oder PlanVariant)
    if (PlanState.currentPlanStatus) {
        // Falls der Server aus irgendeinem Grund nichts liefert, nimm True als Standard
        filter24er.checked = PlanState.currentPlanStatus.show_24er !== false;
        filter12er.checked = PlanState.currentPlanStatus.show_12er !== false;
    } else {
        filter24er.checked = true;
        filter12er.checked = true;
    }

    loadPlanDisplayFilterState();
    updatePlanFilterSummary();
}

function applyStaffingFilters() {
    const filter24er = document.getElementById('filter-24er');
    const filter12er = document.getElementById('filter-12er');

    if (!filter24er || !filter12er) return;

    const show24 = filter24er.checked;
    const show12 = filter12er.checked;

    const staffingRows = document.querySelectorAll('#staffing-grid .staffing-row');
    
    staffingRows.forEach(row => {
        const labelEl = row.querySelector('.staffing-label');
        if (labelEl) {
            const text = labelEl.textContent.trim().toLowerCase();
            
            if (text.includes('gesamt') || text === '') {
                row.style.display = '';
                return;
            }
            
            const is24er = text.includes('24');
            const is12er = !is24er; 
            
            if (is24er) {
                row.style.display = show24 ? '' : 'none';
            } else if (is12er) {
                row.style.display = show12 ? '' : 'none';
            }
        }
    });
}

function handleFilterChange() {
    applyStaffingFilters(); // UI sofort umbauen, damit es flüssig wirkt
    saveFilterState();      // Daten asynchron an den Server senden
    updatePlanFilterSummary();
}

// Reine Darstellungsfilter für eine aufgeräumte Druckansicht. Sie verändern
// weder Schichten noch Wunschdaten und werden daher nicht auf dem Server
// gespeichert.
function applyPlanDisplayFilters() {
    const hideWishMarkers = document.getElementById('hide-wish-markers');
    const hideXShifts = document.getElementById('hide-x-shifts');

    document.body.classList.toggle(
        'hide-wish-markers',
        Boolean(hideWishMarkers && hideWishMarkers.checked)
    );
    document.body.classList.toggle(
        'hide-x-shifts',
        Boolean(hideXShifts && hideXShifts.checked)
    );
}

function handlePlanDisplayFilterChange() {
    applyPlanDisplayFilters();
    savePlanDisplayFilterState();
    updatePlanFilterSummary();
}

function initializeResponsivePlanResize() {
    let lastWidth = window.innerWidth;
    let lastCompactState = window.matchMedia(
        '(orientation: landscape) and (max-height: 650px) and (pointer: coarse) and (hover: none)'
    ).matches;
    let resizeTimer = null;

    window.addEventListener('resize', () => {
        const compactState = window.matchMedia(
            '(orientation: landscape) and (max-height: 650px) and (pointer: coarse) and (hover: none)'
        ).matches;
        const widthChanged = Math.abs(window.innerWidth - lastWidth) >= 40;
        const modeChanged = compactState !== lastCompactState;

        // Änderungen durch ein- und ausblendende Browserleisten auf dem Handy
        // lösen keinen kompletten Neuaufbau des Plans aus.
        if (!widthChanged && !modeChanged) return;

        lastWidth = window.innerWidth;
        lastCompactState = compactState;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (PlanState.allUsers.length > 0) renderGrid(true);
        }, 180);
    });
}
// --------------------------------------------------------------------------------


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

        initImpersonation();

        // Initiale State-Werte
        PlanState.currentVariantId = null;
        PlanState.variants = [];
        PlanState.generatorConfig = {};

        // Feature-Inits (Unabhängige Module)
        PredictionUI.init();
        initPetDisplay(PlanState.loggedInUser);

        // --- Market Module initialisieren (Inject Modal) ---
        MarketModule.init();

        // 3. MODULE INITIALISIEREN & VERKNÜPFEN
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

        // Staffing Module Init (Verknüpft den Button)
        StaffingModule.init();

        // Socket: Echtzeit-Updates
        PlanSocket.init(
            renderGrid,
            PlanUIHelper.updatePlanStatusUI.bind(PlanUIHelper)
        );
        initializeResponsivePlanResize();

        // --- NEU: Admin-Prüfung für Filter-Container ---
        const filterContainer = document.getElementById('shift-filter-container');
        if (filterContainer) {
            if (!PlanState.isAdmin) {
                // Verstecke die Checkboxen für alle Nicht-Admins
                filterContainer.style.display = 'none';
                
                // Zwingendes Ausblenden via CSS Injection als Failsafe
                const style = document.createElement('style');
                style.innerHTML = '#shift-filter-container { display: none !important; }';
                document.head.appendChild(style);
            } else {
                filterContainer.style.display = 'flex';
            }
        }

        const filter24er = document.getElementById('filter-24er');
        const filter12er = document.getElementById('filter-12er');
        if(filter24er) filter24er.addEventListener('change', handleFilterChange);
        if(filter12er) filter12er.addEventListener('change', handleFilterChange);

        const hideWishMarkers = document.getElementById('hide-wish-markers');
        const hideXShifts = document.getElementById('hide-x-shifts');
        if (hideWishMarkers) hideWishMarkers.addEventListener('change', handlePlanDisplayFilterChange);
        if (hideXShifts) hideXShifts.addEventListener('change', handlePlanDisplayFilterChange);
        initializePlanFilterMenu();


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
 * @param {boolean} isSilent - Wenn true, wird kein Lade-Blur angezeigt (für Live-Updates).
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
        const [shiftPayload, specialDatesResult, queriesResult, marketOffersResult, pendingRequestsResult, dogDuesResult] = await Promise.all([
            // 1. Schichten & Status
            PlanApi.fetchShiftData(PlanState.currentYear, PlanState.currentMonth, PlanState.currentVariantId),
            // 2. Feiertage
            PlanApi.fetchSpecialDates(PlanState.currentYear, 'holiday'),
            // 3. Queries (Text-Notizen & Wünsche)
            (PlanState.isAdmin || PlanState.isPlanschreiber || PlanState.isHundefuehrer)
                ? PlanApi.fetchOpenQueries(PlanState.currentYear, PlanState.currentMonth)
                : Promise.resolve([]),
            // 4. Marktplatz Angebote (Inkl. my_response_id)
            (PlanState.isAdmin || PlanState.isHundefuehrer)
                ? PlanApi.fetchMarketOffers()
                : Promise.resolve([]),
            // 5. Change Requests (Legacy Anträge)
            (PlanState.isAdmin || PlanState.isPlanschreiber || PlanState.isHundefuehrer)
                ? PlanApi.fetchPendingShiftChangeRequests()
                : Promise.resolve([]),
            // 6. Diensthund-Warnungen (Fälligkeiten)
            (PlanState.isAdmin || PlanState.isHundefuehrer)
                ? apiFetch('/api/dogs/upcoming_dues').catch(() => [])
                : Promise.resolve([])
        ]);

        // --- STATE UPDATE ---

        // Users & Shifts ins State-Objekt mappen
        PlanState.allUsers = shiftPayload.users;
        PlanState.approvedWishes = shiftPayload.approved_wishes || {};
        PlanState.currentShifts = {};
        shiftPayload.shifts.forEach(s => {
            const key = `${s.user_id}-${s.date}`;
            const fullShiftType = PlanState.allShiftTypes[s.shifttype_id];
            PlanState.currentShifts[key] = { ...s, shift_type: fullShiftType };
        });

        // Last Month
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

        // --- MARKET OFFERS & GHOST LOGIC ---
        PlanState.currentMarketOffers = {};
        PlanState.marketTimerTargets = {};
        PlanState.marketTimerSources = {};

        if (marketOffersResult && Array.isArray(marketOffersResult)) {
            marketOffersResult.forEach(offer => {
                const d = offer.shift_date.includes('T') ? offer.shift_date.split('T')[0] : offer.shift_date;
                const key = `${offer.offering_user_id}-${d}`;

                // Das gesamte Offer-Objekt im State speichern
                PlanState.currentMarketOffers[key] = offer;

                // Ghost Logic (Visualisierung laufender Tausche)
                if (offer.leading_candidate_id) {
                    // 1. Empfänger-Perspektive (Interessent)
                    const receiverKey = `${offer.leading_candidate_id}-${d}`;
                    PlanState.marketTimerTargets[receiverKey] = {
                        abbr: offer.shift_type_abbr,
                        from: offer.offering_user_name,
                        response_id: offer.my_response_id || null
                    };

                    // 2. Sender-Perspektive (Anbieter)
                    const senderKey = `${offer.offering_user_id}-${d}`;
                    const candidateUser = PlanState.allUsers.find(u => u.id === offer.leading_candidate_id);
                    const candidateName = candidateUser ? `${candidateUser.vorname} ${candidateUser.name}` : "Unbekannt";

                    PlanState.marketTimerSources[senderKey] = {
                        to: candidateName,
                        offer_id: offer.id
                    };
                }
            });
        }

        // Change Requests (Pending)
        PlanState.currentChangeRequests = pendingRequestsResult || [];

        // Staffing (Ist-Zustand) & Plan-Status
        PlanState.currentStaffingActual = shiftPayload.staffing_actual || {};
        PlanState.currentPlanStatus = shiftPayload.plan_status || {
            year: PlanState.currentYear, month: PlanState.currentMonth,
            status: "In Bearbeitung", is_locked: false, plan_name: "Hauptplan"
        };

        // --- NEU: Hauptplan-Namen cachen ---
        if (PlanState.currentVariantId === null) {
            PlanState.mainPlanName = PlanState.currentPlanStatus.plan_name || "Hauptplan";
        }
        // -----------------------------------

        // Trainings-Warnungen
        PlanState.trainingWarnings = shiftPayload.training_warnings || [];

        // Special Dates
        PlanState.currentSpecialDates = {};
        await loadFullSpecialDates();

        // Queries
        PlanState.currentShiftQueries = queriesResult;

        // --- UI UPDATES ---

        // 1. Status Bar aktualisieren
        PlanUIHelper.updatePlanStatusUI(PlanState.currentPlanStatus);

        // 1.5 Tabs neu zeichnen (wegen eventuell neu geladener Namen)
        PlanNavigation.renderVariantTabs();

        // 2. Grid DOM bauen
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
        
        // --- Den Filter aus dem Cache (passend zur Variante) laden und anwenden ---
        loadFilterState();
        applyStaffingFilters();

        // 4. Highlight
        if(PlanState.pendingHighlight) {
            const h = PlanState.pendingHighlight;
            setTimeout(() => {
                PlanRenderer.highlightCells(h.date, h.targetUserId);
                PlanState.pendingHighlight = null;
            }, 100);
        }

        // 5. Banner & Visuals
        PlanBanner.renderUnifiedBanner();
        PlanBanner.markPendingTakeovers();

        // 6. Market Badge im Header updaten
        const badge = document.getElementById('market-badge');
        if (badge) {
             const count = Object.keys(PlanState.currentMarketOffers).length;
             badge.textContent = count;
             badge.style.display = count > 0 ? 'inline-block' : 'none';
        }

        // 7. Diensthund-Warnungen (Fälligkeiten) rendern
        renderDogAlerts(dogDuesResult);

    } catch (error) {
        if(grid) grid.innerHTML = `<div style="padding: 20px; text-align: center; color: #e74c3c;">Fehler beim Laden des Plans: ${error.message}</div>`;
        console.error("RenderGrid Error:", error);
    } finally {
        if(grid) grid.classList.remove('blur-loading');
        if(staffingGrid) staffingGrid.classList.remove('blur-loading');
    }
}

// --- DIENSTHUND WARNUNGEN RENDERN ---
function renderDogAlerts(alerts) {
    const container = document.getElementById('dog-alerts-container');
    if (!container) return;
    
    container.innerHTML = '';
    container.classList.remove('all-dog-alerts-hidden');
    
    if (!alerts || alerts.length === 0) return;

    const hiddenAlertKeys = getHiddenDogAlertKeys();
    container.classList.toggle(
        'all-dog-alerts-hidden',
        alerts.every(alert => hiddenAlertKeys.has(getDogAlertStorageKey(alert)))
    );
    const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);

    alerts.forEach(alert => {
        const dueObj = new Date(alert.due_date);
        const dueStr = dueObj.toLocaleDateString('de-DE');
        const alertKey = getDogAlertStorageKey(alert);
        const isHidden = hiddenAlertKeys.has(alertKey);
        
        const isOverdue = alert.days_left < 0;
        const isToday = alert.days_left === 0;

        let statusText = `Fällig in ${alert.days_left} Tagen`;
        let bgColor = 'linear-gradient(135deg, #f39c12, #e67e22)'; // Orange
        let icon = 'fa-exclamation-triangle';

        if (isOverdue) {
            statusText = `Seit ${Math.abs(alert.days_left)} Tagen überfällig!`;
            bgColor = 'linear-gradient(135deg, #e74c3c, #c0392b)'; // Rot
            icon = 'fa-skull-crossbones';
        } else if (isToday) {
            statusText = `Heute fällig!`;
            bgColor = 'linear-gradient(135deg, #e74c3c, #c0392b)'; // Rot
            icon = 'fa-exclamation-circle';
        }

        let typeDisplay = alert.event_type;
        if (alert.details && alert.details.trim() !== '') {
            let cleanDetail = alert.details.replace('Präparat: ', '').replace('Grund: ', '').trim();
            if (cleanDetail.length > 30) cleanDetail = cleanDetail.substring(0, 30) + '...';
            typeDisplay += ` (${cleanDetail})`;
        }

        const banner = document.createElement('div');
        banner.className = 'dog-alert-banner';

        if (isHidden) {
            banner.classList.add('dog-alert-banner-collapsed');
            banner.innerHTML = `
                <div class="alert-actions">
                    <button type="button" class="alert-action alert-show-action">
                        <i class="fas fa-eye"></i> Wieder einblenden
                    </button>
                </div>
            `;

            banner.querySelector('.alert-show-action').addEventListener('click', () => {
                setDogAlertHidden(alertKey, false);
                renderDogAlerts(alerts);
            });
        } else {
            banner.style.background = bgColor;
            banner.innerHTML = `
                <i class="fas ${icon}"></i>
                <div class="alert-content">
                    <span style="font-size: 16px;"><strong>${escapeHTML(alert.dog_name)}:</strong> ${escapeHTML(typeDisplay)} - ${escapeHTML(dueStr)}</span><br>
                    <small style="opacity: 0.9;">${escapeHTML(statusText)}</small>
                </div>
                <div class="alert-actions">
                    <button type="button" class="alert-action alert-hide-action">
                        <i class="fas fa-eye-slash"></i> Ausblenden
                    </button>
                    <button type="button" class="alert-action alert-open-action">Akte öffnen &raquo;</button>
                </div>
            `;

            banner.querySelector('.alert-hide-action').addEventListener('click', () => {
                setDogAlertHidden(alertKey, true);
                renderDogAlerts(alerts);
            });
            banner.querySelector('.alert-open-action').addEventListener('click', () => {
                window.location.href = `dogs.html?open_dog=${alert.dog_id}&tab=akte`;
            });
        }
        
        container.appendChild(banner);
    });
}


// --- 3. HELPER FUNCTIONS ---

async function loadFullSpecialDates() {
    try {
        const year = PlanState.currentYear;
        const [holidays, training, shooting, dpo] = await Promise.all([
            PlanApi.fetchSpecialDates(year, 'holiday'),
            PlanApi.fetchSpecialDates(year, 'training'),
            PlanApi.fetchSpecialDates(year, 'shooting'),
            PlanApi.fetchSpecialDates(year, 'dpo')
        ]);

        training.forEach(d => { if(d.date) PlanState.currentSpecialDates[d.date] = d.type; });
        shooting.forEach(d => { if(d.date) PlanState.currentSpecialDates[d.date] = d.type; });
        holidays.forEach(d => { if(d.date) PlanState.currentSpecialDates[d.date] = 'holiday'; });
        dpo.forEach(d => { if(d.date) PlanState.currentSpecialDates[d.date] = 'dpo'; });
    } catch (e) {
        console.warn("Fehler beim Laden der Sondertermine", e);
    }
}

async function loadColorSettings() {
    let fetchedColors = { ...DEFAULT_COLORS };
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

window.addEventListener('keydown', (e) => PlanHandlers.handleKeyboardShortcut(e));

window.addEventListener('click', (e) => {
    const overlayModals = [
        document.getElementById('shift-modal'),
        document.getElementById('query-modal'),
        document.getElementById('generator-modal'),
        document.getElementById('gen-settings-modal'),
        document.getElementById('variant-modal'),
        document.getElementById('plan-market-response-modal')
    ];

    overlayModals.forEach(m => {
        if(m && e.target === m) m.style.display = 'none';
    });

    const clickActionModal = document.getElementById('click-action-modal');
    if (clickActionModal && clickActionModal.style.display === 'block') {
        if (!clickActionModal.contains(e.target) && !e.target.closest('.grid-cell')) {
            clickActionModal.style.display = 'none';
        }
    }
});

// App Start
initialize();
