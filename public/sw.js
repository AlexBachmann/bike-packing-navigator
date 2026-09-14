// Service Worker for Full Offline PWA Support & Map Tile Caching
const SHELL_CACHE_NAME = 'bikepack-app-shell-v3';
const TILE_CACHE_NAME = 'bikepack-map-tiles-v1';
const ANALYTICS_DB_NAME = 'bikepack-offline-analytics';
const ANALYTICS_STORE_NAME = 'queued-requests';

// IndexedDB Helper Functions for Offline Analytics Queue
function openAnalyticsDb() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    const req = indexedDB.open(ANALYTICS_DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(ANALYTICS_STORE_NAME)) {
        db.createObjectStore(ANALYTICS_STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

function addRequestToDb(entry) {
  return openAnalyticsDb().then((db) => {
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(ANALYTICS_STORE_NAME, 'readwrite');
        const store = tx.objectStore(ANALYTICS_STORE_NAME);
        store.add(entry);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch (e) {
        resolve();
      }
    });
  });
}

function getAllQueuedRequests(db) {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(ANALYTICS_STORE_NAME, 'readonly');
      const store = tx.objectStore(ANALYTICS_STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch (e) {
      resolve([]);
    }
  });
}

function deleteQueuedRequest(db, id) {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(ANALYTICS_STORE_NAME, 'readwrite');
      const store = tx.objectStore(ANALYTICS_STORE_NAME);
      store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch (e) {
      resolve();
    }
  });
}

let isReplaying = false;
async function replayQueuedAnalytics() {
  if (isReplaying) return;
  isReplaying = true;
  try {
    const db = await openAnalyticsDb();
    if (!db) return;

    const entries = await getAllQueuedRequests(db);
    if (!entries || entries.length === 0) return;

    const now = Date.now();
    const MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours max retention for GA4

    for (const entry of entries) {
      const ageMs = now - entry.timestamp;
      if (ageMs > MAX_AGE_MS) {
        // Discard hits older than 48 hours to avoid rejected stale hits
        await deleteQueuedRequest(db, entry.id);
        continue;
      }

      const queueTime = Math.max(0, ageMs);
      const replayUrl = new URL(entry.url);
      replayUrl.searchParams.set('qt', String(queueTime));
      replayUrl.searchParams.set('ep._offline_delay', String(queueTime));
      replayUrl.searchParams.set('ep._offline_replayed', '1');

      const headers = new Headers(entry.headers || {});
      const init = {
        method: entry.method,
        headers: headers,
        body: entry.body,
        mode: 'no-cors'
      };

      try {
        await fetch(replayUrl.toString(), init);
        await deleteQueuedRequest(db, entry.id);
      } catch (fetchErr) {
        // Network connection still failing; stop iteration and retry on next event
        break;
      }
    }
  } catch (err) {
    console.warn('[SW] Error during analytics replay:', err);
  } finally {
    isReplaying = false;
  }
}

async function queueAnalyticsRequest(request) {
  try {
    let bodyText = null;
    if (request.method === 'POST') {
      try {
        bodyText = await request.clone().text();
      } catch (e) {}
    }
    const headersObj = {};
    for (const [k, v] of request.headers.entries()) {
      headersObj[k] = v;
    }
    const entry = {
      url: request.url,
      method: request.method,
      headers: headersObj,
      body: bodyText,
      timestamp: Date.now()
    };
    await addRequestToDb(entry);
  } catch (err) {
    console.warn('[SW] Failed to queue offline analytics request:', err);
  }
}

// Essential static entry points to pre-cache on install
const PRECACHE_URLS = [
  './',
  './index.html',
  './favicon.ico',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-maskable.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './maplibre-gl-worker.mjs',
  './data/routes.json',
  './assets/styles/vector-topo.json',
  './assets/styles/vector-dark.json',
  './assets/fonts/Noto Sans Regular/0-255.pbf',
  './assets/fonts/Noto Sans Regular/256-511.pbf',
  './assets/fonts/Noto Sans Bold/0-255.pbf',
  './assets/fonts/Noto Sans Bold/256-511.pbf',
  './assets/sprites/sprite.json',
  './assets/sprites/sprite.png',
  './assets/sprites/sprite@2x.json',
  './assets/sprites/sprite@2x.png',
  './assets/sprites/topo.json',
  './assets/sprites/topo.png',
  './assets/sprites/topo@2x.json',
  './assets/sprites/topo@2x.png',
  './assets/sprites/dark.json',
  './assets/sprites/dark.png',
  './assets/sprites/dark@2x.json',
  './assets/sprites/dark@2x.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn('[SW] Pre-cache warning (will cache dynamically):', err);
      });
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) => {
        return Promise.all(
          keys
            .filter((k) => k.startsWith('bikepack-app-shell-') && k !== SHELL_CACHE_NAME)
            .map((k) => caches.delete(k))
        );
      }),
      replayQueuedAnalytics()
    ])
  );
});

self.addEventListener('message', (event) => {
  if (event.data && (event.data.type === 'FLUSH_OFFLINE_ANALYTICS' || event.data.type === 'SYNC_ANALYTICS')) {
    event.waitUntil(replayQueuedAnalytics());
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'flush-google-analytics' || event.tag === 'sync-analytics') {
    event.waitUntil(replayQueuedAnalytics());
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // A. Google Tag Manager / gtag.js script caching for offline availability
  const isGtagScript =
    url.hostname.includes('googletagmanager.com') && url.pathname.includes('/gtag/js');

  if (isGtagScript) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(SHELL_CACHE_NAME);
          const cached = await cache.match(event.request);
          if (cached) return cached;
          return new Response('/* gtag offline fallback */', {
            headers: { 'Content-Type': 'application/javascript' },
            status: 200
          });
        })
    );
    return;
  }

  // B. Google Analytics 4 Collect Interception & Offline Queueing
  const isGaCollect =
    (url.hostname.includes('google-analytics.com') ||
      url.hostname.includes('analytics.google.com')) &&
    (url.pathname.includes('/collect') || url.pathname.includes('/g/collect'));

  if (isGaCollect) {
    event.respondWith(
      fetch(event.request.clone())
        .then((response) => {
          // Opportunistically flush earlier queued requests if network succeeds
          replayQueuedAnalytics().catch(() => {});
          return response;
        })
        .catch(async () => {
          // Network failure / offline: serialize request into IndexedDB
          await queueAnalyticsRequest(event.request);
          // Return synthetic accepted response so client gtag runtime doesn't error
          return new Response(JSON.stringify({ offlineQueued: true }), {
            status: 202,
            headers: { 'Content-Type': 'application/json' }
          });
        })
    );
    return;
  }

  // Only handle GET requests for remaining application resources
  if (event.request.method !== 'GET') return;

  // 1. Map Tiles (ArcGIS / OpenStreetMap) -> Cache-First
  const isMapTile =
    url.hostname.includes('arcgisonline.com') ||
    url.hostname.includes('openstreetmap.org') ||
    url.pathname.includes('/tile/');

  if (isMapTile) {
    event.respondWith(
      caches.open(TILE_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;

        try {
          const res = await fetch(event.request);
          if (res && res.ok) {
            cache.put(event.request, res.clone()).catch(() => {});
          }
          return res;
        } catch {
          // Transparent 1x1 GIF fallback when offline
          return new Response(
            Uint8Array.from([
              71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255,
              255, 33, 249, 4, 1, 0, 0, 0, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2,
              2, 68, 1, 0, 59
            ]),
            { status: 200, headers: { 'Content-Type': 'image/gif' } }
          );
        }
      })
    );
    return;
  }

  // 2. Navigation Requests (HTML document / page reloads with or without query params) -> Network-First, Cache Fallback
  const isNavigate =
    event.request.mode === 'navigate' ||
    event.request.headers.get('accept')?.includes('text/html');

  if (isNavigate) {
    const scopeUrl = self.registration.scope;
    const indexUrl = new URL('index.html', self.registration.scope).href;

    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            const copy = networkResponse.clone();
            caches.open(SHELL_CACHE_NAME).then((cache) => {
              cache.put(indexUrl, copy);
            }).catch(() => {});
          }
          return networkResponse;
        })
        .catch(async () => {
          // Network failed (offline!). Try cached match for request URL, then fallback to index.html or scope
          const cache = await caches.open(SHELL_CACHE_NAME);
          const cached =
            (await cache.match(event.request)) ||
            (await cache.match(event.request, { ignoreSearch: true })) ||
            (await cache.match(indexUrl)) ||
            (await cache.match(scopeUrl));
          if (cached) {
            return cached;
          }
          return new Response(
            '<!doctype html><html><head><meta charset="utf-8"><title>Offline</title></head><body><h1>Bike Packing Navigator</h1><p>Please connect to internet once to download route data.</p></body></html>',
            { headers: { 'Content-Type': 'text/html' }, status: 200 }
          );
        })
    );
    return;
  }

  // 3. Static App Shell Assets (JS scripts, CSS styles, fonts, icons, data JSON) -> Network-First with Cache Fallback
  const isSameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com');

  if (isSameOrigin || isFont) {
    // Skip websocket / dev server live reload connections
    if (url.pathname.startsWith('/ng-cli-ws') || url.pathname.startsWith('/vite-hmr')) {
      return;
    }

    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            const copy = networkResponse.clone();
            caches.open(SHELL_CACHE_NAME).then((cache) => {
              cache.put(event.request, copy);
            }).catch(() => {});
          }
          return networkResponse;
        })
        .catch(async () => {
          const cache = await caches.open(SHELL_CACHE_NAME);
          const cached =
            (await cache.match(event.request)) ||
            (await cache.match(event.request, { ignoreSearch: true }));
          if (cached) {
            return cached;
          }
          if (url.pathname.endsWith('.json')) {
            return new Response(JSON.stringify({ error: 'Offline asset not cached' }), {
              status: 404,
              headers: { 'Content-Type': 'application/json' }
            });
          }
          return new Response('Offline asset unavailable', { status: 503 });
        })
    );
  }
});
