// html/feiertage.js

import { apiFetch } from './js/utils/api.js';
import { initAuthCheck } from './js/utils/auth.js';

// --- Globale Variablen ---
let currentYear = new Date().getFullYear();
let years = {
    holiday: currentYear,
    training: currentYear,
    shooting: currentYear,
    dpo: currentYear
};
let modalContextYear = null;

// --- DOM Elemente ---
const yearLabels = {
    holiday: document.getElementById('holiday-year-label'),
    training: document.getElementById('training-year-label'),
    shooting: document.getElementById('shooting-year-label'),
    dpo: document.getElementById('dpo-year-label')
};
const tables = {
    holiday: document.getElementById('holiday-table-body'),
    training: document.getElementById('training-table-body'),
    shooting: document.getElementById('shooting-table-body'),
    dpo: document.getElementById('dpo-table-body')
};

// Modal
const modal = document.getElementById('date-modal');
const saveEventBtn = document.getElementById('save-date-btn');
const eventNameField = document.getElementById('date-name');
const eventDateField = document.getElementById('date-value');
const eventTypeField = document.getElementById('date-type');
const eventIdField = document.createElement('input'); eventIdField.type = 'hidden';

// Wrapper für das Namensfeld (um es komplett auszublenden)
const eventNameGroup = document.getElementById('event-name-group');
const holidayNote = document.querySelector('.holiday-note');

// Buttons
const generateHolidaysBtn = document.getElementById('generate-holidays-btn');

// --- KONFIGURATION: Typen ohne Namensfeld ---
const NO_NAME_TYPES = ['dpo', 'training', 'shooting'];


// --- HILFSFUNKTION: Deutsche Feiertage berechnen ---
function calculateGermanHolidays(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;

    const easter = new Date(year, month - 1, day);
    const fmt = (d) => {
        const y = d.getFullYear();
        const mo = String(d.getMonth() + 1).padStart(2,'0');
        const da = String(d.getDate()).padStart(2,'0');
        return `${y}-${mo}-${da}`;
    };
    const addDays = (d, days) => {
        const res = new Date(d);
        res.setDate(res.getDate() + days);
        return res;
    };

    return [
        { name: "Neujahr", date: `${year}-01-01` },
        { name: "Internationaler Frauentag", date: `${year}-03-08` },
        { name: "Karfreitag", date: fmt(addDays(easter, -2)) },
        { name: "Ostermontag", date: fmt(addDays(easter, 1)) },
        { name: "Tag der Arbeit", date: `${year}-05-01` },
        { name: "Christi Himmelfahrt", date: fmt(addDays(easter, 39)) },
        { name: "Pfingstmontag", date: fmt(addDays(easter, 50)) },
        { name: "Tag der Deutschen Einheit", date: `${year}-10-03` },
        { name: "Reformationstag", date: `${year}-10-31` },
        { name: "1. Weihnachtstag", date: `${year}-12-25` },
        { name: "2. Weihnachtstag", date: `${year}-12-26` }
    ];
}


// --- HAUPTFUNKTIONEN ---

function initializePage() {
    console.log("Feiertage (Client-Side Logic) gestartet.");
    updateLabels();
    refreshAllTabs();
    setupDateInputMask(); // 1.2.3 -> 1.2.3.
    setupEnterSubmit();   // Enter -> Speichern
}

function updateLabels() {
    for (const [key, elem] of Object.entries(yearLabels)) {
        if(elem) elem.textContent = years[key];
    }
}

function refreshAllTabs() {
    loadEventsForYear('holiday', years.holiday);
    loadEventsForYear('training', years.training);
    loadEventsForYear('shooting', years.shooting);
    loadEventsForYear('dpo', years.dpo);
}

// --- LOGIK: ENTER TASTE ---
function setupEnterSubmit() {
    const inputs = [eventNameField, eventDateField];
    inputs.forEach(field => {
        if(!field) return;
        field.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if(saveEventBtn && !saveEventBtn.disabled) {
                    saveEventBtn.click();
                }
            }
        });
    });
}

// --- LOGIK: PUNKTE AUTOMATISCH SETZEN ---
function setupDateInputMask() {
    if (eventDateField) {
        eventDateField.addEventListener('input', (e) => {
            let v = e.target.value.replace(/[^0-9]/g, '');

            if (v.length > 2) {
                v = v.slice(0, 2) + '.' + v.slice(2);
            }
            if (v.length > 5) {
                v = v.slice(0, 5) + '.' + v.slice(5);
            }
            e.target.value = v.slice(0, 10);
        });
    }
}

// Daten laden
async function loadEventsForYear(type, year) {
    const table = tables[type];
    if(!table) return;

    table.innerHTML = `<tr><td colspan="3">Lade Daten...</td></tr>`;

    try {
        const ts = new Date().getTime();
        const allEvents = await apiFetch(`/api/special_dates?_t=${ts}`);

        const filtered = allEvents.filter(ev => {
            if (!ev.type || ev.type.trim() !== type) return false;
            if (!ev.date) return false;
            return ev.date.includes(String(year));
        });

        renderTable(table, filtered, type);
    } catch (error) {
        console.error("Ladefehler:", error);
        table.innerHTML = `<tr><td colspan="3" style="color: #e74c3c;">Fehler: ${error.message}</td></tr>`;
    }
}

function renderTable(tbody, data, type) {
    tbody.innerHTML = '';
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3">Keine Einträge für dieses Jahr.</td></tr>';
        return;
    }
    data.sort((a, b) => (a.date > b.date) ? 1 : -1);

    data.forEach(item => {
        const row = document.createElement('tr');
        let displayDate = item.date;
        if (item.date && item.date.match(/^\d{4}-\d{2}-\d{2}$/)) {
            const [y, m, d] = item.date.split('-');
            displayDate = `${d}.${m}.${y}`;
        }

        const editBtn = document.createElement('button');
        editBtn.className = 'btn-primary';
        editBtn.style.padding = '6px 12px'; editBtn.style.marginRight = '5px';
        editBtn.textContent = 'Bearbeiten';
        editBtn.onclick = () => openEditModal(item);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-delete';
        deleteBtn.style.padding = '6px 12px';
        deleteBtn.textContent = 'Löschen';
        deleteBtn.onclick = () => deleteEvent(item.id, type);

        const tdName = document.createElement('td'); tdName.textContent = item.name;
        const tdDate = document.createElement('td'); tdDate.textContent = displayDate;
        const tdActions = document.createElement('td');
        tdActions.appendChild(editBtn);
        tdActions.appendChild(deleteBtn);

        row.appendChild(tdName);
        row.appendChild(tdDate);
        row.appendChild(tdActions);
        tbody.appendChild(row);
    });
}


// --- BUTTONS ---
if (generateHolidaysBtn) {
    generateHolidaysBtn.onclick = async () => {
        const year = years.holiday;
        if (!confirm(`Feiertage für ${year} generieren?`)) return;
        const newHolidays = calculateGermanHolidays(year);
        let count = 0;
        const ts = new Date().getTime();
        const allEvents = await apiFetch(`/api/special_dates?_t=${ts}`);

        for (const h of newHolidays) {
            const exists = allEvents.some(ev => ev.date === h.date && ev.type === 'holiday');
            if (!exists) {
                try {
                    await apiFetch('/api/special_dates', 'POST', { name: h.name, date: h.date, type: 'holiday' });
                    count++;
                } catch (e) {}
            }
        }
        alert(`${count} Feiertage erfolgreich erstellt.`);
        loadEventsForYear('holiday', year);
    };
}

document.querySelectorAll('.year-nav').forEach(btn => {
    btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        const delta = parseInt(btn.dataset.delta);
        years[type] += delta;
        updateLabels();
        loadEventsForYear(type, years[type]);
    });
});

document.querySelectorAll('.page-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.page-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.target).classList.add('active');
    });
});

async function deleteEvent(id, type) {
    if(!confirm("Wirklich löschen?")) return;
    try {
        await apiFetch(`/api/special_dates/${id}`, 'DELETE');
        loadEventsForYear(type, years[type]);
    } catch(e) { alert("Fehler: " + e.message); }
}


// --- MODAL ---
function openModal() { if(modal) modal.style.display = 'block'; }
function closeModal() { if(modal) modal.style.display = 'none'; }
if(document.querySelector('.close')) document.querySelector('.close').onclick = closeModal;
window.onclick = (e) => { if(e.target == modal) closeModal(); };

if(document.getElementById('add-holiday-btn')) document.getElementById('add-holiday-btn').onclick = () => setupModal('holiday');
if(document.getElementById('add-training-btn')) document.getElementById('add-training-btn').onclick = () => setupModal('training');
if(document.getElementById('add-shooting-btn')) document.getElementById('add-shooting-btn').onclick = () => setupModal('shooting');
if(document.getElementById('add-dpo-btn')) document.getElementById('add-dpo-btn').onclick = () => setupModal('dpo');

function setupModal(type) {
    modalContextYear = years[type];
    if(eventIdField) eventIdField.value = '';
    if(eventTypeField) eventTypeField.value = type;
    if(eventNameField) eventNameField.value = '';
    if(eventDateField) {
        eventDateField.value = '';
        eventDateField.placeholder = `TT.MM (Jahr ${modalContextYear})`;
    }

    // --- NAMENSFELD AUSBLENDEN für DPO, Training, Shooting ---
    if(eventNameGroup) {
        if (NO_NAME_TYPES.includes(type)) {
            eventNameGroup.style.display = 'none';
        } else {
            eventNameGroup.style.display = 'block';
        }
    }

    if(holidayNote) holidayNote.style.display = (type === 'holiday') ? 'block' : 'none';

    openModal();

    // Fokus setzen
    if (NO_NAME_TYPES.includes(type)) {
        // Direkt ins Datum
        if(eventDateField) setTimeout(() => eventDateField.focus(), 50);
    } else if (eventNameField) {
        // In den Namen
        eventNameField.focus();
    }
}

function openEditModal(item) {
    if(eventIdField) eventIdField.value = item.id;
    if(eventTypeField) eventTypeField.value = item.type;
    if(eventNameField) eventNameField.value = item.name;

    if (eventDateField && item.date) {
        if (item.date.includes('-')) {
            const [y, m, d] = item.date.split('-');
            eventDateField.value = `${d}.${m}.${y}`;
        } else {
            eventDateField.value = item.date;
        }
    }

    // Beim Bearbeiten auch Namensfeld steuern (konsistent bleiben)
    if(eventNameGroup) {
        if (NO_NAME_TYPES.includes(item.type)) {
            eventNameGroup.style.display = 'none';
        } else {
            eventNameGroup.style.display = 'block';
        }
    }

    openModal();
}

// --- SPEICHERN ---
if (saveEventBtn) {
    saveEventBtn.onclick = async () => {
        const id = eventIdField ? eventIdField.value : null;
        const type = eventTypeField ? eventTypeField.value : 'holiday';

        let inputDate = eventDateField ? eventDateField.value.trim() : '';
        let finalIsoDate = "";

        if (inputDate.match(/^\d{1,2}\.\d{1,2}$/)) { // TT.MM
            const [d, m] = inputDate.split('.');
            const y = years[type];
            finalIsoDate = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
        }
        else if (inputDate.match(/^\d{1,2}\.\d{1,2}\.\d{4}$/)) { // TT.MM.YYYY
            const [d, m, y] = inputDate.split('.');
            finalIsoDate = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
        } else if (inputDate.match(/^\d{1,2}\.\d{1,2}\.$/)) {
             const [d, m] = inputDate.replace(/\.$/, '').split('.');
             const y = years[type];
             finalIsoDate = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
        }
        else {
            alert("Bitte Datum im Format TT.MM eingeben");
            return;
        }

        const payload = {
            name: eventNameField ? eventNameField.value : '',
            type: type,
            date: finalIsoDate
        };

        // Name Pflicht nur bei Holiday
        if(!payload.name && !NO_NAME_TYPES.includes(type)) {
             alert("Name fehlt"); return;
        }

        try {
            if (id) {
                // UPDATE -> Modal schließen
                await apiFetch(`/api/special_dates/${id}`, 'PUT', payload);
                closeModal();
            } else {
                // CREATE (Schnelleingabe)
                await apiFetch('/api/special_dates', 'POST', payload);

                // Feedback
                const originalText = saveEventBtn.textContent;
                saveEventBtn.textContent = "Gespeichert!";
                saveEventBtn.style.backgroundColor = "#27ae60";
                saveEventBtn.disabled = true;

                setTimeout(() => {
                    saveEventBtn.textContent = originalText;
                    saveEventBtn.style.backgroundColor = "";
                    saveEventBtn.disabled = false;
                }, 800);

                // Reset
                if(eventNameField) eventNameField.value = '';
                if(eventDateField) eventDateField.value = '';

                // Fokus zurücksetzen (Schnelleingabe)
                if (NO_NAME_TYPES.includes(type)) {
                    if(eventDateField) eventDateField.focus();
                } else if (eventNameField) {
                    eventNameField.focus();
                }
            }

            loadEventsForYear(type, years[type]);
        } catch (e) {
            alert("Fehler: " + e.message);
        }
    };
}


// --- START ---
try {
    initAuthCheck();
    initializePage();
} catch (e) {
    console.log("Nicht eingeloggt oder Fehler bei Init:", e);
}