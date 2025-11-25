// html/logs.js

import { apiFetch } from './js/utils/api.js';
import { initAuthCheck } from './js/utils/auth.js';

let user;
let isAdmin = false;

// State
let currentPage = 1;
const itemsPerPage = 20;
let totalPages = 1;

// DOM Elemente
const tableBody = document.getElementById('logs-table-body');
const refreshBtn = document.getElementById('refresh-logs-btn');
const filterAction = document.getElementById('filter-action');
const filterUser = document.getElementById('filter-user');
const paginationContainer = document.getElementById('pagination-controls');

// 1. Auth Check
try {
    const authData = initAuthCheck();
    user = authData.user;
    isAdmin = authData.isAdmin;

    if (!isAdmin) {
        // Sollte durch logs.html schon blockiert sein, aber zur Sicherheit:
        window.location.href = 'schichtplan.html';
        throw new Error("Kein Zugriff.");
    }

    // Init
    loadLogs();

} catch (e) {
    console.error("Logs Init Error:", e);
}

// 2. Event Listeners
if (refreshBtn) {
    refreshBtn.onclick = () => {
        currentPage = 1;
        loadLogs();
    };
}

if (filterAction) {
    filterAction.addEventListener('change', () => {
        currentPage = 1;
        loadLogs();
    });
}

if (filterUser) {
    // Debounce für Texteingabe (wartet kurz, bevor geladen wird)
    let timeout = null;
    filterUser.addEventListener('input', () => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            currentPage = 1;
            loadLogs();
        }, 500);
    });
}

// 3. Hauptfunktion: Logs laden
async function loadLogs() {
    if (!tableBody) return;

    tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #bdc3c7;">Lade Daten...</td></tr>';

    const action = filterAction.value;
    const userSearch = filterUser.value.trim();

    // Query Params bauen
    const params = new URLSearchParams({
        page: currentPage,
        per_page: itemsPerPage
    });
    if (action) params.append('action', action);
    if (userSearch) params.append('user', userSearch);

    try {
        // Wir erwarten hier eine paginierte Antwort vom Backend
        const response = await apiFetch(`/api/activity_logs?${params.toString()}`);

        renderTable(response.items);
        renderPagination(response.page, response.pages, response.total);

        totalPages = response.pages;

    } catch (error) {
        tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #e74c3c;">Fehler: ${error.message}</td></tr>`;
    }
}

function renderTable(logs) {
    tableBody.innerHTML = '';

    if (!logs || logs.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #777;">Keine Einträge gefunden.</td></tr>';
        return;
    }

    logs.forEach(log => {
        const row = document.createElement('tr');

        // Datum formatieren
        const dateObj = new Date(log.timestamp);
        const dateStr = dateObj.toLocaleString('de-DE', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });

        // Styling für Aktionstyp
        let actionClass = '';
        if (log.action === 'LOGIN') actionClass = 'log-type-login';
        else if (log.action === 'LOGOUT') actionClass = 'log-type-logout';
        else if (log.action === 'PASSWORD_CHANGE') actionClass = 'log-type-password';
        else if (log.action === 'PROFILE_UPDATE') actionClass = 'log-type-profile';
        else if (log.action.includes('FAILED') || log.action.includes('ERROR')) actionClass = 'log-type-error';

        row.innerHTML = `
            <td style="font-family: monospace; font-size: 0.9em;">${dateStr}</td>
            <td>${log.user_name}</td>
            <td class="${actionClass}">${log.action}</td>
            <td>${log.details || '-'}</td>
            <td style="font-family: monospace; color: #777;">${log.ip_address || 'N/A'}</td>
        `;
        tableBody.appendChild(row);
    });
}

function renderPagination(current, pages, total) {
    if (!paginationContainer) return;
    paginationContainer.innerHTML = '';

    if (pages <= 1) return; // Keine Pagination nötig

    // Vorherige Seite
    const prevBtn = document.createElement('button');
    prevBtn.textContent = '<';
    prevBtn.disabled = current === 1;
    prevBtn.onclick = () => {
        if (currentPage > 1) {
            currentPage--;
            loadLogs();
        }
    };
    paginationContainer.appendChild(prevBtn);

    // Seiten-Info
    const info = document.createElement('span');
    info.style.alignSelf = 'center';
    info.style.fontSize = '13px';
    info.style.color = '#bdc3c7';
    info.textContent = ` Seite ${current} von ${pages} (Gesamt: ${total}) `;
    paginationContainer.appendChild(info);

    // Nächste Seite
    const nextBtn = document.createElement('button');
    nextBtn.textContent = '>';
    nextBtn.disabled = current === pages;
    nextBtn.onclick = () => {
        if (currentPage < pages) {
            currentPage++;
            loadLogs();
        }
    };
    paginationContainer.appendChild(nextBtn);
}