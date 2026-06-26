// Bump this version number if you ever make major updates to force a cache refresh
const CACHE_NAME = 'sakkhi-app-v7.4'; 

const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/sakkhi 300px.png',
  '/SAKKHIheader.png'
];

self.addEventListener('install', event => {
  self.skipWaiting(); // Force the new service worker to activate immediately
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(URLS_TO_CACHE))
      .catch(err => console.log('Cache install error:', err))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // =========================================================
  // 1. THE BOUNCER: Ignore all external APIs, CDNs, and Fonts
  // =========================================================
  if (!url.origin.startsWith(self.location.origin) || url.protocol === 'chrome-extension:') {
    return; // Bypass the Service Worker entirely.
  }

  // =========================================================
  // 2. LOCAL CACHING: Stale-While-Revalidate Strategy
  // =========================================================
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      
      const fetchPromise = fetch(event.request).then(networkResponse => {
        // CLONE IMMEDIATELY before the browser uses the response
        const responseToCache = networkResponse.clone();
        
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(err => {
        console.log('Network request failed, relying on cache.', err);
      });

      return cachedResponse || fetchPromise;
    })
  );
});
