// sw.js
// WICHTIG: Wenn du in Zukunft Updates machst, ändere einfach diese Version (v2 -> v3 -> v4).
// Das zwingt alle Handys weltweit, den Cache sofort zu leeren!
const CACHE_NAME = 'dhf-planer-v2';

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
    self.skipWaiting(); // Zwingt den Service Worker, nicht auf den Neustart des Browsers zu warten
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[Service Worker] Caching App Shell');
                return cache.addAll(ASSETS_TO_CACHE);
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
        }).then(() => self.clients.claim()) // Übernimmt sofort die Kontrolle über alle offenen Tabs
    );
});

// Fetch: NETWORK FIRST Strategie (Netzwerk vor Cache)
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // API-Anfragen und Bilder NICHT cachen (wir wollen Live-Daten!)
    if (url.pathname.startsWith('/api/') || url.pathname.includes('/photo/')) {
        event.respondWith(fetch(event.request));
        return;
    }

    // Für alles andere: Erst Netzwerk, dann Cache (Network First)
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Wenn das Netzwerk erfolgreich antwortet, packen wir die frische Datei in den Cache
                if (response && response.status === 200 && response.type === 'basic') {
                    const responseToCache = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return response; // Frische Antwort zurückgeben
            })
            .catch(() => {
                // NUR wenn der Fetch fehlschlägt (z.B. User ist offline), holen wir die Datei aus dem Cache
                console.log('[Service Worker] Offline-Modus greift für:', event.request.url);
                return caches.match(event.request);
            })
    );
});