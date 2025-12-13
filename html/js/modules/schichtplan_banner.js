// html/js/modules/schichtplan_banner.js

import { PlanState } from './schichtplan_state.js';
import { PlanApi } from './schichtplan_api.js';
import { PlanRenderer } from './schichtplan_renderer.js';

/**
 * Modul für Benachrichtigungen (Banner) und visuelle Marker im Plan.
 */
export const PlanBanner = {

    /**
     * Rendert das kombinierte Benachrichtigungs-Banner (Systemnachrichten + Aufgaben).
     * Führt einen "Aggressive Merge" durch, um Server-Flash-Messages und API-Status zu vereinen.
     */
    async renderUnifiedBanner() {
        // Nur für Admins / Planschreiber / Hundeführer relevant
        if (!PlanState.isAdmin && !PlanState.isPlanschreiber && !PlanState.isHundefuehrer) return;

        try {
            const gridId = 'dhf-unified-grid';

            // 1. AUFRÄUMEN: Suche nach alten Containern und lösche sie
            const existingGrid = document.getElementById(gridId);
            if (existingGrid) existingGrid.remove();

            // 2. SERVER-BANNER KAPERN (The Hijack)
            // Wir suchen nach Containern, die typische Flask-Flash-Klassen haben
            let serverMessage = null;
            let serverAction = null;

            // Selektoren für mögliche Server-Banner
            const possibleBanners = document.querySelectorAll('.alert, .flash, .flashes div, .alert-danger, .alert-success');

            possibleBanners.forEach(el => {
                // Nur wenn das Element sichtbar ist und Text hat
                if (el.offsetParent !== null && el.innerText.trim().length > 0) {
                    // Check: Ist es das "Meldungen"-Banner?
                    if (el.innerText.includes('Meldung') || el.innerText.includes('Krankmeldung')) {
                        serverMessage = el.innerText.trim();

                        // Hat es einen Link?
                        const link = el.querySelector('a');
                        if (link) {
                            serverAction = () => window.location.href = link.href;
                        } else {
                            // Fallback Action für Meldungen
                            serverAction = () => window.location.href = 'meldungen.html';
                        }

                        // WICHTIG: Das Original-Element aus dem DOM entfernen!
                        el.remove();
                    }
                }
            });

            // 3. API DATEN HOLEN (Client-Side State)
            // Hinweis: Wir nutzen die im State gecacheten Daten, falls vorhanden,
            // oder holen sie frisch, falls PlanState leer ist (beim ersten Load).
            // Idealweise hat renderGrid() den State bereits gefüllt.

            let pendingRequests = PlanState.currentChangeRequests || [];
            if ((PlanState.isAdmin || PlanState.isPlanschreiber) && pendingRequests.length === 0) {
                 // Fallback fetch, falls State leer (selten)
                 try {
                     pendingRequests = await PlanApi.fetchPendingShiftChangeRequests();
                 } catch(e) {}
            }

            let marketOffers = [];
            if (PlanState.currentMarketOffers) {
                 marketOffers = Object.values(PlanState.currentMarketOffers).filter(o => !o.is_my_offer);
            }

            // 4. DATEN ANALYSIEREN
            const tradeReqs = pendingRequests.filter(r => r.reason_type === 'trade');
            const otherReqs = pendingRequests.filter(r => r.reason_type !== 'trade');

            const countTrade = tradeReqs.length;
            const countSick = otherReqs.length;
            const countMarket = marketOffers.length;

            // Wenn gar nichts da ist -> Abbruch
            if (!serverMessage && countTrade === 0 && countSick === 0 && countMarket === 0) return;

            // 5. GRID BAUEN (Der neue, saubere Container)
            const grid = document.createElement('div');
            grid.id = gridId;

            // Helper zum Bauen der Kacheln
            const addTile = (text, typeClass, iconClass, onClick) => {
                const div = document.createElement('div');
                div.className = `unified-banner-item ${typeClass}`;
                div.innerHTML = `<i class="fas ${iconClass}"></i> <span>${text}</span>`;
                if (onClick) div.onclick = onClick;
                grid.appendChild(div);
            };

            // Kachel 1: System / Server Nachricht (Rot)
            if (serverMessage) {
                addTile(serverMessage, 'u-banner-red', 'fa-bell', serverAction);
            }

            // Kachel 2: Krankmeldungen (Orange)
            if (countSick > 0) {
                addTile(`${countSick} Krankmeldung(en)`, 'u-banner-orange', 'fa-exclamation-triangle', () => window.location.href='anfragen.html');
            }

            // Kachel 3: Tausch-Genehmigungen (Blau)
            if (countTrade > 0) {
                addTile(`${countTrade} Tausch-Genehmigung(en)`, 'u-banner-blue', 'fa-exchange-alt', () => window.location.href='anfragen.html');
            }

            // Kachel 4: Markt-Angebote (Grün)
            if (countMarket > 0 && PlanState.isHundefuehrer) {
                addTile(`${countMarket} neue(s) Angebot(e)`, 'u-banner-green', 'fa-tags', () => window.location.href='market.html');
            }

            // 6. INJECT (Ganz oben einfügen)
            const mainContainer = document.querySelector('.main-content') || document.body;
            // Wir fügen es VOR allem anderen ein, damit es ganz oben klebt
            if (mainContainer.firstChild) {
                mainContainer.insertBefore(grid, mainContainer.firstChild);
            } else {
                mainContainer.appendChild(grid);
            }

        } catch (e) {
            console.warn("Banner Render Error:", e);
        }
    },

    /**
     * Markiert offene Tausch-Vorgänge (Sanduhr-Effekt) im Grid.
     * Visualisiert "Ausgang" (Abgeber) und "Eingang" (Empfänger).
     */
    markPendingTakeovers() {
        // Liste der aktuellen Änderungsanträge nutzen
        if (!PlanState.currentChangeRequests || PlanState.currentChangeRequests.length === 0) return;

        PlanState.currentChangeRequests.forEach(req => {
            // Wir suchen nur nach offenen Anträgen ('pending')
            if (req.status !== 'pending') return;

            const myId = PlanState.loggedInUser.id;
            const giverId = req.target_user_id; // Der ursprüngliche Besitzer (aus Backend to_dict)
            const receiverId = req.replacement_user_id; // Der neue Besitzer

            // Nur relevant, wenn ich beteiligt bin ODER Admin bin
            const isRelevantForMe = (myId === giverId || myId === receiverId || PlanState.isAdmin);
            if (!isRelevantForMe) return;

            // Datum bereinigen (Zeitstempel entfernen)
            const dateOnly = req.shift_date ? req.shift_date.split('T')[0] : null;
            if (!dateOnly) return;

            // --- 1. VISUALISIERUNG BEIM ABGEBER (GIVER) ---
            const giverCell = PlanRenderer.findCellByKey(`${giverId}-${dateOnly}`);
            if (giverCell) {
                giverCell.classList.add('pending-outgoing');

                // Icon "Ausgang" (Pfeil nach rechts oben)
                if (!giverCell.querySelector('.icon-outgoing')) {
                    const icon = document.createElement('div');
                    icon.className = 'icon-outgoing';
                    icon.innerHTML = '<i class="fas fa-share-square"></i>';
                    icon.title = `Wartet auf Übergabe an ${req.replacement_name}`;
                    giverCell.appendChild(icon);
                }
            }

            // --- 2. VISUALISIERUNG BEIM ÜBERNEHMER (RECEIVER) ---
            if (receiverId) {
                const receiverCell = PlanRenderer.findCellByKey(`${receiverId}-${dateOnly}`);
                if (receiverCell) {
                    receiverCell.classList.add('pending-incoming');

                    // Wir fügen das Kürzel der Schicht ein (Ghost Text), falls die Zelle leer ist
                    if (req.shift_abbr && (!receiverCell.textContent || receiverCell.textContent.trim() === '')) {
                         receiverCell.innerHTML = `<span class="ghost-text">${req.shift_abbr}</span>`;
                    }

                    // Icon "Eingang" (Pfeil nach unten/innen)
                    if (!receiverCell.querySelector('.icon-incoming')) {
                        const icon = document.createElement('div');
                        icon.className = 'icon-incoming';
                        icon.innerHTML = '<i class="fas fa-download"></i>';
                        icon.title = `Wartet auf Übernahme von ${req.original_user_name}`;
                        receiverCell.appendChild(icon);
                    }
                }
            }
        });
    }
};