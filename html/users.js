// --- NEU: Globale Variablen für Rollenprüfung ---
let isVisitor = false;
let isAdmin = false;

// (Das gesamte JavaScript bleibt exakt wie von Ihnen gesendet)
const API_URL = 'http://46.224.63.203:5000';
let user;
let allRoles = [];
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
    isVisitor = user.role.name === 'Besucher';

    // 1. Haupt-Navigationsanpassung
    const navDashboard = document.getElementById('nav-dashboard');
    const navUsers = document.getElementById('nav-users');
    const navShiftplan = document.getElementById('nav-shiftplan');
    const subNavRoles = document.getElementById('sub-nav-roles');

    // --- NEU: Feedback-Link ---
    const navFeedback = document.getElementById('nav-feedback');

    // Globale Konsistenz: Verstecke Dashboard für Besucher
    navDashboard.style.display = isVisitor ? 'none' : 'block';

    // --- NEU: Admin-Links anzeigen ---
    if (isAdmin) {
        navUsers.style.display = 'block';
        navFeedback.style.display = 'inline-flex';
    } else {
        navUsers.style.display = 'none';
    }
    // --- ENDE NEU ---

    if (isVisitor || !isAdmin) {
        // Nur Admins sehen die Benutzerverwaltung. Besucher und Standard-User (user) werden geblockt.
        navShiftplan.classList.remove('active');

        // Ersetze Hauptinhalt durch Meldung
        document.getElementById('content-wrapper').innerHTML = `
            <div class="restricted-view">
                <h2>Zugriff verweigert</h2>
                <p>Sie haben keinen Zugriff auf die Benutzerverwaltung.</p>
                <p>Bitte nutzen Sie den Link zum <a href="schichtplan.html" style="color: #3498db;">Schichtplan</a>.</p>
            </div>
        `;
        document.getElementById('sub-nav-users').style.display = 'none';

        // Breche Initialisierung ab
        throw new Error("Besucher/User darf Benutzerverwaltung nicht sehen.");

    } else if (!isAdmin) {
        // Standard-User: Verstecke nur den Rollen-Link im Sub-Nav
        subNavRoles.style.display = 'none';
    }
    // --- ENDE NEUE LOGIK ---

} catch (e) {
    // Wenn der Fehler wegen "Besucher/User" geworfen wurde, nicht ausloggen, nur UI anzeigen
    if (!e.message.includes("Besucher/User")) {
         logout();
    }
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
        // Nur bei fehlender Berechtigung oder Logout ausloggen, NICHT bei 403 (wenn Gast Admin-Route aufruft)
        if (response.status === 401) { logout(); }
        // Da get_users jetzt @login_required ist, sollte dieser Fehler nur bei POST/PUT/DELETE kommen.
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
const userTableBody = document.getElementById('user-table-body');
const modal = document.getElementById('user-modal');
const modalTitle = document.getElementById('modal-title');
const modalStatus = document.getElementById('modal-status');
const addUserBtn = document.getElementById('add-user-btn');
const saveUserBtn = document.getElementById('save-user-btn');
const closeModalBtn = document.getElementById('close-user-modal');
const userIdField = document.getElementById('user-id');
const vornameField = document.getElementById('user-vorname');
const nameField = document.getElementById('user-name');
const passwortField = document.getElementById('user-passwort');
const roleField = document.getElementById('user-role');
const geburtstagField = document.getElementById('user-geburtstag');
const telefonField = document.getElementById('user-telefon');
const eintrittsdatumField = document.getElementById('user-eintrittsdatum');
const aktivAbField = document.getElementById('user-aktiv-ab');
const urlaubGesamtField = document.getElementById('user-urlaub-gesamt');
const urlaubRestField = document.getElementById('user-urlaub-rest');
const diensthundField = document.getElementById('user-diensthund');
const tutorialField = document.getElementById('user-tutorial');
const passGeaendertField = document.getElementById('user-pass-geaendert');
const zuletztOnlineField = document.getElementById('user-zuletzt-online');
function openModal(modalEl) {
    modalEl.style.display = 'block';
}
function closeModal(modalEl) { modalEl.style.display = 'none'; }
closeModalBtn.onclick = () => closeModal(modal);
window.onclick = (event) => {
    if (event.target == modal) closeModal(modal);
    if (event.target == columnModal) closeModal(columnModal);
}
function openTab(evt, tabName) {
    let i, tabcontent, tablinks;
    tabcontent = document.getElementsByClassName("modal-tab-content");
    for (i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
    }
    tablinks = document.getElementsByClassName("tab-link");
    for (i = 0; i < tablinks.length; i++) {
        tablinks[i].className = tablinks[i].className.replace(" active", "");
    }
    document.getElementById(tabName).style.display = "block";
    if (evt) evt.currentTarget.className += " active";
    else tablinks[0].className += " active";
}
function formatDateTime(isoString, type = 'date') {
    if (!isoString) return '';
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    if (type === 'date') {
        return d.toISOString().split('T')[0];
    } else {
        return d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) + ' Uhr';
    }
}
const columnModal = document.getElementById('column-modal');
const toggleColumnsBtn = document.getElementById('toggle-columns-btn');
const saveColumnToggleBtn = document.getElementById('save-column-toggle');
const columnCheckboxes = document.querySelectorAll('.col-toggle-cb');
const columnNames = [
    'col-telefon', 'col-eintrittsdatum', 'col-aktiv_ab_datum',
    'col-urlaub_rest', 'col-diensthund', 'col-zuletzt_online'
];
function applyColumnPreferences() {
    columnNames.forEach(colClass => {
        const isVisible = localStorage.getItem(colClass) === 'true';
        document.querySelectorAll('.' + colClass).forEach(el => {
            if (isVisible) {
                el.classList.remove('hidden');
            } else {
                el.classList.add('hidden');
            }
        });
        const checkbox = document.querySelector(`.col-toggle-cb[data-col="${colClass}"]`);
        if(checkbox) checkbox.checked = isVisible;
    });
}
toggleColumnsBtn.onclick = () => {
    openModal(columnModal);
};
document.getElementById('close-column-modal').onclick = () => closeModal(columnModal);
saveColumnToggleBtn.onclick = () => {
    columnCheckboxes.forEach(cb => {
        localStorage.setItem(cb.dataset.col, cb.checked);
    });
    applyColumnPreferences();
    closeModal(columnModal);
};
async function loadRolesIntoDropdown(selectedRoleId = null) {
    try {
        // loadRoles aus routes_admin ist jetzt @login_required.
        if (allRoles.length === 0) {
            allRoles = await apiFetch('/api/roles');
        }
        roleField.innerHTML = '';
        allRoles.forEach(role => {
            // Verstecke 'Besucher' und 'admin' Rollen im Dropdown für Standard-User
            if (!isAdmin && (role.name === 'Besucher' || role.name === 'admin')) {
                return;
            }
            const option = document.createElement('option');
            option.value = role.id;
            option.textContent = role.name;
            if (role.id === selectedRoleId) {
                option.selected = true;
            }
            roleField.appendChild(option);
        });
    } catch (error) {
        // Bei 403 (wenn Standard-User versucht auf @admin_required /api/roles zuzugreifen)
        // Die Seite wird nicht abgestürzt, da wir uns im Admin-Kontext befinden, aber
        // dieser Call wird fehlschlagen, wenn er von einem Nicht-Admin ausgelöst wird.
        // Da wir die gesamte Seite für Nicht-Admins blockieren, sollte dies nur für Admins funktionieren.
        modalStatus.textContent = "Fehler beim Laden der Rollen: " + error.message;
    }
}
async function loadUsers() {
    try {
        // loadUsers aus routes_admin ist jetzt @login_required, was in diesem Kontext in Ordnung ist.
        const users = await apiFetch('/api/users');
        userTableBody.innerHTML = '';
        users.forEach(u => {
            const row = document.createElement('tr');
            const roleName = u.role ? u.role.name : 'Keine Rolle';
            const userJsonString = JSON.stringify(u).replace(/'/g, "\\'");
            const telefon = u.telefon || '---';
            const eintritt = formatDateTime(u.eintrittsdatum, 'date') || '---';
            const aktiv = formatDateTime(u.aktiv_ab_datum, 'date') || '---';
            const urlaub = u.urlaub_rest + ' / ' + u.urlaub_gesamt;
            const hund = u.diensthund || '---';
            const online = formatDateTime(u.zuletzt_online, 'datetime') || 'Nie';
            row.innerHTML = `
                <td>${u.id}</td>
                <td>${u.vorname}</td>
                <td>${u.name}</td>
                <td>${roleName}</td>
                <td class="col-telefon hidden">${telefon}</td>
                <td class="col-eintrittsdatum hidden">${eintritt}</td>
                <td class="col-aktiv_ab_datum hidden">${aktiv}</td>
                <td class="col-urlaub_rest hidden">${urlaub}</td>
                <td class="col-diensthund hidden">${hund}</td>
                <td class="col-zuletzt_online hidden">${online}</td>
                <td class="actions">
                    <button class="btn-edit" onclick='openEditModal(${userJsonString})'>Bearbeiten</button>
                    <button class="btn-delete" onclick="deleteUser(${u.id})">Löschen</button>
                </td>
            `;
            userTableBody.appendChild(row);
        });
        applyColumnPreferences();
    } catch (error) {
        // Dies wird nur für Admins aufgerufen, falls der API-Call fehlschlägt.
        alert('Fehler beim Laden der Benutzer: ' + error.message);
    }
}
addUserBtn.onclick = async () => {
    modalTitle.textContent = 'Neuen Benutzer erstellen';
    modalStatus.textContent = '';
    userIdField.value = '';
    vornameField.value = '';
    nameField.value = '';
    passwortField.placeholder = 'Passwort (erforderlich)';
    geburtstagField.value = '';
    telefonField.value = '';
    eintrittsdatumField.value = '';
    aktivAbField.value = '';
    urlaubGesamtField.value = 0;
    urlaubRestField.value = 0;
    diensthundField.value = '';
    tutorialField.checked = false;
    passGeaendertField.value = 'Wird autom. gesetzt';
    zuletztOnlineField.value = 'Nie';
    await loadRolesIntoDropdown();
    openModal(modal);
    openTab(null, 'tab-stammdaten');
};
async function openEditModal(user) {
    modalTitle.textContent = 'Benutzer bearbeiten';
    modalStatus.textContent = '';
    userIdField.value = user.id;
    vornameField.value = user.vorname;
    nameField.value = user.name;
    passwortField.value = '';
    passwortField.placeholder = 'Leer lassen für "keine Änderung"';
    geburtstagField.value = formatDateTime(user.geburtstag, 'date');
    telefonField.value = user.telefon || '';
    eintrittsdatumField.value = formatDateTime(user.eintrittsdatum, 'date');
    aktivAbField.value = formatDateTime(user.aktiv_ab_datum, 'date');
    urlaubGesamtField.value = user.urlaub_gesamt || 0;
    urlaubRestField.value = user.urlaub_rest || 0;
    diensthundField.value = user.diensthund || '';
    tutorialField.checked = user.tutorial_gesehen;
    passGeaendertField.value = formatDateTime(user.password_geaendert, 'datetime') || 'Unbekannt';
    zuletztOnlineField.value = formatDateTime(user.zuletzt_online, 'datetime') || 'Nie';
    await loadRolesIntoDropdown(user.role_id);
    openModal(modal);
    openTab(null, 'tab-stammdaten');
}
saveUserBtn.onclick = async () => {
    const id = userIdField.value;
    const payload = {
        vorname: vornameField.value,
        name: nameField.value,
        role_id: parseInt(roleField.value),
        passwort: passwortField.value || null,
        geburtstag: geburtstagField.value || null,
        telefon: telefonField.value || null,
        eintrittsdatum: eintrittsdatumField.value || null,
        aktiv_ab_datum: aktivAbField.value || null,
        urlaub_gesamt: parseInt(urlaubGesamtField.value) || 0,
        urlaub_rest: parseInt(urlaubRestField.value) || 0,
        diensthund: diensthundField.value || null,
        tutorial_gesehen: tutorialField.checked
    };
    if (!payload.passwort) { delete payload.passwort; }
    try {
        if (id) {
            await apiFetch(`/api/users/${id}`, 'PUT', payload);
        } else {
            if (!payload.passwort) {
                modalStatus.textContent = "Passwort ist für neue User erforderlich.";
                openTab(null, 'tab-stammdaten');
                return;
            }
            await apiFetch('/api/users', 'POST', payload);
        }
        closeModal(modal);
        loadUsers();
    } catch (error) {
        modalStatus.textContent = 'Fehler: ' + error.message;
    }
};
async function deleteUser(id) {
    if (confirm('Sind Sie sicher, dass Sie diesen Benutzer löschen möchten?')) {
        try {
            await apiFetch(`/api/users/${id}`, 'DELETE');
            loadUsers();
        } catch (error) {
            alert('Löschen fehlgeschlagen: ' + error.message);
        }
    }
}
// Initialisierung nur, wenn nicht gesperrt
if (isAdmin) {
    loadUsers();
    applyColumnPreferences();
}