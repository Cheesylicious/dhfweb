// html/js/modules/prediction_ui.js
import { apiFetch } from '../utils/api.js';
import { PlanState } from './schichtplan_state.js';

/**
 * Modul für KI-Vorhersage zur Personalplanung.
 * Kapselt UI, Logik und Styles.
 */

export const PredictionUI = {
    init() {
        // Nur für Admins
        if (!PlanState.isAdmin) return;

        // 1. Button in die Action-Bar einfügen
        this.injectButton();

        // 2. Modal-HTML in den Body einfügen (Lazy creation)
        this.createModal();

        // 3. Styles einfügen
        this.injectStyles();
    },

    injectButton() {
        const container = document.getElementById('plan-status-container');
        if (!container) return;

        const btn = document.createElement('button');
        btn.innerHTML = '🔮 KI-Prognose';
        btn.className = 'btn-admin-action';
        btn.style.backgroundColor = '#8e44ad'; // Lila
        btn.style.color = 'white';
        btn.title = "Analysiert historische Daten für Risiko-Warnungen";

        btn.onclick = () => this.runAnalysis();

        // Vor dem "Rundmail" Button einfügen oder am Ende
        container.appendChild(btn);
    },

    createModal() {
        if (document.getElementById('prediction-modal')) return;

        const modalHtml = `
            <div id="prediction-modal" class="modal">
                <div class="modal-content" style="max-width: 600px;">
                    <div class="modal-header">
                        <h2>🔮 KI-Personalprognose</h2>
                        <span class="close" id="close-prediction-modal">&times;</span>
                    </div>
                    <div class="modal-body">
                        <p class="pred-intro">
                            Basierend auf Daten aus <strong><span id="pred-base-year">...</span></strong>.
                            Das System vergleicht die aktuelle Besetzung mit historischen Ausfallquoten (Krank/Urlaub).
                        </p>

                        <div id="pred-loading" style="display:none; text-align:center; padding: 20px;">
                            Analysiere Daten... <span class="spinner">⏳</span>
                        </div>

                        <div id="pred-results-list" class="pred-list"></div>

                        <div id="pred-no-risk" style="display:none; text-align:center; color:#2ecc71; padding:20px;">
                            <h3>✅ Alles im grünen Bereich!</h3>
                            <p>Keine signifikanten Risiken basierend auf Vorjahresdaten gefunden.</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        document.getElementById('close-prediction-modal').onclick = () => {
            document.getElementById('prediction-modal').style.display = 'none';
        };
    },

    injectStyles() {
        const style = document.createElement('style');
        style.innerHTML = `
            .pred-list {
                max-height: 400px;
                overflow-y: auto;
                margin-top: 15px;
                border: 1px solid #eee;
                border-radius: 5px;
            }
            .pred-item {
                display: flex;
                align-items: center;
                padding: 10px;
                border-bottom: 1px solid #f0f0f0;
                gap: 15px;
            }
            .pred-item:last-child { border-bottom: none; }
            .pred-date {
                font-weight: bold;
                width: 50px;
                text-align: center;
                background: #f9f9f9;
                padding: 5px;
                border-radius: 4px;
            }
            .pred-info { flex: 1; }
            .pred-badge {
                padding: 4px 8px;
                border-radius: 12px;
                font-size: 11px;
                font-weight: bold;
                text-transform: uppercase;
                color: white;
            }
            .pred-risk-high { background-color: #e74c3c; border-left: 4px solid #c0392b; }
            .pred-risk-medium { background-color: #f1c40f; border-left: 4px solid #d35400; }

            .pred-intro { font-size: 13px; color: #666; margin-bottom: 10px; }
        `;
        document.head.appendChild(style);
    },

    async runAnalysis() {
        const modal = document.getElementById('prediction-modal');
        const list = document.getElementById('pred-results-list');
        const loading = document.getElementById('pred-loading');
        const noRisk = document.getElementById('pred-no-risk');
        const baseYearSpan = document.getElementById('pred-base-year');

        modal.style.display = 'block';
        list.innerHTML = '';
        noRisk.style.display = 'none';
        loading.style.display = 'block';

        try {
            const result = await apiFetch(`/api/prediction/analyze?year=${PlanState.currentYear}&month=${PlanState.currentMonth}&variant_id=${PlanState.currentVariantId || ''}`);

            loading.style.display = 'none';
            baseYearSpan.textContent = result.base_year;

            if (result.risks.length === 0) {
                noRisk.style.display = 'block';
            } else {
                result.risks.forEach(risk => {
                    const item = document.createElement('div');
                    // Unterscheidung CSS Klassen (High/Medium) wird hier aber für Hintergrund der ganzen Zeile genutzt?
                    // Nein, besser wir machen es sauber.

                    const riskClass = risk.risk === 'high' ? 'pred-risk-high' : 'pred-risk-medium';
                    const riskLabel = risk.risk === 'high' ? 'HOCH' : 'WARNUNG';

                    // Schönes Datum formatieren
                    const d = new Date(risk.date);
                    const dayStr = d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
                    const wdStr = d.toLocaleDateString('de-DE', { weekday: 'short' });

                    item.className = 'pred-item';
                    item.innerHTML = `
                        <div class="pred-date">
                            <div style="font-size:10px; color:#888;">${wdStr}</div>
                            <div>${dayStr}</div>
                        </div>
                        <div class="pred-info">
                            <div style="font-weight:600; color:#333;">${risk.message}</div>
                            <div style="font-size:12px; color:#555;">
                                Aktuell geplant: <strong>${risk.actual_staff}</strong> |
                                Histor. Ausfall: <strong>~${risk.predicted_absence}</strong>
                            </div>
                        </div>
                        <div class="pred-badge" style="background-color: ${risk.risk === 'high' ? '#e74c3c' : '#f39c12'}">
                            ${riskLabel}
                        </div>
                    `;
                    list.appendChild(item);
                });
            }

        } catch (e) {
            loading.style.display = 'none';
            list.innerHTML = `<div style="color:red; padding:10px;">Fehler: ${e.message}</div>`;
        }
    }
};