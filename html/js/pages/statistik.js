// html/js/pages/statistik.js

// KORREKTUR: Pfade angepasst (../utils statt ./js/utils)
import { apiFetch } from '../utils/api.js';
import { initAuthCheck } from '../utils/auth.js';

// --- Globales Setup ---
let user;
let isAdmin = false;

// DOM Elemente
const yearSelect = document.getElementById('filter-year');
const monthSelect = document.getElementById('filter-month');
const refreshBtn = document.getElementById('refresh-stats-btn');
const statsGrid = document.getElementById('stats-grid');

// Modal Elemente
const detailModal = document.getElementById('detail-modal');
const closeModalBtn = document.getElementById('close-detail-modal');
const modalUserName = document.getElementById('modal-user-name');
const modalSubtitle = document.getElementById('modal-subtitle');
const detailTableBody = document.getElementById('detail-table-body');
const detailTotalCount = document.getElementById('detail-total-count');
const detailTotalHours = document.getElementById('detail-total-hours');

// --- 1. Authentifizierung ---
try {
    const authData = initAuthCheck();
    user = authData.user;
    isAdmin = authData.isAdmin;

    // Admin ODER explizit freigeschaltet
    const hasAccess = isAdmin || (user.can_see_statistics === true);

    if (!hasAccess) {
        document.getElementById('content-wrapper').innerHTML = `
            <div class="restricted-view">
                <h2 style="color: #e74c3c;">Zugriff verweigert</h2>
                <p>Sie haben keine Berechtigung, die Statistiken einzusehen.</p>
                <p>Bitte nutzen Sie den Link zum <a href="schichtplan.html" style="color: #3498db;">Schichtplan</a>.</p>
            </div>
        `;
        const filterBar = document.querySelector('.filter-bar');
        if(filterBar) filterBar.style.display = 'none';

        throw new Error("Keine Rechte für Statistik.");
    }

    // Wenn Auth OK: Initialisierung starten
    initializePage();

} catch (e) {
    console.error("Statistik Init Error:", e);
    // Falls Container existiert, Fehler anzeigen (hilft beim Debuggen)
    if(statsGrid) {
        statsGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #e74c3c;">Initialisierungsfehler: ${e.message}</div>`;
    }
}

// --- 2. Initialisierung ---
function initializePage() {
    populateYearDropdown();

    // Event Listener
    if(refreshBtn) refreshBtn.onclick = loadStats;

    // Modal schließen
    if(closeModalBtn) closeModalBtn.onclick = () => detailModal.style.display = 'none';

    window.onclick = (event) => {
        if (event.target == detailModal) detailModal.style.display = 'none';
    };

    // Erstes Laden sofort ausführen
    loadStats();
}

function populateYearDropdown() {
    if(!yearSelect) return;
    const currentYear = new Date().getFullYear();
    yearSelect.innerHTML = ''; // Reset
    // Zeige aktuelles Jahr, 1 Jahr Zukunft, 5 Jahre Vergangenheit
    for (let y = currentYear + 1; y >= currentYear - 5; y--) {
        const option = document.createElement('option');
        option.value = y;
        option.textContent = y;
        if (y === currentYear) option.selected = true;
        yearSelect.appendChild(option);
    }
}

// --- 3. Daten laden & Rendern ---
async function loadStats() {
    if(!yearSelect || !monthSelect) return;

    const year = yearSelect.value;
    const month = monthSelect.value;

    if(refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Lade...';
    }

    if(statsGrid) {
        statsGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #bdc3c7;">Lade Daten...</div>';
    }

    try {
        const url = `/api/statistics/rankings?year=${year}&month=${month}`;
        const response = await apiFetch(url);

        renderRankings(response.data);

    } catch (error) {
        console.error("Ladefehler:", error);
        if(statsGrid) {
            statsGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #e74c3c;">
                Fehler beim Laden: ${error.message}<br>
                <small>Prüfen Sie die Konsole (F12) für Details.</small>
            </div>`;
        }
    } finally {
        if(refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.textContent = 'Anzeigen';
        }
    }
}

function renderRankings(data) {
    if(!statsGrid) return;
    statsGrid.innerHTML = '';

    const keys = Object.keys(data);
    if (keys.length === 0) {
        statsGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #bdc3c7;">Keine Daten für diesen Zeitraum gefunden.</div>';
        return;
    }

    // Durch alle Schichtarten iterieren
    keys.forEach(abbr => {
        const category = data[abbr];
        const meta = category.meta;
        const rankings = category.rankings; // Liste von {user_id, name, count}

        // Erstelle Karte
        const card = document.createElement('div');
        card.className = 'stat-card';

        // Header
        const headerHtml = `
            <div class="stat-header" style="border-left: 5px solid ${meta.color || '#fff'};">
                <span>${meta.name} (${abbr})</span>
                <span style="font-size: 0.8em; opacity: 0.7;">Gesamt: ${rankings.reduce((a, b) => a + b.count, 0)}</span>
            </div>
        `;

        // Body: Liste der User
        let listHtml = '<ul class="ranking-list">';

        rankings.forEach((user, index) => {
            const rank = index + 1;
            let rankClass = '';
            if (rank === 1) rankClass = 'rank-1';
            else if (rank === 2) rankClass = 'rank-2';
            else if (rank === 3) rankClass = 'rank-3';

            // WICHTIG: data-userid Attribut korrekt setzen
            listHtml += `
                <li class="ranking-item ${rankClass}" data-userid="${user.user_id}" data-username="${user.name}">
                    <span class="rank-pos">${rank}.</span>
                    <span class="rank-name">${user.name}</span>
                    <span class="rank-count">${user.count}</span>
                </li>
            `;
        });

        if (rankings.length === 0) {
            listHtml += '<li class="ranking-item" style="color: #777; justify-content: center;">Keine Einträge</li>';
        }

        listHtml += '</ul>';

        card.innerHTML = headerHtml + `<div class="stat-body">${listHtml}</div>`;
        statsGrid.appendChild(card);
    });

    // Event Listener für die dynamisch erstellten Items hinzufügen
    // (Verhindert Inline-JS Probleme in Modulen)
    document.querySelectorAll('.ranking-item').forEach(item => {
        item.addEventListener('click', (e) => {
            // Falls keine Einträge ("Keine Einträge"), nichts tun
            if (!item.dataset.userid) return;

            const uid = item.dataset.userid;
            const uname = item.dataset.username;
            openUserDetail(uid, uname);
        });
    });
}

// --- 4. Detail-Ansicht ---
async function openUserDetail(userId, userName) {
    if(!detailModal) return;

    modalUserName.textContent = userName;
    const year = yearSelect.value;
    modalSubtitle.textContent = `Statistik für das Jahr ${year}`;

    detailTableBody.innerHTML = '<tr><td colspan="3" style="text-align:center;">Lade Details...</td></tr>';
    detailTotalCount.textContent = '-';
    detailTotalHours.textContent = '-';

    detailModal.style.display = 'block';

    try {
        const response = await apiFetch(`/api/statistics/user_details/${userId}?year=${year}`);
        renderUserDetailTable(response);
    } catch (error) {
        detailTableBody.innerHTML = `<tr><td colspan="3" style="text-align:center; color: #e74c3c;">Fehler: ${error.message}</td></tr>`;
    }
}

function renderUserDetailTable(data) {
    const breakdown = data.breakdown;
    detailTableBody.innerHTML = '';

    if (breakdown.length === 0) {
        detailTableBody.innerHTML = '<tr><td colspan="3" style="text-align:center;">Keine Schichten in diesem Jahr.</td></tr>';
        detailTotalCount.textContent = '0';
        detailTotalHours.textContent = '0.0';
        return;
    }

    let totalC = 0;
    // Gesamthours kommen vom Backend, oder wir summieren hier
    let totalH = data.total_hours !== undefined ? data.total_hours : 0;

    breakdown.forEach(row => {
        totalC += row.count;
        const tr = document.createElement('tr');
        tr.className = 'detail-row';
        tr.innerHTML = `
            <td>
                <span style="display:inline-block; width:12px; height:12px; background-color:${row.color}; border-radius:2px; margin-right:8px;"></span>
                ${row.name} (${row.type})
            </td>
            <td>${row.count}</td>
            <td>${row.hours.toFixed(1)}</td>
        `;
        detailTableBody.appendChild(tr);
    });

    detailTotalCount.textContent = totalC;
    detailTotalHours.textContent = totalH.toFixed(1);
}