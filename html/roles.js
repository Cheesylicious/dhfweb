// html/js/pages/roles.js

import { apiFetch } from './js/utils/api.js';
import { initAuthCheck, logout } from './js/utils/auth.js';

// --- Globales Setup ---
let user;
let isAdmin = false;

try {
    const authData = await initAuthCheck();
    user = authData.user;

    // Rollenprüfung
    isAdmin = authData.isAdmin;
    const isVisitor = authData.isVisitor;
    const isPlanschreiber = authData.isPlanschreiber;

    // 1. Haupt-Navigationsanpassung
    const navDashboard = document.getElementById('nav-dashboard');
    const navUsers = document.getElementById('nav-users');
    const navFeedback = document.getElementById('nav-feedback');

    if (isVisitor) {
        navDashboard.style.display = 'none';
    } else {
        navDashboard.style.display = 'block';
    }

    if (isAdmin) {
        navUsers.style.display = 'block';
        navFeedback.style.display = 'inline-flex';
    } else if (isPlanschreiber) {
         navUsers.style.display = 'none';
         navFeedback.style.display = 'inline-flex';
    } else {
         navUsers.style.display = 'none';
         navFeedback.style.display = 'none';
    }

    // Blockiert alle außer Admin
    if (isVisitor || !isAdmin) {
        document.getElementById('content-wrapper').innerHTML = `
            <div class="restricted-view">
                <h2 style="color: #e74c3c;">Zugriff verweigert</h2>
                <p>Sie benötigen Admin-Rechte, um auf die Rollenverwaltung zuzugreifen.</p>
                <p>Bitte nutzen Sie den Link zum <a href="schichtplan.html" style="color: #3498db;">Schichtplan</a>.</p>
            </div>
        `;
         document.getElementById('sub-nav-roles-container').style.display = 'none';
        throw new Error("Keine Admin-Rechte für Rollenverwaltung.");
    }

} catch (e) {
    if (!e.message.includes("Admin-Rechte")) {
         console.error("Rollenverwaltung konnte nicht initialisiert werden:", e);
    }
}

document.getElementById('logout-btn').onclick = logout;

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

            const isProtected = (role.name === 'admin' || role.name === 'Besucher'); 
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

// Modal für "Bearbeiten" (global verfügbar machen für das onclick-Attribut)
window.openEditModal = function(id, name, description) {
    modalTitle.textContent = 'Rolle bearbeiten';
    roleIdField.value = id;
    roleNameField.value = name;
    roleDescField.value = description || '';
    openModal();
};

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

// Löschen (global verfügbar machen für das onclick-Attribut)
window.deleteRole = async function(id) {
    if (confirm('Sind Sie sicher, dass Sie diese Rolle löschen möchten?\n\n(Dies ist nur möglich, wenn kein Benutzer diese Rolle mehr verwendet.)')) {
        try {
            await apiFetch(`/api/roles/${id}`, 'DELETE');
            loadRoles();
        } catch (error) {
            alert('Löschen fehlgeschlagen: ' + error.message);
        }
    }
};

// --- Initialisierung ---
if (isAdmin) {
    loadRoles();
}
