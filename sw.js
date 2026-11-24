// Service worker della versione web: tiene in memoria i file dell'app, così si apre anche con rete scarsa.
// Prima prova la rete (per avere sempre l'ultima versione pubblicata), se non c'è usa la copia salvata.
// Riguarda solo i file dell'app sul proprio sito: prezzi, immagini e Google passano normalmente.
const CACHE = 'vetrina-app-v11';
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(e.request, c)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
});
