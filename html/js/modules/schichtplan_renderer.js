// html/js/modules/schichtplan_renderer.js

import { PlanState } from './schichtplan_state.js';
import { COL_WIDTH_NAME, COL_WIDTH_DETAILS, COL_WIDTH_UEBERTRAG, COL_WIDTH_DAY, COL_WIDTH_TOTAL } from '../utils/constants.js';
import { isColorDark, isWunschAnfrage } from '../utils/helpers.js';

/**
 * Renderer-Modul: Verantwortlich für das Generieren und Aktualisieren des DOMs.
 * Enthält KEINE Geschäftslogik, sondern setzt nur den PlanState in HTML um.
 */
export const PlanRenderer = {

    /**
     * Sucht eine Zelle im Grid anhand des Keys.
     * @param {string} key - Format "userId-dateStr"
     */
    findCellByKey(key) {
        return document.getElementById('schichtplan-grid')?.querySelector(`.grid-cell[data-key="${key}"]`);
    },

    /**
     * Aktualisiert die Gesamtstunden eines Users im DOM und im State.
     */
    updateUserTotalHours(userId, delta) {
        const totalCell = document.getElementById(`total-hours-${userId}`);
        if (!totalCell) return;

        let currentVal = parseFloat(totalCell.textContent);
        if (isNaN(currentVal)) currentVal = 0;

        const newVal = currentVal + delta;
        PlanState.currentTotals[userId] = newVal;

        totalCell.textContent = newVal.toFixed(1);

        // Visuelles Feedback
        totalCell.style.backgroundColor = '#eaf2ff';
        setTimeout(() => { totalCell.style.backgroundColor = ''; }, 500);
    },

    /**
     * Aktualisiert eine einzelne Zelle im Grid (visuell), basierend auf PlanState.
     * Ruft KEINE API auf.
     */
    refreshSingleCell(userId, dateStr) {
        const key = `${userId}-${dateStr}`;
        const cell = this.findCellByKey(key);
        if (!cell) return;

        const d = new Date(dateStr);
        const day = d.getDate();
        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
        const eventType = PlanState.currentSpecialDates[dateStr];
        const shift = PlanState.currentShifts[key];
        const shiftType = shift ? shift.shift_type : null;
        const violationKey = `${userId}-${day}`;

        let cellClasses = 'grid-cell';
        if (PlanState.loggedInUser.id === userId) cellClasses += ' current-user-row';
        if (PlanState.currentViolations.has(violationKey)) cellClasses += ' violation';
        if (shift && shift.is_locked) cellClasses += ' locked-shift';

        cell.textContent = '';
        cell.style.backgroundColor = '';
        cell.style.color = '';
        delete cell.dataset.queryId; // Reset

        // Queries prüfen
        const queriesForCell = PlanState.currentShiftQueries.filter(q =>
            (q.target_user_id === userId && q.shift_date === dateStr && q.status === 'offen')
        );
        const wunschQuery = queriesForCell.find(q => isWunschAnfrage(q));
        const notizQuery = queriesForCell.find(q => !isWunschAnfrage(q));

        let shiftRequestText = "";
        let showQuestionMark = false;
        let isShiftRequestCell = false;

        if (PlanState.isPlanschreiber) {
            if (notizQuery) showQuestionMark = true;
        } else if (PlanState.isHundefuehrer) {
            if (wunschQuery) {
                isShiftRequestCell = true;
                shiftRequestText = wunschQuery.message.substring("Anfrage für:".length).trim();
            }
        } else {
            if (wunschQuery) {
                isShiftRequestCell = true;
                shiftRequestText = wunschQuery.message.substring("Anfrage für:".length).trim();
            }
            if (notizQuery) showQuestionMark = true;
        }

        const dayHasSpecialBg = eventType || isWeekend;

        // Render-Logik
        if (shiftType) {
            cell.textContent = shiftType.abbreviation;
            if (shiftType.prioritize_background && dayHasSpecialBg) {
                if (eventType === 'holiday') cellClasses += ` day-color-${eventType}`;
                else if (isWeekend) cellClasses += ' weekend';
            } else {
                cell.style.backgroundColor = shiftType.color;
                cell.style.color = isColorDark(shiftType.color) ? 'white' : 'black';
            }
        } else if (isShiftRequestCell) {
            cell.textContent = shiftRequestText;
            cellClasses += ' shift-request-cell';
            if (wunschQuery) cell.dataset.queryId = wunschQuery.id;
        } else {
             if (eventType === 'holiday') cellClasses += ` day-color-${eventType}`;
             else if (isWeekend) cellClasses += ' weekend';
        }

        if (showQuestionMark) {
             cell.innerHTML += `<span class="shift-query-icon">❓</span>`;
        }

        cell.className = cellClasses;

        // Bulk Selection wiederherstellen
        if (PlanState.isBulkMode && wunschQuery && PlanState.selectedQueryIds.has(wunschQuery.id)) {
            cell.classList.add('selected');
        }
    },

    /**
     * Baut das komplette DOM des Haupt-Grids auf.
     * Nutzt Callbacks für Events, um Zirkelbezüge zu vermeiden.
     * * @param {Object} callbacks - Objekt mit Event-Handlern:
     * - onCellClick(e, user, dateStr, cell, isOwnRow)
     * - onCellEnter(user, dateStr, cell)
     * - onCellLeave()
     */
    buildGridDOM(callbacks = {}) {
        const grid = document.getElementById('schichtplan-grid');
        const monthLabel = document.getElementById('current-month-label');
        if (!grid || !monthLabel) return;

        const daysInMonth = new Date(PlanState.currentYear, PlanState.currentMonth, 0).getDate();
        const monthName = new Date(PlanState.currentYear, PlanState.currentMonth - 1, 1).toLocaleString('de-DE', { month: 'long', year: 'numeric' });
        monthLabel.textContent = monthName;

        const today = new Date();

        // Grid Spalten Definition
        grid.style.gridTemplateColumns = `${PlanState.computedColWidthName} ${PlanState.computedColWidthDetails} ${COL_WIDTH_UEBERTRAG} repeat(${daysInMonth}, ${COL_WIDTH_DAY}) ${COL_WIDTH_TOTAL}`;

        grid.innerHTML = '';
        const weekdays = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

        // Helper für Header-Zellen
        const renderDayHeader = (day, isWeekend, dateStr) => {
            const eventType = PlanState.currentSpecialDates[dateStr];
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
            const d = new Date(PlanState.currentYear, PlanState.currentMonth - 1, day);
            const dayName = weekdays[d.getDay()];
            const isWeekend = d.getDay() === 0 || d.getDay() === 6;
            const dateStr = `${PlanState.currentYear}-${String(PlanState.currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

            const headerCell = renderDayHeader(day, isWeekend, dateStr);
            headerCell.textContent = dayName;

            if (PlanState.currentYear === today.getFullYear() && (PlanState.currentMonth - 1) === today.getMonth() && day === today.getDate()) {
                headerCell.classList.add('current-day-highlight');
            }
            grid.appendChild(headerCell);
        }
        let totalHeader1 = document.createElement('div');
        totalHeader1.className = 'grid-header-total';
        grid.appendChild(totalHeader1);

        // --- ZEILE 2: Tag-Nummern ---
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
            const d = new Date(PlanState.currentYear, PlanState.currentMonth - 1, day);
            const isWeekend = d.getDay() === 0 || d.getDay() === 6;
            const dateStr = `${PlanState.currentYear}-${String(PlanState.currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

            const headerCell = renderDayHeader(day, isWeekend, dateStr);
            headerCell.classList.add('header-separator-bottom');
            headerCell.textContent = day;

            if (PlanState.currentYear === today.getFullYear() && (PlanState.currentMonth - 1) === today.getMonth() && day === today.getDate()) {
                headerCell.classList.add('current-day-highlight');
            }
            grid.appendChild(headerCell);
        }
        const totalHeader = document.createElement('div');
        totalHeader.className = 'grid-header-total header-separator-bottom';
        totalHeader.textContent = 'Std.';
        grid.appendChild(totalHeader);

        // --- USER ROWS ---
        const visibleUsers = PlanState.allUsers.filter(user => user.shift_plan_visible === true);

        visibleUsers.forEach(user => {
            const isCurrentUser = (PlanState.loggedInUser && PlanState.loggedInUser.id === user.id);
            const currentUserClass = isCurrentUser ? ' current-user-row' : '';

            // Name
            const nameCell = document.createElement('div');
            nameCell.className = 'grid-user-name' + currentUserClass;
            nameCell.textContent = `${user.vorname} ${user.name}`;
            grid.appendChild(nameCell);

            // Hund
            const dogCell = document.createElement('div');
            dogCell.className = 'grid-user-dog' + currentUserClass;
            dogCell.textContent = user.diensthund || '---';
            grid.appendChild(dogCell);

            // Übertrag
            const uebertragCell = document.createElement('div');
            uebertragCell.className = 'grid-user-uebertrag' + currentUserClass;
            const lastMonthShift = PlanState.currentShiftsLastMonth[user.id];
            if (lastMonthShift && lastMonthShift.shift_type) {
                uebertragCell.textContent = lastMonthShift.shift_type.abbreviation;
                uebertragCell.title = `Schicht am Vormonat: ${lastMonthShift.shift_type.name}`;
            } else {
                uebertragCell.textContent = '---';
            }
            grid.appendChild(uebertragCell);

            // Tage
            for (let day = 1; day <= daysInMonth; day++) {
                const d = new Date(PlanState.currentYear, PlanState.currentMonth - 1, day);
                const year = d.getFullYear();
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const dayOfMonth = String(d.getDate()).padStart(2, '0');
                const dateStr = `${year}-${month}-${dayOfMonth}`;
                const key = `${user.id}-${dateStr}`;

                const cell = document.createElement('div');
                cell.className = 'grid-cell'; // Initiale Klasse
                cell.dataset.key = key;

                // Zelle ins Grid hängen
                grid.appendChild(cell);

                // Inhalt rendern (ruft refreshSingleCell auf, da Zelle nun im DOM ist)
                this.refreshSingleCell(user.id, dateStr);

                // Event Listeners anhängen
                // Wir nutzen die Callbacks, die von außen reingegeben werden
                const handleClick = (e) => {
                    if (callbacks.onCellClick) {
                        callbacks.onCellClick(e, user, dateStr, cell, isCurrentUser);
                    }
                };

                const handleEnter = () => {
                    if (callbacks.onCellEnter) {
                        callbacks.onCellEnter(user, dateStr, cell);
                    }
                };

                const handleLeave = () => {
                    if (callbacks.onCellLeave) {
                        callbacks.onCellLeave();
                    }
                };

                if (PlanState.isVisitor) {
                    cell.addEventListener('mouseenter', handleEnter);
                    cell.addEventListener('mouseleave', handleLeave);
                } else {
                    cell.addEventListener('click', handleClick);
                    cell.addEventListener('mouseenter', handleEnter);
                    cell.addEventListener('mouseleave', handleLeave);
                }

                // Kontextmenü verhindern
                cell.addEventListener('contextmenu', e => e.preventDefault());
            }

            // Total Hours
            const totalCell = document.createElement('div');
            totalCell.className = 'grid-user-total' + currentUserClass;
            totalCell.id = `total-hours-${user.id}`;
            const userTotalHours = PlanState.currentTotals[user.id] || 0.0;
            totalCell.textContent = userTotalHours.toFixed(1);
            grid.appendChild(totalCell);
        });

        // Layout Spaltenbreiten messen
        try {
            if (nameHeader2 && dogHeader) {
                PlanState.computedColWidthName = `${nameHeader2.offsetWidth}px`;
                PlanState.computedColWidthDetails = `${dogHeader.offsetWidth}px`;
                // Grid update
                grid.style.gridTemplateColumns = `${PlanState.computedColWidthName} ${PlanState.computedColWidthDetails} ${COL_WIDTH_UEBERTRAG} repeat(${daysInMonth}, ${COL_WIDTH_DAY}) ${COL_WIDTH_TOTAL}`;
            }
        } catch (e) {
            console.error("Fehler beim Messen der Spaltenbreiten:", e);
        }
    },

    /**
     * Scrollt zu einer bestimmten Zelle und hebt sie hervor.
     */
    highlightCells(dateStr, targetUserId) {
        const highlightClass = 'grid-cell-highlight';
        let cellsToHighlight = [];

        if (targetUserId) {
            const key = `${targetUserId}-${dateStr}`;
            const cell = this.findCellByKey(key);
            if (cell) cellsToHighlight.push(cell);
        } else {
            const allCellsInDay = document.querySelectorAll(`.grid-cell[data-key$="-${dateStr}"]`);
            cellsToHighlight = Array.from(allCellsInDay);
        }

        if (cellsToHighlight.length > 0) {
            cellsToHighlight[0].scrollIntoView({
                behavior: 'smooth',
                block: 'center',
                inline: 'center'
            });

            cellsToHighlight.forEach(cell => cell.classList.add(highlightClass));

            setTimeout(() => {
                cellsToHighlight.forEach(cell => cell.classList.remove(highlightClass));
            }, 5000);
        }
    }
};