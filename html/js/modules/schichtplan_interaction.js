// html/js/modules/schichtplan_interaction.js

import { PlanState } from './schichtplan_state.js';
import { PlanApi } from './schichtplan_api.js';
import { PlanHandlers } from './schichtplan_handlers.js';
import { MarketModule } from './schichtplan_market.js';
import { apiFetch } from '../utils/api.js';

/**
 * Modul für Interaktionen mit dem Grid (Klicks, Modals, Shortcuts).
 */
export const PlanInteraction = {

    // Callback zum Neuladen des Grids
    renderGrid: null,

    /**
     * Initialisiert das Modul und registriert globale Helfer.
     * @param {Function} renderGridFn - Funktion zum Neuladen des Grids.
     */
    init(renderGridFn) {
        this.renderGrid = renderGridFn;

        // Globale Funktionen für Inline-HTML Events registrieren
        window.confirmApproveTrade = this.confirmApproveTrade.bind(this);
        window.confirmRejectTrade = this.confirmRejectTrade.bind(this);
    },

    /**
     * Zentraler Handler für Klicks auf Grid-Zellen.
     */
    handleCellClick(e, user, dateStr, cell, isOwnRow) {
        // 1. Bulk Mode hat Vorrang
        if (PlanState.isBulkMode) {
            e.preventDefault();
            PlanHandlers.handleBulkCellClick(cell);

            // UI Update für Bulk-Action-Bar
            const count = PlanState.selectedQueryIds.size;
            const statusText = document.getElementById('bulk-status-text');
            const approveBtn = document.getElementById('bulk-approve-btn');
            const rejectBtn = document.getElementById('bulk-reject-btn');

            if (statusText) statusText.textContent = `${count} ausgewählt`;
            if (approveBtn) approveBtn.disabled = count === 0;
            if (rejectBtn) rejectBtn.disabled = count === 0;
            return;
        }

        e.preventDefault();

        // Besucher dürfen nichts
        if (PlanState.isVisitor) return;

        this.showClickActionModal(e, user, dateStr, cell, isOwnRow);
    },

    /**
     * Zeigt das Kontext-Menü (Modal) an der angeklickten Zelle.
     */
    showClickActionModal(event, user, dateStr, cell, isCellOnOwnRow) {
        const modal = document.getElementById('click-action-modal');
        if (modal) modal.style.display = 'none';

        // --- ZOMBIE-BEREINIGUNG ---
        const oldTradeSection = document.getElementById('cam-trade-section');
        if (oldTradeSection) oldTradeSection.remove();

        const userName = `${user.vorname} ${user.name}`;
        const d = new Date(dateStr);
        const dateDisplay = d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });

        // Kontext im State speichern
        PlanState.clickModalContext = {
            userId: user.id,
            dateStr,
            userName,
            isPlanGesperrt: PlanState.currentPlanStatus.is_locked && PlanState.currentVariantId === null,
            isCellOnOwnRow: isCellOnOwnRow
        };

        // DOM Elemente holen
        const camTitle = document.getElementById('cam-title');
        const camSubtitle = document.getElementById('cam-subtitle');

        // Sektionen
        const sections = {
            adminWunsch: document.getElementById('cam-admin-wunsch-actions'),
            adminShifts: document.getElementById('cam-admin-shifts'),
            hfRequests: document.getElementById('cam-hundefuehrer-requests'),
            notizen: document.getElementById('cam-notiz-actions'),
            hfDelete: document.getElementById('cam-hundefuehrer-delete')
        };

        if (camTitle) camTitle.textContent = userName;
        if (camSubtitle) camSubtitle.textContent = dateDisplay;

        // Alle Sektionen erst verstecken
        Object.values(sections).forEach(el => { if(el) el.style.display = 'none'; });

        // --- MARKTPLATZ DYNAMISCH ---
        let marketSection = document.getElementById('cam-market-actions');
        if (!marketSection) {
            marketSection = document.createElement('div');
            marketSection.id = 'cam-market-actions';
            marketSection.className = 'cam-section';
            // Vor Notizen einfügen
            if (sections.notizen && sections.notizen.parentNode) {
                sections.notizen.parentNode.insertBefore(marketSection, sections.notizen);
            }
        }
        marketSection.style.display = 'none';

        // Anfragen für diese Zelle filtern
        const queries = PlanState.currentShiftQueries.filter(q =>
            q.shift_date === dateStr &&
            q.status === 'offen' &&
            (q.target_user_id === user.id || q.target_user_id === null)
        );

        const wunsch = queries.find(q => q.sender_role_name === 'Hundeführer' && q.message.startsWith("Anfrage für:"));
        const notiz = queries.find(q => !(q.sender_role_name === 'Hundeführer' && q.message.startsWith("Anfrage für:")));

        PlanState.clickModalContext.wunschQuery = wunsch;
        PlanState.clickModalContext.notizQuery = notiz;

        let hasContent = false;

        // 1. Marktplatz Modul prüfen
        if (MarketModule.renderModalActions(marketSection, PlanState.clickModalContext, this.renderGrid, () => modal.style.display = 'none')) {
            hasContent = true;
        }

        // 2. Offene Tausch-Anträge prüfen (Admin/Planschreiber)
        const pendingReq = PlanState.currentChangeRequests.find(req =>
            req.status === 'pending' &&
            (req.shift_date ? req.shift_date.split('T')[0] : null) === dateStr &&
            (req.target_user_id === user.id || req.replacement_user_id === user.id)
        );

        if (pendingReq && (PlanState.isAdmin || PlanState.isPlanschreiber)) {
            this._renderTradeSection(pendingReq, sections.adminShifts);
            hasContent = true;
        }

        // 3. Logik nach Rollen
        if ((PlanState.isPlanschreiber || PlanState.isAdmin) && PlanState.clickModalContext.isPlanGesperrt) {
            // SPEZIALFALL: Plan gesperrt -> Nur Krankmeldung
            this._renderLockedPlanActions(sections, user, dateStr, userName, notiz);
            hasContent = true;

        } else if (PlanState.isAdmin) {
            // ADMIN (Offen)
            if (wunsch) {
                if(sections.adminWunsch) {
                    sections.adminWunsch.style.display = 'grid';
                    const approveBtn = document.getElementById('cam-btn-approve');
                    if(approveBtn) approveBtn.textContent = `Genehmigen (${wunsch.message.replace('Anfrage für:', '').trim()})`;
                }
                hasContent = true;
            }

            if(sections.adminShifts) {
                sections.adminShifts.style.display = 'grid';
                this.populateAdminShiftButtons();
                hasContent = true;
            }

            this._showNotizLink(sections.notizen, notiz);
            hasContent = true;

        } else if (PlanState.isPlanschreiber) {
            // PLANSCHREIBER (Offen)
            if(sections.adminShifts) {
                 sections.adminShifts.style.display = 'grid';
                 this.populateAdminShiftButtons();
                 hasContent = true;
            }
            this._showNotizLink(sections.notizen, notiz);
            hasContent = true;

        } else if (PlanState.isHundefuehrer && isCellOnOwnRow) {
            // HUNDEFÜHRER
            if (wunsch && wunsch.sender_user_id === PlanState.loggedInUser.id) {
                // Eigener Wunsch existiert -> Zurückziehen
                if(sections.hfDelete) {
                    sections.hfDelete.style.display = 'block';
                    const delLink = document.getElementById('cam-link-delete');
                    if(delLink) {
                        delLink.textContent = 'Wunsch-Anfrage zurückziehen';
                        delLink.dataset.targetQueryId = wunsch.id;
                    }
                }
                hasContent = true;
            } else if (!wunsch) {
                // Kein Wunsch -> Neuen erstellen
                if(sections.hfRequests) {
                    sections.hfRequests.style.display = 'flex';
                    this.populateHfButtons();
                }
                hasContent = true;
            }
        }

        if (!hasContent) return;

        // Positionierung
        this._positionModal(cell, modal);
    },

    // --- Helper für Modal-Inhalt ---

    _renderTradeSection(pendingReq, anchorElement) {
        const tradeSection = document.createElement('div');
        tradeSection.id = 'cam-trade-section';
        tradeSection.className = 'cam-section';
        tradeSection.innerHTML = `
            <div class="cam-section-title" style="color:#f1c40f;">⚠️ Offener Tausch</div>
            <div style="font-size:11px; margin-bottom:5px; color:#ccc;">
                ${pendingReq.original_user_name} ➔ ${pendingReq.replacement_name}
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:5px;">
                <button class="cam-button approve" onclick="window.confirmApproveTrade(${pendingReq.id})">Genehmigen</button>
                <button class="cam-button reject" onclick="window.confirmRejectTrade(${pendingReq.id})">Ablehnen</button>
            </div>
        `;

        const modal = document.getElementById('click-action-modal');
        if (anchorElement && anchorElement.parentNode) {
            anchorElement.parentNode.insertBefore(tradeSection, anchorElement);
        } else {
            modal.appendChild(tradeSection);
        }
    },

    _renderLockedPlanActions(sections, user, dateStr, userName, notiz) {
        // Nutzen den Admin-Shift Container für den Krank-Button
        const container = sections.adminShifts;
        if(container) {
            container.style.display = 'block';
            container.innerHTML = '';

            const header = document.createElement('div');
            header.className = 'cam-section-title';
            header.textContent = 'Aktionen (Plan gesperrt)';
            header.style.color = '#e74c3c';
            container.appendChild(header);

            const btn = document.createElement('button');
            btn.className = 'cam-button reject';
            btn.style.width = '100%';
            btn.textContent = '⚠️ Krankmeldung / Ersatz beantragen';

            btn.onclick = () => {
                document.getElementById('click-action-modal').style.display = 'none';
                if (PlanHandlers.handleLockedClick) {
                    PlanHandlers.handleLockedClick(user.id, dateStr, userName);
                } else {
                    alert("Handler nicht gefunden. Bitte neu laden.");
                }
            };
            container.appendChild(btn);
        }

        this._showNotizLink(sections.notizen, notiz);
    },

    _showNotizLink(container, notiz) {
        if(!container) return;
        container.style.display = 'block';
        const link = document.getElementById('cam-link-notiz');
        if(link) {
            link.textContent = notiz ? '❓ Text-Notiz ansehen...' : '❓ Text-Notiz erstellen...';
            link.dataset.targetQueryId = notiz ? notiz.id : "";
        }
    },

    _positionModal(cell, modal) {
        const cellRect = cell.getBoundingClientRect();
        const modalWidth = 300;
        let left = cellRect.left + window.scrollX;
        let top = cellRect.bottom + window.scrollY + 5;

        // Boundary Check (Rechts)
        if (left + modalWidth > document.documentElement.clientWidth) {
            left = document.documentElement.clientWidth - modalWidth - 10;
        }

        modal.style.left = `${left}px`;
        modal.style.top = `${top}px`;
        modal.style.display = 'block';
    },

    // --- Buttons befüllen ---

    populateAdminShiftButtons() {
        const container = document.getElementById('cam-admin-shifts');
        if (!container) return;
        container.innerHTML = `<div class="cam-section-title">Schicht zuweisen</div>`;

        const defs = [
            { abbrev: 'T.', title: 'Tag' }, { abbrev: 'N.', title: 'Nacht' },
            { abbrev: '6', title: 'Kurz' }, { abbrev: 'FREI', title: 'Frei' },
            { abbrev: 'U', title: 'Urlaub' }, { abbrev: 'X', title: 'Wunschfrei' },
            { abbrev: 'Alle...', title: 'Alle', isAll: true }
        ];

        defs.forEach(def => {
            const btn = document.createElement('button');
            btn.className = def.isAll ? 'cam-shift-button all' : 'cam-shift-button';
            btn.textContent = def.abbrev;

            btn.onclick = () => {
                const modal = document.getElementById('click-action-modal');
                if (modal) modal.style.display = 'none';

                if (def.isAll) {
                    // "Alle" öffnet das große Modal
                    PlanState.modalContext = { userId: PlanState.clickModalContext.userId, dateStr: PlanState.clickModalContext.dateStr };
                    document.getElementById('shift-modal-title').textContent = "Alle Schichten";
                    document.getElementById('shift-modal-info').textContent = `Für: ${PlanState.clickModalContext.userName}`;
                    document.getElementById('shift-modal').style.display = 'block';
                } else {
                    // Direkt speichern
                    const st = PlanState.allShiftTypesList.find(s => s.abbreviation === def.abbrev);
                    if (st) {
                        PlanHandlers.saveShift(st.id, PlanState.clickModalContext.userId, PlanState.clickModalContext.dateStr);
                    }
                }
            };
            container.appendChild(btn);
        });
    },

    async populateHfButtons() {
        const container = document.getElementById('cam-hundefuehrer-requests');
        if (!container) return;
        container.innerHTML = '<div style="color:#bbb; font-size:12px;">Lade...</div>';

        try {
            const usage = await PlanApi.fetchQueryUsage(PlanState.currentYear, PlanState.currentMonth);
            container.innerHTML = `<div class="cam-section-title">Wunsch-Anfrage</div>`;

            const buttons = [
                { label: 'T.?', abbr: 'T.' }, { label: 'N.?', abbr: 'N.' },
                { label: '6?', abbr: '6' }, { label: 'X?', abbr: 'X' }
            ];

            buttons.forEach(def => {
                const btn = document.createElement('button');
                btn.className = 'cam-shift-button';

                // Limit Check
                const limit = usage[def.abbr];
                let disabled = false;
                let info = '';

                if (limit) {
                    if (limit.remaining <= 0) { disabled = true; info = '(0)'; }
                    else { info = `(${limit.remaining})`; }
                }

                // 6er nur Freitags (Logik aus Original)
                if (def.abbr === '6') {
                    const d = new Date(PlanState.clickModalContext.dateStr);
                    const isFri = d.getDay() === 5;
                    const isHol = PlanState.currentSpecialDates[PlanState.clickModalContext.dateStr] === 'holiday';
                    if (!isFri || isHol) { disabled = true; info = 'Nur Fr'; }
                }

                btn.textContent = `${def.label} ${info}`;

                if (disabled) {
                    btn.disabled = true;
                    btn.style.opacity = 0.5;
                } else {
                    btn.onclick = () => {
                        PlanHandlers.requestShift(def.label, PlanState.clickModalContext.userId, PlanState.clickModalContext.dateStr);
                        document.getElementById('click-action-modal').style.display = 'none';
                    };
                }
                container.appendChild(btn);
            });
        } catch(e) {
            container.innerHTML = 'Fehler beim Laden.';
        }
    },

    // --- Actions (Tausch) ---

    async confirmApproveTrade(reqId) {
        if (!confirm("Diesen Tausch genehmigen?")) return;
        try {
            await PlanApi.approveShiftChangeRequest(reqId);
            // Modal schließen (Socket macht Refresh)
            document.getElementById('click-action-modal').style.display = 'none';
        } catch (e) {
            alert("Fehler: " + e.message);
        }
    },

    async confirmRejectTrade(reqId) {
        if (!confirm("Tausch ablehnen?")) return;
        try {
            await PlanApi.rejectShiftChangeRequest(reqId);
            document.getElementById('click-action-modal').style.display = 'none';
            // Manueller Reload um Pending-Status wegzubekommen
            if (this.renderGrid) this.renderGrid();
        } catch (e) {
            alert("Fehler: " + e.message);
        }
    },

    // --- Konversation ---

    async loadAndRenderModalConversation(queryId) {
        const repliesList = document.getElementById('query-replies-list');
        if (!repliesList) return;

        try {
            const replies = await apiFetch(`/api/queries/${queryId}/replies`);
            // Bestehende entfernen außer Initial
            const itemsToRemove = repliesList.querySelectorAll('.reply-item:not(#initial-query-item)');
            itemsToRemove.forEach(el => el.remove());

            replies.forEach(reply => {
                const li = document.createElement('li');
                li.className = 'reply-item';
                const isSelf = reply.user_id === PlanState.loggedInUser.id;
                const formattedDate = new Date(reply.created_at).toLocaleTimeString('de-DE', {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'});

                li.innerHTML = `
                    <div class="reply-meta" style="color: ${isSelf ? '#3498db' : '#888'};">
                        <strong>${reply.user_name}</strong> am ${formattedDate} Uhr
                    </div>
                    <div class="reply-text">${reply.message}</div>
                `;
                repliesList.appendChild(li);
            });
        } catch (e) {
            console.error("Fehler beim Laden der Antworten:", e);
        }
    }
};