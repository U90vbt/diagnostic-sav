/* DIAG·SAV — service worker : fonctionnement hors ligne après le premier chargement.
   - Fichiers de l'application : servis depuis le cache, mis à jour en arrière-plan.
   - Données (data/decisions.json, data/catalogue.json) : réseau d'abord, cache en secours,
     pour que les modifications SAV soient visibles dès que le réseau est disponible.
   Incrémenter CACHE_VERSION à chaque modification de index.html / styles.css / app.js. */

const CACHE_VERSION = 'diagsav-v1.7.0';
const DATA_PATH = 'data/decisions.json';
const CATALOGUE_PATH = 'data/catalogue.json';
const SHELL = [
  CATALOGUE_PATH,
  './',
  'index.html',
  'styles.css',
  'app.js',
  'editor.js',
  'pdf.js',
  DATA_PATH,
  'manifest.webmanifest',
  'icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // aucune ressource externe

  // Données (procédures, catalogue) : réseau d'abord, cache en secours
  if (url.pathname.includes('/data/') && url.pathname.endsWith('.json')) {
    event.respondWith(networkFirst(req));
  } else if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, 'index.html'));
  } else {
    event.respondWith(staleWhileRevalidate(req, event));
  }
});

async function networkFirst(req, fallbackPath) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res && res.ok) cache.put(fallbackPath || req, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(fallbackPath || req, { ignoreSearch: true });
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(req, event) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(req, { ignoreSearch: true });
  const network = fetch(req)
    .then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; })
    .catch(() => null);
  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  const res = await network;
  return res || Response.error();
}
