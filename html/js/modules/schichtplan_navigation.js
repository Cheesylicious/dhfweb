// html/js/modules/schichtplan_navigation.js

import { apiFetch } from '../utils/api.js';
import { PlanState } from './schichtplan_state.js';
import { PlanHandlers } from './schichtplan_handlers.js';

/**
 * Modul für Navigation (Zeitraum) und Varianten-Management.
 */
export const PlanNavigation = {

    reloadGrid: null,
    pickerYear: new Date().getFullYear(),

    init(reloadGridCallback) {
        this.reloadGrid = reloadGridCallback;
        this.pickerYear = PlanState.currentYear;

        this._bindNavigationEvents();
        this._bindVariantEvents();
        this._bindMonthPickerEvents();
    },

    // --- NAVIGATION EVENTS ---
    _bindNavigationEvents() {
        const prevBtn = document.getElementById('prev-month-btn');
        const nextBtn = document.getElementById('next-month-btn');

        if (prevBtn) {
            prevBtn.onclick = () => {
                PlanHandlers.handleMonthChange(-1);
                setTimeout(() => this.loadVariants(), 100);
            };
        }

        if (nextBtn) {
            nextBtn.onclick = () => {
                PlanHandlers.handleMonthChange(1);
                setTimeout(() => this.loadVariants(), 100);
            };
        }
    },

    // --- VARIANTEN LOGIK ---
    _bindVariantEvents() {
        const createBtn = document.getElementById('create-variant-btn');
        const modal = document.getElementById('variant-modal');

        if (createBtn) {
            createBtn.onclick = async () => {
                const nameInput = document.getElementById('variant-name');
                const name = nameInput ? nameInput.value : '';

                if (!name) {
                    alert("Name erforderlich");
                    return;
                }

                createBtn.disabled = true;
                createBtn.textContent = "Erstelle...";

                try {
                    await apiFetch('/api/variants', 'POST', {
                        name: name,
                        year: PlanState.currentYear,
                        month: PlanState.currentMonth,
                        source_variant_id: PlanState.currentVariantId
                    });

                    if (modal) modal.style.display = 'none';

                    await this.loadVariants();

                    const newVar = PlanState.variants[PlanState.variants.length - 1];
                    if (newVar) {
                        await this.switchVariant(newVar.id);
                    }

                } catch (e) {
                    alert("Fehler: " + e.message);
                } finally {
                    createBtn.disabled = false;
                    createBtn.textContent = "Erstellen";
                }
            };
        }
    },

    async loadVariants() {
        try {
            const variants = await apiFetch(`/api/variants?year=${PlanState.currentYear}&month=${PlanState.currentMonth}`);
            PlanState.variants = variants;
            this.renderVariantTabs();
        } catch (e) {
            console.error("Fehler beim Laden der Varianten:", e);
            PlanState.variants = [];
            this.renderVariantTabs();
        }
    },

    /**
     * Rendert die Tabs für Hauptplan und Varianten.
     */
    renderVariantTabs() {
        const container = document.getElementById('variant-tabs-container');
        if (!container) return;

        if (PlanState.variants.length === 0 && !PlanState.isAdmin) {
            container.style.display = 'none';
            return;
        } else {
            container.style.display = 'flex';
        }

        container.innerHTML = '';

        // --- HELPER: Baut einen Tab mit oder ohne Stift-Icon ---
        const createTab = (id, name, isActive) => {
            const tab = document.createElement('button');
            tab.className = `variant-tab ${isActive ? 'active' : ''}`;
            
            // Text im Tab
            const textSpan = document.createElement('span');
            textSpan.textContent = name;
            tab.appendChild(textSpan);

            // Stift-Icon für Admins einfügen
            if (PlanState.isAdmin) {
                const editIcon = document.createElement('i');
                editIcon.className = 'fas fa-pencil-alt';
                editIcon.style.marginLeft = '8px';
                editIcon.style.opacity = '0.3';
                editIcon.style.fontSize = '11px';
                editIcon.style.transition = 'opacity 0.2s';
                editIcon.title = "Plan umbenennen";
                
                // Hover-Effekt für das Icon
                tab.onmouseenter = () => editIcon.style.opacity = '1';
                tab.onmouseleave = () => editIcon.style.opacity = '0.3';

                // Klick auf das Stift-Symbol
                editIcon.onclick = async (e) => {
                    e.stopPropagation(); // Verhindert, dass der Plan beim Umbenennen gewechselt wird
                    const newName = prompt("Neuen Namen für diesen Plan eingeben:", name);
                    
                    if (newName && newName.trim() !== "" && newName.trim() !== name) {
                        try {
                            await apiFetch('/api/variants/rename', 'PUT', {
                                year: PlanState.currentYear,
                                month: PlanState.currentMonth,
                                variant_id: id,
                                new_name: newName.trim()
                            });
                            
                            // Lokalen State sofort updaten
                            if (id === null) {
                                PlanState.mainPlanName = newName.trim();
                                if(PlanState.currentPlanStatus) PlanState.currentPlanStatus.plan_name = newName.trim();
                            } else {
                                const v = PlanState.variants.find(v => v.id === id);
                                if(v) v.name = newName.trim();
                            }
                            
                            // Tabs neu zeichnen, um neuen Namen anzuzeigen
                            this.renderVariantTabs();
                        } catch(err) {
                            alert("Fehler beim Umbenennen: " + err.message);
                        }
                    }
                };
                tab.appendChild(editIcon);
            }

            // Klick auf den Tab selbst (Plan wechseln)
            tab.onclick = (e) => {
                if(e.target.tagName !== 'I') {
                    this.switchVariant(id);
                }
            };
            
            return tab;
        };
        // --------------------------------------------------------

        // 1. Hauptplan Tab (Name kommt aus dem Speicher oder Fallback)
        const mainName = PlanState.mainPlanName || "Hauptplan";
        container.appendChild(createTab(null, mainName, PlanState.currentVariantId === null));

        // 2. Varianten Tabs
        PlanState.variants.forEach(v => {
            container.appendChild(createTab(v.id, v.name, PlanState.currentVariantId === v.id));
        });

        // 3. Plus Button (Nur für Admins)
        if (PlanState.isAdmin) {
            const addBtn = document.createElement('button');
            addBtn.className = 'variant-tab variant-tab-add';
            addBtn.textContent = '+';
            addBtn.title = "Neue Variante erstellen";
            addBtn.onclick = () => {
                const modal = document.getElementById('variant-modal');
                const input = document.getElementById('variant-name');
                if (modal) {
                    if (input) input.value = '';
                    modal.style.display = 'block';
                }
            };
            container.appendChild(addBtn);
        }
    },

    async switchVariant(variantId) {
        if (PlanState.currentVariantId === variantId) return;

        PlanState.currentVariantId = variantId;
        this.renderVariantTabs();

        if (this.reloadGrid) {
            await this.reloadGrid();
        }
    },

    // --- MONTH PICKER LOGIC ---
    _bindMonthPickerEvents() {
        const label = document.getElementById('current-month-label');
        const dropdown = document.getElementById('month-picker-dropdown');
        const prevYear = document.getElementById('mp-prev-year');
        const nextYear = document.getElementById('mp-next-year');

        if (label) {
            label.onclick = (e) => {
                e.stopPropagation();
                this.toggleMonthPicker();
            };
        }

        if (prevYear) prevYear.onclick = (e) => { e.stopPropagation(); this.pickerYear--; this.renderMonthPicker(); };
        if (nextYear) nextYear.onclick = (e) => { e.stopPropagation(); this.pickerYear++; this.renderMonthPicker(); };

        window.addEventListener('click', (e) => {
            if (dropdown && dropdown.style.display === 'block') {
                if (!e.target.closest('#month-picker-dropdown') && e.target !== label) {
                    dropdown.style.display = 'none';
                }
            }
        });
    },

    toggleMonthPicker() {
        const dropdown = document.getElementById('month-picker-dropdown');
        if (!dropdown) return;

        const isVisible = dropdown.style.display === 'block';

        if (isVisible) {
            dropdown.style.display = 'none';
        } else {
            this.pickerYear = PlanState.currentYear;
            this.renderMonthPicker();
            dropdown.style.display = 'block';
        }
    },

    renderMonthPicker() {
        const display = document.getElementById('mp-year-display');
        const grid = document.getElementById('mp-months-grid');
        const dropdown = document.getElementById('month-picker-dropdown');

        if (!display || !grid) return;

        display.textContent = this.pickerYear;
        grid.innerHTML = '';

        const monthNames = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

        monthNames.forEach((name, index) => {
            const mNum = index + 1;
            const btn = document.createElement('div');
            btn.className = 'mp-month-btn';
            btn.textContent = name;

            if (this.pickerYear === PlanState.currentYear && mNum === PlanState.currentMonth) {
                btn.classList.add('active');
            }

            btn.onclick = () => {
                PlanHandlers.handleYearMonthSelect(this.pickerYear, mNum);
                setTimeout(() => this.loadVariants(), 100);
                if (dropdown) dropdown.style.display = 'none';
            };

            grid.appendChild(btn);
        });
    }
};