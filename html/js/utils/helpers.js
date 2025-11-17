// js/utils/helpers.js
// (Enthält jetzt alle Helfer von schichtplan.js und anfragen.js)

/**
 * Prüft, ob eine HEX-Farbe dunkel ist (für Schrift-Kontrast).
 * @param {string} hexColor - z.B. '#FF0000'
 * @returns {boolean} - true wenn dunkel
 */
export function isColorDark(hexColor) {
    if (!hexColor) return false;
    const hex = hexColor.replace('#', '');
    if (hex.length !== 6) return false;
    try {
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminance < 0.5;
    } catch (e) {
        return false;
    }
}

/**
 * Definiert, ob eine Anfrage eine "Wunsch-Anfrage" ist.
 * (Wird von schichtplan.js und anfragen.js verwendet)
 * @param {object} q - Das Query-Objekt
 * @returns {boolean}
 */
export const isWunschAnfrage = (q) => {
    if (!q || !q.sender_role_name || !q.message) return false;
    return q.sender_role_name === 'Hundeführer' && q.message.startsWith("Anfrage für:");
};

/**
 * Löst das globale Event aus, um den Notification-Header zu aktualisieren.
 * (Wird von schichtplan.js und anfragen.js verwendet)
 */
export function triggerNotificationUpdate() {
    window.dispatchEvent(new CustomEvent('dhf:notification_update'));
}

/**
 * Entschärft HTML-Sonderzeichen, um XSS in <p> oder <li> Tags zu verhindern.
 * @param {string} str - Der rohe Text
 * @returns {string} - Der entschärfte Text
 */
export function escapeHTML(str) {
    if (typeof str !== 'string') return '';
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