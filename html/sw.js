// sw.js
const CACHE_NAME = 'dhf-planer-v5'; // Wieder erhöht, damit das Logout-Update sofort greift!

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

// Install: Cache öffnen und Dateien speichern
self.addEventListener('install', (event) => {
    self.skipWaiting(); 
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[Service Worker] Caching App Shell');
            return Promise.all(
                ASSETS_TO_CACHE.map(url => {
                    return fetch(new Request(url, { cache: 'reload' }))
                        .then(response => {
                            if (response.ok) return cache.put(url, response);
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
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch: NETWORK FIRST Strategie
self.addEventListener('fetch', (event) => {
    
    // --- LÖSUNG FÜR DIE LOGOUTS ---
    // POST-Anfragen (Login, Socket.io Echtzeit-Updates) NIEMALS cachen!
    if (event.request.method !== 'GET') {
        event.respondWith(fetch(event.request));
        return;
    }

    const url = new URL(event.request.url);

    // API-Anfragen und Sockets NICHT cachen
    if (url.pathname.startsWith('/api/') || url.pathname.includes('/photo/') || url.pathname.includes('socket.io')) {
        event.respondWith(fetch(event.request));
        return;
    }

    let fetchReq = event.request;
    if (url.origin === location.origin && (url.pathname.endsWith('.js') || url.pathname.endsWith('.html'))) {
        fetchReq = new Request(event.request.url, { cache: 'no-cache' });
    }

    event.respondWith(
        fetch(fetchReq)
            .then((response) => {
                if (response && response.status === 200 && response.type === 'basic') {
                    const responseToCache = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return response; 
            })
            .catch(() => {
                return caches.match(event.request);
            })
    );
});