// Sakkhi push service worker. Lives next to app.html in the repo root.
// Separate from the existing sw.js on purpose, so that file isn't touched.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// A push arrived from the server — show it, even if Sakkhi is closed.
// (iPhone requires every push to show a notification, so we always do.)
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (e) { data = { body: event.data ? event.data.text() : '' }; }

  const title = data.title || 'Sakkhi';
  const options = {
    body: data.body || '',
    tag: data.tag || undefined,          // same tag = replaces, never stacks duplicates
    icon: '/sakkhi%20300px.png',
    badge: '/sakkhi%20300px.png',
    data: { url: data.url || '' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Tapping the notification opens Sakkhi (or brings it to the front).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '';
  const target = url ? '/?open=' + encodeURIComponent(url) : '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) { await c.focus(); return; }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
