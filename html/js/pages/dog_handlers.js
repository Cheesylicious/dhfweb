// html/js/pages/dog_handlers.js

import { apiFetch } from '../utils/api.js';
import { initAuthCheck } from '../utils/auth.js';

// --- Globales Setup ---
let handlersData = [];

// --- 1. Authentifizierung & Zugriffsschutz ---
try {
    const authData = initAuthCheck();
    if (!authData.isAdmin) {
        document.getElementById('content-wrapper').innerHTML = `
            <div class="restricted-view">
                <h2>Zugriff verweigert</h2>
                <p>Nur Administratoren haben Zugriff auf diesen Bereich.</p>
            </div>
        `;
        throw new Error("Access denied");
    }
} catch (e) {
    console.error(e);
}

// --- 2. DOM Elemente ---
const tableBody = document.getElementById('dog-handlers-table-body');
const searchInput = document.getElementById('search-input');
const showHiddenFilter = document.getElementById('show-hidden-filter'); // NEU: Filter-Checkbox im Header

// Modal Elements
const modal = document.getElementById('edit-modal');
const modalTitle = document.getElementById('modal-title');
const modalStatus = document.getElementById('modal-status');
const closeModalBtn = document.getElementById('close-modal');
const saveBtn = document.getElementById('save-btn');

const editUserIdField = document.getElementById('edit-user-id');
const editUserNameDisplay = document.getElementById('edit-user-name');
const editLastQaField = document.getElementById('edit-last-qa');
const editLastShootingField = document.getElementById('edit-last-shooting');
const editIsManualField = document.getElementById('edit-is-manual');
const editIsHiddenField = document.getElementById('edit-is-hidden'); // NEU: Checkbox im Modal

// --- 3. Hilfsfunktionen für Datum & Logik ---

function getQuarter(d) {
    d = d || new Date();
    const m = Math.floor(d.getMonth() / 3) + 1; // 1..4
    return {
        q: m,
        year: d.getFullYear(),
        endOfQuarter: new Date(d.getFullYear(), m * 3, 0) // Letzter Tag des Quartals
    };
}

function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

function formatDateDE(isoDate) {
    if (!isoDate) return '---';
    const d = new Date(isoDate);
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// --- Logik: Quartalsausbildung (1x pro Quartal) ---
function calculateQaStatus(lastDateStr) {
    const today = new Date();
    const currentQ = getQuarter(today);

    if (!lastDateStr) {
        return {
            status: 'danger',
            text: 'Überfällig (Nie absolviert)',
            dueDate: currentQ.endOfQuarter
        };
    }

    const lastDate = new Date(lastDateStr);
    const lastQ = getQuarter(lastDate);

    // Wenn im aktuellen Quartal (oder Zukunft) gemacht
    if (lastQ.year > currentQ.year || (lastQ.year === currentQ.year && lastQ.q >= currentQ.q)) {
        // Nächstes Quartal berechnen
        const nextQEnd = new Date(currentQ.year, (currentQ.q + 1) * 3, 0);
        return {
            status: 'ok',
            text: 'OK (Dieses Quartal erledigt)',
            dueDate: nextQEnd
        };
    } else {
        // Nicht in diesem Quartal gemacht -> Fällig bis Ende dieses Quartals
        return {
            status: 'warning',
            text: 'Fällig dieses Quartal',
            dueDate: currentQ.endOfQuarter
        };
    }
}

// --- Logik: Schießen (Alle 90 Tage) ---
function calculateShootingStatus(lastDateStr) {
    if (!lastDateStr) {
        return {
            status: 'danger',
            text: 'Überfällig (Nie absolviert)',
            dueDate: new Date() // Sofort
        };
    }

    const lastDate = new Date(lastDateStr);
    const today = new Date();

    // Fälligkeitstag
    const dueDate = addDays(lastDate, 90);

    // Zeitdifferenz in Tagen
    const diffTime = dueDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
        return {
            status: 'danger',
            text: `Überfällig seit ${Math.abs(diffDays)} Tagen`,
            dueDate: dueDate
        };
    } else if (diffDays <= 14) {
        return {
            status: 'warning',
            text: `Fällig in ${diffDays} Tagen`,
            dueDate: dueDate
        };
    } else {
        return {
            status: 'ok',
            text: 'OK',
            dueDate: dueDate
        };
    }
}

// --- 4. Laden & Rendern ---

async function loadData() {
    try {
        tableBody.innerHTML = '<tr><td colspan="7">Lade Daten...</td></tr>';
        handlersData = await apiFetch('/api/dog_handlers');
        renderTable(handlersData);
    } catch (e) {
        tableBody.innerHTML = `<tr><td colspan="7" style="color:red">Fehler: ${e.message}</td></tr>`;
    }
}

function renderTable(data) {
    tableBody.innerHTML = '';

    const term = searchInput.value.toLowerCase();
    const showHidden = showHiddenFilter ? showHiddenFilter.checked : false; // Filter-Status lesen

    const filtered = data.filter(u => {
        // 1. Suchfilter
        const matchesSearch = (u.vorname + ' ' + u.name).toLowerCase().includes(term) ||
                              (u.diensthund || '').toLowerCase().includes(term);

        // 2. "Versteckte anzeigen" Filter
        if (!showHidden && u.is_hidden_dog_handler) {
            return false; // Ausblenden, wenn nicht explizit gewünscht
        }

        return matchesSearch;
    });

    if (filtered.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px; color:#777;">Keine Einträge gefunden.</td></tr>';
        return;
    }

    filtered.forEach(u => {
        const row = document.createElement('tr');

        // Optional: Visuell markieren, wenn ausgeblendet (damit man es merkt, wenn Filter aktiv ist)
        if (u.is_hidden_dog_handler) {
            row.style.opacity = '0.5';
            row.style.backgroundColor = 'rgba(0,0,0,0.2)';
        }

        const qaInfo = calculateQaStatus(u.last_training_qa);
        const shootInfo = calculateShootingStatus(u.last_training_shooting);

        const qaClass = `status-${qaInfo.status}`;
        const shootClass = `status-${shootInfo.status}`;

        // Hinweis bei ausgeblendeten Usern
        const hiddenBadge = u.is_hidden_dog_handler
            ? '<span style="font-size:10px; background:#444; color:#ccc; padding:2px 4px; border-radius:3px; margin-left:5px;">Ausgeblendet</span>'
            : '';

        row.innerHTML = `
            <td>
                <div style="font-weight:600; color:#fff;">${u.vorname} ${u.name} ${hiddenBadge}</div>
                <div style="font-size:11px; color:#7f8c8d;">${u.role ? u.role.name : 'Unbekannt'}</div>
            </td>
            <td>${u.diensthund || '---'}</td>

            <td>${formatDateDE(u.last_training_qa)}</td>
            <td>
                <span class="${qaClass}">${qaInfo.text}</span><br>
                <span style="font-size:11px; color:#7f8c8d;">Fällig: ${formatDateDE(qaInfo.dueDate)}</span>
            </td>

            <td>${formatDateDE(u.last_training_shooting)}</td>
            <td>
                <span class="${shootClass}">${shootInfo.text}</span><br>
                <span style="font-size:11px; color:#7f8c8d;">Stichtag: ${formatDateDE(shootInfo.dueDate)}</span>
            </td>

            <td>
                <button class="btn-edit edit-trigger">Bearbeiten</button>
            </td>
        `;

        // Event Listener an den Button hängen (sicherer als onclick String)
        const btn = row.querySelector('.edit-trigger');
        btn.addEventListener('click', () => openModalFunc(u));

        tableBody.appendChild(row);
    });
}


// --- 5. Modal Logik ---

function openModalFunc(user) {
    editUserIdField.value = user.id;
    editUserNameDisplay.textContent = `${user.vorname} ${user.name} (${user.diensthund || 'Kein Hund'})`;

    // Dates setzen (YYYY-MM-DD für Input type=date)
    editLastQaField.value = user.last_training_qa || '';
    editLastShootingField.value = user.last_training_shooting || '';

    // Checkboxes setzen
    if(editIsManualField) editIsManualField.checked = user.is_manual_dog_handler === true;
    if(editIsHiddenField) editIsHiddenField.checked = user.is_hidden_dog_handler === true;

    modalStatus.textContent = '';
    modal.style.display = 'block';
}

saveBtn.onclick = async () => {
    const id = editUserIdField.value;
    if (!id) return;

    const payload = {
        last_training_qa: editLastQaField.value || '', // Leerer String wird im Backend zu NULL
        last_training_shooting: editLastShootingField.value || '',
        is_manual_dog_handler: editIsManualField ? editIsManualField.checked : false,
        is_hidden_dog_handler: editIsHiddenField ? editIsHiddenField.checked : false
    };

    modalStatus.textContent = 'Speichere...';
    saveBtn.disabled = true;

    try {
        await apiFetch(`/api/dog_handlers/${id}`, 'PUT', payload);
        modal.style.display = 'none';
        loadData(); // Reload Table
    } catch (e) {
        modalStatus.textContent = 'Fehler: ' + e.message;
    } finally {
        saveBtn.disabled = false;
    }
};


// --- 6. Event Listeners ---

if(closeModalBtn) closeModalBtn.onclick = () => { modal.style.display = 'none'; };
window.onclick = (event) => { if (event.target == modal) modal.style.display = 'none'; };

if(searchInput) {
    searchInput.addEventListener('input', () => {
        renderTable(handlersData);
    });
}

if(showHiddenFilter) {
    showHiddenFilter.addEventListener('change', () => {
        renderTable(handlersData);
    });
}


// Start
loadData();