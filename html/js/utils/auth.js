// js/utils/auth.js
import { API_URL } from './constants.js';

// --- Auto-Logout Timer Logik ---
const LOGOUT_TIMEOUT_MS = 5 * 60 * 1000; // 5 Minuten
let inactivityTimer;

/**
 * Führt den eigentlichen Auto-Logout durch.
 */
function performAutoLogout() {
    console.log("Inaktivität (5 Min) erkannt. Führe Auto-Logout durch.");
    localStorage.removeItem('dhf_user');
    window.location.href = 'index.html?logout=true&reason=inactivity';
}

/**
 * Setzt den Inaktivitäts-Timer zurück.
 */
function resetInactivityTimer() {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(performAutoLogout, LOGOUT_TIMEOUT_MS);
}

/**
 * Startet die globalen Event-Listener für den Inaktivitäts-Timer.
 */
function initializeInactivityTimer() {
    const activityEvents = [
        'mousemove', 'mousedown', 'keydown',
        'touchstart', 'scroll'
    ];

    // Hänge die Listener an das window-Objekt
    activityEvents.forEach(event => {
        window.addEventListener(event, resetInactivityTimer, true);
    });

    // Starte den Timer initial
    resetInactivityTimer();
}

/**
 * Führt einen Logout durch (API-Call und LocalStorage-Clear).
 */
export async function logout() {
    try {
        await fetch(API_URL + '/api/logout', {
            method: 'POST',
            credentials: 'include'
        });
    } catch (e) {
        console.error("Fehler beim Server-Logout, fahre fort:", e);
    } finally {
        localStorage.removeItem('dhf_user');
        window.location.href = 'index.html?logout=true';
    }
}

/**
 * Führt den initialen Authentifizierungs-Check aus.
 * Passt die Navigation an (inkl. Link-Korrektur für Planschreiber) und gibt die User-Daten zurück.
 * @returns {{user: object, isAdmin: boolean, isVisitor: boolean, isPlanschreiber: boolean, isHundefuehrer: boolean}}
 */
export function initAuthCheck() {
    let user, isAdmin = false, isVisitor = false, isPlanschreiber = false, isHundefuehrer = false;

    try {
        user = JSON.parse(localStorage.getItem('dhf_user'));
        if (!user || !user.vorname || !user.role) {
            throw new Error("Kein User oder fehlende Rolle");
        }

        // --- NEU: Begrüßungstext durch auffälligen Profil-Link ersetzen ---
        const welcomeEl = document.getElementById('welcome-user');
        if (welcomeEl) {
            // Erstelle einen neuen Link
            const profileLink = document.createElement('a');
            profileLink.href = 'profile.html';
            profileLink.id = 'welcome-user';

            // VISUELLE VERBESSERUNG: Icon hinzufügen & Text formatieren
            profileLink.innerHTML = `
                <span style="opacity:0.7; font-weight:400;">Willkommen,</span>
                ${user.vorname}
                <span style="font-size: 1.2em; vertical-align: middle; margin-left: 5px;">👤</span>
            `;
            profileLink.title = "Hier klicken, um dein Profil zu bearbeiten";

            // Styles für Interaktivität
            profileLink.style.color = '#bdc3c7';
            profileLink.style.textDecoration = 'none';
            profileLink.style.fontWeight = '600'; // Name etwas fetter
            profileLink.style.marginRight = '15px';
            profileLink.style.transition = 'all 0.2s ease';
            profileLink.style.cursor = 'pointer';

            // Flexbox damit Icon und Text sauber in einer Linie sind
            profileLink.style.display = 'inline-flex';
            profileLink.style.alignItems = 'center';
            profileLink.style.padding = '5px 10px';
            profileLink.style.borderRadius = '20px'; // "Pillen"-Form

            // Hover-Effekt: Hintergrund aufleuchten lassen
            profileLink.onmouseover = () => {
                profileLink.style.color = '#ffffff';
                profileLink.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'; // Glas-Highlight
                profileLink.style.boxShadow = '0 0 10px rgba(255,255,255,0.1)';
            };
            profileLink.onmouseout = () => {
                profileLink.style.color = '#bdc3c7';
                profileLink.style.backgroundColor = 'transparent';
                profileLink.style.boxShadow = 'none';
            };

            // Das ursprüngliche Element ersetzen
            welcomeEl.replaceWith(profileLink);
        }
        // --- ENDE NEU ---

        // Rollen bestimmen
        isAdmin = user.role.name === 'admin';
        isVisitor = user.role.name === 'Besucher';
        isPlanschreiber = user.role.name === 'Planschreiber';
        isHundefuehrer = user.role.name === 'Hundeführer';

        // CSS-Klassen an <body> für globales Styling
        if (isAdmin) document.body.classList.add('admin-mode');
        if (isPlanschreiber) document.body.classList.add('planschreiber-mode');
        if (isHundefuehrer) document.body.classList.add('hundefuehrer-mode');
        if (isVisitor) document.body.classList.add('visitor-mode');

        // DOM-Elemente für Navigation holen
        const navDashboard = document.getElementById('nav-dashboard');
        const navUsers = document.getElementById('nav-users');
        const navFeedback = document.getElementById('nav-feedback');

        // --- NEU: Statistik-Link ---
        const navStatistik = document.getElementById('nav-statistik');

        // --- NEU: E-Mails Link ---
        const navEmails = document.getElementById('nav-emails');

        // Navigations-Logik
        if (navDashboard) navDashboard.style.display = isVisitor ? 'none' : 'block';

        // --- STATISTIK SICHTBARKEIT ---
        if (navStatistik) {
            if (isAdmin || (user.can_see_statistics === true)) {
                navStatistik.style.display = 'inline-flex';
            } else {
                navStatistik.style.display = 'none';
            }
        }
        // --- ENDE STATISTIK ---

        // --- KORREKTUR: Dynamische Link-Anpassung für Planschreiber ---
        if (isAdmin) {
            if (navUsers) navUsers.style.display = 'block';
            if (navFeedback) {
                navFeedback.style.display = 'inline-flex';
                navFeedback.href = 'feedback.html'; // Admin geht zur Feedback-Verwaltung
            }
            // NEU: E-Mails Link nur für Admin
            if (navEmails) navEmails.style.display = 'inline-flex';

        } else if (isPlanschreiber) {
            if (navUsers) navUsers.style.display = 'none';
            if (navEmails) navEmails.style.display = 'none'; // Verstecken
            if (navFeedback) {
                navFeedback.style.display = 'inline-flex';
                navFeedback.href = 'anfragen.html'; // Planschreiber geht direkt zu den Anfragen
            }

        } else {
            if (navUsers) navUsers.style.display = 'none';
            if (navFeedback) navFeedback.style.display = 'none';
            if (navEmails) navEmails.style.display = 'none'; // Verstecken
        }

        if (isVisitor) {
            if (navDashboard) navDashboard.style.display = 'none';
            if (navUsers) navUsers.style.display = 'none';
        }

        // Logout-Button
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.onclick = logout;
        }

        // Inaktivitäts-Timer starten
        initializeInactivityTimer();

    } catch (e) {
        console.error("Authentifizierungsfehler:", e.message);
        if (!window.location.pathname.endsWith('index.html')) {
            logout();
        }
        throw e;
    }

    return { user, isAdmin, isVisitor, isPlanschreiber, isHundefuehrer };
}