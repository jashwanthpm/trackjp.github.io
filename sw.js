// Bump this version number if you ever make major updates to force a cache refresh
const CACHE_NAME = 'sakkhi-app-v7.9'; 

const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/sakkhi 300px.png',
  '/SAKKHIheader.png',
  '/app/',
  '/admin/'
];

// Offline fallback page
const OFFLINE_PAGE = '/offline.html'; // Make sure you create this file

self.addEventListener('install', event => {
  self.skipWaiting(); // Force the new service worker to activate immediately
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('✅ Opened cache: ', CACHE_NAME);
        return cache.addAll(URLS_TO_CACHE);
      })
      .catch(err => {
        console.error('❌ Cache install error:', err);
      })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️  Deleting old cache:', cacheName);
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
    return; // Bypass the Service Worker entirely for external requests
  }

  // =========================================================
  // 2. LOCAL CACHING: Stale-While-Revalidate Strategy with PROPER FALLBACK
  // =========================================================
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      
      const fetchPromise = fetch(event.request)
        .then(networkResponse => {
          // Only cache successful local requests
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(err => {
          console.error('❌ Network request failed for:', event.request.url, err);
          
          // CRITICAL FIX: Return cached response OR offline page
          if (cachedResponse) {
            return cachedResponse; // Use cached version if available
          }
          
          // If it's a navigation request (HTML page), return offline page
          if (event.request.mode === 'navigate') {
            return caches.match(OFFLINE_PAGE).catch(() => {
              // Last resort: return a basic offline response
              return new Response('Offline - Please check your connection', {
                status: 503,
                statusText: 'Service Unavailable',
                headers: new Headers({ 'Content-Type': 'text/plain' })
              });
            });
          }
          
          // For non-HTML requests, return a network error response
          return new Response('Network request failed', {
            status: 408,
            statusText: 'Request Timeout',
            headers: new Headers({ 'Content-Type': 'text/plain' })
          });
        });

      // Return cached immediately if available, otherwise wait for network
      return cachedResponse || fetchPromise;
    })
  );
});
