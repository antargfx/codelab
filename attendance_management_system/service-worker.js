/* =============================================================================
   service-worker.js — PWA offline shell caching
   =============================================================================
   Caches the static app shell (HTML/CSS/JS/icons) for offline launch and fast
   loads. Firebase/Firestore network requests are DELIBERATELY bypassed — the
   Firestore SDK has its own offline persistence and queues writes itself, so
   caching those requests here would fight with it.

   All precache paths are RELATIVE so the worker functions under a GitHub Pages
   project sub-path (username.github.io/repo-name/).
   ============================================================================= */

const CACHE_VERSION = "ams-v1";
const CORE_ASSETS = [
  "./",
  "index.html",
  "login.html",
  "dashboard.html",
  "attendance.html",
  "students.html",
  "reports.html",
  "settings.html",
  "manifest.json",
  "css/variables.css",
  "css/components.css",
  "css/style.css",
  "css/print.css",
  "js/config.js",
  "js/firebase.js",
  "js/utils.js",
  "js/data.js",
  "js/auth.js",
  "js/dashboard.js",
  "js/attendance.js",
  "js/students.js",
  "js/reports.js",
  "js/settings.js",
  "assets/logo.png",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
];

// Install: precache core assets. Use individual adds so one failure (e.g. a
// missing optional file) doesn't abort the whole install.
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      await Promise.allSettled(CORE_ASSETS.map((url) => cache.add(url)));
      self.skipWaiting();
    })()
  );
});

// Activate: clean up old caches.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// Fetch strategy:
//  - Bypass all Firebase / Google APIs and any cross-origin CDN POSTs.
//  - Navigations: network-first, fall back to cached page, then index.html.
//  - Same-origin GET static assets: cache-first, then network (and cache it).
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET; let the SDK manage everything else.
  if (request.method !== "GET") return;

  // Bypass Firebase / Google backend traffic entirely.
  const bypassHosts = [
    "firestore.googleapis.com",
    "firebase.googleapis.com",
    "identitytoolkit.googleapis.com",
    "securetoken.googleapis.com",
    "www.googleapis.com",
  ];
  if (bypassHosts.some((h) => url.hostname.includes(h))) return;

  // Navigation requests: network-first with offline fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          return fresh;
        } catch (_) {
          const cache = await caches.open(CACHE_VERSION);
          const cached = await cache.match(request);
          return cached || (await cache.match("index.html"));
        }
      })()
    );
    return;
  }

  // Same-origin static assets: cache-first.
  if (url.origin === self.location.origin) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION);
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const fresh = await fetch(request);
          if (fresh && fresh.status === 200) cache.put(request, fresh.clone());
          return fresh;
        } catch (err) {
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  // Cross-origin (e.g. CDN libs): try cache, then network, and cache success.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const fresh = await fetch(request);
        if (fresh && (fresh.status === 200 || fresh.type === "opaque"))
          cache.put(request, fresh.clone());
        return fresh;
      } catch (err) {
        return cached || Response.error();
      }
    })()
  );
});
