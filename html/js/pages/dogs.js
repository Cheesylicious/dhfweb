// html/js/pages/dogs.js

// --- NOTFALL CACHE KILLER ---
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(r => r.forEach(reg => reg.unregister()));
    caches.keys().then(k => k.forEach(key => caches.delete(key)));
}

import { apiFetch } from '../utils/api.js?v=nocache';

// --- AUTHENTIFIZIERUNG & NAVIGATION UI ---
function logout() {
    localStorage.removeItem('dhf_user');
    window.location.href = 'index.html';
}
document.getElementById('logout-btn').onclick = logout;

let isAdmin = false;
let isHundefuehrer = false;
let currentUser = null;

try {
    currentUser = JSON.parse(localStorage.getItem('dhf_user'));
    if (!currentUser || !currentUser.role) throw new Error("Nicht eingeloggt");
    document.getElementById('welcome-user').textContent = `Willkommen, ${currentUser.vorname}!`;

    isAdmin = currentUser.role.name === 'admin';
    const isPlanschreiber = currentUser.role.name === 'Planschreiber';
    isHundefuehrer = currentUser.role.name === 'Hundeführer';
    
    if (!isAdmin && !isPlanschreiber && !isHundefuehrer && currentUser.role.name !== 'user') {
        document.getElementById('nav-dashboard').style.display = 'none';
    } else {
        document.getElementById('nav-dashboard').style.display = 'block';
    }

    if (isAdmin) {
        document.getElementById('nav-users').style.display = 'block';
        document.getElementById('nav-feedback').style.display = 'inline-flex';
    } else if (isPlanschreiber) {
        document.getElementById('nav-users').style.display = 'none';
        document.getElementById('nav-feedback').style.display = 'inline-flex';
    }
    
    if (!isAdmin && !isHundefuehrer) {
        document.querySelector('.card').innerHTML = `<h2 style="color: #e74c3c;">Zugriff verweigert.</h2>`;
        throw new Error("Keine Rechte");
    }

    if (!isAdmin) {
        const addBtn = document.getElementById('add-dog-btn');
        if (addBtn) addBtn.style.display = 'none';
    }

} catch (e) {
    if (!e.message.includes("Keine Rechte")) logout();
}


// --- GLOBALE VARIABLEN & DYNAMISCHE FELDER ---
const tbody = document.getElementById('dogs-table-body');
const modal = document.getElementById('dog-modal');
const ownerSelect = document.getElementById('dog-owner');
const ownerSelect2 = document.getElementById('dog-owner-2');

// NEUE Felder
const entryDateInput = document.getElementById('dog-entry-date');
const exitDateInput = document.getElementById('dog-exit-date');
const isArchivedCheck = document.getElementById('dog-is-archived');

// Akte Felder
const eventType = document.getElementById('event-type');
const eventDate = document.getElementById('event-date');
const dueDate = document.getElementById('event-due-date');
const eventNotes = document.getElementById('event-notes');
const notesLabel = document.getElementById('notes-label');

const dpoFields = document.getElementById('dpo-fields');
const dpoResult = document.getElementById('dpo-result');
const dpoHandler = document.getElementById('dpo-handler');

const vacFields = document.getElementById('vaccine-fields');
const vacType = document.getElementById('vaccine-type');

let allOwners = [];
let allDogs = [];   

let currentDogEvents = [];
let currentEventFilter = 'Alle';

// --- TABS LOGIK ---
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        e.target.classList.add('active');
        document.getElementById(e.target.dataset.tab).classList.add('active');
    });
});

document.querySelectorAll('.event-filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.event-filter-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentEventFilter = e.target.dataset.filter;
        renderEventsTable(); 
    });
});

// --- DATEN LADEN ---
async function loadData() {
    try {
        const [ownersRes, dogsRes] = await Promise.all([
            apiFetch('/api/dogs/owners'),
            apiFetch('/api/dogs/')
        ]);
        allOwners = ownersRes;
        allDogs = dogsRes;
        renderDogsTable();
        populateDpoHandlers(); 

        const urlParams = new URLSearchParams(window.location.search);
        const openDogId = urlParams.get('open_dog');
        const targetTab = urlParams.get('tab');

        if (openDogId) {
            const targetDog = allDogs.find(d => d.id == openDogId);
            if (targetDog) {
                editDog(targetDog); 
                if (targetTab === 'akte') {
                    setTimeout(() => {
                        const akteBtn = document.querySelector('[data-tab="tab-akte"]');
                        if (akteBtn) akteBtn.click(); 
                    }, 50);
                }
            }
            window.history.replaceState({}, document.title, window.location.pathname);
        }

    } catch(e) {
        console.error("Fehler beim Laden der Daten:", e);
    }
}

function renderDogsTable() {
    tbody.innerHTML = '';
    
    if (allDogs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#aaa;">Noch keine Diensthunde angelegt.</td></tr>';
        return;
    }

    // Sortieren: Aktive Hunde nach oben, archivierte nach unten
    const sortedDogs = [...allDogs].sort((a, b) => {
        if (a.is_active === b.is_active) {
            return a.name.localeCompare(b.name);
        }
        return a.is_active ? -1 : 1;
    });

    sortedDogs.forEach(d => {
        const dogJsonString = JSON.stringify(d).replace(/'/g, "\\'");
        
        const isArchived = d.is_active === false;
        const rowClass = isArchived ? 'archived-row' : '';
        const nameDisplay = isArchived ? `${d.name} <span style="color:#e74c3c; font-size: 11px;">(Archiviert)</span>` : d.name;

        const photoHtml = d.photo_filename 
            ? `<img src="/api/dogs/photo/${d.photo_filename}" class="dog-avatar" onclick='editDog(${dogJsonString})' title="Akte öffnen">` 
            : `<div class="dog-avatar" style="display:inline-block; background:#555; text-align:center; line-height:36px;" onclick='editDog(${dogJsonString})' title="Akte öffnen"><i class="fas fa-dog"></i></div>`;
            
        const tr = document.createElement('tr');
        tr.className = rowClass;
        tr.innerHTML = `
            <td>${photoHtml} <strong>${nameDisplay}</strong> <br><small style="color:#aaa;">${d.age_years !== null ? d.age_years + ' Jahre' : ''}</small></td>
            <td>${d.breed || '-'}</td>
            <td>${d.chip_number || '-'}</td>
            <td>${d.owner_name}</td>
            <td><button class="btn-primary" onclick='editDog(${dogJsonString})'>Akte öffnen</button></td>
        `;
        tbody.appendChild(tr);
    });
}

function populateOwnerDropdowns(currentDogId) {
    const assignedToOtherDogs = new Set();
    allDogs.forEach(dog => {
        if (dog.id !== currentDogId) {
            if (dog.owner_id) assignedToOtherDogs.add(dog.owner_id);
            if (dog.owner_id_2) assignedToOtherDogs.add(dog.owner_id_2);
        }
    });

    const availableForThisDog = allOwners.filter(o => !assignedToOtherDogs.has(o.id));
    const val1 = ownerSelect.value;
    const val2 = ownerSelect2.value;

    let html1 = '<option value="">-- Kein Hundeführer --</option>';
    let html2 = '<option value="">-- Kein 2. Hundeführer --</option>';

    availableForThisDog.forEach(o => {
        html1 += `<option value="${o.id}">${o.name}</option>`;
        html2 += `<option value="${o.id}">${o.name}</option>`;
    });

    ownerSelect.innerHTML = html1;
    ownerSelect2.innerHTML = html2;
    ownerSelect.value = val1;
    ownerSelect2.value = val2;

    crossDisableDropdowns();
}

function crossDisableDropdowns() {
    const val1 = ownerSelect.value;
    const val2 = ownerSelect2.value;

    Array.from(ownerSelect.options).forEach(opt => { opt.disabled = (opt.value !== "" && opt.value === val2); });
    Array.from(ownerSelect2.options).forEach(opt => { opt.disabled = (opt.value !== "" && opt.value === val1); });
}

ownerSelect.addEventListener('change', crossDisableDropdowns);
ownerSelect2.addEventListener('change', crossDisableDropdowns);


// --- DYNAMISCHE LOGIK FÜR AKTE / TERMINE ---

function populateDpoHandlers() {
    dpoHandler.innerHTML = '<option value="">-- Bitte wählen --</option>';
    allOwners.forEach(o => {
        dpoHandler.innerHTML += `<option value="${o.name}">${o.name}</option>`;
    });
}

function resetEventForm() {
    // Aktuelles Datum in lokaler Zeitzone ermitteln & setzen
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    
    eventDate.value = `${yyyy}-${mm}-${dd}`;
    dueDate.value = '';
    eventType.value = 'Sonstiges';
    dpoResult.value = '';
    dpoHandler.value = '';
    vacType.value = '';
    eventNotes.value = '';
    updateDynamicFields();
}

function updateDynamicFields() {
    dpoFields.style.display = 'none';
    vacFields.style.display = 'none';
    notesLabel.textContent = 'Notiz / Ergebnis';
    eventNotes.placeholder = 'Optionale Anmerkung...';
    
    if (eventType.value === 'DPO Prüfung') {
        dpoFields.style.display = 'flex';
        notesLabel.textContent = 'Zusätzliche Notiz';
    } else if (eventType.value === 'Impfung') {
        vacFields.style.display = 'block';
        notesLabel.textContent = 'Zusätzliche Notiz';
    } else if (eventType.value === 'Tierarzt') {
        notesLabel.textContent = 'Grund des Besuchs / Diagnose *';
        eventNotes.placeholder = 'Bitte den Grund eintragen...';
    }
    calculateDueDate();
}

function calculateDueDate() {
    if (!eventDate.value) return;
    const d = new Date(eventDate.value);
    if (isNaN(d)) return;
    
    dueDate.value = ''; 
    
    if (eventType.value === 'DPO Prüfung') {
        if (dpoResult.value === 'Bestanden') {
            const nextYear = d.getFullYear() + 1;
            dueDate.value = `${nextYear}-12-31`;
        }
    } else if (eventType.value === 'Impfung') {
        const v = vacType.value;
        if (v.includes('3 Jahre')) {
            d.setFullYear(d.getFullYear() + 3);
            dueDate.value = d.toISOString().split('T')[0];
        } else if (v.includes('1 Jahr')) {
            d.setFullYear(d.getFullYear() + 1);
            dueDate.value = d.toISOString().split('T')[0];
        }
    }
}

eventType.addEventListener('change', updateDynamicFields);
eventDate.addEventListener('change', calculateDueDate);
dpoResult.addEventListener('change', calculateDueDate);
vacType.addEventListener('change', calculateDueDate);


// --- MODAL STEUERUNG ---
window.editDog = (d) => {
    document.getElementById('btn-tab-akte').style.display = 'block';
    document.getElementById('btn-tab-foto').style.display = 'block';

    if (!isAdmin) {
        document.getElementById('btn-tab-akte').click();
        document.getElementById('save-dog-btn').style.display = 'none';
        document.querySelectorAll('#tab-stammdaten input, #tab-stammdaten select').forEach(el => {
            el.disabled = true;
            el.style.opacity = '0.6';
        });
    } else {
        document.querySelector('[data-tab="tab-stammdaten"]').click();
        document.getElementById('save-dog-btn').style.display = 'inline-block';
        document.querySelectorAll('#tab-stammdaten input, #tab-stammdaten select').forEach(el => {
            el.disabled = false;
            el.style.opacity = '1';
        });
    }

    currentEventFilter = 'Alle';
    document.querySelectorAll('.event-filter-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.filter === 'Alle');
    });

    document.getElementById('dog-id').value = d.id;
    document.getElementById('dog-name').value = d.name;
    document.getElementById('dog-breed').value = d.breed || '';
    document.getElementById('dog-color').value = d.coat_color || '';
    document.getElementById('dog-weight').value = d.weight_kg || '';
    document.getElementById('dog-size').value = d.size_cm || '';
    document.getElementById('dog-chip').value = d.chip_number || '';
    document.getElementById('dog-birth').value = d.birthdate || '';
    
    // NEUE Felder befüllen
    entryDateInput.value = d.entry_date || '';
    exitDateInput.value = d.exit_date || '';
    isArchivedCheck.checked = (d.is_active === false);
    
    ownerSelect.value = d.owner_id || '';
    ownerSelect2.value = d.owner_id_2 || '';
    populateOwnerDropdowns(d.id);
    
    const preview = document.getElementById('dog-photo-preview');
    const noPhoto = document.getElementById('no-photo-text');
    if (d.photo_filename) {
        preview.src = `/api/dogs/photo/${d.photo_filename}?v=${new Date().getTime()}`;
        preview.style.display = 'inline-block';
        noPhoto.style.display = 'none';
    } else {
        preview.style.display = 'none';
        noPhoto.style.display = 'block';
    }

    resetEventForm();
    loadEvents(d.id);
    modal.style.display = 'block';
};

document.getElementById('add-dog-btn').onclick = () => {
    document.querySelector('[data-tab="tab-stammdaten"]').click();
    document.getElementById('btn-tab-akte').style.display = 'none';
    document.getElementById('btn-tab-foto').style.display = 'none';

    document.getElementById('dog-id').value = '';
    document.getElementById('dog-name').value = '';
    document.getElementById('dog-breed').value = '';
    document.getElementById('dog-color').value = '';
    document.getElementById('dog-weight').value = '';
    document.getElementById('dog-size').value = '';
    document.getElementById('dog-chip').value = '';
    document.getElementById('dog-birth').value = '';
    
    // NEUE Felder zurücksetzen
    entryDateInput.value = '';
    exitDateInput.value = '';
    isArchivedCheck.checked = false;
    
    ownerSelect.value = '';
    ownerSelect2.value = '';
    populateOwnerDropdowns(null);
    resetEventForm();
    
    modal.style.display = 'block';
};

// --- SPEICHERN STAMMDATEN ---
document.getElementById('save-dog-btn').onclick = async () => {
    const id = document.getElementById('dog-id').value;
    const payload = {
        name: document.getElementById('dog-name').value,
        breed: document.getElementById('dog-breed').value,
        coat_color: document.getElementById('dog-color').value,
        weight_kg: document.getElementById('dog-weight').value,
        size_cm: document.getElementById('dog-size').value,
        chip_number: document.getElementById('dog-chip').value,
        birthdate: document.getElementById('dog-birth').value,
        entry_date: entryDateInput.value || null,
        exit_date: exitDateInput.value || null,
        is_active: !isArchivedCheck.checked, // WICHTIG: True wenn NICHT angehakt
        owner_id: ownerSelect.value,
        owner_id_2: ownerSelect2.value
    };
    
    try {
        if(id) {
            await apiFetch(`/api/dogs/${id}`, 'PUT', payload);
            alert("Stammdaten aktualisiert.");
        } else {
            const newDog = await apiFetch('/api/dogs/', 'POST', payload);
            alert("Hund angelegt! Sie können nun Fotos und Termine hinzufügen.");
            editDog(newDog);
        }
        await loadData(); 
    } catch(e) {
        alert(e.message);
    }
};

// --- FOTO UPLOAD LOGIK ---
document.getElementById('upload-photo-btn').onclick = async () => {
    const id = document.getElementById('dog-id').value;
    const fileInput = document.getElementById('dog-photo-input');
    if (!fileInput.files.length) return alert("Bitte wähle ein Bild aus.");

    const file = fileInput.files[0];
    const btn = document.getElementById('upload-photo-btn');
    btn.textContent = "Komprimiere & Lädt hoch...";
    btn.disabled = true;

    const img = new Image();
    const reader = new FileReader();

    reader.onload = (e) => {
        img.onload = async () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 800; 
            const MAX_HEIGHT = 800; 
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
            } else {
                if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
            }
            
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            canvas.toBlob(async (blob) => {
                const formData = new FormData();
                formData.append('photo', blob, 'avatar.jpg');

                try {
                    const response = await fetch(`/api/dogs/${id}/photo`, {
                        method: 'POST',
                        body: formData,
                        credentials: 'include'
                    });
                    
                    if (!response.ok) {
                        const contentType = response.headers.get("content-type");
                        if (contentType && contentType.includes("application/json")) {
                            const err = await response.json();
                            throw new Error(err.message || "Upload fehlgeschlagen");
                        } else {
                            throw new Error(`Serverfehler (${response.status}). Bitte lade die Seite neu.`);
                        }
                    }
                    
                    const data = await response.json();
                    document.getElementById('dog-photo-preview').src = `/api/dogs/photo/${data.photo_filename}?v=${new Date().getTime()}`;
                    document.getElementById('dog-photo-preview').style.display = 'inline-block';
                    document.getElementById('no-photo-text').style.display = 'none';
                    
                    btn.textContent = "Foto hochladen & speichern";
                    btn.disabled = false;
                    fileInput.value = "";
                    await loadData();
                    alert("Foto erfolgreich komprimiert und hochgeladen!");
                } catch (err) {
                    alert("Fehler: " + err.message);
                    btn.textContent = "Foto hochladen & speichern";
                    btn.disabled = false;
                }
            }, 'image/jpeg', 0.8);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
};

// --- AKTE (EVENTS) LOGIK ---
async function loadEvents(dogId) {
    const evTable = document.getElementById('events-table-body');
    evTable.innerHTML = '<tr><td colspan="5">Lade...</td></tr>'; 
    try {
        currentDogEvents = await apiFetch(`/api/dogs/${dogId}/events`);
        renderEventsTable();
    } catch(e) {
        evTable.innerHTML = `<tr><td colspan="5" style="color:red;">Fehler beim Laden der Akte.</td></tr>`;
    }
}

function renderEventsTable() {
    const evTable = document.getElementById('events-table-body');
    evTable.innerHTML = '';
    
    const filteredEvents = currentEventFilter === 'Alle' 
        ? currentDogEvents 
        : currentDogEvents.filter(e => e.event_type === currentEventFilter);

    if (filteredEvents.length === 0) {
        const filterMsg = currentEventFilter === 'Alle' ? 'Noch keine Einträge in der Akte.' : `Keine Einträge für "${currentEventFilter}" gefunden.`;
        evTable.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#aaa; padding: 20px;">${filterMsg}</td></tr>`;
        return;
    }
    
    const today = new Date();
    today.setHours(0,0,0,0);

    const seenKeys = new Set();
    currentDogEvents.forEach(e => {
        const rawNotes = e.notes || "";
        const cleanNotes = rawNotes.replace(/\s*\(Erfasst von:.*?\)/, '').trim();
        const baseNote = cleanNotes.split(' | ')[0].trim();
        const key = `${e.event_type}_${baseNote}`;
        
        if (!seenKeys.has(key)) {
            e.is_active_due = true; 
            seenKeys.add(key);
        } else {
            e.is_active_due = false; 
        }
    });

    filteredEvents.forEach(e => {
        const dateStr = e.event_date.split('-').reverse().join('.');
        
        let dueHtml = '-';
        if (e.due_date) {
            const dueDate = new Date(e.due_date);
            dueDate.setHours(0,0,0,0);
            
            const diffTime = dueDate - today;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            const dueStr = e.due_date.split('-').reverse().join('.');
            
            if (!e.is_active_due) {
                dueHtml = `<span style="color:#aaa; text-decoration: line-through;">${dueStr}</span><br><small style="color:#aaa;">(Erneuert)</small>`;
            } else {
                if (diffDays < 0) {
                    dueHtml = `<span style="color:#e74c3c; font-weight:bold;">${dueStr}<br><small>Seit ${Math.abs(diffDays)} Tagen überfällig!</small></span>`;
                } else if (diffDays === 0) {
                    dueHtml = `<span style="color:#f39c12; font-weight:bold;">${dueStr}<br><small>Heute fällig!</small></span>`;
                } else if (diffDays <= 30) {
                    dueHtml = `<span style="color:#f39c12; font-weight:bold;">${dueStr}<br><small>In ${diffDays} Tagen</small></span>`;
                } else {
                    dueHtml = `<span style="color:#2ecc71;">${dueStr}<br><small>In ${diffDays} Tagen</small></span>`;
                }
            }
        }

        evTable.innerHTML += `
            <tr>
                <td>${dateStr}</td>
                <td><strong style="color:#3498db;">${e.event_type}</strong></td>
                <td style="white-space: normal;">${e.notes || '-'}</td>
                <td>${dueHtml}</td>
                <td><button class="btn-danger" onclick="deleteEvent(${e.id}, ${e.dog_id})"><i class="fas fa-trash"></i></button></td>
            </tr>
        `;
    });
}

document.getElementById('add-event-btn').onclick = async () => {
    const dogId = document.getElementById('dog-id').value;
    const dateVal = eventDate.value;
    const typeVal = eventType.value;
    const dueDateVal = dueDate.value;
    const notesVal = eventNotes.value.trim();

    if (!dateVal) return alert("Bitte wähle ein Datum aus.");
    if (typeVal === 'Tierarzt' && !notesVal) return alert("Bitte geben Sie einen Grund für den Tierarztbesuch an.");
    if (typeVal === 'DPO Prüfung' && (!dpoHandler.value || !dpoResult.value)) return alert("Bitte wählen Sie Hundeführer und Ergebnis für die DPO Prüfung aus.");
    if (typeVal === 'Impfung' && !vacType.value) return alert("Bitte wählen Sie das Impf-Präparat aus.");

    let finalNotes = '';
    if (typeVal === 'DPO Prüfung') {
        finalNotes = `Mit Hundeführer: ${dpoHandler.value} | Ergebnis: ${dpoResult.value}`;
        if (notesVal) finalNotes += ` | Notiz: ${notesVal}`;
    } else if (typeVal === 'Impfung') {
        finalNotes = `Präparat: ${vacType.value}`;
        if (notesVal) finalNotes += ` | Notiz: ${notesVal}`;
    } else if (typeVal === 'Tierarzt') {
        finalNotes = `Grund: ${notesVal}`;
    } else {
        finalNotes = notesVal;
    }

    const author = `${currentUser.vorname} ${currentUser.name}`;
    finalNotes = finalNotes ? `${finalNotes} (Erfasst von: ${author})` : `(Erfasst von: ${author})`;

    try {
        await apiFetch(`/api/dogs/${dogId}/events`, 'POST', {
            event_date: dateVal,
            event_type: typeVal,
            notes: finalNotes,
            due_date: dueDateVal || null 
        });
        resetEventForm();
        loadEvents(dogId);
    } catch (e) {
        alert(e.message);
    }
};

window.deleteEvent = async (eventId, dogId) => {
    if(!confirm("Eintrag aus der Akte löschen?")) return;
    try {
        await apiFetch(`/api/dogs/events/${eventId}`, 'DELETE');
        loadEvents(dogId);
    } catch(e) { alert(e.message); }
};

// Start
loadData();