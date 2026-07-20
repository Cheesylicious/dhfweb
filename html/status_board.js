import { apiFetch } from './js/utils/api.js';
import { initAuthCheck } from './js/utils/auth.js';

let currentUser = null;
let isAdmin = false;
let allItems = [];
let currentFilter = 'all';
let editingItem = null;

const boardList = document.getElementById('board-list');
const searchInput = document.getElementById('board-search');
const filters = document.getElementById('board-filters');
const editModal = document.getElementById('edit-modal');
const editTitle = document.getElementById('edit-title');
const editDescription = document.getElementById('edit-description');
const editStatus = document.getElementById('edit-status');
const editProgress = document.getElementById('edit-progress');
const editProgressValue = document.getElementById('edit-progress-value');
const editStatusNote = document.getElementById('edit-status-note');
const editError = document.getElementById('edit-error');
const editSave = document.getElementById('edit-save');

const TYPE_LABELS = {
    bug: '🐞 Fehler',
    improvement: '💡 Verbesserung',
    other: '💬 Sonstiges'
};

const CLOSED_STATUSES = new Set(['erledigt', 'nicht_umgesetzt']);

function escapeHTML(value) {
    return String(value || '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
}

function formatDate(value) {
    if (!value) return '';
    return new Date(value).toLocaleString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function updateSummary() {
    document.getElementById('count-all').textContent = allItems.length;
    document.getElementById('count-active').textContent = allItems.filter(item =>
        ['geplant', 'in_arbeit'].includes(item.public_status)
    ).length;
    document.getElementById('count-testing').textContent = allItems.filter(item =>
        item.public_status === 'testphase'
    ).length;
    document.getElementById('count-done').textContent = allItems.filter(item =>
        item.public_status === 'erledigt'
    ).length;
}

function itemMatchesFilter(item) {
    if (currentFilter === 'all') return true;
    if (currentFilter === 'offen') return !CLOSED_STATUSES.has(item.public_status);
    return item.public_status === currentFilter;
}

function renderBoard() {
    if (!boardList) return;

    const searchTerm = (searchInput?.value || '').trim().toLocaleLowerCase('de-DE');
    const visibleItems = allItems.filter(item => {
        if (!itemMatchesFilter(item)) return false;
        if (!searchTerm) return true;
        return [item.title, item.description, item.status_note, item.category, item.status_label]
            .some(value => String(value || '').toLocaleLowerCase('de-DE').includes(searchTerm));
    });

    if (visibleItems.length === 0) {
        boardList.innerHTML = `
            <div class="empty-state">
                <div class="big-icon">📋</div>
                <h3>Keine passenden Einträge</h3>
                <p>Für diesen Filter gibt es aktuell keine sichtbaren Meldungen.</p>
                <button class="report-btn" id="empty-report-btn" type="button">🐞 Problem melden</button>
            </div>`;
        document.getElementById('empty-report-btn')?.addEventListener('click', () => {
            document.getElementById('global-report-btn')?.click();
        });
        return;
    }

    boardList.innerHTML = visibleItems.map(item => {
        const adminActions = isAdmin ? `
            <div class="admin-actions">
                <button class="btn-edit" data-action="edit" data-id="${item.id}">Bearbeiten</button>
                <button class="btn-remove" data-action="remove" data-id="${item.id}">Entfernen</button>
            </div>` : '';
        const ownBadge = item.is_own_report ? '<span class="badge own">Von dir gemeldet</span>' : '';
        const note = item.status_note ? `
            <div class="status-note">
                <strong>Aktueller Stand</strong>
                ${escapeHTML(item.status_note)}
            </div>` : '';

        return `
            <article class="board-item status-${escapeHTML(item.public_status)}" data-id="${item.id}">
                <div class="board-item-inner">
                    <div class="item-top">
                        <div>
                            <h3 class="item-title">${escapeHTML(item.title)}</h3>
                            <div class="badges">
                                <span class="badge type">${escapeHTML(TYPE_LABELS[item.report_type] || item.report_type)}</span>
                                <span class="badge category">${escapeHTML(item.category)}</span>
                                ${ownBadge}
                            </div>
                        </div>
                        <span class="badge status-badge">${escapeHTML(item.status_label)}</span>
                    </div>
                    <div class="item-description">${escapeHTML(item.description)}</div>
                    <div class="progress-head"><span>Fortschritt</span><strong>${item.progress} %</strong></div>
                    <div class="progress-track"><div class="progress-fill" style="width:${item.progress}%"></div></div>
                    ${note}
                    <div class="item-footer">
                        <span>Zuletzt aktualisiert: ${formatDate(item.updated_at)} Uhr</span>
                        ${adminActions}
                    </div>
                </div>
            </article>`;
    }).join('');
}

async function loadBoard() {
    boardList.innerHTML = '<div class="loading-state">Status-Board wird geladen...</div>';
    try {
        allItems = await apiFetch('/api/feedback/public_items', 'GET');
        updateSummary();
        renderBoard();

        const editId = Number(new URLSearchParams(window.location.search).get('edit'));
        if (isAdmin && editId) {
            const item = allItems.find(entry => entry.id === editId);
            if (item) openEditModal(item);
        }
    } catch (error) {
        boardList.innerHTML = `<div class="empty-state"><h3>Fehler beim Laden</h3><p>${escapeHTML(error.message)}</p></div>`;
    }
}

function updateProgressLabel() {
    editProgressValue.textContent = `${editProgress.value} %`;
}

function openEditModal(item) {
    if (!isAdmin || !item) return;
    editingItem = item;
    editTitle.value = item.title || '';
    editDescription.value = item.description || '';
    editStatus.value = item.public_status;
    editProgress.value = String(item.progress || 0);
    editStatusNote.value = item.status_note || '';
    editError.textContent = '';
    editSave.disabled = false;
    editSave.textContent = 'Änderungen speichern';
    updateProgressLabel();
    editModal.style.display = 'block';
    editModal.setAttribute('aria-hidden', 'false');
    setTimeout(() => editTitle.focus(), 50);
}

function closeEditModal() {
    editModal.style.display = 'none';
    editModal.setAttribute('aria-hidden', 'true');
    editingItem = null;
    const cleanUrl = `${window.location.pathname}${window.location.hash || ''}`;
    window.history.replaceState({}, '', cleanUrl);
}

async function saveEdit() {
    if (!editingItem) return;
    const payload = {
        title: editTitle.value.trim(),
        description: editDescription.value.trim(),
        public_status: editStatus.value,
        progress: Number(editProgress.value),
        status_note: editStatusNote.value.trim()
    };

    if (!payload.title || !payload.description) {
        editError.textContent = 'Titel und Beschreibung sind erforderlich.';
        return;
    }

    editSave.disabled = true;
    editSave.textContent = 'Speichere...';
    editError.textContent = '';

    try {
        await apiFetch(`/api/feedback/public_items/${editingItem.id}`, 'PUT', payload);
        closeEditModal();
        await loadBoard();
    } catch (error) {
        editError.textContent = error.message;
        editSave.disabled = false;
        editSave.textContent = 'Änderungen speichern';
    }
}

async function removeItem(itemId) {
    if (!isAdmin || !confirm('Diesen Eintrag wirklich aus dem öffentlichen Status-Board entfernen?')) return;
    try {
        await apiFetch(`/api/feedback/public_items/${itemId}`, 'DELETE');
        await loadBoard();
    } catch (error) {
        alert(`Fehler beim Entfernen: ${error.message}`);
    }
}

async function initialize() {
    try {
        const authData = initAuthCheck();
        currentUser = authData.user;
        isAdmin = authData.isAdmin;
    } catch (error) {
        return;
    }

    filters?.addEventListener('click', event => {
        const button = event.target.closest('button[data-filter]');
        if (!button) return;
        filters.querySelector('.active')?.classList.remove('active');
        button.classList.add('active');
        currentFilter = button.dataset.filter;
        renderBoard();
    });
    searchInput?.addEventListener('input', renderBoard);

    boardList?.addEventListener('click', event => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const itemId = Number(button.dataset.id);
        const item = allItems.find(entry => entry.id === itemId);
        if (button.dataset.action === 'edit') openEditModal(item);
        if (button.dataset.action === 'remove') removeItem(itemId);
    });

    editProgress?.addEventListener('input', updateProgressLabel);
    editStatus?.addEventListener('change', () => {
        if (editStatus.value === 'erledigt') {
            editProgress.value = '100';
            updateProgressLabel();
        }
    });
    editSave?.addEventListener('click', saveEdit);
    document.getElementById('edit-close')?.addEventListener('click', closeEditModal);
    document.getElementById('edit-cancel')?.addEventListener('click', closeEditModal);
    editModal?.addEventListener('click', event => {
        if (event.target === editModal) closeEditModal();
    });

    await loadBoard();
}

initialize();
