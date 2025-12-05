// html/shortcuts.js

import { SHORTCUT_STORAGE_KEY } from './js/utils/constants.js';
import { apiFetch } from './js/utils/api.js';
import { initAuthCheck } from './js/utils/auth.js';

// --- 1. Globale Variablen ---
let user;
let isAdmin = false;

// --- 2. DOM Elemente ---
const shortcutList = document.getElementById('shortcut-list');
const saveBtn = document.getElementById('save-shortcuts-btn');
const statusMsg = document.getElementById('status-message');

// Standard-Werte (Fallback)
const defaultShortcuts = {
    'T.': 't', 'N.': 'n', '6': '6', 'FREI': 'f', 'X': 'x', 'U': 'u'
};

// Notfall-Fallback Daten
const hardcodedShiftDefaults = [
    { abbreviation: 'T.', name: 'Tag (T)', color: '#AED6F1' },
    { abbreviation: 'N.', name: 'Nacht (N)', color: '#5D6D7E' },
    { abbreviation: '6', name: 'Kurz (6)', color: '#A9DFBF' },
    { abbreviation: 'FREI', name: 'Frei (Geplant)', color: '#FFFFFF' },
    { abbreviation: 'U', name: 'Urlaub', color: '#FAD7A0' },
    { abbreviation: 'X', name: 'Wunschfrei (X)', color: '#D2B4DE' }
];

// --- 3. Funktionen ---

async function loadData() {
    let savedShortcuts = {};
    let shiftTypes = [];
    let errorOccurred = false;

    if(shortcutList) shortcutList.innerHTML = '';

    // 1. Gespeicherte Shortcuts aus localStorage laden
    try {
        const data = localStorage.getItem(SHORTCUT_STORAGE_KEY);
        if (data) {
            savedShortcuts = JSON.parse(data);
        }
    } catch (e) {
        console.error("Fehler beim Laden der Shortcuts aus localStorage", e);
    }

    // 2. Schichtarten von der API laden
    try {
        const apiData = await apiFetch('/api/shifttypes');

        if (Array.isArray(apiData) && apiData.length > 0) {
             shiftTypes = apiData;
        } else if (Array.isArray(apiData) && apiData.length === 0) {
             shiftTypes = [];
        } else {
            throw new Error("API-Antwort war unerwartet oder leer.");
        }

    } catch (error) {
        console.error(`Fehler beim Laden der Schichtarten: ${error.message}. Verwende Standardwerte.`);
        errorOccurred = true;
        shiftTypes = hardcodedShiftDefaults;
    }

    // 3. Liste rendern
    if (shiftTypes.length === 0) {
         if(shortcutList) shortcutList.innerHTML = '<li style="color: #ffffff; padding: 20px; background: rgba(0,0,0,0.2); border-radius: 5px;">Keine Schichtarten gefunden.</li>';
         return;
    }

    shiftTypes.forEach(st => {
        const li = document.createElement('li');
        li.className = 'shortcut-item';

        const savedKey = savedShortcuts[st.abbreviation] || defaultShortcuts[st.abbreviation] || '';

        li.innerHTML = `
            <label class="shortcut-label" for="sc-${st.abbreviation}">
                <div class="color-preview" style="background-color: ${st.color}; border-color: #555;"></div>
                <b>${st.abbreviation}</b>
                <span>(${st.name})</span>
            </label>
            <input type="text"
                   class="shortcut-input"
                   id="sc-${st.abbreviation}"
                   data-abbreviation="${st.abbreviation}"
                   value="${savedKey}"
                   maxlength="1"
                   placeholder="-">
        `;
        if(shortcutList) shortcutList.appendChild(li);
    });

    if (errorOccurred && statusMsg) {
        statusMsg.textContent = "Hinweis: Verbindung zur DB fehlgeschlagen. Standardwerte angezeigt.";
        statusMsg.style.color = '#e74c3c';
    }
}

if (saveBtn) {
    saveBtn.onclick = () => {
        if(statusMsg) {
            statusMsg.textContent = 'Speichere...';
            statusMsg.style.color = '#bdc3c7';
        }

        const inputs = document.querySelectorAll('.shortcut-input');
        const newShortcutMap = {};
        let hasError = false;
        let usedKeys = new Set();

        inputs.forEach(input => {
            const abbreviation = input.dataset.abbreviation;
            const key = input.value.toLowerCase();
            input.style.borderColor = '#3498db';

            if (key) {
                if (usedKeys.has(key)) {
                    if(statusMsg) {
                        statusMsg.textContent = `Fehler: Taste '${key}' ist doppelt vergeben.`;
                        statusMsg.style.color = '#e74c3c';
                    }
                    input.style.borderColor = '#e74c3c';
                    hasError = true;
                }
                usedKeys.add(key);
                newShortcutMap[abbreviation] = key;
            }
        });

        if (hasError) return;

        try {
            localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(newShortcutMap));
            if(statusMsg) {
                statusMsg.textContent = 'Erfolgreich gespeichert!';
                statusMsg.style.color = '#2ecc71';
            }
            setTimeout(() => { if(statusMsg) statusMsg.textContent = ''; }, 2000);
        } catch (error) {
            if(statusMsg) {
                statusMsg.textContent = 'Fehler beim Speichern: ' + error.message;
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
         const wrapper = document.getElementById('content-wrapper');
         if (wrapper) {
             wrapper.classList.add('restricted-view');
             wrapper.innerHTML = `
                 <div class="restricted-view">
                     <h2 style="color: #e74c3c;">Zugriff verweigert</h2>
                     <p>Sie benötigen Admin-Rechte, um auf die Shortcut-Einstellungen zuzugreifen.</p>
                     <p>Bitte nutzen Sie den Link zum <a href="schichtplan.html" style="color: #3498db;">Schichtplan</a>.</p>
                 </div>
             `;
         }
         const dropBtn = document.getElementById('settings-dropbtn');
         if (dropBtn) dropBtn.style.display = 'none';
         throw new Error("Keine Admin-Rechte.");
    }

    loadData();

} catch (e) {
    console.error("Shortcuts Init Error:", e);
}