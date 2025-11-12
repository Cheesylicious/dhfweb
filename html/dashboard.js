const API_URL = 'http://46.224.63.203:5000'; // Ersetzen Sie dies ggf. durch Ihre Domain
let user;

async function logout() {
    try {
        await apiFetch('/api/logout', 'POST');
    } catch (error) {
        console.error("Logout-Fehler:", error.message);
    } finally {
        localStorage.removeItem('dhf_user');
        window.location.href = 'index.html?logout=true';
    }
}

// --- Logik: Benutzerrollen-Check und Navigation anpassen ---
try {
    user = JSON.parse(localStorage.getItem('dhf_user'));
    if (!user || !user.vorname || !user.role) { throw new Error("Kein User oder fehlende Rolle"); }

    const isAdmin = user.role.name === 'admin';
    // Die isVisitor Prüfung ist dank des Head-Skripts nicht mehr nötig,
    // da Besucher bereits umgeleitet werden, bevor dieser Teil ausgeführt wird.

    document.getElementById('welcome-user').textContent = `Willkommen, ${user.vorname}!`;
    document.getElementById('welcome-message').textContent = `Willkommen, ${user.vorname}!`;

    const navDashboard = document.getElementById('nav-dashboard');
    const navUsers = document.getElementById('nav-users');

    // --- NEU: Feedback-Link für Admins holen ---
    const navFeedback = document.getElementById('nav-feedback');

    // Sichtbarkeit der Links für Nicht-Besucher (Admins und Standard-User)

    // Dashboard Link ist für Nicht-Besucher sichtbar
    navDashboard.style.display = 'block';

    // Admin-spezifische Links
    if (isAdmin) {
        navUsers.style.display = 'block';
        navFeedback.style.display = 'inline-flex'; // (Feedback-Link anzeigen)
         document.querySelector('.card p').textContent = "Dies ist das Admin-Dashboard. Wählen Sie einen Bereich aus der Navigation oben.";
    } else {
         document.querySelector('.card p').textContent = "Dies ist das Dashboard. Wählen Sie einen Bereich aus der Navigation oben.";
    }


} catch (e) {
    // Wenn der User nicht da ist oder ungültig, leite um
    window.location.href = 'index.html?logout=true';
}

document.getElementById('logout-btn').onclick = logout;

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
        throw new Error('Sitzung ungültig');
    }
    if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'API-Fehler');
    }
    if (response.status !== 204) {
        try { return await response.json(); } catch(e) { return {}; }
    }
}