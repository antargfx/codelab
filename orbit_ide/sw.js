/* ============================================================
   sw.js — Virtual localhost service worker.

   The IDE cannot start a real localhost server inside the browser,
   so this service worker is the closest professional alternative:
   it intercepts every request made by the preview iframe and serves
   files directly from an in-memory snapshot of the Virtual File System.

   Because the controlled page issues real network requests, relative
   AND absolute URLs, fetch(), XHR, navigation, images, fonts, JSON —
   everything resolves exactly like a real web server.
   ============================================================ */

const VFS = new Map(); // path -> { mime, isText, text?, b64? }
const VPREFIX = '__vfs__';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('message', (e) => {
  const msg = e.data || {};
  if (msg.type === 'vfs-set-all') {
    VFS.clear();
    for (const [path, file] of Object.entries(msg.files)) VFS.set(path, file);
    reply(e, { ok: true, count: VFS.size });
  } else if (msg.type === 'vfs-set-one') {
    VFS.set(msg.path, msg.file);
    reply(e, { ok: true });
  } else if (msg.type === 'vfs-del') {
    VFS.delete(msg.path);
    reply(e, { ok: true });
  } else if (msg.type === 'ping') {
    reply(e, { ok: true, count: VFS.size });
  }
});

function reply(e, data) {
  if (e.ports && e.ports[0]) e.ports[0].postMessage(data);
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Only handle same-origin requests from our virtual site.
  if (url.origin !== self.location.origin) return;

  const vpath = resolveVPath(url, event.request.referrer);
  if (vpath === null) return; // not ours — let it pass through to network

  event.respondWith(serve(vpath));
});

/** Map a request URL to a virtual-FS path, or null if not virtual. */
function resolveVPath(url, referrer) {
  const p = url.pathname;
  const idx = p.indexOf('/' + VPREFIX + '/');
  if (idx >= 0) {
    return clean(p.slice(idx + VPREFIX.length + 2));
  }
  // Subresource with an absolute/relative path whose referrer is a virtual page:
  if (referrer && referrer.includes('/' + VPREFIX + '/')) {
    // strip the app scope so "/css/x.css" -> "css/x.css"
    const scope = self.registration.scope ? new URL(self.registration.scope).pathname : '/';
    let rel = p.startsWith(scope) ? p.slice(scope.length) : p.replace(/^\//, '');
    return clean(rel);
  }
  return null;
}

function clean(s) {
  try { s = decodeURIComponent(s); } catch {}
  s = s.replace(/^\/+/, '').replace(/[?#].*$/, '');
  const parts = [];
  for (const seg of s.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop(); else parts.push(seg);
  }
  return parts.join('/');
}

async function serve(vpath) {
  let file = VFS.get(vpath);

  // directory index fallback
  if (!file && (vpath === '' || vpath.endsWith('/'))) file = VFS.get(clean(vpath + '/index.html'));
  if (!file && VFS.has(vpath + '/index.html')) file = VFS.get(vpath + '/index.html');

  if (!file) {
    if (VFS.size === 0) {
      return html(LOADING_PAGE, 200);
    }
    return html(notFound(vpath), 404);
  }

  const headers = { 'Content-Type': file.mime, 'Cache-Control': 'no-store' };

  if (file.isText) {
    let body = file.text;
    if (file.mime.includes('html')) body = injectRuntime(body);
    return new Response(body, { status: 200, headers });
  }
  // binary
  const bytes = b64ToBytes(file.b64);
  return new Response(bytes, { status: 200, headers });
}

function html(body, status) {
  return new Response(injectRuntime(body), { status, headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' } });
}

function notFound(vpath) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>404</title>
  <style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#fafafa;color:#222;flex-direction:column;gap:8px}
  code{background:#eee;padding:2px 8px;border-radius:6px}</style></head>
  <body><h1>404</h1><p>File not found: <code>${vpath.replace(/</g,'&lt;')}</code></p></body></html>`;
}

const LOADING_PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#888}</style></head>
<body>Loading project…</body></html>`;

function b64ToBytes(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Inject the runtime bridge into HTML right after <head> (or at top). */
function injectRuntime(htmlText) {
  const tag = `<script data-orbit-runtime>(${RUNTIME_SRC})();<\/script>`;
  if (/<head[^>]*>/i.test(htmlText)) {
    return htmlText.replace(/<head[^>]*>/i, (m) => m + tag);
  }
  if (/<html[^>]*>/i.test(htmlText)) {
    return htmlText.replace(/<html[^>]*>/i, (m) => m + tag);
  }
  return tag + htmlText;
}

/* ============================================================
   RUNTIME_SRC — code stringified and injected into every page.
   Runs INSIDE the preview iframe. Bridges console, errors,
   network, DOM inspection, element picking and live editing
   back to the IDE via postMessage.
   ============================================================ */
function RUNTIME_SRC() {
  'use strict';
  const TO_HOST = (payload) => { try { parent.postMessage(Object.assign({ __orbit: 'runtime' }, payload), '*'); } catch (e) {} };

  /* ---------- element registry ---------- */
  let _id = 0;
  const idToEl = new Map();
  const elToId = new WeakMap();
  function oid(el) {
    if (!el || el.nodeType !== 1) return null;
    let id = elToId.get(el);
    if (!id) { id = 'o' + (++_id); elToId.set(el, id); idToEl.set(id, el); el.setAttribute('data-orbit-id', id); }
    return id;
  }

  /* ---------- safe serialization ---------- */
  function serialize(val, depth) {
    depth = depth || 0;
    const t = typeof val;
    if (val === null) return { k: 'null', t: 'null' };
    if (t === 'undefined') return { k: 'undefined', t: 'undefined' };
    if (t === 'number' || t === 'boolean') return { k: 'prim', t, text: String(val) };
    if (t === 'bigint') return { k: 'prim', t: 'bigint', text: String(val) + 'n' };
    if (t === 'string') return { k: 'prim', t: 'string', text: val };
    if (t === 'function') return { k: 'fn', t: 'function', text: (val.name ? 'ƒ ' + val.name + '()' : 'ƒ ()') };
    if (val instanceof Error) return { k: 'error', t: 'error', text: val.message, stack: val.stack };
    if (val && val.nodeType) return { k: 'node', t: 'node', text: nodePreview(val) };
    if (depth > 3) return { k: 'prim', t: 'string', text: Array.isArray(val) ? '[…]' : '{…}' };
    if (Array.isArray(val)) {
      return { k: 'array', t: 'array', len: val.length, items: val.slice(0, 100).map((v) => serialize(v, depth + 1)), text: 'Array(' + val.length + ')' };
    }
    if (t === 'object') {
      const out = {}; let n = 0;
      for (const key in val) { if (n++ > 100) break; try { out[key] = serialize(val[key], depth + 1); } catch (e) { out[key] = { k: 'prim', t: 'string', text: '<unreadable>' }; } }
      let name = 'Object';
      try { name = val.constructor && val.constructor.name || 'Object'; } catch (e) {}
      return { k: 'object', t: 'object', name, entries: out, text: name + ' {…}' };
    }
    return { k: 'prim', t: 'string', text: String(val) };
  }
  function nodePreview(el) {
    if (el.nodeType === 3) return '#text "' + (el.textContent || '').slice(0, 40) + '"';
    let s = '<' + el.tagName.toLowerCase();
    if (el.id) s += ' id="' + el.id + '"';
    if (el.className && typeof el.className === 'string') s += ' class="' + el.className + '"';
    return s + '>';
  }

  /* ---------- console ---------- */
  const native = {};
  ['log', 'info', 'warn', 'error', 'debug', 'table', 'clear', 'group', 'groupEnd', 'dir'].forEach((m) => {
    native[m] = console[m] ? console[m].bind(console) : function () {};
    console[m] = function (...args) {
      try {
        if (m === 'clear') { TO_HOST({ kind: 'console-clear' }); }
        else TO_HOST({ kind: 'console', method: m === 'debug' || m === 'dir' || m === 'group' || m === 'groupEnd' ? 'log' : m, args: args.map((a) => serialize(a)), time: Date.now(), stack: callerLoc() });
      } catch (e) {}
      return native[m](...args);
    };
  });
  function callerLoc() {
    try { throw new Error(); } catch (e) {
      const lines = (e.stack || '').split('\n').slice(3);
      for (const ln of lines) { const m = ln.match(/(https?:[^\s)]+):(\d+):(\d+)/); if (m) return { url: m[1], line: +m[2], col: +m[3] }; }
    }
    return null;
  }

  /* ---------- errors ---------- */
  window.addEventListener('error', (ev) => {
    if (ev.message) TO_HOST({ kind: 'error', message: ev.message, filename: ev.filename, line: ev.lineno, col: ev.colno, stack: ev.error && ev.error.stack, time: Date.now() });
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason || {};
    TO_HOST({ kind: 'error', message: 'Unhandled promise rejection: ' + (r.message || r), stack: r.stack, time: Date.now() });
  });

  /* ---------- network ---------- */
  const _fetch = window.fetch;
  window.fetch = function (input, init) {
    const url = (typeof input === 'string') ? input : (input && input.url) || String(input);
    const method = (init && init.method) || (input && input.method) || 'GET';
    const t0 = performance.now();
    return _fetch.apply(this, arguments).then((res) => {
      const clone = res.clone();
      clone.blob().then((b) => {
        TO_HOST({ kind: 'network', url, method, status: res.status, ok: res.ok, type: (res.headers.get('content-type') || ''), size: b.size, time: performance.now() - t0, init: 'fetch', at: Date.now() });
      }).catch(() => TO_HOST({ kind: 'network', url, method, status: res.status, ok: res.ok, type: '', size: 0, time: performance.now() - t0, init: 'fetch', at: Date.now() }));
      return res;
    }).catch((err) => {
      TO_HOST({ kind: 'network', url, method, status: 0, ok: false, type: '', size: 0, time: performance.now() - t0, init: 'fetch', failed: true, at: Date.now() });
      throw err;
    });
  };
  const XOpen = XMLHttpRequest.prototype.open;
  const XSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) { this.__orbit = { method, url, t0: 0 }; return XOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    const o = this.__orbit; if (o) { o.t0 = performance.now();
      this.addEventListener('loadend', () => {
        let size = 0; try { size = (this.response && this.response.length) || (this.responseText && this.responseText.length) || 0; } catch (e) {}
        TO_HOST({ kind: 'network', url: o.url, method: o.method, status: this.status, ok: this.status >= 200 && this.status < 400, type: this.getResponseHeader && this.getResponseHeader('content-type') || '', size, time: performance.now() - o.t0, init: 'xhr', at: Date.now() });
      });
    }
    return XSend.apply(this, arguments);
  };

  /* ---------- DOM serialization ---------- */
  function serializeDom(el, depth) {
    if (el.nodeType === 3) {
      const txt = (el.textContent || '').trim();
      return txt ? { type: 'text', text: txt.slice(0, 120) } : null;
    }
    if (el.nodeType !== 1) return null;
    const id = oid(el);
    const attrs = {};
    for (const a of el.attributes) { if (a.name !== 'data-orbit-id') attrs[a.name] = a.value; }
    const node = { type: 'el', tag: el.tagName.toLowerCase(), id, attrs, children: [] };
    if (depth < 30) {
      for (const c of el.childNodes) { const s = serializeDom(c, depth + 1); if (s) node.children.push(s); }
    }
    return node;
  }
  function sendDom() {
    TO_HOST({ kind: 'dom', tree: serializeDom(document.documentElement, 0), url: location.href, path: vpathOf(location.href) });
  }
  function vpathOf(href) { const i = href.indexOf('/__vfs__/'); return i >= 0 ? href.slice(i + 9).split(/[?#]/)[0] : ''; }

  /* ---------- highlight overlay ---------- */
  let hl;
  function ensureHl() {
    if (hl) return hl;
    hl = document.createElement('div');
    hl.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;background:rgba(255,90,31,.25);border:1px solid rgba(255,90,31,.9);box-sizing:border-box;transition:all .05s;display:none';
    document.documentElement.appendChild(hl);
    return hl;
  }
  function highlight(el) {
    if (!el) { if (hl) hl.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    const h = ensureHl();
    h.style.display = 'block';
    h.style.left = r.left + 'px'; h.style.top = r.top + 'px';
    h.style.width = r.width + 'px'; h.style.height = r.height + 'px';
  }

  /* ---------- styles / box model ---------- */
  function selectorPath(el) {
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement.parentNode) {
      let s = cur.tagName.toLowerCase();
      if (cur.id) { s += '#' + cur.id; parts.unshift(s); break; }
      if (cur.className && typeof cur.className === 'string') { const c = cur.className.trim().split(/\s+/)[0]; if (c) s += '.' + c; }
      const sib = cur.parentNode ? [...cur.parentNode.children].filter((x) => x.tagName === cur.tagName) : [];
      if (sib.length > 1) s += ':nth-of-type(' + (sib.indexOf(cur) + 1) + ')';
      parts.unshift(s); cur = cur.parentNode;
    }
    return parts.join(' > ');
  }
  function matchedRules(el) {
    const out = [];
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
      if (!rules) continue;
      collectRules(rules, el, sheet, out);
    }
    return out;
  }
  function collectRules(rules, el, sheet, out) {
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (rule.type === 1) {
        try {
          if (el.matches(rule.selectorText)) {
            const decls = [];
            for (let j = 0; j < rule.style.length; j++) { const p = rule.style[j]; decls.push({ prop: p, value: rule.style.getPropertyValue(p), priority: rule.style.getPropertyPriority(p) }); }
            out.push({ selector: rule.selectorText, decls, href: sheet.href || '', sheetIndex: i });
          }
        } catch (e) {}
      } else if (rule.type === 4 || rule.type === 12) {
        try { collectRules(rule.cssRules, el, sheet, out); } catch (e) {}
      }
    }
  }
  function boxModel(el) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const num = (v) => Math.round(parseFloat(v) || 0);
    return {
      width: Math.round(r.width), height: Math.round(r.height),
      margin: { top: num(cs.marginTop), right: num(cs.marginRight), bottom: num(cs.marginBottom), left: num(cs.marginLeft) },
      padding: { top: num(cs.paddingTop), right: num(cs.paddingRight), bottom: num(cs.paddingBottom), left: num(cs.paddingLeft) },
      border: { top: num(cs.borderTopWidth), right: num(cs.borderRightWidth), bottom: num(cs.borderBottomWidth), left: num(cs.borderLeftWidth) },
    };
  }
  function importantComputed(el) {
    const cs = getComputedStyle(el);
    const keys = ['display', 'position', 'top', 'right', 'bottom', 'left', 'width', 'height', 'margin', 'padding', 'color', 'background-color', 'background', 'font-family', 'font-size', 'font-weight', 'line-height', 'flex', 'flex-direction', 'justify-content', 'align-items', 'gap', 'grid-template-columns', 'grid-template-rows', 'border', 'border-radius', 'box-shadow', 'opacity', 'z-index', 'overflow', 'text-align'];
    const out = {};
    keys.forEach((k) => { out[k] = cs.getPropertyValue(k); });
    return out;
  }
  function describe(el) {
    return {
      id: oid(el), tag: el.tagName.toLowerCase(),
      idAttr: el.id || '', cls: (el.className && typeof el.className === 'string') ? el.className : '',
      selector: selectorPath(el),
      attrs: (() => { const a = {}; for (const at of el.attributes) { if (at.name !== 'data-orbit-id') a[at.name] = at.value; } return a; })(),
      text: el.children.length === 0 ? (el.textContent || '').slice(0, 500) : '',
      inlineStyle: el.getAttribute('style') || '',
      computed: importantComputed(el),
      rules: matchedRules(el),
      box: boxModel(el),
      outerHTML: el.outerHTML.replace(/\sdata-orbit-id="[^"]*"/g, '').slice(0, 2000),
    };
  }

  /* ---------- element picker ---------- */
  let picking = false;
  function onMove(e) { if (!picking) return; const el = document.elementFromPoint(e.clientX, e.clientY); if (el) highlight(el); }
  function onClick(e) {
    if (!picking) return;
    e.preventDefault(); e.stopPropagation();
    const el = document.elementFromPoint(e.clientX, e.clientY);
    stopPick();
    if (el) { highlight(el); TO_HOST({ kind: 'pick', el: describe(el) }); }
  }
  function startPick() { picking = true; document.addEventListener('mousemove', onMove, true); document.addEventListener('click', onClick, true); document.addEventListener('touchstart', onTouch, true); }
  function onTouch(e) { if (!picking) return; const t = e.touches[0]; const el = document.elementFromPoint(t.clientX, t.clientY); if (el) { e.preventDefault(); stopPick(); highlight(el); TO_HOST({ kind: 'pick', el: describe(el) }); } }
  function stopPick() { picking = false; document.removeEventListener('mousemove', onMove, true); document.removeEventListener('click', onClick, true); document.removeEventListener('touchstart', onTouch, true); }

  /* ---------- storage reading ---------- */
  async function readStorage() {
    const out = { local: {}, session: {}, cookies: {}, indexeddb: [] };
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); out.local[k] = localStorage.getItem(k); } } catch (e) {}
    try { for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); out.session[k] = sessionStorage.getItem(k); } } catch (e) {}
    try { (document.cookie || '').split(';').forEach((c) => { const i = c.indexOf('='); if (i > 0) out.cookies[c.slice(0, i).trim()] = c.slice(i + 1).trim(); }); } catch (e) {}
    try {
      if (indexedDB.databases) {
        const dbs = await indexedDB.databases();
        for (const info of dbs) { out.indexeddb.push({ name: info.name, version: info.version, stores: await readDb(info.name) }); }
      }
    } catch (e) {}
    return out;
  }
  function readDb(name) {
    return new Promise((resolve) => {
      const out = {};
      let req; try { req = indexedDB.open(name); } catch (e) { return resolve(out); }
      req.onsuccess = () => {
        const db = req.result; const names = [...db.objectStoreNames];
        if (!names.length) { db.close(); return resolve(out); }
        let pending = names.length;
        names.forEach((sn) => {
          try {
            const tx = db.transaction(sn, 'readonly'); const store = tx.objectStore(sn); const items = [];
            const cur = store.openCursor();
            cur.onsuccess = (e) => { const c = e.target.result; if (c && items.length < 50) { items.push({ key: String(c.key), value: c.value }); c.continue(); } else { out[sn] = items; if (--pending === 0) { db.close(); resolve(out); } } };
            cur.onerror = () => { out[sn] = items; if (--pending === 0) { db.close(); resolve(out); } };
          } catch (e) { out[sn] = []; if (--pending === 0) { db.close(); resolve(out); } }
        });
      };
      req.onerror = () => resolve(out);
    });
  }

  /* ---------- command handler from host ---------- */
  window.addEventListener('message', async (e) => {
    const m = e.data || {};
    if (m.__orbit !== 'host') return;
    const el = m.id ? idToEl.get(m.id) : null;
    switch (m.cmd) {
      case 'request-dom': sendDom(); break;
      case 'pick-start': startPick(); break;
      case 'pick-stop': stopPick(); highlight(null); break;
      case 'highlight': highlight(m.id ? idToEl.get(m.id) : null); break;
      case 'select': if (el) { highlight(el); TO_HOST({ kind: 'pick', el: describe(el) }); } break;
      case 'set-inline-style': if (el) { el.style.setProperty(m.prop, m.value); TO_HOST({ kind: 'pick', el: describe(el) }); } break;
      case 'set-style-attr': if (el) { el.setAttribute('style', m.value); TO_HOST({ kind: 'pick', el: describe(el) }); } break;
      case 'set-text': if (el) { el.textContent = m.value; sendDom(); } break;
      case 'set-attr': if (el) { if (m.value === null) el.removeAttribute(m.name); else el.setAttribute(m.name, m.value); TO_HOST({ kind: 'pick', el: describe(el) }); sendDom(); } break;
      case 'set-class': if (el) { el.className = m.value; TO_HOST({ kind: 'pick', el: describe(el) }); sendDom(); } break;
      case 'set-id': if (el) { el.id = m.value; TO_HOST({ kind: 'pick', el: describe(el) }); sendDom(); } break;
      case 'remove-node': if (el) { el.remove(); sendDom(); } break;
      case 'duplicate-node': if (el) { const c = el.cloneNode(true); c.removeAttribute('data-orbit-id'); el.parentNode.insertBefore(c, el.nextSibling); sendDom(); } break;
      case 'add-child': if (el) { const c = document.createElement(m.tag || 'div'); c.textContent = m.text || ''; el.appendChild(c); sendDom(); } break;
      case 'read-storage': { const data = await readStorage(); TO_HOST({ kind: 'storage', data }); break; }
      case 'set-local': try { localStorage.setItem(m.key, m.value); } catch (e) {} break;
      case 'del-local': try { localStorage.removeItem(m.key); } catch (e) {} break;
      case 'clear-local': try { localStorage.clear(); } catch (e) {} break;
    }
  });

  /* ---------- announce ready + intercept navigations within picker ---------- */
  function ready() {
    TO_HOST({ kind: 'ready', url: location.href, path: vpathOf(location.href), title: document.title });
    sendDom();
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(ready, 0);
  else window.addEventListener('DOMContentLoaded', ready);
  window.addEventListener('load', () => { TO_HOST({ kind: 'loaded', url: location.href, path: vpathOf(location.href) }); sendDom(); });
}
