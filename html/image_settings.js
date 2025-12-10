// html/image_settings.js

import { apiFetch } from './js/utils/api.js';
import { initAuthCheck, logout } from './js/utils/auth.js';

let user;
let isAdmin = false;

// Defaults (Jetzt auf High Quality eingestellt)
const DEFAULTS = {
    'img_width': 3800,
    'img_zoom': 3.0,
    'img_quality': 100,
    'img_header_bg': '#e0e0e0',
    'img_user_row_bg': '#f0f0f0',
    'img_weekend_bg': '#ffd6d6',
    'img_holiday_bg': '#ffddaa',
    'img_training_bg': '#ff00ff',
    'img_shooting_bg': '#e2e600',
    'img_dpo_border': '#ff0000',
    'img_staffing_ok': '#d4edda',
    'img_staffing_warn': '#fff3cd',
    'img_staffing_err': '#ffcccc',
    'img_self_row_bg': '#eaf2ff'
};

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Auth Check
    try {
        const authData = initAuthCheck();
        user = authData.user;
        isAdmin = authData.isAdmin;

        if (!isAdmin) {
            document.getElementById('content-wrapper').innerHTML = `
                <div class="restricted-view">
                    <h2 style="color: #e74c3c;">Zugriff verweigert</h2>
                    <p>Nur Administratoren haben Zugriff auf diese Einstellungen.</p>
                </div>
            `;
            throw new Error("Keine Admin-Rechte.");
        }

        // Navigation
        const navUsers = document.getElementById('nav-users');
        const navFeedback = document.getElementById('nav-feedback');
        const navEmails = document.getElementById('nav-emails');
        const navLogs = document.getElementById('nav-logs');

        if(isAdmin) {
            if(navUsers) navUsers.style.display = 'block';
            if(navFeedback) navFeedback.style.display = 'inline-flex';
            if(navEmails) navEmails.style.display = 'inline-flex';
            if(navLogs) navLogs.style.display = 'inline-flex';
        }

    } catch (e) {
        console.error("Auth Error:", e);
        return;
    }

    // 2. Elemente referenzieren
    const inputs = {
        'img_width': document.getElementById('img-width'),
        'img_zoom': document.getElementById('img-zoom'),
        'img_quality': document.getElementById('img-quality'),
        'img_header_bg': document.getElementById('img-header-bg'),
        'img_user_row_bg': document.getElementById('img-user-row-bg'),
        'img_weekend_bg': document.getElementById('img-weekend-bg'),
        'img_holiday_bg': document.getElementById('img-holiday-bg'),
        'img_training_bg': document.getElementById('img-training-bg'),
        'img_shooting_bg': document.getElementById('img-shooting-bg'),
        'img_dpo_border': document.getElementById('img-dpo-border'),
        'img_staffing_ok': document.getElementById('img-staffing-ok'),
        'img_staffing_warn': document.getElementById('img-staffing-warn'),
        'img_staffing_err': document.getElementById('img-staffing-err'),
        'img_self_row_bg': document.getElementById('img-self-row-bg')
    };

    const saveBtn = document.getElementById('save-image-settings-btn');
    const statusMsg = document.getElementById('status-message');

    // 3. Laden
    async function loadSettings() {
        // Defaults setzen
        for (const key in DEFAULTS) {
            if (inputs[key]) inputs[key].value = DEFAULTS[key];
        }

        try {
            const data = await apiFetch('/api/settings', 'GET');
            for (const key in DEFAULTS) {
                if (data[key] && inputs[key]) {
                    if (inputs[key].type === 'number') inputs[key].value = data[key];
                    else inputs[key].value = data[key];
                }
            }
        } catch (error) {
            console.warn("Laden fehlgeschlagen, nutze Defaults.", error);
        }
    }

    // 4. Speichern
    if (saveBtn) {
        saveBtn.onclick = async () => {
            statusMsg.textContent = 'Speichere...';
            statusMsg.style.color = '#bdc3c7';
            saveBtn.disabled = true;

            const payload = {};
            for (const key in inputs) {
                if (!inputs[key]) continue;
                if (inputs[key].type === 'number') {
                    payload[key] = parseFloat(inputs[key].value);
                } else {
                    payload[key] = inputs[key].value;
                }
            }

            try {
                await apiFetch('/api/settings', 'PUT', payload);
                statusMsg.textContent = 'Gespeichert!';
                statusMsg.style.color = '#2ecc71';
                setTimeout(() => { statusMsg.textContent = ''; }, 2000);
            } catch (error) {
                statusMsg.textContent = 'Fehler: ' + error.message;
                statusMsg.style.color = '#e74c3c';
            } finally {
                saveBtn.disabled = false;
            }
        };
    }

    // Start
    loadSettings();
});