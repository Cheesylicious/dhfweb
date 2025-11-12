/**
 * DHF-Planer - Geteiltes Feedback-Modul
 * * Dieses Skript wird auf allen Seiten geladen. Es fügt dynamisch hinzu:
 * 1. Den CSS-Style für das Feedback-Modal.
 * 2. Den HTML-Body für das Feedback-Modal.
 * 3. Die Event-Listener für das Öffnen, Schließen und Senden des Modals.
 * * (Regel 4: Vermeidet Codeduplizierung in allen HTML-Dateien)
 */

(function() {
    // Stellt sicher, dass das Skript nur einmal ausgeführt wird
    if (document.getElementById('feedback-modal-styles')) {
        return;
    }

    const API_URL = 'http://46.224.63.203:5000';

    // --- 1. CSS-Stile dynamisch injizieren ---
    const styles = `
        .feedback-modal {
            display: none;
            position: fixed;
            z-index: 200000; /* (Über allem) */
            left: 0; top: 0;
            width: 100%; height: 100%;
            overflow: auto;
            background-color: rgba(0,0,0,0.6);
        }
        .feedback-modal-content {
            background: rgba(30, 30, 30, 0.8); /* (Dunkles Glas) */
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            margin: 10% auto;
            padding: 0;
            width: 90%;
            max-width: 550px;
            border-radius: 8px;
            box-shadow: 0 4px 30px rgba(0,0,0,0.4);
            color: #ffffff;
        }
        .feedback-modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px 25px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }
        .feedback-modal-header h2 {
            margin: 0;
            color: #ffffff;
            font-weight: 600;
            font-size: 1.2rem;
        }
        .feedback-close {
            color: #bdc3c7;
            font-size: 28px;
            font-weight: bold;
            cursor: pointer;
            transition: color 0.3s;
        }
        .feedback-close:hover { color: #ffffff; }
        .feedback-modal-body { padding: 25px; }
        .feedback-modal-footer {
            padding: 15px 25px;
            background: rgba(0, 0, 0, 0.2);
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            text-align: right;
            border-radius: 0 0 8px 8px;
        }

        /* (Formular-Styling) */
        .feedback-form-group { margin-bottom: 15px; }
        .feedback-form-group label {
            display: block;
            margin-bottom: 8px;
            font-weight: 300;
            color: #bdc3c7;
        }
        .feedback-form-group input[type="text"],
        .feedback-form-group select,
        .feedback-form-group textarea {
            width: 100%;
            padding: 10px;
            box-sizing: border-box;
            background: rgba(0, 0, 0, 0.2);
            border: 1px solid #3498db;
            border-radius: 5px;
            color: #ffffff;
            font-family: 'Poppins', sans-serif;
            font-size: 14px;
        }
        .feedback-form-group textarea {
            min-height: 120px;
            resize: vertical;
        }
        .feedback-form-group select {
             -webkit-appearance: none;
             -moz-appearance: none;
             appearance: none;
             background-image: url('data:image/svg+xml;utf8,<svg fill="white" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M7 10l5 5 5-5z"/></svg>');
             background-repeat: no-repeat;
             background-position-x: 98%;
             background-position-y: 50%;
             padding-right: 30px;
        }

        /* (Innovatives Button-Auswahl-Design) */
        .feedback-type-selection {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 10px;
            margin-bottom: 15px;
        }
        .feedback-type-selection input[type="radio"] {
            display: none; /* (Radio-Button verstecken) */
        }
        .feedback-type-selection label {
            display: block;
            padding: 12px;
            background: rgba(0,0,0,0.2);
            border: 1px solid #555;
            border-radius: 5px;
            text-align: center;
            cursor: pointer;
            transition: background-color 0.3s, border-color 0.3s;
            font-weight: 500;
            color: #bdc3c7;
        }
        .feedback-type-selection input[type="radio"]:checked + label {
            background: #3498db;
            border-color: #3498db;
            color: white;
            box-shadow: 0 0 10px rgba(52, 152, 219, 0.5);
        }

        /* (Status-Nachricht im Modal) */
        #feedback-modal-status {
            text-align: left;
            font-weight: 500;
            float: left;
            line-height: 38px; /* (Höhe des Buttons) */
        }

        /* (Buttons) */
        .feedback-btn-primary {
            background: #007bff; color: white; padding: 10px 15px; border: none;
            border-radius: 5px; cursor: pointer; font-size: 15px; transition: opacity 0.3s;
        }
        .feedback-btn-primary:hover { opacity: 0.8; }
        .feedback-btn-primary:disabled { background: #555; opacity: 0.7; cursor: not-allowed; }
    `;

    const styleSheet = document.createElement("style");
    styleSheet.id = "feedback-modal-styles";
    styleSheet.innerText = styles;
    document.head.appendChild(styleSheet);

    // --- 2. HTML-Struktur dynamisch injizieren ---
    const modalHTML = `
        <div id="feedback-modal" class="feedback-modal">
            <div class="feedback-modal-content">
                <div class="feedback-modal-header">
                    <h2>Problem melden / Vorschlag</h2>
                    <span class="feedback-close" id="feedback-close-btn">&times;</span>
                </div>
                <div class="feedback-modal-body">

                    <div class="feedback-form-group">
                        <label>Art der Meldung:</label>
                        <div class="feedback-type-selection">
                            <input type="radio" id="feedback-type-bug" name="feedback_type" value="bug" checked>
                            <label for="feedback-type-bug">🐞 Fehler (Bug)</label>

                            <input type="radio" id="feedback-type-improvement" name="feedback_type" value="improvement">
                            <label for="feedback-type-improvement">💡 Vorschlag</label>

                            <input type="radio" id="feedback-type-other" name="feedback_type" value="other">
                            <label for="feedback-type-other">💬 Sonstiges</label>
                        </div>
                    </div>

                    <div class="feedback-form-group">
                        <label for="feedback-category">Welchen Bereich betrifft es?</label>
                        <select id="feedback-category">
                            <option value="Allgemein">Allgemein / Sonstiges</option>
                            <option value="Schichtplan">Schichtplan</option>
                            <option value="Benutzerverwaltung">Benutzerverwaltung</option>
                            <option value="Login">Login / Dashboard</option>
                            <option value="Einstellungen">Einstellungen</option>
                        </select>
                    </div>

                    <div class="feedback-form-group">
                        <label for="feedback-message">Ihre Nachricht:</label>
                        <textarea id="feedback-message" placeholder="Bitte beschreiben Sie den Fehler oder Ihre Idee so genau wie möglich..."></textarea>
                    </div>

                </div>
                <div class="feedback-modal-footer">
                    <span id="feedback-modal-status"></span>
                    <button class="feedback-btn-primary" id="feedback-submit-btn">Absenden</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // --- 3. Event-Listener und Logik ---

    const modal = document.getElementById('feedback-modal');
    const openBtn = document.getElementById('global-report-btn'); // (Dieser Button wird in Schritt 6 erstellt)
    const closeBtn = document.getElementById('feedback-close-btn');
    const submitBtn = document.getElementById('feedback-submit-btn');
    const statusEl = document.getElementById('feedback-modal-status');

    // Öffnen
    if (openBtn) {
        openBtn.onclick = () => {
            modal.style.display = 'block';
            statusEl.textContent = '';
            statusEl.style.color = '';
            document.getElementById('feedback-message').value = ''; // (Immer leeren)
        };
    }

    // Schließen
    closeBtn.onclick = () => {
        modal.style.display = 'none';
    };
    window.onclick = (event) => {
        if (event.target == modal) {
            modal.style.display = 'none';
        }
    };

    // Senden
    submitBtn.onclick = async () => {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sende...';
        statusEl.textContent = '';

        let response; // (Variable für Antwort)

        try {
            const payload = {
                report_type: document.querySelector('input[name="feedback_type"]:checked').value,
                category: document.getElementById('feedback-category').value,
                message: document.getElementById('feedback-message').value,
                page_context: window.location.pathname // (Kontext, wo der User war)
            };

            if (!payload.message) {
                throw new Error("Bitte geben Sie eine Nachricht ein.");
            }

            // (API-Aufruf - Standard fetch, da apiFetch() hier nicht definiert ist)
            response = await fetch(API_URL + '/api/feedback', { // (Response zuweisen)
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include' // (Wichtig für Login-Cookie)
            });

            if (response.status === 401) { throw new Error("Sitzung abgelaufen. Bitte neu einloggen."); }

            // *** KORREKTUR: Prüfe .ok VOR .json() ***
            // Prüfen, ob die Antwort erfolgreich war (Status 200-299)
            if (!response.ok) {
                // Versuchen, die Fehler-JSON zu lesen
                let errorData;
                try {
                    errorData = await response.json();
                } catch (e) {
                    // Wenn das fehlschlägt (weil es HTML war), nutze den Status-Text
                    throw new Error(`Serverfehler ${response.status}: ${response.statusText}`);
                }
                // Wenn es JSON war, nutze die Server-Nachricht
                throw new Error(errorData.message || 'Unbekannter API-Fehler');
            }

            // Nur wenn response.ok, versuchen wir, JSON zu lesen
            const data = await response.json();

            // Erfolg
            statusEl.textContent = 'Vielen Dank! Meldung gesendet.';
            statusEl.style.color = '#2ecc71';
            submitBtn.textContent = 'Gesendet!';

            setTimeout(() => {
                modal.style.display = 'none';
                submitBtn.disabled = false;
                submitBtn.textContent = 'Absenden';
            }, 2000);

        } catch (error) {
            // (Fehlerbehandlung für alle Fehler (Netzwerk, Validierung, 404, 500))
            statusEl.textContent = `Fehler: ${error.message}`;
            statusEl.style.color = '#e74c3c';
            submitBtn.disabled = false;
            submitBtn.textContent = 'Absenden';
        }
    };

})(); // (Skript sofort ausführen)