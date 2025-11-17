// js/pages/dashboard.js

// --- IMPORTE (Regel 4: Wiederverwendung) ---
import { API_URL } from '../utils/constants.js'; // (Pfad relativ zur HTML-Datei)
import { apiFetch } from '../utils/api.js';
import { initAuthCheck, logout } from '../utils/auth.js'; // (Pfad relativ zur HTML-Datei)

// --- Globales Setup (Seiten-spezifisch) ---
let user;
let isAdmin = false;

// DOM-Elemente für diese Seite
const manualLogBtn = document.getElementById('manual-log-btn');
const logList = document.getElementById('update-log-list');
const manualModal = document.getElementById('manual-update-modal');
const closeManualModalBtn = document.getElementById('close-manual-log-modal');
const saveManualLogBtn = document.getElementById('save-manual-log-btn');
const logDescriptionField = document.getElementById('log-description');
const logAreaField = document.getElementById('log-area');
const manualLogStatus = document.getElementById('manual-log-status');

// --- 1. Authentifizierung (Regel 4: Zentralisiert) ---
try {
    // Ruft die zentrale Auth-Prüfung auf.
    // Diese Funktion kümmert sich um:
    // 1. User-Prüfung (localStorage)
    // 2. Rollen-Zuweisung (isAdmin, etc.)
    // 3. Navigations-Anpassung (Links ein/ausblenden)
    // 4. Logout-Button-Listener
    // 5. Auto-Logout-Timer
    const authData = initAuthCheck();
    user = authData.user;
    isAdmin = authData.isAdmin;

    // (Die 'logout'-Funktion ist jetzt importiert und wird
    // automatisch an den Logout-Button gebunden, falls vorhanden)

    // *** SEHR WICHTIG: Zugriffsschutz (Spezifisch für diese Seite) ***
    // (Der Head-Script-Block in dashboard.html leitet Besucher bereits um,
    // aber wir führen den Check hier sicherheitshalber aus.)
    if (authData.isVisitor) {
        window.location.href = 'schichtplan.html';
        throw new Error("Besucher dürfen das Dashboard nicht sehen.");
    }

    // --- Seiten-spezifische UI-Anpassungen ---
    document.getElementById('welcome-message').textContent = `Willkommen, ${user.vorname}!`;

    // (Die Navigationsanpassung (navUsers, navFeedback)
    // wird bereits von initAuthCheck() übernommen)

    // Admin-spezifische UI-Elemente auf DIESER Seite
    if (isAdmin) {
        if(manualLogBtn) manualLogBtn.classList.remove('hidden');
        document.querySelector('.card-section p').textContent = "Dies ist das Admin-Dashboard. Wählen Sie einen Bereich aus der Navigation oben.";
    }
    // Planschreiber-spezifisch
    else if (authData.isPlanschreiber) {
         if(manualLogBtn) manualLogBtn.classList.add('hidden');
         document.querySelector('.card-section p').textContent = "Dies ist das Dashboard. Sie haben Zugriff auf den Schichtplan und die Schicht-Anfragen (unter Meldungen).";
    }
    // Hundeführer-spezifisch
    else if (authData.isHundefuehrer) {
         if(manualLogBtn) manualLogBtn.classList.add('hidden');
         document.querySelector('.card-section p').textContent = "Dies ist das Dashboard. Sie können Ihre Schicht-Anfragen im Schichtplan per Rechtsklick auf Ihre Zeile stellen.";
    }
    // Standard-User
    else {
         if(manualLogBtn) manualLogBtn.classList.add('hidden');
         document.querySelector('.card-section p').textContent = "Dies ist das Dashboard. Wählen Sie einen Bereich aus der Navigation oben.";
    }

    // Lade die Daten für diese Seite
    loadUpdateLog();

} catch (e) {
    // Wenn initAuthCheck fehlschlägt (z.B. kein User), wird die Ausführung gestoppt.
    // Der User wird bereits umgeleitet (via auth.js).
    console.error("Fehler bei der Initialisierung von dashboard.js:", e.message);

    // Wir stoppen die weitere Ausführung des Skripts
    throw new Error("Initialisierung gestoppt.");
}

// (Die redundanten logout() und apiFetch() Funktionen wurden entfernt)


// --- Seiten-spezifische Logik ---

/**
 * Lädt das Update Log und rendert es in die Liste.
 */
async function loadUpdateLog() {
    if (!logList) return;

    try {
        // Nutzt die importierte apiFetch (Regel 4)
        const logs = await apiFetch('/api/updatelog');

        if (logs.length === 0) {
            logList.innerHTML = '<li style="padding: 10px 0;">Keine Update-Einträge gefunden.</li>';
            return;
        }

        logList.innerHTML = '';
        logs.forEach(log => {
            const date = new Date(log.updated_at);
            const formattedDate = date.toLocaleDateString('de-DE', {
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit'
            });

            const deleteButtonHTML = isAdmin
                                   ? `<button class="delete-log-btn" data-log-id="${log.id}">×</button>`
                                   : '';
            const li = document.createElement('li');
            li.className = 'log-item';
            li.dataset.logId = log.id;
            li.innerHTML = `
                <div class="log-content">
                    <span class="log-area">${log.area}</span>
                    <span>${log.description}</span>
                    <span class="log-date">${formattedDate} Uhr</span>
                </div>
                ${deleteButtonHTML}
            `;
            logList.appendChild(li);
        });

    } catch (error) {
        logList.innerHTML = `<li style="color: #e74c3c; padding: 10px 0;">Fehler beim Laden der Updates: ${error.message}</li>`;
    }
}

/**
 * Löscht einen Log-Eintrag (nur Admin).
 */
async function deleteLogEntry(logId, listItem) {
    if (!confirm(`Sicher, dass Sie den Log-Eintrag #${logId} löschen möchten?`)) {
        return;
    }
    try {
        await apiFetch(`/api/updatelog/${logId}`, 'DELETE');
        listItem.style.opacity = 0;
        setTimeout(() => listItem.remove(), 300);
    } catch (error) {
        alert('Fehler beim Löschen des Eintrags: ' + error.message);
    }
}

// --- Event Delegation für Löschen (Admin) ---
document.addEventListener('click', (event) => {
    const target = event.target;
    if (isAdmin && target.classList.contains('delete-log-btn')) {
        const logId = target.dataset.logId;
        const listItem = target.closest('.log-item');
        if (logId && listItem) {
            deleteLogEntry(logId, listItem);
        }
    }
});


// --- Modal-Logik (Admin) ---
if (manualLogBtn) {
    manualLogBtn.onclick = () => {
        if (!isAdmin || !manualModal) return;
        if(logDescriptionField) logDescriptionField.value = '';
        if(logAreaField) logAreaField.value = '';
        if(manualLogStatus) manualLogStatus.textContent = '';
        manualModal.style.display = 'block';
    };
}

if (closeManualModalBtn) {
    closeManualModalBtn.onclick = () => {
        if(manualModal) manualModal.style.display = 'none';
    };
}

if (saveManualLogBtn) {
    saveManualLogBtn.onclick = async () => {
        const description = logDescriptionField.value.trim();
        const area = logAreaField.value.trim();
        if (description.length < 5) {
            if(manualLogStatus) manualLogStatus.textContent = "Bitte geben Sie eine detailliertere Beschreibung ein (min. 5 Zeichen).";
            return;
        }

        saveManualLogBtn.disabled = true;
        if(manualLogStatus) {
            manualLogStatus.textContent = 'Speichere Protokoll...';
            manualLogStatus.style.color = '#bdc3c7';
        }

        const payload = { description: description };
        if (area) payload.area = area;

        try {
            await apiFetch('/api/manual_update_log', 'POST', payload);
            if(manualLogStatus) {
                manualLogStatus.textContent = 'Protokoll erfolgreich gespeichert!';
                manualLogStatus.style.color = '#2ecc71';
            }
            await loadUpdateLog();
            setTimeout(() => { if(manualModal) manualModal.style.display = 'none'; }, 1000);
        } catch (error) {
            if(manualLogStatus) {
                 manualLogStatus.textContent = 'Fehler beim Speichern: ' + error.message;
                 manualLogStatus.style.color = '#e74c3c';
            }
        } finally {
            saveManualLogBtn.disabled = false;
        }
    };
}

window.onclick = (event) => {
    if (event.target == manualModal && manualModal) {
        manualModal.style.display = 'none';
    }
}