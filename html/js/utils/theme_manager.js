// html/js/utils/theme_manager.js

/**
 * Wendet das Theme an. Prüft zuerst auf eine aktive Testphase (Preview),
 * dann auf das gekaufte Theme des Users.
 */
export function applyTheme(user) {
    const body = document.body;

    // 1. Prüfen ob eine Testphase läuft
    const previewData = JSON.parse(localStorage.getItem('dhf_theme_preview'));

    if (previewData) {
        const now = new Date().getTime();
        if (now < previewData.expiresAt) {
            // Testphase ist noch aktiv
            setThemeClass(previewData.themeKey);

            // Optional: Kleiner Hinweis, wie lange noch
            const minutesLeft = Math.ceil((previewData.expiresAt - now) / 60000);
            console.log(`Theme Preview aktiv: ${minutesLeft} min verbleibend.`);
            return;
        } else {
            // Abgelaufen -> Löschen
            localStorage.removeItem('dhf_theme_preview');
            alert("Die Testphase für das Design ist abgelaufen. Zurück zum Standard.");
        }
    }

    // 2. Fallback auf User Theme (Gekauft)
    if (user && user.active_theme) {
        setThemeClass(user.active_theme);
    } else {
        // Standard
        body.className = '';
    }
}

/**
 * Startet eine 5-minütige Testphase für ein Theme.
 */
export function startThemePreview(themeKey) {
    const expiresAt = new Date().getTime() + (5 * 60 * 1000); // Jetzt + 5 Minuten
    const previewData = {
        themeKey: themeKey,
        expiresAt: expiresAt
    };
    localStorage.setItem('dhf_theme_preview', JSON.stringify(previewData));

    // Sofort anwenden
    setThemeClass(themeKey);
    alert(`Vorschau aktiviert! Du kannst dieses Design nun 5 Minuten lang testen.`);
}

/**
 * Hilfsfunktion zum Setzen der Klasse auf dem Body
 */
function setThemeClass(className) {
    // Entfernt alle existierenden Theme-Klassen (die mit 'theme-' beginnen)
    const body = document.body;
    const classes = body.className.split(" ").filter(c => !c.startsWith("theme-"));
    body.className = classes.join(" ").trim();

    // Neue Klasse hinzufügen (außer es ist default)
    if (className && className !== 'theme-default') {
        body.classList.add(className);
    }
}