// Service worker : l'app fonctionne hors ligne (cache d'abord, mise à jour en arrière-plan).
const V = 'temps-v6';
const ASSETS = ['./', 'index.html', 'style.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/ui.js', 'js/store.js', 'js/time.js', 'js/analysis.js', 'js/planner.js', 'js/signals.js', 'js/notify.js', 'js/calendar.js', 'js/classify.js', 'js/google.js', 'js/lock.js', 'js/colors.js', 'js/main.js'];

self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Réseau d'abord (toujours la dernière version, ex. le verrou à code), cache en secours hors ligne.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(V).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request)));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(cs => (cs[0] ? cs[0].focus() : self.clients.openWindow('./'))));
});
