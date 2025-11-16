// --- Globales Setup ---
const API_URL = 'http://46.224.63.203:5000';
let user;
let isAdmin = false;
let isScheduler = false; // "Planschreiber"
let isHundefuehrer = false; // <<< NEU

// --- NEU: Key für localStorage (Regel 4) ---
const DHF_HIGHLIGHT_KEY = 'dhf_highlight_goto';

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
    isHundefuehrer = user.role.name === 'Hundeführer'; // <<< NEU

    // *** SEHR WICHTIG: Zugriffsschutz ***
    // --- START: ANPASSUNG (Hundeführer darf zugreifen) ---
    if (!isAdmin && !isScheduler && !isHundefuehrer) {
        // Wenn keine der berechtigten Rollen, ersetze den Inhalt
        const wrapper = document.getElementById('content-wrapper');
        wrapper.classList.add('restricted-view');
        wrapper.innerHTML = `
            <h2 style="color: #e74c3c;">Zugriff verweigert</h2>
            <p>Nur Administratoren, Planschreiber oder Hundeführer dürfen auf die Anfragen-Verwaltung zugreifen.</p>
        `;
        document.getElementById('sub-nav-tasks').style.display = 'none';
        throw new Error("Keine berechtigte Rolle für Anfragen-Verwaltung.");
    }
    // --- ENDE: ANPASSUNG ---

    // UI-Anpassung für Rollen
    if (isAdmin) {
        // Admin sieht alles
        document.getElementById('nav-users').style.display = 'inline-flex';
        document.getElementById('nav-feedback').style.display = 'inline-flex';
        document.getElementById('sub-nav-feedback').style.display = 'inline-block';
    } else {
        // Planschreiber & Hundeführer sehen keine Benutzerverwaltung
        document.getElementById('nav-users').style.display = 'none';

        // --- START: ANPASSUNG (Feedback-Link für Planschreiber, aber nicht Hundeführer) ---
        if (isScheduler) {
             document.getElementById('nav-feedback').style.display = 'inline-flex';
             document.getElementById('sub-nav-feedback').style.display = 'none';
        } else {
             document.getElementById('nav-feedback').style.display = 'none';
             document.getElementById('sub-nav-feedback').style.display = 'none';
        }
        // --- ENDE: ANPASSUNG ---
    }
    // Dashboard ist für alle berechtigten Rollen sichtbar
    document.getElementById('nav-dashboard').style.display = 'inline-flex';


    document.getElementById('logout-btn').onclick = logout;

} catch (e) {
    if (!e.message.includes("berechtigte Rolle")) {
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

// --- START ANPASSUNG (Regel 2: Event-Dispatching) ---
/**
 * Löst das globale Event aus, um den Notification-Header zu aktualisieren.
 */
function triggerNotificationUpdate() {
    window.dispatchEvent(new CustomEvent('dhf:notification_update'));
}
// --- ENDE ANPASSUNG ---


/**
 * Lädt die Anfragen von der API (nur beim ersten Mal)
 */
async function loadQueries() {
    queryList.innerHTML = '<li>Lade Anfragen...</li>';

    try {
        // Ruft alle Anfragen ab, die dem Statusfilter entsprechen
        // (API filtert automatisch für Hundeführer)
        const queries = await apiFetch(`/api/queries?status=${currentFilter}`);
        allQueriesCache = queries;
        renderQueries();
    } catch (error) {
        queryList.innerHTML = `<li style="color: var(--status-offen); padding: 20px;">Fehler beim Laden: ${error.message}</li>`;
    }
}

// --- START: NEUE FUNKTIONEN für Konversation (Regel 1, 2) ---

/**
 * Rendert die Antworten in den Konversations-Container.
 */
function renderReplies(queryId, originalQuery, replies) {
    const repliesContainer = document.getElementById(`replies-${queryId}`);
    if (!repliesContainer) return;

    repliesContainer.innerHTML = ''; // Vorherige Antworten löschen

    const queryDate = new Date(originalQuery.created_at).toLocaleString('de-DE', {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'});

    // NEU: Ursprüngliche Nachricht als ersten Konversationseintrag rendern
    const originalItem = document.createElement('li');
    originalItem.className = 'reply-item';
    originalItem.style.borderBottom = '1px solid #777'; // Optische Trennung
    originalItem.style.marginBottom = '5px';
    originalItem.innerHTML = `
        <div class="reply-meta" style="color: #3498db;">
            <strong>${originalQuery.sender_name} (Erstanfrage)</strong> am ${queryDate} Uhr
        </div>
        <div class="reply-text" style="font-style: italic;">
            ${escapeHTML(originalQuery.message)}
        </div>
    `;
    repliesContainer.appendChild(originalItem);
    // ENDE NEU

    replies.forEach(reply => {
        const li = document.createElement('li');
        li.className = 'reply-item';
        const isSelf = reply.user_id === user.id;
        const formattedDate = new Date(reply.created_at).toLocaleTimeString('de-DE', {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'});

        li.innerHTML = `
            <div class="reply-meta" style="color: ${isSelf ? '#3498db' : '#888'};">
                <strong>${reply.user_name}</strong> am ${formattedDate} Uhr
            </div>
            <div class="reply-text">
                ${reply.message}
            </div>
        `;
        repliesContainer.appendChild(li);
    });
}

/**
 * Lädt die Konversation für eine Anfrage und rendert sie.
 * Führt dies nur einmal pro Anfrage aus.
 */
async function loadConversation(queryId) {
    const itemBody = document.querySelector(`.query-item[data-id="${queryId}"] .item-body`);
    // --- KORREKTUR: Finde die Query im Cache anhand der ID ---
    const originalQuery = allQueriesCache.find(q => q.id == queryId);

    // --- KORREKTUR: Check auf itemBody UND originalQuery ---
    if (!itemBody || !originalQuery || itemBody.dataset.loaded === 'true') {
        if (!originalQuery) console.error(`Konnte Query ${queryId} nicht im Cache finden.`);
        return;
    }

    const loader = itemBody.querySelector(`#replies-loader-${queryId}`);
    if (loader) loader.style.display = 'block';

    try {
        const replies = await apiFetch(`/api/queries/${queryId}/replies`);
        renderReplies(queryId, originalQuery, replies); // OriginalQuery übergeben
        itemBody.dataset.loaded = 'true';

    } catch (e) {
        const repliesContainer = itemBody.querySelector(`#replies-${queryId}`);
        if (repliesContainer) {
            repliesContainer.innerHTML = `<li style="color: red; list-style: none;">Fehler beim Laden der Konversation.</li>`;
        }
    } finally {
        if (loader) loader.style.display = 'none';
    }
}

/**
 * Sendet eine neue Antwort auf eine Anfrage.
 */
async function sendReply(queryId) {
    const messageInput = document.getElementById(`reply-input-${queryId}`);
    const submitBtn = document.getElementById(`reply-submit-${queryId}`);
    const message = messageInput.value.trim();

    if (message.length < 3) {
        alert("Nachricht ist zu kurz.");
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sende...';

    try {
        const payload = { message: message };
        await apiFetch(`/api/queries/${queryId}/replies`, 'POST', payload);

        // Nachricht leeren
        messageInput.value = '';

        // Konversation neu laden, um die neue Antwort anzuzeigen
        const itemBody = document.querySelector(`.query-item[data-id="${queryId}"] .item-body`);
        itemBody.dataset.loaded = 'false'; // Temporär zurücksetzen, um Neuladen zu erzwingen

        // --- START ANPASSUNG (Regel 2: Event-Dispatching) ---
        // Header aktualisieren (z.B. "Warte auf Antwort" Zähler anpassen)
        triggerNotificationUpdate();
        // --- ENDE ANPASSUNG ---

        // --- KORREKTUR: Lade die Daten neu, um den "last_replier" zu aktualisieren ---
        // Dies stellt sicher, dass das Highlight sofort verschwindet (oder erscheint)
        await loadQueries();

        // (Optional) Konversation direkt wieder laden, wenn der Body noch offen ist
        if (itemBody.style.display === 'block') {
            // Finde die Query im (jetzt neuen) Cache
            const originalQuery = allQueriesCache.find(q => q.id == queryId);
            if(originalQuery) {
                 await loadConversation(queryId, originalQuery);
            }
        }


    } catch (e) {
        alert(`Fehler beim Senden der Antwort: ${e.message}`);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Antwort senden';
    }
}

// --- START: NEUE FUNKTION "Zum Termin" (Regel 1) ---
/**
 * Speichert die Zieldaten im localStorage und leitet zum Schichtplan um.
 */
function handleGoToDate(queryId) {
    const query = allQueriesCache.find(q => q.id == queryId);
    if (!query) {
        alert("Fehler: Anfrage nicht im Cache gefunden.");
        return;
    }

    // Daten für den Schichtplan vorbereiten
    const highlightData = {
        date: query.shift_date, // YYYY-MM-DD
        targetUserId: query.target_user_id // ID oder null
    };

    // Im localStorage speichern
    try {
        localStorage.setItem(DHF_HIGHLIGHT_KEY, JSON.stringify(highlightData));
        // Zur Zieldatei navigieren
        window.location.href = 'schichtplan.html';
    } catch (e) {
        console.error("Fehler beim Speichern im localStorage:", e);
        alert("Fehler bei der Weiterleitung.");
    }
}
// --- ENDE: NEUE FUNKTION ---


/**
 * Stellt die Anfragen in der Liste dar (basierend auf Cache und Filter)
 */
function renderQueries() {
    queryList.innerHTML = '';

    // (Keine Filterung mehr nötig, da der API-Call das bereits erledigt)
    // const filteredQueries = currentFilter ... (ENTFERNT)

    if (allQueriesCache.length === 0) {
        queryList.innerHTML = '<li style="color: #bdc3c7; padding: 20px; text-align: center;">Keine Anfragen für diesen Filter gefunden.</li>';
        return;
    }

    // Neueste zuerst (API sollte das schon tun, aber zur Sicherheit)
    allQueriesCache.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    allQueriesCache.forEach(query => {
        const li = document.createElement('li');
        li.className = 'query-item';
        li.dataset.id = query.id;

        // --- START: NEUE HIGHLIGHT-LOGIK ---
        // (Diese Logik spiegelt die Header-Logik wider)
        let actionRequired = false;
        if (query.status === 'offen') {
            if (query.last_replier_id === null) {
                // Fall 1: Keine Antworten
                if (query.sender_user_id !== user.id) {
                    actionRequired = true; // Neu, von anderem
                }
            } else if (query.last_replier_id !== user.id) {
                // Fall 2: Letzte Antwort von anderem
                actionRequired = true;
            }
        }

        if (actionRequired) {
            li.classList.add('action-required-highlight');
        }
        // --- ENDE: NEUE HIGHLIGHT-LOGIK ---


        const queryDate = new Date(query.created_at).toLocaleString('de-DE', {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });

        const shiftDate = new Date(query.shift_date).toLocaleDateString('de-DE', {
             day: '2-digit', month: '2-digit', year: 'numeric'
        });

        // --- START: ANPASSUNG (Rollenbasierte Aktions-Buttons) ---
        let actionButtons = '';

        // "Zum Termin" Button ist für alle Rollen auf dieser Seite sichtbar
        actionButtons += `<button class="btn-goto-date" data-action="goto-date" style="background: #9b59b6; color: white;">Zum Termin</button>`;

        if (isAdmin || isScheduler) {
            // Admins/Planschreiber sehen Status-Buttons
            if (query.status === 'offen') {
                actionButtons += `<button class="btn-done" data-action="erledigt">Als 'erledigt' markieren</button>`;
            } else {
                actionButtons += `<button class="btn-reopen" data-action="offen">Wieder öffnen</button>`;
            }
            // Admins/Planschreiber sehen immer den Löschen-Button
            actionButtons += `<button class="btn-delete-query" data-action="delete">Löschen</button>`;
        } else if (isHundefuehrer) {
            // Hundeführer sieht Löschen-Button NUR, wenn er der Sender ist
            if (query.sender_user_id === user.id) {
                 actionButtons += `<button class="btn-delete-query" data-action="delete">Anfrage zurückziehen</button>`;
            }
        }
        // --- ENDE: ANPASSUNG ---


        // --- START ANPASSUNG (Button-Layout und Abstand) ---
        const conversationSection = `
            <div class="conversation-container">
                <div id="replies-loader-${query.id}" style="text-align: center; color: #888; margin: 10px; display: none;">Lade Konversation...</div>
                <ul id="replies-${query.id}" class="query-replies-list">
                    </ul>
            </div>

            <div class="reply-form" style="margin-top: 20px; padding-top: 10px; border-top: 1px dashed #ddd; margin-bottom: 20px;">
                <label for="reply-input-${query.id}" style="font-size: 13px; color: #3498db; font-weight: 600;">Antwort senden:</label>
                <textarea id="reply-input-${query.id}" rows="2" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 5px; font-size: 14px; box-sizing: border-box; resize: vertical;"></textarea>
                <button type="button" class="btn-primary btn-reply-submit" data-id="${query.id}" id="reply-submit-${query.id}" style="margin-top: 10px; padding: 10px 15px; font-size: 14px; font-weight: 600;">Antwort senden</button>
            </div>
        `;
        // --- ENDE ANPASSUNG ---

        li.innerHTML = `
            <div class="item-header" data-action="toggle-body">
                <span>Von: <strong>${query.sender_name}</strong></span>
                <span>Für: <strong>${query.target_name}</strong></span>
                <span>Anfrage für Datum: <strong>${shiftDate}</strong></span>
                <span>Gesendet am: <strong>${queryDate} Uhr</strong></span>
                <span class="item-status" data-status="${query.status}">${query.status}</span>
            </div>
            <div class="item-body" data-loaded="false" data-query-id="${query.id}">
                ${conversationSection}
                <div class="item-actions" style="margin-top: 20px;">
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

        // --- KORREKTUR: API neu laden statt nur rendern, damit Highlights stimmen ---
        await loadQueries();
        // renderQueries(); // (Nicht mehr nötig, da loadQueries() das übernimmt)
        // --- ENDE KORREKTUR ---

        // --- START ANPASSUNG (Regel 2: Event-Dispatching) ---
        triggerNotificationUpdate();
        // --- ENDE ANPASSUNG ---

    } catch (error) {
        alert(`Fehler beim Aktualisieren: ${error.message}`);
    }
}


/**
 * Löscht eine Anfrage
 */
async function handleDelete(id) {
    const item = queryList.querySelector(`.query-item[data-id="${id}"]`);
    if (!item) return;

    if (!confirm("Sind Sie sicher, dass Sie diese Anfrage endgültig löschen/zurückziehen möchten?")) {
        return;
    }

    try {
        // API-Aufruf zum Löschen
        // (Backend prüft Berechtigung für Hundeführer)
        await apiFetch(`/api/queries/${id}`, 'DELETE');

        // Cache aktualisieren (Eintrag entfernen)
        allQueriesCache = allQueriesCache.filter(q => q.id !== parseInt(id));

        // Neu rendern (innovativer als fade-out, da der Cache die Quelle ist)
        renderQueries();

        // --- START ANPASSUNG (Regel 2: Event-Dispatching) ---
        triggerNotificationUpdate();
        // --- ENDE ANPASSUNG ---

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
        const currentActive = filterButtonsContainer.querySelector('button.active');
        if (currentActive) currentActive.classList.remove('active');

        e.target.classList.add('active');

        currentFilter = e.target.dataset.filter;

        // API neu laden (filtert jetzt nur nach Status)
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
        const action = button.dataset.action;
        const id = e.target.closest('.query-item').dataset.id;

        // --- START ANPASSUNG (Button "Zum Termin") ---
        if (action === 'offen' || action === 'erledigt') {
            handleUpdateStatus(id, action);
        } else if (action === 'delete') {
            handleDelete(id);
        } else if (action === 'goto-date') {
            handleGoToDate(id);
        } else if (button.classList.contains('btn-reply-submit')) {
            // NEU: Antwort senden
            e.preventDefault(); // Verhindert ggf. ungewollte Aktionen
            sendReply(id);
        }
        // --- ENDE ANPASSUNG ---

    } else if (header) {
        const itemBody = header.nextElementSibling;

        // (Header geklickt -> Aufklappen)
        const isCollapsed = itemBody.style.display !== 'block';
        itemBody.style.display = isCollapsed ? 'block' : 'none';

        // NEU: Konversation laden, wenn der Body geöffnet wird und noch nicht geladen wurde
        if (isCollapsed && itemBody.dataset.loaded === 'false') {
            const queryId = itemBody.dataset.queryId; // KORREKTUR
            loadConversation(queryId);
        }
    }
});

// --- START ANPASSUNG (Enter-Taste zum Senden) ---
/**
 * Event Listener für Keydown-Events in der Query-Liste (für Textareas).
 * Löst das Senden der Antwort bei "Enter" aus.
 * Erlaubt "Shift + Enter" für einen Zeilenumbruch.
 */
queryList.addEventListener('keydown', (e) => {
    // Prüfen, ob das Ziel eine Textarea für Antworten ist UND die "Enter"-Taste gedrückt wurde
    if (e.target.tagName === 'TEXTAREA' && e.target.id.startsWith('reply-input-') && e.key === 'Enter') {

        // Wenn "Shift" gleichzeitig gedrückt wird, Standardverhalten (Zeilenumbruch) zulassen
        if (e.shiftKey) {
            return;
        }

        // Standardverhalten (Zeilenumbruch bei "Enter") verhindern
        e.preventDefault();

        // Den zugehörigen Sende-Button finden
        // (Wir gehen vom Parent (.item-body) aus, um die ID zu holen)
        const queryId = e.target.closest('.item-body').dataset.queryId;
        const submitBtn = document.getElementById(`reply-submit-${queryId}`);

        if (submitBtn && !submitBtn.disabled) {
            // Den Klick auf den Sende-Button simulieren
            submitBtn.click();
        }
    }
});
// --- ENDE ANPASSUNG ---


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
// --- START: ANPASSUNG (Auch Hundeführer lädt) ---
if (isAdmin || isScheduler || isHundefuehrer) {
    loadQueries(); // (Starte mit Filter "Offen")
}
// --- ENDE: ANPASSUNG ---