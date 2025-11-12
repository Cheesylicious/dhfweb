// --- Globales Setup (unverändert) ---
const API_URL = 'http://46.224.63.203:5000'; // Ersetzen Sie dies ggf. durch Ihre Domain
let user;
let isAdmin = false; // <<< NEU

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

    // --- NEUE LOGIK: Rollenprüfung (WICHTIG) ---
    isAdmin = user.role.name === 'admin';
    const isVisitor = user.role.name === 'Besucher';

    // 1. Haupt-Navigationsanpassung
    const navDashboard = document.getElementById('nav-dashboard');
    const navUsers = document.getElementById('nav-users');

    // --- NEU: Feedback-Link ---
    const navFeedback = document.getElementById('nav-feedback');

    if (isVisitor) {
        navDashboard.style.display = 'none';
    } else {
        navDashboard.style.display = 'block';
    }

    if (isAdmin) {
        navUsers.style.display = 'block';
        navFeedback.style.display = 'inline-flex';
    } else {
         navUsers.style.display = 'none';
    }
    // --- ENDE NEU ---


    if (isVisitor || !isAdmin) {
        // Nur Admins dürfen auf die Rollenverwaltung zugreifen

        // Blockiere den Zugriff auf die gesamte Seite, wenn nicht Admin
        document.getElementById('content-wrapper').innerHTML = `
            <div class="restricted-view">
                <h2 style="color: #e74c3c;">Zugriff verweigert</h2>
                <p>Sie benötigen Admin-Rechte, um auf die Rollenverwaltung zuzugreifen.</p>
                <p>Bitte nutzen Sie den Link zum <a href="schichtplan.html" style="color: #3498db;">Schichtplan</a>.</p>
            </div>
        `;
         document.getElementById('sub-nav-roles-container').style.display = 'none';

        // Wirf Fehler, um das Laden der Daten zu verhindern
        throw new Error("Keine Admin-Rechte für Rollenverwaltung.");
    }
    // --- ENDE NEUE LOGIK ---

} catch (e) {
    if (!e.message.includes("Admin-Rechte")) {
         logout();
    }
}

document.getElementById('logout-btn').onclick = logout;

// --- Globale API-Funktion (unverändert) ---
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

// --- Elemente & Modal-Logik ---
const roleTableBody = document.getElementById('role-table-body');
const modal = document.getElementById('role-modal');
const modalTitle = document.getElementById('modal-title');
const modalStatus = document.getElementById('modal-status');
const addRoleBtn = document.getElementById('add-role-btn');
const saveRoleBtn = document.getElementById('save-role-btn');
const closeModalBtn = document.querySelector('.close');

const roleIdField = document.getElementById('role-id');
const roleNameField = document.getElementById('role-name');
const roleDescField = document.getElementById('role-description');

function openModal() { modal.style.display = 'block'; modalStatus.textContent = ''; }
function closeModal() { modal.style.display = 'none'; }
closeModalBtn.onclick = closeModal;
window.onclick = (event) => { if (event.target == modal) closeModal(); }

// --- Hauptlogik (CRUD für Rollen) ---
async function loadRoles() {
    try {
        const roles = await apiFetch('/api/roles');
        roleTableBody.innerHTML = '';
        roles.forEach(role => {
            const row = document.createElement('tr');

            // Hinzugefügt: Rolle 'Besucher' ist jetzt eine geschützte Basis-Rolle.
            const isProtected = (role.name === 'admin' || role.name === 'Besucher'); // <<< ANGEPASST
            const buttons = isProtected ?
                `<span style="color: #777;">Basis-Rolle (${role.name})</span>` :
                `<button class="btn-edit" onclick="openEditModal(${role.id}, '${role.name}', '${role.description || ''}')">Bearbeiten</button>
                 <button class="btn-delete" onclick="deleteRole(${role.id})">Löschen</button>`;

            row.innerHTML = `
                <td>${role.id}</td>
                <td>${role.name}</td>
                <td>${role.description || ''}</td>
                <td class="actions">${buttons}</td>
            `;
            roleTableBody.appendChild(row);
        });
    } catch (error) {
        alert('Fehler beim Laden der Rollen: ' + error.message);
    }
}

// Modal für "Neue Rolle"
addRoleBtn.onclick = () => {
    modalTitle.textContent = 'Neue Rolle erstellen';
    roleIdField.value = '';
    roleNameField.value = '';
    roleDescField.value = '';
    openModal();
};

// Modal für "Bearbeiten"
function openEditModal(id, name, description) {
    modalTitle.textContent = 'Rolle bearbeiten';
    roleIdField.value = id;
    roleNameField.value = name;
    roleDescField.value = description || '';
    openModal();
}

// Speichern (Neue Rolle oder Update)
saveRoleBtn.onclick = async () => {
    const id = roleIdField.value;
    const payload = {
        name: roleNameField.value,
        description: roleDescField.value
    };

    if (!payload.name) {
        modalStatus.textContent = "Rollenname ist erforderlich.";
        return;
    }

    try {
        if (id) { // UPDATE
            await apiFetch(`/api/roles/${id}`, 'PUT', payload);
        } else { // CREATE
            await apiFetch('/api/roles', 'POST', payload);
        }
        closeModal();
        loadRoles();
    } catch (error) {
        modalStatus.textContent = 'Fehler: ' + error.message;
    }
};

// Löschen
async function deleteRole(id) {
    if (confirm('Sind Sie sicher, dass Sie diese Rolle löschen möchten?\n\n(Dies ist nur möglich, wenn kein Benutzer diese Rolle mehr verwendet.)')) {
        try {
            await apiFetch(`/api/roles/${id}`, 'DELETE');
            loadRoles();
        } catch (error) {
            alert('Löschen fehlgeschlagen: ' + error.message);
        }
    }
}

// --- Initialisierung ---
// (Führe loadRoles nur aus, wenn der Admin-Check oben erfolgreich war)
if (isAdmin) {
    loadRoles();
}