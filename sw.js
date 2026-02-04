const CACHE_NAME = 'zenspend-v1';
const ASSETS = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/manifest.json',
    '/assets/mascot-zen.png',
    '/assets/mascot-suspicious.png',
    '/assets/mascot-panicked.png',
    '/assets/mascot-disappointed.png',
    '/assets/mascot-proud.png',
    '/assets/soft-chime.mp3',
    '/assets/hurtful-crunch.mp3',
    '/assets/icon-192.png',
    '/assets/icon-512.png',
    'https://cdn.jsdelivr.net/npm/dexie@3.2.4/dist/dexie.min.js',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
    'https://cdn.jsdelivr.net/npm/crypto-js@4.2.0/crypto-js.min.js'
];

// Install - Cache assets
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Activate - Clean old caches
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch - Cache first, then network
self.addEventListener('fetch', (e) => {
    e.respondWith(
        caches.match(e.request)
            .then(cached => {
                if (cached) return cached;
                
                return fetch(e.request)
                    .then(response => {
                        // Don't cache non-successful responses
                        if (!response || response.status !== 200) {
                            return response;
                        }
                        
                        // Clone and cache
                        const clone = response.clone();
                        caches.open(CACHE_NAME)
                            .then(cache => cache.put(e.request, clone));
                        
                        return response;
                    })
                    .catch(() => {
                        // Offline fallback for HTML
                        if (e.request.headers.get('accept').includes('text/html')) {
                            return caches.match('/index.html');
                        }
                    });
            })
    );
});