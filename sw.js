// GITHUB PAGES OPTIMIZED SERVICE WORKER
// GitHub Pages has some network restrictions, this version handles that

const CACHE_NAME = 'sakkhi-v9.2';

const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/landing_page.html',
  '/app.html',
  '/admin.html',
  '/booking.html',
  '/offline.html',
  '/manifest.json'
];

// ============================================
// INSTALL - Cache essential local files only
// ============================================
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('✅ GitHub Pages SW: Opened cache');
        // Try to cache, but don't fail if some files aren't available
        return cache.addAll(URLS_TO_CACHE).catch(err => {
          console.warn('⚠️ Some files not cached:', err);
        });
      })
  );
});

// ============================================
// ACTIVATE - Clean up old caches
// ============================================
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// ============================================
// FETCH - Network-first for everything
// GitHub Pages can be finicky with caching
// ============================================
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Skip chrome extensions and non-http
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return;
  }

  // Network-first for everything (GitHub Pages prefers this)
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache successful responses
        if (response && response.status === 200) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          }).catch(() => {
            // Cache update failed, that's OK
          });
        }
        return response;
      })
      .catch(err => {
        console.warn('⚠️ Network failed, trying cache:', url.href);
        
        // Try cache as fallback
        return caches.match(event.request).then(cachedResponse => {
          if (cachedResponse) {
            return cachedResponse;
          }
          
          // For navigation requests, return offline page
          if (event.request.mode === 'navigate') {
            return caches.match('/offline.html').catch(() => {
              return new Response(
                '<!DOCTYPE html><html><head><title>Offline</title><style>body{background:#050505;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;margin:0;}div{text-align:center;}</style></head><body><div><h1>📡 Connection Failed</h1><p>Check your internet connection</p><button onclick="location.reload()" style="margin-top:20px;padding:12px 24px;background:#c9a96e;color:#000;border:none;border-radius:8px;cursor:pointer;font-weight:bold;">Try Again</button></div></body></html>',
                {
                  status: 503,
                  statusText: 'Service Unavailable',
                  headers: new Headers({ 'Content-Type': 'text/html' })
                }
              );
            });
          }
          
          // For other requests, return error
          return new Response('Resource unavailable', {
            status: 408,
            statusText: 'Request Timeout'
          });
        });
      })
  );
});
