// --- Globales Setup ---
const API_URL = 'http://46.224.63.203:5000'; // (Ihre IP)
let user;
let sortableInstance = null;
let isAdmin = false; // <<< NEU
let isVisitor = false; // <<< NEU
// --- START: NEU ---
let isHundefuehrer = false;
// --- ENDE: NEU ---

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

    // --- NEUE LOGIK: Rollenprüfung und UI-Anpassung ---
    isAdmin = user.role.name === 'admin';
    isVisitor = user.role.name === 'Besucher';
    // --- START: NEU ---
    isHundefuehrer = user.role.name === 'Hundeführer';
    const isPlanschreiber = user.role.name === 'Planschreiber';
    // --- ENDE: NEU ---

    // 1. Haupt-Navigationsanpassung
    document.getElementById('nav-dashboard').style.display = isVisitor ? 'none' : 'block';

    // --- NEU: Admin-Links (Users & Feedback) ---
    // --- START: ANPASSUNG (Planschreiber/Hundeführer) ---
    if (isAdmin) {
        document.getElementById('nav-users').style.display = 'block';
        document.getElementById('nav-feedback').style.display = 'inline-flex';
    } else if (isPlanschreiber) {
        document.getElementById('nav-users').style.display = 'none';
        document.getElementById('nav-feedback').style.display = 'inline-flex';
    }
    else {
        document.getElementById('nav-users').style.display = 'none';
        document.getElementById('nav-feedback').style.display = 'none';
    }
    // --- ENDE: ANPASSUNG ---
    // --- ENDE NEU ---


    // *** KORRIGIERTE ROLLENPRÜFUNG: Nur ADMIN darf auf diese Seite zugreifen ***
    // --- START: ANPASSUNG (Blockiert alle außer Admin) ---
    if (!isAdmin) { // Blockiere, wenn NICHT Admin
    // --- ENDE: ANPASSUNG ---
        // Zeige die Seite mit Zugriff verweigert
        document.getElementById('content-wrapper').innerHTML = `
            <div class="restricted-view">
                <h2 style="color: #e74c3c;">Zugriff verweigert</h2>
                <p>Nur Administratoren dürfen die Mitarbeiter-Sortierung festlegen.</p>
                <p>Bitte nutzen Sie den Link zum <a href="schichtplan.html" style="color: #3498db;">Schichtplan</a>.</p>
            </div>
        `;
        // Verstecke Dropdown-Tasten
        document.getElementById('settings-dropbtn').style.display = 'none';

        // Setze alle Admin-Only Links im Dropdown auf unsichtbar
        document.querySelectorAll('#settings-dropdown-content a').forEach(el => {
             // Der aktive Link (einstellungen.html) ist im HTML admin-only, also sollte er versteckt werden.
             if (el.classList.contains('admin-only')) {
                el.style.display = 'none';
            }
        });

        throw new Error("Keine Admin-Rechte für Mitarbeiter Sortierung.");
    }

    // 2. Dropdown-Anpassung: Wenn Admin, zeige alle Admin-Only Links
    if (isAdmin) {
        document.querySelectorAll('#settings-dropdown-content .admin-only').forEach(el => {
            el.style.display = 'block';
        });
    }

} catch (e) {
    if (!e.message.includes("Admin-Rechte")) {
         logout();
    }
}
// --- ENDE NEUE LOGIK ---

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
const userList = document.getElementById('user-sort-list');
const saveBtn = document.getElementById('save-order-btn');
const statusMsg = document.getElementById('status-message');

async function loadUsers() {
    try {
        const users = await apiFetch('/api/users');
        userList.innerHTML = '';
        users.forEach(u => {
            const li = document.createElement('li');
            li.className = 'sortable-item';
            li.dataset.userId = u.id;
            li.dataset.visible = u.shift_plan_visible;
            const roleName = u.role ? u.role.name : 'N/A';
            const visibilityClass = u.shift_plan_visible ? 'visible' : '';
            li.innerHTML = `
                <span class="drag-handle">☰</span>
                <span class="user-name">${u.vorname} ${u.name}</span>
                <span class="user-role">${roleName}</span>
                <span class="visibility-toggle ${visibilityClass}" title="Im Plan anzeigen/ausblenden">👁</span>
            `;
            userList.appendChild(li);
        });
        if (sortableInstance) sortableInstance.destroy();
        sortableInstance = new Sortable(userList, {
            handle: '.drag-handle',
            animation: 150,
            ghostClass: 'sortable-ghost'
        });
    } catch (error) {
        userList.innerHTML = `<li style="color: red; padding: 20px;">Fehler beim Laden der Benutzer: ${error.message}</li>`;
    }
}

userList.addEventListener('click', function(e) {
    if (e.target.classList.contains('visibility-toggle')) {
        const li = e.target.closest('.sortable-item');
        const isVisible = li.dataset.visible === 'true';
        li.dataset.visible = !isVisible;
        e.target.classList.toggle('visible', !isVisible);
    }
});

saveBtn.onclick = async () => {
    statusMsg.textContent = 'Speichere...';
    statusMsg.style.color = '#bdc3c7'; /* (Farbe für dunklen Modus) */
    const listItems = userList.querySelectorAll('.sortable-item');
    const payload = [];
    listItems.forEach((li, index) => {
        payload.push({
            id: parseInt(li.dataset.userId),
            visible: li.dataset.visible === 'true',
            order: index
        });
    });
    try {
        // API Call muss Admin-Rechte haben (was durch den Decorator gewährleistet ist)
        await apiFetch('/api/users/display_settings', 'PUT', payload);
        statusMsg.textContent = 'Erfolgreich gespeichert!';
        statusMsg.style.color = '#2ecc71'; /* (Grün) */
        setTimeout(() => statusMsg.textContent = '', 2000);
    } catch (error) {
        statusMsg.textContent = 'Fehler: ' + error.message;
        statusMsg.style.color = '#e74c3c'; /* (Rot) */
    }
};

// Initialisierung nur, wenn isAdmin = true (siehe try/catch Block oben)
if (isAdmin) {
    loadUsers();
}