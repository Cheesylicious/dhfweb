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

        // --- MARKTPLATZ CHECK (ANGEBOTE) ---
        const marketOffer = (PlanState.currentMarketOffers || {})[key];

        // WICHTIG: Marktplatz-Angebote NUR im Hauptplan anzeigen!
        const isMainPlan = (PlanState.currentVariantId === null);

        // Nur anzeigen, wenn Hauptplan UND Angebot existiert UND Rolle passt
        const showMarket = isMainPlan && marketOffer && (PlanState.isAdmin || PlanState.isHundefuehrer);

        // --- GHOST CHECK (INCOMING) ---
        const ghostData = (PlanState.marketTimerTargets || {})[key];
        const showGhost = isMainPlan && ghostData;

        // --- OUTGOING CHECK (NEU: Sender) ---
        const outgoingData = (PlanState.marketTimerSources || {})[key];
        const showOutgoing = isMainPlan && outgoingData;

        // --- Check ob heute ---
        const today = new Date();
        const isToday = (d.getFullYear() === today.getFullYear() &&
                         d.getMonth() === today.getMonth() &&
                         d.getDate() === today.getDate());

        let cellClasses = 'grid-cell';
        if (PlanState.loggedInUser.id === userId) cellClasses += ' current-user-row';
        if (PlanState.currentViolations.has(violationKey)) cellClasses += ' violation';
        if (shift && shift.is_locked) cellClasses += ' locked-shift';

        // Marktplatz-Klasse (für Blinken bei Angebot)
        if (showMarket) {
            cellClasses += ' market-offer-active';
        }

        // Ghost (Empfänger)
        if (showGhost) {
            cellClasses += ' pending-incoming';
        }

        // Outgoing (Sender) - NEU
        if (showOutgoing) {
            cellClasses += ' pending-outgoing';
        }

        // Klasse hinzufügen, wenn es heute ist
        if (isToday) cellClasses += ' current-day-highlight';

        // --- DPO Rahmen ---
        if (eventType === 'dpo') cellClasses += ' day-border-dpo';

        // Reset Cell Content - WICHTIG: Erst alles leeren
        cell.textContent = '';
        cell.style.backgroundColor = '';
        cell.style.color = '';
        delete cell.dataset.queryId;
        delete cell.dataset.marketOfferId; // Aufräumen

        const queriesForCell = PlanState.currentShiftQueries.filter(q =>
            q.shift_date === dateStr &&
            q.status === 'offen' &&
            (q.target_user_id === userId || q.target_user_id === null)
        );

        const wunschQuery = queriesForCell.find(q => isWunschAnfrage(q));
        const notizQuery = queriesForCell.find(q => !isWunschAnfrage(q));

        let shiftRequestText = "";
        let showQuestionMark = false;
        let isShiftRequestCell = false;

        // --- LOGIK FÜR FRAGEZEICHEN UND TEXT ---
        if (PlanState.isAdmin) {
            // Admin sieht Wünsche (Text) und Notizen (Fragezeichen)
            if (wunschQuery) {
                isShiftRequestCell = true;
                shiftRequestText = wunschQuery.message.substring("Anfrage für:".length).trim();
            }
            if (notizQuery) showQuestionMark = true;

        } else if (PlanState.isPlanschreiber) {
            // Planschreiber sieht Notizen (Fragezeichen)
            if (notizQuery) showQuestionMark = true;

        } else if (PlanState.isHundefuehrer) {
            // Hundeführer sieht eigene Wünsche (Text)
            if (wunschQuery) {
                isShiftRequestCell = true;
                shiftRequestText = wunschQuery.message.substring("Anfrage für:".length).trim();
            }
            // Auch Hundeführer sehen das Fragezeichen bei Notizen
            if (notizQuery) showQuestionMark = true;
        }

        const dayHasSpecialBg = eventType || isWeekend;

        // --- RENDER-LOGIK: Text & Hintergrund ---
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
        } else if (showGhost) {
            // NEU: Geist anzeigen (wenn Zelle leer ist)
            cell.innerHTML = `<span class="ghost-text">${ghostData.abbr}</span>`;
             if (eventType === 'holiday') cellClasses += ` day-color-${eventType}`;
             else if (isWeekend) cellClasses += ' weekend';
        } else {
             if (eventType === 'holiday') cellClasses += ` day-color-${eventType}`;
             else if (isWeekend) cellClasses += ' weekend';
        }

        // Klasse setzen
        cell.className = cellClasses;

        // --- ICONS EINFÜGEN ---

        // 1. Marktplatz Icon (Angebot)
        if (showMarket) {
             const marketIcon = document.createElement('div');
             marketIcon.className = 'market-icon-overlay';
             marketIcon.innerHTML = '⇄'; // Tausch-Symbol

             let tooltip = "In Tauschbörse verfügbar";
             if (marketOffer.is_my_offer) {
                 tooltip = "Dein Angebot (In Tauschbörse)";
                 marketIcon.style.color = "#f1c40f"; // Gold für eigene
             } else {
                 marketIcon.style.color = "#2ecc71"; // Grün für andere
             }
             if (marketOffer.note) tooltip += ` - Notiz: ${marketOffer.note}`;

             marketIcon.title = tooltip;
             cell.appendChild(marketIcon);

             // ID speichern für Click-Handler (um Modal zu öffnen)
             cell.dataset.marketOfferId = marketOffer.id;
        }

        // 2. Ghost Icon (Download Pfeil für Empfänger)
        if (showGhost) {
            const icon = document.createElement('div');
            icon.className = 'icon-incoming';
            icon.innerHTML = '<i class="fas fa-download"></i>';
            icon.title = `Wartet auf Übernahme von ${ghostData.from} (Timer läuft)`;
            cell.appendChild(icon);
        }

        // 3. Outgoing Icon (Upload Pfeil für Sender) - NEU
        if (showOutgoing) {
            const icon = document.createElement('div');
            icon.className = 'icon-outgoing';
            icon.innerHTML = '<i class="fas fa-upload"></i>';
            icon.title = `Wird übergeben an ${outgoingData.to} (Timer läuft)`;
            cell.appendChild(icon);
        }

        // 4. Notiz Icon (FIX: Absolut positioniert unten rechts)
        if (showQuestionMark) {
             const iconDiv = document.createElement('div');
             iconDiv.className = 'shift-query-icon';
             iconDiv.textContent = '❓';

             // Styles direkt setzen, um "N...." Layout-Bug zu beheben
             iconDiv.style.position = 'absolute';
             iconDiv.style.bottom = '2px';
             iconDiv.style.right = '2px';
             iconDiv.style.fontSize = '12px'; // Klein und fein
             iconDiv.style.lineHeight = '1';
             iconDiv.style.zIndex = '25';
             iconDiv.style.cursor = 'help';

             // Tooltip Logik
             if (notizQuery) {
                 if (notizQuery.target_user_id === null) {
                     iconDiv.title = "Thema des Tages / Allgemeine Notiz";
                 } else {
                     iconDiv.title = "Persönliche Notiz";
                 }
             }
             cell.appendChild(iconDiv);
        }

        // --- 5. HANDSCHLAG (TRADE) ICON ---
        if (shift && shift.is_trade) {
            const tradeIcon = document.createElement('div');
            tradeIcon.className = 'icon-trade';
            tradeIcon.innerHTML = '🤝';
            tradeIcon.title = 'Diese Schicht wurde getauscht';
            cell.appendChild(tradeIcon);
        }
        // ---------------------------------------

        // Bulk Selection wiederherstellen
        if (PlanState.isBulkMode && wunschQuery && PlanState.selectedQueryIds.has(wunschQuery.id)) {
            cell.classList.add('selected');
        }
    },

    /**
     * Baut das komplette DOM des Haupt-Grids auf.
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
            if (eventType === 'dpo') {
                headerClasses += ' day-border-dpo'; // Rahmen für Header
            }
            // Hintergrundfarben
            if (eventType && eventType !== 'dpo') {
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

            // DPO Label
            if (PlanState.currentSpecialDates[dateStr] === 'dpo') {
                headerCell.innerHTML = `<span class="dpo-header-label">DPO</span><span>${dayName}</span>`;
            } else {
                headerCell.textContent = dayName;
            }

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
                cell.className = 'grid-cell';
                cell.dataset.key = key;

                // Heute markieren
                if (PlanState.currentYear === today.getFullYear() && (PlanState.currentMonth - 1) === today.getMonth() && day === today.getDate()) {
                    cell.classList.add('current-day-highlight');
                }

                // Zelle ins Grid hängen
                grid.appendChild(cell);

                // Inhalt rendern
                this.refreshSingleCell(user.id, dateStr);

                // Event Listeners anhängen
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

        try {
            if (nameHeader2 && dogHeader) {
                PlanState.computedColWidthName = `${nameHeader2.offsetWidth}px`;
                PlanState.computedColWidthDetails = `${dogHeader.offsetWidth}px`;
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