// ══════════════════════════════════════════════════════════
// Service Worker — LSD Group SRL
// Rol: transformă site-ul într-o aplicație instalabilă (PWA),
// cu pornire rapidă și o funcționare minimă offline pentru
// pagina principală. Datele live (Firebase, EmailJS, hărți)
// NU sunt cache-uite — merg mereu direct la rețea, ca prețurile,
// locurile disponibile și rezervările să fie mereu la zi.
// ══════════════════════════════════════════════════════════

// Crește acest număr de fiecare dată când modifici index.html/manifest/iconițe,
// ca browserul să știe că trebuie să descarce din nou și să activeze versiunea nouă.
const CACHE_VERSION = 'v1';
const CACHE_NAME = 'lsd-group-' + CACHE_VERSION;

// Fișierele esențiale ("app shell") — cele care fac site-ul să pornească instant
// și să afișeze măcar interfața de bază chiar și fără conexiune.
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

// ── INSTALL: pre-încarcă app shell-ul ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .catch(err => console.warn('[SW] Precache eșuat (unele fișiere pot lipsi):', err))
  );
});

// ── ACTIVATE: curăță cache-urile vechi, preia controlul imediat ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── MESSAGE: permite paginii să forțeze activarea versiunii noi instant ──
// index.html deja trimite acest mesaj când detectează un SW nou instalat.
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── FETCH ──
self.addEventListener('fetch', event => {
  const req = event.request;

  // Doar cereri GET pot fi cache-uite/interceptate; restul (POST către Firestore etc.) trec direct.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Nu interceptăm NIMIC cross-origin: Firebase/Firestore, EmailJS, hărți (OSM/OSRM/Nominatim),
  // fonturi Google, imagini Unsplash, QR API etc. Acestea trebuie să fie mereu live/actuale,
  // iar unele (Firestore streaming, WebSocket-uri) nici nu se pot cache-ui corect.
  if (url.origin !== self.location.origin) return;

  // Navigare (utilizatorul deschide/reîncarcă site-ul): încearcă rețeaua întâi,
  // ca să vadă mereu ultima versiune; dacă e offline, cade pe copia din cache.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy)).catch(()=>{});
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Restul fișierelor statice proprii (manifest, iconițe): cache-first cu
  // reîmprospătare în fundal, pentru pornire instant + actualizare automată.
  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(()=>{});
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
