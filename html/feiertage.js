// --- Globales Setup (Auth, API) ---
const API_URL = 'http://46.224.63.203:5000';
let user;
let isAdmin = false; // <<< NEU
let isVisitor = false; // <<< NEU

async function logout() {
    try { await apiFetch('/api/logout', 'POST'); } catch (e) { console.error(e); }
    finally { localStorage.removeItem('dhf_user'); window.location.href = 'index.html?logout=true'; }
}
try {
    user = JSON.parse(localStorage.getItem('dhf_user'));
    if (!user || !user.vorname || !user.role) { throw new Error("Kein User oder fehlende Rolle"); }
    document.getElementById('welcome-user').textContent = `Willkommen, ${user.vorname}!`;

    // --- NEUE LOGIK: Rollenprüfung und UI-Anpassung ---
    isAdmin = user.role.name === 'admin';
    isVisitor = user.role.name === 'Besucher';
    const isUser = user.role.name === 'user';
    // --- START: NEU ---
    const isPlanschreiber = user.role.name === 'Planschreiber';
    const isHundefuehrer = user.role.name === 'Hundeführer';
    // --- ENDE: NEU ---


    // 1. Haupt-Navigationsanpassung
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
        // Nur Admins dürfen auf die Feiertags-Verwaltung zugreifen
        const wrapper = document.getElementById('content-wrapper');
        wrapper.innerHTML = `
            <div class="restricted-view">
                <h2 style="color: #e74c3c;">Zugriff verweigert</h2>
                <p>Sie benötigen Admin-Rechte, um Feiertage und Sondertermine zu verwalten.</p>
                <p>Bitte nutzen Sie den Link zum <a href="schichtplan.html" style="color: #3498db;">Schichtplan</a>.</p>
            </div>
        `;
        document.getElementById('settings-dropbtn').style.display = 'none';
         throw new Error("Keine Admin-Rechte für Feiertags-Verwaltung.");
    }

    // 2. Dropdown-Anpassung (Nur für Admins relevant)
    if (isAdmin) {
        // (Korrektur: JavaScript muss die 'admin-only' Links anzeigen, nicht 'user-only')
        document.querySelectorAll('#settings-dropdown-content .admin-only').forEach(el => {
            el.style.display = 'block';
        });
    }
    // --- ENDE NEUE LOGIK ---

} catch (e) {
    if (!e.message.includes("Admin-Rechte")) {
         logout();
    }
}
document.getElementById('logout-btn').onclick = logout;
async function apiFetch(endpoint, method = 'GET', body = null) {
    const options = {
        method, headers: { 'Content-Type': 'application/json' }, credentials: 'include'
    };
    if (body) { options.body = JSON.stringify(body); }
    const response = await fetch(API_URL + endpoint, options);
    if (response.status === 401 || response.status === 403) {
        if (response.status === 401) { logout(); }
        throw new Error('Sitzung ungültig oder fehlende Rechte.');
    }
    const contentType = response.headers.get("content-type");
    let data;
    if (contentType && contentType.indexOf("application/json") !== -1) { data = await response.json(); }
    else { data = { message: await response.text() }; }
    if (!response.ok) { throw new Error(data.message || 'API-Fehler'); }
    return data;
}

// --- (NEU) Jahres-Navigation ---
let currentTrainingYear = new Date().getFullYear();
let currentShootingYear = new Date().getFullYear();
let modalContextYear = null;

const trainingYearLabel = document.getElementById('training-year-label');
const shootingYearLabel = document.getElementById('shooting-year-label');

document.querySelectorAll('.year-nav').forEach(btn => {
    btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        const delta = parseInt(btn.dataset.delta);

        if (type === 'training') {
            currentTrainingYear += delta;
            trainingYearLabel.textContent = currentTrainingYear;
            loadEventsForYear('training', currentTrainingYear);
        } else if (type === 'shooting') {
            currentShootingYear += delta;
            shootingYearLabel.textContent = currentShootingYear;
            loadEventsForYear('shooting', currentShootingYear);
        }
    });
});

// --- Tab-Logik (unverändert) ---
const tabLinks = document.querySelectorAll('.tab-link');
const tabContents = document.querySelectorAll('.tab-content');

tabLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        const tabId = e.target.dataset.tab;

        tabContents.forEach(content => content.classList.remove('active'));
        tabLinks.forEach(link => link.classList.remove('active'));

        document.getElementById(tabId).classList.add('active');
        e.target.classList.add('active');
    });
});

// --- Modal & CRUD-Logik (stark angepasst) ---
const modal = document.getElementById('event-modal');
const modalTitle = document.getElementById('modal-title');
const modalStatus = document.getElementById('modal-status');
const rapidStatus = document.getElementById('rapid-status'); // (NEU)
const closeModalBtn = document.getElementById('close-event-modal');
const saveEventBtn = document.getElementById('save-event-btn');

const eventIdField = document.getElementById('event-id');
const eventTypeField = document.getElementById('event-type');
const eventNameField = document.getElementById('event-name');
const eventNameGroup = document.getElementById('event-name-group'); // (NEU)
const eventDateField = document.getElementById('event-date');
const holidayNote = document.querySelector('.holiday-note');

const holidayTable = document.getElementById('holiday-table-body');
const trainingTable = document.getElementById('training-table-body');
const shootingTable = document.getElementById('shooting-table-body');

const holidayYearInput = document.getElementById('holiday-year-input');
const calculateHolidaysBtn = document.getElementById('calculate-holidays-btn');
const holidayStatus = document.getElementById('holiday-status');

function openModal() {
    modal.style.display = 'block';
    modalStatus.textContent = '';
    rapidStatus.textContent = ''; // (NEU)
}
function closeModal() {
    modal.style.display = 'none';
    // (NEU) Felder beim Schließen immer leeren
    eventNameField.value = '';
    eventDateField.value = '';
}
closeModalBtn.onclick = closeModal;
window.onclick = (event) => { if (event.target == modal) closeModal(); }

// --- Daten lade- und Render-Funktionen ---

async function loadHolidayData() {
     try {
        const holidays = await apiFetch('/api/special_dates?type=holiday');
        renderTable(holidayTable, holidays);
        await checkAndAutoUpdateHolidays(holidays);
    } catch (error) {
        holidayTable.innerHTML = `<tr><td colspan="3" style="color: #e74c3c;">Fehler beim Laden: ${error.message}</td></tr>`;
    }
}

async function loadEventsForYear(type, year) {
    const table = (type === 'training') ? trainingTable : shootingTable;
    table.innerHTML = `<tr><td colspan="3">Lade Termine für ${year}...</td></tr>`;
    try {
        const events = await apiFetch(`/api/special_dates?type=${type}&year=${year}`);
        const datedEvents = events.filter(e => e.date);
        renderTable(table, datedEvents);
    } catch (error) {
        table.innerHTML = `<tr><td colspan="3" style="color: #e74c3c;">Fehler beim Laden: ${error.message}</td></tr>`;
    }
}

function renderTable(tbody, data) {
    tbody.innerHTML = '';
    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3">Keine Einträge für diesen Zeitraum vorhanden.</td></tr>';
        return;
    }
    data.forEach(item => {
        const row = document.createElement('tr');
        const dateDisplay = item.date
            ? new Date(item.date + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : '<i style="color: #888;">(Datum nicht gesetzt)</i>';

        const itemJson = JSON.stringify(item).replace(/'/g, "\\'");

        row.innerHTML = `
            <td>${item.name}</td>
            <td>${dateDisplay}</td>
            <td class="actions">
                <button class="btn-edit" onclick='openEditModal(${itemJson})'>Bearbeiten</button>
                <button class="btn-delete" onclick="deleteEvent(${item.id}, '${item.type}')">Löschen</button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

// --- Modal-Öffner (ANGEPASST) ---

document.getElementById('add-holiday-btn').onclick = () => {
    modalTitle.textContent = 'Neuen Feiertag erstellen';
    eventNameGroup.style.display = 'block'; // (NEU) Feld anzeigen
    holidayNote.style.display = 'block';

    eventIdField.value = '';
    eventTypeField.value = 'holiday';
    eventDateField.placeholder = 'TT.MM.JJJJ';
    modalContextYear = null;

    openModal();
    eventNameField.focus(); // Fokus auf das Namensfeld
};
document.getElementById('add-training-btn').onclick = () => {
    modalTitle.textContent = `Neue Ausbildungstermine für ${currentTrainingYear} hinzufügen`;
    eventNameGroup.style.display = 'none'; // (NEU) Feld verstecken
    holidayNote.style.display = 'none';

    eventIdField.value = ''; // (Wichtig für Schnell-Eingabe)
    eventTypeField.value = 'training';
    eventDateField.placeholder = `TT.MM (wird zu TT.MM.${currentTrainingYear})`;
    modalContextYear = currentTrainingYear;

    openModal();
    eventDateField.focus(); // Fokus auf das Datumsfeld
};
document.getElementById('add-shooting-btn').onclick = () => {
    modalTitle.textContent = `Neue Schießtermine für ${currentShootingYear} hinzufügen`;
    eventNameGroup.style.display = 'none'; // (NEU) Feld verstecken
    holidayNote.style.display = 'none';

    eventIdField.value = ''; // (Wichtig für Schnell-Eingabe)
    eventTypeField.value = 'shooting';
    eventDateField.placeholder = `TT.MM (wird zu TT.MM.${currentShootingYear})`;
    modalContextYear = currentShootingYear;

    openModal();
    eventDateField.focus(); // Fokus auf das Datumsfeld
};

function openEditModal(item) {
    modalTitle.textContent = 'Termin bearbeiten';
    eventNameGroup.style.display = 'block'; // (NEU) Feld anzeigen

    eventIdField.value = item.id;
    eventTypeField.value = item.type;
    eventNameField.value = item.name;

    let displayDate = '';
    if (item.date) {
        const d = new Date(item.date + 'T00:00:00');
        displayDate = d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }
    eventDateField.value = displayDate;

    if (item.type === 'holiday') {
        modalContextYear = null;
        eventDateField.placeholder = 'TT.MM.JJJJ';
        holidayNote.style.display = 'block';
    } else {
        modalContextYear = item.date ? new Date(item.date + 'T00:00:00').getFullYear() : new Date().getFullYear();
        eventDateField.placeholder = `TT.MM (wird zu TT.MM.${modalContextYear})`;
        holidayNote.style.display = 'none';
    }
    openModal();
    eventNameField.focus(); // Fokus auf Namensfeld beim Bearbeiten
}

// --- Speichern (Create / Update) (ANGEPASST für Schnell-Eingabe) ---
saveEventBtn.onclick = async () => {
    const id = eventIdField.value;
    const type = eventTypeField.value;

    // (Datum wird 1:1 so gesendet, wie es im Textfeld steht)
    const payload = {
        type: type,
        date: eventDateField.value || null
    };

    // (Name nur senden, wenn es ein Edit ist ODER der Name angezeigt wurde (Holiday))
    if (id || eventNameGroup.style.display === 'block') {
         payload.name = eventNameField.value;
    }

    // (Frontend-Validierung)
    if (payload.type === 'holiday' && !payload.name) {
        modalStatus.textContent = "Name ist erforderlich."; return;
    }
    if (!payload.date) {
        modalStatus.textContent = "Datum ist erforderlich."; return;
    }

    modalStatus.textContent = '';
    rapidStatus.textContent = 'Speichere...';
    rapidStatus.style.color = '#bdc3c7';

    try {
        if (id) { // UPDATE
            await apiFetch(`/api/special_dates/${id}`, 'PUT', payload);
        } else { // CREATE
            await apiFetch('/api/special_dates', 'POST', payload);
        }

        // (Intelligentes Neuladen)
        if (type === 'holiday') {
            await loadHolidayData();
        } else {
            await loadEventsForYear(type, modalContextYear);
        }

        // --- (NEUE SCHNELL-EINGABE LOGIK) ---
        if (id) {
            // Beim Bearbeiten: Modal schließen
            closeModal();
        } else {
            // Beim Hinzufügen (Schnell-Eingabe): Feld leeren & neu fokussieren
            rapidStatus.textContent = `Termin ${payload.date} gespeichert.`;
            rapidStatus.style.color = '#2ecc71';
            eventDateField.value = '';
            eventDateField.focus();
        }

    } catch (error) {
        rapidStatus.textContent = ''; // (Fehler in Haupt-Statusleiste)
        modalStatus.textContent = 'Fehler: ' + error.message;
    }
};

// --- Löschen (unverändert) ---
async function deleteEvent(id, type) {
    if (confirm('Sind Sie sicher, dass Sie diesen Termin löschen möchten?')) {
        try {
            await apiFetch(`/api/special_dates/${id}`, 'DELETE');
            if (type === 'holiday') { await loadHolidayData(); }
            else if (type === 'training') { await loadEventsForYear('training', currentTrainingYear); }
            else if (type === 'shooting') { await loadEventsForYear('shooting', currentShootingYear); }
        } catch (error) {
            alert('Löschen fehlgeschlagen: ' + error.message);
        }
    }
}

// --- Feiertage berechnen (Manuell) (unverändert) ---
calculateHolidaysBtn.onclick = async () => {
    const year = parseInt(holidayYearInput.value);
    if (!year || year < 2000 || year > 2100) {
        holidayStatus.textContent = 'Gültiges Jahr eingeben.';
        holidayStatus.style.color = '#e74c3c'; return;
    }
    holidayStatus.textContent = 'Berechne...';
    holidayStatus.style.color = '#bdc3c7';
    calculateHolidaysBtn.disabled = true;
    try {
        const result = await apiFetch('/api/special_dates/calculate_holidays', 'POST', { year: year });
        holidayStatus.textContent = result.message || 'Erfolgreich!';
        holidayStatus.style.color = '#2ecc71';
        await loadHolidayData();
    } catch (error) {
        holidayStatus.textContent = 'Fehler: ' + error.message;
        holidayStatus.style.color = '#e74c3c';
    } finally {
        calculateHolidaysBtn.disabled = false;
        setTimeout(() => holidayStatus.textContent = '', 3000);
    }
};

// --- Automatische Feiertags-Prüfung (unverändert) ---
async function checkAndAutoUpdateHolidays(holidays) {
    const currentYear = new Date().getFullYear();
    const neujahr = holidays.find(h => h.name === "Neujahr");
    if (!neujahr) { console.warn("Neujahr-Vorlage nicht gefunden. Überspringe Auto-Update."); return; }
    const savedYear = neujahr.date ? new Date(neujahr.date + 'T00:00:00').getFullYear() : null;
    if (savedYear !== currentYear) {
        console.log(`Feiertage sind veraltet (gespeichert: ${savedYear}, aktuell: ${currentYear}). Starte automatisches Update...`);
        holidayStatus.textContent = `Aktualisiere Feiertage für ${currentYear}...`;
        holidayStatus.style.color = '#3498db';
        calculateHolidaysBtn.disabled = true;
        try {
            await apiFetch('/api/special_dates/calculate_holidays', 'POST', { year: currentYear });
            console.log("Auto-Update erfolgreich.");
            holidayStatus.textContent = `Feiertage für ${currentYear} automatisch aktualisiert!`;
            holidayStatus.style.color = '#2ecc71';
            const allDates = await apiFetch('/api/special_dates?type=holiday');
            renderTable(holidayTable, allDates);
        } catch (error) {
            console.error("Automatisches Feiertags-Update fehlgeschlagen:", error);
            holidayStatus.textContent = 'Autom. Update fehlgeschlagen: ' + error.message;
            holidayStatus.style.color = '#e74c3c';
        } finally {
            calculateHolidaysBtn.disabled = false;
            setTimeout(() => holidayStatus.textContent = '', 4000);
        }
    } else {
        console.log(`Feiertage sind aktuell (Jahr: ${currentYear}).`);
    }
}

// --- INNOVATIVE DATUMS-EINGABE (ANGEPASST) ---

eventDateField.addEventListener('keyup', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab', 'Shift', 'Control', 'Alt', 'Enter'].includes(e.key)) {
        return;
    }
    let text = eventDateField.value;
    let digits = text.replace(/\D/g, '');
    if (digits.length > 8) { digits = digits.substring(0, 8); }
    let formatted = '';
    if (digits.length > 4) {
        formatted = `${digits.substring(0, 2)}.${digits.substring(2, 4)}.${digits.substring(4)}`;
    } else if (digits.length > 2) {
        formatted = `${digits.substring(0, 2)}.${digits.substring(2)}`;
    } else { formatted = digits; }
    if (text !== formatted) {
        const selectionStart = eventDateField.selectionStart;
        const addedChars = (formatted.length > text.length) ? 1 : 0;
        eventDateField.value = formatted;
        eventDateField.setSelectionRange(selectionStart + addedChars, selectionStart + addedChars);
    }
});

// (NEU) Führt die Auto-Vervollständigung durch
function autoCompleteDate() {
    let text = eventDateField.value.trim();
    if (text.endsWith('.')) { text = text.substring(0, text.length - 1); }

    if (modalContextYear && text.match(/^\d{2}\.\d{2}$/)) {
        eventDateField.value = `${text}.${modalContextYear}`;
    }
}

eventDateField.addEventListener('focusout', autoCompleteDate);

// (NEU) <Enter> Listener für Schnell-Eingabe
eventDateField.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault(); // (Verhindert Standard-Formular-Absendung)
        autoCompleteDate(); // (Stellt sicher, dass "15.04" -> "15.04.2025" wird)
        saveEventBtn.click(); // (Löst den Speicher-Button aus)
    }
});


// --- Initialisierung ---
function initializePage() {
    // Nur ausführen, wenn Admin-Check erfolgreich war
    if (user && user.role.name === 'admin') {
        trainingYearLabel.textContent = currentTrainingYear;
        shootingYearLabel.textContent = currentShootingYear;
        holidayYearInput.value = new Date().getFullYear();

        loadHolidayData();
        loadEventsForYear('training', currentTrainingYear);
        loadEventsForYear('shooting', currentShootingYear);
    }
}

// Die Initialisierung wird nur für Admins aufgerufen (siehe try/catch Block oben)
initializePage();