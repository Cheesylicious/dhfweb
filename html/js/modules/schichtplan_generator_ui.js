// html/js/modules/schichtplan_generator_ui.js

import { PlanState } from './schichtplan_state.js';
import { PlanApi } from './schichtplan_api.js';

/**
 * Modul für die Generator-Steuerung und Visualisierung (HUD).
 */
export const PlanGeneratorUI = {

    // Callback zum Neuladen des Grids
    renderGrid: null,

    // Interner State für Animationen und Polling
    generatorInterval: null,
    visualInterval: null,
    visualQueue: [],
    processedLogCount: 0,

    /**
     * Initialisiert das Modul.
     * @param {Function} renderGridFn - Callback zum Neuladen des Grids nach Abschluss.
     */
    init(renderGridFn) {
        this.renderGrid = renderGridFn;
        this._bindGeneratorEvents();
        this._bindSettingsEvents();
    },

    // --- EVENTS ---

    _bindGeneratorEvents() {
        const openLink = document.getElementById('open-generator-modal');
        const startBtn = document.getElementById('start-generator-btn');

        if (openLink) {
            openLink.onclick = (e) => {
                e.preventDefault();
                if (!PlanState.isAdmin) return;

                const label = document.getElementById('gen-target-month');
                if (label) label.textContent = `${PlanState.currentMonth}/${PlanState.currentYear}`;

                this.generateHudGrid();

                const logContainer = document.getElementById('generator-log-container');
                if (logContainer) logContainer.innerHTML = '<div class="hud-log-line">System bereit...</div>';

                const progFill = document.getElementById('gen-progress-fill');
                if (progFill) progFill.style.width = '0%';

                const statusText = document.getElementById('gen-status-text');
                if (statusText) {
                    statusText.textContent = "BEREIT";
                    statusText.style.color = "#bdc3c7";
                }

                if (startBtn) {
                    startBtn.disabled = false;
                    startBtn.textContent = "INITIALISIEREN";
                }

                const modal = document.getElementById('generator-modal');
                if (modal) modal.style.display = 'block';
            };
        }

        if (startBtn) {
            startBtn.onclick = async () => {
                console.log("Start-Button geklickt. Sende Anfrage an Backend...");

                startBtn.disabled = true;
                startBtn.textContent = "LÄUFT...";

                // --- RESET ---
                this.visualQueue = [];
                this.processedLogCount = 0;

                document.querySelectorAll('.hud-day-box').forEach(b => {
                    b.classList.remove('done', 'processing', 'warning', 'critical');
                });

                const progFill = document.getElementById('gen-progress-fill');
                if (progFill) progFill.style.width = '0%';

                const logContainer = document.getElementById('generator-log-container');
                logContainer.innerHTML = '';
                this.visualQueue.push({
                    type: 'log',
                    content: '<div class="hud-log-line highlight">> Startsequenz initiiert...</div>'
                });

                const statusText = document.getElementById('gen-status-text');
                if (statusText) {
                    statusText.textContent = "AKTIV";
                    statusText.style.color = "#2ecc71";
                }

                if (this.visualInterval) clearInterval(this.visualInterval);
                this.visualInterval = setInterval(() => this.processVisualQueue(), 40);

                try {
                    // WICHTIG: Sicherstellen, dass variantId null ist, wenn undefined
                    const variantIdToSend = PlanState.currentVariantId !== undefined ? PlanState.currentVariantId : null;
                    console.log(`Starte Generator für: ${PlanState.currentMonth}/${PlanState.currentYear}, Variante: ${variantIdToSend}`);

                    await PlanApi.startGenerator(PlanState.currentYear, PlanState.currentMonth, variantIdToSend);

                    // Polling starten
                    if (this.generatorInterval) clearInterval(this.generatorInterval);
                    this.generatorInterval = setInterval(() => this.pollGeneratorStatus(), 1000);

                } catch (error) {
                    console.error("Fehler beim Starten:", error);
                    this.visualQueue.push({
                        type: 'log',
                        content: `<div class="hud-log-line error">[FEHLER] ${error.message}</div>`
                    });
                    startBtn.disabled = false;
                    startBtn.textContent = "RETRY";

                    // Status zurücksetzen bei Fehler
                    if (statusText) {
                        statusText.textContent = "FEHLER";
                        statusText.style.color = "#e74c3c";
                    }
                }
            };
        }
    },

    _bindSettingsEvents() {
        const openLink = document.getElementById('open-gen-settings-modal');
        const saveBtn = document.getElementById('save-gen-settings-btn');
        const modal = document.getElementById('gen-settings-modal');

        if (openLink) {
            openLink.onclick = async (e) => {
                e.preventDefault();
                if (!PlanState.isAdmin) return;

                const statusEl = document.getElementById('gen-settings-status');
                if (statusEl) statusEl.textContent = "Lade...";
                if (modal) modal.style.display = 'block';

                try {
                    const config = await PlanApi.getGeneratorConfig();

                    // Lokalen Cache aktualisieren
                    PlanState.generatorConfig = config;

                    if(document.getElementById('gen-max-consecutive')) document.getElementById('gen-max-consecutive').value = config.max_consecutive_same_shift || 4;
                    if(document.getElementById('gen-rest-days')) document.getElementById('gen-rest-days').value = config.mandatory_rest_days_after_max_shifts || 2;
                    if(document.getElementById('gen-fill-rounds')) document.getElementById('gen-fill-rounds').value = config.generator_fill_rounds || 3;
                    if(document.getElementById('gen-max-hours')) document.getElementById('gen-max-hours').value = config.max_monthly_hours || 170;
                    if(document.getElementById('gen-fairness-threshold')) document.getElementById('gen-fairness-threshold').value = config.fairness_threshold_hours || 10;
                    if(document.getElementById('gen-min-hours-bonus')) document.getElementById('gen-min-hours-bonus').value = config.min_hours_score_multiplier || 5;

                    // Checkbox für Work-Life-Balance laden
                    if(document.getElementById('gen-ensure-weekend')) {
                        document.getElementById('gen-ensure-weekend').checked = config.ensure_one_weekend_free === true;
                    }

                    // Schichten Checkboxen
                    const container = document.getElementById('gen-shifts-container');
                    if (container) {
                        container.innerHTML = '';
                        const activeShifts = config.shifts_to_plan || ["6", "T.", "N."];

                        PlanState.allShiftTypesList.forEach(st => {
                            if (!st.is_work_shift) return;

                            const div = document.createElement('div');
                            div.className = 'gen-shift-checkbox';

                            const input = document.createElement('input');
                            input.type = 'checkbox';
                            input.value = st.abbreviation;
                            input.id = `gen-shift-${st.id}`;
                            if (activeShifts.includes(st.abbreviation)) input.checked = true;

                            const label = document.createElement('label');
                            label.htmlFor = `gen-shift-${st.id}`;
                            label.textContent = `${st.abbreviation}`;

                            div.appendChild(input);
                            div.appendChild(label);
                            container.appendChild(div);
                        });
                    }
                    if (statusEl) statusEl.textContent = "";
                } catch (err) {
                    if (statusEl) statusEl.textContent = "Fehler beim Laden.";
                }
            };
        }

        if (saveBtn) {
            saveBtn.onclick = async () => {
                saveBtn.disabled = true;
                const statusEl = document.getElementById('gen-settings-status');
                if (statusEl) statusEl.textContent = "Speichere...";

                const selectedShifts = [];
                document.querySelectorAll('#gen-shifts-container input[type="checkbox"]').forEach(cb => {
                    if (cb.checked) selectedShifts.push(cb.value);
                });

                const payload = {
                    max_consecutive_same_shift: parseInt(document.getElementById('gen-max-consecutive').value),
                    mandatory_rest_days_after_max_shifts: parseInt(document.getElementById('gen-rest-days').value),
                    generator_fill_rounds: parseInt(document.getElementById('gen-fill-rounds').value),
                    fairness_threshold_hours: parseFloat(document.getElementById('gen-fairness-threshold').value),
                    min_hours_score_multiplier: parseFloat(document.getElementById('gen-min-hours-bonus').value),
                    max_monthly_hours: parseFloat(document.getElementById('gen-max-hours').value),
                    ensure_one_weekend_free: document.getElementById('gen-ensure-weekend') ? document.getElementById('gen-ensure-weekend').checked : false,
                    shifts_to_plan: selectedShifts
                };

                try {
                    await PlanApi.saveGeneratorConfig(payload);
                    PlanState.generatorConfig = payload;

                    if (statusEl) {
                        statusEl.textContent = "Gespeichert!";
                        statusEl.style.color = "#2ecc71";
                    }
                    setTimeout(() => {
                        if (modal) modal.style.display = 'none';
                        if (statusEl) statusEl.textContent = "";
                    }, 1000);
                } catch (e) {
                    if (statusEl) statusEl.textContent = "Fehler: " + e.message;
                } finally {
                    saveBtn.disabled = false;
                }
            };
        }
    },

    // --- VISUALISIERUNG LOGIK ---

    generateHudGrid() {
        const grid = document.getElementById('gen-day-grid');
        if (!grid) return;
        grid.innerHTML = '';
        const daysInMonth = new Date(PlanState.currentYear, PlanState.currentMonth, 0).getDate();
        for (let i = 1; i <= daysInMonth; i++) {
            const box = document.createElement('div');
            box.className = 'hud-day-box';
            box.id = `day-box-${i}`;
            box.textContent = i;
            grid.appendChild(box);
        }
    },

    getSollForShift(day, shiftName) {
        const year = PlanState.currentYear;
        const month = PlanState.currentMonth;
        const date = new Date(year, month - 1, day);
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

        // Prüfen ob Feiertag
        let isHoliday = PlanState.currentSpecialDates[dateStr] === 'holiday';

        // Schichtart finden
        const st = PlanState.allShiftTypesList.find(s => s.abbreviation === shiftName);
        if (!st) return 0;

        // Soll zurückgeben
        if (isHoliday) return st.min_staff_holiday || 0;

        // Wochentag (0=So, 1=Mo, ...)
        const dayIdx = date.getDay();
        const map = [
            st.min_staff_so, st.min_staff_mo, st.min_staff_di, st.min_staff_mi,
            st.min_staff_do, st.min_staff_fr, st.min_staff_sa
        ];
        return map[dayIdx] || 0;
    },

    processVisualQueue() {
        if (this.visualQueue.length === 0) return;

        const item = this.visualQueue.shift();

        // Spezial-Befehle
        if (item.type === 'finish') {
            clearInterval(this.visualInterval);
            this.visualInterval = null;

            const statusText = document.getElementById('gen-status-text');
            if (statusText) { statusText.textContent = "FERTIG"; statusText.style.color = "#2ecc71"; }

            const startBtn = document.getElementById('start-generator-btn');
            if (startBtn) {
                startBtn.disabled = false;
                startBtn.textContent = "ABGESCHLOSSEN";
            }

            // Aufräumen (Grün setzen, wenn keine Warnung/Kritisch)
            const daysInMonth = new Date(PlanState.currentYear, PlanState.currentMonth, 0).getDate();
            for (let i = 1; i <= daysInMonth; i++) {
                const box = document.getElementById(`day-box-${i}`);
                if (box && !box.classList.contains('warning') && !box.classList.contains('critical')) {
                    // Check auf ignorierte "6er" Schichten
                    let forceWarning = false;
                    if (PlanState.generatorConfig && PlanState.generatorConfig.shifts_to_plan) {
                        const includes6 = PlanState.generatorConfig.shifts_to_plan.includes('6');
                        if (!includes6) {
                            const soll6 = this.getSollForShift(i, '6');
                            if (soll6 > 0) forceWarning = true;
                        }
                    }

                    box.classList.remove('processing');
                    if (forceWarning) {
                        box.classList.add('warning'); // Gelb erzwingen
                    } else {
                        box.classList.add('done'); // Grün
                    }
                }
            }

            // Grid neu laden
            setTimeout(() => { if (this.renderGrid) this.renderGrid(); }, 1000);
            return;
        }

        // Normaler Text-Log
        if (item.type === 'log') {
            const logContainer = document.getElementById('generator-log-container');
            const div = document.createElement('div');
            div.innerHTML = item.content;
            logContainer.appendChild(div);
            logContainer.scrollTop = logContainer.scrollHeight;

            const text = div.textContent;

            // Visualisierung der Tage
            const dayMatch = text.match(/Plane Tag (\d+)/);
            if (dayMatch) {
                const day = parseInt(dayMatch[1]);
                // Vorherige aufräumen
                for (let d = 1; d < day; d++) {
                    const box = document.getElementById(`day-box-${d}`);

                    if (box && !box.classList.contains('warning') && !box.classList.contains('critical')) {
                        // Check auch hier beim Übergang
                        let forceWarning = false;
                        if (PlanState.generatorConfig && PlanState.generatorConfig.shifts_to_plan) {
                            const includes6 = PlanState.generatorConfig.shifts_to_plan.includes('6');
                            if (!includes6) {
                                const soll6 = this.getSollForShift(d, '6');
                                if (soll6 > 0) forceWarning = true;
                            }
                        }

                        if (forceWarning) box.classList.add('warning');
                        else box.classList.add('done');
                    }
                    if (box) box.classList.remove('processing');
                }
                // Aktuellen markieren
                const currentBox = document.getElementById(`day-box-${day}`);
                if (currentBox) {
                    currentBox.classList.remove('done');
                    currentBox.classList.add('processing');
                }
            }

            // Intelligente Warn-Erkennung
            const warnMatch = text.match(/Tag (\d+): Konnte (.+) nicht voll besetzen \(Fehlen: (\d+)\)/);

            if (warnMatch) {
                const day = parseInt(warnMatch[1]);
                const shiftName = warnMatch[2].trim(); // z.B. "T." oder "6"
                const missingCount = parseInt(warnMatch[3]);

                const box = document.getElementById(`day-box-${day}`);
                if (box) {
                    box.classList.remove('processing');
                    box.classList.remove('done');

                    const soll = this.getSollForShift(day, shiftName);

                    if (shiftName === '6' || shiftName === '6.') {
                        box.classList.add('warning');
                    } else {
                        if (missingCount >= soll && soll > 0) {
                            box.classList.add('critical');
                        } else {
                            box.classList.add('warning');
                        }
                    }
                }
            }
        }
    },

    async pollGeneratorStatus() {
        try {
            const statusData = await PlanApi.getGeneratorStatus();
            const progFill = document.getElementById('gen-progress-fill');
            if (progFill) progFill.style.width = `${statusData.progress || 0}%`;

            if (statusData.logs && statusData.logs.length > 0) {
                const newLogs = statusData.logs;
                const startIdx = this.processedLogCount;

                for (let i = startIdx; i < newLogs.length; i++) {
                    const logMsg = newLogs[i];
                    let className = 'hud-log-line';
                    if (logMsg.includes('[FEHLER]')) className += ' error';
                    else if (logMsg.includes('[WARN]')) className += ' highlight';
                    else if (logMsg.includes('erfolgreich')) className += ' success';

                    this.visualQueue.push({
                        type: 'log',
                        content: `<div class="${className}">&gt; ${logMsg}</div>`
                    });
                }

                this.processedLogCount = newLogs.length;
            }

            if (statusData.status === 'finished' || statusData.status === 'error') {
                if (this.generatorInterval) clearInterval(this.generatorInterval);
                this.generatorInterval = null;

                if (statusData.status === 'finished') {
                    this.visualQueue.push({
                        type: 'log',
                        content: '<div class="hud-log-line success">> VORGANG ABGESCHLOSSEN.</div>'
                    });
                    this.visualQueue.push({ type: 'finish' });

                } else {
                    const statusText = document.getElementById('gen-status-text');
                    if (statusText) { statusText.textContent = "ABBRUCH"; statusText.style.color = "#e74c3c"; }
                    const startBtn = document.getElementById('start-generator-btn');
                    if (startBtn) { startBtn.disabled = false; startBtn.textContent = "FEHLER"; }
                }
            }
        } catch (e) { console.error("Poll Error:", e); }
    }
};