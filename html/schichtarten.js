// html/schichtarten.js

// --- NOTFALL CACHE KILLER ---
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(r => r.forEach(reg => reg.unregister()));
    caches.keys().then(k => k.forEach(key => caches.delete(key)));
}

// --- INLINED API FETCH (Umgeht Modul-Import-Abstürze) ---
function logout() {
    localStorage.removeItem('dhf_user');
    window.location.href = 'index.html';
}

async function apiFetch(endpoint, method = 'GET', body = null) {
    const options = {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
    };
    if (body) {
        options.body = JSON.stringify(body);
    }
    const response = await fetch(endpoint, options);
    if (response.status === 401 || response.status === 403) {
        if (response.status === 401) logout();
        throw new Error('Sitzung ungültig oder fehlende Rechte.');
    }
    const contentType = response.headers.get("content-type");
    let data;
    if (contentType && contentType.indexOf("application/json") !== -1) {
        data = await response.json();
    } else {
        data = { message: await response.text() };
    }
    if (!response.ok) throw new Error(data.message || 'API-Fehler');
    return data;
}

// --- Globales Setup ---
let user;
let isAdmin = false;

try {
    user = JSON.parse(localStorage.getItem('dhf_user'));
    if (!user || !user.vorname || !user.role) { throw new Error("Kein User oder fehlende Rolle"); }
    
    const welcomeUserEl = document.getElementById('welcome-user');
    if (welcomeUserEl) welcomeUserEl.textContent = `Willkommen, ${user.vorname}!`;

    isAdmin = user.role.name === 'admin';
    const isVisitor = user.role.name === 'Besucher';
    const isUser = user.role.name === 'user';
    const isPlanschreiber = user.role.name === 'Planschreiber';
    const isHundefuehrer = user.role.name === 'Hundeführer';
    
    const navDashboard = document.getElementById('nav-dashboard');
    if (navDashboard) navDashboard.style.display = isVisitor ? 'none' : 'block';

    const navUsers = document.getElementById('nav-users');
    const navFeedback = document.getElementById('nav-feedback');

    if (isAdmin) {
        if (navUsers) navUsers.style.display = 'block';
        if (navFeedback) navFeedback.style.display = 'inline-flex';
    } else if (isPlanschreiber) {
        if (navUsers) navUsers.style.display = 'none';
        if (navFeedback) navFeedback.style.display = 'inline-flex';
    } else {
        if (navUsers) navUsers.style.display = 'none';
        if (navFeedback) navFeedback.style.display = 'none';
    }
    
    if (isVisitor || isUser || isPlanschreiber || isHundefuehrer) {
        const cw = document.getElementById('content-wrapper');
        if(cw) {
            cw.innerHTML = `
                <div class="restricted-view">
                    <h2 style="color: #e74c3c;">Zugriff verweigert</h2>
                    <p>Sie benötigen Admin-Rechte, um Schichtarten zu verwalten.</p>
                    <p>Bitte nutzen Sie den Link zum <a href="schichtplan.html" style="color: #3498db;">Schichtplan</a>.</p>
                </div>
            `;
        }
        const sd = document.getElementById('settings-dropbtn');
        if(sd) sd.style.display = 'none';
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

const logoutBtn = document.getElementById('logout-btn');
if(logoutBtn) logoutBtn.onclick = logout;

// --- Elemente & Modal-Logik ---
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

// Wird geprüft, ob sie in der HTML existieren
const typeMinStaffMo = document.getElementById('type-min-staff-mo');
const typeMinStaffDi = document.getElementById('type-min-staff-di');
const typeMinStaffMi = document.getElementById('type-min-staff-mi');
const typeMinStaffDo = document.getElementById('type-min-staff-do');
const typeMinStaffFr = document.getElementById('type-min-staff-fr');
const typeMinStaffSa = document.getElementById('type-min-staff-sa');
const typeMinStaffSo = document.getElementById('type-min-staff-so');
const typeMinStaffHoliday = document.getElementById('type-min-staff-holiday');


function openModal() { if(modal) modal.style.display = 'block'; if(modalStatus) modalStatus.textContent = ''; }
function closeModal() { if(modal) modal.style.display = 'none'; }
if(closeModalBtn) closeModalBtn.onclick = closeModal;
window.onclick = (event) => { if (event.target == modal) closeModal(); }

// --- Hauptlogik (CRUD für Schichtarten) ---
async function loadShiftTypes() {
    try {
        const types = await apiFetch('/api/shifttypes');
        if(!typeTableBody) return;
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

if(addTypeBtn) {
    addTypeBtn.onclick = () => {
        if(modalTitle) modalTitle.textContent = 'Neue Schichtart erstellen';
        if(typeIdField) typeIdField.value = '';
        if(typeNameField) typeNameField.value = '';
        if(typeAbbreviationField) typeAbbreviationField.value = '';
        if(typeColorField) typeColorField.value = '#FFFFFF';
        if(typeHoursField) typeHoursField.value = '0.0';
        if(typeHoursSpilloverField) typeHoursSpilloverField.value = '0.0';
        if(typeIsWorkShiftField) typeIsWorkShiftField.checked = false;
        if(typeStartTimeField) typeStartTimeField.value = '';
        if(typeEndTimeField) typeEndTimeField.value = '';
        if(typePrioritizeBackgroundField) typePrioritizeBackgroundField.checked = false;
        
        if(typeMinStaffMo) typeMinStaffMo.value = 0;
        if(typeMinStaffDi) typeMinStaffDi.value = 0;
        if(typeMinStaffMi) typeMinStaffMi.value = 0;
        if(typeMinStaffDo) typeMinStaffDo.value = 0;
        if(typeMinStaffFr) typeMinStaffFr.value = 0;
        if(typeMinStaffSa) typeMinStaffSa.value = 0;
        if(typeMinStaffSo) typeMinStaffSo.value = 0;
        if(typeMinStaffHoliday) typeMinStaffHoliday.value = 0;
        
        openModal();
    };
}

window.openEditModal = function(st) {
    if(modalTitle) modalTitle.textContent = 'Schichtart bearbeiten';
    if(typeIdField) typeIdField.value = st.id;
    if(typeNameField) typeNameField.value = st.name;
    if(typeAbbreviationField) typeAbbreviationField.value = st.abbreviation;
    if(typeColorField) typeColorField.value = st.color;
    if(typeHoursField) typeHoursField.value = st.hours || 0.0;
    if(typeHoursSpilloverField) typeHoursSpilloverField.value = st.hours_spillover || 0.0;
    if(typeIsWorkShiftField) typeIsWorkShiftField.checked = st.is_work_shift;
    if(typeStartTimeField) typeStartTimeField.value = st.start_time || '';
    if(typeEndTimeField) typeEndTimeField.value = st.end_time || '';
    if(typePrioritizeBackgroundField) typePrioritizeBackgroundField.checked = st.prioritize_background;
    
    if(typeMinStaffMo) typeMinStaffMo.value = st.min_staff_mo || 0;
    if(typeMinStaffDi) typeMinStaffDi.value = st.min_staff_di || 0;
    if(typeMinStaffMi) typeMinStaffMi.value = st.min_staff_mi || 0;
    if(typeMinStaffDo) typeMinStaffDo.value = st.min_staff_do || 0;
    if(typeMinStaffFr) typeMinStaffFr.value = st.min_staff_fr || 0;
    if(typeMinStaffSa) typeMinStaffSa.value = st.min_staff_sa || 0;
    if(typeMinStaffSo) typeMinStaffSo.value = st.min_staff_so || 0;
    if(typeMinStaffHoliday) typeMinStaffHoliday.value = st.min_staff_holiday || 0;
    
    openModal();
}

if(saveTypeBtn) {
    saveTypeBtn.onclick = async () => {
        const id = typeIdField ? typeIdField.value : null;
        const payload = {
            name: typeNameField ? typeNameField.value : '',
            abbreviation: typeAbbreviationField ? typeAbbreviationField.value : '',
            color: typeColorField ? typeColorField.value : '#FFFFFF',
            hours: typeHoursField ? parseFloat(typeHoursField.value) || 0.0 : 0.0,
            hours_spillover: typeHoursSpilloverField ? parseFloat(typeHoursSpilloverField.value) || 0.0 : 0.0,
            is_work_shift: typeIsWorkShiftField ? typeIsWorkShiftField.checked : false,
            start_time: typeStartTimeField ? typeStartTimeField.value || null : null,
            end_time: typeEndTimeField ? typeEndTimeField.value || null : null,
            prioritize_background: typePrioritizeBackgroundField ? typePrioritizeBackgroundField.checked : false,
            
            min_staff_mo: typeMinStaffMo ? parseInt(typeMinStaffMo.value) || 0 : 0,
            min_staff_di: typeMinStaffDi ? parseInt(typeMinStaffDi.value) || 0 : 0,
            min_staff_mi: typeMinStaffMi ? parseInt(typeMinStaffMi.value) || 0 : 0,
            min_staff_do: typeMinStaffDo ? parseInt(typeMinStaffDo.value) || 0 : 0,
            min_staff_fr: typeMinStaffFr ? parseInt(typeMinStaffFr.value) || 0 : 0,
            min_staff_sa: typeMinStaffSa ? parseInt(typeMinStaffSa.value) || 0 : 0,
            min_staff_so: typeMinStaffSo ? parseInt(typeMinStaffSo.value) || 0 : 0,
            min_staff_holiday: typeMinStaffHoliday ? parseInt(typeMinStaffHoliday.value) || 0 : 0
        };

        if (!payload.name || !payload.abbreviation) {
            if(modalStatus) modalStatus.textContent = "Name und Abkürzung sind erforderlich.";
            return;
        }

        try {
            if (id) {
                await apiFetch(`/api/shifttypes/${id}`, 'PUT', payload);
            } else {
                await apiFetch('/api/shifttypes', 'POST', payload);
            }
            closeModal();
            loadShiftTypes();
        } catch (error) {
            if(modalStatus) modalStatus.textContent = 'Fehler: ' + error.message;
        }
    };
}

window.deleteShiftType = async function(id) {
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