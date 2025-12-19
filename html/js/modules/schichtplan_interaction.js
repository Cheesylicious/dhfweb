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

        // --- Globaler Click-Listener zum Schließen von Modals ---
        window.addEventListener('click', (e) => {
            const contextModal = document.getElementById('click-action-modal');
            const queryModal = document.getElementById('query-modal');

            // 1. Kontext-Menü schließen (wenn Klick außerhalb)
            if (contextModal && contextModal.style.display === 'block') {
                if (!contextModal.contains(e.target) && !e.target.closest('.grid-cell')) {
                    contextModal.style.display = 'none';
                }
            }

            // 2. Query Modal schließen (Klick auf den dunklen Hintergrund)
            if (queryModal && e.target === queryModal) {
                queryModal.style.display = 'none';
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

        // --- NEU: Marktplatz Status prüfen (Timer / Ghost) ---
        const ghostData = (PlanState.marketTimerTargets || {})[shiftKey]; // Eingehend (Empfänger)
        const outgoingData = (PlanState.marketTimerSources || {})[shiftKey]; // Ausgehend (Sender)

        const isGhost = !!ghostData;
        const isOutgoing = !!outgoingData;
        // -------------------------------------

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

        // 1. Marktplatz Modul prüfen (Buttons für Angebote in Tauschbörse)
        if (MarketModule.renderModalActions(marketSection, PlanState.clickModalContext, this.renderGrid, () => modal.style.display = 'none')) {
            hasContent = true;
        }

        // 2. Tausch-Anträge prüfen (Pending UND Approved für Rollback) - ALTES SYSTEM (Legacy)
        const activeReq = PlanState.currentChangeRequests.find(req =>
            (req.status === 'pending' || req.status === 'approved') &&
            (req.shift_date ? req.shift_date.split('T')[0] : null) === dateStr &&
            // Check: Ist der angeklickte User beteiligt?
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

                        delLink.onclick = (e) => {
                            if(e) e.stopPropagation();
                            document.getElementById('click-action-modal').style.display = 'none';
                            PlanHandlers.deleteShiftQuery(wunsch.id);
                        };
                    }
                }
                hasContent = true;
            } else if (!wunsch) {
                // --- UPDATE: ZUERST PRÜFEN OB AKTIVER TAUSCH LÄUFT (TIMER/GHOST) ---
                if (isGhost || isOutgoing) {
                     if (sections.hfRequests) {
                         sections.hfRequests.style.display = 'block';
                         sections.hfRequests.innerHTML = ''; // Leeren

                         // Info-Box
                         const infoBox = document.createElement('div');
                         infoBox.style.cssText = "background: rgba(52, 152, 219, 0.1); border: 1px solid #3498db; color: #3498db; padding: 10px; border-radius: 5px; text-align: center; font-size: 13px; margin-bottom: 5px;";
                         infoBox.innerHTML = `<i class="fas fa-exchange-alt fa-spin"></i> Tausch in Bearbeitung...`;
                         sections.hfRequests.appendChild(infoBox);

                         // Button zum Abbrechen
                         const cancelBtn = document.createElement('button');
                         cancelBtn.className = 'cam-button reject'; // Rot
                         cancelBtn.style.width = '100%';
                         cancelBtn.innerHTML = '<i class="fas fa-times"></i> Vorgang abbrechen';

                         // ID finden (transaction_id oder id)
                         const activeData = isGhost ? ghostData : outgoingData;
                         const transactionId = activeData.transaction_id || activeData.id;

                         cancelBtn.onclick = () => {
                             // --- ANPASSUNG: Custom Confirm Dialog ---
                             window.dhfConfirm("Tausch abbrechen", "Möchtest du diesen Tauschvorgang wirklich abbrechen?", async () => {
                                 // Button deaktivieren
                                 cancelBtn.disabled = true;
                                 cancelBtn.textContent = "Breche ab...";

                                 try {
                                     // --- ANPASSUNG: apiFetch Signatur korrigiert (String statt Objekt) ---
                                     await apiFetch(`/api/market/transactions/${transactionId}/cancel`, 'POST');

                                     document.getElementById('click-action-modal').style.display = 'none';

                                     // Grid neu laden
                                     if(this.renderGrid) this.renderGrid();
                                 } catch(e) {
                                     // --- ANPASSUNG: Custom Alert Dialog ---
                                     window.dhfAlert("Fehler", "Fehler beim Abbrechen: " + e.message, "error");

                                     cancelBtn.disabled = false;
                                     cancelBtn.innerHTML = '<i class="fas fa-times"></i> Vorgang abbrechen';
                                 }
                             });
                         };
                         sections.hfRequests.appendChild(cancelBtn);
                     }
                     hasContent = true;

                } else if (hasActiveShift) {
                    // Normale Schicht (kein Tausch) -> Hinweis
                    if (sections.hfRequests) {
                        sections.hfRequests.style.display = 'block';
                        sections.hfRequests.innerHTML = `
                           <div style="background: rgba(255,255,255,0.05); color: #bdc3c7; padding: 10px; border-radius: 5px; text-align: center; font-size: 12px; border: 1px dashed #555;">
                               Schicht bereits eingetragen.<br>Nutze die Tauschbörse.
                           </div>
                        `;
                    }
                    hasContent = true;

                } else if (activeReq && activeReq.status === 'pending') {
                     // Fallback für altes Tauschsystem
                     if (sections.hfRequests) {
                         sections.hfRequests.style.display = 'block';
                         sections.hfRequests.innerHTML = `
                            <div style="background: rgba(243, 156, 18, 0.1); border: 1px solid #f39c12; color: #f39c12; padding: 10px; border-radius: 5px; text-align: center; font-size: 13px;">
                                <i class="fas fa-sync fa-spin"></i> Tausch (Legacy) in Bearbeitung.<br>
                                Keine Wunschanfrage möglich.
                            </div>
                         `;
                     }
                     hasContent = true;
                } else {
                    // Alles frei -> Zeige Wunsch-Buttons
                    if(sections.hfRequests) {
                        sections.hfRequests.style.display = 'flex';
                        sections.hfRequests.innerHTML = '';
                        this.populateHfButtons();
                    }
                    hasContent = true;
                }
            }
        }

        if (!hasContent) return;

        this._positionModal(cell, modal);
    },

    // --- Helper für Modal-Inhalt ---

    _renderTradeSection(req, anchorElement) {
        const tradeSection = document.createElement('div');
        tradeSection.id = 'cam-trade-section';
        tradeSection.className = 'cam-section';

        if (req.status === 'pending') {
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

            // FIX: Klick-Handler hinzufügen
            link.onclick = (e) => {
                e.stopPropagation();
                document.getElementById('click-action-modal').style.display = 'none';
                this.openQueryModal(notiz);
            };
        }
    },

    // --- REPARIERTE MODAL ÖFFNEN LOGIK ---
    openQueryModal(existingQuery) {
        // Kontext für Speichern setzen
        const context = PlanState.clickModalContext;
        PlanState.modalQueryContext = {
            userId: context.userId,
            dateStr: context.dateStr,
            userName: context.userName,
            queryId: existingQuery ? existingQuery.id : null
        };

        const modal = document.getElementById('query-modal');
        const title = document.getElementById('query-modal-title');
        const info = document.getElementById('query-modal-info');
        const existingContainer = document.getElementById('query-existing-container');
        const newContainer = document.getElementById('query-new-container');
        const replyForm = document.getElementById('query-reply-form');
        const msgInput = document.getElementById('query-message-input');
        const statusEl = document.getElementById('query-modal-status');
        const existingMsg = document.getElementById('query-existing-message');
        const adminActions = document.getElementById('query-admin-actions');
        const resolveBtn = document.getElementById('query-resolve-btn');
        const deleteBtn = document.getElementById('query-delete-btn');
        const repliesList = document.getElementById('query-replies-list');
        const replyBtn = document.getElementById('reply-submit-btn');
        const submitBtn = document.getElementById('query-submit-btn');
        const targetSelection = document.getElementById('query-target-selection');
        const closeBtn = document.getElementById('close-query-modal');

        if(!modal) return;

        // 1. FIX: Close Button Handler explizit setzen (überschreiben)
        if (closeBtn) {
            closeBtn.onclick = () => {
                modal.style.display = 'none';
            };
        }

        // Reset UI
        title.textContent = existingQuery ? "Notiz / Anfrage Details" : "Neue Notiz / Anfrage";
        info.textContent = `${context.userName} am ${new Date(context.dateStr).toLocaleDateString('de-DE')}`;
        statusEl.textContent = "";
        msgInput.value = "";

        // Ziel-Auswahl anzeigen?
        if (targetSelection) {
            if (!existingQuery && (PlanState.isAdmin || PlanState.isHundefuehrer)) {
                targetSelection.style.display = 'block';
                const radioUser = document.getElementById('target-type-user');
                if(radioUser) radioUser.checked = true;
            } else {
                targetSelection.style.display = 'none';
            }
        }


        if (existingQuery) {
            // Ansicht: Existierend
            newContainer.style.display = 'none';
            existingContainer.style.display = 'block';
            replyForm.style.display = 'block';

            existingMsg.textContent = existingQuery.message;

            // Admin Aktionen
            if (PlanState.isAdmin || PlanState.isPlanschreiber) {
                adminActions.style.display = 'flex';
                resolveBtn.onclick = () => PlanHandlers.resolveShiftQuery(existingQuery.id, () => modal.style.display='none');
                deleteBtn.onclick = () => PlanHandlers.deleteShiftQuery(existingQuery.id, () => modal.style.display='none');
            } else if (PlanState.isHundefuehrer && existingQuery.sender_user_id === PlanState.loggedInUser.id) {
                // HF darf eigene löschen
                adminActions.style.display = 'flex';
                resolveBtn.style.display = 'none';
                deleteBtn.textContent = 'Anfrage zurückziehen';
                deleteBtn.onclick = () => PlanHandlers.deleteShiftQuery(existingQuery.id, () => modal.style.display='none');
            } else {
                adminActions.style.display = 'none';
            }

            // Replies laden
            if (repliesList) {
                repliesList.innerHTML = '<li style="color:#aaa;">Lade Verlauf...</li>';
                this.loadAndRenderModalConversation(existingQuery.id);
            }

            // 2. FIX: Reply Handler sauber setzen (Direkt PlanApi statt PlanHandler nutzen)
            if (replyBtn) {
                // Wir überschreiben onclick, kein Klonen nötig
                replyBtn.onclick = async () => {
                    const txt = document.getElementById('reply-message-input').value.trim();
                    if(!txt) { alert("Bitte Text eingeben."); return; }

                    replyBtn.disabled = true;
                    replyBtn.textContent = 'Sende...';

                    try {
                        await PlanApi.sendQueryReply(existingQuery.id, txt);
                        document.getElementById('reply-message-input').value = '';
                        this.loadAndRenderModalConversation(existingQuery.id);
                    } catch (e) {
                        alert("Fehler: " + e.message);
                    } finally {
                        replyBtn.disabled = false;
                        replyBtn.textContent = 'Antwort senden';
                    }
                };
            }

        } else {
            // Ansicht: Neu
            existingContainer.style.display = 'none';
            replyForm.style.display = 'none';
            newContainer.style.display = 'block';

            // Submit Handler für neue Anfragen
            if (submitBtn) {
                 submitBtn.onclick = () => {
                     const txt = msgInput.value;
                     if(!txt) { statusEl.textContent = "Bitte Text eingeben."; return; }
                     PlanHandlers.saveShiftQuery(txt, () => modal.style.display='none');
                 };
            }
        }

        modal.style.display = 'block';
    },

    _positionModal(cell, modal) {
        const cellRect = cell.getBoundingClientRect();
        const modalWidth = 300;
        let left = cellRect.left + window.scrollX;
        let top = cellRect.bottom + window.scrollY + 5;

        if (left + modalWidth > document.documentElement.clientWidth) {
            left = document.documentElement.clientWidth - modalWidth - 10;
        }

        modal.style.left = `${left}px`;
        modal.style.top = `${top}px`;
        modal.style.display = 'block';
    },

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
                    PlanState.modalContext = { userId: PlanState.clickModalContext.userId, dateStr: PlanState.clickModalContext.dateStr };
                    document.getElementById('shift-modal-title').textContent = "Alle Schichten";
                    document.getElementById('shift-modal-info').textContent = `Für: ${PlanState.clickModalContext.userName}`;
                    document.getElementById('shift-modal').style.display = 'block';
                } else {
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

                const limit = usage[def.abbr];
                let disabled = false;
                let info = '';

                if (limit) {
                    if (limit.remaining <= 0) { disabled = true; info = '(0)'; }
                    else { info = `(${limit.remaining})`; }
                }

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

    async confirmApproveTrade(reqId) {
        window.dhfConfirm("Genehmigen", "Diesen Tausch genehmigen?", async () => {
            try {
                await PlanApi.approveShiftChangeRequest(reqId);
                document.getElementById('click-action-modal').style.display = 'none';
            } catch (e) {
                window.dhfAlert("Fehler", e.message, "error");
            }
        });
    },

    async confirmRejectTrade(reqId) {
        window.dhfConfirm("Aktion bestätigen", "Diesen Vorgang ablehnen bzw. rückgängig machen?", async () => {
            try {
                await PlanApi.rejectShiftChangeRequest(reqId);
                document.getElementById('click-action-modal').style.display = 'none';
                if (this.renderGrid) this.renderGrid();
            } catch (e) {
                window.dhfAlert("Fehler", e.message, "error");
            }
        });
    },

    async loadAndRenderModalConversation(queryId) {
        const repliesList = document.getElementById('query-replies-list');
        if (!repliesList) return;

        try {
            const replies = await apiFetch(`/api/queries/${queryId}/replies`);
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

            const container = document.getElementById('query-conversation-container');
            if(container) container.scrollTop = container.scrollHeight;

        } catch (e) {
            console.error("Fehler beim Laden der Antworten:", e);
        }
    }
};