import { API_URL } from '../utils/constants.js';

// --- TEST: DIESES POPUP MUSS ERSCHEINEN ---
// alert("Datei pw_logic.js wurde geladen!");
console.log(">>> PW_LOGIC.JS GELADEN - KEINE WEITERLEITUNG <<<");

document.addEventListener('DOMContentLoaded', () => {
    let user;

    // UI Elemente
    const welcomeTitle = document.getElementById('welcome-title');
    const welcomeText = document.getElementById('welcome-text');
    const oldPasswordField = document.getElementById('old-password');
    const newPassword1Field = document.getElementById('new-password1');
    const newPassword2Field = document.getElementById('new-password2');
    const saveBtn = document.getElementById('save-password-btn');
    const statusEl = document.getElementById('status');
    const logoutLink = document.getElementById('logout-link');

    // Logout
    async function performLogout() {
        try {
            await fetch(API_URL + '/api/logout', { method: 'POST', credentials: 'include' });
        } catch (e) { console.error(e); }
        finally {
            localStorage.removeItem('dhf_user');
            window.location.href = 'index.html?logout=true';
        }
    }

    // Auth & Logik
    try {
        const userStr = localStorage.getItem('dhf_user');
        if (!userStr) {
            window.location.href = 'index.html'; // Nur zum Login zurück, wenn gar kein User da ist
            return;
        }
        user = JSON.parse(userStr);

        console.log("User force flag:", user.force_password_change);

        // --- ENTSCHEIDUNG ---
        if (user.force_password_change === true) {
            // ZWANG (Erster Login)
            if(welcomeTitle) welcomeTitle.textContent = `Willkommen, ${user.vorname}!`;
            if(welcomeText) welcomeText.textContent = `Bitte legen Sie ein neues Passwort fest.`;

            if (logoutLink) {
                logoutLink.textContent = "Abmelden";
                logoutLink.onclick = (e) => { e.preventDefault(); performLogout(); };
            }
        } else {
            // FREIWILLIG (Profil) - KEIN REDIRECT HIER!
            if(welcomeTitle) welcomeTitle.textContent = `Passwort ändern`;
            if(welcomeText) welcomeText.textContent = `Hier können Sie Ihr Passwort ändern.`;

            if (logoutLink) {
                logoutLink.textContent = "Abbrechen (Zurück)";
                logoutLink.style.color = "#3498db";
                logoutLink.style.textDecoration = "none";
                logoutLink.style.cursor = "pointer";
                logoutLink.onclick = (e) => {
                    e.preventDefault();
                    window.location.href = 'dashboard.html';
                };
            }
        }

    } catch (e) {
        console.error("Fehler:", e);
    }

    // Speichern
    if (saveBtn) {
        saveBtn.onclick = async () => {
            statusEl.textContent = 'Speichere...';
            statusEl.style.color = '#bdc3c7';
            saveBtn.disabled = true;

            const payload = {
                old_password: oldPasswordField.value,
                new_password1: newPassword1Field.value,
                new_password2: newPassword2Field.value
            };

            try {
                const response = await fetch(API_URL + '/api/change_password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(payload)
                });
                const data = await response.json();

                if (response.ok) {
                    statusEl.textContent = 'Erfolg! Weiterleitung...';
                    statusEl.style.color = '#2ecc71';
                    // Flag lokal updaten
                    if(user) {
                        user.force_password_change = false;
                        localStorage.setItem('dhf_user', JSON.stringify(user));
                    }
                    setTimeout(() => { window.location.href = 'dashboard.html'; }, 1500);
                } else {
                    statusEl.textContent = data.message || 'Fehler';
                    statusEl.style.color = '#e74c3c';
                    saveBtn.disabled = false;
                }
            } catch (error) {
                statusEl.textContent = 'Fehler: ' + error.message;
                statusEl.style.color = '#e74c3c';
                saveBtn.disabled = false;
            }
        };
    }
});