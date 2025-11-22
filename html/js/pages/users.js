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
    const authData = initAuthCheck();
    user = authData.user;
    isAdmin = authData.isAdmin; // Setzt die globale 'isAdmin' Variable für diese Datei

    // --- START: Seiten-spezifischer Zugriffsschutz (aus Original übernommen) ---
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
        // (Sicherstellen, dass das Sub-Nav-Element existiert, bevor darauf zugegriffen wird)
        const subNavUsers = document.getElementById('sub-nav-users');
        if (subNavUsers) subNavUsers.style.display = 'none';

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

// --- START NEU: Inaktiv-Datum ---
const inaktivAbField = document.getElementById('user-inaktiv-ab');
// --- ENDE NEU ---

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
const modalTabsContainer = document.getElementById('user-modal-tabs');

// --- 3. Hilfsfunktionen (Seiten-spezifisch) ---

function openModal(modalEl) {
    modalEl.style.display = 'block';
}
function closeModal(modalEl) {
    modalEl.style.display = 'none';
}

/**
 * Öffnet den angeklickten Tab im Modal.
 */
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

    const tabElement = document.getElementById(tabName);
    if (tabElement) {
        tabElement.style.display = "block";
    }

    // Wenn durch Klick ausgelöst, setze den Button aktiv
    if (evt) {
        evt.currentTarget.className += " active";
    } else {
        // Wenn manuell ausgelöst (beim Öffnen), setze den ersten Tab aktiv
        const firstTab = modalTabsContainer.querySelector('button[data-tab="tab-stammdaten"]');
        if (firstTab) {
            firstTab.className += " active";
        }
    }
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
            allRoles = await apiFetch('/api/roles');
        }
        roleField.innerHTML = '';
        allRoles.forEach(role => {
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

// --- NEUE FUNKTION: LIMITS LADEN ---
async function loadUserLimits(userId) {
    const container = document.getElementById('limits-container');
    container.innerHTML = 'Lade Limits...';

    try {
        const limits = await apiFetch(`/api/users/${userId}/limits`);
        container.innerHTML = '';

        if (limits.length === 0) {
             container.innerHTML = 'Keine Arbeitsschichten definiert.';
             return;
        }

        limits.forEach(limit => {
             const formGroup = document.createElement('div');
             formGroup.className = 'form-group';

             // Erstelle Label und Input
             formGroup.innerHTML = `
                 <label for="limit-${limit.shifttype_id}">
                    ${limit.shifttype_abbreviation} (${limit.shifttype_name}):
                 </label>
                 <input type="number"
                        id="limit-${limit.shifttype_id}"
                        class="limit-input"
                        data-shifttype-id="${limit.shifttype_id}"
                        value="${limit.monthly_limit}"
                        min="0"
                        title="Anzahl der erlaubten Wunsch-Anfragen pro Monat (0 = keine)">
             `;
             container.appendChild(formGroup);
        });

    } catch (error) {
        container.innerHTML = `<span style="color:red">Fehler beim Laden der Limits: ${error.message}</span>`;
    }
}

// --- NEUE FUNKTION: LIMITS SPEICHERN ---
async function saveUserLimits(userId) {
    const inputs = document.querySelectorAll('.limit-input');
    const payload = [];

    inputs.forEach(input => {
        payload.push({
            shifttype_id: parseInt(input.dataset.shifttypeId),
            monthly_limit: parseInt(input.value) || 0
        });
    });

    if (payload.length > 0) {
        await apiFetch(`/api/users/${userId}/limits`, 'PUT', payload);
    }
}


async function loadUsers() {
    try {
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
    passwortField.value = '';
    passwortField.placeholder = 'Passwort (erforderlich)';
    geburtstagField.value = '';
    telefonField.value = '';
    eintrittsdatumField.value = '';
    aktivAbField.value = '';
    inaktivAbField.value = '';
    urlaubGesamtField.value = 0;
    urlaubRestField.value = 0;
    diensthundField.value = '';
    tutorialField.checked = false;
    passGeaendertField.value = 'Wird autom. gesetzt';
    zuletztOnlineField.value = 'Nie';

    const systemTabButton = document.querySelector('.modal-tabs button[data-tab="tab-system"]');
    if (systemTabButton) systemTabButton.style.display = 'none';

    // --- NEU: Limits-Tab verstecken bei neuem User (da noch keine ID existiert) ---
    const limitsTabButton = document.getElementById('tab-link-limits');
    if (limitsTabButton) limitsTabButton.style.display = 'none';
    // --- ENDE NEU ---

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
    inaktivAbField.value = formatDateTime(user.inaktiv_ab_datum, 'date');
    urlaubGesamtField.value = user.urlaub_gesamt || 0;
    urlaubRestField.value = user.urlaub_rest || 0;
    diensthundField.value = user.diensthund || '';
    tutorialField.checked = user.tutorial_gesehen;
    passGeaendertField.value = formatDateTime(user.password_geaendert, 'datetime') || 'Unbekannt';
    zuletztOnlineField.value = formatDateTime(user.zuletzt_online, 'datetime') || 'Nie';

    const systemTabButton = document.querySelector('.modal-tabs button[data-tab="tab-system"]');
    if (systemTabButton) systemTabButton.style.display = 'block';

    // --- NEU: Limits-Tab anzeigen und laden ---
    const limitsTabButton = document.getElementById('tab-link-limits');
    if (limitsTabButton) {
        limitsTabButton.style.display = 'block';
        await loadUserLimits(user.id); // Limits laden
    }
    // --- ENDE NEU ---

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
        inaktiv_ab_datum: inaktivAbField.value || null,
        urlaub_gesamt: parseInt(urlaubGesamtField.value) || 0,
        urlaub_rest: parseInt(urlaubRestField.value) || 0,
        diensthund: diensthundField.value || null,
        tutorial_gesehen: tutorialField.checked
    };
    if (!payload.passwort) { delete payload.passwort; }

    // Button sperren, um Doppelklicks zu vermeiden
    saveUserBtn.disabled = true;
    modalStatus.textContent = 'Speichere...';

    try {
        if (id) {
            // 1. User speichern
            await apiFetch(`/api/users/${id}`, 'PUT', payload);

            // 2. Limits speichern (nur wenn wir im Edit-Modus sind)
            const limitsTabButton = document.getElementById('tab-link-limits');
            if (limitsTabButton && limitsTabButton.style.display !== 'none') {
                 await saveUserLimits(id);
            }

        } else {
            if (!payload.passwort) {
                modalStatus.textContent = "Passwort ist für neue User erforderlich.";
                openTab(null, 'tab-stammdaten');
                saveUserBtn.disabled = false;
                return;
            }
            await apiFetch('/api/users', 'POST', payload);
            // Limits können erst nach Erstellung (im Edit-Modus) gesetzt werden
        }
        closeModal(modal);
        loadUsers();
    } catch (error) {
        modalStatus.textContent = 'Fehler: ' + error.message;
    } finally {
        saveUserBtn.disabled = false;
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

if (modalTabsContainer) {
    modalTabsContainer.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON' && e.target.dataset.tab) {
            openTab(e, e.target.dataset.tab);
        }
    });
}

closeModalBtn.onclick = () => closeModal(modal);
window.addEventListener('click', (event) => {
    if (event.target == modal) closeModal(modal);
    if (event.target == columnModal) closeModal(columnModal);
});

loadUsers();
applyColumnPreferences();