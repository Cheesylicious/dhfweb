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

        // --- NEU: Modal schließen bei Klick außerhalb ---
        window.addEventListener('click', (e) => {
            const modal = document.getElementById('click-action-modal');
            // Prüfen ob Modal offen ist und der Klick NICHT im Modal war
            if (modal && modal.style.display === 'block') {
                if (!modal.contains(e.target) && !e.target.closest('.grid-cell')) {
                    modal.style.display = 'none';
                }
            }
        });
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

        // Daten prüfen
        const shiftKey = `${user.id}-${dateStr}`;
        const currentShift = PlanState.currentShifts[shiftKey];
        // Prüfen, ob eine echte Schicht existiert (nicht null und hat einen Typ)
        const hasActiveShift = currentShift && currentShift.shifttype_id;

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

        // 2. Tausch-Anträge prüfen (Pending UND Approved für Rollback)
        // Wir suchen Requests, die diesen User an diesem Tag betreffen (als Target oder Replacement)
        const activeReq = PlanState.currentChangeRequests.find(req =>
            (req.status === 'pending' || req.status === 'approved') &&
            (req.shift_date ? req.shift_date.split('T')[0] : null) === dateStr &&
            // Check: Ist der angeklickte User beteiligt?
            // Bei Pending: target (Giver) oder replacement (Receiver)
            // Bei Approved: Der Request ist "fertig", aber wir brauchen ihn für Rollback.
            // ACHTUNG: Bei Approved ist der Giver nicht mehr in der Schicht!
            // Wir zeigen es nur an, wenn der User der RECEIVER ist (der jetzt die Schicht hat)
            (
                (req.status === 'pending' && (req.target_user_id === user.id || req.replacement_user_id === user.id)) ||
                (req.status === 'approved' && req.replacement_user_id === user.id && req.reason_type === 'trade')
            )
        );

        if (activeReq && (PlanState.isAdmin || PlanState.isPlanschreiber)) {
            this._renderTradeSection(activeReq, sections.adminShifts);
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

                        // --- FIX: Event Listener korrekt setzen ---
                        delLink.onclick = (e) => {
                            if(e) e.stopPropagation();
                            // Modal schließen
                            document.getElementById('click-action-modal').style.display = 'none';
                            // Löschen via PlanHandlers
                            PlanHandlers.deleteShiftQuery(wunsch.id);
                        };
                        // ---------------------------------------
                    }
                }
                hasContent = true;
            } else if (!wunsch) {

                // --- UPDATE: PRÜFUNG AUF EXISTIERENDE SCHICHT ---
                if (hasActiveShift) {
                    // Wenn eine Schicht existiert, darf KEINE Wunschanfrage gestellt werden.
                    // Nur Info anzeigen, wenn auch keine Tausch-Option (MarketModule) angezeigt wurde
                    // (MarketModule rendert sich selbst, hier kümmern wir uns um den Wunsch-Teil)
                    if (sections.hfRequests) {
                        // Wir zeigen den Bereich an, aber mit Hinweis statt Buttons
                        sections.hfRequests.style.display = 'block';
                        sections.hfRequests.innerHTML = `
                           <div style="background: rgba(255,255,255,0.05); color: #bdc3c7; padding: 10px; border-radius: 5px; text-align: center; font-size: 12px; border: 1px dashed #555;">
                               Schicht bereits eingetragen.<br>Nutze die Tauschbörse.
                           </div>
                        `;
                    }
                    hasContent = true;

                } else if (activeReq && activeReq.status === 'pending') {
                    // Wenn ein Tausch läuft
                     if (sections.hfRequests) {
                         sections.hfRequests.style.display = 'block';
                         // Info Text statt Buttons
                         sections.hfRequests.innerHTML = `
                            <div style="background: rgba(243, 156, 18, 0.1); border: 1px solid #f39c12; color: #f39c12; padding: 10px; border-radius: 5px; text-align: center; font-size: 13px;">
                                <i class="fas fa-sync fa-spin"></i> Tausch in Bearbeitung.<br>
                                Keine Wunschanfrage möglich.
                            </div>
                         `;
                     }
                     hasContent = true;
                } else {
                    // Kein Wunsch, Keine Schicht, Kein Tausch -> Neuen Wunsch erstellen
                    if(sections.hfRequests) {
                        sections.hfRequests.style.display = 'flex';
                        // Sicherstellen, dass das Grid sauber ist (falls vorher überschrieben)
                        sections.hfRequests.innerHTML = '';
                        this.populateHfButtons();
                    }
                    hasContent = true;
                }
                // --- ENDE UPDATE ---
            }
        }

        if (!hasContent) return;

        // Positionierung
        this._positionModal(cell, modal);
    },

    // --- Helper für Modal-Inhalt ---

    _renderTradeSection(req, anchorElement) {
        const tradeSection = document.createElement('div');
        tradeSection.id = 'cam-trade-section';
        tradeSection.className = 'cam-section';

        if (req.status === 'pending') {
            // PENDING: Genehmigen / Ablehnen
            tradeSection.innerHTML = `
                <div class="cam-section-title" style="color:#f1c40f;">⚠️ Offener Tausch</div>
                <div style="font-size:11px; margin-bottom:5px; color:#ccc;">
                    ${req.original_user_name} ➔ ${req.replacement_name}
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:5px;">
                    <button class="cam-button approve" onclick="window.confirmApproveTrade(${req.id})">Genehmigen</button>
                    <button class="cam-button reject" onclick="window.confirmRejectTrade(${req.id})">Ablehnen</button>
                </div>
            `;
        } else {
            // APPROVED (Trade): Rückgängig machen (Rollback)
            tradeSection.innerHTML = `
                <div class="cam-section-title" style="color:#2ecc71;">✅ Genehmigter Tausch</div>
                <div style="font-size:11px; margin-bottom:5px; color:#ccc;">
                    ${req.original_user_name} ➔ ${req.replacement_name}
                </div>
                <div style="margin-top:5px;">
                    <button class="cam-button reject" style="width:100%;" onclick="window.confirmRejectTrade(${req.id})">
                        <i class="fas fa-undo"></i> Tausch rückgängig machen
                    </button>
                </div>
            `;
        }

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
        // FIX: dhfConfirm statt nativem confirm
        window.dhfConfirm("Genehmigen", "Diesen Tausch genehmigen?", async () => {
            try {
                await PlanApi.approveShiftChangeRequest(reqId);
                // Modal schließen (Socket macht Refresh)
                document.getElementById('click-action-modal').style.display = 'none';
            } catch (e) {
                window.dhfAlert("Fehler", e.message, "error");
            }
        });
    },

    async confirmRejectTrade(reqId) {
        // FIX: dhfConfirm statt nativem confirm
        // Text dynamisch machen: Ablehnen (Pending) vs. Rückgängig (Approved)
        // Wir können das nicht direkt wissen ohne Daten, aber für den User ist "Rückgängig" verständlicher bei Approved.
        // Da wir den Status hier nicht explizit haben (nur reqId), nutzen wir einen neutralen Text oder schauen ob wir den Status haben.
        // In _renderTradeSection wissen wir den Status.
        // Wir könnten den Text im HTML-Button übergeben? Nein.
        // Egal, "Ablehnen / Rückgängig" passt immer.

        window.dhfConfirm("Aktion bestätigen", "Diesen Vorgang ablehnen bzw. rückgängig machen?", async () => {
            try {
                await PlanApi.rejectShiftChangeRequest(reqId);
                document.getElementById('click-action-modal').style.display = 'none';
                // Manueller Reload um Pending-Status wegzubekommen
                if (this.renderGrid) this.renderGrid();
            } catch (e) {
                window.dhfAlert("Fehler", e.message, "error");
            }
        });
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