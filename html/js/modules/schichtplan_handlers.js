// html/js/modules/schichtplan_handlers.js

import { PlanState } from './schichtplan_state.js';
import { PlanApi } from './schichtplan_api.js';
import { PlanRenderer } from './schichtplan_renderer.js';
import { StaffingModule } from './schichtplan_staffing.js';
import { ChangeRequestModule } from './schichtplan_change_request.js';
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
        // Initialisiere das Modal für Änderungsanträge
        if (ChangeRequestModule && ChangeRequestModule.initModal) {
            ChangeRequestModule.initModal();
        }
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

    // --- LOCKED PLAN INTERACTION ---

    /**
     * Versucht, einen Klick auf eine Zelle in einem gesperrten Plan zu behandeln.
     * Wird von der Haupt-Klick-Logik aufgerufen, wenn is_locked true ist.
     * @returns {boolean} true, wenn der Klick behandelt wurde (Modal geöffnet oder Alert), false wenn nicht.
     */
    handleLockedClick(userId, dateStr, userName) {
        // Prüfung: Ist der Plan wirklich gesperrt? (Nur Hauptplan)
        if (PlanState.currentVariantId === null && PlanState.currentPlanStatus.is_locked) {

            // Prüfen ob User berechtigt ist, Änderungen zu beantragen (Admin oder Planschreiber)
            const canRequestChange = PlanState.isAdmin || PlanState.isPlanschreiber;

            if (canRequestChange) {
                // Shift Daten holen
                const key = `${userId}-${dateStr}`;
                const shiftData = PlanState.currentShifts[key];

                if (shiftData && shiftData.id) {
                    // Bestehende Schicht -> Krankmeldung/Änderung beantragen
                    ChangeRequestModule.openRequestModal(shiftData.id, userName, dateStr, userId);
                    return true;
                } else {
                    // Leere Zelle -> Standard Blockade-Meldung
                    window.dhfAlert("Aktion nicht möglich", "Der Plan ist gesperrt.\nKrankmeldungen können nur für bestehende Dienste erstellt werden.", "warning");
                    return true;
                }
            } else {
                // Keine Berechtigung (normaler User)
                window.dhfAlert("Plan Gesperrt", `Der Schichtplan für ${PlanState.currentMonth}/${PlanState.currentYear} ist gesperrt.`, "error");
                return true;
            }
        }
        return false; // Plan ist nicht gesperrt, normaler Flow geht weiter
    },

    // --- SCHICHTEN SPEICHERN (ADMIN) ---

    async saveShift(shifttypeId, userId, dateStr, closeModalsFn) {
        if (!PlanState.isAdmin) return;

        // Sperr-Prüfung: Gilt nur für Hauptplan (variantId === null)
        if (PlanState.currentVariantId === null && PlanState.currentPlanStatus.is_locked) {
            window.dhfAlert("Blockiert", `Der Schichtplan für ${PlanState.currentMonth}/${PlanState.currentYear} ist gesperrt.`, "error");
            return;
        }

        const key = `${userId}-${dateStr}`;
        const cell = PlanRenderer.findCellByKey(key);
        if (cell) cell.textContent = '...'; // Visuelles Feedback

        // --- MERKEN DES ALTEN ZUSTANDS FÜR STAFFING-UPDATE ---
        const oldShiftEntry = PlanState.currentShifts[key];
        const oldShiftAbbrev = (oldShiftEntry && oldShiftEntry.shift_type) ? oldShiftEntry.shift_type.abbreviation : null;

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

            // 1. Zelle neu zeichnen (um den neuen Schichttyp anzuzeigen)
            PlanRenderer.refreshSingleCell(userId, dateStr);

            // 2. Violations aktualisieren und betroffene Zellen refreshen
            const oldViolations = new Set(PlanState.currentViolations);
            PlanState.currentViolations.clear();
            if (savedData.violations) {
                savedData.violations.forEach(v => PlanState.currentViolations.add(`${v[0]}-${v[1]}`));
            }
            const affectedCells = new Set([...oldViolations, ...PlanState.currentViolations]);

            affectedCells.forEach(violationKey => {
                const parts = violationKey.split('-');
                if(parts.length === 2) {
                    const vUserId = parseInt(parts[0]);
                    const vDay = parseInt(parts[1]);
                    // Datum String rekonstruieren
                    const year = PlanState.currentYear;
                    const month = String(PlanState.currentMonth).padStart(2, '0');
                    const day = String(vDay).padStart(2, '0');
                    const vDateStr = `${year}-${month}-${day}`;
                    PlanRenderer.refreshSingleCell(vUserId, vDateStr);
                }
            });

            // 3. Besetzung (Staffing) INTELLIGENT aktualisieren
            if (oldShiftAbbrev) {
                StaffingModule.updateLocalStaffing(oldShiftAbbrev, dateStr, -1);
            }
            if (!shiftWasDeleted && shiftType) {
                StaffingModule.updateLocalStaffing(shiftType.abbreviation, dateStr, 1);
            }
            StaffingModule.refreshStaffingGrid();

            // 4. Stunden aktualisieren
            if (savedData.new_total_hours !== undefined) {
                const oldTotal = PlanState.currentTotals[userId] || 0;
                const diff = savedData.new_total_hours - oldTotal;
                PlanRenderer.updateUserTotalHours(userId, diff);
            }

            // 5. Urlaubskontingent aktualisieren (NEU)
            // Aktualisiert den lokalen User-State sofort, damit das Modal beim nächsten Öffnen stimmt
            if (savedData.new_vacation_remaining !== undefined) {
                const user = PlanState.allUsers.find(u => u.id === userId);
                if (user) {
                    user.vacation_remaining = savedData.new_vacation_remaining;
                }
            }

            // Anfragen neu laden (Status könnte sich geändert haben)
            const queries = await PlanApi.fetchOpenQueries(PlanState.currentYear, PlanState.currentMonth);
            PlanState.currentShiftQueries = queries;
            // Letzter Refresh, falls die Zelle Anfragen betrifft
            PlanRenderer.refreshSingleCell(userId, dateStr);

        } catch (error) {
            // Bei Fehler Zustand zurücksetzen (visuell)
            PlanRenderer.refreshSingleCell(userId, dateStr);
            window.dhfAlert("Speicherfehler", error.message, "error");
        }
    },

    async toggleShiftLock(userId, dateStr) {
        if (!PlanState.isAdmin) return;

        // Sperre nur relevant für Hauptplan
        if (PlanState.currentVariantId === null && PlanState.currentPlanStatus.is_locked) {
            window.dhfAlert("Blockiert", "Globaler Plan ist gesperrt.", "error");
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
            window.dhfAlert("Fehler", e.message, "error");
        }
    },

    // --- ANFRAGEN (USER / ADMIN) ---

    async requestShift(shiftAbbrev, userId, dateStr) {
        if (PlanState.isVisitor) return;
        // Sperre gilt global
        if (PlanState.currentPlanStatus.is_locked) {
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
            window.dhfAlert("Fehler bei Anfrage", e.message, "error");
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

            // BUGFIX: Sofort-Update der Anzeige
            if (targetUserId) {
                // Einzelne Zelle aktualisieren
                PlanRenderer.refreshSingleCell(targetUserId, dateStr);
            } else {
                // "Thema des Tages": Alle sichtbaren User an diesem Tag aktualisieren
                PlanState.allUsers.forEach(user => {
                    if(user.shift_plan_visible) {
                        PlanRenderer.refreshSingleCell(user.id, dateStr);
                    }
                });
            }

            triggerNotificationUpdate();

            if(closeModalsFn) closeModalsFn();

        } catch (e) {
            throw e; // Fehler weitergeben an UI
        }
    },

    async deleteShiftQuery(queryId, closeModalsFn) {
        if (!queryId) return;

        // Kontext für Optimistic Update sichern, BEVOR gelöscht wird
        const queryToDelete = PlanState.currentShiftQueries.find(q => q.id == queryId);

        window.dhfConfirm("Löschen", "Möchten Sie diese Anfrage wirklich löschen?", async () => {
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
                    } else {
                        // BUGFIX: Wenn "Thema des Tages" (target_user_id === null) gelöscht wird -> Alles aktualisieren
                        PlanState.allUsers.forEach(user => {
                            if(user.shift_plan_visible) {
                                PlanRenderer.refreshSingleCell(user.id, queryToDelete.shift_date);
                            }
                        });
                    }
                }

                triggerNotificationUpdate();
                if(closeModalsFn) closeModalsFn();

            } catch (e) {
                window.dhfAlert("Fehler", e.message, "error");
            }
        });
    },

    async resolveShiftQuery(queryId, closeModalsFn) {
        // Query vor dem Update finden, um zu wissen, ob es "Allgemein" war
        const queryToResolve = PlanState.currentShiftQueries.find(q => q.id == queryId);

        try {
            await PlanApi.updateQueryStatus(queryId, 'erledigt');

            const queries = await PlanApi.fetchOpenQueries(PlanState.currentYear, PlanState.currentMonth);
            PlanState.currentShiftQueries = queries;

            // BUGFIX: Sofort-Update
            if (queryToResolve) {
                if (queryToResolve.target_user_id) {
                    PlanRenderer.refreshSingleCell(queryToResolve.target_user_id, queryToResolve.shift_date);
                } else {
                    // War eine allgemeine Notiz -> ganze Spalte refreshen
                    PlanState.allUsers.forEach(user => {
                        if(user.shift_plan_visible) {
                            PlanRenderer.refreshSingleCell(user.id, queryToResolve.shift_date);
                        }
                    });
                }
            } else if (PlanState.modalQueryContext && PlanState.modalQueryContext.userId) {
                // Fallback falls Query nicht im State gefunden wurde (unwahrscheinlich)
                PlanRenderer.refreshSingleCell(PlanState.modalQueryContext.userId, PlanState.modalQueryContext.dateStr);
            }

            triggerNotificationUpdate();
            if(closeModalsFn) closeModalsFn();

        } catch (e) {
            window.dhfAlert("Fehler", e.message, "error");
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

        // NEU: Custom Confirm statt nativem confirm()
        window.dhfConfirm(actionName, `${PlanState.selectedQueryIds.size} Anfragen ${actionName}?`, async () => {
            try {
                const ids = Array.from(PlanState.selectedQueryIds);
                let response;
                if (actionType === 'approve') {
                    response = await PlanApi.bulkApproveQueries(ids);
                } else {
                    response = await PlanApi.bulkDeleteQueries(ids);
                }

                window.dhfAlert("Erfolg", response.message, "success");

                // Reload ist hier sicherer, da viele Änderungen
                if (this.reloadGridCallback) this.reloadGridCallback();

                triggerNotificationUpdate();
                if (onCompleteFn) onCompleteFn();

            } catch (error) {
                window.dhfAlert("Fehler", error.message, "error");
            }
        });
    }
};