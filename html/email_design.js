// --- Globales Setup ---
const API_URL = 'http://46.224.63.203:5000';
const STORAGE_KEY = 'dhf_email_design_settings'; // Eigener Key, um Konflikte zu vermeiden

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
        logout();
        throw new Error('Sitzung abgelaufen.');
    }

    // Versuche JSON, sonst Text
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
        const json = await response.json();
        if (!response.ok) throw new Error(json.message || 'API Fehler');
        return json;
    } else {
        return {}; // Fallback bei leeren Antworten
    }
}

// Default Werte für Email Design (Fallback)
const EMAIL_DEFAULTS = {
    'email_header_bg': '#3498db',
    'email_header_text': '#ffffff',
    'email_body_bg': '#ffffff',
    'email_body_text': '#333333',
    'email_accent_color': '#3498db',
    'email_btn_text': '#ffffff',
    'email_footer_bg': '#eeeeee',
    'email_footer_text': '#7f8c8d'
};

// --- DOM Loaded ---
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Auth Check (Admin Only)
    try {
        const userStr = localStorage.getItem('dhf_user');
        if (!userStr) throw new Error("Kein Login");
        const user = JSON.parse(userStr);
        if (user.role.name !== 'admin') {
            document.body.innerHTML = '<h2 style="color:white;text-align:center;margin-top:50px;">Zugriff verweigert</h2>';
            return;
        }
        const logoutBtn = document.getElementById('logout-btn');
        if(logoutBtn) logoutBtn.onclick = logout;
    } catch (e) {
        logout();
        return;
    }

    // 2. Elemente referenzieren
    const inputs = {
        'email_header_bg': document.getElementById('email-header-bg'),
        'email_header_text': document.getElementById('email-header-text'),
        'email_body_bg': document.getElementById('email-body-bg'),
        'email_body_text': document.getElementById('email-body-text'),
        'email_accent_color': document.getElementById('email-accent-color'),
        'email_btn_text': document.getElementById('email-btn-text'),
        'email_footer_bg': document.getElementById('email-footer-bg'),
        'email_footer_text': document.getElementById('email-footer-text')
    };

    const previewElements = {
        header: document.getElementById('p-header'),
        headerH2: document.querySelector('#p-header h2'),
        container: document.getElementById('preview-container'), // Body BG container
        bodyText: document.getElementById('p-body'),
        btn: document.getElementById('p-btn'),
        footer: document.getElementById('p-footer')
    };

    // 3. Funktion: Vorschau aktualisieren
    function updatePreview() {
        // Header
        previewElements.header.style.backgroundColor = inputs['email_header_bg'].value;
        previewElements.headerH2.style.color = inputs['email_header_text'].value;

        // Body
        previewElements.container.style.backgroundColor = inputs['email_body_bg'].value;
        previewElements.bodyText.style.color = inputs['email_body_text'].value;

        // Button
        previewElements.btn.style.backgroundColor = inputs['email_accent_color'].value;
        previewElements.btn.style.color = inputs['email_btn_text'].value;

        // Footer
        previewElements.footer.style.backgroundColor = inputs['email_footer_bg'].value;
        previewElements.footer.style.color = inputs['email_footer_text'].value;
    }

    // Event Listener für Live-Update hinzufügen
    for (const key in inputs) {
        if(inputs[key]) {
            inputs[key].addEventListener('input', updatePreview);
        }
    }

    // 4. Werte laden
    async function loadSettings() {
        // Zuerst Defaults setzen
        for (const key in EMAIL_DEFAULTS) {
            if (inputs[key]) inputs[key].value = EMAIL_DEFAULTS[key];
        }
        updatePreview(); // Initiale Vorschau

        try {
            // Wir nutzen denselben Settings-Endpoint, speichern aber neue Keys
            const data = await apiFetch('/api/settings', 'GET');

            let hasChanges = false;
            for (const key in EMAIL_DEFAULTS) {
                // Key format in DB: email_header_bg (genauso wie hier definiert)
                if (data[key]) {
                    if(inputs[key]) inputs[key].value = data[key];
                    hasChanges = true;
                }
            }
            if(hasChanges) updatePreview();

        } catch (error) {
            console.warn("Konnte Settings nicht laden, nutze Defaults:", error);
        }
    }

    // 5. Speichern
    const saveBtn = document.getElementById('save-design-btn');
    const statusMsg = document.getElementById('status-message');

    if (saveBtn) {
        saveBtn.onclick = async () => {
            statusMsg.textContent = 'Speichere...';
            statusMsg.style.color = '#bdc3c7';

            const payload = {};
            for (const key in inputs) {
                payload[key] = inputs[key].value;
            }

            try {
                // PUT an /api/settings speichert beliebige Keys, solange das Backend dynamisch ist
                // Falls das Backend strict ist, muss dort "email_*" erlaubt werden.
                await apiFetch('/api/settings', 'PUT', payload);

                statusMsg.textContent = 'Design gespeichert!';
                statusMsg.style.color = '#2ecc71';
                setTimeout(() => { statusMsg.textContent = ''; }, 3000);
            } catch (error) {
                statusMsg.textContent = 'Fehler beim Speichern';
                statusMsg.style.color = '#e74c3c';
                console.error(error);
            }
        };
    }

    // Init
    loadSettings();
});