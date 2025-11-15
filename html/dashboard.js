const API_URL = 'http://46.224.63.203:5000'; // Ersetzen Sie dies ggf. durch Ihre Domain
let user;
let isAdmin = false; // Initialisiert für saubere Scope-Nutzung
let manualLogBtn; // KORREKTUR: Deklariert für globalen Zugriff

async function logout() {
    try {
        await apiFetch('/api/logout', 'POST');
    } catch (error) {
        console.error("Logout-Fehler:", error.message);
    } finally {
        localStorage.removeItem('dhf_user');
        window.location.href = 'index.html?logout=true';
    }
}

// --- Logik: Benutzerrollen-Check und Navigation anpassen ---
try {
    user = JSON.parse(localStorage.getItem('dhf_user'));
    if (!user || !user.vorname || !user.role) { throw new Error("Kein User oder fehlende Rolle"); }

    isAdmin = user.role.name === 'admin';
    // --- START NEU: Planschreiber-Rolle ---
    const isPlanschreiber = user.role.name === 'Planschreiber';
    // --- ENDE NEU ---

    // Die isVisitor Prüfung ist dank des Head-Skripts nicht mehr nötig,
    // da Besucher bereits umgeleitet werden, bevor dieser Teil ausgeführt wird.

    document.getElementById('welcome-user').textContent = `Willkommen, ${user.vorname}!`;
    document.getElementById('welcome-message').textContent = `Willkommen, ${user.vorname}!`;

    const navDashboard = document.getElementById('nav-dashboard');
    const navUsers = document.getElementById('nav-users');

    // --- NEU: Feedback-Link für Admins holen ---
    const navFeedback = document.getElementById('nav-feedback');

    // KORREKTUR: Button holen
    manualLogBtn = document.getElementById('manual-log-btn');


    // Sichtbarkeit der Links für Nicht-Besucher (Admins und Standard-User)

    // Dashboard Link ist für Nicht-Besucher sichtbar
    navDashboard.style.display = 'block';

    // Admin-spezifische Links
    if (isAdmin) {
        navUsers.style.display = 'block';
        navFeedback.style.display = 'inline-flex'; // (Feedback-Link anzeigen)
        if(manualLogBtn) manualLogBtn.classList.remove('hidden'); // Button für Admin anzeigen

        document.querySelector('.card-section p').textContent = "Dies ist das Admin-Dashboard. Wählen Sie einen Bereich aus der Navigation oben.";
    }
    // --- START NEU: Planschreiber-Navigationslogik ---
    else if (isPlanschreiber) {
         navUsers.style.display = 'none';
         navFeedback.style.display = 'inline-flex'; // Planschreiber darf Meldungen sehen
         if(manualLogBtn) manualLogBtn.classList.add('hidden');

         document.querySelector('.card-section p').textContent = "Dies ist das Dashboard. Sie haben Zugriff auf den Schichtplan und die Schicht-Anfragen (unter Meldungen).";
    }
    // --- ENDE NEU ---
    else {
         // Standard-User Logik: Update-Log bleibt sichtbar (durch Entfernen des Ausblend-Codes)
         navUsers.style.display = 'none';
         navFeedback.style.display = 'none'; // Feedback-Link nur für Admins/Planschreiber
         if(manualLogBtn) manualLogBtn.classList.add('hidden');

         document.querySelector('.card-section p').textContent = "Dies ist das Dashboard. Wählen Sie einen Bereich aus der Navigation oben.";
    }

    // <<< NEUE LOGIK: UPDATE LOG LADEN >>>
    loadUpdateLog();


} catch (e) {
    // Wenn der User nicht da ist oder ungültig, leite um
    window.location.href = 'index.html?logout=true';
}

document.getElementById('logout-btn').onclick = logout;

async function apiFetch(endpoint, method = 'GET', body = null) {
    const options = {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
    };
    if (body) { options.body = JSON.stringify(body); }
    const response = await fetch(API_URL + endpoint, options);
    if (response.status === 401 || response.status === 403) {
        logout();
        throw new Error('Sitzung ungültig');
    }
    if (!response.ok) {
        // Versuchen, den Fehler als JSON zu parsen (robuster)
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
             const data = await response.json();
             throw new Error(data.message || 'API-Fehler');
        }
        throw new Error('API-Fehler: ' + response.statusText);
    }
    if (response.status !== 204) {
        try { return await response.json(); } catch(e) { return {}; }
    }
}

// <<< NEUE FUNKTION: Update Log laden und rendern >>>
async function loadUpdateLog() {
    const logList = document.getElementById('update-log-list');
    if (!logList) return;

    try {
        // Ruft die neue Admin-Route ab (ist @login_required, nicht @admin_required)
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

            // Lösch-Button nur für Admins anzeigen
            const deleteButtonHTML = isAdmin
                                   ? `<button class="delete-log-btn" data-log-id="${log.id}">×</button>`
                                   : '';


            const li = document.createElement('li');
            li.className = 'log-item';
            li.dataset.logId = log.id; // Speichere ID für Event Delegation
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
        // Bei 403/401 (Nicht-Admin oder ausgeloggt) wird der Fehler bereits abgefangen.
        logList.innerHTML = `<li style="color: #e74c3c; padding: 10px 0;">Fehler beim Laden der Updates: ${error.message}</li>`;
    }
}

// <<< NEUE FUNKTION: Lösch-Logik >>>
async function deleteLogEntry(logId, listItem) {
    if (!confirm(`Sicher, dass Sie den Log-Eintrag #${logId} löschen möchten?`)) {
        return;
    }

    try {
        // Ruft die neue DELETE-Route auf
        await apiFetch(`/api/updatelog/${logId}`, 'DELETE');

        // Sanfter Fade-Out und Entfernung aus dem DOM (UX)
        listItem.style.opacity = 0;
        setTimeout(() => {
            listItem.remove();
        }, 300);

    } catch (error) {
        alert('Fehler beim Löschen des Eintrags: ' + error.message);
    }
}


// --- Event Delegation für Löschen ---
document.addEventListener('click', (event) => {
    const target = event.target;

    // Prüft, ob das geklickte Element der Lösch-Button ist und wir ein Admin sind
    if (isAdmin && target.classList.contains('delete-log-btn')) {
        const logId = target.dataset.logId;
        const listItem = target.closest('.log-item');

        if (logId && listItem) {
            deleteLogEntry(logId, listItem);
        }
    }
});


// --- MODAL-LOGIK FÜR MANUELLES PROTOKOLLIEREN (NEU) ---

const manualModal = document.getElementById('manual-update-modal');
const closeManualModalBtn = document.getElementById('close-manual-log-modal');
const saveManualLogBtn = document.getElementById('save-manual-log-btn');
const logDescriptionField = document.getElementById('log-description');
const logAreaField = document.getElementById('log-area');
const manualLogStatus = document.getElementById('manual-log-status');


// <<< HIER WIRD DER HANDLER FÜR DEN BUTTON ZUGEWIESEN >>>
if (manualLogBtn) {
    manualLogBtn.onclick = () => {
        if (!isAdmin) return;
        if(logDescriptionField) logDescriptionField.value = '';
        if(logAreaField) logAreaField.value = '';
        if(manualLogStatus) manualLogStatus.textContent = '';
        if(manualModal) manualModal.style.display = 'block';
    };
}
// <<< ENDE BUTTON ZUWEISUNG >>>

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

        const payload = {
            description: description
        };
        if (area) {
            payload.area = area;
        }

        try {
            // Ruft die neue POST-Route auf (api/manual_update_log)
            await apiFetch('/api/manual_update_log', 'POST', payload);

            if(manualLogStatus) {
                manualLogStatus.textContent = 'Protokoll erfolgreich gespeichert!';
                manualLogStatus.style.color = '#2ecc71';
            }

            // Logik: Modal schließen und Liste neu laden
            await loadUpdateLog();

            setTimeout(() => {
                if(manualModal) manualModal.style.display = 'none';
            }, 1000);

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

// Modal schließen bei Klick außerhalb
window.onclick = (event) => {
    if (event.target == manualModal && manualModal) {
        manualModal.style.display = 'none';
    }
}