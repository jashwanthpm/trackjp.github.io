// Bump this version number if you ever make major updates to force a cache refresh
const CACHE_NAME = 'sakkhi-app-v8.0'; 

// Critical local files to cache
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/app.html',
  '/admin.html',
  '/booking.html',
  '/landing_page.html',
  '/manifest.json',
  '/offline.html',
  '/sakkhi 300px.png',
  '/SAKKHIheader.png'
];

// Offline fallback page
const OFFLINE_PAGE = '/offline.html';

// ============================================
// INSTALL EVENT - Cache essential files
// ============================================
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('✅ Opened cache:', CACHE_NAME);
        return cache.addAll(URLS_TO_CACHE).catch(err => {
          console.warn('⚠️ Some files failed to cache (this is OK):', err);
          // Don't fail installation if some files aren't available
        });
      })
      .catch(err => console.error('❌ Cache install error:', err))
  );
});

// ============================================
// ACTIVATE EVENT - Clean up old caches
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
// FETCH EVENT - Handle requests intelligently
// ============================================
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Skip chrome extensions and other non-http protocols
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return;
  }

  // ========================================
  // 1. EXTERNAL RESOURCES (CDN, APIs, Fonts)
  // ========================================
  // These should ALWAYS come from network first
  const externalDomains = [
    'cdn.tailwindcss.com',
    'cdn.jsdelivr.net',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'accounts.google.com',
    'cdnjs.cloudflare.com',
    'checkout.razorpay.com',
    'api.razorpay.com',
    'supabase.co',
    'supabaseusercontent.com',
    'cdn.jsdelivr.net'
  ];

  const isExternal = externalDomains.some(domain => url.hostname.includes(domain));
  
  if (isExternal) {
    // Network-first for external resources (CDN, APIs, fonts)
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Cache successful responses
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseToCache);
            });
          }
          return response;
        })
        .catch(err => {
          // If network fails, try cache
          console.warn('⚠️ External resource failed, checking cache:', url.href);
          return caches.match(event.request).then(cachedResponse => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // No cache available, return error response
            return new Response('External resource unavailable', {
              status: 503,
              statusText: 'Service Unavailable'
            });
          });
        })
    );
    return;
  }

  // ========================================
  // 2. LOCAL PAGES & ASSETS
  // ========================================
  // Stale-while-revalidate for local files
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      
      const fetchPromise = fetch(event.request)
        .then(networkResponse => {
          // Only cache successful local responses
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseToCache);
            }).catch(err => {
                console.warn('Cache update failed:', err);
              });
          }
          return networkResponse;
        })
        .catch(err => {
          console.error('❌ Network request failed:', url.href, err);
          
          // Return cached version if available
          if (cachedResponse) {
            return cachedResponse;
          }
          
          // For navigation requests (HTML pages), return offline page
          if (event.request.mode === 'navigate') {
            return caches.match(OFFLINE_PAGE).catch(() => {
              return new Response(
                '<!DOCTYPE html><html><head><title>Offline</title></head><body style="background:#050505;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;"><div style="text-align:center;"><h1>📡 Offline</h1><p>Check your internet connection</p></div></body></html>',
                {
                  status: 503,
                  statusText: 'Service Unavailable',
                  headers: new Headers({ 'Content-Type': 'text/html' })
                }
              );
            });
          }
          
          // For API/resource requests, return error
          return new Response('Resource unavailable', {
            status: 408,
            statusText: 'Request Timeout'
          });
        });

      // Return cached immediately if available, otherwise wait for network
      return cachedResponse || fetchPromise;
    })
  );
});
