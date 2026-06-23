const CACHE_NAME = 'sakkhi-cache-v1';

// These are the exact paths based on your GitHub repository structure
const urlsToCache = [
  '/',
  '/index.html',
  '/app/',
  '/app/index.html',
  '/manifest.json',
  '/sakkhi 300px.png',
  '/SAKKHIheader.png'
];

// Install the service worker and cache the app shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

// Intercept network requests and serve from cache if available
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Return the cached version if found, otherwise fetch from the network
        return response || fetch(event.request);
      })
  );
});
