// js/sw_register.js
// Service Worker und alte Browser-Caches deaktivieren, damit keine veralteten Dateien
// wie schichtplan.js aus einem frueheren Zwischenstand geladen werden.

const DHF_CACHE_RESET_VERSION = '20260717-cache-reset-2';

async function clearDHFOfflineCache() {
    try {
        let didClearSomething = false;

        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            didClearSomething = didClearSomething || registrations.length > 0;
            await Promise.all(registrations.map((registration) => registration.unregister()));
        }

        if ('caches' in window) {
            const cacheNames = await caches.keys();
            didClearSomething = didClearSomething || cacheNames.length > 0;
            await Promise.all(cacheNames.map((name) => caches.delete(name)));
        }

        console.log('DHF Offline-Cache deaktiviert.');

        if (didClearSomething && sessionStorage.getItem('dhf_cache_reset_version') !== DHF_CACHE_RESET_VERSION) {
            sessionStorage.setItem('dhf_cache_reset_version', DHF_CACHE_RESET_VERSION);
            const cleanUrl = new URL(window.location.href);
            cleanUrl.searchParams.set('cache_reset', DHF_CACHE_RESET_VERSION);
            window.location.replace(cleanUrl.toString());
        }
    } catch (error) {
        console.warn('DHF Offline-Cache konnte nicht vollstaendig geleert werden:', error);
    }
}

window.addEventListener('load', clearDHFOfflineCache);
