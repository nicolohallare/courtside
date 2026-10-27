// Match Day Pickle service worker: notifications only. No caching, so updates land immediately.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Old app links (/#slots, /#home) mapped to the new screens.
const route = (u) => {
  if (!u) return '/bookings/';
  if (u.startsWith('/#slots') || u.startsWith('#slots')) return '/bookings/';
  if (u.startsWith('/#') || u.startsWith('#')) return '/';
  return u;
};

self.addEventListener('push', (event) => {
  let p = { title: 'Match Day Pickle!', body: 'You have an update.' };
  if (event.data) { try { p = { ...p, ...event.data.json() }; } catch { p.body = event.data.text(); } }
  event.waitUntil(self.registration.showNotification(p.title, {
    body: p.body, icon: '/icons/icon-192.png', badge: '/icons/icon-96.png',
    tag: p.tag || 'mdp', renotify: true, data: { url: route(p.url) }, vibrate: [120, 60, 120],
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const to = event.notification.data?.url || '/bookings/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin) { await c.focus(); try { await c.navigate(to); } catch {} return; }
    }
    await self.clients.openWindow(to);
  })());
});
