// NEUE DATEI: html/js/utils/pet_renderer.js

/**
 * Initialisiert und rendert die aktive Lottie-Figur im Header.
 * Muss auf jeder Seite eingebunden werden, die den Pet-Container hat.
 *
 * @param {string | null} assetKey - Der Pfad zur Lottie JSON Datei (aus user.active_pet_asset).
 */
export function renderPetAnimation(assetKey) {
    const activePetContainer = document.getElementById('active-pet-container');
    // Stelle sicher, dass der Lottie Player im HTML geladen ist
    if (!activePetContainer || typeof lottie === 'undefined') return;

    // Zuerst eine eventuell vorhandene Animation zerstören
    if (activePetContainer.lottieAnimation) {
        activePetContainer.lottieAnimation.destroy();
    }

    if (assetKey) {
        activePetContainer.style.display = 'block';

        // Lottie Animation initialisieren und speichern
        activePetContainer.lottieAnimation = lottie.loadAnimation({
            container: activePetContainer,
            renderer: 'svg',
            loop: true,
            autoplay: true,
            path: assetKey
        });
    } else {
        // Keine Figur ausgewählt, Container ausblenden
        activePetContainer.style.display = 'none';
    }
}

/**
 * Ruft die Benutzerdaten aus dem LocalStorage ab und initialisiert die Figur.
 * Sollte in der Haupt-JS-Datei jeder geschützten Seite (z.B. schichtplan.js) aufgerufen werden.
 *
 * @param {object} user - Das User-Objekt, das active_pet_asset enthält.
 */
export function initPetDisplay(user) {
    if (user && user.active_pet_asset) {
        renderPetAnimation(user.active_pet_asset);
    } else {
        renderPetAnimation(null); // Sicherstellen, dass der Container ausgeblendet ist
    }
}