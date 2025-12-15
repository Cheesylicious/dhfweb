// html/js/modules/prediction_ui.js
import { apiFetch } from '../utils/api.js';
import { PlanState } from './schichtplan_state.js';

export const PredictionUI = {
    init() {
        if (!PlanState.isAdmin) return;
        this.injectButton();
        this.createModal();
        this.injectStyles();
    },

    injectButton() {
        const container = document.getElementById('plan-status-container');
        if (!container) return;
        const btn = document.createElement('button');
        btn.innerHTML = '<i class="fas fa-brain"></i> KI-Analyse';
        btn.className = 'btn-admin-action';
        btn.style.background = 'linear-gradient(135deg, #8e44ad, #9b59b6)';
        btn.style.color = 'white';
        btn.style.border = '1px solid #732d91';
        btn.style.boxShadow = '0 0 10px rgba(142, 68, 173, 0.4)';
        btn.onclick = () => this.runAnalysis();
        container.appendChild(btn);
    },

    createModal() {
        if (document.getElementById('prediction-modal')) return;
        const modalHtml = `
            <div id="prediction-modal" class="modal">
                <div class="modal-content" style="max-width: 700px; background: #1a1a1d; color: #fff; border: 1px solid #333;">
                    <div class="modal-header" style="border-bottom: 1px solid #333;">
                        <h2 style="color: #9b59b6;"><i class="fas fa-robot"></i> Planungs-KI</h2>
                        <span class="close" id="close-prediction-modal">&times;</span>
                    </div>
                    <div class="modal-body" style="min-height: 400px;">

                        <div id="ai-header" style="display:none; margin-bottom: 20px; padding: 15px; background: rgba(155, 89, 182, 0.1); border-left: 4px solid #9b59b6; border-radius: 4px;">
                            <div style="font-size: 12px; color: #9b59b6; font-weight: bold; text-transform: uppercase; margin-bottom: 5px;">KI-Zusammenfassung</div>
                            <div id="ai-summary-text" style="font-family: monospace; font-size: 14px; line-height: 1.5;"></div>
                        </div>

                        <div id="pred-loading" style="display:none; text-align:center; padding-top: 50px;">
                            <div class="ai-pulse"></div>
                            <div id="loading-text" style="margin-top: 20px; color: #bdc3c7; font-family: monospace;">Initialisiere neuronales Netz...</div>
                        </div>

                        <div id="pred-results-list" class="pred-list" style="display:none;"></div>

                        <div id="pred-no-risk" style="display:none; text-align:center; padding: 50px;">
                            <i class="fas fa-check-circle" style="font-size: 4em; color: #2ecc71; margin-bottom: 20px;"></i>
                            <h3 style="color:#2ecc71;">System stabil</h3>
                            <p style="color:#777;">Die KI konnte keine signifikanten Risiken identifizieren.</p>
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
            .ai-pulse {
                width: 60px; height: 60px; background: #9b59b6; border-radius: 50%; margin: 0 auto;
                animation: pulse-purple 1.5s infinite;
            }
            @keyframes pulse-purple {
                0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(155, 89, 182, 0.7); }
                70% { transform: scale(1); box-shadow: 0 0 0 20px rgba(155, 89, 182, 0); }
                100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(155, 89, 182, 0); }
            }
            .pred-list { max-height: 450px; overflow-y: auto; }
            .ai-card {
                background: rgba(255,255,255,0.03); border: 1px solid #333; border-radius: 8px;
                padding: 15px; margin-bottom: 15px; display: flex; gap: 15px; align-items: flex-start;
                transition: transform 0.2s;
            }
            .ai-card:hover { transform: translateX(5px); background: rgba(255,255,255,0.05); }

            .ai-date-box {
                background: #222; border: 1px solid #444; border-radius: 6px; padding: 8px;
                text-align: center; min-width: 50px;
            }
            .ai-card-content { flex: 1; }
            .ai-factors { display: flex; flex-wrap: wrap; gap: 5px; margin: 8px 0; }
            .ai-factor-tag {
                font-size: 10px; background: rgba(52, 152, 219, 0.2); color: #3498db;
                padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(52, 152, 219, 0.3);
            }

            .risk-bar-container {
                height: 4px; width: 100%; background: #333; border-radius: 2px; margin-top: 5px; overflow: hidden;
            }
            .risk-bar-fill { height: 100%; transition: width 1s ease-out; }

            .rec-text { font-size: 12px; color: #2ecc71; margin-top: 5px; font-style: italic; }
            .rec-text i { margin-right: 5px; }
        `;
        document.head.appendChild(style);
    },

    // --- Typewriter Effect ---
    typeWriter(text, elementId, speed = 30) {
        let i = 0;
        const el = document.getElementById(elementId);
        el.innerHTML = "";
        function type() {
            if (i < text.length) {
                el.innerHTML += text.charAt(i);
                i++;
                setTimeout(type, speed);
            }
        }
        type();
    },

    // --- Fake Loading Sequence ---
    async playLoadingSequence() {
        const texts = [
            "Analysiere Personalstruktur...",
            "Prüfe historische Ausfallquoten...",
            "Berücksichtige saisonale Faktoren...",
            "Berechne Wahrscheinlichkeiten..."
        ];
        const el = document.getElementById('loading-text');
        for (const t of texts) {
            el.textContent = t;
            await new Promise(r => setTimeout(r, 600)); // 600ms pro Text
        }
    },

    async runAnalysis() {
        const modal = document.getElementById('prediction-modal');
        const list = document.getElementById('pred-results-list');
        const loading = document.getElementById('pred-loading');
        const noRisk = document.getElementById('pred-no-risk');
        const header = document.getElementById('ai-header');

        modal.style.display = 'block';
        list.innerHTML = '';
        list.style.display = 'none';
        noRisk.style.display = 'none';
        header.style.display = 'none';
        loading.style.display = 'block';

        // Starte visuelle Simulation
        const loadingPromise = this.playLoadingSequence();

        try {
            // Echter API Call
            const fetchPromise = apiFetch(`/api/prediction/analyze?year=${PlanState.currentYear}&month=${PlanState.currentMonth}&variant_id=${PlanState.currentVariantId || ''}`);

            // Warte auf beides (Minimum Wartezeit für UX)
            const [_, result] = await Promise.all([loadingPromise, fetchPromise]);

            loading.style.display = 'none';

            // Ergebnis rendern
            if (result.risks.length === 0) {
                noRisk.style.display = 'block';
            } else {
                header.style.display = 'block';
                this.typeWriter(result.summary, 'ai-summary-text');
                list.style.display = 'block';

                result.risks.forEach(risk => {
                    const d = new Date(risk.date);
                    const dayStr = d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
                    const wdStr = d.toLocaleDateString('de-DE', { weekday: 'short' });

                    const color = risk.risk_class === 'high' ? '#e74c3c' : '#f1c40f';
                    const factorsHtml = risk.factors.map(f => `<span class="ai-factor-tag">${f}</span>`).join('');

                    const div = document.createElement('div');
                    div.className = 'ai-card';
                    div.style.borderLeft = `4px solid ${color}`;

                    div.innerHTML = `
                        <div class="ai-date-box">
                            <div style="font-size:10px; color:#888;">${wdStr}</div>
                            <div style="font-size:16px; font-weight:bold; color:#fff;">${d.getDate()}</div>
                        </div>
                        <div class="ai-card-content">
                            <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                                <span style="font-weight:600; font-size:14px; color:${color};">${risk.message}</span>
                                <span style="font-size:12px; font-weight:bold; color:${color};">${risk.risk_score}% Risiko</span>
                            </div>

                            <div class="risk-bar-container">
                                <div class="risk-bar-fill" style="width:${risk.risk_score}%; background:${color};"></div>
                            </div>

                            <div class="ai-factors">${factorsHtml}</div>

                            <div class="rec-text"><i class="fas fa-lightbulb"></i> KI-Tipp: ${risk.recommendation}</div>
                        </div>
                    `;
                    list.appendChild(div);
                });
            }

        } catch (e) {
            loading.style.display = 'none';
            list.style.display = 'block';
            list.innerHTML = `<div style="color:#e74c3c; padding:20px; text-align:center;">
                <i class="fas fa-exclamation-triangle"></i> Verbindungsfehler zum neuronalen Netz:<br>${e.message}
            </div>`;
        }
    }
};