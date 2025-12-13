// html/js/modules/schichtplan_ui_helper.js

import { PlanState } from './schichtplan_state.js';
import { PlanApi } from './schichtplan_api.js';
import { PlanHandlers } from './schichtplan_handlers.js';
import { isColorDark } from '../utils/helpers.js';
import { apiFetch } from '../utils/api.js';

/**
 * Modul für UI-Hilfsfunktionen, Styling und statische Elemente.
 * Kümmert sich um CSS-Injection, Rollen-Sichtbarkeit, Status-Updates UND MODALS.
 */
export const PlanUIHelper = {

    // Callbacks für Aktionen, die einen Reload erfordern
    callbacks: {
        loadVariants: null,
        renderGrid: null
    },

    /**
     * Initialisiert das Modul mit notwendigen Callbacks.
     */
    init(loadVariantsFn, renderGridFn) {
        this.callbacks.loadVariants = loadVariantsFn;
        this.callbacks.renderGrid = renderGridFn;

        // NEU: Custom Modal initialisieren (ersetzt alert/confirm)
        this.initCustomModal();
    },

    /**
     * Erstellt das HTML/CSS für die stylischen Popups (Orakel-Design).
     */
    initCustomModal() {
        if (document.getElementById('dhf-oracle-modal')) return;

        // 1. CSS Injection
        const style = document.createElement('style');
        style.innerHTML = `
            .oracle-modal-overlay {
                display: none; position: fixed; z-index: 200000; left: 0; top: 0;
                width: 100%; height: 100%; background-color: rgba(0,0,0,0.7);
                backdrop-filter: blur(5px);
                animation: fadeInOverlay 0.3s ease-out;
            }
            .oracle-modal-content {
                position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0.9);
                background: linear-gradient(135deg, #1a1a1d 0%, #2c3e50 100%);
                border: 2px solid #9b59b6;
                box-shadow: 0 0 40px rgba(155, 89, 182, 0.5);
                color: #fff; width: 90%; max-width: 420px;
                border-radius: 12px; padding: 30px; text-align: center;
                opacity: 0; transition: all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55);
            }
            .oracle-modal-overlay.active { display: block; }
            .oracle-modal-overlay.active .oracle-modal-content {
                transform: translate(-50%, -50%) scale(1); opacity: 1;
            }

            .oracle-icon { font-size: 48px; margin-bottom: 20px; filter: drop-shadow(0 0 10px currentColor); animation: floatIcon 3s ease-in-out infinite; }
            .oracle-title { font-size: 1.4rem; font-weight: 600; margin-bottom: 10px; color: #ecf0f1; font-family: 'Poppins', sans-serif; }
            .oracle-text { font-size: 1rem; color: #bdc3c7; margin-bottom: 30px; line-height: 1.6; }

            .oracle-buttons { display: flex; gap: 15px; justify-content: center; }
            .oracle-btn {
                border: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; cursor: pointer;
                transition: transform 0.2s, filter 0.2s; color: white; flex: 1; font-size: 14px;
            }
            .oracle-btn:hover { transform: scale(1.05); filter: brightness(1.1); }

            /* Animationen */
            @keyframes floatIcon { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
            @keyframes fadeInOverlay { from { opacity: 0; } to { opacity: 1; } }

            /* Typ-Varianten */
            .type-info { border-color: #9b59b6; box-shadow: 0 0 40px rgba(155, 89, 182, 0.4); }
            .type-info .oracle-icon { color: #9b59b6; }
            .type-info .oracle-btn { background: #8e44ad; }

            .type-success { border-color: #2ecc71; box-shadow: 0 0 40px rgba(46, 204, 113, 0.4); }
            .type-success .oracle-icon { color: #2ecc71; }
            .type-success .oracle-btn { background: #27ae60; }

            .type-error { border-color: #e74c3c; box-shadow: 0 0 40px rgba(231, 76, 60, 0.4); }
            .type-error .oracle-icon { color: #e74c3c; }
            .type-error .oracle-btn { background: #c0392b; }

            .type-warning { border-color: #f39c12; box-shadow: 0 0 40px rgba(243, 156, 18, 0.4); }
            .type-warning .oracle-icon { color: #f39c12; }
            .type-warning .oracle-btn.confirm { background: #e67e22; }
            .type-warning .oracle-btn.cancel { background: transparent; border: 1px solid #7f8c8d; color: #bdc3c7; }
        `;
        document.head.appendChild(style);

        // 2. HTML Injection
        const html = `
            <div id="dhf-oracle-modal" class="oracle-modal-overlay">
                <div id="dhf-oracle-content" class="oracle-modal-content type-info">
                    <div id="dhf-oracle-icon" class="oracle-icon"><i class="fas fa-info-circle"></i></div>
                    <div id="dhf-oracle-title" class="oracle-title">Hinweis</div>
                    <div id="dhf-oracle-text" class="oracle-text">...</div>
                    <div id="dhf-oracle-buttons" class="oracle-buttons">
                        <button class="oracle-btn" id="dhf-oracle-ok">OK</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);

        // 3. Globale Funktionen bereitstellen
        window.dhfAlert = (title, text, type='info') => this.openModal(title, text, type, null);
        window.dhfConfirm = (title, text, onYes) => this.openModal(title, text, 'warning', onYes);

        // Klick außerhalb schließt Modal (User Request)
        const overlay = document.getElementById('dhf-oracle-modal');
        overlay.onclick = (e) => {
            if (e.target === overlay) this.closeModal();
        };
    },

    openModal(title, text, type, callback) {
        const overlay = document.getElementById('dhf-oracle-modal');
        const content = document.getElementById('dhf-oracle-content');
        const titleEl = document.getElementById('dhf-oracle-title');
        const textEl = document.getElementById('dhf-oracle-text');
        const iconEl = document.getElementById('dhf-oracle-icon');
        const btnContainer = document.getElementById('dhf-oracle-buttons');

        if (!overlay) return;

        // Reset & Set Type
        content.className = 'oracle-modal-content type-' + type;

        // Icon
        let iconClass = 'fa-info-circle';
        if (type === 'error') iconClass = 'fa-exclamation-circle';
        if (type === 'success') iconClass = 'fa-check-circle';
        if (type === 'warning') iconClass = 'fa-question-circle'; // Für Confirms
        iconEl.innerHTML = `<i class="fas ${iconClass}"></i>`;

        titleEl.textContent = title;
        // Einfaches HTML erlauben (z.B. <br>)
        textEl.innerHTML = text.replace(/\n/g, '<br>');

        btnContainer.innerHTML = '';

        if (callback) {
            // CONFIRM MODUS
            const btnYes = document.createElement('button');
            btnYes.className = 'oracle-btn confirm';
            btnYes.textContent = 'Ja, fortfahren';
            btnYes.onclick = () => {
                this.closeModal();
                callback();
            };

            const btnNo = document.createElement('button');
            btnNo.className = 'oracle-btn cancel';
            btnNo.textContent = 'Abbrechen';
            btnNo.onclick = () => this.closeModal();

            btnContainer.appendChild(btnNo); // Nein links
            btnContainer.appendChild(btnYes); // Ja rechts
        } else {
            // ALERT MODUS
            const btnOk = document.createElement('button');
            btnOk.className = 'oracle-btn';
            btnOk.textContent = 'Verstanden';
            btnOk.onclick = () => this.closeModal();
            btnContainer.appendChild(btnOk);
        }

        overlay.classList.add('active');
    },

    closeModal() {
        const overlay = document.getElementById('dhf-oracle-modal');
        if (overlay) overlay.classList.remove('active');
    },

    /**
     * Injiziert dynamische CSS-Styles für Warnungen, Blur-Effekte und Animationen.
     */
    injectWarningStyles() {
        if (document.getElementById('dhf-dynamic-styles')) return;

        const style = document.createElement('style');
        style.id = 'dhf-dynamic-styles';
        style.innerHTML = `
            /* Bestehende Styles */
            .hud-day-box.warning { border-color: #f1c40f !important; background: rgba(241, 196, 21, 0.4) !important; color: #fff !important; box-shadow: 0 0 10px #f1c40f !important; }
            .hud-day-box.critical { border-color: #e74c3c !important; background: rgba(231, 76, 60, 0.4) !important; color: #fff !important; box-shadow: 0 0 10px #e74c3c !important; }
            .hud-terminal::-webkit-scrollbar { width: 8px; }
            .hud-terminal::-webkit-scrollbar-track { background: #000; }
            .hud-terminal::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; }

            /* NEU: Styles für den Blur-Übergang */
            #schichtplan-grid, #staffing-grid { transition: filter 0.3s ease-in-out, opacity 0.3s ease-in-out; filter: blur(0); opacity: 1; }
            .blur-loading { filter: blur(5px) !important; opacity: 0.6 !important; pointer-events: none; }

            /* --- HIGHLIGHT ANIMATION --- */
            .grid-cell-highlight { position: relative !important; z-index: 50 !important; }
            .grid-cell-highlight::after { content: ''; position: absolute; top: -3px; left: -3px; right: -3px; bottom: -3px; background-color: rgba(241, 196, 21, 0.4); border: 3px solid #f1c40f; border-radius: 4px; box-shadow: 0 0 15px #f1c40f; z-index: 100; pointer-events: none; animation: flash-overlay 1.5s ease-in-out 3; }
            @keyframes flash-overlay { 0% { opacity: 0; transform: scale(1); } 50% { opacity: 1; transform: scale(1.05); } 100% { opacity: 0; transform: scale(1); } }

            /* --- Marktplatz & Pending Styles --- */
            .market-icon-overlay { position: absolute; top: 2px; right: 2px; font-size: 14px; z-index: 10; text-shadow: 0 0 3px rgba(0,0,0,0.5); animation: pulse-market 2s infinite; }
            @keyframes pulse-market { 0% { transform: scale(1); opacity: 0.8; } 50% { transform: scale(1.2); opacity: 1; } 100% { transform: scale(1); opacity: 0.8; } }

            @keyframes marchingAnts { 0% { background-position: 0 0, 100% 0, 0 100%, 0 100%; } 100% { background-position: 20px 0, 100% 20px, -20px 100%, 0 calc(100% - 20px); } }
            .market-offer-active { border-color: transparent !important; background-image: linear-gradient(90deg, #f1c40f 50%, transparent 50%), linear-gradient(180deg, #f1c40f 50%, transparent 50%), linear-gradient(270deg, #f1c40f 50%, transparent 50%), linear-gradient(0deg, #f1c40f 50%, transparent 50%); background-repeat: repeat-x, repeat-y, repeat-x, repeat-y; background-size: 20px 2px, 2px 20px, 20px 2px, 2px 20px; background-position: 0 0, 100% 0, 0 100%, 0 100%; animation: marchingAnts 1s infinite linear !important; z-index: 20 !important; box-shadow: inset 0 0 5px rgba(0,0,0,0.1); }

            .pending-outgoing { opacity: 0.6 !important; border: 2px dashed #f39c12 !important; background-image: repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(243, 156, 18, 0.1) 10px, rgba(243, 156, 18, 0.1) 20px) !important; position: relative; }
            .icon-outgoing { position: absolute; bottom: 2px; right: 2px; font-size: 16px; color: #f39c12; z-index: 22; filter: drop-shadow(0 0 2px rgba(0,0,0,0.8)); }

            .pending-incoming { border: 2px dashed #2ecc71 !important; background-color: rgba(46, 204, 113, 0.15) !important; color: #fff !important; display: flex; justify-content: center; align-items: center; position: relative; }
            .icon-incoming { position: absolute; bottom: 2px; right: 2px; font-size: 16px; color: #2ecc71; z-index: 22; filter: drop-shadow(0 0 2px rgba(0,0,0,0.8)); }
            .ghost-text { font-style: italic; opacity: 0.8; font-weight: bold; color: #2ecc71; font-size: 1.1em; }

            /* --- UNIFIED BANNER STYLES --- */
            #dhf-unified-grid { display: flex; flex-direction: row; width: 100%; gap: 1px; margin-bottom: 5px; position: sticky; top: 0; z-index: 9999; flex-wrap: wrap; box-shadow: 0 3px 6px rgba(0,0,0,0.15); }
            .unified-banner-item { flex: 1 1 0; min-width: 150px; padding: 10px 15px; text-align: center; font-weight: 700; color: white !important; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px; transition: all 0.2s ease; font-size: 14px; border-radius: 0; margin: 0; border: none; white-space: nowrap; }
            .unified-banner-item:hover { filter: brightness(1.1); transform: none; }
            #dhf-unified-grid .unified-banner-item:first-child { border-bottom-left-radius: 5px; }
            #dhf-unified-grid .unified-banner-item:last-child { border-bottom-right-radius: 5px; }
            .u-banner-red { background-color: #c0392b; } .u-banner-orange { background-color: #e67e22; } .u-banner-blue { background-color: #2980b9; } .u-banner-green { background-color: #27ae60; }
        `;
        document.head.appendChild(style);
    },

    /**
     * Steuert die Sichtbarkeit von UI-Elementen basierend auf den Benutzerrechten.
     */
    setupUIByRole() {
        const staffingSortToggleBtn = document.getElementById('staffing-sort-toggle');
        const openGeneratorLink = document.getElementById('open-generator-modal');
        const openGenSettingsLink = document.getElementById('open-gen-settings-modal');
        const deletePlanLink = document.getElementById('delete-plan-link');
        const settingsDropdown = document.getElementById('settings-dropdown');
        const planBulkModeBtn = document.getElementById('plan-bulk-mode-btn');
        const planSendMailBtn = document.getElementById('plan-send-mail-btn');
        const variantTabsContainer = document.getElementById('variant-tabs-container');

        if (staffingSortToggleBtn) {
            staffingSortToggleBtn.style.display = PlanState.isAdmin ? 'inline-block' : 'none';
        }

        if (!PlanState.isAdmin) {
            if (openGeneratorLink) openGeneratorLink.style.display = 'none';
            if (openGenSettingsLink) openGenSettingsLink.style.display = 'none';
            if (deletePlanLink) deletePlanLink.style.display = 'none';
            if (settingsDropdown) settingsDropdown.style.display = 'none';
            if (planBulkModeBtn) planBulkModeBtn.style.display = 'none';
            if (planSendMailBtn) planSendMailBtn.style.display = 'none';
            if (variantTabsContainer) variantTabsContainer.style.display = 'none';
        } else {
            if (planBulkModeBtn) planBulkModeBtn.style.display = 'inline-block';
            if (variantTabsContainer) variantTabsContainer.style.display = 'flex';
        }
    },

    /**
     * Aktualisiert die Status-Leiste.
     */
    updatePlanStatusUI(statusData) {
        const container = document.getElementById('plan-status-container');
        if (!container) return;

        const existingVarBtns = container.querySelectorAll('.variant-action-btn');
        existingVarBtns.forEach(btn => btn.remove());

        container.style.display = 'flex';
        const isVariant = (PlanState.currentVariantId !== null);

        const planStatusToggleBtn = document.getElementById('plan-status-toggle-btn');
        const planLockBtn = document.getElementById('plan-lock-btn');
        const planSendMailBtn = document.getElementById('plan-send-mail-btn');

        if (planStatusToggleBtn) {
            if (isVariant) {
                planStatusToggleBtn.style.display = 'none';
            } else {
                planStatusToggleBtn.style.display = 'inline-block';
                planStatusToggleBtn.textContent = statusData.status || "In Bearbeitung";
                planStatusToggleBtn.className = '';
                if (statusData.status === "Fertiggestellt") planStatusToggleBtn.classList.add('status-fertiggestellt');
                else planStatusToggleBtn.classList.add('status-in-bearbeitung');
                planStatusToggleBtn.disabled = !PlanState.isAdmin;
            }
        }

        if (planLockBtn) {
            if (isVariant) {
                planLockBtn.style.display = 'none';
            } else {
                planLockBtn.style.display = PlanState.isAdmin ? 'inline-block' : 'none';
                if (statusData.is_locked) {
                    planLockBtn.textContent = "Gesperrt";
                    planLockBtn.classList.add('locked');
                    document.body.classList.add('plan-locked');
                } else {
                    planLockBtn.textContent = "Offen";
                    planLockBtn.classList.remove('locked');
                    document.body.classList.remove('plan-locked');
                }
            }
        }

        if (planSendMailBtn) {
            planSendMailBtn.style.display = (PlanState.isAdmin && !isVariant && statusData.status === "Fertiggestellt" && statusData.is_locked) ? 'inline-block' : 'none';
        }

        if (isVariant && PlanState.isAdmin) {
            const delBtn = document.createElement('button');
            delBtn.textContent = "🗑 Variante Löschen";
            delBtn.className = "btn-admin-action variant-action-btn";
            delBtn.style.backgroundColor = "#e74c3c";
            delBtn.style.color = "white";
            delBtn.onclick = async () => {
                // NEU: Custom Confirm
                window.dhfConfirm("Variante Löschen", "Möchten Sie diese Variante wirklich löschen?", async () => {
                    try {
                        await apiFetch(`/api/variants/${PlanState.currentVariantId}`, 'DELETE');
                        PlanState.currentVariantId = null;
                        if(this.callbacks.loadVariants) await this.callbacks.loadVariants();
                        if(this.callbacks.renderGrid) await this.callbacks.renderGrid();
                    } catch(e) { window.dhfAlert("Fehler", e.message, "error"); }
                });
            };
            container.appendChild(delBtn);

            const pubBtn = document.createElement('button');
            pubBtn.textContent = "🚀 Als Hauptplan übernehmen";
            pubBtn.className = "btn-admin-action variant-action-btn";
            pubBtn.style.backgroundColor = "#27ae60";
            pubBtn.style.color = "white";
            pubBtn.onclick = async () => {
                // NEU: Custom Confirm
                window.dhfConfirm("Veröffentlichen", "ACHTUNG: Dies überschreibt den aktuellen Hauptplan mit dieser Variante. Fortfahren?", async () => {
                    try {
                        await apiFetch(`/api/variants/${PlanState.currentVariantId}/publish`, 'POST');
                        window.dhfAlert("Erfolg", "Variante wurde veröffentlicht!", "success");
                        PlanState.currentVariantId = null;
                        if(this.callbacks.loadVariants) await this.callbacks.loadVariants();
                        if(this.callbacks.renderGrid) await this.callbacks.renderGrid();
                    } catch(e) { window.dhfAlert("Fehler", e.message, "error"); }
                });
            };
            container.appendChild(pubBtn);
        }
    },

    /**
     * Befüllt statische Elemente.
     */
    async populateStaticElements() {
        try {
            const types = await PlanApi.fetchShiftTypes();
            PlanState.allShiftTypesList = types;
            PlanState.allShiftTypes = {};
            types.forEach(st => PlanState.allShiftTypes[st.id] = st);
        } catch(e) { return; }

        const legendeArbeit = document.getElementById('legende-arbeit');
        const legendeAbwesenheit = document.getElementById('legende-abwesenheit');
        const legendeSonstiges = document.getElementById('legende-sonstiges');
        const shiftSelection = document.getElementById('shift-selection');
        const clickActionModal = document.getElementById('click-action-modal');

        if(legendeArbeit) legendeArbeit.innerHTML = '';
        if(legendeAbwesenheit) legendeAbwesenheit.innerHTML = '';
        if(legendeSonstiges) legendeSonstiges.innerHTML = '';
        if(shiftSelection) shiftSelection.innerHTML = '';

        const specialAbbreviations = ['QA', 'S', 'DPG'];

        PlanState.allShiftTypesList.forEach(st => {
            const item = document.createElement('div');
            item.className = 'legende-item';
            item.innerHTML = `
                <div class="legende-color" style="background-color: ${st.color};"></div>
                <span class="legende-name"><strong>${st.abbreviation}</strong> (${st.name})</span>
            `;
            if (specialAbbreviations.includes(st.abbreviation)) legendeSonstiges.appendChild(item);
            else if (st.is_work_shift) legendeArbeit.appendChild(item);
            else legendeAbwesenheit.appendChild(item);

            if (!PlanState.isVisitor && shiftSelection) {
                const btn = document.createElement('button');
                btn.textContent = `${st.abbreviation} (${st.name})`;
                btn.style.backgroundColor = st.color;
                btn.style.color = isColorDark(st.color) ? 'white' : 'black';
                btn.onclick = () => {
                    PlanHandlers.saveShift(st.id, PlanState.modalContext.userId, PlanState.modalContext.dateStr, () => {
                        document.getElementById('shift-modal').style.display = 'none';
                        if(clickActionModal) clickActionModal.style.display = 'none';
                    });
                };
                shiftSelection.appendChild(btn);
            }
        });
    }
};