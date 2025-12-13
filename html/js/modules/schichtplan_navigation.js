// html/js/modules/schichtplan_navigation.js

import { apiFetch } from '../utils/api.js';
import { PlanState } from './schichtplan_state.js';
import { PlanHandlers } from './schichtplan_handlers.js';

/**
 * Modul für Navigation (Zeitraum) und Varianten-Management.
 */
export const PlanNavigation = {

    // Callback zum Neuladen des Grids (wird von main.js übergeben)
    reloadGrid: null,

    // Lokaler State für den Month Picker (Jahres-Navigation im Dropdown)
    pickerYear: new Date().getFullYear(),

    /**
     * Initialisiert Navigation und Event-Listener.
     * @param {Function} reloadGridCallback - Funktion zum Neuladen des Schichtplans.
     */
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
                // Kurzer Timeout für UX, damit der State sauber ist
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

                    // Varianten neu laden
                    await this.loadVariants();

                    // Automatisch zur neuen Variante wechseln (die letzte in der Liste)
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

    /**
     * Lädt alle Varianten für den aktuellen Monat vom Server.
     */
    async loadVariants() {
        if (!PlanState.isAdmin) return;

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
        if (!container || !PlanState.isAdmin) return;

        container.innerHTML = '';

        // 1. Hauptplan Tab
        const mainTab = document.createElement('button');
        mainTab.className = `variant-tab ${PlanState.currentVariantId === null ? 'active' : ''}`;
        mainTab.textContent = 'Hauptplan';
        mainTab.onclick = () => this.switchVariant(null);
        container.appendChild(mainTab);

        // 2. Varianten Tabs
        PlanState.variants.forEach(v => {
            const tab = document.createElement('button');
            tab.className = `variant-tab ${PlanState.currentVariantId === v.id ? 'active' : ''}`;
            tab.textContent = v.name;
            tab.onclick = () => this.switchVariant(v.id);
            container.appendChild(tab);
        });

        // 3. Plus Button (Neue Variante)
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
    },

    /**
     * Wechselt die aktive Variante und lädt das Grid neu.
     */
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

        // Globaler Click Listener zum Schließen (in main.js gehandhabt oder hier)
        // Wir verlassen uns hier darauf, dass main.js globale Klicks abfängt oder wir fügen es hier hinzu:
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
            // Reset auf aktuelles Plan-Jahr beim Öffnen
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

                // Varianten für den neuen Monat laden
                setTimeout(() => this.loadVariants(), 100);

                if (dropdown) dropdown.style.display = 'none';
            };

            grid.appendChild(btn);
        });
    }
};