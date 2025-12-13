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

        // Prüfen ob ein Angebot existiert (egal von wem)
        const existingOffer = PlanState.currentMarketOffers ? PlanState.currentMarketOffers[shiftKey] : null;

        // --- SCHRITT 2: Vergangenheits-Check ---
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const shiftDate = new Date(context.dateStr);
        shiftDate.setHours(0, 0, 0, 0);

        if (shiftDate < today) {
            return false; // Keine Aktionen für die Vergangenheit
        }

        // --- SCHRITT 3: Entscheidungsweg (Eigene Schicht vs. Fremde Schicht) ---

        // A) Eigene Schicht (Nutzer hat auf SEINE Zeile geklickt)
        if (context.isCellOnOwnRow && PlanState.isHundefuehrer) {

            // Wenn keine echte Schicht da ist, können wir nichts anbieten
            if (!currentShift || !currentShift.shifttype_id || !currentShift.shift_type) {
                return false;
            }

            // --- NEU: Whitelist-Check ---
            // Nur erlaubte Arbeitsschichten dürfen getauscht werden.
            // Urlaub (EU), Wunschfrei (X) etc. sind ausgeschlossen.
            const ALLOWED_MARKET_SHIFTS = ["T.", "N.", "6", "24"];

            // Wir prüfen das Kürzel (abbreviation) der Schicht
            if (!ALLOWED_MARKET_SHIFTS.includes(currentShift.shift_type.abbreviation)) {
                return false;
            }

            container.style.display = 'block';
            this._renderTitle(container);

            if (existingOffer) {
                // Angebot existiert -> Zurückziehen
                this._renderCancelButton(container, existingOffer, reloadCallback, closeCallback);
            } else {
                // Kein Angebot -> Erstellen
                this._renderOfferButton(container, currentShift, reloadCallback, closeCallback);
            }
            return true;
        }

        // B) Fremde Schicht (Nutzer hat auf ANDERE Zeile geklickt)
        // Voraussetzung: Es gibt ein Angebot UND der Nutzer darf übernehmen
        // (Nur HF oder Admin - Planschreiber "laufen" keine Schichten)
        const canAccept = PlanState.isHundefuehrer || PlanState.isAdmin;

        if (!context.isCellOnOwnRow && existingOffer && canAccept) {

            // Verhindern, dass man eigene Angebote übernimmt
            if (existingOffer.offering_user_id === PlanState.loggedInUser.id) {
                return false;
            }

            container.style.display = 'block';
            this._renderTitle(container);

            // Info über den Anbieter
            const info = document.createElement('div');
            info.style.fontSize = '12px';
            info.style.color = '#bdc3c7';
            info.style.marginBottom = '5px';
            info.innerHTML = `Angebot von: <strong>${existingOffer.offering_user_name}</strong>`;
            container.appendChild(info);

            // Button zum Übernehmen
            this._renderAcceptButton(container, existingOffer, context.dateStr, reloadCallback, closeCallback);

            // Notiz anzeigen falls vorhanden
            if (existingOffer.note) {
                const noteEl = document.createElement('div');
                noteEl.style.fontSize = '11px';
                noteEl.style.fontStyle = 'italic';
                noteEl.style.color = '#f1c40f';
                noteEl.style.marginTop = '5px';
                noteEl.textContent = `"${existingOffer.note}"`;
                container.appendChild(noteEl);
            }

            return true;
        }

        return false;
    },

    // --- Interne Helper Methoden für UI Rendering ---

    _renderTitle(container) {
        const title = document.createElement('div');
        title.className = 'cam-section-title';
        title.innerHTML = '<i class="fas fa-exchange-alt"></i> Tauschbörse';
        title.style.color = '#f39c12'; // Orange/Gold
        container.appendChild(title);
    },

    _renderCancelButton(container, offer, reloadCallback, closeCallback) {
        const btn = document.createElement('button');
        btn.className = 'cam-button reject'; // Rot
        btn.style.width = '100%';
        btn.innerHTML = '<i class="fas fa-undo"></i> Angebot zurückziehen';

        btn.onclick = async () => {
             if(confirm("Möchtest du dieses Angebot wirklich aus der Tauschbörse entfernen?")) {
                 try {
                    // DIREKTER API CALL
                    await apiFetch(`/api/market/offer/${offer.id}`, 'DELETE');
                    if(reloadCallback) reloadCallback();
                    if(closeCallback) closeCallback();
                 } catch(e) {
                     alert("Fehler: " + e.message);
                 }
             }
        };
        container.appendChild(btn);
    },

    _renderOfferButton(container, shift, reloadCallback, closeCallback) {
        const btn = document.createElement('button');
        btn.className = 'cam-button approve'; // Grün
        btn.style.width = '100%';
        btn.innerHTML = '<i class="fas fa-share-alt"></i> In Tauschbörse anbieten';

        btn.onclick = async () => {
             const note = prompt("Notiz für Kollegen (optional, z.B. 'Suche Wochenende'):", "");
             if (note !== null) {
                 try {
                    // DIREKTER API CALL
                    await apiFetch('/api/market/offer', 'POST', { shift_id: shift.id, note: note });
                    if(reloadCallback) reloadCallback();
                    if(closeCallback) closeCallback();
                 } catch(e) {
                     alert("Fehler: " + e.message);
                 }
             }
        };
        container.appendChild(btn);
    },

    _renderAcceptButton(container, offer, dateStr, reloadCallback, closeCallback) {
        const btn = document.createElement('button');
        btn.className = 'cam-button approve'; // Grün
        btn.style.width = '100%';
        btn.innerHTML = `<i class="fas fa-hand-holding-heart"></i> Übernehmen (${offer.shift_type_abbr})`;

        btn.onclick = async () => {
            const dateDisplay = new Date(dateStr).toLocaleDateString('de-DE');
            const msg = `Möchtest du die Schicht (${offer.shift_type_abbr}) am ${dateDisplay} von ${offer.offering_user_name} wirklich übernehmen?\n\nDies erstellt einen Antrag, der noch genehmigt werden muss (oder sofort wirksam wird, falls du Admin bist).`;

            if (confirm(msg)) {
                try {
                    // DIREKTER API CALL
                    const res = await apiFetch(`/api/market/accept/${offer.id}`, 'POST');
                    alert(res.message || "Erfolgreich beantragt!");

                    if(reloadCallback) reloadCallback();
                    if(closeCallback) closeCallback();
                } catch (e) {
                    alert("Fehler: " + e.message);
                }
            }
        };
        container.appendChild(btn);
    },

    updateMarketNotifications() {
        const offers = PlanState.currentMarketOffers || {};
        const offerList = Object.values(offers);

        const badge = document.getElementById('market-badge');
        if (badge) {
            const count = offerList.length;
            badge.textContent = count;
            badge.style.display = count > 0 ? 'inline-block' : 'none';
        }

        if (!PlanState.isHundefuehrer) return;

        const relevantOffers = offerList.filter(o => !o.is_my_offer);
        const bannerId = 'market-banner-notification';
        let banner = document.getElementById(bannerId);

        if (relevantOffers.length > 0) {
            if (!banner) {
                banner = document.createElement('div');
                banner.id = bannerId;
                banner.style.cssText = `
                    background: linear-gradient(90deg, #27ae60, #2ecc71);
                    color: white;
                    padding: 12px;
                    text-align: center;
                    font-weight: 600;
                    position: sticky;
                    top: 0;
                    z-index: 9998;
                    cursor: pointer;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
                    display: flex; justify-content: center; align-items: center; gap: 10px;
                    animation: slideDown 0.5s ease-out;
                `;
                banner.onclick = () => window.location.href = 'market.html';
                const mainContainer = document.querySelector('.main-content') || document.body;
                if (mainContainer === document.body) document.body.prepend(banner);
                else mainContainer.parentNode.insertBefore(banner, mainContainer);
            }
            banner.innerHTML = `<i class="fas fa-tags"></i><span>Es gibt <u>${relevantOffers.length} neue Angebote</u> in der Tauschbörse!</span><i class="fas fa-arrow-right"></i>`;
            banner.style.display = 'flex';
        } else {
            if (banner) banner.style.display = 'none';
        }
    }
};