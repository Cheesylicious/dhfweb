// --- Globales Setup ---
const API_URL = 'http://46.224.63.203:5000';
let user;
const SHORTCUT_STORAGE_KEY = 'dhf_shortcuts';
let isAdmin = false;

async function logout() {
    try { await apiFetch('/api/logout', 'POST'); }
    catch (e) { console.error(e); }
    finally {
        localStorage.removeItem('dhf_user');
        window.location.href = 'index.html?logout=true';
    }
}

// (isVisitor wird hier nicht mehr global benötigt)

try {
    user = JSON.parse(localStorage.getItem('dhf_user'));
    if (!user || !user.vorname || !user.role) { throw new Error("Kein User oder fehlende Rolle"); }
    document.getElementById('welcome-user').textContent = `Willkommen, ${user.vorname}!`;

    // --- Rollenprüfung ---
    isAdmin = user.role.name === 'admin';
    const isVisitor = user.role.name === 'Besucher';
    // --- START: NEU ---
    const isPlanschreiber = user.role.name === 'Planschreiber';
    const isHundefuehrer = user.role.name === 'Hundeführer';
    // --- ENDE: NEU ---


    // 1. Haupt-Navigationsanpassung
    const navDashboard = document.getElementById('nav-dashboard');
    const navUsers = document.getElementById('nav-users');

    // --- NEU: Feedback-Link ---
    const navFeedback = document.getElementById('nav-feedback');

    // KORRIGIERTE LOGIK: Dashboard ist für alle NICHT-Besucher sichtbar
    navDashboard.style.display = isVisitor ? 'none' : 'block';

    // --- START: ANPASSUNG (Alle Rollen) ---
    if (isAdmin) {
        navUsers.style.display = 'block';
        navFeedback.style.display = 'inline-flex';
    } else if (isPlanschreiber) {
        navUsers.style.display = 'none';
        navFeedback.style.display = 'inline-flex';
    }
    else {
        navUsers.style.display = 'none';
        navFeedback.style.display = 'none';
    }
    // --- ENDE: ANPASSUNG ---


    // 2. Dropdown-Anpassung
    if (!isAdmin) {
        // Verstecke alle Admin-Links
        document.querySelectorAll('#settings-dropdown-content .admin-only').forEach(el => {
            el.style.display = 'none';
        });

        // (Optional: Verstecke "Einstellungen", wenn alle Links weg sind)
        const visibleLinks = document.querySelectorAll('#settings-dropdown-content a:not([style*="display: none"])');
        if (visibleLinks.length === 0) {
             document.getElementById('settings-dropbtn').style.display = 'none';
        }

    } else {
        // Zeige alle Admin-Links (falls sie aus irgendeinem Grund versteckt waren)
        document.querySelectorAll('#settings-dropdown-content .admin-only').forEach(el => {
            el.style.display = 'block';
        });
    }

} catch (e) {
    // Wenn der User-Check fehlschlägt, leite um.
    logout();
}

document.getElementById('logout-btn').onclick = logout;

// --- Globale API-Funktion (unverändert) ---
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

// --- Seiten-Logik ---
const shortcutList = document.getElementById('shortcut-list');
const saveBtn = document.getElementById('save-shortcuts-btn');
const statusMsg = document.getElementById('status-message');

// (Diese Standard-Map wird verwendet, falls nichts gespeichert ist)
const defaultShortcuts = {
    'T.': 't', 'N.': 'n', '6': '6', 'FREI': 'f', 'X': 'x', 'U': 'u'
};

// NOTFALL-FALLBACK DATEN (Wenn DB-Abruf fehlschlägt)
const hardcodedShiftDefaults = [
    // Datenstruktur aus dhf_app/models.py nachgebaut
    { abbreviation: 'T.', name: 'Tag (T)', color: '#AED6F1' },
    { abbreviation: 'N.', name: 'Nacht (N)', color: '#5D6D7E' },
    { abbreviation: '6', name: 'Kurz (6)', color: '#A9DFBF' },
    { abbreviation: 'FREI', name: 'Frei (Geplant)', color: '#FFFFFF' },
    { abbreviation: 'U', name: 'Urlaub', color: '#FAD7A0' },
    { abbreviation: 'X', name: 'Wunschfrei (X)', color: '#D2B4DE' }
];

// Lädt die Schichtarten UND die gespeicherten Shortcuts
async function loadData() {
    let savedShortcuts = {};
    let shiftTypes = [];
    let errorOccurred = false;
    shortcutList.innerHTML = ''; // Leere Liste sofort

    try {
        // 1. Gespeicherte, benutzerdefinierte Shortcuts laden
        const data = localStorage.getItem(SHORTCUT_STORAGE_KEY);
        if (data) {
            savedShortcuts = JSON.parse(data);
        }
    } catch (e) {
        console.error("Fehler beim Laden der Shortcuts aus localStorage", e);
    }

    try {
        // 2. Schichtarten von der Datenbank laden (Dies ist die Basis für die Liste)
        const apiData = await apiFetch('/api/shifttypes');

        // 3. Wenn API-Daten gültig sind und Einträge haben, verwenden wir diese
        if (Array.isArray(apiData) && apiData.length > 0) {
             shiftTypes = apiData;
        } else if (Array.isArray(apiData) && apiData.length === 0) {
             // API-Call O.K., aber DB leer
             shiftTypes = [];
        } else {
            // API-Antwort unerwartet (z.B. {} oder text)
            throw new Error("API-Antwort war unerwartet oder leer.");
        }

    } catch (error) {
        // 3a. Fehler beim API-Aufruf (Netzwerk/Server/403/usw.)
        console.error(`Fehler beim Laden der Schichtarten von der API: ${error.message}. Verwende hartcodierte Standardwerte.`);
        errorOccurred = true;

        // NOTFALL-FALLBACK: Lade die hartcodierten Defaults
        shiftTypes = hardcodedShiftDefaults;
    }

    // 4. Liste rendern basierend auf den geladenen/Fallback-Daten
    if (shiftTypes.length === 0) {
         // Füge eine Fehler-/Hinweismeldung in die Liste ein
         shortcutList.innerHTML = `<li style="color: #ffffff; padding: 20px; background: rgba(0,0,0,0.2); border-radius: 5px;">
                                       Es wurden **keine Schichtarten** gefunden. Bitte erstellen Sie welche über die "Schichtarten"-Einstellung.
                                   </li>`;
         return;
    }

    shiftTypes.forEach(st => {
        const li = document.createElement('li');
        li.className = 'shortcut-item';

        // Holt zuerst den gespeicherten Key, falls nicht vorhanden, den Standard-Key.
        const savedKey = savedShortcuts[st.abbreviation] || defaultShortcuts[st.abbreviation] || '';

        li.innerHTML = `
            <label class="shortcut-label" for="sc-${st.abbreviation}">
                <div class="color-preview" style="background-color: ${st.color}; border-color: #555;"></div>
                <b>${st.abbreviation}</b>
                <span>(${st.name})</span>
            </label>
            <input type="text"
                   class="shortcut-input"
                   id="sc-${st.abbreviation}"
                   data-abbreviation="${st.abbreviation}"
                   value="${savedKey}"
                   maxlength="1"
                   placeholder="-">
        `;
        shortcutList.appendChild(li);
    });

    // 5. Zeige Statusmeldung, wenn Fallback verwendet wird (Debug-Hilfe)
    if (errorOccurred) {
        statusMsg.textContent = "Hinweis: Es konnte keine Verbindung zur DB aufgebaut werden. Es werden Standard-Shortcuts angezeigt.";
        statusMsg.style.color = '#e74c3c';
    }
}

// Speichert die Shortcuts im localStorage
saveBtn.onclick = () => {
    statusMsg.textContent = 'Speichere...';
    statusMsg.style.color = '#bdc3c7'; /* (Angepasst für dunklen Modus) */

    const inputs = document.querySelectorAll('.shortcut-input');
    const newShortcutMap = {};
    let hasError = false;
    let usedKeys = new Set();

    inputs.forEach(input => {
        const abbreviation = input.dataset.abbreviation;
        const key = input.value.toLowerCase(); // (Immer Kleinbuchstaben)
        input.style.borderColor = '#3498db'; /* (Reset) */

        if (key) { // Nur speichern, wenn ein Wert gesetzt ist
            if (usedKeys.has(key)) {
                statusMsg.textContent = `Fehler: Taste '${key}' ist doppelt vergeben.`;
                statusMsg.style.color = '#e74c3c'; /* (Rot) */
                input.style.borderColor = '#e74c3c';
                hasError = true;
            }
            usedKeys.add(key);
            // Wir speichern { 'T.': 't', 'N.': 'n' }
            newShortcutMap[abbreviation] = key;
        }
    });

    if (hasError) return;

    try {
        localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(newShortcutMap));
        statusMsg.textContent = 'Erfolgreich gespeichert!';
        statusMsg.style.color = '#2ecc71'; /* (Grün) */
        setTimeout(() => statusMsg.textContent = '', 2000);
    } catch (error) {
        statusMsg.textContent = 'Fehler beim Speichern: ' + error.message;
        statusMsg.style.color = '#e74c3c'; /* (Rot) */
    }
};

// --- Initialisierung ---
function initializePage() {
     // KORREKTUR: Prüfe auf isAdmin
     if (isAdmin) {
        loadData();
     } else {
         // Zeige Restricted View an, wenn KEIN Admin (gilt für 'user', 'Besucher', 'Planschreiber', 'Hundeführer' etc.)
         const wrapper = document.getElementById('content-wrapper');
         wrapper.classList.add('restricted-view');
         wrapper.innerHTML = `
             <div class="restricted-view">
                 <h2 style="color: #e74c3c;">Zugriff verweigert</h2>
                 <p>Sie benötigen Admin-Rechte, um auf die Shortcut-Einstellungen zuzugreifen.</p>
                 <p>Bitte nutzen Sie den Link zum <a href="schichtplan.html" style="color: #3498db;">Schichtplan</a>.</p>
             </div>
         `;
         // Verstecke das Dropdown (da die Seite sowieso gesperrt ist)
         document.getElementById('settings-dropbtn').style.display = 'none';
     }
}

// Führe die Initialisierung nur aus, wenn der Benutzer erfolgreich geladen wurde (was im try-Block bereits geprüft wird)
if (user) {
     initializePage();
}