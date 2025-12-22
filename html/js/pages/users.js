// js/pages/users.js

// --- IMPORTE ---
import { apiFetch } from '../utils/api.js';
import { initAuthCheck } from '../utils/auth.js';

// --- Globales Setup ---
let user;
let allRoles = [];
let isAdmin = false;

// --- 1. Authentifizierung & Zugriffsschutz ---
try {
    const authData = initAuthCheck();
    user = authData.user;
    isAdmin = authData.isAdmin;

    // Zugriffsschutz für Nicht-Admins
    if (!isAdmin) {
        const navShiftplan = document.getElementById('nav-shiftplan');
        if (navShiftplan) navShiftplan.classList.remove('active');

        const wrapper = document.getElementById('content-wrapper');
        if (wrapper) {
            wrapper.innerHTML = `
                <div class="restricted-view">
                    <h2>Zugriff verweigert</h2>
                    <p>Sie haben keinen Zugriff auf die Benutzerverwaltung.</p>
                    <p>Bitte nutzen Sie den Link zum <a href="schichtplan.html" style="color: #3498db;">Schichtplan</a>.</p>
                </div>
            `;
        }
        const subNavUsers = document.getElementById('sub-nav-users');
        if (subNavUsers) subNavUsers.style.display = 'none';

        // Stoppt die weitere Ausführung, damit keine API-Calls gemacht werden
        throw new Error("Nicht-Admin darf Benutzerverwaltung nicht sehen.");
    }

} catch (e) {
    console.error("Initialisierung von users.js gestoppt:", e.message);
    // Skript hier beenden, wenn Auth fehlschlägt oder Rechte fehlen
}

// --- 2. DOM-Elemente ---
const userTableBody = document.getElementById('user-table-body');
const modal = document.getElementById('user-modal');
const modalTitle = document.getElementById('modal-title');
const modalStatus = document.getElementById('modal-status');
const addUserBtn = document.getElementById('add-user-btn');
const saveUserBtn = document.getElementById('save-user-btn');
const closeModalBtn = document.getElementById('close-user-modal');

// Formular Felder
const userIdField = document.getElementById('user-id');
const vornameField = document.getElementById('user-vorname');
const nameField = document.getElementById('user-name');
const emailField = document.getElementById('user-email');
const passwortField = document.getElementById('user-passwort');
const roleField = document.getElementById('user-role');
const geburtstagField = document.getElementById('user-geburtstag');
const telefonField = document.getElementById('user-telefon');
const eintrittsdatumField = document.getElementById('user-eintrittsdatum');
const aktivAbField = document.getElementById('user-aktiv-ab');
const inaktivAbField = document.getElementById('user-inaktiv-ab');
const canSeeStatsField = document.getElementById('user-can-see-stats');
const urlaubGesamtField = document.getElementById('user-urlaub-gesamt');
const urlaubRestField = document.getElementById('user-urlaub-rest');
const diensthundField = document.getElementById('user-diensthund');
const tutorialField = document.getElementById('user-tutorial');
const passGeaendertField = document.getElementById('user-pass-geaendert');
const zuletztOnlineField = document.getElementById('user-zuletzt-online');
const forcePwResetBtn = document.getElementById('force-pw-reset-btn');

// NEU: Checkbox für manuelle Hundeführer-Zuweisung
const isManualDogHandlerField = document.getElementById('user-is-manual-dog-handler');

// Container für dynamische Sichtbarkeit (Limits Bereich)
const limitsWrapper = document.getElementById('limits-wrapper');

// Spalten-Konfiguration
const columnModal = document.getElementById('column-modal');
const toggleColumnsBtn = document.getElementById('toggle-columns-btn');
const saveColumnToggleBtn = document.getElementById('save-column-toggle');
const columnCheckboxes = document.querySelectorAll('.col-toggle-cb');

// Test-Mail
const sendTestMailBtn = document.getElementById('send-test-mail-btn');

// --- 3. Hilfsfunktionen ---

function openModal(modalEl) {
    if(modalEl) modalEl.style.display = 'block';
}
function closeModal(modalEl) {
    if(modalEl) modalEl.style.display = 'none';
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

// Spalten-Sichtbarkeit
const columnNames = [
    'col-email', 'col-telefon', 'col-eintrittsdatum', 'col-aktiv_ab_datum',
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

if(toggleColumnsBtn) {
    toggleColumnsBtn.onclick = () => openModal(columnModal);
}
if(document.getElementById('close-column-modal')) {
    document.getElementById('close-column-modal').onclick = () => closeModal(columnModal);
}
if(saveColumnToggleBtn) {
    saveColumnToggleBtn.onclick = () => {
        columnCheckboxes.forEach(cb => {
            localStorage.setItem(cb.dataset.col, cb.checked);
        });
        applyColumnPreferences();
        closeModal(columnModal);
    };
}

// --- 4. Hauptlogik ---

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
        if(modalStatus) modalStatus.textContent = "Fehler beim Laden der Rollen: " + error.message;
    }
}

// --- LIMITS LADEN (Optimiertes Layout für Grid) ---
async function loadUserLimits(userId) {
    const container = document.getElementById('limits-container');
    if (!container) return;

    container.innerHTML = '<div style="grid-column:1/-1; color:#bdc3c7;">Lade Limits...</div>';

    try {
        const limits = await apiFetch(`/api/users/${userId}/limits`);
        container.innerHTML = '';

        if (limits.length === 0) {
             container.innerHTML = '<div style="grid-column:1/-1; color:#bdc3c7;">Keine Arbeitsschichten definiert.</div>';
             return;
        }

        limits.forEach(limit => {
             // Erstelle eine "Limit Card" für das Grid
             const card = document.createElement('div');
             card.className = 'limit-card'; // Style aus HTML (background, border)

             card.innerHTML = `
                 <label for="limit-${limit.shifttype_id}" style="display:block; margin-bottom:5px; font-size:12px; color:#bdc3c7; font-weight:600;">
                    ${limit.shifttype_abbreviation} (${limit.shifttype_name})
                 </label>
                 <input type="number"
                        id="limit-${limit.shifttype_id}"
                        class="limit-input"
                        data-shifttype-id="${limit.shifttype_id}"
                        value="${limit.monthly_limit}"
                        min="0"
                        style="width:100%; padding:8px; background:rgba(0,0,0,0.3); border:1px solid #555; border-radius:4px; color:#fff;"
                        title="Limit für Wunsch-Anfragen (0 = keine)">
             `;
             container.appendChild(card);
        });

    } catch (error) {
        container.innerHTML = `<span style="color:#e74c3c">Fehler beim Laden: ${error.message}</span>`;
    }
}

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
    // Falls das Element nicht existiert (z.B. falsche Seite oder Auth-Fehler), abbrechen
    if (!userTableBody) return;

    try {
        const users = await apiFetch('/api/users');
        userTableBody.innerHTML = '';
        users.forEach(u => {
            const row = document.createElement('tr');
            const roleName = u.role ? u.role.name : 'Keine Rolle';
            const userJsonString = JSON.stringify(u).replace(/'/g, "\\'");
            const email = u.email || '---';
            const telefon = u.telefon || '---';
            const eintritt = formatDateTime(u.eintrittsdatum, 'date') || '---';
            const aktiv = formatDateTime(u.aktiv_ab_datum, 'date') || '---';

            // --- ÄNDERUNG: Urlaub Rest (Berechnet) anzeigen ---
            // Wenn das Backend vacation_remaining liefert (was es jetzt sollte), nutzen wir das.
            // Falls undefined, ein ? anzeigen.
            const restAnzeige = (u.vacation_remaining !== undefined) ? u.vacation_remaining : '?';
            const urlaub = restAnzeige + ' / ' + u.urlaub_gesamt;

            const hund = u.diensthund || '---';
            const online = formatDateTime(u.zuletzt_online, 'datetime') || 'Nie';

            row.innerHTML = `
                <td>${u.id}</td>
                <td>${u.vorname}</td>
                <td>${u.name}</td>
                <td>${roleName}</td>
                <td class="col-email hidden">${email}</td> <td class="col-telefon hidden">${telefon}</td>
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
        // Fehler nur anzeigen, wenn es nicht am fehlenden Auth liegt (das fängt initAuthCheck ab)
        console.error(error);
        if(userTableBody) {
             userTableBody.innerHTML = `<tr><td colspan="10" style="text-align:center; color: #e74c3c;">Fehler beim Laden: ${error.message}</td></tr>`;
        }
    }
}

if (userTableBody) {
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
}

// "Neuer Benutzer" Button
if (addUserBtn) {
    addUserBtn.onclick = async () => {
        modalTitle.textContent = 'Neuen Benutzer erstellen';
        modalStatus.textContent = '';

        // Felder leeren
        userIdField.value = '';
        vornameField.value = '';
        nameField.value = '';
        emailField.value = '';
        passwortField.value = '';
        passwortField.placeholder = 'Passwort (erforderlich)';
        geburtstagField.value = '';
        telefonField.value = '';
        eintrittsdatumField.value = '';
        aktivAbField.value = '';
        inaktivAbField.value = '';
        urlaubGesamtField.value = 0;

        // --- ÄNDERUNG: Resturlaub bei "Neu" deaktiviert (wird berechnet) ---
        urlaubRestField.value = 0;
        urlaubRestField.disabled = true; // Neu angelegte User haben per Definition noch keine verbrauchten Tage

        diensthundField.value = '';
        tutorialField.checked = false;
        canSeeStatsField.checked = false;

        // NEU: Hundeführer Checkbox Reset
        if (isManualDogHandlerField) isManualDogHandlerField.checked = false;

        // Read-Only Infos leeren
        passGeaendertField.value = 'Wird autom. gesetzt';
        zuletztOnlineField.value = 'Nie';

        // UI Anpassungen für "Neu"
        if(limitsWrapper) limitsWrapper.style.display = 'none'; // Limits erst nach Erstellung
        if(forcePwResetBtn) forcePwResetBtn.style.display = 'none'; // Kein Reset ohne ID

        await loadRolesIntoDropdown();
        openModal(modal);
    };
}

// "Bearbeiten" Button Logik
async function openEditModal(user) {
    modalTitle.textContent = 'Benutzer bearbeiten';
    modalStatus.textContent = '';

    // Felder füllen
    userIdField.value = user.id;
    vornameField.value = user.vorname;
    nameField.value = user.name;
    emailField.value = user.email || '';
    passwortField.value = '';
    passwortField.placeholder = 'Leer lassen für "keine Änderung"';
    geburtstagField.value = formatDateTime(user.geburtstag, 'date');
    telefonField.value = user.telefon || '';
    eintrittsdatumField.value = formatDateTime(user.eintrittsdatum, 'date');
    aktivAbField.value = formatDateTime(user.aktiv_ab_datum, 'date');
    inaktivAbField.value = formatDateTime(user.inaktiv_ab_datum, 'date');
    urlaubGesamtField.value = user.urlaub_gesamt || 0;

    // --- ÄNDERUNG: Urlaub Rest zeigt jetzt den berechneten Wert und ist READONLY ---
    // Wenn 'vacation_remaining' vom Backend kommt, nutzen wir das. Sonst den DB-Wert 'urlaub_rest' als Fallback oder 0.
    urlaubRestField.value = (user.vacation_remaining !== undefined) ? user.vacation_remaining : (user.urlaub_rest || 0);
    urlaubRestField.disabled = true; // Schreibschutz
    urlaubRestField.title = "Dieser Wert wird automatisch berechnet: (Gesamt + Übertrag) - Verbraucht.";

    diensthundField.value = user.diensthund || '';
    tutorialField.checked = user.tutorial_gesehen;
    canSeeStatsField.checked = user.can_see_statistics === true;

    // NEU: Hundeführer Checkbox laden
    if (isManualDogHandlerField) {
        isManualDogHandlerField.checked = user.is_manual_dog_handler === true;
    }

    passGeaendertField.value = formatDateTime(user.password_geaendert, 'datetime') || 'Unbekannt';
    zuletztOnlineField.value = formatDateTime(user.zuletzt_online, 'datetime') || 'Nie';

    // UI Anpassungen für "Edit"
    if(limitsWrapper) {
        limitsWrapper.style.display = 'block';
        // Wir setzen hier einen Timeout, um sicherzugehen, dass das Modal gerendert ist
        setTimeout(() => loadUserLimits(user.id), 50);
    }
    if(forcePwResetBtn) forcePwResetBtn.style.display = 'inline-block';

    await loadRolesIntoDropdown(user.role_id);
    openModal(modal);
}

if (saveUserBtn) {
    saveUserBtn.onclick = async () => {
        const id = userIdField.value;
        const payload = {
            vorname: vornameField.value,
            name: nameField.value,
            email: emailField.value || null,
            role_id: parseInt(roleField.value),
            passwort: passwortField.value || null,
            geburtstag: geburtstagField.value || null,
            telefon: telefonField.value || null,
            eintrittsdatum: eintrittsdatumField.value || null,
            aktiv_ab_datum: aktivAbField.value || null,
            inaktiv_ab_datum: inaktivAbField.value || null,
            urlaub_gesamt: parseInt(urlaubGesamtField.value) || 0,

            // --- ÄNDERUNG: urlaub_rest NICHT mehr senden, da Read-Only ---
            // urlaub_rest: parseInt(urlaubRestField.value) || 0,

            diensthund: diensthundField.value || null,
            tutorial_gesehen: tutorialField.checked,
            can_see_statistics: canSeeStatsField.checked,
            // NEU: Manuelles Hundeführer-Flag senden
            is_manual_dog_handler: isManualDogHandlerField ? isManualDogHandlerField.checked : false
        };

        if (!payload.passwort) delete payload.passwort;

        saveUserBtn.disabled = true;
        modalStatus.textContent = 'Speichere...';

        try {
            let savedUser = null;

            if (id) {
                // UPDATE
                savedUser = await apiFetch(`/api/users/${id}`, 'PUT', payload);

                // --- HACK: Damit das Flag sicher gespeichert wird, rufen wir den spezifischen Endpoint auf,
                // falls die normale User-Route das Feld nicht verarbeitet.
                if (payload.is_manual_dog_handler !== undefined) {
                     try {
                         await apiFetch(`/api/dog_handlers/${id}`, 'PUT', {
                             is_manual_dog_handler: payload.is_manual_dog_handler
                         });
                     } catch(ignore) {
                         console.warn("Konnte Hundeführer-Status nicht separat speichern (vielleicht Route nicht aktiv?)", ignore);
                     }
                }

                // Limits nur speichern, wenn sichtbar (also im Edit Mode)
                if (limitsWrapper && limitsWrapper.style.display !== 'none') {
                     await saveUserLimits(id);
                }
            } else {
                // CREATE
                if (!payload.passwort) {
                    modalStatus.textContent = "Passwort ist für neue User erforderlich.";
                    saveUserBtn.disabled = false;
                    return;
                }
                savedUser = await apiFetch('/api/users', 'POST', payload);

                // Bei Create müssen wir evtl. auch das Flag setzen (ID wird von Response benötigt)
                if (savedUser && savedUser.id && payload.is_manual_dog_handler) {
                    try {
                        await apiFetch(`/api/dog_handlers/${savedUser.id}`, 'PUT', {
                            is_manual_dog_handler: true
                        });
                    } catch(ignore) {}
                }
            }

            closeModal(modal);
            loadUsers();
        } catch (error) {
            modalStatus.textContent = 'Fehler: ' + error.message;
        } finally {
            saveUserBtn.disabled = false;
        }
    };
}

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
        if (!id) return;

        if (confirm('Benutzer zwingen, beim nächsten Login das Passwort zu ändern?')) {
            const originalText = forcePwResetBtn.textContent;
            forcePwResetBtn.textContent = '...';
            forcePwResetBtn.disabled = true;

            try {
                await apiFetch(`/api/users/${id}/force_password_reset`, 'POST');
                alert('Flag erfolgreich gesetzt.');
            } catch (error) {
                alert('Fehler: ' + error.message);
            } finally {
                forcePwResetBtn.textContent = originalText;
                forcePwResetBtn.disabled = false;
            }
        }
    };
}

// --- NEU: Event Listener für den Test-Mail Button ---
if (sendTestMailBtn) {
    sendTestMailBtn.onclick = async () => {
        if (!confirm("Test-E-Mail an ALLE Benutzer mit E-Mail-Adresse senden?")) {
            return;
        }

        sendTestMailBtn.disabled = true;
        sendTestMailBtn.textContent = "Sende...";

        try {
            const response = await apiFetch('/api/send_test_broadcast', 'POST');
            alert(response.message);
        } catch (error) {
            alert("Fehler beim Senden: " + error.message);
        } finally {
            sendTestMailBtn.disabled = false;
            sendTestMailBtn.textContent = "📧 Test-Mail an Alle";
        }
    };
}

// --- Init ---
if (closeModalBtn) closeModalBtn.onclick = () => closeModal(modal);
window.addEventListener('click', (event) => {
    if (event.target == modal) closeModal(modal);
    if (event.target == columnModal) closeModal(columnModal);
});

// Start (Nur wenn Admin)
if (isAdmin) {
    loadUsers();
    applyColumnPreferences();
}