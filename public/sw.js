self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { /* Display a safe fallback. */ }
  event.waitUntil(self.registration.showNotification(payload.title || 'RAS Radar', {
    body: payload.body || 'Há uma atualização no seu monitor de vagas.',
    icon: '/icon-192.png', badge: '/icon-192.png',
    tag: payload.tag || 'ras-update',
    data: { url: '/' },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async windows => {
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) { await existing.focus(); return existing.navigate('/'); }
    return self.clients.openWindow('/');
  }));
});
