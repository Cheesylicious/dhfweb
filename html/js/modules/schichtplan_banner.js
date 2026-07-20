// html/js/modules/schichtplan_banner.js

import { PlanState } from './schichtplan_state.js';
import { PlanApi } from './schichtplan_api.js';
import { PlanRenderer } from './schichtplan_renderer.js';

/**
 * Modul für Benachrichtigungen (Banner) und visuelle Marker im Plan.
 */
export const PlanBanner = {

    // Verhindert, dass ein langsamer älterer Abruf einen neueren Bannerstand
    // nachträglich wieder überschreibt.
    _renderVersion: 0,

    /**
     * Rendert das kombinierte Benachrichtigungs-Banner (Systemnachrichten + Aufgaben).
     * NEU: Integriert sich in den #notification-container von shared_notifications.js.
     */
    async renderUnifiedBanner() {
        // Nur für Admins / Planschreiber / Hundeführer relevant
        if (!PlanState.isAdmin && !PlanState.isPlanschreiber && !PlanState.isHundefuehrer) return;

        const renderVersion = ++this._renderVersion;

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

            // Ausbildungs- und Schießfälligkeiten liegen bereits als einzelne
            // Einträge vor. Für eine bessere Übersicht werden sie weiter unten
            // nicht mehr zu einem Sammelbanner zusammengefasst.
            const trainingWarnings = Array.isArray(PlanState.trainingWarnings)
                ? [...PlanState.trainingWarnings]
                : [];
            const countTraining = trainingWarnings.length;

            // Falls inzwischen bereits ein neuerer Abruf läuft, darf dieses
            // Ergebnis die aktuelle Ansicht nicht mehr verändern.
            if (renderVersion !== this._renderVersion) return;

            if (!serverMessage && countTrade === 0 && countSick === 0 && countMarket === 0 && countTraining === 0) {
                slot.replaceChildren();
                return;
            }

            // 5. BANNER RENDERN

            // Alle Banner zunächst außerhalb des sichtbaren DOM aufbauen.
            // So bleibt die bisherige Leistenhöhe während der API-Abfragen
            // unverändert und der Schichtplan springt nicht hoch und runter.
            const nextTiles = document.createDocumentFragment();

            // Helper
            const addTile = (text, colorClass, iconClass, onClick, title = '') => {
                const div = document.createElement('div');
                div.className = `notification-banner`;
                div.style.backgroundColor = colorClass;
                if (title) div.title = title;

                const link = document.createElement('div');
                link.className = 'banner-link';

                const content = document.createElement('div');
                content.className = 'notification-content';

                const icon = document.createElement('i');
                icon.className = `fas ${iconClass}`;
                icon.style.marginRight = '8px';

                const label = document.createElement('span');
                label.textContent = text;

                content.append(icon, label);
                link.appendChild(content);
                div.appendChild(link);
                if (onClick) div.onclick = onClick;
                nextTiles.appendChild(div);
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

            // Kachel 4: Ausbildung und Schießen erhalten jeweils einen eigenen
            // Sammelbanner. Durch den gemeinsamen Flex-Container teilen sich
            // beide den Platz wie alle übrigen Banner.
            if (countTraining > 0 && PlanState.isAdmin) {
                const escapeHTML = (value) => String(value || '').replace(/[&<>"']/g, char => ({
                    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
                })[char]);

                const dueDateValue = (value) => {
                    const [day, month, year] = String(value || '').split('.').map(Number);
                    return year && month && day ? new Date(year, month - 1, day).getTime() : Number.MAX_SAFE_INTEGER;
                };

                // Innerhalb der beiden Listen: Überfälliges zuerst, danach die
                // früheste Frist und der Name.
                const sortWarnings = (warnings) => warnings.sort((a, b) => {
                    const aOverdue = String(a.status || '').startsWith('Überfällig') ? 0 : 1;
                    const bOverdue = String(b.status || '').startsWith('Überfällig') ? 0 : 1;
                    return aOverdue - bOverdue
                        || dueDateValue(a.due_date) - dueDateValue(b.due_date)
                        || String(a.name || '').localeCompare(String(b.name || ''), 'de');
                });

                const addWarningGroup = (warnings, config) => {
                    if (warnings.length === 0) return;
                    sortWarnings(warnings);

                    const count = warnings.length;
                    const bannerText = `${count} ${config.label} fällig`;
                    const tooltip = `${count} offene ${config.label}-Fälligkeit${count === 1 ? '' : 'en'}`;

                    addTile(bannerText, config.color, config.iconClass, () => {
                        if (window.dhfAlert) {
                            const listItems = warnings.map(warning => {
                                const isOverdue = String(warning.status || '').startsWith('Überfällig');
                                const detailColor = isOverdue ? '#e74c3c' : '#f1c40f';
                                return `
                                    <li style="margin-bottom:10px;">
                                        <strong>${escapeHTML(warning.name)}</strong><br>
                                        <span style="color:${detailColor}; font-size:0.9em; font-weight:700;">${escapeHTML(warning.status || 'Fällig')}</span><br>
                                        <span style="font-size:0.9em;">${escapeHTML(warning.message || '')}</span>
                                    </li>`;
                            }).join('');

                            const message = `
                                <div style="text-align:left;">
                                    <strong>${config.detailIcon} Folgende Hundeführer müssen noch eingeplant werden:</strong><br><br>
                                    <ul style="padding-left:20px; margin:0;">${listItems}</ul>
                                    <br><em>Trage die entsprechende Schicht (${config.shiftAbbreviation}) im Plan ein, um die jeweilige Meldung zu erledigen.</em>
                                </div>`;
                            window.dhfAlert(`${config.label} fällig`, message, 'warning');
                        } else {
                            alert(`${count} ${config.label}-Fälligkeit${count === 1 ? '' : 'en'}`);
                        }
                    }, tooltip);
                };

                addWarningGroup(
                    trainingWarnings.filter(warning => warning.type === 'QA'),
                    {
                        label: 'Ausbildung', color: '#b9770e',
                        iconClass: 'fa-graduation-cap', detailIcon: '🎓',
                        shiftAbbreviation: 'QA'
                    }
                );
                addWarningGroup(
                    trainingWarnings.filter(warning => warning.type === 'S'),
                    {
                        label: 'Schießen', color: '#d35400',
                        iconClass: 'fa-crosshairs', detailIcon: '🔫',
                        shiftAbbreviation: 'S'
                    }
                );
            }

            // Kachel 5: Markt-Angebote (Grün)
            if (countMarket > 0 && PlanState.isHundefuehrer) {
                addTile(`${countMarket} Schicht(en) zum Tausch`, '#27ae60', 'fa-tags', () => window.location.href='market.html');
            }

            // Ein einziger DOM-Austausch statt sichtbarem Leeren und späterem
            // Wiederbefüllen. Das hält die Zeile unter dem Mauszeiger stabil.
            slot.replaceChildren(nextTiles);

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
