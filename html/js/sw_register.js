// js/sw_register.js

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        // KORREKTUR: Den Zeitstempel entfernt, um die Endlosschleife zu verhindern!
        navigator.serviceWorker.register('/sw.js')
            .then(registration => {
                
                // Beobachtet, ob eine neue sw.js Version gefunden wurde
                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    newWorker.addEventListener('statechange', () => {
                        // Sobald die neue Version installiert ist...
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            console.log('Neues Update verfügbar! Lade Seite neu...');
                            // ...lädt das Handy die Seite vollautomatisch einmal neu!
                            window.location.reload(); 
                        }
                    });
                });

            })
            .catch(err => {
                console.error('ServiceWorker Registrierung fehlgeschlagen:', err);
            });
    });

    // Falls der Service Worker die Kontrolle übernimmt (nach einem Update)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
    });
}