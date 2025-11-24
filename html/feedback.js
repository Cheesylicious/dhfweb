// cheesylicious/dhfweb/dhfweb-ec604d738e9bd121b65cc8557f8bb98d2aa18062/html/feedback.js
// --- Globales Setup ---
const API_URL = 'http://46.224.63.203:5000';
let user;
let isAdmin = false;

// --- Auth-Check und Logout-Setup ---
async function logout() {
    try { await apiFetch('/api/logout', 'POST'); }
    catch (e) { console.error(e); }
    finally {
        localStorage.removeItem('dhf_user');
        window.location.href = 'index.html?logout=true';
    }
}

try {
    user = JSON.parse(localStorage.getItem('dhf_user'));
    if (!user || !user.vorname || !user.role) { throw new Error("Kein User oder fehlende Rolle"); }
    document.getElementById('welcome-user').textContent = `Willkommen, ${user.vorname}!`;

    isAdmin = user.role.name === 'admin';
    const isVisitor = user.role.name === 'Besucher';
    const isPlanschreiber = user.role.name === 'Planschreiber';
    const isHundefuehrer = user.role.name === 'Hundeführer';

    // *** Zugriffsschutz (Nur Admin) ***
    if (!isAdmin) {
        const wrapper = document.getElementById('content-wrapper');
        wrapper.classList.add('restricted-view');
        wrapper.innerHTML = `
            <h2 style="color: #e74c3c;">Zugriff verweigert</h2>
            <p>Nur Administratoren dürfen auf die Meldungsverwaltung zugreifen.</p>
        `;
        // Verstecke Sub-Nav, falls vorhanden
        const subNav = document.getElementById('sub-nav-tasks');
        if(subNav) subNav.style.display = 'none';

        throw new Error("Keine Admin-Rechte für Feedback-Verwaltung.");
    }

    // Navigation anpassen
    const navDashboard = document.getElementById('nav-dashboard');
    const navUsers = document.getElementById('nav-users');
    const navFeedback = document.getElementById('nav-feedback');

    // --- NEU: Statistik Link Logik ---
    const navStatistik = document.getElementById('nav-statistik');

    if (navDashboard) navDashboard.style.display = isVisitor ? 'none' : 'inline-flex';

    // Statistik-Link anzeigen, wenn Admin oder explizite Berechtigung
    if (navStatistik) {
        if (isAdmin || (user.can_see_statistics === true)) {
            navStatistik.style.display = 'inline-flex';
        } else {
            navStatistik.style.display = 'none';
        }
    }
    // --- ENDE NEU ---

    if (isAdmin) {
        if (navUsers) navUsers.style.display = 'inline-flex';
        if (navFeedback) navFeedback.style.display = 'inline-flex';
    } else if (isPlanschreiber) {
         if (navUsers) navUsers.style.display = 'none';
         if (navFeedback) navFeedback.style.display = 'inline-flex';
    }

    document.getElementById('logout-btn').onclick = logout;

} catch (e) {
    if (!e.message.includes("Keine Admin-Rechte")) {
         // Nur ausloggen, wenn es ein echter Fehler ist, nicht beim Zugriffsschutz
         if (!user) logout();
    }
}

// --- Globale API-Funktion ---
async function apiFetch(endpoint, method = 'GET', body = null) {
    const options = {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
    };
    if (body) { options.body = JSON.stringify(body); }
    const response = await fetch(API_URL + endpoint, options);
    if (response.status === 401 || response.status === 403) {
        if (response.status === 401) { logout(); }
        throw new Error('Sitzung ungültig oder fehlende Rechte.');
    }
    const contentType = response.headers.get("content-type");
    let data;
    if (contentType && contentType.indexOf("application/json") !== -1) {
        data = await response.json();
    } else {
        data = { message: await response.text() };
    }
    if (!response.ok) {
        throw new Error(data.message || 'API-Fehler');
    }
    return data;
}


// --- Seitenlogik für Feedback-Verwaltung ---

const feedbackList = document.getElementById('feedback-list');
const filterButtonsContainer = document.querySelector('.filter-buttons');
let currentFilter = ""; // (Startet mit "Alle")

async function loadReports() {
    if (!feedbackList) return;
    feedbackList.innerHTML = '<li>Lade Meldungen...</li>';

    try {
        const reports = await apiFetch(`/api/feedback?status=${currentFilter}`);
        renderReports(reports);
    } catch (error) {
        console.error("Fehler beim Laden der Reports:", error);
        feedbackList.innerHTML = `<li style="color: var(--status-neu); padding: 20px;">Fehler beim Laden: ${error.message}</li>`;
    }
}

function renderReports(reports) {
    if (!feedbackList) return;
    feedbackList.innerHTML = '';

    if (!reports || reports.length === 0) {
        feedbackList.innerHTML = '<li style="color: #bdc3c7; padding: 20px; text-align: center;">Keine Meldungen für diesen Filter gefunden.</li>';
        return;
    }

    // Sortieren: Neueste zuerst
    reports.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    reports.forEach(report => {
        const li = document.createElement('li');
        li.className = 'feedback-item';
        li.dataset.id = report.id;

        const reportDate = new Date(report.created_at).toLocaleString('de-DE', {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });

        let actionButtons = '';
        // Buttons nur anzeigen, wenn Status passend
        if (report.status !== 'gesehen') {
            actionButtons += `<button class="btn-seen" data-action="gesehen">Als 'gesehen' markieren</button>`;
        }
        if (report.status !== 'archiviert') {
            actionButtons += `<button class="btn-archive" data-action="archiviert">Archivieren</button>`;
        }
        if (report.status !== 'neu') {
             actionButtons += `<button class="btn-new" data-action="neu">Zurück auf 'Neu'</button>`;
        }

        li.innerHTML = `
            <div class="item-header" data-action="toggle-body">
                <span>Von: <strong>${report.user_name}</strong></span>
                <span>Kategorie: <strong>${report.category} (${report.report_type})</strong></span>
                <span>Gemeldet am: <strong>${reportDate} Uhr</strong></span>
                <span class="item-status" data-status="${report.status}">${report.status}</span>
            </div>
            <div class="item-body">
                <p>${escapeHTML(report.message)}</p>
                <div class="item-actions">
                    ${actionButtons}
                    <button class="btn-delete" data-action="delete">Löschen</button>
                </div>
            </div>
        `;
        feedbackList.appendChild(li);
    });
}

async function handleUpdateStatus(id, newStatus) {
    const item = feedbackList.querySelector(`.feedback-item[data-id="${id}"]`);
    if (!item) return;

    try {
        await apiFetch(`/api/feedback/${id}`, 'PUT', { status: newStatus });

        // Wenn der neue Status nicht dem Filter entspricht, ausblenden
        if (currentFilter && currentFilter !== newStatus) {
            item.classList.add('fade-out');
            setTimeout(() => item.remove(), 500);

            // Prüfen ob Liste leer ist nach Entfernen
            setTimeout(() => {
                if(feedbackList.children.length === 0) {
                     feedbackList.innerHTML = '<li style="color: #bdc3c7; padding: 20px; text-align: center;">Keine Meldungen für diesen Filter gefunden.</li>';
                }
            }, 550);

        } else {
            const statusBadge = item.querySelector('.item-status');
            if(statusBadge) {
                statusBadge.dataset.status = newStatus;
                statusBadge.textContent = newStatus;
            }
            // Liste neu laden um Buttons zu aktualisieren
            loadReports();
        }

        // Trigger Update für Banner
        if(window.triggerNotificationUpdate) window.triggerNotificationUpdate();

    } catch (error) {
        alert(`Fehler beim Aktualisieren: ${error.message}`);
    }
}

async function handleDelete(id) {
    const item = feedbackList.querySelector(`.feedback-item[data-id="${id}"]`);
    if (!item) return;

    if (!confirm("Sind Sie sicher, dass Sie diese Meldung endgültig löschen möchten?")) {
        return;
    }

    try {
        await apiFetch(`/api/feedback/${id}`, 'DELETE');
        item.classList.add('fade-out');
        setTimeout(() => item.remove(), 500);

        // Trigger Update für Banner
        if(window.triggerNotificationUpdate) window.triggerNotificationUpdate();

    } catch (error) {
        alert(`Fehler beim Löschen: ${error.message}`);
    }
}

if (filterButtonsContainer) {
    filterButtonsContainer.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') {
            const currentActive = filterButtonsContainer.querySelector('button.active');
            if(currentActive) currentActive.classList.remove('active');
            e.target.classList.add('active');

            currentFilter = e.target.dataset.filter;
            loadReports();
        }
    });
}

if (feedbackList) {
    feedbackList.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        const header = e.target.closest('.item-header');

        if (button) {
            const action = button.dataset.action;
            const id = e.target.closest('.feedback-item').dataset.id;

            if (action === 'delete') {
                handleDelete(id);
            } else if (action === 'neu' || action === 'gesehen' || action === 'archiviert') {
                handleUpdateStatus(id, action);
            }
        } else if (header) {
            const body = header.nextElementSibling;
            body.style.display = (body.style.display === 'block') ? 'none' : 'block';
        }
    });
}

function escapeHTML(str) {
    if (!str) return "";
    return str.replace(/[&<>"']/g, function(m) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[m];
    });
}

// --- Initialisierung ---
if (isAdmin) {
    loadReports();
}