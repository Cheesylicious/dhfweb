// sw.js
// WICHTIG: Wenn du in Zukunft Updates machst, ändere einfach diese Version.
const CACHE_NAME = 'dhf-planer-v4'; // <- Auf v4 erhöht, um das Update jetzt für alle zu erzwingen!

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
    // Externe Libs
    'https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.7.5/socket.io.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/Sortable/1.15.0/Sortable.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js'
];

// Install: Cache öffnen und Dateien speichern (und sofort aktiv werden)
self.addEventListener('install', (event) => {
    self.skipWaiting(); 
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[Service Worker] Caching App Shell (Bypass Browser Cache)');
            // Trick 1: Bei der Installation zwingen wir den Browser, die echten Dateien vom Server zu holen!
            return Promise.all(
                ASSETS_TO_CACHE.map(url => {
                    return fetch(new Request(url, { cache: 'reload' }))
                        .then(response => {
                            if (response.ok) {
                                return cache.put(url, response);
                            }
                        })
                        .catch(err => console.error('Cache Fehler für:', url, err));
                })
            );
        })
    );
});

// Activate: Alte Caches rigoros löschen
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((key) => {
                    if (key !== CACHE_NAME) {
                        console.log('[Service Worker] Lösche alten Cache:', key);
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim()) // Übernimmt sofort die Kontrolle
    );
});

// Fetch: NETWORK FIRST Strategie mit Cache-Busting
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // API-Anfragen und Bilder NICHT cachen
    if (url.pathname.startsWith('/api/') || url.pathname.includes('/photo/')) {
        event.respondWith(fetch(event.request));
        return;
    }

    // Trick 2: Im normalen Betrieb umgehen wir bei JS und HTML den unsichtbaren Browser-Cache
    let fetchReq = event.request;
    if (url.origin === location.origin && (url.pathname.endsWith('.js') || url.pathname.endsWith('.html'))) {
        fetchReq = new Request(event.request.url, { cache: 'no-cache' });
    }

    // Für alles andere: Erst Netzwerk, dann Cache (Network First)
    event.respondWith(
        fetch(fetchReq)
            .then((response) => {
                // Wenn das Netzwerk erfolgreich antwortet, packen wir die frische Datei in den Cache
                if (response && response.status === 200 && response.type === 'basic') {
                    const responseToCache = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return response; 
            })
            .catch(() => {
                // Offline-Modus
                console.log('[Service Worker] Offline-Modus greift für:', event.request.url);
                return caches.match(event.request);
            })
    );
});