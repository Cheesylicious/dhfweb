// js/pages/users.js

// --- IMPORTE (Regel 4: Wiederverwendung) ---
import { apiFetch } from '../utils/api.js';
import { initAuthCheck } from '../utils/auth.js';

// --- Globales Setup (Seiten-spezifisch) ---
let user;
let allRoles = [];
let isAdmin = false; // Wird durch initAuthCheck gesetzt

// --- 1. Authentifizierung & Zugriffsschutz ---
try {
    // Ruft die zentrale Auth-Prüfung auf (Regel 4).
    // Diese Funktion kümmert sich um:
    // 1. User-Prüfung (localStorage)
    // 2. Rollen-Zuweisung (isAdmin, etc.)
    // 3. Navigations-Anpassung (Links ein/ausblenden)
    // 4. Logout-Button-Listener
    // 5. Auto-Logout-Timer
    const authData = initAuthCheck();
    user = authData.user;
    isAdmin = authData.isAdmin; // Setzt die globale 'isAdmin' Variable für diese Datei

    // --- START: Seiten-spezifischer Zugriffsschutz (aus Original übernommen) ---
    // (Planschreiber und Hundeführer werden jetzt hier auch abgefangen)
    if (!isAdmin) {
        // Nur Admins sehen die Benutzerverwaltung.
        const navShiftplan = document.getElementById('nav-shiftplan');
        if (navShiftplan) navShiftplan.classList.remove('active');

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
        throw new Error("Nicht-Admin darf Benutzerverwaltung nicht sehen.");
    }
    // --- ENDE: Seiten-spezifischer Zugriffsschutz ---

} catch (e) {
    // Auth-Fehler (entweder von initAuthCheck oder dem Block oben)
    console.error("Initialisierung von users.js gestoppt:", e.message);
    // Stoppt die weitere Ausführung des Skripts
    throw e;
}

// (Die redundanten logout() und apiFetch() Funktionen wurden entfernt)

// --- 2. DOM-Elemente (Seiten-spezifisch) ---
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
const forcePwResetBtn = document.getElementById('force-pw-reset-btn');
const columnModal = document.getElementById('column-modal');
const toggleColumnsBtn = document.getElementById('toggle-columns-btn');
const saveColumnToggleBtn = document.getElementById('save-column-toggle');
const columnCheckboxes = document.querySelectorAll('.col-toggle-cb');

// --- 3. Hilfsfunktionen (Seiten-spezifisch) ---

function openModal(modalEl) {
    modalEl.style.display = 'block';
}
function closeModal(modalEl) {
    modalEl.style.display = 'none';
}
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

// --- 4. Hauptlogik (Daten laden & Aktionen) ---

async function loadRolesIntoDropdown(selectedRoleId = null) {
    try {
        if (allRoles.length === 0) {
            // Nutzt die importierte apiFetch
            allRoles = await apiFetch('/api/roles');
        }
        roleField.innerHTML = '';
        allRoles.forEach(role => {
            // isAdmin-Variable kommt aus dem Auth-Check
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
        modalStatus.textContent = "Fehler beim Laden der Rollen: " + error.message;
    }
}
async function loadUsers() {
    try {
        // Nutzt die importierte apiFetch
        const users = await apiFetch('/api/users');
        userTableBody.innerHTML = '';
        users.forEach(u => {
            const row = document.createElement('tr');
            const roleName = u.role ? u.role.name : 'Keine Rolle';
            // WICHTIG: window.openEditModal, da es inline im HTML aufgerufen wird
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
                    <button class="btn-edit" data-userjson='${userJsonString}'>Bearbeiten</button>
                    <button class="btn-delete" data-userid="${u.id}">Löschen</button>
                </td>
            `;
            userTableBody.appendChild(row);
        });
        applyColumnPreferences();
    } catch (error) {
        alert('Fehler beim Laden der Benutzer: ' + error.message);
    }
}

// Event Delegation für Bearbeiten und Löschen (Regel 2: Effizienter)
userTableBody.addEventListener('click', (e) => {
    if (e.target.classList.contains('btn-edit')) {
        const userData = JSON.parse(e.target.dataset.userjson);
        openEditModal(userData);
    }
    if (e.target.classList.contains('btn-delete')) {
        const userId = e.target.dataset.userid;
        deleteUser(userId);
    }
});

addUserBtn.onclick = async () => {
    modalTitle.textContent = 'Neuen Benutzer erstellen';
    modalStatus.textContent = '';
    userIdField.value = '';
    vornameField.value = '';
    nameField.value = '';
    passwortField.value = ''; // (Feld leeren)
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

    const systemTabButton = document.querySelector('.modal-tabs button[onclick*="tab-system"]');
    if (systemTabButton) systemTabButton.style.display = 'none';

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

    const systemTabButton = document.querySelector('.modal-tabs button[onclick*="tab-system"]');
    if (systemTabButton) systemTabButton.style.display = 'block';

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
            // Nutzt die importierte apiFetch
            await apiFetch(`/api/users/${id}`, 'PUT', payload);
        } else {
            if (!payload.passwort) {
                modalStatus.textContent = "Passwort ist für neue User erforderlich.";
                openTab(null, 'tab-stammdaten');
                return;
            }
            // Nutzt die importierte apiFetch
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
            // Nutzt die importierte apiFetch
            await apiFetch(`/api/users/${id}`, 'DELETE');
            loadUsers();
        } catch (error) {
            alert('Löschen fehlgeschlagen: ' + error.message);
        }
    }
}

if (forcePwResetBtn) {
    forcePwResetBtn.onclick = async () => {
        const id = userIdField.value;
        if (!id) {
            modalStatus.textContent = "Fehler: Benutzer-ID nicht gefunden.";
            modalStatus.style.color = '#e74c3c';
            return;
        }
        if (confirm('Sind Sie sicher, dass Sie diesen Benutzer zwingen möchten, sein Passwort beim nächsten Login zu ändern?')) {
            const originalStatus = modalStatus.textContent;
            const originalColor = modalStatus.style.color;
            modalStatus.textContent = 'Setze Flag...';
            modalStatus.style.color = '#bdc3c7';
            try {
                // Nutzt die importierte apiFetch
                const response = await apiFetch(`/api/users/${id}/force_password_reset`, 'POST');
                modalStatus.textContent = response.message || 'Erfolgreich erzwungen!';
                modalStatus.style.color = '#2ecc71';
            } catch (error) {
                modalStatus.textContent = 'Fehler: ' + error.message;
                modalStatus.style.color = '#e74c3c';
            }
            setTimeout(() => {
                if (modalStatus.textContent !== 'Speichere...') {
                    modalStatus.textContent = originalStatus;
                    modalStatus.style.color = originalColor;
                }
            }, 3000);
        }
    };
}

// --- 5. Initialisierung ---
// (Der Auth-Check oben hat bereits sichergestellt, dass wir Admin sind)
loadUsers();
applyColumnPreferences();