// Pfad: html/emails.js

// Korrigierte Import-Pfade für die Lage im html-Hauptverzeichnis
import { apiFetch } from './js/utils/api.js';
import { initAuthCheck } from './js/utils/auth.js';

let user;
let isAdmin = false;
let currentTemplates = [];
let activeTemplateId = null;

// DOM Elemente
const templateList = document.getElementById('template-list');
const editorTitle = document.getElementById('editor-title');
const editorForm = document.getElementById('editor-form');
const subjInput = document.getElementById('email-subject');
const bodyInput = document.getElementById('email-body');
const descOutput = document.getElementById('template-description');
const placeOutput = document.getElementById('template-placeholders');
const statusMsg = document.getElementById('status-message');
const saveBtn = document.getElementById('save-template-btn');
const testBtn = document.getElementById('send-test-btn');
const previewContainer = document.getElementById('roster-image-preview');

// 1. Auth & Initialisierung
try {
    const authData = initAuthCheck();
    user = authData.user;
    isAdmin = authData.isAdmin;

    if (!isAdmin) {
        document.getElementById('content-wrapper').innerHTML = `
            <div class="restricted-view">
                <h2 style="color: #e74c3c;">Zugriff verweigert</h2>
                <p>Nur Administratoren haben Zugriff auf die E-Mail Konfiguration.</p>
            </div>
        `;
        throw new Error("Keine Admin-Rechte.");
    }

    loadTemplates();

} catch (e) {
    console.error(e);
}

// 2. Vorlagen laden
async function loadTemplates() {
    templateList.innerHTML = '<li style="padding:15px;">Lade...</li>';
    try {
        const data = await apiFetch('/api/emails/templates');
        currentTemplates = data;
        renderList();

        // Wähle die erste Vorlage automatisch aus
        if (currentTemplates.length > 0 && !activeTemplateId) {
            selectTemplate(currentTemplates[0].id);
        }
    } catch (error) {
        templateList.innerHTML = `<li style="color:red; padding:15px;">Fehler: ${error.message}</li>`;
    }
}

function renderList() {
    templateList.innerHTML = '';
    currentTemplates.forEach(t => {
        const li = document.createElement('li');
        li.className = 'template-item';
        if (t.id === activeTemplateId) li.classList.add('active');
        li.textContent = t.name;
        li.onclick = () => selectTemplate(t.id);
        templateList.appendChild(li);
    });
}

/**
 * Lädt die Live-Vorschau des Dienstplan-Bildes, wenn die Rundmail-Vorlage gewählt ist.
 */
function updateRosterPreview(templateKey) {
    if (!previewContainer) return;

    if (templateKey === 'plan_completed') {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;

        // Zeitstempel (t=...) verhindert, dass der Browser ein altes Bild aus dem Cache anzeigt
        const imageUrl = `/api/emails/preview/roster_image?year=${year}&month=${month}&t=${Date.now()}`;

        previewContainer.innerHTML = `
            <div class="preview-title">
                <i class="fas fa-image"></i> Aktuelle Dienstplan-Vorschau (Mobil-Bild)
            </div>
            <div class="preview-img-container">
                <img src="${imageUrl}" alt="Dienstplan Vorschau" onerror="this.parentElement.innerHTML='<p style=padding:20px;>Vorschau momentan nicht verfügbar.</p>'">
            </div>
            <p class="small text-muted mt-2">
                <i class="fas fa-info-circle"></i> Dieses Bild wird automatisch an die Rundmail angehängt.
                Es zeigt die aktuellen Daten für ${month}/${year}.
            </p>
        `;
    } else {
        previewContainer.innerHTML = '';
    }
}

function selectTemplate(id) {
    activeTemplateId = id;
    renderList();

    const tmpl = currentTemplates.find(t => t.id === id);
    if (!tmpl) return;

    editorTitle.textContent = tmpl.name;
    descOutput.textContent = tmpl.description || '';
    placeOutput.textContent = tmpl.available_placeholders || '-';
    subjInput.value = tmpl.subject;
    bodyInput.value = tmpl.body;

    editorForm.style.display = 'block';
    statusMsg.textContent = '';

    // Vorschau aktualisieren
    updateRosterPreview(tmpl.key);
}

// 3. Vorlage speichern
saveBtn.onclick = async () => {
    if (!activeTemplateId) return;

    saveBtn.disabled = true;
    statusMsg.textContent = 'Speichere...';
    statusMsg.style.color = '#bdc3c7';

    const payload = {
        subject: subjInput.value,
        body: bodyInput.value
    };

    try {
        const updated = await apiFetch(`/api/emails/templates/${activeTemplateId}`, 'PUT', payload);

        const idx = currentTemplates.findIndex(t => t.id === activeTemplateId);
        if (idx !== -1) {
            currentTemplates[idx] = updated;
        }

        statusMsg.textContent = 'Gespeichert!';
        statusMsg.style.color = '#2ecc71';
        setTimeout(() => { statusMsg.textContent = ''; }, 2000);

    } catch (error) {
        statusMsg.textContent = 'Fehler: ' + error.message;
        statusMsg.style.color = '#e74c3c';
    } finally {
        saveBtn.disabled = false;
    }
};

// 4. Test-E-Mail senden
testBtn.onclick = async () => {
    if (!activeTemplateId) return;

    if (!confirm("Eine Test-E-Mail mit Dummy-Daten wird an DEINE Adresse gesendet. Fortfahren?")) {
        return;
    }

    testBtn.disabled = true;
    testBtn.textContent = 'Sende...';

    try {
        const resp = await apiFetch('/api/emails/test_send', 'POST', { template_id: activeTemplateId });
        alert(resp.message);
    } catch (error) {
        alert("Fehler beim Senden: " + error.message);
    } finally {
        testBtn.disabled = false;
        testBtn.textContent = 'Test-Mail an mich senden';
    }
};