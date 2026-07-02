/**
 * preview.js — AntLab IDE
 * ------------------------------------------------------------
 * Live preview that behaves like a real localhost dev server.
 *
 * Primary mode (Service Worker available — http://localhost, Live Server,
 * GitHub Pages, any https origin):
 *   • Every project file is written into the Cache Storage API and served
 *     by sw.js at a real same-origin URL.
 *   • The iframe loads that URL, so fetch(), relative paths, multi-page
 *     navigation (index.html → page.html) and external API calls all work.
 *   • A browser-style address bar (back / forward / reload / home + editable
 *     URL field) drives real iframe navigation.
 *
 * Fallback mode (Service Workers unavailable — e.g. opened via file://):
 *   • Files are inlined into a single srcdoc document (v1 behaviour) so a
 *     preview still renders. fetch()/multi-page won't work in this mode.
 * ------------------------------------------------------------
 */

const Preview = (() => {
  const SW_URL       = 'sw.js';
  const CACHE_NAME   = 'antlab-preview-v1';
  const MOUNT        = '__antlab_preview__/';

  let previewEl      = null;
  let urlBar         = null;
  let renderTimer    = null;
  let consoleLines   = [];
  let consoleCount   = 0;
  const MAX_CONSOLE_LINES = 200;
  let currentDevice  = 'desktop';
  let isConsoleOpen  = false;

  let swMode         = false;   // true once the service worker is controlling
  let mountBase      = '';      // absolute URL prefix for served files
  let mountPath      = '';      // pathname portion of mountBase
  let currentPage    = 'index.html';
  let swReadyPromise = null;

  // ---- console bridge injected into every served HTML page ----
  const CONSOLE_BRIDGE = `
<script>
(function() {
  var _methods = ['log','warn','error','info','debug','table','dir'];
  var _console = {};
  _methods.forEach(function(method) {
    if (!console[method]) return;
    _console[method] = console[method].bind(console);
    console[method] = function() {
      var args = Array.from(arguments).map(function(a) {
        try { if (typeof a === 'object') return JSON.stringify(a, null, 2); return String(a); }
        catch(e) { return '[Circular]'; }
      });
      try { window.parent.postMessage({ type:'console', method:method, args:args, timestamp:Date.now() }, '*'); } catch(e) {}
      _console[method].apply(console, arguments);
    };
  });
  window.addEventListener('error', function(e) {
    try { window.parent.postMessage({ type:'console', method:'error',
      args:[e.message + (e.filename ? ' (' + e.filename + ':' + e.lineno + ')' : '')], timestamp:Date.now() }, '*'); } catch(ex) {}
  });
  window.addEventListener('unhandledrejection', function(e) {
    try { window.parent.postMessage({ type:'console', method:'error',
      args:['Unhandled Promise Rejection: ' + (e.reason ? String(e.reason) : 'unknown')], timestamp:Date.now() }, '*'); } catch(ex) {}
  });
})();
<\/script>`;

  /* =============================================
     INIT
     ============================================= */
  async function init() {
    previewEl = document.getElementById('preview');

    window.addEventListener('message', handleIframeMessage);

    // Device buttons
    document.querySelectorAll('.device-btn').forEach((btn) => {
      btn.addEventListener('click', () => setDevice(btn.dataset.device));
    });

    // Console toggle
    document.getElementById('consoleToggle')?.addEventListener('click', toggleConsole);
    document.getElementById('clearConsole')?.addEventListener('click', clearConsole);

    // Address-bar controls
    setupAddressBar();

    // Track iframe navigations to keep the address bar in sync
    previewEl?.addEventListener('load', onIframeLoad);

    // Try to bring up the service-worker virtual server
    swReadyPromise = ensureServiceWorker();
    swMode = await swReadyPromise;
  }

  async function ensureServiceWorker() {
    if (!('serviceWorker' in navigator)) return false;
    // Service workers require a secure context (https or localhost).
    if (!self.isSecureContext) return false;
    try {
      const reg = await navigator.serviceWorker.register(SW_URL);
      await navigator.serviceWorker.ready;

      // Make sure the worker actually controls this page before we rely on it.
      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve) => {
          const t = setTimeout(resolve, 2000);
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            clearTimeout(t); resolve();
          }, { once: true });
        });
      }

      mountBase = reg.scope.replace(/\/?$/, '/') + MOUNT;
      mountPath = new URL(mountBase).pathname;
      return true;
    } catch (e) {
      console.warn('[AntLab] Service worker unavailable, using inline preview:', e);
      return false;
    }
  }

  /* =============================================
     ADDRESS BAR
     ============================================= */
  function setupAddressBar() {
    urlBar = document.getElementById('previewUrlBar');
    document.getElementById('navBack')?.addEventListener('click', goBack);
    document.getElementById('navForward')?.addEventListener('click', goForward);
    document.getElementById('navReload')?.addEventListener('click', reloadCurrent);
    document.getElementById('navHome')?.addEventListener('click', () => {
      navigateTo(homePage(window._currentVFS || []));
    });
    urlBar?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitUrlBar(urlBar.value.trim());
      }
    });
    urlBar?.addEventListener('focus', () => urlBar.select());
  }

  function submitUrlBar(value) {
    if (!value) return;
    // Absolute URL → navigate the iframe to a real external site (browser-like)
    if (/^https?:\/\//i.test(value)) {
      if (previewEl) previewEl.src = value;
      return;
    }
    if (/^about:|^data:/i.test(value)) { if (previewEl) previewEl.src = value; return; }
    // Otherwise treat as a path within the project
    navigateTo(value.replace(/^\/+/, ''));
  }

  function goBack()    { try { previewEl.contentWindow.history.back();    } catch (e) {} }
  function goForward() { try { previewEl.contentWindow.history.forward(); } catch (e) {} }

  function reloadCurrent() {
    if (swMode) {
      // Rewrite the VFS from the latest editor state, then reload the page.
      const files = window._currentVFS || [];
      writeVfs(files).then(() => {
        try { previewEl.contentWindow.location.reload(); }
        catch (e) { navigateTo(currentPage); }
      });
    } else {
      forceRender();
    }
  }

  function navigateTo(path) {
    if (!swMode) { forceRender(); return; }
    currentPage = path || 'index.html';
    previewEl.src = mountBase + encodePath(currentPage);
    if (urlBar) urlBar.value = currentPage;
  }

  function onIframeLoad() {
    // Keep the address bar reflecting the iframe's real location.
    try {
      const loc = previewEl.contentWindow.location;
      if (swMode && loc.pathname.indexOf(mountPath) === 0) {
        currentPage = decodeURIComponent(loc.pathname.slice(mountPath.length)) || 'index.html';
        if (urlBar && document.activeElement !== urlBar) {
          urlBar.value = currentPage + (loc.search || '') + (loc.hash || '');
        }
      } else if (urlBar && document.activeElement !== urlBar) {
        urlBar.value = loc.href;
      }
    } catch (e) {
      // Cross-origin (external site navigated to) — leave the bar as typed.
    }
    // Let the inspector re-attach to the freshly loaded document.
    try { if (window.Inspector) Inspector.onPreviewRendered(); } catch (e) {}
  }

  /* =============================================
     VIRTUAL FILE SYSTEM (service-worker mode)
     ============================================= */
  async function writeVfs(files) {
    const cache = await caches.open(CACHE_NAME);
    // Clear previous files so deleted/renamed files disappear.
    const keys = await cache.keys();
    await Promise.all(
      keys
        .filter((req) => req.url.indexOf('/' + MOUNT) !== -1)
        .map((req) => cache.delete(req))
    );
    for (const f of files) {
      if (!f || !f.name) continue;
      let body = f.content != null ? f.content : '';
      if (/\.html?$/i.test(f.name)) body = injectBridge(body);
      const res = new Response(body, {
        headers: { 'Content-Type': contentType(f.name), 'Cache-Control': 'no-store' },
      });
      try { await cache.put(mountBase + encodePath(f.name), res); } catch (e) {}
    }
  }

  function injectBridge(html) {
    if (/<head[\s>]/i.test(html)) {
      return html.replace(/(<head[^>]*>)/i, '$1\n' + CONSOLE_BRIDGE);
    }
    if (/<html[\s>]/i.test(html)) {
      return html.replace(/(<html[^>]*>)/i, '$1\n' + CONSOLE_BRIDGE);
    }
    return CONSOLE_BRIDGE + '\n' + html;
  }

  function encodePath(name) {
    return String(name).split('/').map(encodeURIComponent).join('/');
  }

  function contentType(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const map = {
      html: 'text/html; charset=utf-8',
      htm:  'text/html; charset=utf-8',
      css:  'text/css; charset=utf-8',
      js:   'text/javascript; charset=utf-8',
      mjs:  'text/javascript; charset=utf-8',
      json: 'application/json; charset=utf-8',
      svg:  'image/svg+xml',
      xml:  'application/xml; charset=utf-8',
      txt:  'text/plain; charset=utf-8',
      md:   'text/markdown; charset=utf-8',
      csv:  'text/csv; charset=utf-8',
    };
    return map[ext] || 'text/plain; charset=utf-8';
  }

  function homePage(files) {
    if (files.some((f) => /^index\.html?$/i.test(f.name))) return 'index.html';
    const firstHtml = files.find((f) => /\.html?$/i.test(f.name));
    if (firstHtml) return firstHtml.name;
    return 'index.html';
  }

  /* =============================================
     RENDER
     files: [{ name, type, content }]
     opts:  { navigateHome:boolean }
     ============================================= */
  function render(files, immediate = false, opts = {}) {
    window._currentVFS = files || [];
    clearTimeout(renderTimer);
    const delay = immediate ? 0 : 550;
    renderTimer = setTimeout(() => _doRender(window._currentVFS, opts), delay);
  }

  function forceRender() {
    _doRender(window._currentVFS || [], {});
  }

  async function _doRender(files, opts) {
    if (!previewEl) return;

    if (swMode) {
      await writeVfs(files);
      const goHome =
        opts.navigateHome ||
        !currentPage ||
        !files.some((f) => f.name === currentPage);
      if (goHome) {
        navigateTo(homePage(files));
      } else {
        try { previewEl.contentWindow.location.reload(); }
        catch (e) { navigateTo(currentPage); }
      }
    } else {
      // Fallback: inline everything into a single srcdoc document.
      previewEl.removeAttribute('src');
      previewEl.srcdoc = buildFallbackSrcdoc(files);
      if (urlBar) urlBar.value = 'index.html (inline preview)';
    }
  }

  /* =============================================
     FALLBACK SRCDOC (no service worker)
     ============================================= */
  function buildFallbackSrcdoc(files) {
    const htmlFile = files.find((f) => /^index\.html?$/i.test(f.name))
      || files.find((f) => /\.html?$/i.test(f.name));
    const html = htmlFile ? htmlFile.content : '';
    const css  = files.filter((f) => /\.css$/i.test(f.name))
      .map((f) => `/* ${f.name} */\n${f.content}`).join('\n\n');
    const js   = files.filter((f) => /\.(m?js)$/i.test(f.name))
      .map((f) => `/* ${f.name} */\n${f.content}`).join('\n\n');

    const hasDoc = /<!doctype/i.test(html) || /<html[\s>]/i.test(html);
    if (hasDoc) return injectInline(html, css, js);
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
${CONSOLE_BRIDGE}
<style>*,*::before,*::after{box-sizing:border-box}
${css}</style></head>
<body>
${html}
<script>
${js}
<\/script>
</body></html>`;
  }

  function injectInline(html, css, js) {
    let doc = html;
    if (/<head[\s>]/i.test(doc)) doc = doc.replace(/(<head[^>]*>)/i, '$1\n' + CONSOLE_BRIDGE);
    else doc = CONSOLE_BRIDGE + doc;
    // strip external refs we're inlining
    doc = doc.replace(/<link[^>]+href=["'][^"']*\.css["'][^>]*>/gi, '');
    doc = doc.replace(/<script[^>]+src=["'][^"']*\.m?js["'][^>]*>\s*<\/script>/gi, '');
    if (css.trim()) {
      const style = `<style>\n${css}\n</style>`;
      if (/<\/head>/i.test(doc)) doc = doc.replace(/<\/head>/i, style + '\n</head>');
      else if (/<body[\s>]/i.test(doc)) doc = doc.replace(/(<body[^>]*>)/i, style + '\n$1');
      else doc = style + '\n' + doc;
    }
    if (js.trim()) {
      const script = `<script>\n${js}\n<\/script>`;
      if (/<\/body>/i.test(doc)) doc = doc.replace(/<\/body>/i, script + '\n</body>');
      else doc += '\n' + script;
    }
    return doc;
  }

  /* =============================================
     OPEN FULL PREVIEW IN NEW TAB
     ============================================= */
  async function openFullPreview(files) {
    files = files || window._currentVFS || [];
    if (swMode) {
      await writeVfs(files);
      const page = (currentPage && files.some((f) => f.name === currentPage))
        ? currentPage : homePage(files);
      window.open(mountBase + encodePath(page), '_blank');
    } else {
      const doc = buildFallbackSrcdoc(files);
      const blob = new Blob([doc], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const win = window.open(url, '_blank');
      if (win) win.addEventListener('load', () => setTimeout(() => URL.revokeObjectURL(url), 1000));
      else setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  }

  /* =============================================
     DEVICE MODES
     ============================================= */
  const DEVICES = {
    desktop: { label: 'Desktop', width: null },
    tablet:  { label: 'Tablet (768px)', width: '768px' },
    mobile:  { label: 'Mobile (390px)', width: '390px' },
  };

  function setDevice(device) {
    currentDevice = device;
    const frame = document.getElementById('previewFrame');
    const label = document.getElementById('previewSizeLabel');
    document.querySelectorAll('.device-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.device === device);
    });
    if (frame) frame.dataset.device = device;
    if (label) label.textContent = DEVICES[device]?.label || device;
  }

  /* =============================================
     CONSOLE
     ============================================= */
  function handleIframeMessage(event) {
    if (!event.data || event.data.type !== 'console') return;
    appendConsoleLine(event.data.method, event.data.args);
  }

  function appendConsoleLine(method, args) {
    const output = document.getElementById('consoleOutput');
    if (!output) return;
    if (consoleLines.length >= MAX_CONSOLE_LINES) {
      const oldest = consoleLines.shift();
      if (oldest && oldest.parentNode) oldest.parentNode.removeChild(oldest);
    }
    const iconMap = { log: '›', warn: '⚠', error: '✖', info: 'ℹ', debug: '·' };
    const div = document.createElement('div');
    div.className = `console-line ${method === 'debug' ? 'log' : method}`;
    div.innerHTML = `
      <span class="console-icon">${iconMap[method] || '›'}</span>
      <span class="console-content">${escapeHtml(args.join(' '))}</span>`;
    const empty = output.querySelector('.console-empty');
    if (empty) empty.remove();
    output.appendChild(div);
    output.scrollTop = output.scrollHeight;
    consoleLines.push(div);
    if (method === 'error' || method === 'warn') { consoleCount++; updateConsoleBadge(); }
  }

  function updateConsoleBadge() {
    const badge = document.getElementById('consoleBadge');
    if (!badge) return;
    if (consoleCount > 0 && !isConsoleOpen) {
      badge.textContent = consoleCount > 99 ? '99+' : consoleCount;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  function clearConsole() {
    const output = document.getElementById('consoleOutput');
    if (output) output.innerHTML = '<p class="console-empty">No console output yet.</p>';
    consoleLines = [];
    consoleCount = 0;
    updateConsoleBadge();
  }

  function toggleConsole() {
    const panel = document.getElementById('consolePanel');
    if (!panel) return;
    isConsoleOpen = !isConsoleOpen;
    panel.classList.toggle('hidden', !isConsoleOpen);
    if (isConsoleOpen) { consoleCount = 0; updateConsoleBadge(); }
  }

  function openConsole() {
    const panel = document.getElementById('consolePanel');
    if (!panel) return;
    isConsoleOpen = true;
    panel.classList.remove('hidden');
    consoleCount = 0;
    updateConsoleBadge();
  }

  /* =============================================
     UTILITIES
     ============================================= */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  return {
    init,
    render,
    forceRender,
    openFullPreview,
    setDevice,
    clearConsole,
    toggleConsole,
    openConsole,
    appendConsoleLine,
    navigateTo,
    reloadCurrent,
    getCurrentPageName: () => currentPage,
    isServiceWorkerMode: () => swMode,
  };
})();
