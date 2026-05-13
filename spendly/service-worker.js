/* =====================================================
   Spendly Service Worker - Offline First PWA
   ===================================================== */

const CACHE_NAME = 'spendly-v1.2.0';
const STATIC_CACHE = 'spendly-static-v1.2.0';
const DYNAMIC_CACHE = 'spendly-dynamic-v1.2.0';

// Assets to cache on install
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,400&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'
];

/* ---- Install ---- */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('[SW] Pre-caching static assets');
        return cache.addAll(STATIC_ASSETS).catch(err => {
          console.warn('[SW] Some assets failed to cache:', err);
        });
      })
      .then(() => self.skipWaiting())
  );
});

/* ---- Activate ---- */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(key => key !== STATIC_CACHE && key !== DYNAMIC_CACHE)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      );
    }).then(() => self.clients.claim())
  );
});

/* ---- Fetch Strategy: Cache First for static, Network First for API ---- */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip Firebase requests (handle online/offline in app.js)
  if (url.hostname.includes('firebase') || url.hostname.includes('googleapis.com/firestore')) {
    return;
  }

  // Static assets: Cache First
  if (STATIC_ASSETS.some(asset => request.url.includes(asset)) ||
      url.pathname.endsWith('.css') ||
      url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.html') ||
      url.pathname.endsWith('.png') ||
      url.pathname.endsWith('.ico')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Google Fonts: Cache First
  if (url.hostname.includes('fonts.gstatic.com') || url.hostname.includes('fonts.googleapis.com')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // CDN resources: Cache First
  if (url.hostname.includes('cdn.jsdelivr.net') || url.hostname.includes('cdnjs.cloudflare.com')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Default: Network First with cache fallback
  event.respondWith(networkFirst(request));
});

/* ---- Cache First Strategy ---- */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    return new Response('Offline - Resource not cached', {
      status: 503,
      statusText: 'Service Unavailable'
    });
  }
}

/* ---- Network First Strategy ---- */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Return offline page for navigation requests
    if (request.mode === 'navigate') {
      return caches.match('./index.html');
    }
    return new Response('Offline', { status: 503 });
  }
}

/* ---- Background Sync (for queued operations) ---- */
self.addEventListener('sync', event => {
  if (event.tag === 'sync-transactions') {
    event.waitUntil(syncTransactions());
  }
});

async function syncTransactions() {
  // Notify all open clients to trigger sync
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(client => {
    client.postMessage({ type: 'TRIGGER_SYNC' });
  });
}

/* ---- Push Notifications (placeholder) ---- */
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'Spendly', {
      body: data.body || 'You have a new notification',
      icon: './icons/icon-192.png',
      badge: './icons/icon-72.png'
    })
  );
});

console.log('[SW] Service Worker loaded - Spendly v1.2.0');
