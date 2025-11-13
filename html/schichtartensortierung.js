// --- Globales Setup ---
const API_URL = 'http://46.224.63.203:5000';
let user;
let sortableInstance = null;
let isAdmin = false;

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
    const isVisitor = user.role.name === 'Besucher';

    // 1. Haupt-Navigationsanpassung
    document.getElementById('nav-dashboard').style.display = isVisitor ? 'none' : 'block';

    // --- Admin-Links (Users & Feedback) ---
    if (isAdmin) {
        document.getElementById('nav-users').style.display = 'block';
        document.getElementById('nav-feedback').style.display = 'inline-flex';
    } else {
        document.getElementById('nav-users').style.display = 'none';
    }

    // *** KORRIGIERTE ROLLENPRÜFUNG: Nur ADMIN darf auf diese Seite zugreifen ***
    if (!isAdmin) { // Blockiere, wenn NICHT Admin
        document.getElementById('content-wrapper').innerHTML = `
            <div class="restricted-view">
                <h2 style="color: #e74c3c;">Zugriff verweigert</h2>
                <p>Nur Administratoren dürfen die Schichtarten-Sortierung festlegen.</p>
                <p>Bitte nutzen Sie den Link zum <a href="schichtplan.html" style="color: #3498db;">Schichtplan</a>.</p>
            </div>
        `;
        document.getElementById('settings-dropbtn').style.display = 'none';

        // Verstecke alle Admin-Only Links im Dropdown
        document.querySelectorAll('#settings-dropdown-content a').forEach(el => {
             if (el.classList.contains('admin-only')) {
                el.style.display = 'none';
            }
        });

        throw new Error("Keine Admin-Rechte für Schichtarten Sortierung.");
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

const typeList = document.getElementById('type-sort-list');
const saveBtn = document.getElementById('save-order-btn');
const statusMsg = document.getElementById('status-message');


async function loadShiftTypes() {
    try {
        // Ruft die bereits nach staffing_sort_order sortierte Liste ab
        const types = await apiFetch('/api/shifttypes');
        typeList.innerHTML = '';

        types.forEach(st => {
            const li = document.createElement('li');
            li.className = 'sortable-item';
            li.dataset.typeId = st.id;

            // Prüfen, ob die Schicht zur Besetzung gehört (ob irgendein Soll > 0 ist)
            const isStaffingRelevant = (st.min_staff_mo || 0) > 0 || (st.min_staff_di || 0) > 0 ||
                                       (st.min_staff_mi || 0) > 0 || (st.min_staff_do || 0) > 0 ||
                                       (st.min_staff_fr || 0) > 0 || (st.min_staff_sa || 0) > 0 ||
                                       (st.min_staff_so || 0) > 0 || (st.min_staff_holiday || 0) > 0;

            const staffingInfo = isStaffingRelevant ? 'Gehört zur Besetzung' : 'Nicht relevant für Besetzung';

            li.innerHTML = `
                <span class="drag-handle">☰</span>
                <div class="type-label">
                    <div class="color-preview" style="background-color: ${st.color};"></div>
                    <strong>${st.abbreviation}</strong>
                    <span>(${st.name})</span>
                </div>
                <span class="type-staffing-info">${staffingInfo}</span>
            `;
            typeList.appendChild(li);
        });

        if (sortableInstance) sortableInstance.destroy();

        // Initialisiere SortableJS
        sortableInstance = new Sortable(typeList, {
            handle: '.drag-handle',
            animation: 150,
            ghostClass: 'sortable-ghost'
        });

    } catch (error) {
        typeList.innerHTML = `<li style="color: red; padding: 20px;">Fehler beim Laden der Schichtarten: ${error.message}</li>`;
    }
}


saveBtn.onclick = async () => {
    statusMsg.textContent = 'Speichere...';
    statusMsg.style.color = '#bdc3c7';

    const listItems = typeList.querySelectorAll('.sortable-item');
    const payload = [];

    listItems.forEach((li, index) => {
        payload.push({
            id: parseInt(li.dataset.typeId),
            order: index
        });
    });

    try {
        // Sendet die Sortierreihenfolge an die neue Admin-Route
        await apiFetch('/api/shifttypes/staffing_order', 'PUT', payload);
        statusMsg.textContent = 'Erfolgreich gespeichert!';
        statusMsg.style.color = '#2ecc71';
        setTimeout(() => statusMsg.textContent = '', 2000);
    } catch (error) {
        statusMsg.textContent = 'Fehler: ' + error.message;
        statusMsg.style.color = '#e74c3c';
    }
};

// Initialisierung nur, wenn isAdmin = true (siehe try/catch Block oben)
if (isAdmin) {
    loadShiftTypes();
}