// html/js/modules/schichtplan_market.js

import { apiFetch } from '../utils/api.js';
import { PlanApi } from './schichtplan_api.js';
import { PlanState } from './schichtplan_state.js';

export const MarketModule = {

    /**
     * Initialisiert das Modul (Modal injecten).
     * Muss beim Start von schichtplan.js aufgerufen werden.
     */
    init() {
        this._injectReactionModal();
    },

    /**
     * Injected das Modal für Reaktionen in den DOM, falls nicht vorhanden.
     */
    _injectReactionModal() {
        if (document.getElementById('plan-market-response-modal')) return;

        const modalHtml = `
            <div id="plan-market-response-modal" class="modal">
                <div class="modal-content" style="max-width: 400px;">
                    <div class="modal-header">
                        <h2 id="pmr-title">Reaktion</h2>
                        <span class="close" id="pmr-close">&times;</span>
                    </div>
                    <div class="modal-body">
                        <p id="pmr-info" style="color:#7f8c8d; font-size:13px; margin-bottom:15px;"></p>
                        <div class="form-group">
                            <label style="color:#bdc3c7;">Notiz / Nachricht (Optional):</label>
                            <textarea id="pmr-note" rows="3" style="width:98%; padding:10px; background:rgba(0,0,0,0.1); border:1px solid #ccc; border-radius:5px; color:#333;"></textarea>
                        </div>
                        <div style="text-align:right; margin-top:15px;">
                            <button id="pmr-submit-btn" class="btn-primary" style="background-color: #2ecc71; border: none; padding: 10px 20px; color: white; border-radius: 4px; cursor: pointer;">Absenden</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Event Listener
        const closeBtn = document.getElementById('pmr-close');
        const modal = document.getElementById('plan-market-response-modal');
        const submitBtn = document.getElementById('pmr-submit-btn');

        if(closeBtn) closeBtn.onclick = () => modal.style.display = 'none';
        if(submitBtn) submitBtn.onclick = () => this.submitReaction();

        window.addEventListener('click', (e) => {
            if (e.target === modal) modal.style.display = 'none';
        });
    },

    // State für das aktive Modal
    currentOfferId: null,
    currentResponseType: null,
    reloadCallback: null,

    /**
     * Öffnet das lokale Reaktionen-Modal.
     */
    openReactionModal(offerId, type, offerInfo, reloadFn) {
        this.currentOfferId = offerId;
        this.currentResponseType = type;
        this.reloadCallback = reloadFn;

        const modal = document.getElementById('plan-market-response-modal');
        const title = document.getElementById('pmr-title');
        const info = document.getElementById('pmr-info');
        const note = document.getElementById('pmr-note');
        const btn = document.getElementById('pmr-submit-btn');

        if (!modal) return;

        note.value = '';

        if (type === 'interested') {
            title.textContent = "Interesse bekunden";
            title.style.color = "#2ecc71";
            info.textContent = `Du möchtest die Schicht von ${offerInfo.offering_user_name} übernehmen.`;
            btn.textContent = "Interesse senden";
            btn.style.backgroundColor = "#2ecc71";
            note.placeholder = "z.B. 'Gerne, passt mir gut!'";
        } else {
            title.textContent = "Kein Interesse / Absage";
            title.style.color = "#e74c3c";
            info.textContent = `Du lehnst das Angebot von ${offerInfo.offering_user_name} ab.`;
            btn.textContent = "Absage senden";
            btn.style.backgroundColor = "#e74c3c";
            note.placeholder = "Optional: Grund (z.B. 'Privater Termin')";
        }

        modal.style.display = 'block';
        // Fokus auf Textarea
        setTimeout(() => note.focus(), 100);
    },

    async submitReaction() {
        const btn = document.getElementById('pmr-submit-btn');
        const note = document.getElementById('pmr-note').value;
        const modal = document.getElementById('plan-market-response-modal');

        if(!this.currentOfferId) return;

        btn.disabled = true;
        btn.textContent = "Sende...";

        try {
            await PlanApi.reactToMarketOffer(this.currentOfferId, this.currentResponseType, note);

            // Erfolg
            modal.style.display = 'none';
            if (window.dhfAlert) window.dhfAlert("Gesendet", "Deine Reaktion wurde gespeichert.", "success");

            // Grid neu laden
            if (this.reloadCallback) this.reloadCallback(true); // Silent reload

        } catch (e) {
            // --- FIX: ORAKEL ALERT STATT BROWSER ALERT ---
            if (window.dhfAlert) {
                // Wir nutzen den Titel "Nicht möglich", da es meist Regelverletzungen sind
                window.dhfAlert("Nicht möglich", e.message, "error");
            } else {
                alert("Fehler: " + e.message);
            }
        } finally {
            btn.disabled = false;
            btn.textContent = "Absenden";
        }
    },

    /**
     * Bricht eine aktive Transaktion (Interesse) ab.
     * Nutzt die my_response_id aus dem Backend.
     */
    async cancelMarketResponse(responseId, reloadCallback, closeCallback) {
        if (!responseId) {
            if (window.dhfAlert) window.dhfAlert("Fehler", "Keine gültige Vorgangs-ID gefunden.", "error");
            return;
        }

        window.dhfConfirm("Vorgang abbrechen", "Möchtest du dein Interesse an dieser Schicht wirklich zurückziehen?", async () => {
            try {
                // Aufruf der neuen API-Route zum Abbrechen
                await apiFetch(`/api/market/transactions/${responseId}/cancel`, 'POST');

                if (window.dhfAlert) window.dhfAlert("Erfolg", "Dein Interesse wurde zurückgezogen.", "success");

                if (reloadCallback) reloadCallback();
                if (closeCallback) closeCallback();
            } catch (e) {
                if (window.dhfAlert) window.dhfAlert("Fehler", e.message, "error");
            }
        });
    },

    /**
     * Prüft, ob Marktplatz-Aktionen für die aktuelle Auswahl möglich sind
     * und rendert die entsprechenden Buttons in den Container.
     */
    renderModalActions(container, context, reloadCallback, closeCallback) {

        // Reset
        container.innerHTML = '';
        container.style.display = 'none';

        // --- SCHRITT 1: Daten vorbereiten ---
        const shiftKey = `${context.userId}-${context.dateStr}`;
        const currentShift = PlanState.currentShifts[shiftKey];
        const existingOffer = PlanState.currentMarketOffers ? PlanState.currentMarketOffers[shiftKey] : null;

        // --- SCHRITT 2: Vergangenheits-Check ---
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const shiftDate = new Date(context.dateStr);
        shiftDate.setHours(0, 0, 0, 0);

        if (shiftDate < today) {
            return false; // Keine Aktionen für die Vergangenheit
        }

        // --- SCHRITT 3: Entscheidungsweg ---

        let hasContent = false;

        // A) Eigene Schicht anbieten (Eigene Zeile + Hat Schicht + (Ist HF ODER Admin))
        if (context.isCellOnOwnRow && (PlanState.isHundefuehrer || PlanState.isAdmin)) {

            const ALLOWED_MARKET_SHIFTS = ["T.", "N.", "6", "24", "S", "QA"];

            // Wenn keine Arbeitsschicht oder nicht in der Whitelist
            if (!currentShift || !currentShift.shifttype_id || !currentShift.shift_type ||
                !ALLOWED_MARKET_SHIFTS.includes(currentShift.shift_type.abbreviation)) {
                return false;
            }

            container.style.display = 'block';
            this._renderTitle(container);
            hasContent = true;

            if (existingOffer) {
                // Angebot existiert -> Zurückziehen
                this._renderCancelButton(container, existingOffer, reloadCallback, closeCallback);
            } else {
                // Kein Angebot -> Erstellen
                this._renderOfferButton(container, currentShift, reloadCallback, closeCallback);
            }
        }

        // B) Fremde Schicht reagieren (Fremde Zeile + Es gibt ein aktives Angebot)
        const canReact = PlanState.isHundefuehrer || PlanState.isAdmin;

        if (!context.isCellOnOwnRow && existingOffer && existingOffer.status === 'active' && canReact) {

            // Verhindern, dass man eigene Angebote kommentiert (falls man als Admin drauf klickt)
            if (existingOffer.offering_user_id === PlanState.loggedInUser.id) {
                return false;
            }

            container.style.display = 'block';
            this._renderTitle(container);
            hasContent = true;

            // Info über den Anbieter
            const info = document.createElement('div');
            info.style.fontSize = '12px';
            info.style.color = '#bdc3c7';
            info.style.marginBottom = '10px';
            info.innerHTML = `Angebot von: <strong>${existingOffer.offering_user_name}</strong>`;
            container.appendChild(info);

            // Buttons für Interesse / Ablehnung / Abbruch
            this._renderReactionButtons(container, existingOffer, reloadCallback, closeCallback);

            // Notiz anzeigen falls vorhanden
            if (existingOffer.note) {
                const noteEl = document.createElement('div');
                noteEl.style.fontSize = '11px';
                noteEl.style.fontStyle = 'italic';
                noteEl.style.color = '#f1c40f';
                noteEl.textContent = `"${existingOffer.note}"`;
                container.appendChild(noteEl);
            }

        }

        return hasContent;
    },

    /**
     * Render Buttons für Reaktionen (Interesse/Absage/Abbruch).
     */
    _renderReactionButtons(container, offer, reloadCallback, closeCallback) {
        const wrapper = document.createElement('div');
        wrapper.id = 'cam-reaction-wrapper';
        wrapper.style.display = 'flex';
        wrapper.style.flexDirection = 'column';
        wrapper.style.gap = '8px';
        wrapper.style.marginBottom = '10px';

        const hasResponded = offer.my_response !== null;

        if (offer.my_response === 'interested') {
            // 1. Button: Vorgang abbrechen (Löscht das Interesse)
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'cam-button reject';
            cancelBtn.innerHTML = '<i class="fas fa-undo"></i> Vorgang abbrechen';
            cancelBtn.title = "Vorgang abbrechen / Interesse zurückziehen";
            cancelBtn.onclick = () => {
                this.cancelMarketResponse(offer.my_response_id, reloadCallback, closeCallback);
            };
            wrapper.appendChild(cancelBtn);

            // 2. Button: Notiz ändern (Öffnet Modal zum Editieren)
            const changeBtn = document.createElement('button');
            changeBtn.className = 'cam-button approve';
            changeBtn.textContent = 'Notiz ändern';
            changeBtn.onclick = () => {
                if(closeCallback) closeCallback();
                this.openReactionModal(offer.id, 'interested', offer, reloadCallback);
            };
            wrapper.appendChild(changeBtn);

        } else {
            // Grid-Layout für Interesse / Absage, wenn noch nicht reagiert wurde
            const gridWrapper = document.createElement('div');
            gridWrapper.style.display = 'grid';
            gridWrapper.style.gridTemplateColumns = '1fr 1fr';
            gridWrapper.style.gap = '8px';

            const interestButton = document.createElement('button');
            interestButton.className = 'cam-button approve';
            interestButton.textContent = 'Interesse';
            interestButton.onclick = () => {
                if(closeCallback) closeCallback();
                this.openReactionModal(offer.id, 'interested', offer, reloadCallback);
            };
            gridWrapper.appendChild(interestButton);

            if (offer.my_response === 'declined') {
                const declineButton = document.createElement('button');
                declineButton.className = 'cam-button reject';
                declineButton.textContent = 'Absage (Ändern)';
                declineButton.onclick = () => {
                    if(closeCallback) closeCallback();
                    this.openReactionModal(offer.id, 'declined', offer, reloadCallback);
                };
                gridWrapper.appendChild(declineButton);
            } else if (!hasResponded) {
                const declineButton = document.createElement('button');
                declineButton.className = 'cam-button reject';
                declineButton.textContent = 'Kein Interesse';
                declineButton.onclick = () => {
                    if(closeCallback) closeCallback();
                    this.openReactionModal(offer.id, 'declined', offer, reloadCallback);
                };
                gridWrapper.appendChild(declineButton);
            }
            wrapper.appendChild(gridWrapper);
        }

        container.appendChild(wrapper);

        if (offer.my_response === 'interested') {
            const info = document.createElement('p');
            info.style.fontSize = '11px';
            info.style.color = '#2ecc71';
            info.style.margin = '0';
            info.textContent = '✅ Interesse bekundet.';
            container.appendChild(info);
        }
    },

    _renderTitle(container) {
        const title = document.createElement('div');
        title.className = 'cam-section-title';
        title.id = 'cam-market-title';
        title.innerHTML = '<i class="fas fa-exchange-alt"></i> Tauschbörse';
        title.style.color = '#f39c12';
        container.appendChild(title);
    },

    _renderCancelButton(container, offer, reloadCallback, closeCallback) {
        const btn = document.createElement('button');
        btn.className = 'cam-button reject';
        btn.style.width = '100%';
        btn.innerHTML = '<i class="fas fa-undo"></i> Angebot zurückziehen';

        btn.onclick = () => {
             window.dhfConfirm("Zurückziehen", "Möchtest du dieses Angebot wirklich aus der Tauschbörse entfernen?", async () => {
                 try {
                    await apiFetch(`/api/market/offer/${offer.id}`, 'DELETE');
                    if(reloadCallback) reloadCallback();
                    if(closeCallback) closeCallback();
                 } catch(e) {
                     window.dhfAlert("Fehler", e.message, "error");
                 }
             });
        };
        container.appendChild(btn);
    },

    _renderOfferButton(container, shift, reloadCallback, closeCallback) {
        const btn = document.createElement('button');
        btn.className = 'cam-button approve';
        btn.style.width = '100%';
        btn.innerHTML = '<i class="fas fa-share-alt"></i> In Tauschbörse anbieten';

        btn.onclick = () => {
             // Hier nutzen wir Prompt für die Notiz
             window.dhfPrompt("Anbieten", "Notiz für Kollegen (optional):", "", async (note) => {
                 try {
                    await apiFetch('/api/market/offer', 'POST', { shift_id: shift.id, note: note });
                    if(reloadCallback) reloadCallback();
                    if(closeCallback) closeCallback();
                 } catch(e) {
                     window.dhfAlert("Fehler", e.message, "error");
                 }
             });
        };
        container.appendChild(btn);
    },

    updateMarketNotifications() {
        // ... (Bleibt gleich, nur Badge Update)
    }
};