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
     * NEU: Integriert sich in den #notification-container von shared_notifications.js.
     */
    async renderUnifiedBanner() {
        // Nur für Admins / Planschreiber / Hundeführer relevant
        if (!PlanState.isAdmin && !PlanState.isPlanschreiber && !PlanState.isHundefuehrer) return;

        try {
            // 1. ZIEL-CONTAINER FINDEN (Shared Container)
            let mainContainer = document.getElementById('notification-container');

            if (!mainContainer) {
                mainContainer = document.createElement('div');
                mainContainer.id = 'notification-container';
                const header = document.querySelector('header');
                if (header) header.insertAdjacentElement('afterend', mainContainer);
            }

            // 2. EIGENEN SLOT FINDEN ODER ERSTELLEN
            let slot = document.getElementById('plan-notifications-slot');
            if (!slot) {
                slot = document.createElement('div');
                slot.id = 'plan-notifications-slot';
                slot.className = 'notification-slot';
                mainContainer.appendChild(slot);
            }

            // Slot leeren
            slot.innerHTML = '';

            // 3. SERVER-BANNER KAPERN (System Message)
            let serverMessage = null;
            let serverAction = null;
            const possibleBanners = document.querySelectorAll('.alert, .flash, .flashes div, .alert-danger, .alert-success');
            possibleBanners.forEach(el => {
                if (el.offsetParent !== null && el.innerText.trim().length > 0) {
                    if (el.innerText.includes('Meldung') || el.innerText.includes('Krankmeldung')) {
                        serverMessage = el.innerText.trim();
                        const link = el.querySelector('a');
                        serverAction = link ? () => window.location.href = link.href : () => window.location.href = 'feedback.html';
                        el.remove();
                    }
                }
            });

            // 4. API DATEN HOLEN
            let pendingRequests = PlanState.currentChangeRequests || [];
            if ((PlanState.isAdmin || PlanState.isPlanschreiber) && pendingRequests.length === 0) {
                 try { pendingRequests = await PlanApi.fetchPendingShiftChangeRequests(); } catch(e) {}
            }

            let marketOffers = [];
            if (PlanState.currentMarketOffers) {
                 marketOffers = Object.values(PlanState.currentMarketOffers).filter(o => !o.is_my_offer);
            }

            // DATEN ANALYSIEREN
            const tradeReqs = pendingRequests.filter(r => r.reason_type === 'trade');
            const otherReqs = pendingRequests.filter(r => r.reason_type !== 'trade');

            const countTrade = tradeReqs.length;
            const countSick = otherReqs.length;
            const countMarket = marketOffers.length;

            // --- NEU: Trainings-Warnungen (Admin only) ---
            const countTraining = PlanState.trainingWarnings ? PlanState.trainingWarnings.length : 0;


            if (!serverMessage && countTrade === 0 && countSick === 0 && countMarket === 0 && countTraining === 0) return;

            // 5. BANNER RENDERN

            // Helper
            const addTile = (text, colorClass, iconClass, onClick) => {
                const div = document.createElement('div');
                div.className = `notification-banner`;
                div.style.backgroundColor = colorClass;

                div.innerHTML = `
                    <div class="banner-link">
                        <div class="notification-content">
                            <i class="fas ${iconClass}" style="margin-right:8px;"></i>
                            <span>${text}</span>
                        </div>
                    </div>
                `;
                if (onClick) div.onclick = onClick;
                slot.appendChild(div);
            };

            // Kachel 1: System Nachricht (Rot)
            if (serverMessage) {
                addTile(serverMessage, '#c0392b', 'fa-bell', serverAction);
            }

            // Kachel 2: Krankmeldungen (Orange)
            if (countSick > 0 && (PlanState.isAdmin || PlanState.isPlanschreiber)) {
                addTile(`${countSick} Krankmeldung(en)`, '#e67e22', 'fa-exclamation-triangle', () => window.location.href='anfragen.html');
            }

            // Kachel 3: Tausch-Genehmigungen (Blau)
            if (countTrade > 0 && PlanState.isAdmin) {
                addTile(`${countTrade} Schicht(en) wurde getauscht`, '#2980b9', 'fa-exchange-alt', () => window.location.href='anfragen.html');
            }

            // --- NEU: Kachel 4: Trainings-Warnungen (Rot-Orange) ---
            if (countTraining > 0 && PlanState.isAdmin) {
                // Wir nutzen hier das Orakel-Modal für die Details
                addTile(`${countTraining} Ausbildung/Schießen fällig`, '#d35400', 'fa-crosshairs', () => {
                    let msg = "<strong>Folgende Hundeführer müssen noch eingeplant werden:</strong><br><br>";
                    msg += "<ul style='text-align:left; font-size:13px;'>";
                    PlanState.trainingWarnings.forEach(w => {
                        const icon = w.type === 'QA' ? '🎓' : '🔫';
                        const color = w.status === 'Überfällig' ? '#e74c3c' : '#f1c40f';
                        msg += `<li style="margin-bottom:5px;">${icon} <strong>${w.name}</strong>: ${w.type}<br><span style="color:${color}; font-size:0.9em;">${w.message}</span></li>`;
                    });
                    msg += "</ul>";
                    msg += "<br><em>Tipp: Trage die entsprechende Schicht (QA oder S) im Plan ein, um diese Meldung zu entfernen.</em>";

                    if (window.dhfAlert) {
                        window.dhfAlert("Fälligkeiten", msg, "warning");
                    } else {
                        alert("Details siehe Hundeführer-Liste.");
                    }
                });
            }

            // Kachel 5: Markt-Angebote (Grün)
            if (countMarket > 0 && PlanState.isHundefuehrer) {
                addTile(`${countMarket} Schicht(en) zum Tausch`, '#27ae60', 'fa-tags', () => window.location.href='market.html');
            }

        } catch (e) {
            console.warn("Banner Render Error:", e);
        }
    },

    /**
     * Markiert offene Tausch-Vorgänge (Sanduhr-Effekt) im Grid.
     */
    markPendingTakeovers() {
        if (!PlanState.currentChangeRequests || PlanState.currentChangeRequests.length === 0) return;

        PlanState.currentChangeRequests.forEach(req => {
            if (req.status !== 'pending') return;

            const myId = PlanState.loggedInUser.id;
            const giverId = req.target_user_id;
            const receiverId = req.replacement_user_id;

            const isRelevantForMe = (myId === giverId || myId === receiverId || PlanState.isAdmin);
            if (!isRelevantForMe) return;

            const dateOnly = req.shift_date ? req.shift_date.split('T')[0] : null;
            if (!dateOnly) return;

            // 1. GIVER
            const giverCell = PlanRenderer.findCellByKey(`${giverId}-${dateOnly}`);
            if (giverCell) {
                giverCell.classList.add('pending-outgoing');
                if (!giverCell.querySelector('.icon-outgoing')) {
                    const icon = document.createElement('div');
                    icon.className = 'icon-outgoing';
                    icon.innerHTML = '<i class="fas fa-share-square"></i>';
                    icon.title = `Wartet auf Übergabe an ${req.replacement_name}`;
                    giverCell.appendChild(icon);
                }
            }

            // 2. RECEIVER
            if (receiverId) {
                const receiverCell = PlanRenderer.findCellByKey(`${receiverId}-${dateOnly}`);
                if (receiverCell) {
                    receiverCell.classList.add('pending-incoming');
                    if (req.shift_abbr && (!receiverCell.textContent || receiverCell.textContent.trim() === '')) {
                         receiverCell.innerHTML = `<span class="ghost-text">${req.shift_abbr}</span>`;
                    }
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