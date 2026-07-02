/**
 * AntLab v2 — Service Worker (Virtual File System)
 * -------------------------------------------------
 * Serves the current project's files at a real URL so the preview iframe
 * behaves like a real web server (localhost / VS Code Live Server):
 *   • fetch()  works (relative and absolute-to-scope URLs)
 *   • Multi-page navigation works (<a href="page.html">)
 *   • Relative images, css, js, json, etc. all load
 *   • ES modules load
 *
 * Files are held in an in-memory map keyed by projectId. The app sends
 * updated files via postMessage whenever the user edits code.
 *
 * Preview URL pattern:
 *   {scope}__preview__/{projectId}/{path...}
 */

'use strict';

const CACHE_NAME = 'antlab-vfs-v2';

// projectId -> { files: { path: content }, entry: 'index.html', version: 0 }
const projects = new Map();

// Console bridge injected into every HTML page served from the VFS.
// Sends console.* + errors up to window.parent (the AntLab app).
const CONSOLE_BRIDGE = `
<script data-antlab-bridge>
(function(){
  if (window.__antlabBridged) return; window.__antlabBridged = true;
  var methods = ['log','warn','error','info','debug','table','dir'];
  var original = {};
  methods.forEach(function(m){
    original[m] = console[m].bind(console);
    console[m] = function(){
      var args = Array.prototype.slice.call(arguments).map(function(a){
        try {
          if (a instanceof Error) return a.stack || (a.name + ': ' + a.message);
          if (typeof a === 'object') return JSON.stringify(a, null, 2);
          return String(a);
        } catch(e) { return '[Circular]'; }
      });
      try { parent.postMessage({ type:'console', method:m, args:args, ts:Date.now() }, '*'); } catch(e){}
      original[m].apply(console, arguments);
    };
  });
  window.addEventListener('error', function(e){
    try { parent.postMessage({ type:'console', method:'error',
      args:[(e.message||'Error') + (e.filename ? ' ('+e.filename+':'+e.lineno+':'+e.colno+')' : '')],
      ts:Date.now() }, '*'); } catch(_){}
  });
  window.addEventListener('unhandledrejection', function(e){
    try { parent.postMessage({ type:'console', method:'error',
      args:['Unhandled Promise Rejection: ' + (e.reason && (e.reason.stack || e.reason.message || String(e.reason)))],
      ts:Date.now() }, '*'); } catch(_){}
  });
  // Notify parent whenever we navigate — so the URL bar updates
  function tellParent(){
    try { parent.postMessage({ type:'antlab-nav', url: location.pathname + location.search + location.hash }, '*'); } catch(_){}
  }
  document.addEventListener('DOMContentLoaded', tellParent);
  window.addEventListener('load', tellParent);
  window.addEventListener('hashchange', tellParent);
  window.addEventListener('popstate', tellParent);
})();
<\/script>
`;

/* ================= Lifecycle ================= */
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

/* ================= Messages ================= */
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'antlab-update-project') {
    const { projectId, files, entry } = data;
    projects.set(projectId, {
      files: files || {},
      entry: entry || 'index.html',
      version: (projects.get(projectId)?.version || 0) + 1,
    });
    // Reply so the app knows the SW is ready and can trigger the iframe load
    if (event.source && event.source.postMessage) {
      event.source.postMessage({ type: 'antlab-project-ready', projectId });
    }
  }
  if (data.type === 'antlab-clear-project') {
    projects.delete(data.projectId);
  }
  if (data.type === 'antlab-ping') {
    if (event.source && event.source.postMessage) {
      event.source.postMessage({ type: 'antlab-pong' });
    }
  }
});

/* ================= Fetch interception ================= */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only intercept requests within our SW scope that hit /__preview__/
  if (!url.pathname.includes('/__preview__/')) return;

  event.respondWith(handlePreviewRequest(event.request, url));
});

async function handlePreviewRequest(request, url) {
  // Extract projectId and file path after /__preview__/
  // e.g. /antlab-v2/__preview__/proj_123/pages/foo.html?v=3
  const marker = '/__preview__/';
  const idx = url.pathname.indexOf(marker);
  const after = url.pathname.slice(idx + marker.length);
  const parts = after.split('/');
  const projectId = parts.shift();
  let path = parts.join('/');
  // If the path ends with "/" or is empty → serve the entry html
  if (!path || path.endsWith('/')) path = (projects.get(projectId)?.entry) || 'index.html';

  // Decode URL-encoded characters (%20 spaces etc.)
  try { path = decodeURIComponent(path); } catch (_) {}

  // Strip any leading "./"
  path = path.replace(/^\.\//, '');

  const project = projects.get(projectId);
  if (!project) {
    return htmlResponse(errorPage('Project not loaded', `The service worker has no record of project <code>${projectId}</code>. Try refreshing the preview.`), 404);
  }

  // Try direct match, then some sensible fallbacks (index.html in a folder,
  // adding .html extension for extensionless paths)
  let content = pickFile(project.files, path);

  if (content == null) {
    // SPA fallback: if request accepts HTML, serve the entry file (helps
    // client-side routers work without user needing a config file)
    const accept = request.headers.get('accept') || '';
    if (accept.includes('text/html') && !path.match(/\.[a-z0-9]+$/i)) {
      const entry = project.entry || 'index.html';
      content = pickFile(project.files, entry);
      if (content != null) path = entry;
    }
  }

  if (content == null) {
    return htmlResponse(errorPage('404 Not Found', `File not found: <code>${escapeHtml(path)}</code>`), 404);
  }

  const mime = mimeFor(path);
  let body = content;

  // Inject console bridge + <base> into HTML documents
  if (mime === 'text/html') {
    body = transformHtml(body, projectId, path, url);
  }

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': mime + '; charset=utf-8',
      'Cache-Control': 'no-store',
      // Allow cross-origin fetch by scripts in the iframe
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/* ---------- Helpers ---------- */

function pickFile(files, path) {
  if (files[path] != null) return files[path];
  // Try index.html inside a folder
  if (files[path + '/index.html'] != null) return files[path + '/index.html'];
  if (files[path + 'index.html'] != null) return files[path + 'index.html'];
  // Case-insensitive fallback
  const lower = path.toLowerCase();
  for (const k of Object.keys(files)) {
    if (k.toLowerCase() === lower) return files[k];
  }
  return null;
}

function transformHtml(html, projectId, path, url) {
  // Compute base URL so relative paths resolve within the VFS
  // e.g. request was  /antlab-v2/__preview__/proj_1/pages/x.html
  //      base should be /antlab-v2/__preview__/proj_1/pages/
  const marker = '/__preview__/';
  const idx = url.pathname.indexOf(marker);
  const basePathname = url.pathname.slice(0, idx + marker.length) + projectId + '/';
  // Sub-folder base
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
  const baseHref = basePathname + dir;

  let out = html;

  // Inject <base> only if not already present, right after <head> (or before <html> body)
  const hasBase = /<base\s/i.test(out);
  const baseTag = hasBase ? '' : `<base href="${baseHref}">`;

  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1>\n${baseTag}\n${CONSOLE_BRIDGE}`);
  } else if (/<html[^>]*>/i.test(out)) {
    out = out.replace(/<html([^>]*)>/i, `<html$1><head>${baseTag}${CONSOLE_BRIDGE}</head>`);
  } else {
    out = `<!DOCTYPE html><html><head>${baseTag}${CONSOLE_BRIDGE}</head><body>\n${out}\n</body></html>`;
  }

  return out;
}

function mimeFor(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  const table = {
    html:'text/html', htm:'text/html',
    css:'text/css',
    js:'application/javascript', mjs:'application/javascript',
    json:'application/json',
    svg:'image/svg+xml', png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg',
    gif:'image/gif', webp:'image/webp', ico:'image/x-icon', bmp:'image/bmp',
    txt:'text/plain', md:'text/markdown',
    xml:'application/xml',
    wasm:'application/wasm',
    woff:'font/woff', woff2:'font/woff2', ttf:'font/ttf', otf:'font/otf',
    mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg',
    mp4:'video/mp4', webm:'video/webm',
    pdf:'application/pdf',
  };
  return table[ext] || 'text/plain';
}

function htmlResponse(body, status) {
  return new Response(body, {
    status: status || 200,
    headers: { 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store' },
  });
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function errorPage(title, msg) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
  <style>
    body{margin:0;font:14px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;
      background:linear-gradient(135deg,#1a1a2e,#0d0d17);color:#e5e5e5;
      display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;}
    .card{max-width:520px;background:#1e1e2e;border:1px solid #333;border-radius:14px;
      padding:32px;box-shadow:0 20px 60px rgba(0,0,0,.5);}
    h1{font-size:20px;margin:0 0 12px;color:#ff7033;}
    code{background:#0f0f17;padding:2px 8px;border-radius:4px;font:12px monospace;color:#7dd3fc;}
    p{color:#a1a1aa;}
  </style></head><body><div class="card">
    <h1>${escapeHtml(title)}</h1><p>${msg}</p></div></body></html>`;
}
