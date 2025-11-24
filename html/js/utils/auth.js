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
        document.getElementById('welcome-user').textContent = `Willkommen, ${user.vorname}!`;

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

        } else if (isPlanschreiber) {
            if (navUsers) navUsers.style.display = 'none';
            if (navFeedback) {
                navFeedback.style.display = 'inline-flex';
                navFeedback.href = 'anfragen.html'; // Planschreiber geht direkt zu den Anfragen
            }

        } else {
            if (navUsers) navUsers.style.display = 'none';
            if (navFeedback) navFeedback.style.display = 'none';
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