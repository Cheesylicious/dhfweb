// html/js/pages/profile.js

import { apiFetch } from '../../js/utils/api.js';
import { initAuthCheck } from '../../js/utils/auth.js';

let user;

// DOM Elemente
const nameField = document.getElementById('profile-name');
const emailField = document.getElementById('profile-email');
const phoneField = document.getElementById('profile-phone');
const birthdayField = document.getElementById('profile-birthday');
const dogField = document.getElementById('profile-dog');
const saveBtn = document.getElementById('save-profile-btn');
const statusMsg = document.getElementById('status-message');

// DOM Elemente für Passwort-Modal
const pwModal = document.getElementById('pw-modal');
const openPwModalBtn = document.getElementById('open-pw-modal-btn');
const closePwModalBtn = document.getElementById('close-pw-modal');
const savePwBtn = document.getElementById('save-pw-btn');
const pwStatusMsg = document.getElementById('pw-status-message');
const oldPwField = document.getElementById('old-password');
const newPw1Field = document.getElementById('new-password-1');
const newPw2Field = document.getElementById('new-password-2');

// 1. Auth Check
try {
    const authData = initAuthCheck();
    user = authData.user;
    // Profilseite ist für ALLE sichtbar
    loadProfileData();
} catch (e) {
    console.error("Auth Error:", e);
}

// 2. Daten laden
async function loadProfileData() {
    try {
        // Aktuelle Daten vom Server holen
        const freshUser = await apiFetch('/api/profile');

        // Update local storage sicherheitshalber
        localStorage.setItem('dhf_user', JSON.stringify(freshUser));

        // Formular füllen
        if(nameField) nameField.value = `${freshUser.vorname} ${freshUser.name} (${freshUser.role ? freshUser.role.name : ''})`;
        if(emailField) emailField.value = freshUser.email || '';
        if(phoneField) phoneField.value = freshUser.telefon || '';
        if(dogField) dogField.value = freshUser.diensthund || '';

        if(birthdayField) {
            // API liefert ISO-String (YYYY-MM-DD), HTML Input type=date erwartet genau das.
            birthdayField.value = freshUser.geburtstag || '';
        }

    } catch (error) {
        console.error("Fehler beim Laden des Profils:", error);
        if(statusMsg) {
            statusMsg.textContent = "Fehler beim Laden der Daten.";
            statusMsg.style.color = "#e74c3c";
        }
    }
}

// 3. Speichern (Profil)
if (saveBtn) {
    saveBtn.onclick = async () => {
        const email = emailField.value.trim();
        const phone = phoneField.value.trim();
        const birthday = birthdayField.value; // String YYYY-MM-DD

        // Einfache E-Mail Validierung
        if (email && !email.includes('@')) {
            statusMsg.textContent = "Bitte eine gültige E-Mail angeben.";
            statusMsg.style.color = "#e74c3c";
            return;
        }

        saveBtn.disabled = true;
        statusMsg.textContent = "Speichere...";
        statusMsg.style.color = "#bdc3c7";

        try {
            const payload = {
                email: email,
                telefon: phone,
                geburtstag: birthday
            };

            const response = await apiFetch('/api/profile', 'PUT', payload);

            // Update local storage mit neuen Daten
            if (response.user) {
                localStorage.setItem('dhf_user', JSON.stringify(response.user));
            }

            statusMsg.textContent = "Profil erfolgreich aktualisiert!";
            statusMsg.style.color = "#2ecc71";

        } catch (error) {
            statusMsg.textContent = "Fehler: " + error.message;
            statusMsg.style.color = "#e74c3c";
        } finally {
            saveBtn.disabled = false;
        }
    };
}

// 4. Passwort Modal Logik
if (openPwModalBtn && pwModal) {
    openPwModalBtn.onclick = () => {
        pwModal.style.display = 'block';
        // Felder leeren
        oldPwField.value = '';
        newPw1Field.value = '';
        newPw2Field.value = '';
        pwStatusMsg.textContent = '';
    };

    // Schließen
    if (closePwModalBtn) {
        closePwModalBtn.onclick = () => {
            pwModal.style.display = 'none';
        };
    }
    window.onclick = (event) => {
        if (event.target == pwModal) {
            pwModal.style.display = 'none';
        }
    };

    // Speichern (Passwort)
    if (savePwBtn) {
        savePwBtn.onclick = async () => {
            const oldPw = oldPwField.value;
            const newPw1 = newPw1Field.value;
            const newPw2 = newPw2Field.value;

            pwStatusMsg.textContent = '';

            if (!oldPw || !newPw1 || !newPw2) {
                pwStatusMsg.textContent = "Bitte alle Felder ausfüllen.";
                pwStatusMsg.style.color = "#e74c3c";
                return;
            }
            if (newPw1 !== newPw2) {
                pwStatusMsg.textContent = "Neue Passwörter stimmen nicht überein.";
                pwStatusMsg.style.color = "#e74c3c";
                return;
            }
            if (newPw1.length < 4) {
                pwStatusMsg.textContent = "Passwort muss mind. 4 Zeichen haben.";
                pwStatusMsg.style.color = "#e74c3c";
                return;
            }

            savePwBtn.disabled = true;
            pwStatusMsg.textContent = "Speichere...";
            pwStatusMsg.style.color = "#bdc3c7";

            try {
                // Nutzung der existierenden Route
                const response = await apiFetch('/api/change_password', 'POST', {
                    old_password: oldPw,
                    new_password1: newPw1,
                    new_password2: newPw2
                });

                pwStatusMsg.textContent = "Passwort erfolgreich geändert!";
                pwStatusMsg.style.color = "#2ecc71";

                setTimeout(() => {
                    pwModal.style.display = 'none';
                    pwStatusMsg.textContent = '';
                }, 1500);

            } catch (error) {
                pwStatusMsg.textContent = "Fehler: " + error.message;
                pwStatusMsg.style.color = "#e74c3c";
            } finally {
                savePwBtn.disabled = false;
            }
        };
    }
}