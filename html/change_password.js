document.addEventListener('DOMContentLoaded', () => {

    const API_URL = 'http://46.224.63.203:5000';
    let user;

    // Elemente holen
    const welcomeTitle = document.getElementById('welcome-title');
    const welcomeText = document.getElementById('welcome-text');
    const oldPasswordField = document.getElementById('old-password');
    const newPassword1Field = document.getElementById('new-password1');
    const newPassword2Field = document.getElementById('new-password2');
    const saveBtn = document.getElementById('save-password-btn');
    const statusEl = document.getElementById('status');
    const logoutLink = document.getElementById('logout-link');

    // 1. Authentifizierungs-Check (Sehr wichtig)
    try {
        const userStr = localStorage.getItem('dhf_user');
        if (!userStr) {
            // Nicht eingeloggt, zurück zum Login
            window.location.href = 'index.html';
            return;
        }
        user = JSON.parse(userStr);

        // Prüfen, ob der Benutzer überhaupt hier sein muss
        if (!user.force_password_change) {
            // Benutzer muss sein PW nicht ändern, weiter zum Dashboard
            window.location.href = 'dashboard.html';
            return;
        }

        // Benutzer ist hier richtig, UI anpassen
        welcomeTitle.textContent = `Willkommen, ${user.vorname}!`;
        welcomeText.textContent = `Da dies Ihr erster Login ist (oder Ihr Passwort zurückgesetzt wurde), müssen Sie ein neues Passwort festlegen.`;

    } catch (e) {
        // Fehler beim Parsen oder anderer Fehler -> Sicherer Logout
        console.error("Auth-Fehler auf change_password.js:", e);
        logout();
        return;
    }

    // 2. Logout-Funktion
    async function logout() {
        try {
            // Versuche, den Server-Logout aufzurufen
            await fetch(API_URL + '/api/logout', { method: 'POST', credentials: 'include' });
        } catch (e) {
            console.error(e);
        } finally {
            // Immer lokales Storage leeren und umleiten
            localStorage.removeItem('dhf_user');
            window.location.href = 'index.html?logout=true';
        }
    }

    logoutLink.onclick = logout;

    // 3. Speicher-Funktion
    saveBtn.onclick = async () => {
        const old_password = oldPasswordField.value;
        const new_password1 = newPassword1Field.value;
        const new_password2 = newPassword2Field.value;

        // Frontend-Validierung
        if (!old_password || !new_password1 || !new_password2) {
            statusEl.textContent = 'Bitte füllen Sie alle Felder aus.';
            statusEl.style.color = '#e74c3c'; // Rot
            return;
        }
        if (new_password1 !== new_password2) {
            statusEl.textContent = 'Die neuen Passwörter stimmen nicht überein.';
            statusEl.style.color = '#e74c3c'; // Rot
            return;
        }
         if (new_password1.length < 4) {
            statusEl.textContent = 'Das neue Passwort muss mindestens 4 Zeichen lang sein.';
            statusEl.style.color = '#e74c3c'; // Rot
            return;
        }

        statusEl.textContent = 'Speichere...';
        statusEl.style.color = '#bdc3c7'; // Grau
        saveBtn.disabled = true;

        try {
            const response = await fetch(API_URL + '/api/change_password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include', // WICHTIG: Sendet das Login-Cookie mit
                body: JSON.stringify({
                    old_password: old_password,
                    new_password1: new_password1,
                    new_password2: new_password2
                })
            });

            const data = await response.json();

            if (response.ok) {
                // Erfolg!
                statusEl.textContent = 'Passwort erfolgreich geändert! Sie werden weitergeleitet...';
                statusEl.style.color = '#2ecc71'; // Grün

                // Wichtig: Da das Flag jetzt 'false' ist, muss der User im localStorage
                // nicht aktualisiert werden, da wir ihn sofort weiterleiten.
                setTimeout(() => {
                    window.location.href = 'dashboard.html';
                }, 2000);

            } else {
                // API-Fehler (z.B. "Altes Passwort ist falsch.")
                throw new Error(data.message || 'Unbekannter API-Fehler');
            }

        } catch (error) {
            statusEl.textContent = 'Fehler: ' + error.message;
            statusEl.style.color = '#e74c3c'; // Rot
            saveBtn.disabled = false;
        }
    };

});