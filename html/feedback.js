// --- Globales Setup ---
const API_URL = 'http://46.224.63.203:5000';
let user;
let isAdmin = false;

// --- Auth-Check und Logout-Setup (Standard) ---
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

    // *** SEHR WICHTIG: Zugriffsschutz ***
    if (!isAdmin) {
        // Wenn kein Admin, ersetze den Inhalt durch eine Fehlermeldung
        const wrapper = document.getElementById('content-wrapper');
        wrapper.classList.add('restricted-view');
        wrapper.innerHTML = `
            <h2 style="color: #e74c3c;">Zugriff verweigert</h2>
            <p>Nur Administratoren dürfen auf die Meldungsverwaltung zugreifen.</p>
        `;
        // Verhindere das Ausführen weiterer Logik
        throw new Error("Keine Admin-Rechte für Feedback-Verwaltung.");
    }

    // --- KORREKTUR: Robuste Navigationsanpassung für ALLE eingeloggten Benutzer ---
    const navDashboard = document.getElementById('nav-dashboard');
    const navUsers = document.getElementById('nav-users');
    const navFeedback = document.getElementById('nav-feedback');

    // KORRIGIERTE LOGIK: Dashboard ist für alle NICHT-Besucher sichtbar
    if (navDashboard) navDashboard.style.display = isVisitor ? 'none' : 'inline-flex';

    // Admin sieht alle Haupt-Navigationspunkte
    if (isAdmin) {
        // Überprüfen, ob das Element existiert, bevor der Stil gesetzt wird
        if (navUsers) navUsers.style.display = 'inline-flex';
        if (navFeedback) navFeedback.style.display = 'inline-flex'; // Meldungen anzeigen (ist aktiv)
    }
    // --- ENDE KORREKTUR ---

    // (Navigation wird in Schritt 6 global hinzugefügt, hier nur der Logout)
    document.getElementById('logout-btn').onclick = logout;

} catch (e) {
    if (!e.message.includes("Admin-Rechte")) {
         logout();
    }
    // (Stoppt die Ausführung, wenn der Fehler "Keine Admin-Rechte" geworfen wurde)
}

// --- Globale API-Funktion (Standard) ---
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

/**
 * Lädt die Berichte von der API, basierend auf dem aktuellen Filter
 */
async function loadReports() {
    feedbackList.innerHTML = '<li>Lade Meldungen...</li>';

    try {
        const reports = await apiFetch(`/api/feedback?status=${currentFilter}`);
        renderReports(reports);
    } catch (error) {
        feedbackList.innerHTML = `<li style="color: var(--status-neu); padding: 20px;">Fehler beim Laden: ${error.message}</li>`;
    }
}

/**
 * Stellt die geladenen Berichte in der Liste dar
 */
function renderReports(reports) {
    feedbackList.innerHTML = '';

    if (reports.length === 0) {
        feedbackList.innerHTML = '<li style="color: #bdc3c7; padding: 20px; text-align: center;">Keine Meldungen für diesen Filter gefunden.</li>';
        return;
    }

    reports.forEach(report => {
        const li = document.createElement('li');
        li.className = 'feedback-item';
        li.dataset.id = report.id;

        const reportDate = new Date(report.created_at).toLocaleString('de-DE', {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });

        // (Aktions-Buttons je nach Status anpassen)
        let actionButtons = '';
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

/**
 * Aktualisiert den Status eines Berichts
 */
async function handleUpdateStatus(id, newStatus) {
    const item = feedbackList.querySelector(`.feedback-item[data-id="${id}"]`);
    if (!item) return;

    try {
        await apiFetch(`/api/feedback/${id}`, 'PUT', { status: newStatus });
        // (Innovativ: Statt Neuladen, nur das Element aktualisieren oder ausblenden)

        if (currentFilter && currentFilter !== newStatus) {
            // Wenn der neue Status nicht dem Filter entspricht, ausblenden
            item.classList.add('fade-out');
            setTimeout(() => item.remove(), 500);
        } else {
            // Status im DOM aktualisieren
            const statusBadge = item.querySelector('.item-status');
            statusBadge.dataset.status = newStatus;
            statusBadge.textContent = newStatus;
            // (Buttons neu laden, indem wir die Liste neu laden - einfacher)
            loadReports();
        }

    } catch (error) {
        alert(`Fehler beim Aktualisieren: ${error.message}`);
    }
}

/**
 * Löscht einen Bericht
 */
async function handleDelete(id) {
    const item = feedbackList.querySelector(`.feedback-item[data-id="${id}"]`);
    if (!item) return;

    if (!confirm("Sind Sie sicher, dass Sie diese Meldung endgültig löschen möchten?")) {
        return;
    }

    try {
        await apiFetch(`/api/feedback/${id}`, 'DELETE');
        // (Innovativ: Fade-Out-Effekt statt Neuladen)
        item.classList.add('fade-out');
        setTimeout(() => item.remove(), 500);
    } catch (error) {
        alert(`Fehler beim Löschen: ${error.message}`);
    }
}

/**
 * Event Listener für Filter-Buttons
 */
filterButtonsContainer.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') {
        // (Aktiven Status umschalten)
        filterButtonsContainer.querySelector('button.active').classList.remove('active');
        e.target.classList.add('active');

        currentFilter = e.target.dataset.filter;
        loadReports();
    }
});

/**
 * Event Listener für die Ticket-Liste (Aktionen & Aufklappen)
 * (Event Delegation)
 */
feedbackList.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    const header = e.target.closest('.item-header');

    if (button) {
        // (Aktions-Button geklickt)
        const action = button.dataset.action;
        const id = e.target.closest('.feedback-item').dataset.id;

        if (action === 'delete') {
            handleDelete(id);
        } else if (action === 'neu' || action === 'gesehen' || action === 'archiviert') {
            handleUpdateStatus(id, action);
        }
    } else if (header) {
        // (Header geklickt -> Aufklappen)
        const body = header.nextElementSibling;
        body.style.display = (body.style.display === 'block') ? 'none' : 'block';
    }
});

/**
 * (Hilfsfunktion zum Entschärfen von HTML in Nachrichten)
 */
function escapeHTML(str) {
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
    loadReports(); // (Starte mit Filter "Alle")
}