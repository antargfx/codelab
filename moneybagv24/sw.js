const CACHE_NAME = 'moneybag-pwa-v2';

const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  // Firebase SDK modules — must be cached for offline auth to work
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
];

// Local asset origins — served cache-first instantly
const LOCAL_ORIGINS = [self.location.origin];

// CDN hosts — stale-while-revalidate (serve cache instantly, update in background)
const CDN_HOSTS = [
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'www.gstatic.com',
  'cdnjs.cloudflare.com'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const isLocal = LOCAL_ORIGINS.includes(url.origin);
  const isCDN = CDN_HOSTS.includes(url.hostname);

  // ── Cache-first for local assets (index.html, app.js, style.css, etc.)
  // Instantly serve from cache; revalidate in background so next visit is fresh.
  if (isLocal) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(event.request);
        const networkFetch = fetch(event.request)
          .then(response => {
            if (response && response.status === 200) {
              cache.put(event.request, response.clone());
            }
            return response;
          })
          .catch(() => null);

        // Return cache instantly if available; otherwise wait for network
        return cached || networkFetch;
      })
    );
    return;
  }

  // ── Stale-while-revalidate for CDN resources (Firebase SDK, Chart.js, FA icons)
  // Serve cached copy immediately; fetch fresh copy in background for next time.
  if (isCDN) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(event.request);

        const networkFetch = fetch(event.request)
          .then(response => {
            if (response && response.status === 200) {
              cache.put(event.request, response.clone());
            }
            return response;
          })
          .catch(() => null);

        // Serve cache immediately; background revalidation runs in parallel
        if (cached) {
          // Kick off background update without blocking response
          event.waitUntil(networkFetch);
          return cached;
        }

        // Not cached yet — must wait for network
        return networkFetch || caches.match('./index.html');
      })
    );
    return;
  }

  // ── All other requests: network-first with cache fallback
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200) {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, cloned));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then(cached => cached || caches.match('./index.html'))
      )
  );
});
