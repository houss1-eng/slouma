// Service worker : ouverture hors ligne + notifications push (même application fermée).
const VERSION = 'elegance-v1';
const FILES = ['/', '/index.html', '/style.css', '/app.js', '/icons/logo.png', '/icons/logo-full.png', '/icons/icon-192.png', '/icons/badge.png', '/manifest.webmanifest'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))));
  self.clients.claim();
});
// réseau d'abord (toujours la dernière version) ; le cache ne sert que sans Internet. L'API n'est jamais mise en cache.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const c = r.clone(); caches.open(VERSION).then(x => x.put(e.request, c)); }
    return r;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('/index.html'))));
});
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data.json(); } catch (x) { d = { body: e.data && e.data.text() }; }
  // icon : grande image dans la notification ; badge : petite icône blanche de la barre d'état (Android)
  // tag unique + renotify : chaque notification s'affiche et fait vibrer, sans remplacer la précédente
  e.waitUntil(self.registration.showNotification(d.title || 'Elegance Barber Shop', {
    body: d.body || '', icon: '/icons/icon-192.png', badge: '/icons/badge.png',
    tag: d.tag || String(Date.now()), renotify: true, vibrate: [200, 100, 200], data: { url: d.url || '/' },
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    const w = ws.find(x => x.url.startsWith(self.registration.scope));
    const url = (e.notification.data && e.notification.data.url) || '/';
    return w ? w.focus() : clients.openWindow(url);
  }));
});
