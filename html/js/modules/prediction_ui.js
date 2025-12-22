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
        btn.innerHTML = '<i class="fas fa-biohazard fa-spin" style="--fa-animation-duration: 3s;"></i> KI-PROGNOSE';
        btn.className = 'btn-admin-action';
        // Ein Button, der aussieht wie der Startknopf einer Atomrakete
        btn.style.background = 'black';
        btn.style.color = '#00ff41';
        btn.style.border = '1px solid #00ff41';
        btn.style.boxShadow = '0 0 10px #00ff41, inset 0 0 10px #00ff41';
        btn.style.fontFamily = '"Courier New", monospace';
        btn.style.fontWeight = 'bold';
        btn.style.letterSpacing = '2px';
        btn.style.textShadow = '0 0 5px #00ff41';

        btn.onmouseover = () => {
            btn.style.background = '#00ff41';
            btn.style.color = 'black';
            btn.style.boxShadow = '0 0 20px #00ff41';
        };
        btn.onmouseout = () => {
            btn.style.background = 'black';
            btn.style.color = '#00ff41';
            btn.style.boxShadow = '0 0 10px #00ff41, inset 0 0 10px #00ff41';
        };

        btn.onclick = () => this.runAnalysis();
        container.appendChild(btn);
    },

    createModal() {
        if (document.getElementById('prediction-modal')) return;

        const modalHtml = `
            <div id="prediction-modal" class="modal ai-modal-overlay">
                <div class="modal-content ai-hud-frame">
                    <div class="ai-grid-background"></div>
                    <div class="ai-scanline"></div>
                    <div class="ai-vignette"></div>

                    <div class="ai-hud-header">
                        <div class="ai-brand">
                            <span class="ai-glitch-text" data-text="NEURAL_CORE_V9">NEURAL_CORE_V9</span>
                            <span class="ai-blink">_</span>
                        </div>
                        <div class="ai-hud-stats">
                            <div>CPU: <span id="ai-cpu-val">12</span>%</div>
                            <div>MEM: <span id="ai-mem-val">402</span>TB</div>
                            <div style="color:#00ff41">CONNECTED</div>
                        </div>
                        <span class="close" id="close-prediction-modal">×</span>
                    </div>

                    <div class="modal-body ai-hud-body">

                        <div id="pred-loading" style="display:none;">
                            <div class="ai-center-stage">
                                <div class="ai-hex-spinner">
                                    <div class="hex-layer-1"></div>
                                    <div class="hex-layer-2"></div>
                                    <div class="hex-icon"><i class="fas fa-brain"></i></div>
                                </div>
                                <div class="ai-loading-status" id="ai-main-status">SYSTEM INITIALIZATION</div>
                                <div class="ai-loading-sub" id="ai-sub-status">Accessing mainframe...</div>
                            </div>

                            <div class="ai-terminal-wrapper">
                                <div class="ai-terminal-header">/// KERNEL_LOG_STREAM</div>
                                <div id="ai-terminal-log" class="ai-terminal-content"></div>
                            </div>

                            <div class="ai-charts-row">
                                <div class="ai-mini-chart">
                                    <div class="chart-label">NEURAL LOAD</div>
                                    <div class="chart-bars" id="chart-bars-1"></div>
                                </div>
                                <div class="ai-mini-chart">
                                    <div class="chart-label">HEURISTICS</div>
                                    <div class="chart-bars" id="chart-bars-2"></div>
                                </div>
                            </div>

                            <div class="ai-progress-bar-container">
                                <div id="ai-progress-fill" class="ai-progress-fill"></div>
                                <div class="ai-progress-text"><span id="ai-progress-num">0</span>%</div>
                            </div>
                        </div>

                        <div id="pred-results-view" style="display:none;">
                            <div class="ai-result-grid">
                                <div class="ai-summary-panel">
                                    <div class="ai-panel-title">/// EXECUTIVE_SUMMARY</div>
                                    <div id="ai-summary-text" class="ai-scramble-text"></div>
                                    <div class="ai-confidence-meter">
                                        <div class="meter-label">CONFIDENCE SCORE</div>
                                        <div class="meter-bar"><div style="width: 98.4%;"></div></div>
                                        <div class="meter-val">98.4%</div>
                                    </div>
                                </div>

                                <div class="ai-list-panel">
                                    <div class="ai-panel-title">/// DETECTED_ANOMALIES</div>
                                    <div id="pred-results-list" class="pred-list"></div>
                                </div>
                            </div>

                            <div id="pred-no-risk" style="display:none; text-align:center; padding-top:50px;">
                                <div class="ai-shield-pulse">
                                    <i class="fas fa-shield-alt"></i>
                                </div>
                                <h2 class="ai-glitch-text" data-text="SYSTEM SECURE" style="color:#00ff41; margin-top:20px;">SYSTEM SECURE</h2>
                                <p style="color:#00ff41; font-family:'Courier New';">No threats detected in sector 7G.</p>
                            </div>
                        </div>

                    </div>

                    <div class="ai-hud-footer">
                        <div class="footer-segment">LOC: GER_DHF_HQ</div>
                        <div class="footer-segment">ENC: AES-256</div>
                        <div class="footer-segment">USR: ADMIN_01</div>
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
            @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap');

            /* --- HUD BASE --- */
            .ai-modal-overlay {
                backdrop-filter: blur(8px);
                background-color: rgba(0, 0, 0, 0.9) !important;
                perspective: 1000px;
            }

            .ai-hud-frame {
                background-color: #0a0a0a;
                border: 2px solid #00ff41;
                box-shadow: 0 0 50px rgba(0, 255, 65, 0.2), inset 0 0 100px rgba(0, 255, 65, 0.1);
                color: #00ff41;
                font-family: 'Share Tech Mono', monospace;
                max-width: 900px !important;
                position: relative;
                overflow: hidden;
                border-radius: 0; /* Eckig ist technischer */
                /* Cooler 3D Effekt beim Öffnen */
                transform: rotateX(5deg);
                animation: hud-open 0.5s ease-out forwards;
            }
            @keyframes hud-open { from{transform: scale(0.9) rotateX(10deg); opacity:0;} to{transform: scale(1) rotateX(0deg); opacity:1;} }

            /* --- BACKGROUND FX --- */
            .ai-grid-background {
                position: absolute; top:0; left:0; width:200%; height:200%;
                background-image:
                    linear-gradient(rgba(0, 255, 65, 0.1) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(0, 255, 65, 0.1) 1px, transparent 1px);
                background-size: 40px 40px;
                transform: perspective(500px) rotateX(60deg) translateY(-100px) translateZ(-200px);
                animation: grid-move 20s linear infinite;
                z-index: 0;
                pointer-events: none;
            }
            @keyframes grid-move { 0% {background-position: 0 0;} 100% {background-position: 0 400px;} }

            .ai-scanline {
                position: absolute; top:0; left:0; width:100%; height:100%;
                background: linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0) 50%, rgba(0,0,0,0.2) 50%, rgba(0,0,0,0.2));
                background-size: 100% 4px;
                z-index: 2; pointer-events: none; opacity: 0.6;
            }
            .ai-vignette {
                position: absolute; top:0; left:0; width:100%; height:100%;
                background: radial-gradient(circle, rgba(0,0,0,0) 50%, rgba(0,0,0,0.8) 100%);
                z-index: 3; pointer-events: none;
            }

            /* --- HEADER --- */
            .ai-hud-header {
                display: flex; justify-content: space-between; align-items: center;
                padding: 15px; border-bottom: 2px solid #00ff41;
                background: rgba(0, 50, 0, 0.5); z-index: 5; position: relative;
            }
            .ai-brand { font-size: 24px; letter-spacing: 4px; text-shadow: 0 0 10px #00ff41; }
            .ai-blink { animation: blink 1s infinite; }
            .ai-hud-stats { display: flex; gap: 20px; font-size: 12px; color: #008f11; }

            /* Glitch Effect CSS */
            .ai-glitch-text { position: relative; }
            .ai-glitch-text::before, .ai-glitch-text::after {
                content: attr(data-text); position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            }
            .ai-glitch-text::before { left: 2px; text-shadow: -1px 0 red; clip: rect(44px, 450px, 56px, 0); animation: glitch-anim 5s infinite linear alternate-reverse; }
            .ai-glitch-text::after { left: -2px; text-shadow: -1px 0 blue; clip: rect(44px, 450px, 56px, 0); animation: glitch-anim2 5s infinite linear alternate-reverse; }

            @keyframes glitch-anim {
                0% { clip: rect(35px, 9999px, 16px, 0); }
                20% { clip: rect(68px, 9999px, 89px, 0); }
                40% { clip: rect(12px, 9999px, 34px, 0); }
                60% { clip: rect(96px, 9999px, 2px, 0); }
                80% { clip: rect(54px, 9999px, 83px, 0); }
                100% { clip: rect(9px, 9999px, 93px, 0); }
            }
            @keyframes glitch-anim2 {
                0% { clip: rect(15px, 9999px, 66px, 0); }
                20% { clip: rect(8px, 9999px, 99px, 0); }
                40% { clip: rect(2px, 9999px, 14px, 0); }
                60% { clip: rect(6px, 9999px, 22px, 0); }
                80% { clip: rect(4px, 9999px, 33px, 0); }
                100% { clip: rect(9px, 9999px, 3px, 0); }
            }

            /* --- LOADING --- */
            .ai-center-stage { text-align: center; margin-top: 20px; }

            .ai-hex-spinner {
                width: 100px; height: 100px; margin: 0 auto; position: relative;
                display: flex; justify-content: center; align-items: center;
            }
            .hex-layer-1 {
                position: absolute; width: 100%; height: 100%; border: 2px solid #00ff41;
                border-radius: 50%; border-top-color: transparent; border-bottom-color: transparent;
                animation: spin 1s infinite linear;
            }
            .hex-layer-2 {
                position: absolute; width: 80%; height: 80%; border: 2px solid #00ff41;
                border-radius: 50%; border-left-color: transparent; border-right-color: transparent;
                animation: spin 2s infinite reverse linear;
            }
            .hex-icon { font-size: 40px; animation: pulse 1s infinite; text-shadow: 0 0 20px #00ff41; }
            @keyframes spin { 100% { transform: rotate(360deg); } }
            @keyframes pulse { 0% { transform: scale(1); opacity:1;} 50% { transform: scale(1.1); opacity:0.7;} 100% { transform: scale(1); opacity:1;} }

            .ai-loading-status { font-size: 20px; margin-top: 20px; font-weight: bold; }
            .ai-loading-sub { color: #008f11; font-size: 14px; margin-bottom: 20px; }

            .ai-terminal-wrapper {
                background: #000; border: 1px solid #008f11; margin: 20px 0;
                padding: 10px; font-size: 12px; height: 120px; overflow: hidden;
                position: relative;
            }
            .ai-terminal-header { color: #008f11; border-bottom: 1px solid #008f11; margin-bottom: 5px; font-size: 10px; }
            .ai-terminal-content { color: #00ff41; line-height: 1.4; display: flex; flex-direction: column-reverse; }

            .ai-progress-bar-container { border: 1px solid #00ff41; height: 15px; position: relative; margin-top: 10px; background: #001100; }
            .ai-progress-fill { height: 100%; background: #00ff41; width: 0%; box-shadow: 0 0 20px #00ff41; transition: width 0.1s; }
            .ai-progress-text { position: absolute; width: 100%; text-align: center; top: -2px; color: #000; font-weight: bold; mix-blend-mode: screen; }

            .ai-charts-row { display: flex; gap: 20px; margin-bottom: 10px; }
            .ai-mini-chart { flex: 1; border: 1px solid #004400; padding: 5px; height: 40px; display: flex; align-items: flex-end; gap: 2px; }
            .chart-label { position: absolute; font-size: 9px; color: #00ff41; margin-top: -15px; }
            .ai-bar { flex: 1; background: #00ff41; transition: height 0.1s; opacity: 0.7; }

            /* --- RESULTS VIEW --- */
            .ai-result-grid { display: grid; grid-template-columns: 35% 65%; gap: 20px; height: 400px; }

            .ai-summary-panel { border-right: 2px solid #00ff41; padding-right: 20px; display: flex; flex-direction: column; }
            .ai-list-panel { overflow-y: auto; padding-right: 5px; }

            .ai-panel-title { color: #00ff41; font-weight: bold; border-bottom: 1px dashed #00ff41; margin-bottom: 10px; padding-bottom: 5px; }

            .ai-scramble-text { color: #fff; font-size: 16px; line-height: 1.6; flex-grow: 1; }

            .ai-confidence-meter { margin-top: 20px; }
            .meter-label { font-size: 10px; color: #008f11; margin-bottom: 5px; }
            .meter-bar { height: 10px; background: #003300; border: 1px solid #00ff41; }
            .meter-bar div { height: 100%; background: #00ff41; box-shadow: 0 0 10px #00ff41; }
            .meter-val { text-align: right; font-size: 18px; font-weight: bold; color: #00ff41; }

            /* Risk Card Styles */
            .ai-card {
                background: rgba(0, 50, 0, 0.4);
                border: 1px solid #00ff41;
                margin-bottom: 10px;
                display: flex;
                transition: 0.2s;
                position: relative;
            }
            .ai-card::before { content:''; position: absolute; top:0; left:0; width: 4px; height: 100%; background: #00ff41; }
            .ai-card:hover { background: rgba(0, 255, 65, 0.1); transform: translateX(5px); box-shadow: -5px 0 15px rgba(0,255,65,0.3); }

            .ai-card-date { background: #000; color: #00ff41; padding: 10px; display: flex; flex-direction: column; justify-content: center; align-items: center; border-right: 1px solid #00ff41; min-width: 60px; font-weight: bold; }
            .ai-card-content { padding: 10px; flex-grow: 1; }

            .risk-critical { border-color: #ff003c; color: #ff003c; }
            .risk-critical::before { background: #ff003c; }
            .risk-critical .ai-card-date { color: #ff003c; border-right-color: #ff003c; }

            .risk-medium { border-color: #ffcc00; color: #ffcc00; }
            .risk-medium::before { background: #ffcc00; }
            .risk-medium .ai-card-date { color: #ffcc00; border-right-color: #ffcc00; }

            .ai-rec { font-size: 12px; margin-top: 5px; color: #fff; font-style: italic; border-top: 1px solid #333; padding-top: 5px; }

            /* Footer */
            .ai-hud-footer {
                border-top: 1px solid #00ff41; background: #001100;
                padding: 5px 15px; display: flex; justify-content: space-between; font-size: 10px; color: #008f11;
            }

            /* No Risk Animation */
            .ai-shield-pulse {
                font-size: 80px; color: #00ff41; margin-bottom: 20px;
                filter: drop-shadow(0 0 20px #00ff41);
                animation: pulse-shield 2s infinite;
            }
            @keyframes pulse-shield { 0%{transform: scale(1); opacity: 1;} 50%{transform: scale(1.1); opacity: 0.8;} 100%{transform: scale(1); opacity: 1;} }

            ::-webkit-scrollbar { width: 5px; }
            ::-webkit-scrollbar-track { background: #000; }
            ::-webkit-scrollbar-thumb { background: #00ff41; }
        `;
        document.head.appendChild(style);
    },

    // --- "The Matrix" Decryption Effect ---
    scrambleText(targetText, elementId) {
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&";
        const el = document.getElementById(elementId);
        if(!el) return;

        let iteration = 0;
        const interval = setInterval(() => {
            el.innerText = targetText
                .split("")
                .map((letter, index) => {
                    if(index < iteration) {
                        return targetText[index];
                    }
                    return chars[Math.floor(Math.random() * 26)];
                })
                .join("");

            if(iteration >= targetText.length) {
                clearInterval(interval);
            }
            iteration += 1 / 2; // Speed
        }, 30);
    },

    // --- Terminal Logger ---
    logToTerminal(text) {
        const term = document.getElementById('ai-terminal-log');
        if (!term) return;
        const line = document.createElement('div');
        const now = new Date();
        const ts = `${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}.${String(now.getMilliseconds()).padStart(3, '0')}`;
        line.innerHTML = `<span style="opacity:0.5">[${ts}]</span> ${text}`;
        term.prepend(line); // Neueste oben
        if (term.children.length > 8) term.lastChild.remove();
    },

    // --- Fake Charts Animator ---
    animateCharts() {
        const chart1 = document.getElementById('chart-bars-1');
        const chart2 = document.getElementById('chart-bars-2');
        if(!chart1 || !chart2) return;

        // Zufällige Balken generieren
        const updateBars = (container) => {
            container.innerHTML = '';
            for(let i=0; i<10; i++) {
                const bar = document.createElement('div');
                bar.className = 'ai-bar';
                bar.style.height = Math.random() * 100 + '%';
                container.appendChild(bar);
            }
        };

        return setInterval(() => {
            updateBars(chart1);
            updateBars(chart2);
            // Random CPU Stats update
            document.getElementById('ai-cpu-val').innerText = Math.floor(Math.random() * 40) + 10;
        }, 200);
    },

    // --- The Big Show (Loading Sequence) ---
    async playLoadingSequence() {
        const progFill = document.getElementById('ai-progress-fill');
        const progNum = document.getElementById('ai-progress-num');
        const mainStatus = document.getElementById('ai-main-status');
        const subStatus = document.getElementById('ai-sub-status');

        const chartInterval = this.animateCharts();

        const steps = [
            { t: "ESTABLISHING SECURE LINK", s: "Handshaking with Neural Core...", p: 10 },
            { t: "DOWNLOADING DATASETS", s: "Fetching historical shift patterns (2020-2024)...", p: 25 },
            { t: "ANALYZING VECTORS", s: "Correlating sickness probabilities with weather API...", p: 45 },
            { t: "OPTIMIZING TENSORS", s: "Allocating 24GB VRAM for prediction model...", p: 65 },
            { t: "DETECTING CONFLICTS", s: "Scanning 4,023 permutations...", p: 80 },
            { t: "FINALIZING REPORT", s: "Generating human-readable summary...", p: 100 }
        ];

        // Filler Logs für Matrix Feeling
        const fillers = [
            "module 'tensorflow' loaded", "CUDA cores: 4096 active",
            "Pattern mismatch detected in sector 4", "Heuristic scan: OK",
            "Compiling results...", "Access granted"
        ];

        for (const step of steps) {
            this.scrambleText(step.t, 'ai-main-status');
            subStatus.innerText = step.s;

            // Animation bis zum nächsten Prozentpunkt
            const startP = parseInt(progNum.innerText);
            const endP = step.p;

            for(let i=startP; i<=endP; i++) {
                progFill.style.width = `${i}%`;
                progNum.innerText = i;
                await new Promise(r => setTimeout(r, 20)); // Smooth progress
            }

            this.logToTerminal(`>> ${step.t}`);
            // Filler logs
            for(let j=0; j<3; j++) {
                await new Promise(r => setTimeout(r, 100));
                this.logToTerminal(fillers[Math.floor(Math.random()*fillers.length)]);
            }
        }

        clearInterval(chartInterval);
    },

    async runAnalysis() {
        const modal = document.getElementById('prediction-modal');
        const loadingView = document.getElementById('pred-loading');
        const resultsView = document.getElementById('pred-results-view');
        const list = document.getElementById('pred-results-list');
        const noRisk = document.getElementById('pred-no-risk');

        modal.style.display = 'block';
        loadingView.style.display = 'block';
        resultsView.style.display = 'none';

        // Reset
        document.getElementById('ai-progress-num').innerText = "0";
        document.getElementById('ai-progress-fill').style.width = "0%";
        document.getElementById('ai-terminal-log').innerHTML = "";

        // Starte "The Show"
        const loadingPromise = this.playLoadingSequence();

        try {
            // Echter API Call
            const fetchPromise = apiFetch(`/api/prediction/analyze?year=${PlanState.currentYear}&month=${PlanState.currentMonth}&variant_id=${PlanState.currentVariantId || ''}`);

            const [_, result] = await Promise.all([loadingPromise, fetchPromise]);

            // Switch to Results
            loadingView.style.display = 'none';
            resultsView.style.display = 'block';

            // Zusammenfassung entschlüsseln
            this.scrambleText(result.summary, 'ai-summary-text');

            // Liste bauen
            list.innerHTML = '';
            if (result.risks.length === 0) {
                noRisk.style.display = 'block';
            } else {
                noRisk.style.display = 'none';
                result.risks.forEach(risk => {
                    const d = new Date(risk.date);
                    const wdStr = d.toLocaleDateString('de-DE', { weekday: 'short' }).toUpperCase();
                    const dayStr = d.getDate();

                    const isHigh = risk.risk_class === 'high';
                    const riskClass = isHigh ? 'risk-critical' : 'risk-medium';
                    const icon = isHigh ? '<i class="fas fa-exclamation-triangle"></i>' : '<i class="fas fa-info-circle"></i>';

                    const div = document.createElement('div');
                    div.className = `ai-card ${riskClass}`;

                    div.innerHTML = `
                        <div class="ai-card-date">
                            <div style="font-size:10px;">${wdStr}</div>
                            <div style="font-size:24px;">${dayStr}</div>
                        </div>
                        <div class="ai-card-content">
                            <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                                <span>${icon} ${risk.message}</span>
                                <span style="font-weight:bold;">${risk.risk_score}% PROBABILITY</span>
                            </div>
                            <div style="font-size:10px; opacity:0.8;">FACTORS: ${risk.factors.join(' // ')}</div>
                            <div class="ai-rec">> RECOMMENDATION: ${risk.recommendation}</div>
                        </div>
                    `;
                    list.appendChild(div);
                });
            }

        } catch (e) {
            loadingView.style.display = 'none';
            alert("Verbindungsfehler: " + e.message); // Fallback, falls die Show crasht
        }
    }
};