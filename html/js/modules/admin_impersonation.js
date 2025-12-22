import { API_URL } from '../utils/constants.js';

// Globale Variablen für Elemente
let startBtn, stopBtn, modal, closeModalBtn, searchInput, userListContainer;

// State Cache
let cachedUsers = [];

/**
 * Initialisiert das Impersonation-Modul.
 * Injiziert automatisch HTML, falls es fehlt.
 */
export async function initImpersonation() {

    // 1. UI automatisch erstellen, wenn nicht vorhanden
    injectUI();

    // 2. Referenzen holen (jetzt wo sie sicher existieren)
    startBtn = document.getElementById('start-impersonation-btn');
    stopBtn = document.getElementById('stop-impersonation-btn');
    modal = document.getElementById('impersonation-modal');
    closeModalBtn = document.getElementById('close-impersonation-modal');
    searchInput = document.getElementById('impersonate-search');
    userListContainer = document.getElementById('impersonate-list');

    // 3. Event Listeners binden
    if (startBtn) startBtn.addEventListener('click', openModal);
    if (stopBtn) stopBtn.addEventListener('click', stopImpersonation);
    if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);

    if (searchInput) {
        searchInput.addEventListener('input', (e) => filterUsers(e.target.value));
    }

    window.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // 4. Status prüfen (sichtbarkeit der Buttons)
    await checkImpersonationStatus();
}

/**
 * Erstellt die notwendigen HTML-Elemente dynamisch.
 * Positionierung: VOR dem Logout oder Report Button.
 */
function injectUI() {
    // Prüfen, ob wir schon injiziert haben
    if (document.getElementById('impersonation-modal')) return;

    // A. Buttons in den Header einfügen
    const userInfoContainer = document.getElementById('user-info');
    if (userInfoContainer) {
        // HTML für die Buttons
        const buttonsHTML = `
            <button class="btn-shadow" id="stop-impersonation-btn" style="display:none;">
                <i class="fas fa-user-secret"></i> <span class="desktop-only">Admin Wiederherstellen</span>
            </button>
            <button class="btn-shadow" id="start-impersonation-btn" style="display:none;">
                <i class="fas fa-masks-theater"></i> <span class="desktop-only">Login als...</span>
            </button>
        `;

        // KORREKTUR: Positionierung verbessern
        // Wir wollen die Buttons NICHT ganz am Anfang (links vom Namen),
        // sondern zwischen Namen und den System-Buttons.

        const reportBtn = userInfoContainer.querySelector('.report-btn'); // Problem melden
        const logoutBtn = document.getElementById('logout-btn'); // Abmelden

        if (reportBtn) {
            // Wenn "Problem melden" da ist, fügen wir es DAVOR ein
            reportBtn.insertAdjacentHTML('beforebegin', buttonsHTML);
        } else if (logoutBtn) {
            // Sonst vor dem Logout Button
            logoutBtn.insertAdjacentHTML('beforebegin', buttonsHTML);
        } else {
            // Fallback: Doch am Anfang (falls Struktur ganz anders ist)
            userInfoContainer.insertAdjacentHTML('afterbegin', buttonsHTML);
        }
    }

    // B. Modal in den Body einfügen
    const modalHTML = `
    <div id="impersonation-modal" class="impersonation-modal">
        <div class="impersonation-modal-content">
            <div class="impersonation-header">
                <h2><i class="fas fa-user-secret"></i> Shadow Login</h2>
                <span class="impersonation-close" id="close-impersonation-modal">&times;</span>
            </div>
            <div class="modal-body">
                <div style="margin-bottom:15px;">
                    <label style="display:block; margin-bottom:5px; color:#aaa;">Benutzer suchen:</label>
                    <input type="text" id="impersonate-search" class="impersonation-input" placeholder="Name eingeben..." autocomplete="off">
                </div>
                <div id="impersonate-list" style="max-height: 300px; overflow-y: auto; border: 1px solid rgba(255,255,255,0.1); border-radius: 5px;">
                    <div style="padding: 10px; color: #777;">Tippe zum Suchen...</div>
                </div>
            </div>
        </div>
    </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
}


/**
 * Prüft den aktuellen Session-Status und schaltet die Buttons.
 */
async function checkImpersonationStatus() {
    try {
        const response = await fetch(`${API_URL}/api/check_session`, {
            method: 'GET',
            credentials: 'include'
        });

        if (response.ok) {
            const data = await response.json();
            updateButtonVisibility(data.user, data.is_impersonating);
        }
    } catch (error) {
        console.error("Fehler beim Prüfen des Impersonation-Status:", error);
    }
}

/**
 * Steuert die Sichtbarkeit der Buttons im Header.
 */
function updateButtonVisibility(user, isImpersonating) {
    if (!startBtn || !stopBtn || !user) return;

    // Reset
    startBtn.style.display = 'none';
    stopBtn.style.display = 'none';

    // Logik
    if (isImpersonating) {
        stopBtn.style.display = 'inline-flex';
    } else {
        // Rollen-Check (Case Insensitive & Robust)
        const roleName = user.role ? (user.role.name || user.role).toString().toLowerCase() : '';
        if (roleName.includes('admin') || roleName.includes('owner')) {
            startBtn.style.display = 'inline-flex';
        }
    }
}

async function openModal() {
    if (!modal) return;
    modal.style.display = 'block';

    if (cachedUsers.length === 0) {
        await loadSimpleUserList();
    } else {
        renderUserList(cachedUsers);
    }

    if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
    }
}

function closeModal() {
    if (modal) modal.style.display = 'none';
}

async function loadSimpleUserList() {
    if (!userListContainer) return;

    userListContainer.innerHTML = '<div style="padding:10px; text-align:center; color:#bdc3c7;">Lade Benutzer...</div>';

    try {
        const response = await fetch(`${API_URL}/api/users/simple`, {
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
        });

        if (response.ok) {
            cachedUsers = await response.json();
            renderUserList(cachedUsers);
        } else {
            userListContainer.innerHTML = '<div style="padding:10px; color:#e74c3c;">Fehler beim Laden der Liste.</div>';
        }
    } catch (e) {
        console.error(e);
        userListContainer.innerHTML = `<div style="padding:10px; color:#e74c3c;">Netzwerkfehler: ${e.message}</div>`;
    }
}

function renderUserList(users) {
    if (!userListContainer) return;
    userListContainer.innerHTML = '';

    if (users.length === 0) {
        userListContainer.innerHTML = '<div style="padding:10px; color:#777;">Keine Benutzer gefunden.</div>';
        return;
    }

    users.forEach(user => {
        const item = document.createElement('div');
        item.className = 'user-select-item';
        item.innerHTML = `
            <span style="font-weight:500; color:#fff;">${user.full_name}</span>
            <span class="user-select-role">${user.role}</span>
        `;

        item.onclick = () => performImpersonation(user.id, user.full_name);

        userListContainer.appendChild(item);
    });
}

function filterUsers(query) {
    if (!query) {
        renderUserList(cachedUsers);
        return;
    }

    const lowerQuery = query.toLowerCase();
    const filtered = cachedUsers.filter(u =>
        u.full_name.toLowerCase().includes(lowerQuery) ||
        u.role.toLowerCase().includes(lowerQuery)
    );
    renderUserList(filtered);
}

async function performImpersonation(userId, userName) {
    if (!confirm(`Möchtest du dich wirklich als "${userName}" anmelden?`)) return;

    try {
        const response = await fetch(`${API_URL}/api/impersonate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId }),
            credentials: 'include'
        });

        const data = await response.json();

        if (response.ok) {
            if (data.user) {
                localStorage.setItem('dhf_user', JSON.stringify(data.user));
            }
            window.location.reload();
        } else {
            alert('Fehler: ' + (data.message || 'Unbekannt'));
        }
    } catch (e) {
        alert('Serverfehler: ' + e.message);
    }
}

async function stopImpersonation() {
    try {
        const response = await fetch(`${API_URL}/api/stop_impersonate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
        });

        const data = await response.json();

        if (response.ok) {
             if (data.user) {
                localStorage.setItem('dhf_user', JSON.stringify(data.user));
            }
            window.location.reload();
        } else {
            alert('Fehler: ' + (data.message || 'Konnte Admin nicht wiederherstellen.'));
            if (response.status === 401) window.location.href = 'index.html';
        }
    } catch (e) {
        alert('Verbindungsfehler: ' + e.message);
    }
}