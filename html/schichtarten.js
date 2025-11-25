// --- Globales Setup ---
const API_URL = 'http://46.224.63.203:5000';
let user;
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

    isAdmin = user.role.name === 'admin';
    const isVisitor = user.role.name === 'Besucher';
    const isUser = user.role.name === 'user';
    // --- START: NEU ---
    const isPlanschreiber = user.role.name === 'Planschreiber';
    const isHundefuehrer = user.role.name === 'Hundeführer';
    // --- ENDE: NEU ---


    // KORRIGIERTE LOGIK: Dashboard ist für alle NICHT-Besucher sichtbar
    document.getElementById('nav-dashboard').style.display = isVisitor ? 'none' : 'block';

    // --- NEU: Admin-Links (Users & Feedback) ---
    // --- START: ANPASSUNG (Alle Rollen) ---
    if (isAdmin) {
        document.getElementById('nav-users').style.display = 'block';
        document.getElementById('nav-feedback').style.display = 'inline-flex';
    } else if (isPlanschreiber) {
        document.getElementById('nav-users').style.display = 'none';
        document.getElementById('nav-feedback').style.display = 'inline-flex';
    } else {
        document.getElementById('nav-users').style.display = 'none';
        document.getElementById('nav-feedback').style.display = 'none';
    }
    // --- ENDE: ANPASSUNG ---
    // --- ENDE NEU ---

    // --- START: ANPASSUNG (Blockiert alle außer Admin) ---
    if (isVisitor || isUser || isPlanschreiber || isHundefuehrer) {
    // --- ENDE: ANPASSUNG ---
        document.getElementById('content-wrapper').innerHTML = `
            <div class="restricted-view">
                <h2 style="color: #e74c3c;">Zugriff verweigert</h2>
                <p>Sie benötigen Admin-Rechte, um Schichtarten zu verwalten.</p>
                <p>Bitte nutzen Sie den Link zum <a href="schichtplan.html" style="color: #3498db;">Schichtplan</a>.</p>
            </div>
        `;
        document.getElementById('settings-dropbtn').style.display = 'none';
         throw new Error("Keine Admin-Rechte für Schichtarten-Verwaltung.");
    }

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

// --- Elemente & Modal-Logik (Angepasst) ---
const typeTableBody = document.getElementById('type-table-body');
const modal = document.getElementById('type-modal');
const modalTitle = document.getElementById('modal-title');
const modalStatus = document.getElementById('modal-status');
const addTypeBtn = document.getElementById('add-type-btn');
const saveTypeBtn = document.getElementById('save-type-btn');
const closeModalBtn = document.getElementById('close-type-modal');

const typeIdField = document.getElementById('type-id');
const typeNameField = document.getElementById('type-name');
const typeAbbreviationField = document.getElementById('type-abbreviation');
const typeColorField = document.getElementById('type-color');
const typeHoursField = document.getElementById('type-hours');
const typeHoursSpilloverField = document.getElementById('type-hours-spillover');
const typeIsWorkShiftField = document.getElementById('type-is-work-shift');
const typeStartTimeField = document.getElementById('type-start-time');
const typeEndTimeField = document.getElementById('type-end-time');
const typePrioritizeBackgroundField = document.getElementById('type-prioritize-background');

// --- NEUE FELDER ---
const typeMinStaffMo = document.getElementById('type-min-staff-mo');
const typeMinStaffDi = document.getElementById('type-min-staff-di');
const typeMinStaffMi = document.getElementById('type-min-staff-mi');
const typeMinStaffDo = document.getElementById('type-min-staff-do');
const typeMinStaffFr = document.getElementById('type-min-staff-fr');
const typeMinStaffSa = document.getElementById('type-min-staff-sa');
const typeMinStaffSo = document.getElementById('type-min-staff-so');
const typeMinStaffHoliday = document.getElementById('type-min-staff-holiday');
// --- ENDE NEU ---


function openModal() { modal.style.display = 'block'; modalStatus.textContent = ''; }
function closeModal() { modal.style.display = 'none'; }
closeModalBtn.onclick = closeModal;
window.onclick = (event) => { if (event.target == modal) closeModal(); }

// --- Hauptlogik (CRUD für Schichtarten) ---
async function loadShiftTypes() {
    try {
        const types = await apiFetch('/api/shifttypes');
        typeTableBody.innerHTML = '';
        types.forEach(st => {
            const row = document.createElement('tr');
            const isWorkShiftText = st.is_work_shift ? 'Ja' : 'Nein';
            const prioritizeBgText = st.prioritize_background ? 'Ja' : 'Nein';
            const colorPreview = `<div style="width: 20px; height: 20px; background-color: ${st.color}; border: 1px solid #555; display: inline-block; vertical-align: middle; margin-right: 5px;"></div> ${st.color}`;
            const stJsonString = JSON.stringify(st).replace(/'/g, "\\'");
            const hours = (st.hours || 0.0).toFixed(1);
            const spillover = (st.hours_spillover || 0.0).toFixed(1);
            const startTime = st.start_time || '---';
            const endTime = st.end_time || '---';

            row.innerHTML = `
                <td>${st.id}</td>
                <td>${st.name}</td>
                <td><b>${st.abbreviation}</b></td>
                <td style="font-family: monospace;">${colorPreview}</td>
                <td>${hours}</td>
                <td>${spillover}</td>
                <td>${startTime}</td>
                <td>${endTime}</td>
                <td>${isWorkShiftText}</td>
                <td>${prioritizeBgText}</td>
                <td class="actions">
                    <button class="btn-edit" onclick='openEditModal(${stJsonString})'>Bearbeiten</button>
                    <button class="btn-delete" onclick="deleteShiftType(${st.id})">Löschen</button>
                </td>
            `;
            typeTableBody.appendChild(row);
        });
    } catch (error) {
        alert('Fehler beim Laden der Schichtarten: ' + error.message);
    }
}

// Modal für "Neue Schichtart" (Felder zurücksetzen)
addTypeBtn.onclick = () => {
    modalTitle.textContent = 'Neue Schichtart erstellen';
    typeIdField.value = '';
    typeNameField.value = '';
    typeAbbreviationField.value = '';
    typeColorField.value = '#FFFFFF';
    typeHoursField.value = '0.0';
    typeHoursSpilloverField.value = '0.0';
    typeIsWorkShiftField.checked = false;
    typeStartTimeField.value = '';
    typeEndTimeField.value = '';
    typePrioritizeBackgroundField.checked = false;
    // --- NEU ---
    typeMinStaffMo.value = 0;
    typeMinStaffDi.value = 0;
    typeMinStaffMi.value = 0;
    typeMinStaffDo.value = 0;
    typeMinStaffFr.value = 0;
    typeMinStaffSa.value = 0;
    typeMinStaffSo.value = 0;
    typeMinStaffHoliday.value = 0;
    // --- ENDE NEU ---
    openModal();
};

// Modal für "Bearbeiten" (Angepasst mit Korrektur)
function openEditModal(st) {
    modalTitle.textContent = 'Schichtart bearbeiten';
    typeIdField.value = st.id;
    typeNameField.value = st.name;
    typeAbbreviationField.value = st.abbreviation;
    typeColorField.value = st.color;
    typeHoursField.value = st.hours || 0.0;
    typeHoursSpilloverField.value = st.hours_spillover || 0.0;
    typeIsWorkShiftField.checked = st.is_work_shift;
    typeStartTimeField.value = st.start_time || '';
    typeEndTimeField.value = st.end_time || '';
    typePrioritizeBackgroundField.checked = st.prioritize_background;
    // --- NEU ---
    typeMinStaffMo.value = st.min_staff_mo || 0;
    typeMinStaffDi.value = st.min_staff_di || 0;
    typeMinStaffMi.value = st.min_staff_mi || 0;
    typeMinStaffDo.value = st.min_staff_do || 0;
    typeMinStaffFr.value = st.min_staff_fr || 0;
    typeMinStaffSa.value = st.min_staff_sa || 0;
    typeMinStaffSo.value = st.min_staff_so || 0;
    typeMinStaffHoliday.value = st.min_staff_holiday || 0;
    // --- ENDE NEU ---
    openModal();
}

// Speichern (Neue Schichtart oder Update) (Angepasst)
saveTypeBtn.onclick = async () => {
    const id = typeIdField.value;
    const payload = {
        name: typeNameField.value,
        abbreviation: typeAbbreviationField.value,
        color: typeColorField.value,
        hours: parseFloat(typeHoursField.value) || 0.0,
        hours_spillover: parseFloat(typeHoursSpilloverField.value) || 0.0,
        is_work_shift: typeIsWorkShiftField.checked,
        start_time: typeStartTimeField.value || null,
        end_time: typeEndTimeField.value || null,
        prioritize_background: typePrioritizeBackgroundField.checked,
        // --- NEU ---
        min_staff_mo: parseInt(typeMinStaffMo.value) || 0,
        min_staff_di: parseInt(typeMinStaffDi.value) || 0,
        min_staff_mi: parseInt(typeMinStaffMi.value) || 0,
        min_staff_do: parseInt(typeMinStaffDo.value) || 0,
        min_staff_fr: parseInt(typeMinStaffFr.value) || 0,
        min_staff_sa: parseInt(typeMinStaffSa.value) || 0,
        min_staff_so: parseInt(typeMinStaffSo.value) || 0,
        min_staff_holiday: parseInt(typeMinStaffHoliday.value) || 0
        // --- ENDE NEU ---
    };

    if (!payload.name || !payload.abbreviation) {
        modalStatus.textContent = "Name und Abkürzung sind erforderlich.";
        return;
    }

    try {
        if (id) { // UPDATE
            await apiFetch(`/api/shifttypes/${id}`, 'PUT', payload);
        } else { // CREATE
            await apiFetch('/api/shifttypes', 'POST', payload);
        }
        closeModal();
        loadShiftTypes();
    } catch (error) {
        modalStatus.textContent = 'Fehler: ' + error.message;
    }
};

// Löschen (Unverändert)
async function deleteShiftType(id) {
    if (confirm('Sind Sie sicher, dass Sie diese Schichtart löschen möchten?\n\n(Dies ist nur möglich, wenn keine Schicht diese Art mehr verwendet.)')) {
        try {
            await apiFetch(`/api/shifttypes/${id}`, 'DELETE');
            loadShiftTypes();
        } catch (error) {
            alert('Löschen fehlgeschlagen: ' + error.message);
        }
    }
}

// --- Initialisierung ---
if (isAdmin) {
     loadShiftTypes();
}