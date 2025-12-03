// html/js/modules/schichtplan_handlers.js

import { PlanState } from './schichtplan_state.js';
import { PlanApi } from './schichtplan_api.js';
import { PlanRenderer } from './schichtplan_renderer.js';
import { StaffingModule } from './schichtplan_staffing.js';
import { triggerNotificationUpdate, isWunschAnfrage } from '../utils/helpers.js';

/**
 * Handlers-Modul: Verarbeitet Benutzerinteraktionen (Klicks, Shortcuts, Formulare).
 * Führt API-Calls aus und aktualisiert den State/View optimiert (ohne unnötige Reloads).
 */
export const PlanHandlers = {

    // Wird von der Hauptdatei gesetzt, um bei großen Änderungen (Monatswechsel) neu zu laden
    reloadGridCallback: null,

    init(reloadCallback) {
        this.reloadGridCallback = reloadCallback;
    },

    // --- NAVIGATION ---

    async handleMonthChange(delta) {
        PlanState.currentMonth += delta;
        if (PlanState.currentMonth < 1) {
            PlanState.currentMonth = 12;
            PlanState.currentYear--;
        } else if (PlanState.currentMonth > 12) {
            PlanState.currentMonth = 1;
            PlanState.currentYear++;
        }

        // Bei Monatswechsel wird Variante resetet (da Varianten monatsspezifisch sind)
        PlanState.currentVariantId = null;

        // Callback aufrufen (kompletter Reload nötig)
        if (this.reloadGridCallback) this.reloadGridCallback();
    },

    async handleYearMonthSelect(year, month) {
        PlanState.currentYear = year;
        PlanState.currentMonth = month;
        PlanState.currentVariantId = null; // Reset Variante
        if (this.reloadGridCallback) this.reloadGridCallback();
    },

    // --- SCHICHTEN SPEICHERN (ADMIN) ---

    async saveShift(shifttypeId, userId, dateStr, closeModalsFn) {
        if (!PlanState.isAdmin) return;

        // Sperr-Prüfung: Gilt nur für Hauptplan (variantId === null)
        if (PlanState.currentVariantId === null && PlanState.currentPlanStatus.is_locked) {
            alert(`Aktion blockiert: Der Schichtplan für ${PlanState.currentMonth}/${PlanState.currentYear} ist gesperrt.`);
            return;
        }

        const key = `${userId}-${dateStr}`;
        const cell = PlanRenderer.findCellByKey(key);
        if (cell) cell.textContent = '...'; // Visuelles Feedback

        try {
            // Payload mit variant_id
            const payload = {
                user_id: userId,
                date: dateStr,
                shifttype_id: shifttypeId
            };
            if (PlanState.currentVariantId !== null) {
                payload.variant_id = PlanState.currentVariantId;
            }

            const savedData = await PlanApi.saveShift(payload);

            if (closeModalsFn) closeModalsFn();

            // State Update
            const shiftType = PlanState.allShiftTypes[savedData.shifttype_id];
            const shiftWasDeleted = savedData.message && (savedData.message.includes("gelöscht") || savedData.message.includes("bereits Frei"));

            if (shiftWasDeleted) {
                PlanState.currentShifts[key] = null;
            } else if (shiftType) {
                PlanState.currentShifts[key] = { ...savedData, shift_type: shiftType };
            } else {
                PlanState.currentShifts[key] = savedData;
            }

            // OPTIMIZED UPDATE (Regel 2: Keine Wartezeit / Reload)

            // 1. Zelle neu zeichnen
            PlanRenderer.refreshSingleCell(userId, dateStr);

            // 2. Violations aktualisieren
            PlanState.currentViolations.clear();
            if (savedData.violations) {
                savedData.violations.forEach(v => PlanState.currentViolations.add(`${v[0]}-${v[1]}`));
            }

            // 3. Besetzung (Staffing) aktualisieren
            PlanState.currentStaffingActual = savedData.staffing_actual || {};
            StaffingModule.refreshStaffingGrid();

            // 4. Stunden aktualisieren
            if (savedData.new_total_hours !== undefined) {
                const oldTotal = PlanState.currentTotals[userId] || 0;
                const diff = savedData.new_total_hours - oldTotal;
                PlanRenderer.updateUserTotalHours(userId, diff);
            }

            // Anfragen neu laden (Status könnte sich geändert haben)
            const queries = await PlanApi.fetchOpenQueries(PlanState.currentYear, PlanState.currentMonth);
            PlanState.currentShiftQueries = queries;
            PlanRenderer.refreshSingleCell(userId, dateStr);

        } catch (error) {
            if (cell) cell.textContent = 'Err';
            alert(`Fehler beim Speichern: ${error.message}`);
        }
    },

    async toggleShiftLock(userId, dateStr) {
        if (!PlanState.isAdmin) return;

        // Sperre nur relevant für Hauptplan
        if (PlanState.currentVariantId === null && PlanState.currentPlanStatus.is_locked) {
            alert("Globaler Plan ist gesperrt.");
            return;
        }

        try {
            // variantId übergeben
            const response = await PlanApi.toggleShiftLock(userId, dateStr, PlanState.currentVariantId);
            const key = `${userId}-${dateStr}`;

            if (response.deleted) {
                PlanState.currentShifts[key] = null;
            } else {
                const shiftType = response.shifttype_id ? PlanState.allShiftTypes[response.shifttype_id] : null;
                PlanState.currentShifts[key] = { ...response, shift_type: shiftType };
            }
            PlanRenderer.refreshSingleCell(userId, dateStr);

        } catch (e) {
            console.error(e);
            alert("Fehler beim Sperren: " + e.message);
        }
    },

    // --- ANFRAGEN (USER / ADMIN) ---

    async requestShift(shiftAbbrev, userId, dateStr) {
        if (PlanState.isVisitor) return;
        // Sperre gilt global
        if (PlanState.currentPlanStatus.is_locked) {
             // Optional: Allow request even if locked? Usually not.
             return;
        }

        try {
            await PlanApi.createQuery({
                target_user_id: userId,
                shift_date: dateStr,
                message: `Anfrage für: ${shiftAbbrev}`
            });

            // 1. Daten aktualisieren
            const queries = await PlanApi.fetchOpenQueries(PlanState.currentYear, PlanState.currentMonth);
            PlanState.currentShiftQueries = queries;

            // 2. Zelle aktualisieren
            PlanRenderer.refreshSingleCell(userId, dateStr);

            // 3. Optimistic Update für Stunden & Staffing
            const cleanAbbrev = shiftAbbrev.replace('?', '');
            const shiftType = PlanState.allShiftTypesList.find(st => st.abbreviation === cleanAbbrev);
            if (shiftType) {
                PlanRenderer.updateUserTotalHours(userId, shiftType.hours);
                StaffingModule.updateLocalStaffing(shiftAbbrev, dateStr, 1);
                StaffingModule.refreshStaffingGrid();
            }

            triggerNotificationUpdate();

        } catch (e) {
            alert(`Fehler bei Anfrage: ${e.message}`);
        }
    },

    async saveShiftQuery(message, closeModalsFn) {
        // Kontext aus PlanState nutzen
        const { userId, dateStr } = PlanState.modalQueryContext;

        // Ziel bestimmen
        let targetUserId = null;
        if (PlanState.isHundefuehrer && !PlanState.isAdmin && !PlanState.isPlanschreiber) {
            targetUserId = userId; // HF immer für sich selbst
        } else {
            // Radio Button Logik prüfen (falls vorhanden) oder Default 'user'
            const selectedTypeEl = document.querySelector('input[name="query-target-type"]:checked');
            const selectedType = selectedTypeEl ? selectedTypeEl.value : 'user';
            targetUserId = selectedType === 'user' ? userId : null;
        }

        try {
            await PlanApi.createQuery({
                target_user_id: targetUserId,
                shift_date: dateStr,
                message: message
            });

            const queries = await PlanApi.fetchOpenQueries(PlanState.currentYear, PlanState.currentMonth);
            PlanState.currentShiftQueries = queries;

            if (targetUserId) PlanRenderer.refreshSingleCell(targetUserId, dateStr);
            triggerNotificationUpdate();

            if(closeModalsFn) closeModalsFn();

        } catch (e) {
            throw e; // Fehler weitergeben an UI
        }
    },

    async deleteShiftQuery(queryId, closeModalsFn) {
        if (!queryId) return;

        // Kontext für Optimistic Update sichern
        const queryToDelete = PlanState.currentShiftQueries.find(q => q.id == queryId);

        try {
            await PlanApi.deleteQuery(queryId);

            // Daten neu laden
            const queries = await PlanApi.fetchOpenQueries(PlanState.currentYear, PlanState.currentMonth);
            PlanState.currentShiftQueries = queries;

            // Zelle & Stats updaten
            if (queryToDelete) {
                if (queryToDelete.target_user_id) {
                    PlanRenderer.refreshSingleCell(queryToDelete.target_user_id, queryToDelete.shift_date);

                    // Stunden abziehen falls Wunsch
                    if (queryToDelete.message.startsWith("Anfrage für:")) {
                        const abbr = queryToDelete.message.substring("Anfrage für:".length).trim().replace('?', '');
                        const st = PlanState.allShiftTypesList.find(s => s.abbreviation === abbr);
                        if (st) {
                            PlanRenderer.updateUserTotalHours(queryToDelete.target_user_id, -st.hours);
                            StaffingModule.updateLocalStaffing(abbr, queryToDelete.shift_date, -1);
                            StaffingModule.refreshStaffingGrid();
                        }
                    }
                }
            }

            triggerNotificationUpdate();
            if(closeModalsFn) closeModalsFn();

        } catch (e) {
            alert(`Fehler beim Löschen: ${e.message}`);
        }
    },

    async resolveShiftQuery(queryId, closeModalsFn) {
        try {
            await PlanApi.updateQueryStatus(queryId, 'erledigt');

            const queries = await PlanApi.fetchOpenQueries(PlanState.currentYear, PlanState.currentMonth);
            PlanState.currentShiftQueries = queries;

            if (PlanState.modalQueryContext && PlanState.modalQueryContext.userId) {
                PlanRenderer.refreshSingleCell(PlanState.modalQueryContext.userId, PlanState.modalQueryContext.dateStr);
            }

            triggerNotificationUpdate();
            if(closeModalsFn) closeModalsFn();

        } catch (e) {
            alert(`Fehler beim Status-Update: ${e.message}`);
        }
    },

    // --- SHORTCUTS ---

    handleKeyboardShortcut(event) {
        if (!PlanState.isAdmin) return;
        // Sperre nur für Hauptplan
        if (PlanState.currentVariantId === null && PlanState.currentPlanStatus.is_locked) return;

        if (!PlanState.hoveredCellContext || !PlanState.hoveredCellContext.userId) return;

        // Modals offen?
        if (document.querySelector('.modal[style*="block"]')) return;

        // Space = Toggle Lock
        if (event.code === 'Space') {
            event.preventDefault();
            this.toggleShiftLock(PlanState.hoveredCellContext.userId, PlanState.hoveredCellContext.dateStr);
            return;
        }

        const key = event.key.toLowerCase();
        const abbrev = PlanState.shortcutMap[key];

        if (abbrev !== undefined) {
            event.preventDefault();
            const shiftType = Object.values(PlanState.allShiftTypes).find(st => st.abbreviation === abbrev);
            if (shiftType) {
                // Aufruf saveShift ohne Modal-Close-Callback
                this.saveShift(shiftType.id, PlanState.hoveredCellContext.userId, PlanState.hoveredCellContext.dateStr);
            }
        }
    },

    // --- BULK ACTIONS ---

    toggleBulkMode(btnElement, actionBarElement) {
        PlanState.isBulkMode = !PlanState.isBulkMode;

        if (PlanState.isBulkMode) {
            btnElement.classList.add('active');
            btnElement.textContent = "Modus Beenden";
            document.body.classList.add('bulk-mode-active');
            actionBarElement.classList.add('visible');
            PlanState.selectedQueryIds.clear();
        } else {
            btnElement.classList.remove('active');
            btnElement.textContent = "✅ Anfragen verwalten";
            document.body.classList.remove('bulk-mode-active');
            actionBarElement.classList.remove('visible');
            document.querySelectorAll('.grid-cell.selected').forEach(el => el.classList.remove('selected'));
            PlanState.selectedQueryIds.clear();
        }
    },

    handleBulkCellClick(cell) {
        const queryId = cell.dataset.queryId;
        if (!queryId) return;

        const id = parseInt(queryId);
        if (PlanState.selectedQueryIds.has(id)) {
            PlanState.selectedQueryIds.delete(id);
            cell.classList.remove('selected');
        } else {
            PlanState.selectedQueryIds.add(id);
            cell.classList.add('selected');
        }
    },

    async performPlanBulkAction(actionType, onCompleteFn) {
        if (PlanState.selectedQueryIds.size === 0) return;

        const actionName = actionType === 'approve' ? 'Genehmigen' : 'Ablehnen';
        if (!confirm(`${PlanState.selectedQueryIds.size} Anfragen ${actionName}?`)) return;

        try {
            const ids = Array.from(PlanState.selectedQueryIds);
            let response;
            if (actionType === 'approve') {
                response = await PlanApi.bulkApproveQueries(ids);
            } else {
                response = await PlanApi.bulkDeleteQueries(ids);
            }

            alert(response.message);

            // Reload ist hier sicherer, da viele Änderungen
            if (this.reloadGridCallback) this.reloadGridCallback();

            triggerNotificationUpdate();
            if (onCompleteFn) onCompleteFn();

        } catch (error) {
            alert("Fehler: " + error.message);
        }
    }
};