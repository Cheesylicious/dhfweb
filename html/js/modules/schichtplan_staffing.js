// html/js/modules/schichtplan_staffing.js

import { PlanState } from './schichtplan_state.js';
import { PlanApi } from './schichtplan_api.js';
import { COL_WIDTH_UEBERTRAG, COL_WIDTH_DAY, COL_WIDTH_TOTAL } from '../utils/constants.js';

/**
 * Modul für die Besetzungs-Ansicht (Soll/Ist-Vergleich).
 */
export const StaffingModule = {

    /**
     * Aktualisiert die lokalen Zähler für die Besetzung (ohne Reload vom Server).
     * Wird aufgerufen, wenn eine Schicht oder Anfrage im Grid geändert wird.
     */
    updateLocalStaffing(shiftAbbrev, dateStr, delta) {
        const cleanAbbrev = shiftAbbrev.replace('?', '').trim();
        const st = PlanState.allShiftTypesList.find(s => s.abbreviation === cleanAbbrev);
        if (!st) return;

        const d = new Date(dateStr);
        const day = d.getDate();

        if (!PlanState.currentStaffingActual[st.id]) {
            PlanState.currentStaffingActual[st.id] = {};
        }
        if (!PlanState.currentStaffingActual[st.id][day]) {
            PlanState.currentStaffingActual[st.id][day] = 0;
        }

        PlanState.currentStaffingActual[st.id][day] += delta;

        if (PlanState.currentStaffingActual[st.id][day] < 0) {
            PlanState.currentStaffingActual[st.id][day] = 0;
        }
    },

    /**
     * Zeichnet die Werte in der bestehenden Besetzungs-Tabelle neu.
     * Effizienter als ein kompletter Re-Build des DOM.
     */
    refreshStaffingGrid() {
        const staffingGrid = document.getElementById('staffing-grid');
        if (!staffingGrid) return;

        const rows = staffingGrid.querySelectorAll('.staffing-row');

        rows.forEach(row => {
            const stId = parseInt(row.dataset.id);
            const shiftType = PlanState.allShiftTypes[stId];
            if (!shiftType) return;

            const cells = row.children;
            const daysInMonth = new Date(PlanState.currentYear, PlanState.currentMonth, 0).getDate();

            let totalIst = 0;
            let totalSoll = 0;

            const dayKeyMap = ['min_staff_so', 'min_staff_mo', 'min_staff_di', 'min_staff_mi', 'min_staff_do', 'min_staff_fr', 'min_staff_sa'];

            // Zellenindex beginnt bei 2 (Label + EmptyCell + UebertragSpacer) - basierend auf Original-Logik
            // Check Original: Label(0), Empty(1), EmptyUebertrag(2). Also Start bei index 3 für Tag 1.
            const startIndex = 3;

            for (let d = 1; d <= daysInMonth; d++) {
                const cellIndex = d + startIndex - 1;
                if (cellIndex >= cells.length) break;

                const cell = cells[cellIndex];

                const dateObj = new Date(PlanState.currentYear, PlanState.currentMonth - 1, d);
                const dateStr = `${PlanState.currentYear}-${String(PlanState.currentMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                const dayOfWeek = dateObj.getDay();
                const isHoliday = PlanState.currentSpecialDates[dateStr] === 'holiday';

                let soll = 0;
                if (isHoliday) soll = shiftType.min_staff_holiday || 0;
                else soll = shiftType[dayKeyMap[dayOfWeek]] || 0;

                totalSoll += soll;

                const ist = (PlanState.currentStaffingActual[stId] && PlanState.currentStaffingActual[stId][d]) || 0;
                totalIst += ist;

                // Klassen zurücksetzen und neu berechnen
                let cls = 'staffing-cell';
                if (dayOfWeek === 0 || dayOfWeek === 6) cls += ' weekend';

                if (soll === 0) {
                    cell.textContent = '';
                    cls += ' staffing-untracked';
                } else {
                    cell.textContent = ist;
                    if (ist === soll) cls += ' staffing-ok';
                    else if (ist > soll) cls += ' staffing-warning';
                    else if (ist > 0) cls += ' staffing-warning';
                    else cls += ' staffing-violation';
                }
                cell.className = cls;
            }

            const totalCell = cells[cells.length - 1];
            totalCell.textContent = totalIst;

            if (totalIst < totalSoll) totalCell.style.color = '#c00000';
            else if (totalIst > totalSoll && totalSoll > 0) totalCell.style.color = '#856404';
            else totalCell.style.color = '#333';
        });
    },

    /**
     * Baut das DOM für die Besetzungs-Tabelle komplett neu auf.
     */
    buildStaffingTable() {
        const staffingGridContainer = document.getElementById('staffing-grid-container');
        const staffingGrid = document.getElementById('staffing-grid');
        if (!staffingGridContainer || !staffingGrid) return;

        const daysInMonth = new Date(PlanState.currentYear, PlanState.currentMonth, 0).getDate();

        // Nur relevante Schichtarten anzeigen (die eine Mindestbesetzung definiert haben)
        const relevantShiftTypes = PlanState.allShiftTypesList.filter(st =>
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

        const gridTemplateColumns = `${PlanState.computedColWidthName} ${PlanState.computedColWidthDetails} ${COL_WIDTH_UEBERTRAG} repeat(${daysInMonth}, ${COL_WIDTH_DAY}) ${COL_WIDTH_TOTAL}`;

        const dayKeyMap = [
            'min_staff_so', 'min_staff_mo', 'min_staff_di', 'min_staff_mi',
            'min_staff_do', 'min_staff_fr', 'min_staff_sa'
        ];

        relevantShiftTypes.forEach(st => {
            const st_id = st.id;

            const row = document.createElement('div');
            row.className = 'staffing-row';
            row.dataset.id = st_id;
            row.style.gridTemplateColumns = gridTemplateColumns;

            // Drag-Klasse hinzufügen, wenn Sortiermodus aktiv
            if (PlanState.isStaffingSortingMode) {
                row.classList.add('sort-mode-active');
            }

            // 1. Label Zelle
            let labelCell = document.createElement('div');
            labelCell.className = 'staffing-label';

            const dragHandle = document.createElement('span');
            dragHandle.className = 'staffing-drag-handle';
            dragHandle.innerHTML = '☰';
            dragHandle.style.display = PlanState.isStaffingSortingMode ? 'inline-block' : 'none';

            labelCell.appendChild(dragHandle);

            const labelText = document.createElement('span');
            labelText.textContent = `${st.abbreviation} (${st.name})`;
            labelCell.appendChild(labelText);

            labelCell.style.fontWeight = '700';
            labelCell.style.color = '#333';
            row.appendChild(labelCell);

            // 2. Leere Zellen für Details & Übertrag (Layout-Angleichung an Hauptgrid)
            let emptyCell = document.createElement('div');
            emptyCell.className = 'staffing-cell staffing-untracked';
            row.appendChild(emptyCell);

            let emptyCellUebertrag = document.createElement('div');
            emptyCellUebertrag.className = 'staffing-cell staffing-untracked';
            emptyCellUebertrag.style.borderRight = '1px solid #ffcc99';
            row.appendChild(emptyCellUebertrag);

            let totalIst = 0;
            let totalSoll = 0;

            // 3. Tage rendern
            for (let day = 1; day <= daysInMonth; day++) {
                const dateStr = `${PlanState.currentYear}-${String(PlanState.currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const dObj = new Date(PlanState.currentYear, PlanState.currentMonth - 1, day);
                const dayOfWeek = dObj.getDay();
                const isHoliday = PlanState.currentSpecialDates[dateStr] === 'holiday';

                let sollValue = 0;
                if (isHoliday) {
                    sollValue = st.min_staff_holiday || 0;
                } else {
                    const dayKey = dayKeyMap[dayOfWeek];
                    sollValue = st[dayKey] || 0;
                }
                totalSoll += sollValue;

                const istValue = (PlanState.currentStaffingActual[st_id] && PlanState.currentStaffingActual[st_id][day] !== undefined)
                                 ? PlanState.currentStaffingActual[st_id][day]
                                 : 0;
                totalIst += istValue;

                const istCell = document.createElement('div');
                let cellClasses = 'staffing-cell';

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

            // 4. Summen Zelle
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

        // Falls Sortiermodus aktiv war (z.B. nach Reload), Sortable re-initialisieren
        if (PlanState.isAdmin && PlanState.isStaffingSortingMode) {
            this.initializeSortableStaffing();
        }
    },

    /**
     * Initialisiert die Drag & Drop Funktionalität.
     */
    initializeSortableStaffing() {
        const staffingGrid = document.getElementById('staffing-grid');
        if (!staffingGrid) return;

        if (PlanState.sortableStaffingInstance) {
            PlanState.sortableStaffingInstance.destroy();
        }

        PlanState.sortableStaffingInstance = new Sortable(staffingGrid, {
            group: 'staffing',
            handle: '.staffing-drag-handle',
            animation: 150,
            forceFallback: true,
            fallbackClass: 'sortable-fallback',
            fallbackOnBody: true,
            swapThreshold: 0.65,
            invertSwap: true,
            direction: 'vertical',

            onStart: function (evt) {
                document.body.classList.add('dragging');
                const originalRow = evt.item;
                const ghostRow = document.querySelector('.sortable-fallback');
                if (ghostRow) {
                    ghostRow.style.gridTemplateColumns = originalRow.style.gridTemplateColumns;
                    ghostRow.style.width = originalRow.offsetWidth + 'px';
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
    },

    /**
     * Schaltet den Sortiermodus für die Besetzungstabelle an/aus.
     */
    async toggleStaffingSortMode() {
        if (!PlanState.isAdmin) return;

        const toggleBtn = document.getElementById('staffing-sort-toggle');

        if (PlanState.isStaffingSortingMode) {
            // Speichern
            const success = await this._saveStaffingOrderInternal(toggleBtn);
            if (success) {
                PlanState.isStaffingSortingMode = false;
                if (PlanState.sortableStaffingInstance) {
                    PlanState.sortableStaffingInstance.destroy();
                    PlanState.sortableStaffingInstance = null;
                }

                if (toggleBtn) {
                    toggleBtn.textContent = 'Besetzung sortieren';
                    toggleBtn.classList.remove('btn-secondary');
                    toggleBtn.classList.add('btn-primary');
                }

                document.querySelectorAll('.staffing-drag-handle').forEach(h => h.style.display = 'none');
                document.querySelectorAll('.staffing-row').forEach(r => r.classList.remove('sort-mode-active'));
            }

        } else {
            // Aktivieren
            PlanState.isStaffingSortingMode = true;

            if (toggleBtn) {
                toggleBtn.textContent = 'Reihenfolge speichern';
                toggleBtn.classList.remove('btn-primary');
                toggleBtn.classList.add('btn-secondary');
            }

            document.querySelectorAll('.staffing-drag-handle').forEach(h => h.style.display = 'inline-block');
            document.querySelectorAll('.staffing-row').forEach(r => r.classList.add('sort-mode-active'));

            this.initializeSortableStaffing();
        }
    },

    /**
     * Interne Hilfsfunktion zum Speichern der Sortierung.
     */
    async _saveStaffingOrderInternal(btnElement) {
        const rows = document.querySelectorAll('#staffing-grid .staffing-row');
        const payload = [];

        rows.forEach((row, index) => {
            payload.push({
                id: parseInt(row.dataset.id),
                order: index
            });
        });

        if (btnElement) {
            btnElement.textContent = 'Speichere...';
            btnElement.disabled = true;
        }

        try {
            await PlanApi.saveStaffingOrder(payload);

            // Lokale Liste auch sortieren, damit es beim nächsten Re-Render stimmt
            const newOrderMap = payload.reduce((acc, item) => {
                acc[item.id] = item.order;
                return acc;
            }, {});

            PlanState.allShiftTypesList.sort((a, b) => newOrderMap[a.id] - newOrderMap[b.id]);

            if (btnElement) btnElement.disabled = false;
            return true;

        } catch (error) {
            alert('Fehler beim Speichern der Sortierung: ' + error.message);
            if (btnElement) {
                btnElement.textContent = 'Fehler!';
                btnElement.disabled = false;
            }
            return false;
        }
    }
};