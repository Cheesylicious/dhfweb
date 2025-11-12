// --- Globales Setup (Auth, API) ---
const API_URL = 'http://46.224.63.203:5000';
const STORAGE_KEY = 'dhf_color_settings'; // Temporärer Key (wird entfernt)
let user;
let isAdmin = false; // <<< NEU

async function logout() {
    try { await apiFetch('/api/logout', 'POST'); } catch (e) { console.error(e); }
    finally { localStorage.removeItem('dhf_user'); window.location.href = 'index.html?logout=true'; }
}
try {
    user = JSON.parse(localStorage.getItem('dhf_user'));
    if (!user || !user.vorname || !user.role) { throw new Error("Kein User oder fehlende Rolle"); }
    document.getElementById('welcome-user').textContent = `Willkommen, ${user.vorname}!`;

    // --- NEUE LOGIK: Rollenprüfung und UI-Anpassung ---
    isAdmin = user.role.name === 'admin';
    const isVisitor = user.role.name === 'Besucher';
    const isUser = user.role.name === 'user';

    // 1. Haupt-Navigationsanpassung
    document.getElementById('nav-dashboard').style.display = isVisitor ? 'none' : 'block';

    // --- NEU: Admin-Links (Users & Feedback) ---
    if (isAdmin) {
        document.getElementById('nav-users').style.display = 'block';
        document.getElementById('nav-feedback').style.display = 'inline-flex';
    } else {
        document.getElementById('nav-users').style.display = 'none';
    }
    // --- ENDE NEU ---

    if (isVisitor || isUser) {
        // Nur Admins dürfen auf die Farbeinstellungen zugreifen
        const wrapper = document.getElementById('content-wrapper');
        wrapper.classList.add('restricted-view');
        wrapper.innerHTML = `
            <h2 style="color: #e74c3c;">Zugriff verweigert</h2>
            <p>Sie benötigen Admin-Rechte, um die Farbeinstellungen zu verwalten.</p>
            <p>Bitte nutzen Sie den Link zum <a href="schichtplan.html" style="color: #3498db;">Schichtplan</a>.</p>
        `;
        document.getElementById('settings-dropbtn').style.display = 'none';
         throw new Error("Keine Admin-Rechte für Farbeinstellungen.");
    }

    // 2. Dropdown-Anpassung (Nur für Admins relevant)
    if (isAdmin) {
        // (Korrektur: JS muss 'admin-only' Links anzeigen, nicht 'user-only')
        document.querySelectorAll('#settings-dropdown-content .admin-only').forEach(el => {
            el.style.display = 'block';
        });
    }
    // --- ENDE NEUE LOGIK ---

} catch (e) {
     if (!e.message.includes("Admin-Rechte")) {
         logout();
    }
}
document.getElementById('logout-btn').onclick = logout;
async function apiFetch(endpoint, method = 'GET', body = null) {
    const options = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'include' };
    if (body) { options.body = JSON.stringify(body); }
    const response = await fetch(API_URL + endpoint, options);
    if (response.status === 401 || response.status === 403) {
        if (response.status === 401) { logout(); }
        throw new Error('Sitzung ungültig oder fehlende Rechte.');
    }
    const contentType = response.headers.get("content-type");
    let data;
    if (contentType && contentType.indexOf("application/json") !== -1) { data = await response.json(); }
    else { data = { message: await response.text() }; }
    if (!response.ok) { throw new Error(data.message || 'API-Fehler'); }
    return data;
}

// --- Seiten-Logik ---
const saveBtn = document.getElementById('save-colors-btn');
const statusMsg = document.getElementById('status-message');

const DEFAULT_COLORS = {
    'weekend_bg_color': '#fff8f8',
    'weekend_text_color': '#333333',
    'holiday_bg_color': '#ffddaa',
    'training_bg_color': '#daffdb',
    'shooting_bg_color': '#ffb0b0'
};

// --- NEU: loadColors aus der DB ---
async function loadColors() {
    let fetchedColors = DEFAULT_COLORS;

    // Lade Farben aus der Datenbank
    try {
        const data = await apiFetch('/api/settings', 'GET');
        // Überschreibe Defaults nur, wenn Werte in der DB existieren
        for(const key in DEFAULT_COLORS) {
            if (data[key] !== undefined && data[key] !== null) {
                fetchedColors[key] = data[key];
            }
        }
    } catch (error) {
         statusMsg.textContent = "Fehler beim Laden der Einstellungen: " + error.message;
         statusMsg.style.color = '#e74c3c';
    }

    for (const key in DEFAULT_COLORS) {
        // Konvertiere key (z.B. weekend_bg_color) zu ID (weekend-bg-color)
        const input = document.getElementById(key.replace(/_/g, '-'));
        if (input) {
            // Setze den Wert auf den aus der DB geladenen (oder Default)
            input.value = fetchedColors[key];
        }
    }
}

// --- NEU: saveColors in die DB ---
saveBtn.onclick = async () => {
    statusMsg.textContent = 'Speichere...';
    statusMsg.style.color = '#bdc3c7';

    const payload = {};
    let hasError = false;

    for (const key in DEFAULT_COLORS) {
        // Konvertiere key (z.B. weekend_bg_color) zu ID (weekend-bg-color)
        const input = document.getElementById(key.replace(/_/g, '-'));
        if (input) {
            // Sammle alle Farben in der Payload
            payload[key] = input.value;
        }
    }

    if (hasError) return;

    try {
        // Sende die gesamte Payload an die /api/settings PUT Route
        await apiFetch('/api/settings', 'PUT', payload);

        statusMsg.textContent = 'Erfolgreich gespeichert!';
        statusMsg.style.color = '#2ecc71';

        // Entferne alte localStorage-Daten, falls vorhanden
        localStorage.removeItem(STORAGE_KEY);

        setTimeout(() => statusMsg.textContent = '', 2000);
    } catch (error) {
        statusMsg.textContent = 'Fehler: ' + error.message;
        statusMsg.style.color = '#e74c3c';
    }
};

// --- Initialisierung ---
if (isAdmin) {
     loadColors();
}