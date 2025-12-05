// html/feiertage.js

import { apiFetch } from './js/utils/api.js';
import { initAuthCheck } from './js/utils/auth.js';

// --- Globale Variablen ---
let currentYear = new Date().getFullYear();
// NEU: 'dpo' hinzugefügt
let years = {
    holiday: currentYear,
    training: currentYear,
    shooting: currentYear,
    dpo: currentYear
};
let modalContextYear = null;

// --- DOM Elemente ---
// NEU: 'dpo' Elemente hinzugefügt
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
// Optional: Falls das Modal diese Elemente hat
const eventNameGroup = document.getElementById('event-name-group');
const holidayNote = document.querySelector('.holiday-note');

// Buttons
const generateHolidaysBtn = document.getElementById('generate-holidays-btn');


// --- HILFSFUNKTION: Deutsche Feiertage berechnen (JS Client-Side) ---
function calculateGermanHolidays(year) {
    // Gauss'sche Osterformel
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

    // Datum als YYYY-MM-DD String
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
    // NEU: DPO laden
    loadEventsForYear('dpo', years.dpo);
}

// Daten laden und Client-Side Filtern
async function loadEventsForYear(type, year) {
    const table = tables[type];
    if(!table) return;

    table.innerHTML = `<tr><td colspan="3">Lade Daten...</td></tr>`;

    try {
        // 1. Wir holen ALLES vom Server (kein Filter Query, nur Timestamp)
        const ts = new Date().getTime();
        // Falls deine API Filter ignoriert (wie im neuen Python Code), bekommen wir alles.
        const allEvents = await apiFetch(`/api/special_dates?_t=${ts}`);

        // 2. Wir filtern hier im Browser (Sicher ist sicher)
        const filtered = allEvents.filter(ev => {
            // Typ prüfen (trim removes whitespace issues)
            if (!ev.type || ev.type.trim() !== type) return false;

            // Datum prüfen: Enthält der String das Jahr? (z.B. "2026")
            if (!ev.date) return false;
            return ev.date.includes(String(year));
        });

        console.log(`Gefiltert für ${type} ${year}:`, filtered.length, "Einträge");
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

    // Sortieren
    data.sort((a, b) => (a.date > b.date) ? 1 : -1);

    data.forEach(item => {
        const row = document.createElement('tr');

        // Anzeige-Datum formatieren (YYYY-MM-DD -> DD.MM.YYYY)
        let displayDate = item.date;
        if (item.date && item.date.match(/^\d{4}-\d{2}-\d{2}$/)) {
            const [y, m, d] = item.date.split('-');
            displayDate = `${d}.${m}.${y}`;
        }

        // Action Buttons erstellen
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


// --- BUTTON LOGIK ---

// Generieren (Client-Side Calculation -> Server Save)
if (generateHolidaysBtn) {
    generateHolidaysBtn.onclick = async () => {
        const year = years.holiday;
        if (!confirm(`Feiertage für ${year} generieren? (Existierende werden nicht überschrieben)`)) return;

        const newHolidays = calculateGermanHolidays(year);
        let count = 0;

        // Wir holen erst alle existierenden, um Duplikate zu vermeiden
        const ts = new Date().getTime();
        const allEvents = await apiFetch(`/api/special_dates?_t=${ts}`);

        for (const h of newHolidays) {
            // Check Duplikat (Client-Side)
            const exists = allEvents.some(ev => ev.date === h.date && ev.type === 'holiday');

            if (!exists) {
                try {
                    await apiFetch('/api/special_dates', 'POST', {
                        name: h.name,
                        date: h.date, // YYYY-MM-DD
                        type: 'holiday'
                    });
                    count++;
                } catch (e) {
                    console.error("Fehler beim Speichern von " + h.name, e);
                }
            }
        }

        alert(`${count} Feiertage erfolgreich erstellt.`);
        loadEventsForYear('holiday', year);
    };
}

// Navigation
document.querySelectorAll('.year-nav').forEach(btn => {
    btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        const delta = parseInt(btn.dataset.delta);
        years[type] += delta;
        updateLabels();
        loadEventsForYear(type, years[type]);
    });
});

// Tabs
document.querySelectorAll('.page-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.page-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.target).classList.add('active');
    });
});

// Löschen
async function deleteEvent(id, type) {
    if(!confirm("Wirklich löschen?")) return;
    try {
        await apiFetch(`/api/special_dates/${id}`, 'DELETE');
        loadEventsForYear(type, years[type]);
    } catch(e) { alert("Fehler: " + e.message); }
}


// --- MODAL & SPEICHERN ---

function openModal() { if(modal) modal.style.display = 'block'; }
function closeModal() { if(modal) modal.style.display = 'none'; }
if(document.querySelector('.close')) document.querySelector('.close').onclick = closeModal;
window.onclick = (e) => { if(e.target == modal) closeModal(); };

// Buttons zum Öffnen
if(document.getElementById('add-holiday-btn'))
    document.getElementById('add-holiday-btn').onclick = () => setupModal('holiday', true);
if(document.getElementById('add-training-btn'))
    document.getElementById('add-training-btn').onclick = () => setupModal('training', false);
if(document.getElementById('add-shooting-btn'))
    document.getElementById('add-shooting-btn').onclick = () => setupModal('shooting', false);
// NEU: DPO Button
if(document.getElementById('add-dpo-btn'))
    document.getElementById('add-dpo-btn').onclick = () => setupModal('dpo', false);

function setupModal(type, isEdit=false) {
    modalContextYear = years[type];
    if(eventIdField) eventIdField.value = ''; // Reset ID = Neu anlegen
    if(eventTypeField) eventTypeField.value = type;
    if(eventNameField) eventNameField.value = '';
    if(eventDateField) {
        eventDateField.value = '';
        eventDateField.placeholder = `TT.MM (Jahr ${modalContextYear})`;
    }

    // --- NEU: Namensfeld verstecken für DPO ---
    if(eventNameGroup) {
        // Holiday braucht Namen immer. DPO nie (weil automatisch).
        // Training/Shooting lassen wir optional (Backend entscheidet),
        // aber das UI kann es anzeigen.
        // Der Nutzer wollte es explizit für DPO weg haben.
        if (type === 'dpo') {
            eventNameGroup.style.display = 'none';
        } else {
            eventNameGroup.style.display = 'block';
        }
    }

    // Hinweis nur bei Holiday anzeigen
    if(holidayNote) holidayNote.style.display = (type === 'holiday') ? 'block' : 'none';

    openModal();
    // Fokus setzen je nach Sichtbarkeit
    if(type === 'holiday' && eventNameField && eventNameGroup.style.display !== 'none') eventNameField.focus();
    else if(eventDateField) eventDateField.focus();
}

function openEditModal(item) {
    if(eventIdField) eventIdField.value = item.id;
    if(eventTypeField) eventTypeField.value = item.type;
    if(eventNameField) eventNameField.value = item.name;

    // YYYY-MM-DD -> DD.MM.YYYY für Anzeige
    if (eventDateField && item.date) {
        if (item.date.includes('-')) {
            const [y, m, d] = item.date.split('-');
            eventDateField.value = `${d}.${m}.${y}`;
        } else {
            eventDateField.value = item.date;
        }
    }

    // Beim Bearbeiten zeigen wir das Namensfeld immer an, falls man es ändern will
    if(eventNameGroup) eventNameGroup.style.display = 'block';

    openModal();
}

if (saveEventBtn) {
    saveEventBtn.onclick = async () => {
        const id = eventIdField ? eventIdField.value : null;
        const type = eventTypeField ? eventTypeField.value : 'holiday';

        // Datumseingabe verarbeiten (DD.MM oder DD.MM.YYYY)
        let inputDate = eventDateField ? eventDateField.value.trim() : '';
        let finalIsoDate = "";

        // Fall 1: Nur TT.MM eingegeben -> Jahr ergänzen
        if (inputDate.match(/^\d{1,2}\.\d{1,2}$/)) {
            const [d, m] = inputDate.split('.');
            // WICHTIG: Nutze das Jahr des aktuellen Tabs
            const y = years[type];
            finalIsoDate = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
        }
        // Fall 2: TT.MM.YYYY eingegeben
        else if (inputDate.match(/^\d{1,2}\.\d{1,2}\.\d{4}$/)) {
            const [d, m, y] = inputDate.split('.');
            finalIsoDate = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
        }
        else {
            alert("Bitte Datum im Format TT.MM eingeben");
            return;
        }

        const payload = {
            name: eventNameField ? eventNameField.value : '',
            type: type,
            date: finalIsoDate // Wir senden jetzt IMMER YYYY-MM-DD an den Server
        };

        // Nur für Feiertage ist der Name Client-Seitig Pflicht.
        // Für DPO wird er im Backend gesetzt.
        if(!payload.name && type === 'holiday') { alert("Name fehlt"); return; }

        try {
            if (id) {
                await apiFetch(`/api/special_dates/${id}`, 'PUT', payload);
            } else {
                await apiFetch('/api/special_dates', 'POST', payload);
            }
            closeModal();
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