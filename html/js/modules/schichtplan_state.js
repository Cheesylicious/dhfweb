// html/js/modules/schichtplan_state.js

import { COL_WIDTH_NAME, COL_WIDTH_DETAILS } from '../utils/constants.js';

/**
 * Zentraler Speicher für den Zustand des Schichtplans.
 * Dient als "Single Source of Truth" für alle Module.
 */
export const PlanState = {
    // Auth & User
    loggedInUser: null,
    isAdmin: false,
    isVisitor: false,
    isPlanschreiber: false,
    isHundefuehrer: false,

    // Datum & Kalender
    currentDate: new Date(),
    currentYear: new Date().getFullYear(),
    currentMonth: new Date().getMonth() + 1,

    // Daten-Cache
    allUsers: [],
    allShiftTypes: {}, // Map: ID -> Object
    allShiftTypesList: [], // Array
    currentShifts: {}, // Key: "userId-dateStr" -> Shift Object
    currentShiftsLastMonth: {},
    currentTotals: {}, // Key: userId -> Float
    currentViolations: new Set(), // Set of "userId-day" strings
    currentSpecialDates: {}, // Key: dateStr -> Type
    currentStaffingActual: {}, // Nested Object
    currentPlanStatus: {}, // {status, is_locked, ...}

    // Anfragen & Anträge
    currentShiftQueries: [], // Array of query objects (Text-Notizen)
    currentChangeRequests: [], // NEU: Array of change requests (Krank/Tausch)

    // Marktplatz Angebote Cache
    // Key: "userId-dateStr" (z.B. "5-2025-01-12") -> Offer Object
    currentMarketOffers: {},

    // Timer Targets für Ghost Animation (EMPFÄNGER)
    // Key: "RECEIVER_ID-DATE" -> { abbr: "T.", from: "Max Mustermann" }
    marketTimerTargets: {},

    // NEU: Timer Sources für Ghost Animation (SENDER)
    // Key: "GIVER_ID-DATE" -> { to: "Erika Musterfrau" }
    marketTimerSources: {},

    // Einstellungen
    colorSettings: {},
    shortcutMap: {},

    // UI Layout & Interaktion
    computedColWidthName: COL_WIDTH_NAME,
    computedColWidthDetails: COL_WIDTH_DETAILS,
    hoveredCellContext: null, // {userId, dateStr, cellElement}

    // Modal Kontexte
    modalContext: { userId: null, dateStr: null },
    modalQueryContext: { userId: null, dateStr: null, userName: null, queryId: null },
    clickModalContext: null,

    // UI Modi
    isStaffingSortingMode: false,
    sortableStaffingInstance: null,

    // Generator Status
    generatorInterval: null,
    isGenerating: false,

    // Bulk Mode
    isBulkMode: false,
    selectedQueryIds: new Set()
};

export function resetTemporaryState() {
    PlanState.hoveredCellContext = null;
    PlanState.clickModalContext = null;
    PlanState.selectedQueryIds.clear();
}