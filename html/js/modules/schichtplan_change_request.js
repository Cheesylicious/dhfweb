/**
 * Modul für Änderungsanträge in gesperrten Plänen (Planschreiber-Funktion).
 */
import { PlanState } from './schichtplan_state.js';
import { PlanRenderer } from './schichtplan_renderer.js';

export const ChangeRequestModule = {

    // Initialisiert das Modal im DOM, falls noch nicht vorhanden
    initModal() {
        if (document.getElementById('change-request-modal')) return;

        const modalHtml = `
        <div id="change-request-modal" class="modal">
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Krankmeldung & Ersatz</h2>
                    <span class="close" id="close-cr-modal">&times;</span>
                </div>
                <div class="modal-body">
                    <p>Der Plan ist gesperrt. Sie können hier eine Änderung beantragen.</p>

                    <div class="form-group">
                        <label>Betroffener Mitarbeiter (Wird 'Krank' gesetzt):</label>
                        <input type="text" id="cr-original-user" disabled style="background:#eee; width: 100%; box-sizing: border-box; padding: 8px;">
                        <input type="hidden" id="cr-shift-id">
                    </div>

                    <div class="form-group" style="margin-top:15px;">
                        <label>Ersatz-Mitarbeiter vorschlagen (Optional):</label>
                        <select id="cr-replacement-select" style="width:100%; padding:8px; box-sizing: border-box;">
                            <option value="">-- Kein Ersatz / Offen lassen --</option>
                            </select>
                    </div>

                    <div class="form-group" style="margin-top:15px;">
                        <label>Notiz an Admin:</label>
                        <textarea id="cr-note" rows="3" style="width:100%; box-sizing: border-box; padding: 8px;"></textarea>
                    </div>

                    <div style="margin-top:20px; text-align:right;">
                        <button class="btn-primary" id="cr-submit-btn" style="background-color: #e74c3c; border: none; padding: 10px 20px; color: white; border-radius: 4px; cursor: pointer;">Antrag senden</button>
                    </div>
                </div>
            </div>
        </div>`;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Event Listeners
        const closeBtn = document.getElementById('close-cr-modal');
        if(closeBtn) closeBtn.onclick = () => {
            document.getElementById('change-request-modal').style.display = "none";
        };

        const submitBtn = document.getElementById('cr-submit-btn');
        if(submitBtn) submitBtn.onclick = this.submitRequest.bind(this);

        // Modal schließt beim Klick daneben
        window.addEventListener('click', (e) => {
            const m = document.getElementById('change-request-modal');
            if (e.target === m) m.style.display = "none";
        });
    },

    /**
     * Öffnet das Modal.
     * @param {number} shiftId - ID der Schicht in der Datenbank
     * @param {string} userName - Name des kranken Mitarbeiters (Anzeige)
     * @param {string} dateStr - Datum (Anzeige)
     * @param {number} originalUserId - ID des kranken Mitarbeiters (zum Filtern)
     */
    openRequestModal(shiftId, userName, dateStr, originalUserId) {
        this.initModal();

        // Fülle Daten
        document.getElementById('cr-shift-id').value = shiftId;
        document.getElementById('cr-original-user').value = `${userName} (${dateStr})`;
        document.getElementById('cr-note').value = "";

        // Fülle Select mit Usern
        const select = document.getElementById('cr-replacement-select');
        select.innerHTML = '<option value="">-- Kein Ersatz / Offen lassen --</option>';

        // KORREKTUR: Nutze PlanState.allUsers statt PlanState.users
        const users = PlanState.allUsers || PlanState.users || [];

        users.forEach(u => {
            // Filtere per ID, nicht per Namensvergleich (sicherer bei gleichen Namen)
            if (u.id !== originalUserId) {
                const opt = document.createElement('option');
                opt.value = u.id;
                opt.textContent = `${u.vorname} ${u.name}`;
                select.appendChild(opt);
            }
        });

        document.getElementById('change-request-modal').style.display = "block";
    },

    async submitRequest() {
        const shiftId = document.getElementById('cr-shift-id').value;
        const replacementId = document.getElementById('cr-replacement-select').value;
        const note = document.getElementById('cr-note').value;
        const submitBtn = document.getElementById('cr-submit-btn');

        if(!shiftId) return;

        // Button sperren gegen Doppelklick
        submitBtn.disabled = true;
        submitBtn.textContent = "Sende...";

        try {
            // Sende an Backend
            const response = await fetch('/api/shift-change/request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    shift_id: shiftId,
                    replacement_user_id: replacementId ? parseInt(replacementId) : null,
                    note: note
                })
            });

            const data = await response.json();

            if (response.ok) {
                // Modal schließen ohne nervigen Alert
                document.getElementById('change-request-modal').style.display = "none";

                // --- INNOVATIVES UPDATE: Prüfen ob Änderungen vom Server kamen ---
                if (data.changes && Array.isArray(data.changes) && data.changes.length > 0) {
                    // WIR HABEN ÄNDERUNGEN -> LOKAL APPLIZIEREN (KEIN RELOAD)
                    data.changes.forEach(change => {
                        const key = `${change.user_id}-${change.date}`;

                        // Shift Type Informationen aus dem lokalen Cache holen
                        const fullShiftType = PlanState.allShiftTypes[change.shifttype_id];

                        // State lokal aktualisieren
                        PlanState.currentShifts[key] = {
                            id: change.id,
                            user_id: change.user_id,
                            date: change.date,
                            shifttype_id: change.shifttype_id,
                            is_locked: change.is_locked,
                            shift_type: fullShiftType
                        };

                        // Renderer anweisen, nur diese Zelle neu zu zeichnen
                        PlanRenderer.refreshSingleCell(change.user_id, change.date);
                    });

                    // Erfolg visuell kurz anzeigen (optional, z.B. in der Console oder Statusbar)
                    console.log("Plan lokal aktualisiert.");

                } else {
                    // Fallback: Wenn Server keine 'changes' schickt, laden wir sicherheitshalber neu
                    console.warn("Keine Änderungsdaten empfangen, lade Plan neu...");
                    document.dispatchEvent(new CustomEvent('dhf:reload-grid'));
                }

            } else {
                let errText = data.error || data.message || "Unbekannter Fehler";
                alert("Fehler: " + errText);
            }
        } catch (e) {
            alert("Netzwerkfehler: " + e.message);
            console.error(e);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = "Antrag senden";
        }
    }
};