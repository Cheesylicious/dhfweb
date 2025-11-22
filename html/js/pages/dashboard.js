// js/pages/dashboard.js

// --- IMPORTE (Regel 4: Wiederverwendung) ---
import { API_URL } from '../utils/constants.js';
import { apiFetch } from '../utils/api.js';
import { initAuthCheck, logout } from '../utils/auth.js';

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

// NEWS ELEMENTE
const newsContainer = document.getElementById('news-container');
const newsText = document.getElementById('news-text');
const newsCheckbox = document.getElementById('news-ack-checkbox');
const newsAdminBtn = document.getElementById('news-admin-btn');
const newsEditModal = document.getElementById('news-edit-modal');
const newsEditTextarea = document.getElementById('news-edit-textarea');
const saveNewsBtn = document.getElementById('save-news-btn');
const closeNewsModalBtn = document.getElementById('close-news-modal');
const newsModalStatus = document.getElementById('news-modal-status');

// --- 1. Authentifizierung ---
try {
    const authData = initAuthCheck();
    user = authData.user;
    isAdmin = authData.isAdmin;

    if (authData.isVisitor) {
        window.location.href = 'schichtplan.html';
        throw new Error("Besucher dürfen das Dashboard nicht sehen.");
    }

    // --- Seiten-spezifische UI-Anpassungen ---
    const welcomeMsg = document.getElementById('welcome-message');
    if (welcomeMsg) welcomeMsg.textContent = `Willkommen, ${user.vorname}!`;

    // Admin-spezifische UI-Elemente auf DIESER Seite
    if (isAdmin) {
        if(manualLogBtn) manualLogBtn.classList.remove('hidden');
        if(newsAdminBtn) newsAdminBtn.style.display = 'block';
        // FEHLERBEHEBUNG: Die Zeile, die den <p> Text setzen wollte, wurde entfernt, da das Element nicht mehr existiert.
    }
    else if (authData.isPlanschreiber) {
         if(manualLogBtn) manualLogBtn.classList.add('hidden');
    }
    else {
         if(manualLogBtn) manualLogBtn.classList.add('hidden');
    }

    // Lade die Daten für diese Seite (startet jetzt auch für Admins)
    loadUpdateLog();
    loadAnnouncement();

} catch (e) {
    console.error("Fehler bei der Initialisierung von dashboard.js:", e.message);
    // Kein throw hier, damit Rest der Seite evtl. noch funktioniert oder Fehler geloggt wird
}

// --- Seiten-spezifische Logik ---

/**
 * Lädt die aktuelle Mitteilung.
 */
async function loadAnnouncement() {
    if (!newsText) return; // Schutz

    try {
        const data = await apiFetch('/api/announcement');

        if (!data.message) {
            newsText.textContent = "Keine aktuellen Mitteilungen.";
            newsText.style.color = "#777";
            if(newsCheckbox) {
                newsCheckbox.checked = true;
                newsCheckbox.disabled = true;
            }
            document.body.classList.remove('nav-locked');
            return;
        }

        newsText.textContent = data.message;
        newsText.style.color = "#ecf0f1";

        // Status prüfen
        if (data.is_read) {
            if(newsCheckbox) newsCheckbox.checked = true;
            if(newsContainer) newsContainer.classList.remove('unread');
            document.body.classList.remove('nav-locked');
        } else {
            if(newsCheckbox) newsCheckbox.checked = false;
            if(newsContainer) newsContainer.classList.add('unread');
            document.body.classList.add('nav-locked');
        }

    } catch (error) {
        if(newsText) newsText.textContent = "Fehler beim Laden der Mitteilungen.";
        console.error(error);
    }
}

// Checkbox Listener (Bestätigung)
if (newsCheckbox) {
    newsCheckbox.addEventListener('change', async (e) => {
        if (e.target.checked) {
            try {
                await apiFetch('/api/announcement/ack', 'POST');
                if(newsContainer) newsContainer.classList.remove('unread');
                document.body.classList.remove('nav-locked');
            } catch (error) {
                alert("Fehler beim Bestätigen: " + error.message);
                e.target.checked = false;
            }
        }
    });
}

// Admin: Edit Modal öffnen
if (newsAdminBtn) {
    newsAdminBtn.onclick = () => {
        if (newsEditTextarea) {
            newsEditTextarea.value = (newsText.textContent === "Keine aktuellen Mitteilungen." || newsText.textContent === "Fehler beim Laden der Mitteilungen.") ? "" : newsText.textContent;
        }
        if (newsEditModal) {
            newsEditModal.style.display = 'block';
            if(newsModalStatus) newsModalStatus.textContent = '';
        }
    };
}

if (closeNewsModalBtn) {
    closeNewsModalBtn.onclick = () => {
        if (newsEditModal) newsEditModal.style.display = 'none';
    };
}

// Admin: Speichern
if (saveNewsBtn) {
    saveNewsBtn.onclick = async () => {
        saveNewsBtn.disabled = true;
        if(newsModalStatus) {
            newsModalStatus.textContent = 'Speichere...';
            newsModalStatus.style.color = '#bdc3c7';
        }

        try {
            await apiFetch('/api/announcement', 'PUT', {
                message: newsEditTextarea.value
            });
            if(newsModalStatus) {
                newsModalStatus.textContent = 'Gespeichert!';
                newsModalStatus.style.color = '#2ecc71';
            }

            setTimeout(() => {
                if (newsEditModal) newsEditModal.style.display = 'none';
                loadAnnouncement();
            }, 1000);
        } catch (error) {
            if(newsModalStatus) {
                newsModalStatus.textContent = 'Fehler: ' + error.message;
                newsModalStatus.style.color = '#e74c3c';
            }
        } finally {
            saveNewsBtn.disabled = false;
        }
    };
}


/**
 * Lädt das Update Log und rendert es in die Liste.
 */
async function loadUpdateLog() {
    if (!logList) return;

    try {
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
    if (event.target == newsEditModal && newsEditModal) {
        newsEditModal.style.display = 'none';
    }
}