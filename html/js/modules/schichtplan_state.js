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
    currentShiftQueries: [], // Array of query objects

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

/**
 * Hilfsfunktion zum Zurücksetzen von temporären UI-Zuständen
 * (z.B. beim Monatswechsel).
 */
export function resetTemporaryState() {
    PlanState.hoveredCellContext = null;
    PlanState.clickModalContext = null;
    PlanState.selectedQueryIds.clear();
    // Bulk Mode bleibt ggf. aktiv oder wird hier deaktiviert, je nach UX-Wunsch.
    // Wir lassen isBulkMode unangetastet, damit man über Monate hinweg arbeiten kann,
    // oder setzen es zurück:
    // PlanState.isBulkMode = false;
}