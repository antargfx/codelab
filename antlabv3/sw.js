/**
 * sw.js — AntLab IDE Virtual Server
 * Acts as a virtual HTTP server via Service Worker.
 * Intercepts requests to ./__antlab__/* (relative to SW scope)
 * and serves project files from memory.
 *
 * Deployed at any path (e.g. GitHub Pages subfolder) — works correctly
 * because the SW scope is './' and all URL matching is scope-relative.
 *
 * Unlocks full browser APIs in the preview tab:
 * localStorage, fetch, Camera/Mic, Geolocation, WebRTC, WebSockets, etc.
 */

// In-memory store: { 'index.html': { content, mime }, ... }
let virtualFiles = {};

/* =============================================
   INSTALL & ACTIVATE
   ============================================= */
self.addEventListener('install', () => {
  // Take control immediately — no need to wait for old SW to die
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  // Claim all open clients so we control the page right away (first load fix)
  e.waitUntil(self.clients.claim());
});

/* =============================================
   MESSAGE — receive project files from the IDE
   ============================================= */
self.addEventListener('message', (e) => {
  const { type, files } = e.data || {};

  if (type === 'SERVE_PROJECT') {
    virtualFiles = {};
    (files || []).forEach((f) => {
      virtualFiles[f.name] = { content: f.content, mime: f.mime };
    });

    // Confirm back to the sender tab
    if (e.source) {
      e.source.postMessage({ type: 'PROJECT_READY' });
    }
  }

  if (type === 'CLEAR_PROJECT') {
    virtualFiles = {};
  }
});

/* =============================================
   FETCH — intercept virtual file requests
   ============================================= */
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // The SW scope is e.g. /codelab/antlabv2/
  // Virtual files live under <scope>__antlab__/
  // registration.scope gives us the full scope URL
  const scopePath = new URL(self.registration.scope).pathname; // e.g. /codelab/antlabv2/
  const virtualPath = scopePath + '__antlab__/';              // e.g. /codelab/antlabv2/__antlab__/

  if (!url.pathname.startsWith(virtualPath)) return; // not our request

  // Extract filename: /codelab/antlabv2/__antlab__/style.css → style.css
  let fileName = url.pathname.slice(virtualPath.length) || 'index.html';
  if (!fileName || fileName === '/') fileName = 'index.html';

  e.respondWith(serveFile(fileName));
});

/* =============================================
   FILE SERVING
   ============================================= */
function serveFile(name) {
  const file = virtualFiles[name];

  if (!file) {
    return new Response(`404 — "${name}" not found in virtual server.\nLoaded files: ${Object.keys(virtualFiles).join(', ') || 'none'}`, {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  return new Response(file.content, {
    status: 200,
    headers: {
      'Content-Type': file.mime,
      'Cache-Control': 'no-store',
    },
  });
}
