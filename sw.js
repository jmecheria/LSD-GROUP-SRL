// ── LSD Group SRL — Service Worker ──
// Strategie: cache doar shell-ul static (fonturi, librării CDN, iconițe).
// Firebase/Firestore, Nominatim, OSRM, EmailJS — NICIODATĂ din cache (date live).
const CACHE_VERSION = 'lsd-v1';
const STATIC_CACHE = `lsd-static-${CACHE_VERSION}`;

// Domenii ale căror răspunsuri pot fi cache-uite (biblioteci, fonturi, tile-uri hartă)
const CACHEABLE_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com',
  'unpkg.com',
  'tile.openstreetmap.org',
  'api.qrserver.com'
];

// Domenii care NU trebuie NICIODATĂ servite din cache (date live / tranzacționale)
const NEVER_CACHE_HOSTS = [
  'firestore.googleapis.com',
  'firebaseapp.com',
  'identitytoolkit.googleapis.com',
  'googleapis.com/identitytoolkit',
  'nominatim.openstreetmap.org',
  'router.project-osrm.org',
  'overpass-api.de',
  'api.emailjs.com',
  'emailjs.com'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      // Pre-cache doar shell-ul de bază (pagina principală, ca fallback offline)
      return cache.addAll(['/', '/index.html']).catch(() => {
        // Dacă precache-ul eșuează (ex. cale diferită pe GitHub Pages), nu blocăm instalarea
      });
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith('lsd-') && k !== STATIC_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

function isNeverCache(url) {
  return NEVER_CACHE_HOSTS.some((h) => url.hostname.includes(h));
}
function isCacheableHost(url) {
  return CACHEABLE_HOSTS.some((h) => url.hostname.includes(h));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // nu interceptăm POST/PUT (scrieri Firestore etc.)

  const url = new URL(req.url);

  // 1. Date live — mereu din rețea, niciodată din cache
  if (isNeverCache(url)) {
    return; // lăsăm browserul să facă fetch normal, necontrolat de SW
  }

  // 2. Navigare (index.html) — network-first, fallback pe cache/offline dacă nu există net
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const resClone = res.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(req, resClone));
          return res;
        })
        .catch(() =>
          caches.match(req).then((cached) => cached || caches.match('/index.html'))
        )
    );
    return;
  }

  // 3. Resurse statice cache-uibile (fonturi, Leaflet, tile-uri hartă) — cache-first
  if (isCacheableHost(url) || req.destination === 'style' || req.destination === 'script' || req.destination === 'font') {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res.ok) {
            const resClone = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(req, resClone));
          }
          return res;
        }).catch(() => cached);
      })
    );
    return;
  }

  // 4. Orice altceva — trece direct prin rețea (comportament normal)
});
