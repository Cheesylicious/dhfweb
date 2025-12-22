import { apiFetch } from './js/utils/api.js';

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

// Init
loadLogs();

// Event Listeners
if (refreshBtn) {
    refreshBtn.onclick = () => { currentPage = 1; loadLogs(); };
}
if (filterAction) {
    filterAction.addEventListener('change', () => { currentPage = 1; loadLogs(); });
}
if (filterUser) {
    let timeout = null;
    filterUser.addEventListener('input', () => {
        clearTimeout(timeout);
        timeout = setTimeout(() => { currentPage = 1; loadLogs(); }, 500);
    });
}

async function loadLogs() {
    if (!tableBody) return;
    tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #bdc3c7;">Lade Daten...</td></tr>';

    const action = filterAction ? filterAction.value : '';
    const userSearch = filterUser ? filterUser.value.trim() : '';

    // Query Parameter bauen
    const params = new URLSearchParams({
        page: currentPage,
        limit: itemsPerPage,
        action: action,
        user: userSearch
    });

    try {
        // Wir nutzen den neuen Audit-Endpoint
        const response = await apiFetch(`/api/audit/?${params.toString()}`);

        // Da die API aktuell eine Liste zurückgibt (keine Paginierung im Backend implementiert in V1),
        // simulieren wir Paginierung hier oder nehmen alles, was kommt.
        // Für V1 nehmen wir einfach die Liste (Backend liefert 'limit' Einträge).
        const logs = Array.isArray(response) ? response : (response.items || []);

        renderTable(logs);

        // Paginierung UI (Dummy, da Backend V1 nur Limit hat)
        if(paginationContainer) paginationContainer.innerHTML = '';

    } catch (error) {
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #e74c3c;">Fehler: ${error.message}</td></tr>`;
    }
}

function renderTable(logs) {
    tableBody.innerHTML = '';

    if (!logs || logs.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #777;">Keine Einträge gefunden.</td></tr>';
        return;
    }

    logs.forEach(log => {
        const row = document.createElement('tr');

        // Datum formatieren
        const dateObj = new Date(log.timestamp);
        const dateStr = dateObj.toLocaleString('de-DE', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });

        // Betroffenes Datum (Ziel)
        let targetDateStr = '-';
        if (log.target_date) {
            const td = new Date(log.target_date);
            targetDateStr = td.toLocaleDateString('de-DE');
        }

        // Details Logik (Diff anzeigen)
        let detailsHtml = '-';
        if (log.details) {
            if (log.details.old !== undefined || log.details.new !== undefined) {
                // Es ist ein Vorher/Nachher Vergleich
                const oldVal = log.details.old || '<i>Leer</i>';
                const newVal = log.details.new || '<i>Leer</i>';
                detailsHtml = `<span class="diff-old">${oldVal}</span> &rarr; <span class="diff-new">${newVal}</span>`;
            } else {
                // Anderes JSON Objekt
                detailsHtml = `<span class="detail-text">${JSON.stringify(log.details).substring(0, 50)}</span>`;
            }
        }

        // Badge Styling
        let badgeClass = '';
        if (log.action.includes('UPDATE')) badgeClass = 'badge-update';
        else if (log.action.includes('CREATE') || log.action === 'LOGIN') badgeClass = 'badge-create';
        else if (log.action.includes('DELETE') || log.action.includes('CLEAR')) badgeClass = 'badge-delete';
        else badgeClass = 'badge-update'; // Fallback

        row.innerHTML = `
            <td style="font-family: monospace; font-size: 0.9em;">${dateStr}</td>
            <td><strong>${log.user_name}</strong></td>
            <td><span class="badge ${badgeClass}">${log.action}</span></td>
            <td>${targetDateStr}</td>
            <td>${detailsHtml}</td>
            <td style="font-family: monospace; color: #777; font-size: 0.8em;">${log.ip_address || '-'}</td>
        `;
        tableBody.appendChild(row);
    });
}