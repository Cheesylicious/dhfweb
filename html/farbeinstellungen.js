// --- Globales Setup (Auth, API) ---
const API_URL = 'http://46.224.63.203:5000';
const STORAGE_KEY = 'dhf_color_settings';
let user;
let isAdmin = false;

// Helper: Auth Logout
async function logout() {
    try { await fetch(API_URL + '/api/logout', { method: 'POST' }); }
    catch (e) { console.error(e); }
    finally { localStorage.removeItem('dhf_user'); window.location.href = 'index.html?logout=true'; }
}

// Helper: API Fetcher
async function apiFetch(endpoint, method = 'GET', body = null) {
    const options = {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
    };
    if (body) { options.body = JSON.stringify(body); }

    const response = await fetch(API_URL + endpoint, options);

    if (response.status === 401 || response.status === 403) {
        if (response.status === 401) logout();
        throw new Error('Zugriff verweigert oder Sitzung abgelaufen.');
    }

    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
        const json = await response.json();
        if (!response.ok) throw new Error(json.message || 'API Fehler');
        return json;
    } else {
        const text = await response.text();
        if (!response.ok) throw new Error(text || 'API Fehler');
        return { message: text };
    }
}

// Defaults
const DEFAULT_COLORS = {
    'weekend_bg_color': '#fff8f8',
    'weekend_text_color': '#333333',
    'holiday_bg_color': '#ffddaa',
    'training_bg_color': '#daffdb',
    'shooting_bg_color': '#ffb0b0',
    'dpo_border_color': '#ff0000' // NEU
};

// --- HAUPTLOGIK ---
document.addEventListener('DOMContentLoaded', async () => {
    // 1. User Check
    try {
        const userStr = localStorage.getItem('dhf_user');
        if (!userStr) throw new Error("Kein Login gefunden");
        user = JSON.parse(userStr);
        if (!user || !user.role) throw new Error("Ungültige User-Daten");

        isAdmin = (user.role.name === 'admin');
        const welcomeEl = document.getElementById('welcome-user');
        if(welcomeEl) welcomeEl.textContent = `Willkommen, ${user.vorname}!`;

        // UI Anpassung
        const isVisitor = (user.role.name === 'Besucher');
        const isUser = (user.role.name === 'user');
        // --- START: NEU ---
        const isPlanschreiber = (user.role.name === 'Planschreiber');
        const isHundefuehrer = (user.role.name === 'Hundeführer');
        // --- ENDE: NEU ---


        const navDashboard = document.getElementById('nav-dashboard');
        if(navDashboard) navDashboard.style.display = isVisitor ? 'none' : 'block';

        const navUsers = document.getElementById('nav-users');
        const navFeedback = document.getElementById('nav-feedback');

        // --- START: ANPASSUNG (Alle Rollen) ---
        if (isAdmin) {
            if(navUsers) navUsers.style.display = 'block';
            if(navFeedback) navFeedback.style.display = 'inline-flex';
        } else if (isPlanschreiber) {
            if(navUsers) navUsers.style.display = 'none';
            if(navFeedback) navFeedback.style.display = 'inline-flex';
        } else {
            if(navUsers) navUsers.style.display = 'none';
            if(navFeedback) navFeedback.style.display = 'none';
        }
        // --- ENDE: ANPASSUNG ---

        // Admin-Only Links im Dropdown anzeigen
        if (isAdmin) {
            const adminLinks = document.querySelectorAll('#settings-dropdown-content .admin-only');
            adminLinks.forEach(el => el.style.display = 'block');
        }

        // Zugriffsschutz für Seite
        // --- START: ANPASSUNG (Blockiert alle außer Admin) ---
        if (isVisitor || isUser || isPlanschreiber || isHundefuehrer) {
        // --- ENDE: ANPASSUNG ---
            const wrapper = document.getElementById('content-wrapper');
            if(wrapper) {
                wrapper.classList.add('restricted-view');
                wrapper.innerHTML = `<h2 style="color: #e74c3c;">Zugriff verweigert</h2><p>Sie benötigen Admin-Rechte.</p>`;
            }
            const dropBtn = document.getElementById('settings-dropbtn');
            if(dropBtn) dropBtn.style.display = 'none';
            return; // Stop execution
        }

    } catch (e) {
        console.error("Auth Fehler:", e);
        logout();
        return;
    }

    // 2. Elemente laden
    const saveBtn = document.getElementById('save-colors-btn');
    const statusMsg = document.getElementById('status-message');
    const logoutBtn = document.getElementById('logout-btn');
    if(logoutBtn) logoutBtn.onclick = logout;

    // 3. Farben laden Funktion
    async function loadColors() {
        // SCHRITT A: Setze SOFORT die Defaults (verhindert schwarze Felder)
        for (const key in DEFAULT_COLORS) {
            const inputId = key.replace(/_/g, '-');
            const input = document.getElementById(inputId);
            if (input) {
                input.value = DEFAULT_COLORS[key];
            }
        }

        // SCHRITT B: Versuche von DB zu laden und zu überschreiben
        try {
            const data = await apiFetch('/api/settings', 'GET');
            for (const key in DEFAULT_COLORS) {
                // Nur überschreiben, wenn DB einen Wert hat
                if (data[key]) {
                    const inputId = key.replace(/_/g, '-');
                    const input = document.getElementById(inputId);
                    if (input) input.value = data[key];
                }
            }
        } catch (error) {
            if(statusMsg) {
                statusMsg.textContent = "Verwende Standardfarben (DB nicht erreichbar)";
                statusMsg.style.color = '#e74c3c';
            }
            console.warn("Load colors failed:", error);
        }
    }

    // 4. Speichern Funktion
    if (saveBtn) {
        saveBtn.onclick = async () => {
            if(statusMsg) {
                statusMsg.textContent = 'Speichere...';
                statusMsg.style.color = '#bdc3c7';
            }

            const payload = {};
            for (const key in DEFAULT_COLORS) {
                const inputId = key.replace(/_/g, '-');
                const input = document.getElementById(inputId);
                if (input) {
                    payload[key] = input.value;
                }
            }

            try {
                await apiFetch('/api/settings', 'PUT', payload);
                if(statusMsg) {
                    statusMsg.textContent = 'Gespeichert!';
                    statusMsg.style.color = '#2ecc71';
                }
                localStorage.removeItem(STORAGE_KEY);
                setTimeout(() => { if(statusMsg) statusMsg.textContent = ''; }, 2000);
            } catch (error) {
                if(statusMsg) {
                    statusMsg.textContent = 'Fehler: ' + error.message;
                    statusMsg.style.color = '#e74c3c';
                }
            }
        };
    }

    // Init
    if (isAdmin) {
        loadColors();
    }
});