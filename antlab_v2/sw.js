/**
 * sw.js — AntLab IDE virtual preview server
 * ------------------------------------------------------------
 * Turns the browser-based IDE into a real "localhost" server.
 *
 * The editor writes every project file into the Cache Storage API
 * under a mount path (…/__antlab_preview__/<file>). This worker
 * intercepts requests to that mount path and serves the files with
 * correct Content-Type headers.
 *
 * Because the preview iframe now loads from a REAL same-origin URL:
 *   • fetch('data.json') / relative fetch works (served from cache)
 *   • <link href="style.css"> / <script src="script.js"> load as files
 *   • <a href="page.html"> multi-page navigation works
 *   • fetch('https://api.example.com/…') passes through to the network
 *     exactly like VS Code Live Server.
 *
 * Anything OUTSIDE the mount path (the IDE's own assets, CDNs, real
 * network requests) is left completely untouched.
 * ------------------------------------------------------------
 */

const ANTLAB_CACHE = 'antlab-preview-v1';
const ANTLAB_MOUNT = '__antlab_preview__/';

self.addEventListener('install', () => {
  // Activate immediately so the preview works on first load.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Take control of any in-scope clients (including the preview iframe)
  // right away, without requiring a reload.
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  let url;
  try {
    url = new URL(event.request.url);
  } catch (e) {
    return; // malformed — let the browser handle it
  }

  // Only handle same-origin requests that live under our mount path.
  const isMounted =
    url.origin === self.location.origin &&
    url.pathname.indexOf('/' + ANTLAB_MOUNT) !== -1;

  if (!isMounted) {
    // Passthrough: real network. This is what makes fetch() to external
    // APIs / CDNs behave like a normal localhost dev server.
    return;
  }

  event.respondWith(serveFromVfs(event.request, url));
});

async function serveFromVfs(request, url) {
  const cache = await caches.open(ANTLAB_CACHE);

  // 1. Exact match (ignore query string so ?v=123 cache-busting works).
  let res = await cache.match(request, { ignoreSearch: true });
  if (res) return withPreviewHeaders(res);

  // 2. Directory-style request → try <dir>/index.html
  if (url.pathname.endsWith('/') || !/\.[a-z0-9]+$/i.test(url.pathname)) {
    const indexUrl =
      url.origin + url.pathname.replace(/\/?$/, '/') + 'index.html';
    res = await cache.match(indexUrl, { ignoreSearch: true });
    if (res) return withPreviewHeaders(res);
  }

  // 3. Nothing found — proper 404, just like a real server.
  const rel = url.pathname.split('/' + ANTLAB_MOUNT).pop() || '';
  return new Response(
    notFoundPage(decodeURIComponent(rel)),
    { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

function withPreviewHeaders(res) {
  // Ensure the preview never gets stale content.
  const headers = new Headers(res.headers);
  headers.set('Cache-Control', 'no-store');
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

function notFoundPage(path) {
  const safe = String(path)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>404 — AntLab</title>
<style>
  body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#0d0d12;color:#e7e7ee;
       display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center}
  .card{padding:40px 48px;border:1px solid #2a2a35;border-radius:16px;background:#15151d;max-width:460px}
  h1{font-size:52px;margin:0 0 4px;color:#ff7033}
  code{background:#22222c;padding:2px 8px;border-radius:6px;color:#ffb08a;font-size:13px}
  p{color:#9a9aab;line-height:1.6;margin:12px 0 0}
</style></head>
<body><div class="card">
  <h1>404</h1>
  <p>The file <code>${safe || '/'}</code> was not found in this project.</p>
  <p>Create it with the <strong>+</strong> tab in the editor, then link to it.</p>
</div></body></html>`;
}
