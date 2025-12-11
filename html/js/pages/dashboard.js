// html/js/pages/dashboard.js

import { API_URL } from '../utils/constants.js';
import { apiFetch } from '../utils/api.js';
import { initAuthCheck, logout } from '../utils/auth.js';

let user;
let isAdmin = false;

// --- DOM-Elemente (Standard) ---
const manualLogBtn = document.getElementById('manual-log-btn');
const logList = document.getElementById('update-log-list');
const manualModal = document.getElementById('manual-update-modal');
const closeManualModalBtn = document.getElementById('close-manual-log-modal');
const saveManualLogBtn = document.getElementById('save-manual-log-btn');
const logDescriptionField = document.getElementById('log-description');
const logAreaField = document.getElementById('log-area');
const manualLogStatus = document.getElementById('manual-log-status');

// --- NEWS ELEMENTE ---
const newsContainer = document.getElementById('news-container');
const newsText = document.getElementById('news-text');
const newsCheckbox = document.getElementById('news-ack-checkbox');
const newsAdminBtn = document.getElementById('news-admin-btn');
const newsEditModal = document.getElementById('news-edit-modal');
const newsEditTextarea = document.getElementById('news-edit-textarea');
const saveNewsBtn = document.getElementById('save-news-btn');
const closeNewsModalBtn = document.getElementById('close-news-modal');
const newsModalStatus = document.getElementById('news-modal-status');

// --- Gamification Elemente ---
const gamificationCard = document.getElementById('gamification-card');
const userLevelEl = document.getElementById('user-level');
const xpDisplayEl = document.getElementById('xp-display');
const xpProgressEl = document.getElementById('xp-progress');
const balanceMarkerEl = document.getElementById('balance-marker');
const balanceTextEl = document.getElementById('balance-text');
const gamificationLogList = document.getElementById('gamification-log-list');

// --- Balance Elemente (Admin Dashboard) ---
const balanceCard = document.getElementById('balance-card');

// --- 1. Authentifizierung & Init ---
try {
    const authData = initAuthCheck();
    user = authData.user;
    isAdmin = authData.isAdmin;

    if (authData.isVisitor) {
        window.location.href = 'schichtplan.html';
        throw new Error("Besucher dürfen das Dashboard nicht sehen.");
    }

    const welcomeMsg = document.getElementById('welcome-message');
    if (welcomeMsg) welcomeMsg.textContent = `Willkommen, ${user.vorname}!`;

    // --- Admin UI (Obere Karte & Buttons) ---
    if (isAdmin) {
        if(manualLogBtn) manualLogBtn.classList.remove('hidden');
        if(newsAdminBtn) newsAdminBtn.style.display = 'block';

        // Button zum Neuberechnen der Fairness einfügen
        if (document.getElementById('update-log-header')) {
            const headerDiv = document.getElementById('update-log-header');
            if (!headerDiv.querySelector('.recalc-btn')) {
                const recalcBtn = document.createElement('button');
                recalcBtn.textContent = "Fairness neu berechnen";
                recalcBtn.className = "btn-secondary recalc-btn";
                recalcBtn.style.marginLeft = "10px";
                recalcBtn.style.backgroundColor = "#e67e22";
                recalcBtn.onclick = triggerFairnessRecalc;
                headerDiv.appendChild(recalcBtn);
            }
        }

        // Admin-Widget (Obere Liste) laden und anzeigen
        if (balanceCard) {
            balanceCard.style.display = 'grid';
            loadDashboardBalance();
        }

        // --- NEU: Settings Button für Gamification anzeigen ---
        const settingsBtn = document.getElementById('btn-gamification-settings');
        if(settingsBtn) settingsBtn.style.display = 'inline-block';

    } else {
        if(manualLogBtn) manualLogBtn.classList.add('hidden');
        if (balanceCard) balanceCard.style.display = 'none';

        // Settings Button sicherheitshalber ausblenden
        const settingsBtn = document.getElementById('btn-gamification-settings');
        if(settingsBtn) settingsBtn.style.display = 'none';
    }

    // --- Nudging (E-Mail Check) ---
    checkProfileCompleteness(user);

    // --- Standard Daten laden ---
    loadUpdateLog();
    loadAnnouncement();

    // --- FIX: Gamification Widget nur für Hundeführer & Admins ---
    const roleName = (user.role && user.role.name) ? user.role.name.toLowerCase() : '';
    const isAllowedForGamification = ['admin', 'hundeführer', 'hundefuehrer', 'diensthundeführer'].includes(roleName);

    if (isAllowedForGamification) {
        if (gamificationCard) gamificationCard.style.display = 'grid';
        loadGamificationData();
    } else {
        if (gamificationCard) gamificationCard.style.display = 'none';
    }

} catch (e) {
    console.error("Fehler bei der Initialisierung von dashboard.js:", e.message);
}

// --- NEU: Umschalt-Funktion (Persönlich / Rangliste / Historie) ---
window.switchGamificationView = async function(view) {
    const viewPersonal = document.getElementById('view-personal');
    const viewRanking = document.getElementById('view-ranking');
    const viewHistory = document.getElementById('view-history');

    const btnPersonal = document.getElementById('btn-view-personal');
    const btnRanking = document.getElementById('btn-view-ranking');
    const btnHistory = document.getElementById('btn-view-history');

    // 1. Alle ausblenden
    if(viewPersonal) viewPersonal.style.display = 'none';
    if(viewRanking) viewRanking.style.display = 'none';
    if(viewHistory) viewHistory.style.display = 'none';

    // 2. Buttons resetten
    if(btnPersonal) btnPersonal.classList.remove('active');
    if(btnRanking) btnRanking.classList.remove('active');
    if(btnHistory) btnHistory.classList.remove('active');

    // 3. Ansicht wählen
    if (view === 'ranking') {
        if(viewRanking) viewRanking.style.display = 'block';
        if(btnRanking) btnRanking.classList.add('active');
        await loadRankingData();

    } else if (view === 'history') {
        if(viewHistory) viewHistory.style.display = 'block';
        if(btnHistory) btnHistory.classList.add('active');
        await loadHistoryData();

    } else {
        // Persönlich (Default)
        if(viewPersonal) viewPersonal.style.display = 'contents';
        if(btnPersonal) btnPersonal.classList.add('active');
    }
};

// --- NEU: Admin Settings Logik ---
window.openGamificationSettings = async function() {
    const modal = document.getElementById('gamification-settings-modal');
    if(modal) modal.style.display = 'block';

    // Aktuelle Werte laden
    try {
        const settings = await apiFetch('/api/gamification/settings');
        document.getElementById('xp-tag-workday').value = settings.xp_tag_workday;
        document.getElementById('xp-tag-weekend').value = settings.xp_tag_weekend;
        document.getElementById('xp-night').value = settings.xp_night;
        document.getElementById('xp-24h').value = settings.xp_24h;
        document.getElementById('xp-friday-6').value = settings.xp_friday_6;
        document.getElementById('xp-health-bonus').value = settings.xp_health_bonus;
        document.getElementById('xp-holiday-mult').value = settings.xp_holiday_mult;
    } catch(e) {
        console.error("Error loading settings", e);
        alert("Fehler beim Laden der Einstellungen: " + e.message);
    }
};

window.closeGamificationSettings = function() {
    const modal = document.getElementById('gamification-settings-modal');
    if(modal) modal.style.display = 'none';
};

const saveSettingsBtn = document.getElementById('save-gamification-settings-btn');
if(saveSettingsBtn) {
    saveSettingsBtn.onclick = async function() {
        const btn = this;
        btn.disabled = true;
        const statusEl = document.getElementById('gamification-settings-status');
        if(statusEl) {
            statusEl.textContent = "Speichere und berechne neu...";
            statusEl.style.color = "#bdc3c7";
        }

        const payload = {
            xp_tag_workday: document.getElementById('xp-tag-workday').value,
            xp_tag_weekend: document.getElementById('xp-tag-weekend').value,
            xp_night: document.getElementById('xp-night').value,
            xp_24h: document.getElementById('xp-24h').value,
            xp_friday_6: document.getElementById('xp-friday-6').value,
            xp_health_bonus: document.getElementById('xp-health-bonus').value,
            xp_holiday_mult: document.getElementById('xp-holiday-mult').value
        };

        try {
            await apiFetch('/api/gamification/settings', 'PUT', payload);
            if(statusEl) {
                statusEl.textContent = "Erfolgreich!";
                statusEl.style.color = "#2ecc71";
            }

            setTimeout(() => {
                window.closeGamificationSettings();
                alert("Einstellungen gespeichert. Punkte wurden für alle Benutzer neu berechnet.");
                window.location.reload();
            }, 500);
        } catch(e) {
            if(statusEl) {
                statusEl.textContent = "Fehler: " + e.message;
                statusEl.style.color = "#e74c3c";
            }
            btn.disabled = false;
        }
    };
}

// --- Ranking Daten laden ---
async function loadRankingData() {
    const tbody = document.getElementById('ranking-table-body');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:#bdc3c7;">Lade Rangliste...</td></tr>';

    try {
        const ranking = await apiFetch('/api/gamification/ranking');
        tbody.innerHTML = '';

        if (!ranking || ranking.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px;">Keine Daten verfügbar.</td></tr>';
            return;
        }

        ranking.forEach(entry => {
            const tr = document.createElement('tr');

            if (user && user.id === entry.user_id) {
                tr.style.backgroundColor = "rgba(52, 152, 219, 0.2)";
            } else {
                tr.style.borderBottom = "1px solid rgba(255,255,255,0.05)";
            }

            let rankIcon = `<span style="color:#7f8c8d; font-weight:bold; font-size: 0.9em;">${entry.position}.</span>`;
            if (entry.position === 1) rankIcon = '🥇';
            if (entry.position === 2) rankIcon = '🥈';
            if (entry.position === 3) rankIcon = '🥉';

            tr.innerHTML = `
                <td style="padding: 12px 10px; font-size: 1.2em; text-align: center;">${rankIcon}</td>
                <td style="padding: 12px 10px;">
                    <div style="font-weight: 600; color: #fff;">${entry.name} ${user && user.id === entry.user_id ? '(Du)' : ''}</div>
                </td>
                <td style="padding: 12px 10px;">
                    <span style="color: ${entry.rank_color}; border: 1px solid ${entry.rank_color}; padding: 2px 6px; border-radius: 4px; font-size: 0.85em; white-space: nowrap;">
                        ${entry.rank_title} <span style="opacity:0.7; font-size:0.9em;">(Lvl ${entry.level})</span>
                    </span>
                </td>
                <td style="padding: 12px 10px; text-align: right; font-family: monospace; font-size: 1.1em; color: #FFD700;">
                    ${entry.points.toLocaleString()} XP
                </td>
            `;
            tbody.appendChild(tr);
        });

    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="4" style="color:#e74c3c; text-align:center; padding:20px;">Fehler: ${e.message}</td></tr>`;
    }
}

// --- Historie laden ---
async function loadHistoryData() {
    const tbody = document.getElementById('history-table-body');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:20px; color:#bdc3c7;">Lade Historie...</td></tr>';

    try {
        const history = await apiFetch('/api/gamification/history');
        tbody.innerHTML = '';

        if (!history || history.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:20px; font-style:italic;">Noch keine Punkte gesammelt.</td></tr>';
            return;
        }

        history.forEach(entry => {
            const tr = document.createElement('tr');

            const isPositive = entry.points_awarded > 0;
            const sign = isPositive ? '+' : '';
            const colorClass = isPositive ? 'text-green' : (entry.points_awarded < 0 ? 'text-red' : '');

            tr.style.borderBottom = "1px solid rgba(255,255,255,0.05)";

            tr.innerHTML = `
                <td style="padding: 12px 10px; font-size: 0.9em; color: #bdc3c7;">
                    ${entry.created_at}
                </td>
                <td style="padding: 12px 10px;">
                    ${entry.description || '-'}
                </td>
                <td style="padding: 12px 10px; text-align: right; font-weight: bold;" class="${colorClass}">
                    ${sign}${entry.points_awarded} XP
                </td>
            `;
            tbody.appendChild(tr);
        });

    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="3" style="color:#e74c3c; text-align:center; padding:20px;">Fehler: ${e.message}</td></tr>`;
    }
}

// --- Admin Widget: Jahresbilanz ---
async function loadDashboardBalance() {
    const year = new Date().getFullYear();
    const badge = document.getElementById('balance-year-badge');
    if(badge) badge.innerText = `Jahr ${year}`;

    const loadingDiv = document.getElementById('balanceLoading');
    const contentDiv = document.getElementById('balanceTableContainer');
    const errorDiv = document.getElementById('dashboardBalanceError');
    const tbody = document.getElementById('dashboardBalanceBody');

    try {
        const response = await apiFetch(`/api/shift-plans/0/weekend-balance?year=${year}`);

        if(tbody) tbody.innerHTML = '';
        const users = response.data;

        if (!users || users.length === 0) {
            if(tbody) tbody.innerHTML = '<tr><td colspan="3" class="text-center py-3">Keine Daten verfügbar</td></tr>';
        } else {
            users.forEach(user => {
                const tr = document.createElement('tr');

                let barClass = 'bg-green';
                let textClass = 'text-green';

                if (user.percentage > 45) {
                    barClass = 'bg-red';
                    textClass = 'text-red';
                } else if (user.percentage > 30) {
                    barClass = 'bg-yellow';
                    textClass = 'text-yellow';
                }

                let nameBadge = '';
                if (user.possible_weekends < 12) {
                    nameBadge = '<span style="background:#3498db; color:white; font-size:10px; padding:2px 5px; border-radius:4px; margin-left:5px;">Neu</span>';
                }

                const fInitial = user.first_name ? user.first_name.charAt(0) : '?';
                const lInitial = user.last_name ? user.last_name.charAt(0) : '?';
                const initials = (fInitial + lInitial).toUpperCase();

                tr.innerHTML = `
                    <td>
                        <div style="display:flex; align-items:center;">
                            <div class="avatar-circle">${initials}</div>
                            <div>
                                <span style="display:block; font-weight:600; font-size:14px; color:#fff;">
                                    ${user.last_name}, ${user.first_name.charAt(0)}.${nameBadge}
                                </span>
                                <small style="color:#7f8c8d; font-size:11px;">
                                    ${user.actual_weekends} von ${user.possible_weekends} WE
                                </small>
                            </div>
                        </div>
                    </td>
                    <td style="text-align: center;">
                        <span class="${textClass}" style="font-weight:bold; font-size:13px;">${user.percentage}%</span>
                    </td>
                    <td>
                        <div class="table-progress">
                            <div class="table-progress-bar ${barClass}" style="width: ${user.percentage}%"></div>
                        </div>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }

        if(loadingDiv) loadingDiv.style.display = 'none';
        if(contentDiv) contentDiv.style.display = 'block';

    } catch (error) {
        console.error("Dashboard Balance Fehler:", error);
        if(loadingDiv) loadingDiv.style.display = 'none';
        if(errorDiv) {
            errorDiv.innerText = "Daten konnten nicht geladen werden.";
            errorDiv.style.display = 'block';
        }
    }
}

// --- Helper: Nudge (Profil vervollständigen) ---
function checkProfileCompleteness(currentUser) {
    if (!currentUser.email || currentUser.email.trim() === "") {
        const cardSection = document.querySelector('.card-section');
        if (cardSection && !document.getElementById('email-nudge')) {
            const alertDiv = document.createElement('div');
            alertDiv.id = 'email-nudge';
            alertDiv.style.backgroundColor = "rgba(243, 156, 18, 0.2)";
            alertDiv.style.border = "1px solid #f39c12";
            alertDiv.style.borderRadius = "8px";
            alertDiv.style.padding = "15px";
            alertDiv.style.marginBottom = "20px";
            alertDiv.style.color = "#ffffff";
            alertDiv.style.display = "flex";
            alertDiv.style.alignItems = "center";
            alertDiv.style.justifyContent = "space-between";

            alertDiv.innerHTML = `
                <div>
                    <strong style="color: #f39c12;">Profil unvollständig!</strong><br>
                    <span style="font-size: 13px; color: #ddd;">
                        Bitte hinterlegen Sie Ihre E-Mail-Adresse.
                    </span>
                </div>
                <a href="profile.html" class="btn-primary" style="text-decoration:none; font-size:13px; padding: 8px 15px; margin-left: 10px;">Jetzt eintragen</a>
            `;
            cardSection.prepend(alertDiv);
        }
    }
}

// --- Admin Button Action (Fallback Manuell) ---
async function triggerFairnessRecalc() {
    if(!confirm("Möchten Sie die Fairness-Werte (Wochenend-Dienste) für ALLE Mitarbeiter basierend auf dem aktuellen Jahr neu berechnen? Dies kann einen Moment dauern.")) return;

    try {
        const response = await apiFetch('/api/gamification/recalc', 'POST');
        alert("Erfolg: " + response.message);
        window.location.reload();
    } catch (e) {
        alert("Fehler bei der Berechnung: " + e.message);
    }
}

// --- Persönliches Gamification Widget ---
async function loadGamificationData() {
    if (!gamificationCard) return;

    try {
        const data = await apiFetch('/api/gamification/dashboard');

        // Level & XP
        if(userLevelEl) userLevelEl.textContent = data.stats.current_level;

        const currentLevelXp = data.stats.points_total % 1000;
        if(xpDisplayEl) xpDisplayEl.textContent = `${currentLevelXp} / 1000 XP`;
        if(xpProgressEl) xpProgressEl.style.width = `${(currentLevelXp / 1000) * 100}%`;

        // Balance
        let balanceVal = data.stats.weekend_balance;
        let displayVal = Math.max(-48, Math.min(48, balanceVal));

        if(balanceMarkerEl) {
            balanceMarkerEl.style.left = `${50 + displayVal}%`;
            if (balanceVal > 20) balanceMarkerEl.style.borderColor = "#e74c3c";
            else if (balanceVal < -20) balanceMarkerEl.style.borderColor = "#f1c40f";
            else balanceMarkerEl.style.borderColor = "#2ecc71";
        }

        if(balanceTextEl) {
            const sign = balanceVal > 0 ? '+' : '';
            const percentStr = `(${sign}${balanceVal}%)`;

            if (balanceVal > 5) {
                balanceTextEl.textContent = `Du übernimmst ${balanceVal}% mehr Wochenend-Dienste als der Durchschnitt. Vielen Dank für deinen Einsatz!`;
                balanceTextEl.style.color = "#2ecc71";
            } else if (balanceVal < -5) {
                balanceTextEl.textContent = `Du hast aktuell ${Math.abs(balanceVal)}% weniger Wochenend-Dienste als der Durchschnitt.`;
                balanceTextEl.style.color = "#bdc3c7";
            } else {
                balanceTextEl.textContent = `Deine Wochenend-Bilanz ist perfekt ausgeglichen ${percentStr}.`;
                balanceTextEl.style.color = "#3498db";
            }
        }

        // Logs
        if(gamificationLogList) {
            gamificationLogList.innerHTML = '';
            if (data.logs && data.logs.length > 0) {
                data.logs.forEach(log => {
                    const div = document.createElement('div');
                    div.className = 'gamification-log-item';
                    const dateObj = new Date(log.created_at);

                    div.innerHTML = `
                        <div>
                            <span style="display:block; font-weight:600; color:#ecf0f1;">${log.description || log.action_type}</span>
                            <span style="font-size:11px; color:#7f8c8d;">${log.created_at}</span>
                        </div>
                        <div class="points-positive">+${log.points_awarded} XP</div>
                    `;
                    gamificationLogList.appendChild(div);
                });
            } else {
                gamificationLogList.innerHTML = '<p style="color: #777; font-style: italic; font-size:13px;">Noch keine Punkte gesammelt.</p>';
            }
        }

        if (gamificationCard) gamificationCard.style.display = 'grid';

    } catch (error) {
        console.error("Konnte Gamification-Daten nicht laden:", error);
    }
}

// --- Standard News Logic & Event Listeners (Unverändert) ---

async function loadAnnouncement() {
    if (!newsText) return;

    try {
        const data = await apiFetch('/api/announcement');

        if (!data.message) {
            newsText.textContent = "Keine aktuellen Mitteilungen.";
            newsText.style.color = "#777";
            if(newsCheckbox) {
                newsCheckbox.checked = true;
                newsCheckbox.disabled = true;
            }
            document.body.classList.remove('nav-locked');
            return;
        }

        newsText.textContent = data.message;
        newsText.style.color = "#ecf0f1";

        if (data.is_read) {
            if(newsCheckbox) newsCheckbox.checked = true;
            if(newsContainer) newsContainer.classList.remove('unread');
            document.body.classList.remove('nav-locked');
        } else {
            if(newsCheckbox) newsCheckbox.checked = false;
            if(newsContainer) newsContainer.classList.add('unread');
            document.body.classList.add('nav-locked');
        }

    } catch (error) {
        if(newsText) newsText.textContent = "Fehler beim Laden der Mitteilungen.";
        console.error(error);
    }
}

if (newsCheckbox) {
    newsCheckbox.addEventListener('change', async (e) => {
        if (e.target.checked) {
            try {
                await apiFetch('/api/announcement/ack', 'POST');
                if(newsContainer) newsContainer.classList.remove('unread');
                document.body.classList.remove('nav-locked');
            } catch (error) {
                alert("Fehler beim Bestätigen: " + error.message);
                e.target.checked = false;
            }
        }
    });
}

if (newsAdminBtn) {
    newsAdminBtn.onclick = () => {
        if (newsEditTextarea) {
            newsEditTextarea.value = (newsText.textContent === "Keine aktuellen Mitteilungen." || newsText.textContent === "Fehler beim Laden der Mitteilungen.") ? "" : newsText.textContent;
        }
        if (newsEditModal) {
            newsEditModal.style.display = 'block';
            if(newsModalStatus) newsModalStatus.textContent = '';
        }
    };
}

if (closeNewsModalBtn) {
    closeNewsModalBtn.onclick = () => {
        if (newsEditModal) newsEditModal.style.display = 'none';
    };
}

if (saveNewsBtn) {
    saveNewsBtn.onclick = async () => {
        saveNewsBtn.disabled = true;
        if(newsModalStatus) {
            newsModalStatus.textContent = 'Speichere...';
            newsModalStatus.style.color = '#bdc3c7';
        }

        try {
            await apiFetch('/api/announcement', 'PUT', {
                message: newsEditTextarea.value
            });
            if(newsModalStatus) {
                newsModalStatus.textContent = 'Gespeichert!';
                newsModalStatus.style.color = '#2ecc71';
            }

            setTimeout(() => {
                if (newsEditModal) newsEditModal.style.display = 'none';
                loadAnnouncement();
            }, 1000);
        } catch (error) {
            if(newsModalStatus) {
                newsModalStatus.textContent = 'Fehler: ' + error.message;
                newsModalStatus.style.color = '#e74c3c';
            }
        } finally {
            saveNewsBtn.disabled = false;
        }
    };
}

async function loadUpdateLog() {
    if (!logList) return;

    try {
        const logs = await apiFetch('/api/updatelog');

        if (logs.length === 0) {
            logList.innerHTML = '<li style="padding: 10px 0;">Keine Update-Einträge gefunden.</li>';
            return;
        }

        logList.innerHTML = '';
        logs.forEach(log => {
            const date = new Date(log.updated_at);
            const formattedDate = date.toLocaleDateString('de-DE', {
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit'
            });

            const deleteButtonHTML = isAdmin
                                   ? `<button class="delete-log-btn" data-log-id="${log.id}">×</button>`
                                   : '';
            const li = document.createElement('li');
            li.className = 'log-item';
            li.dataset.logId = log.id;
            li.innerHTML = `
                <div class="log-content">
                    <span class="log-area">${log.area}</span>
                    <span>${log.description}</span>
                    <span class="log-date">${formattedDate} Uhr</span>
                </div>
                ${deleteButtonHTML}
            `;
            logList.appendChild(li);
        });

    } catch (error) {
        logList.innerHTML = `<li style="color: #e74c3c; padding: 10px 0;">Fehler beim Laden der Updates: ${error.message}</li>`;
    }
}

async function deleteLogEntry(logId, listItem) {
    if (!confirm(`Sicher, dass Sie den Log-Eintrag #${logId} löschen möchten?`)) {
        return;
    }
    try {
        await apiFetch(`/api/updatelog/${logId}`, 'DELETE');
        listItem.style.opacity = 0;
        setTimeout(() => listItem.remove(), 300);
    } catch (error) {
        alert('Fehler beim Löschen des Eintrags: ' + error.message);
    }
}

document.addEventListener('click', (event) => {
    const target = event.target;
    if (isAdmin && target.classList.contains('delete-log-btn')) {
        const logId = target.dataset.logId;
        const listItem = target.closest('.log-item');
        if (logId && listItem) {
            deleteLogEntry(logId, listItem);
        }
    }
});

if (manualLogBtn) {
    manualLogBtn.onclick = () => {
        if (!isAdmin || !manualModal) return;
        if(logDescriptionField) logDescriptionField.value = '';
        if(logAreaField) logAreaField.value = '';
        if(manualLogStatus) manualLogStatus.textContent = '';
        manualModal.style.display = 'block';
    };
}

if (closeManualModalBtn) {
    closeManualModalBtn.onclick = () => {
        if(manualModal) manualModal.style.display = 'none';
    };
}

if (saveManualLogBtn) {
    saveManualLogBtn.onclick = async () => {
        const description = logDescriptionField.value.trim();
        const area = logAreaField.value.trim();
        if (description.length < 5) {
            if(manualLogStatus) manualLogStatus.textContent = "Bitte geben Sie eine detailliertere Beschreibung ein (min. 5 Zeichen).";
            return;
        }

        saveManualLogBtn.disabled = true;
        if(manualLogStatus) {
            manualLogStatus.textContent = 'Speichere Protokoll...';
            manualLogStatus.style.color = '#bdc3c7';
        }

        const payload = { description: description };
        if (area) payload.area = area;

        try {
            await apiFetch('/api/manual_update_log', 'POST', payload);
            if(manualLogStatus) {
                manualLogStatus.textContent = 'Protokoll erfolgreich gespeichert!';
                manualLogStatus.style.color = '#2ecc71';
            }
            await loadUpdateLog();
            setTimeout(() => { if(manualModal) manualModal.style.display = 'none'; }, 1000);
        } catch (error) {
            if(manualLogStatus) {
                 manualLogStatus.textContent = 'Fehler beim Speichern: ' + error.message;
                 manualLogStatus.style.color = '#e74c3c';
            }
        } finally {
            saveManualLogBtn.disabled = false;
        }
    };
}

window.onclick = (event) => {
    // Schließen aller möglichen Modals bei Klick außerhalb
    const rModal = document.getElementById('ranking-modal'); // (Falls noch Reste da sind)
    const manualModal = document.getElementById('manual-update-modal');
    const newsEditModal = document.getElementById('news-edit-modal');
    const settingsModal = document.getElementById('gamification-settings-modal');

    if (event.target == manualModal && manualModal) manualModal.style.display = 'none';
    if (event.target == newsEditModal && newsEditModal) newsEditModal.style.display = 'none';
    if (event.target == settingsModal && settingsModal) settingsModal.style.display = 'none';
};