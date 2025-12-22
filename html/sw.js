const CACHE_NAME = 'dhf-planer-v1';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './schichtplan.html',
    './dashboard.html',
    './css/themes.css',
    // Wichtige Skripte
    './js/pages/schichtplan.js',
    './js/modules/schichtplan_api.js',
    './js/modules/schichtplan_renderer.js',
    './js/modules/schichtplan_state.js',
    './js/modules/schichtplan_handlers.js',
    './js/modules/prediction_ui.js',
    './js/utils/api.js',
    './js/utils/auth.js',
    './js/utils/constants.js',
    './js/utils/helpers.js',
    // Externe Libs (Optional, besser lokal speichern, aber so geht's auch)
    'https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.7.5/socket.io.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/Sortable/1.15.0/Sortable.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js'
];

// Install: Cache öffnen und Dateien speichern
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[Service Worker] Caching App Shell');
                return cache.addAll(ASSETS_TO_CACHE);
            })
    );
});

// Activate: Alte Caches löschen
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((key) => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        })
    );
});

// Fetch: Anfragen abfangen
self.addEventListener('fetch', (event) => {
    // API-Anfragen NICHT cachen (wir wollen ja Live-Daten!)
    if (event.request.url.includes('/api/')) {
        event.respondWith(fetch(event.request));
        return;
    }

    // Für alles andere: Erst Cache, dann Netzwerk (Cache First)
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                // Treffer im Cache? Zurückgeben!
                if (response) {
                    return response;
                }
                // Sonst aus dem Netz holen
                return fetch(event.request);
            })
    );
});