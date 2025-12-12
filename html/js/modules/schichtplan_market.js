// html/js/modules/schichtplan_market.js

import { PlanApi } from './schichtplan_api.js';
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

        // 1. Prüfungen: Nur Hundeführer, nur eigene Zeile
        if (!PlanState.isHundefuehrer || !context.isCellOnOwnRow) {
            return false;
        }

        // 2. Daten prüfen
        const shiftKey = `${context.userId}-${context.dateStr}`;
        const currentShift = PlanState.currentShifts[shiftKey];

        // Keine Schicht oder eine "freie" Schicht (null/ID fehlt) -> Nichts zu tun
        if (!currentShift || !currentShift.shifttype_id) {
            return false;
        }

        // --- NEU: Vergangenheits-Check ---
        // Wir erstellen ein Datum-Objekt für Mitternacht des heutigen Tages
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const shiftDate = new Date(context.dateStr);
        // Da dateStr meist YYYY-MM-DD ist, wird es als UTC 00:00 interpretiert.
        // Um Zeitzonenprobleme zu minimieren, setzen wir auch hier die Zeit auf 0
        shiftDate.setHours(0, 0, 0, 0);

        if (shiftDate < today) {
            // Vergangene Schichten ignorieren wir im Markt-Modul
            return false;
        }
        // ---------------------------------

        // 3. Prüfen ob bereits ein Angebot existiert
        const existingOffer = PlanState.currentMarketOffers ? PlanState.currentMarketOffers[shiftKey] : null;

        // --- RENDER ---
        container.style.display = 'block';

        const title = document.createElement('div');
        title.className = 'cam-section-title';
        title.textContent = 'Tauschbörse';
        container.appendChild(title);

        if (existingOffer) {
            // Fall A: Angebot existiert -> Zurückziehen
            const btn = document.createElement('button');
            btn.className = 'cam-button reject'; // Rot
            btn.style.width = '100%';
            btn.innerHTML = '<i class="fas fa-undo"></i> Angebot zurückziehen';

            btn.onclick = async () => {
                 if(confirm("Möchtest du dieses Angebot wirklich aus der Tauschbörse entfernen?")) {
                     try {
                        await PlanApi.cancelMarketOffer(existingOffer.id);
                        if(reloadCallback) reloadCallback();
                        if(closeCallback) closeCallback();
                     } catch(e) {
                         alert("Fehler: " + e.message);
                     }
                 }
            };
            container.appendChild(btn);

        } else {
            // Fall B: Kein Angebot -> Erstellen
            const btn = document.createElement('button');
            btn.className = 'cam-button approve'; // Grün
            btn.style.width = '100%';
            btn.innerHTML = '<i class="fas fa-share-alt"></i> In Tauschbörse anbieten';

            btn.onclick = async () => {
                 const note = prompt("Notiz für Kollegen (optional, z.B. 'Suche Wochenende'):", "");
                 if (note !== null) { // Nur wenn nicht abgebrochen
                     try {
                        await PlanApi.createMarketOffer(currentShift.id, note);
                        if(reloadCallback) reloadCallback();
                        if(closeCallback) closeCallback();
                     } catch(e) {
                         alert("Fehler: " + e.message);
                     }
                 }
            };
            container.appendChild(btn);
        }

        return true;
    },

    /**
     * NEU: Aktualisiert das Banner und den Navigations-Badge
     * basierend auf den aktuellen Angeboten.
     */
    updateMarketNotifications() {
        const offers = PlanState.currentMarketOffers || {};
        const offerList = Object.values(offers);

        // 1. Badge in der Navigation aktualisieren
        const badge = document.getElementById('market-badge');
        if (badge) {
            const count = offerList.length;
            badge.textContent = count;
            badge.style.display = count > 0 ? 'inline-block' : 'none';
        }

        // 2. Banner Logik (Nur für Hundeführer, die nicht der Anbieter sind)
        if (!PlanState.isHundefuehrer) return;

        // Wir suchen Angebote, die NICHT von mir sind (also potenzielle Täusche)
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
                    z-index: 9998; /* Unter dem Krankmeldungs-Banner (9999) */
                    cursor: pointer;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
                    display: flex; justify-content: center; align-items: center; gap: 10px;
                    animation: slideDown 0.5s ease-out;
                `;

                banner.onclick = () => {
                    window.location.href = 'market.html';
                };

                const mainContainer = document.querySelector('.main-content') || document.body;
                if (mainContainer === document.body) {
                    document.body.prepend(banner);
                } else {
                    mainContainer.parentNode.insertBefore(banner, mainContainer);
                }
            }

            banner.innerHTML = `
                <i class="fas fa-tags"></i>
                <span>Es gibt <u>${relevantOffers.length} neue Angebote</u> in der Tauschbörse!</span>
                <i class="fas fa-arrow-right"></i>
            `;
            banner.style.display = 'flex';

        } else {
            if (banner) banner.style.display = 'none';
        }
    }
};