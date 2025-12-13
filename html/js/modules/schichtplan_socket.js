// html/js/modules/schichtplan_socket.js

import { PlanState } from './schichtplan_state.js';

/**
 * Modul für Echtzeit-Updates via Socket.IO.
 */
export const PlanSocket = {

    socket: null,
    renderGrid: null,
    updateStatusUI: null,

    /**
     * Initialisiert die Socket-Verbindung.
     * @param {Function} renderGridFn - Callback zum Aktualisieren des Grids.
     * @param {Function} updateStatusUIFn - Callback zum Aktualisieren der Status-Leiste.
     */
    init(renderGridFn, updateStatusUIFn) {
        this.renderGrid = renderGridFn;
        this.updateStatusUI = updateStatusUIFn;
        this.setupConnection();
    },

    setupConnection() {
        if (typeof io === 'undefined') {
            console.warn("Socket.IO client library not loaded.");
            return;
        }

        // Verbindung zum Server herstellen
        this.socket = io();

        this.socket.on('connect', () => {
            console.log("WebSocket verbunden: Echtzeit-Updates aktiv.");
        });

        // Event: Eine einzelne Schicht wurde geändert
        this.socket.on('shift_update', (data) => {
            if (this._isUpdateRelevant(data)) {
                // isSilent = true -> Kein Blur-Effekt, "Magic Update"
                if (this.renderGrid) this.renderGrid(true);
            }
        });

        // Event: Schicht gesperrt/entsperrt
        this.socket.on('shift_lock_update', (data) => {
            if (this._isUpdateRelevant(data)) {
                if (this.renderGrid) this.renderGrid(true);
            }
        });

        // Event: Plan wurde geleert
        this.socket.on('plan_cleared', (data) => {
            if (data.year === PlanState.currentYear &&
                data.month === PlanState.currentMonth &&
                data.variant_id === PlanState.currentVariantId) {
                // Hier mit Blur, da große Änderung
                if (this.renderGrid) this.renderGrid(false);
            }
        });

        // Event: Plan Status geändert (Gesperrt/Freigabe)
        this.socket.on('plan_status_update', (data) => {
            if (data.year === PlanState.currentYear && data.month === PlanState.currentMonth) {
                PlanState.currentPlanStatus = data;

                if (this.updateStatusUI) this.updateStatusUI(data);

                // Gitter neu laden, um Sperr-Optik zu aktualisieren (Silent)
                if (this.renderGrid) this.renderGrid(true);
            }
        });
    },

    /**
     * Prüft, ob ein eingehendes Event für die aktuelle Ansicht relevant ist.
     */
    _isUpdateRelevant(data) {
        // Prüfen, ob das Update den aktuell angezeigten Monat betrifft
        if (!data.date) return false;

        // Datum parsen (Format YYYY-MM-DD)
        const parts = data.date.split('-');
        const year = parseInt(parts[0]);
        const month = parseInt(parts[1]);

        // Relevanz prüfen: Gleiches Jahr, gleicher Monat, gleiche Variante
        // Hinweis: data.variant_id kann null sein, PlanState.currentVariantId auch
        const variantMatch = data.variant_id === PlanState.currentVariantId;

        return year === PlanState.currentYear && month === PlanState.currentMonth && variantMatch;
    }
};