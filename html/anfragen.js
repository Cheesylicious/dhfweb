// --- Globales Setup ---
const API_URL = 'http://46.224.63.203:5000';
let user;
let isAdmin = false;
let isScheduler = false; // "Planschreiber"

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
    isScheduler = user.role.name === 'Planschreiber';

    // *** SEHR WICHTIG: Zugriffsschutz ***
    if (!isAdmin && !isScheduler) {
        // Wenn weder Admin noch Planschreiber, ersetze den Inhalt
        const wrapper = document.getElementById('content-wrapper');
        wrapper.classList.add('restricted-view');
        wrapper.innerHTML = `
            <h2 style="color: #e74c3c;">Zugriff verweigert</h2>
            <p>Nur Administratoren oder Planschreiber dürfen auf die Anfragen-Verwaltung zugreifen.</p>
        `;
        document.getElementById('sub-nav-tasks').style.display = 'none';
        throw new Error("Keine Admin/Planschreiber-Rechte für Anfragen-Verwaltung.");
    }

    // UI-Anpassung für Rollen
    if (isAdmin) {
        // Admin sieht alles
        document.getElementById('nav-users').style.display = 'inline-flex';
        document.getElementById('nav-feedback').style.display = 'inline-flex';
        document.getElementById('sub-nav-feedback').style.display = 'inline-block';
    } else {
        // Planschreiber sieht nur Anfragen, nicht Feedback
        document.getElementById('nav-users').style.display = 'none';
        document.getElementById('nav-feedback').style.display = 'none';
        document.getElementById('sub-nav-feedback').style.display = 'none';
    }
    // Dashboard ist für beide sichtbar
    document.getElementById('nav-dashboard').style.display = 'inline-flex';


    document.getElementById('logout-btn').onclick = logout;

} catch (e) {
    if (!e.message.includes("Admin/Planschreiber-Rechte")) {
         logout();
    }
    // (Stoppt die Ausführung, wenn der Fehler geworfen wurde)
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


// --- Seitenlogik für Anfragen-Verwaltung ---

const queryList = document.getElementById('query-list');
const filterButtonsContainer = document.querySelector('.filter-buttons');
let currentFilter = "offen"; // (Startet mit "Offen")

// Hält die Abfragen im Speicher, um Neuladen zu vermeiden
let allQueriesCache = [];

/**
 * Lädt die Anfragen von der API (nur beim ersten Mal)
 */
async function loadQueries() {
    queryList.innerHTML = '<li>Lade Anfragen...</li>';

    // Wir holen immer alle Anfragen für den aktuellen Monat
    // (Die API in routes_queries.py erwartet year/month)
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    try {
        const queries = await apiFetch(`/api/queries?year=${year}&month=${month}&status=${currentFilter}`);
        allQueriesCache = queries;
        renderQueries();
    } catch (error) {
        queryList.innerHTML = `<li style="color: var(--status-offen); padding: 20px;">Fehler beim Laden: ${error.message}</li>`;
    }
}

/**
 * Stellt die Anfragen in der Liste dar (basierend auf Cache und Filter)
 */
function renderQueries() {
    queryList.innerHTML = '';

    const filteredQueries = currentFilter
        ? allQueriesCache.filter(q => q.status === currentFilter)
        : allQueriesCache;

    if (filteredQueries.length === 0) {
        queryList.innerHTML = '<li style="color: #bdc3c7; padding: 20px; text-align: center;">Keine Anfragen für diesen Filter gefunden.</li>';
        return;
    }

    // Neueste zuerst
    filteredQueries.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    filteredQueries.forEach(query => {
        const li = document.createElement('li');
        li.className = 'query-item';
        li.dataset.id = query.id;

        const queryDate = new Date(query.created_at).toLocaleString('de-DE', {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });

        const shiftDate = new Date(query.shift_date).toLocaleDateString('de-DE', {
             day: '2-digit', month: '2-digit', year: 'numeric'
        });

        // Aktions-Buttons je nach Status (und Rolle)
        let actionButtons = '';
        // Nur Admins dürfen den Status ändern
        if (isAdmin) {
            if (query.status === 'offen') {
                actionButtons = `<button class="btn-done" data-action="erledigt">Als 'erledigt' markieren</button>`;
            } else {
                actionButtons = `<button class="btn-reopen" data-action="offen">Wieder öffnen</button>`;
            }
        }

        li.innerHTML = `
            <div class="item-header" data-action="toggle-body">
                <span>Von: <strong>${query.sender_name}</strong></span>
                <span>Für: <strong>${query.target_name}</strong></span>
                <span>Anfrage für Datum: <strong>${shiftDate}</strong></span>
                <span>Gesendet am: <strong>${queryDate} Uhr</strong></span>
                <span class="item-status" data-status="${query.status}">${query.status}</span>
            </div>
            <div class="item-body">
                <p>${escapeHTML(query.message)}</p>
                <div class="item-actions">
                    ${actionButtons}
                </div>
            </div>
        `;
        queryList.appendChild(li);
    });
}

/**
 * Aktualisiert den Status einer Anfrage
 */
async function handleUpdateStatus(id, newStatus) {
    const item = queryList.querySelector(`.query-item[data-id="${id}"]`);
    if (!item) return;

    try {
        // API-Aufruf zum Aktualisieren des Status
        const updatedQuery = await apiFetch(`/api/queries/${id}/status`, 'PUT', { status: newStatus });

        // Cache aktualisieren
        const index = allQueriesCache.findIndex(q => q.id === updatedQuery.id);
        if (index > -1) {
            allQueriesCache[index] = updatedQuery;
        } else {
            allQueriesCache.push(updatedQuery);
        }

        // Neu rendern, um die UI synchron zu halten
        renderQueries();

    } catch (error) {
        alert(`Fehler beim Aktualisieren: ${error.message}`);
    }
}


/**
 * Event Listener für Filter-Buttons
 */
filterButtonsContainer.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') {
        // (Aktiven Status umschalten)
        const currentActive = filterButtonsContainer.querySelector('button.active');
        if (currentActive) currentActive.classList.remove('active');

        e.target.classList.add('active');

        currentFilter = e.target.dataset.filter;

        // Wir müssen die Daten neu von der API laden,
        // falls der Benutzer 'Alle' oder 'Erledigt' sehen will
        // (da wir standardmäßig nur 'offen' laden könnten)

        // Einfache Lösung: Immer neu laden, wenn Filter wechselt
        loadQueries();
    }
});

/**
 * Event Listener für die Ticket-Liste (Aktionen & Aufklappen)
 */
queryList.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    const header = e.target.closest('.item-header');

    if (button) {
        // (Aktions-Button geklickt)
        const action = button.dataset.action;
        const id = e.target.closest('.query-item').dataset.id;

        if (action === 'offen' || action === 'erledigt') {
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
if (isAdmin || isScheduler) {
    loadQueries(); // (Starte mit Filter "Offen")
}