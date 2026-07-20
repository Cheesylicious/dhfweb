// html/feedback.js

import { API_URL } from './js/utils/constants.js';
import { apiFetch } from './js/utils/api.js';
import { initAuthCheck, logout } from './js/utils/auth.js';

// --- Globales Setup ---
let user;
let isAdmin = false;

// 1. Auth Check
try {
    const authData = initAuthCheck();
    user = authData.user;
    isAdmin = authData.isAdmin;

    // --- Zugriffsschutz (Nur Admin) ---
    if (!isAdmin) {
        document.getElementById('content-wrapper').innerHTML = `
            <div class="restricted-view">
                <h2 style="color: #e74c3c;">Zugriff verweigert</h2>
                <p>Nur Administratoren haben Zugriff auf die Meldungsverwaltung.</p>
            </div>
        `;
        throw new Error("Keine Admin-Rechte.");
    }

    // --- NAVIGATION ANPASSEN (Fix für fehlende Links) ---

    // Statistik-Link anzeigen
    const navStatistik = document.getElementById('nav-statistik');
    if(navStatistik && (isAdmin || user.can_see_statistics)) {
        navStatistik.style.display = 'inline-flex';
    }

    // NEU: E-Mails Link anzeigen (hatte gefehlt)
    const navEmails = document.getElementById('nav-emails');
    if(navEmails && isAdmin) {
        navEmails.style.display = 'inline-flex';
    }

} catch (e) {
    console.error("Feedback Init Error:", e);
}

// --- Seitenlogik für Meldungs-LISTE ---

const feedbackList = document.getElementById('feedback-list');
const filterButtonsContainer = document.querySelector('.filter-buttons');
let currentFilter = ""; // (Startet mit "Alle")
let reportsCache = [];

const trackerModal = document.getElementById('tracker-publish-modal');
const trackerSource = document.getElementById('tracker-source');
const trackerTitle = document.getElementById('tracker-title');
const trackerDescription = document.getElementById('tracker-description');
const trackerStatus = document.getElementById('tracker-status');
const trackerProgress = document.getElementById('tracker-progress');
const trackerProgressValue = document.getElementById('tracker-progress-value');
const trackerStatusNote = document.getElementById('tracker-status-note');
const trackerModalError = document.getElementById('tracker-modal-error');
const trackerModalSave = document.getElementById('tracker-modal-save');
let currentPublishReport = null;

async function loadReports() {
    if (!feedbackList) return;
    feedbackList.innerHTML = '<li>Lade Meldungen...</li>';

    try {
        const reports = await apiFetch(`/api/feedback?status=${currentFilter}`);
        reportsCache = reports || [];
        renderReports(reports);
    } catch (error) {
        feedbackList.innerHTML = `<li style="color: var(--status-neu); padding: 20px;">Fehler beim Laden: ${error.message}</li>`;
    }
}

function renderReports(reports) {
    if (!feedbackList) return;
    feedbackList.innerHTML = '';

    if (!reports || reports.length === 0) {
        feedbackList.innerHTML = '<li style="color: #bdc3c7; padding: 20px; text-align: center;">Keine Meldungen für diesen Filter gefunden.</li>';
        return;
    }

    // Sortieren: Neueste zuerst
    reports.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    reports.forEach(report => {
        const li = document.createElement('li');
        li.className = 'feedback-item';
        li.dataset.id = report.id;

        const reportDate = new Date(report.created_at).toLocaleString('de-DE', {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });

        let actionButtons = '';
        if (report.status !== 'gesehen') {
            actionButtons += `<button class="btn-seen" data-action="gesehen">Als 'gesehen' markieren</button>`;
        }
        if (report.status !== 'archiviert') {
            actionButtons += `<button class="btn-archive" data-action="archiviert">Archivieren</button>`;
        }
        if (report.status !== 'neu') {
             actionButtons += `<button class="btn-new" data-action="neu">Zurück auf 'Neu'</button>`;
        }
        if (report.public_item) {
            actionButtons += `<a class="btn-board-link" href="status_board.html?edit=${report.public_item.id}">📋 Im Status-Board bearbeiten</a>`;
        } else {
            actionButtons += `<button class="btn-board" data-action="publish">📋 Ins Status-Board aufnehmen</button>`;
        }

        li.innerHTML = `
            <div class="item-header" data-action="toggle-body">
                <span>Von: <strong>${escapeHTML(report.user_name)}</strong></span>
                <span>Kategorie: <strong>${escapeHTML(report.category)} (${escapeHTML(report.report_type)})</strong></span>
                <span>Gemeldet am: <strong>${reportDate} Uhr</strong></span>
                <span class="item-status" data-status="${report.status}">${report.status}</span>
            </div>
            <div class="item-body">
                <p>${escapeHTML(report.message)}</p>
                <div class="item-actions">
                    ${actionButtons}
                    <button class="btn-delete" data-action="delete">Löschen</button>
                </div>
            </div>
        `;
        feedbackList.appendChild(li);
    });
}

async function handleUpdateStatus(id, newStatus) {
    const item = feedbackList.querySelector(`.feedback-item[data-id="${id}"]`);
    if (!item) return;

    try {
        await apiFetch(`/api/feedback/${id}`, 'PUT', { status: newStatus });

        // Wenn der neue Status nicht dem Filter entspricht, ausblenden
        if (currentFilter && currentFilter !== newStatus) {
            item.classList.add('fade-out');
            setTimeout(() => {
                item.remove();
                if(feedbackList.children.length === 0) {
                     feedbackList.innerHTML = '<li style="color: #bdc3c7; padding: 20px; text-align: center;">Keine Meldungen für diesen Filter gefunden.</li>';
                }
            }, 550);

        } else {
            const statusBadge = item.querySelector('.item-status');
            if(statusBadge) {
                statusBadge.dataset.status = newStatus;
                statusBadge.textContent = newStatus;
            }
            loadReports();
        }

        // Trigger Update für Banner
        if(window.triggerNotificationUpdate) window.triggerNotificationUpdate();

    } catch (error) {
        alert(`Fehler beim Aktualisieren: ${error.message}`);
    }
}

async function handleDelete(id) {
    const item = feedbackList.querySelector(`.feedback-item[data-id="${id}"]`);
    if (!item) return;

    if (!confirm("Sind Sie sicher, dass Sie diese Meldung endgültig löschen möchten?")) {
        return;
    }

    try {
        await apiFetch(`/api/feedback/${id}`, 'DELETE');
        item.classList.add('fade-out');
        setTimeout(() => item.remove(), 500);

        if(window.triggerNotificationUpdate) window.triggerNotificationUpdate();

    } catch (error) {
        alert(`Fehler beim Löschen: ${error.message}`);
    }
}

function updateTrackerProgressLabel() {
    if (trackerProgressValue && trackerProgress) {
        trackerProgressValue.textContent = `${trackerProgress.value} %`;
    }
}

function closeTrackerModal() {
    if (!trackerModal) return;
    trackerModal.style.display = 'none';
    trackerModal.setAttribute('aria-hidden', 'true');
    currentPublishReport = null;
}

function openTrackerModal(report) {
    if (!trackerModal || !report) return;
    currentPublishReport = report;

    const firstLine = (report.message || '').trim().split(/\r?\n/)[0];
    const suggestedTitle = firstLine.length > 150
        ? `${firstLine.substring(0, 147)}...`
        : firstLine;

    trackerSource.textContent = `Originalmeldung von ${report.user_name}:\n${report.message}`;
    trackerTitle.value = suggestedTitle || `${report.category}: Neue Meldung`;
    trackerDescription.value = report.message || '';
    trackerStatus.value = 'aufgenommen';
    trackerProgress.value = '0';
    trackerStatusNote.value = 'Die Meldung wurde aufgenommen und wird geprüft.';
    trackerModalError.textContent = '';
    trackerModalSave.disabled = false;
    trackerModalSave.textContent = 'Veröffentlichen';
    updateTrackerProgressLabel();

    trackerModal.style.display = 'block';
    trackerModal.setAttribute('aria-hidden', 'false');
    setTimeout(() => trackerTitle.focus(), 50);
}

async function publishCurrentReport() {
    if (!currentPublishReport) return;

    const payload = {
        title: trackerTitle.value.trim(),
        description: trackerDescription.value.trim(),
        public_status: trackerStatus.value,
        progress: Number(trackerProgress.value),
        status_note: trackerStatusNote.value.trim()
    };

    if (!payload.title || !payload.description) {
        trackerModalError.textContent = 'Titel und Beschreibung sind erforderlich.';
        return;
    }

    trackerModalSave.disabled = true;
    trackerModalSave.textContent = 'Veröffentliche...';
    trackerModalError.textContent = '';

    try {
        await apiFetch(`/api/feedback/${currentPublishReport.id}/publish`, 'POST', payload);
        closeTrackerModal();
        await loadReports();
        window.dispatchEvent(new CustomEvent('dhf:notification_update'));
    } catch (error) {
        trackerModalError.textContent = error.message;
        trackerModalSave.disabled = false;
        trackerModalSave.textContent = 'Veröffentlichen';
    }
}

if (trackerProgress) trackerProgress.addEventListener('input', updateTrackerProgressLabel);
if (trackerStatus) {
    trackerStatus.addEventListener('change', () => {
        if (trackerStatus.value === 'erledigt') {
            trackerProgress.value = '100';
            updateTrackerProgressLabel();
        }
    });
}
if (trackerModalSave) trackerModalSave.addEventListener('click', publishCurrentReport);
document.getElementById('tracker-modal-close')?.addEventListener('click', closeTrackerModal);
document.getElementById('tracker-modal-cancel')?.addEventListener('click', closeTrackerModal);
if (trackerModal) {
    trackerModal.addEventListener('click', (event) => {
        if (event.target === trackerModal) closeTrackerModal();
    });
}

if (filterButtonsContainer) {
    filterButtonsContainer.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') {
            const currentActive = filterButtonsContainer.querySelector('button.active');
            if(currentActive) currentActive.classList.remove('active');
            e.target.classList.add('active');

            currentFilter = e.target.dataset.filter;
            loadReports();
        }
    });
}

if (feedbackList) {
    feedbackList.addEventListener('click', (e) => {
        const button = e.target.closest('button');
        const header = e.target.closest('.item-header');

        if (button) {
            const action = button.dataset.action;
            const id = e.target.closest('.feedback-item').dataset.id;

            if (action === 'delete') {
                handleDelete(id);
            } else if (action === 'publish') {
                const report = reportsCache.find(item => String(item.id) === String(id));
                openTrackerModal(report);
            } else if (action === 'neu' || action === 'gesehen' || action === 'archiviert') {
                handleUpdateStatus(id, action);
            }
        } else if (header) {
            const body = header.nextElementSibling;
            body.style.display = (body.style.display === 'block') ? 'none' : 'block';
        }
    });
}

function escapeHTML(str) {
    if (!str) return "";
    return str.replace(/[&<>"']/g, function(m) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[m];
    });
}

// --- Initialisierung ---
if (isAdmin) {
    loadReports();
}
