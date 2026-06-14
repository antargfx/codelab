/**
 * sw.js — AntLab IDE Virtual Server
 * Acts as a local HTTP server via Service Worker.
 * Intercepts requests to /__antlab__/* and serves
 * project files from memory — giving real localhost semantics.
 *
 * This enables: localStorage, Service Workers, fetch(),
 * Geolocation, Camera/Mic, WebRTC, WebSockets, and more.
 */

const CACHE_VERSION = 'antlab-v1';
const VIRTUAL_ORIGIN = '/__antlab__/';

// In-memory store: { 'index.html': {content, mime}, ... }
let virtualFiles = {};

/* =============================================
   INSTALL & ACTIVATE
   ============================================= */
self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

/* =============================================
   MESSAGE — receive file payload from main app
   ============================================= */
self.addEventListener('message', (e) => {
  const { type, files } = e.data || {};

  if (type === 'SERVE_PROJECT') {
    // files: [{ name, content, mime }]
    virtualFiles = {};
    (files || []).forEach((f) => {
      virtualFiles[f.name] = { content: f.content, mime: f.mime };
    });

    // Confirm to sender
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

  // Only intercept requests under /__antlab__/
  if (!url.pathname.startsWith(VIRTUAL_ORIGIN)) return;

  // Derive filename from path
  let filePath = url.pathname.slice(VIRTUAL_ORIGIN.length) || 'index.html';
  if (filePath === '' || filePath === '/') filePath = 'index.html';

  e.respondWith(serveFile(filePath));
});

/* =============================================
   FILE SERVING
   ============================================= */
function serveFile(name) {
  const file = virtualFiles[name];

  if (!file) {
    return new Response(`404 — File not found: ${name}`, {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  return new Response(file.content, {
    status: 200,
    headers: {
      'Content-Type': file.mime,
      'Cache-Control': 'no-store',
      // Allow full browser APIs
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  });
}
