// html/js/modules/schichtplan_market.js

import { apiFetch } from '../utils/api.js';
import { PlanState } from './schichtplan_state.js';

export const MarketModule = {

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

        // A) Eigene Schicht anbieten (Eigene Zeile + Hat Schicht + Ist HF)
        if (context.isCellOnOwnRow && PlanState.isHundefuehrer) {

            const ALLOWED_MARKET_SHIFTS = ["T.", "N.", "6", "24", "S", "QA"];

            // Wenn keine Arbeitsschicht oder nicht in der Whitelist
            if (!currentShift || !currentShift.shifftype_id || !currentShift.shift_type ||
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

            // Verhindern, dass man eigene Angebote kommentiert
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

            // NEU: Buttons für Interesse / Ablehnung
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
     * Ersetzt die alte 'Accept' Logik durch das Reaktionen-Modal.
     */
    _renderReactionButtons(container, offer, reloadCallback, closeCallback) {
        const wrapper = document.createElement('div');
        wrapper.id = 'cam-reaction-wrapper';
        wrapper.style.display = 'grid';
        wrapper.style.gridTemplateColumns = '1fr 1fr';
        wrapper.style.gap = '8px';
        wrapper.style.marginBottom = '10px';

        const hasResponded = offer.my_response !== null;

        let interestButton;
        let declineButton;

        if (offer.my_response === 'interested') {
            interestButton = document.createElement('button');
            interestButton.className = 'cam-button approve';
            interestButton.textContent = 'Interesse bekundet (Ändern)';
            // Info anzeigen, dass man in den Markt muss, um zu ändern
            interestButton.onclick = () => window.dhfAlert("Interesse Bekundet", "Du hast bereits Interesse bekundet. Dein Partner wartet nun auf den Zuschlag. Du kannst deine Reaktion im Markt-Tab ändern.", "info");
            interestButton.style.gridColumn = '1 / -1';
        } else {
             interestButton = document.createElement('button');
             interestButton.className = 'cam-button approve';
             interestButton.textContent = 'Interesse bekunden';
             interestButton.onclick = () => {
                 if(closeCallback) closeCallback();
                 // Ruft den globalen Stub in schichtplan.js auf, der zum Markt umleitet
                 window.openReactionModal(offer.id, 'interested');
             };
        }

        if (offer.my_response === 'declined') {
            declineButton = document.createElement('button');
            declineButton.className = 'cam-button reject';
            declineButton.textContent = 'Abgesagt (Ändern)';
            // Ruft den globalen Stub in schichtplan.js auf, der zum Markt umleitet
            declineButton.onclick = () => window.openReactionModal(offer.id, 'declined');
        } else if (!hasResponded) {
             declineButton = document.createElement('button');
             declineButton.className = 'cam-button reject';
             declineButton.textContent = 'Kein Interesse';
             declineButton.onclick = () => {
                 if(closeCallback) closeCallback();
                 // Ruft den globalen Stub in schichtplan.js auf, der zum Markt umleitet
                 window.openReactionModal(offer.id, 'declined');
             };
        }

        if (offer.my_response !== 'interested') {
             wrapper.appendChild(interestButton);
        }
        if (declineButton) {
             wrapper.appendChild(declineButton);
        }

        container.appendChild(wrapper);

        if (offer.my_response === 'interested') {
            const info = document.createElement('p');
            info.style.fontSize = '11px';
            info.style.color = '#2ecc71';
            info.textContent = '✅ Du hast Interesse bekundet. Warte nun auf die Entscheidung des Anbieters.';
            container.appendChild(info);
        }
    },

    _renderTitle(container) {
        const title = document.createElement('div');
        title.className = 'cam-section-title';
        title.id = 'cam-market-title';
        title.innerHTML = '<i class="fas fa-exchange-alt"></i> Tauschbörse';
        title.style.color = '#f39c12'; // Orange/Gold
        container.appendChild(title);
    },

    _renderCancelButton(container, offer, reloadCallback, closeCallback) {
        const btn = document.createElement('button');
        btn.className = 'cam-button reject'; // Rot
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
        btn.className = 'cam-button approve'; // Grün
        btn.style.width = '100%';
        btn.innerHTML = '<i class="fas fa-share-alt"></i> In Tauschbörse anbieten';

        btn.onclick = () => {
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
        const offers = PlanState.currentMarketOffers || {};
        const offerList = Object.values(offers);

        const badge = document.getElementById('market-badge');
        if (badge) {
            const count = offerList.filter(o => o.status === 'active' && !o.is_my_offer).length;
            badge.textContent = count;
            badge.style.display = count > 0 ? 'inline-block' : 'none';
        }

        if (!PlanState.isHundefuehrer) return;

        const relevantOffers = offerList.filter(o => o.status === 'active' && !o.is_my_offer);
        const bannerId = 'market-banner-notification';
        let banner = document.getElementById(bannerId);

        if (relevantOffers.length > 0) {
            // ... (Banner Logic) ...
        } else {
            if (banner) banner.style.display = 'none';
        }
    }
};

// **ENDE DER DATEI**
// Die fehlerhaften globalen Stubs wurden entfernt.