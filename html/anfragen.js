// cheesylicious/dhfweb/dhfweb-ec604d738e9bd121b65cc8557f8bb98d2aa18062/html/anfragen.js
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
        // --- START: NEUE FEHLERBEHANDLUNG FÜR API-SPERRE (REGEL 1) ---
        // Versuche, die JSON-Fehlermeldung zu lesen (z.B. "Aktion blockiert")
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Sitzung ungültig oder fehlende Rechte.');
        }
        // --- ENDE: NEUE FEHLERBEHANDLUNG ---
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

// --- START: GEÄNDERTE VARIABLEN ---
const queryListAnfragen = document.getElementById('query-list-anfragen');
const queryListWunsch = document.getElementById('query-list-wunsch');
const filterButtonsAnfragen = document.getElementById('filter-buttons-anfragen');
const filterButtonsWunsch = document.getElementById('filter-buttons-wunsch');

const tabAnfragen = document.getElementById('sub-nav-anfragen');
const tabWunsch = document.getElementById('sub-nav-wunsch');
const tabContentAnfragen = document.getElementById('tab-content-anfragen');
const tabContentWunsch = document.getElementById('tab-content-wunsch');
const contentWrapper = document.getElementById('content-wrapper');

let currentFilterAnfragen = "offen";
let currentFilterWunsch = "offen";
let currentView = 'anfragen'; // 'anfragen' oder 'wunsch'
// --- ENDE: GEÄNDERTE VARIABLEN ---

// Hält die Abfragen im Speicher, um Neuladen zu vermeiden
let allQueriesCache = [];
// --- NEU: Hält die Schichtarten für die Genehmigung ---
let allShiftTypesList = [];


// --- START ANPASSUNG (Regel 2: Event-Dispatching) ---
/**
 * Löst das globale Event aus, um den Notification-Header zu aktualisieren.
 */
function triggerNotificationUpdate() {
    window.dispatchEvent(new CustomEvent('dhf:notification_update'));
}
// --- ENDE ANPASSUNG ---

// --- START: NEUE FUNKTION (REGEL 1) ---
/**
 * Lädt alle Schichtarten, damit wir "T.?" zu einer ID zuordnen können.
 */
async function loadAllShiftTypes() {
    try {
        allShiftTypesList = await apiFetch('/api/shifttypes');
    } catch (e) {
        console.error("Fehler beim Laden der Schichtarten:", e);
        alert("Kritischer Fehler: Schichtarten konnten nicht geladen werden. Genehmigen/Ablehnen ist deaktiviert.");
    }
}
// --- ENDE: NEUE FUNKTION ---


/**
 * Lädt die Anfragen von der API (wird bei Tab-Wechsel und Initialisierung aufgerufen)
 */
async function loadQueries() {
    // --- START: GEÄNDERTE LOGIK ---
    // Bestimme, welche Liste und welchen Filter wir verwenden
    const currentList = (currentView === 'anfragen') ? queryListAnfragen : queryListWunsch;
    const currentFilter = (currentView === 'anfragen') ? currentFilterAnfragen : currentFilterWunsch;
    // --- ENDE: GEÄNDERTE LOGIK ---

    currentList.innerHTML = '<li>Lade Anfragen...</li>';

    try {
        // Ruft alle Anfragen ab, die dem Statusfilter entsprechen
        // (API filtert automatisch für Hundeführer)
        // WICHTIG: Wir laden IMMER ALLE (filter=''), damit der Cache vollständig ist
        const queries = await apiFetch(`/api/queries?status=`);
        allQueriesCache = queries;
        renderQueries(); // Ruft die angepasste renderQueries auf
    } catch (error) {
        currentList.innerHTML = `<li style="color: var(--status-offen); padding: 20px;">Fehler beim Laden: ${error.message}</li>`;
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

// --- START: NEUE HILFSFUNKTION (Regel 1) ---
/**
 * Definiert, ob eine Anfrage eine "Wunsch-Anfrage" ist.
 */
const isWunschAnfrage = (q) => {
    return q.sender_role_name === 'Hundeführer' && q.message.startsWith("Anfrage für:");
};
// --- ENDE: NEUE HILFSFUNKTION ---


// --- START: NEUE HILFSFUNKTION (Regel 4) ---
/**
 * Erstellt ein einzelnes Listen-Element (<li>) für eine Anfrage.
 */
function createQueryElement(query) {
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
    const isWunsch = isWunschAnfrage(query);

    // "Zum Termin" Button ist für alle Rollen auf dieser Seite sichtbar
    actionButtons += `<button class="btn-goto-date" data-action="goto-date" title="Zum Tag im Schichtplan springen">Zum Termin</button>`;

    // --- NEU: Logik für Genehmigen/Ablehnen ---
    if (isWunsch && query.status === 'offen' && (isAdmin)) {
        // Admin-exklusive Genehmigungs-Buttons
        actionButtons += `<button class="btn-approve" data-action="approve" title="Trägt die Schicht '${query.message.replace('Anfrage für:', '').trim()}' im Plan ein und schließt die Anfrage.">Genehmigen</button>`;
        actionButtons += `<button class="btn-reject" data-action="reject" title="Lehnt die Anfrage ab, setzt die Schicht auf 'FREI' und löscht die Anfrage.">Ablehnen</button>`;

        // Admins dürfen Wünsche auch normal löschen (rechtsbündig)
        actionButtons += `<button class="btn-delete-query" data-action="delete" title="Löscht die Anfrage, ändert aber NICHTS am Schichtplan.">Löschen</button>`;

    } else if (isAdmin || isScheduler) {
        // Normale Admin/Planschreiber-Buttons (für NICHT-Wunsch-Anfragen)
        if (query.status === 'offen') {
            actionButtons += `<button class="btn-done" data-action="erledigt">Als 'erledigt' markieren</button>`;
        } else {
            actionButtons += `<button class="btn-reopen" data-action="offen">Wieder öffnen</button>`;
        }
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
    return li;
}
// --- ENDE: NEUE HILFSFUNKTION ---


/**
 * Stellt die Anfragen in der Liste dar (basierend auf Cache und Filter)
 */
function renderQueries() {
    // --- START: GEÄNDERTE LOGIK (Rendert beide Listen) ---
    queryListAnfragen.innerHTML = '';
    queryListWunsch.innerHTML = '';

    // --- KORREKTUR: Filter-Logik ---

    // 1. Definition, was eine Wunsch-Anfrage ist (Hilfsfunktion)
    // (isWunschAnfrage(q) ist global definiert)

    // 2. Daten für "Wunsch-Anfragen" (gefiltert nach Status 'currentFilterWunsch' UND Kriterien)
    const queriesWunsch = allQueriesCache.filter(q => {
        // Status-Filter
        if (currentFilterWunsch !== '' && q.status !== currentFilterWunsch) return false;
        // Kriterien-Filter
        return isWunschAnfrage(q);
    });

    // 3. Daten für "Alle Anfragen" (gefiltert nach Status 'currentFilterAnfragen' UND NICHT Wunsch)
    const queriesAnfragen = allQueriesCache.filter(q => {
        // Status-Filter
        if (currentFilterAnfragen !== '' && q.status !== currentFilterAnfragen) return false;
        // KORREKTUR: Schließe Wunsch-Anfragen aus
        return !isWunschAnfrage(q);
    });

    // --- ENDE KORREKTUR ---


    // 3. "Alle Anfragen" rendern (für alle sichtbar)
    if (queriesAnfragen.length === 0) {
        queryListAnfragen.innerHTML = '<li style="color: #bdc3c7; padding: 20px; text-align: center;">Keine Anfragen für diesen Filter gefunden.</li>';
    } else {
        queriesAnfragen.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        queriesAnfragen.forEach(query => {
            queryListAnfragen.appendChild(createQueryElement(query));
        });
    }

    // 4. "Wunsch-Anfragen" rendern (nur wenn Admin)
    if (isAdmin) {
        if (queriesWunsch.length === 0) {
            queryListWunsch.innerHTML = '<li style="color: #bdc3c7; padding: 20px; text-align: center;">Keine Wunsch-Anfragen für diesen Filter gefunden.</li>';
        } else {
            queriesWunsch.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            queriesWunsch.forEach(query => {
                queryListWunsch.appendChild(createQueryElement(query));
            });
        }
    }
    // --- ENDE: GEÄNDERTE LOGIK ---
}


/**
 * Aktualisiert den Status einer Anfrage
 */
async function handleUpdateStatus(id, newStatus) {
    // --- START: GEÄNDERT (findet Item in beiden Listen) ---
    const item = document.querySelector(`.query-item[data-id="${id}"]`);
    // --- ENDE: GEÄNDERT ---
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
        // Wir laden die Daten basierend auf dem aktuellen Tab neu
        // (loadQueries lädt ALLES neu und renderQueries filtert neu)
        await loadQueries();
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
    // --- START: GEÄNDERT (findet Item in beiden Listen) ---
    const item = document.querySelector(`.query-item[data-id="${id}"]`);
    // --- ENDE: GEÄNDERT ---
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

// --- START: NEUE FUNKTION (REGEL 1) ---
/**
 * Genehmigt eine Wunsch-Anfrage (Admin only)
 */
async function handleApprove(queryId) {
    const query = allQueriesCache.find(q => q.id == queryId);
    if (!query) { alert("Fehler: Anfrage nicht gefunden."); return; }

    // 1. Parse abbreviation (z.B. "T.") from message (z.B. "Anfrage für: T.?")
    const prefix = "Anfrage für:";
    let abbrev = query.message.substring(prefix.length).trim();
    abbrev = abbrev.endsWith('?') ? abbrev.slice(0, -1) : abbrev; // Entfernt '?' -> "T."

    // 2. Finde shifttype_id
    const shiftType = allShiftTypesList.find(st => st.abbreviation === abbrev);
    if (!shiftType) {
        alert(`Fehler: Schichtart "${abbrev}" nicht im System gefunden. Kann nicht genehmigen.`);
        return;
    }

    // 3. Zeige Lade-Feedback (z.B. am Button)
    const item = document.querySelector(`.query-item[data-id="${queryId}"]`);
    const approveBtn = item ? item.querySelector('[data-action="approve"]') : null;
    if (approveBtn) {
        approveBtn.disabled = true;
        approveBtn.textContent = 'Speichere...';
    }

    try {
        // 4. Rufe 'saveShift' API auf (/api/shifts)
        await apiFetch('/api/shifts', 'POST', {
            user_id: query.target_user_id,
            date: query.shift_date,
            shifttype_id: shiftType.id
        });

        // 5. Schließe die Anfrage (markiere als 'erledigt')
        // (handleUpdateStatus ruft intern loadQueries() und triggerNotificationUpdate())
        await handleUpdateStatus(queryId, 'erledigt');

    } catch (error) {
        // Wenn ein Fehler auftritt (z.B. Plan gesperrt), wird der Button wiederhergestellt
        alert(`Fehler beim Genehmigen: ${error.message}`);
        if (approveBtn) {
            approveBtn.disabled = false;
            approveBtn.textContent = 'Genehmigen';
        }
    }
}

/**
 * Lehnt eine Wunsch-Anfrage ab (Admin only)
 * Setzt die Schicht auf FREI und löscht die Anfrage.
 */
async function handleReject(queryId) {
    const query = allQueriesCache.find(q => q.id == queryId);
    if (!query) { alert("Fehler: Anfrage nicht gefunden."); return; }

    if (!confirm("Sind Sie sicher, dass Sie diese Anfrage ABLEHNEN möchten? \n(Die Schicht im Plan wird auf 'FREI' gesetzt und die Anfrage gelöscht.)")) {
        return;
    }

    // 1. Zeige Lade-Feedback
    const item = document.querySelector(`.query-item[data-id="${queryId}"]`);
    const rejectBtn = item ? item.querySelector('[data-action="reject"]') : null;
    if (rejectBtn) {
        rejectBtn.disabled = true;
        rejectBtn.textContent = 'Lehne ab...';
    }

    try {
        // 2. Lösche die Schicht im Plan (setze auf 'FREI'/null)
        // (Die 'saveShift'-Route /api/shifts prüft auf Plan-Sperre)
        await apiFetch('/api/shifts', 'POST', {
            user_id: query.target_user_id,
            date: query.shift_date,
            shifttype_id: null // Setzt auf "FREI"
        });

        // 3. Lösche die Anfrage selbst (API-Aufruf /api/queries/id)
        await apiFetch(`/api/queries/${queryId}`, 'DELETE');

        // Cache aktualisieren
        allQueriesCache = allQueriesCache.filter(q => q.id !== parseInt(queryId));

        // Neu rendern
        renderQueries();
        triggerNotificationUpdate();

    } catch (error) {
        // Fehler (z.B. Plan gesperrt)
        alert(`Fehler beim Ablehnen: ${error.message}`);
        if (rejectBtn) {
            rejectBtn.disabled = false;
            rejectBtn.textContent = 'Ablehnen';
        }
    }
}
// --- ENDE: NEUE FUNKTIONEN ---


/**
 * Event Listener für Filter-Buttons
 */
// --- START: GEÄNDERT (Zwei Listener) ---
filterButtonsAnfragen.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') {
        const currentActive = filterButtonsAnfragen.querySelector('button.active');
        if (currentActive) currentActive.classList.remove('active');
        e.target.classList.add('active');

        currentFilterAnfragen = e.target.dataset.filter;
        renderQueries(); // Nur neu rendern, da Cache schon da ist
    }
});

if (isAdmin) { // Nur wenn Admin, Listener für zweiten Filter hinzufügen
    filterButtonsWunsch.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') {
            const currentActive = filterButtonsWunsch.querySelector('button.active');
            if (currentActive) currentActive.classList.remove('active');
            e.target.classList.add('active');

            currentFilterWunsch = e.target.dataset.filter;
            renderQueries(); // Nur neu rendern, da Cache schon da ist
        }
    });
}
// --- ENDE: GEÄNDERT ---


/**
 * Event Listener für die Ticket-Liste (Aktionen & Aufklappen)
 * (Event Delegation an den Wrapper)
 */
// --- START: GEÄNDERT (Listener an contentWrapper) ---
contentWrapper.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    const header = e.target.closest('.item-header');

    // Finde das übergeordnete query-item, egal in welcher Liste
    const queryItem = e.target.closest('.query-item');
    if (!queryItem) {
         // Klick war außerhalb eines Items (z.B. Header der Card)
         // Speziell für den Fall, dass auf den Sende-Button im Reply-Form geklickt wird
         if (button && button.classList.contains('btn-reply-submit')) {
             const id = button.dataset.id;
             e.preventDefault();
             sendReply(id);
         }
         return;
    }

    const id = queryItem.dataset.id;

    if (button) {
        const action = button.dataset.action;

        // --- START ANPASSUNG (Button "Zum Termin") ---
        if (action === 'offen' || action === 'erledigt') {
            handleUpdateStatus(id, action);
        } else if (action === 'delete') {
            handleDelete(id);
        } else if (action === 'goto-date') {
            handleGoToDate(id);
        // --- START: NEUE ACTIONS (REGEL 1) ---
        } else if (action === 'approve') {
            handleApprove(id);
        } else if (action === 'reject') {
            handleReject(id);
        // --- ENDE: NEUE ACTIONS ---
        } else if (button.classList.contains('btn-reply-submit')) {
            // NEU: Antwort senden (wird jetzt hier korrekt abgefangen)
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
// --- ENDE: GEÄNDERT ---

// --- START ANPASSUNG (Enter-Taste zum Senden - Listener an contentWrapper) ---
/**
 * Event Listener für Keydown-Events in der Query-Liste (für Textareas).
 * Löst das Senden der Antwort bei "Enter" aus.
 * Erlaubt "Shift + Enter" für einen Zeilenumbruch.
 */
contentWrapper.addEventListener('keydown', (e) => {
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


// --- START: NEUE INITIALISIERUNGSFUNKTION ---
async function initializePage() {
    // Auth-Check (schon im globalen Scope passiert, wir nutzen 'isAdmin')
    if (isAdmin) {
        tabWunsch.style.display = 'inline-block';
        // --- KORREKTUR: Inhalt des Wunsch-Tabs standardmäßig verstecken, bis er geklickt wird ---
        tabContentWunsch.style.display = 'none';
        // --- ENDE KORREKTUR ---
    }

    // Tab-Listener
    tabAnfragen.addEventListener('click', (e) => {
        e.preventDefault();
        if (currentView === 'anfragen') {
            loadQueries(); // Trotzdem neuladen, falls sich Filter geändert haben
            return;
        }
        currentView = 'anfragen';

        tabAnfragen.classList.add('active');
        tabWunsch.classList.remove('active');

        tabContentAnfragen.style.display = 'block';
        tabContentWunsch.style.display = 'none';

        // Lade Daten für die neue Ansicht
        loadQueries();
    });

    // Nur Admin darf den Wunsch-Tab sehen UND klicken
    if (isAdmin) {
        tabWunsch.addEventListener('click', (e) => {
            e.preventDefault();
            if (currentView === 'wunsch') {
                loadQueries(); // Neuladen bei Klick auf aktiven Tab
                return;
            }
            currentView = 'wunsch';

            tabWunsch.classList.add('active');
            tabAnfragen.classList.remove('active');

            tabContentAnfragen.style.display = 'none';
            tabContentWunsch.style.display = 'block';

            loadQueries();
        });
    }

    // --- NEU: Schichtarten für Genehmigung laden (Regel 1) ---
    await loadAllShiftTypes();

    // Erster Ladevorgang
    loadQueries();
}

// Initialisierung
if (isAdmin || isScheduler || isHundefuehrer) {
    initializePage();
}
// --- ENDE: NEUE INITIALISIERUNGSFUNKTION ---