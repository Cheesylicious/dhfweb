// js/utils/api.js
import { API_URL } from './constants.js';
import { logout } from './auth.js';

/**
 * Zentrale Fetch-Funktion mit Authentifizierung und Fehlerbehandlung.
 * @param {string} endpoint - Der API-Endpunkt (z.B. /api/shifts)
 * @param {string} [method='GET'] - HTTP-Methode
 * @param {object|null} [body=null] - Der JSON-Body für POST/PUT
 * @returns {Promise<any>} - Die JSON-Antwort der API
 */
export async function apiFetch(endpoint, method = 'GET', body = null) {
    const options = {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
    };
    if (body) {
        options.body = JSON.stringify(body);
    }

    const response = await fetch(API_URL + endpoint, options);

    if (response.status === 401 || response.status === 403) {
        if (response.status === 401) {
            logout(); // Nur bei 401 (Unauthorized) ausloggen
        }

        // Versuche, die JSON-Fehlermeldung zu lesen (z.B. "Aktion blockiert")
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Sitzung ungültig oder fehlende Rechte.');
        }
        throw new Error('Sitzung ungültig oder fehlende Rechte.');
    }

    const contentType = response.headers.get("content-type");
    let data;

    if (contentType && contentType.indexOf("application/json") !== -1) {
        data = await response.json();
    } else {
        data = { message: await response.text() };
    }

    if (!response.ok) {
        throw new Error(data.message || 'API-Fehler');
    }
    return data;
}