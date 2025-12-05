// html/einstellungen.js

import { apiFetch } from './js/utils/api.js';
import { initAuthCheck } from './js/utils/auth.js';

// --- 1. Globale Variablen ---
let user;
let isAdmin = false;
let sortableInstance = null;

// --- 2. DOM Elemente ---
// HINWEIS: Wir nutzen 'sortable-list', passend zum HTML
const userList = document.getElementById('sortable-list');
const saveBtn = document.getElementById('save-order-btn');

// Status-Nachricht Element vorbereiten (falls im HTML nicht vorhanden)
let statusMsg = document.getElementById('status-message');
if (!statusMsg && saveBtn) {
    statusMsg = document.createElement('span');
    statusMsg.id = 'status-message';
    statusMsg.style.marginLeft = '15px';
    statusMsg.style.fontWeight = '500';
    saveBtn.parentNode.appendChild(statusMsg);
}

// --- 3. Funktionen ---

async function loadUsers() {
    if (!userList) return;

    try {
        const users = await apiFetch('/api/users');
        userList.innerHTML = '';

        // Sortieren nach dem aktuellen 'shift_plan_sort_order'
        users.sort((a, b) => (a.shift_plan_sort_order || 999) - (b.shift_plan_sort_order || 999));

        users.forEach(u => {
            const li = document.createElement('li');
            li.className = 'list-item'; // Style-Klasse aus CSS
            li.dataset.userId = u.id;
            li.dataset.visible = u.shift_plan_visible;

            const roleName = u.role ? u.role.name : 'N/A';
            const isChecked = u.shift_plan_visible ? 'checked' : '';

            li.innerHTML = `
                <span class="drag-handle">☰</span>
                <span class="user-name">${u.vorname} ${u.name} <small style="color:#777;">(${roleName})</small></span>
                <div class="visibility-toggle">
                    <input type="checkbox" id="vis-${u.id}" ${isChecked}>
                    <label for="vis-${u.id}" style="cursor:pointer;">Im Plan anzeigen</label>
                </div>
            `;
            userList.appendChild(li);
        });

        // Event Listener für Checkboxen
        userList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const li = e.target.closest('.list-item');
                li.dataset.visible = e.target.checked;
            });
        });

        // Sortable initialisieren (Library muss geladen sein)
        if (sortableInstance) sortableInstance.destroy();

        if (typeof Sortable !== 'undefined') {
            sortableInstance = new Sortable(userList, {
                handle: '.drag-handle',
                animation: 150,
                ghostClass: 'sortable-ghost'
            });
        } else {
            console.warn("SortableJS nicht gefunden (CDN fehlt?).");
        }

    } catch (error) {
        userList.innerHTML = `<li style="color: red; padding: 20px;">Fehler beim Laden: ${error.message}</li>`;
    }
}

if (saveBtn) {
    saveBtn.onclick = async () => {
        if(statusMsg) {
            statusMsg.textContent = 'Speichere...';
            statusMsg.style.color = '#bdc3c7';
        }

        const listItems = userList.querySelectorAll('.list-item');
        const payload = [];

        listItems.forEach((li, index) => {
            const cb = li.querySelector('input[type="checkbox"]');
            const isVis = cb ? cb.checked : false;

            payload.push({
                id: parseInt(li.dataset.userId),
                visible: isVis,
                order: index
            });
        });

        try {
            await apiFetch('/api/users/display_settings', 'PUT', payload);
            if(statusMsg) {
                statusMsg.textContent = 'Erfolgreich gespeichert!';
                statusMsg.style.color = '#2ecc71';
            }
            setTimeout(() => { if(statusMsg) statusMsg.textContent = ''; }, 2000);
        } catch (error) {
            if(statusMsg) {
                statusMsg.textContent = 'Fehler: ' + error.message;
                statusMsg.style.color = '#e74c3c';
            }
        }
    };
}

// --- 4. Initialisierung (Am Ende!) ---
try {
    const authData = initAuthCheck();
    user = authData.user;
    isAdmin = authData.isAdmin;

    if (!isAdmin) {
        document.getElementById('content-wrapper').innerHTML = `
            <div class="restricted-view">
                <h2 style="color: #e74c3c;">Zugriff verweigert</h2>
                <p>Nur Administratoren dürfen die Mitarbeiter-Sortierung festlegen.</p>
                <p>Bitte nutzen Sie den Link zum <a href="schichtplan.html" style="color: #3498db;">Schichtplan</a>.</p>
            </div>
        `;
        const dropBtn = document.getElementById('settings-dropbtn');
        if(dropBtn) dropBtn.style.display = 'none';
        throw new Error("Keine Admin-Rechte.");
    }

    // Init Daten laden
    loadUsers();

} catch (e) {
    console.error("Einstellungen Init Error:", e);
}