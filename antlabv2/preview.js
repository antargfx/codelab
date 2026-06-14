/**
 * preview.js — AntLab IDE
 * Handles live preview rendering inside a sandboxed iframe.
 * Captures console output, manages device viewport modes,
 * and generates Blob URLs for full-tab preview.
 */

const Preview = (() => {
  let previewEl = null;
  let renderTimer = null;
  let consoleLines = [];
  let consoleCount = 0;
  const MAX_CONSOLE_LINES = 200;
  let currentDevice = 'desktop';
  let isConsoleOpen = false;

  // Service Worker virtual server state
  let swRegistration = null;
  let swReady = false;
  const VIRTUAL_BASE = '/__antlab__/';

  /* =============================================
     SERVICE WORKER — Virtual Localhost Server
     ============================================= */
  async function initServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      console.warn('[AntLab] Service Workers not supported — localhost preview unavailable.');
      return false;
    }
    try {
      swRegistration = await navigator.serviceWorker.register('./sw.js', { scope: '/' });
      // Wait for SW to be active
      await navigator.serviceWorker.ready;
      swReady = true;
      console.log('[AntLab] Virtual server ready ✓');
      return true;
    } catch (err) {
      console.warn('[AntLab] Service Worker registration failed:', err);
      swReady = false;
      return false;
    }
  }

  /**
   * Send project files to the Service Worker virtual server.
   * Returns a Promise that resolves when the SW confirms files are ready.
   */
  function serveToSW(html, css, js, extraFiles) {
    return new Promise((resolve, reject) => {
      const sw = navigator.serviceWorker.controller;
      if (!sw) {
        // SW not yet controlling — reload needed. Resolve anyway with blob fallback signal.
        reject(new Error('SW not controlling page yet'));
        return;
      }

      const MIME = { html: 'text/html', css: 'text/css', js: 'application/javascript' };

      // Build srcdoc for index.html — use the full assembled document
      const srcdoc = buildSrcdoc(html, css, js, extraFiles || []);

      const files = [
        { name: 'index.html', content: srcdoc, mime: 'text/html; charset=utf-8' },
        { name: 'style.css',  content: css || '',  mime: 'text/css' },
        { name: 'script.js',  content: js  || '',  mime: 'application/javascript' },
      ];

      // Add extra files
      (extraFiles || []).forEach((f) => {
        if (f && f.name && f.content !== undefined) {
          files.push({
            name: f.name,
            content: f.content,
            mime: MIME[f.type] || 'text/plain',
          });
        }
      });

      // Listen for SW confirmation
      const onMessage = (e) => {
        if (e.data && e.data.type === 'PROJECT_READY') {
          navigator.serviceWorker.removeEventListener('message', onMessage);
          resolve();
        }
      };
      navigator.serviceWorker.addEventListener('message', onMessage);

      // Timeout fallback
      setTimeout(() => {
        navigator.serviceWorker.removeEventListener('message', onMessage);
        resolve(); // resolve anyway, URL may still work
      }, 2000);

      sw.postMessage({ type: 'SERVE_PROJECT', files });
    });
  }

  /**
   * Open preview in a new tab via the virtual SW server (real localhost semantics).
   * Falls back to blob: URL if SW is unavailable.
   */
  async function openLocalhostPreview(html, css, js, extraFiles) {
    if (!swReady) {
      // Try to init SW one more time
      await initServiceWorker();
    }

    if (swReady && navigator.serviceWorker.controller) {
      try {
        await serveToSW(html, css, js, extraFiles);
        const previewUrl = window.location.origin + VIRTUAL_BASE;
        window.open(previewUrl, '_blank');
        return;
      } catch (err) {
        console.warn('[AntLab] SW serve failed, falling back to blob:', err);
      }
    } else if (swReady && !navigator.serviceWorker.controller) {
      // SW registered but not yet controlling — need one page reload
      // Open a helper page that will be served by SW on next load
      showSWActivationHint();
      return;
    }

    // Fallback: blob URL (original behavior)
    openFullPreview(html, css, js, extraFiles);
  }

  function showSWActivationHint() {
    // Show a non-blocking toast guiding the user
    let toast = document.getElementById('swToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'swToast';
      toast.style.cssText = `
        position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
        background:var(--bg-secondary,#1e1e2e);color:var(--text-primary,#fff);
        border:1px solid var(--border,#333);border-radius:8px;
        padding:12px 20px;font-size:13px;z-index:9999;
        box-shadow:0 4px 24px rgba(0,0,0,.4);max-width:340px;text-align:center;
        line-height:1.5;
      `;
      document.body.appendChild(toast);
    }
    toast.innerHTML = `
      <strong>Virtual server activating…</strong><br>
      Refresh the page once, then click Preview again to get full localhost access.
      <br><br>
      <button onclick="location.reload()" style="
        background:var(--accent,#ff7033);color:#fff;border:none;
        padding:6px 16px;border-radius:6px;cursor:pointer;font-size:12px;
      ">Refresh Now</button>
      <button onclick="this.closest('#swToast').remove()" style="
        background:transparent;color:var(--text-muted,#888);border:none;
        padding:6px 8px;cursor:pointer;font-size:12px;margin-left:4px;
      ">Dismiss</button>
    `;
    setTimeout(() => toast?.remove(), 12000);
  }

  // Console message interceptor script injected into preview iframe
  const CONSOLE_BRIDGE = `
<script>
(function() {
  // Intercept console methods and relay to parent
  const _methods = ['log', 'warn', 'error', 'info', 'debug', 'table', 'dir'];
  const _console = {};

  _methods.forEach(function(method) {
    _console[method] = console[method].bind(console);
    console[method] = function() {
      var args = Array.from(arguments).map(function(a) {
        try {
          if (typeof a === 'object') return JSON.stringify(a, null, 2);
          return String(a);
        } catch(e) { return '[Circular]'; }
      });
      try {
        window.parent.postMessage({
          type: 'console',
          method: method,
          args: args,
          timestamp: Date.now()
        }, '*');
      } catch(e) {}
      _console[method].apply(console, arguments);
    };
  });

  // Capture uncaught errors
  window.addEventListener('error', function(e) {
    try {
      window.parent.postMessage({
        type: 'console',
        method: 'error',
        args: [e.message + (e.filename ? ' (' + e.filename + ':' + e.lineno + ')' : '')],
        timestamp: Date.now()
      }, '*');
    } catch(ex) {}
  });

  // Capture unhandled promise rejections
  window.addEventListener('unhandledrejection', function(e) {
    try {
      window.parent.postMessage({
        type: 'console',
        method: 'error',
        args: ['Unhandled Promise Rejection: ' + (e.reason ? String(e.reason) : 'unknown')],
        timestamp: Date.now()
      }, '*');
    } catch(ex) {}
  });
})();
<\/script>`;

  /* =============================================
     INIT
     ============================================= */
  function init() {
    previewEl = document.getElementById('preview');

    // Register Service Worker for virtual localhost preview
    initServiceWorker();

    // Listen for console messages from iframe
    window.addEventListener('message', handleIframeMessage);

    // Device buttons
    document.querySelectorAll('.device-btn').forEach((btn) => {
      btn.addEventListener('click', () => setDevice(btn.dataset.device));
    });

    // Refresh button
    document.getElementById('refreshPreview')?.addEventListener('click', () => {
      forceRender();
    });

    // Console toggle
    document.getElementById('consoleToggle')?.addEventListener('click', toggleConsole);
    document.getElementById('clearConsole')?.addEventListener('click', clearConsole);
  }

  /* =============================================
     RENDER — Build srcdoc from HTML/CSS/JS
     ============================================= */
  function buildSrcdoc(html, css, js, extraFiles) {
    const hasDoctype = /<!doctype/i.test(html);
    const hasHtmlTag = /<html[\s>]/i.test(html);
    let doc;
    if (hasDoctype || hasHtmlTag) {
      doc = injectIntoDom(html, css, js, extraFiles);
    } else {
      doc = wrapFragment(html, css, js, extraFiles);
    }
    return doc;
  }

  function injectIntoDom(html, css, js, extraFiles) {
    let doc = html;

    // Inject console bridge into <head>
    if (/<head[\s>]/i.test(doc)) {
      doc = doc.replace(/(<head[^>]*>)/i, '$1\n' + CONSOLE_BRIDGE);
    } else {
      doc = CONSOLE_BRIDGE + doc;
    }

    // Remove external style.css references
    doc = doc.replace(
      /<link[^>]+href=["']style\.css["'][^>]*>/gi,
      ''
    );

    // Remove external script.js references
    doc = doc.replace(
      /<script[^>]+src=["']script\.js["'][^>]*>\s*<\/script>/gi,
      ''
    );

    // Combine CSS
    const extraCss = (extraFiles || [])
      .filter(f => f.type === 'css')
      .map(f => `/* ${f.name} */\n${f.content}`)
      .join('\n\n');

    const allCss = [css, extraCss]
      .filter(Boolean)
      .join('\n\n');

    if (allCss.trim()) {
      const styleTag = `<style>\n${allCss}\n</style>`;

      if (/<\/head>/i.test(doc)) {
        doc = doc.replace(/<\/head>/i, styleTag + '\n</head>');
      } else if (/<body[\s>]/i.test(doc)) {
        doc = doc.replace(/(<body[^>]*>)/i, styleTag + '\n$1');
      } else {
        doc = styleTag + '\n' + doc;
      }
    }

    // Combine JS
    const extraJs = (extraFiles || [])
      .filter(f => f.type === 'js')
      .map(f => `/* ${f.name} */\n${f.content}`)
      .join('\n\n');

    const allJs = [js, extraJs]
      .filter(Boolean)
      .join('\n\n');

    if (allJs.trim()) {
      const scriptTag = `<script>\n${allJs}\n<\/script>`;

      if (/<\/body>/i.test(doc)) {
        doc = doc.replace(/<\/body>/i, scriptTag + '\n</body>');
      } else {
        doc += '\n' + scriptTag;
      }
    }

    return doc;
  }

  function wrapFragment(html, css, js, extraFiles) {

    const extraCss = (extraFiles || [])
      .filter(f => f.type === 'css')
      .map(f => `/* ${f.name} */\n${f.content}`)
      .join('\n\n');

    const extraJs = (extraFiles || [])
      .filter(f => f.type === 'js')
      .map(f => `/* ${f.name} */\n${f.content}`)
      .join('\n\n');

    const allCss = [css, extraCss]
      .filter(Boolean)
      .join('\n\n');

    const allJs = [js, extraJs]
      .filter(Boolean)
      .join('\n\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  ${CONSOLE_BRIDGE}

  <style>
    *, *::before, *::after {
      box-sizing: border-box;
    }

${allCss}
  </style>
</head>
<body>

${html}

  <script>
${allJs}
  <\/script>
</body>
</html>`;
  }

  /* =============================================
     DEBOUNCED RENDER
     ============================================= */
  function render(html, css, js, immediate = false, extraFiles = []) {
    clearTimeout(renderTimer);
    const delay = immediate ? 0 : 600;
    renderTimer = setTimeout(() => _doRender(html, css, js, extraFiles), delay);
  }

  function forceRender() {
    const values = window._currentEditorValues || { html: '', css: '', js: '', extraFiles: [] };
    _doRender(values.html, values.css, values.js, values.extraFiles || []);
  }

  function _doRender(html, css, js, extraFiles) {
    if (!previewEl) return;
    const srcdoc = buildSrcdoc(html, css, js, extraFiles || []);
    previewEl.srcdoc = srcdoc;
  }

  /* =============================================
     OPEN FULL PREVIEW IN NEW TAB
     ============================================= */
  function openFullPreview(html, css, js, extraFiles) {
    const doc = buildSrcdoc(html, css, js, extraFiles || []);
    const blob = new Blob([doc], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    // Revoke URL after window loads to free memory
    if (win) {
      win.addEventListener('load', () => {
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
    } else {
      // Fallback if popup blocked
      setTimeout(() => URL.revokeObjectURL(url), 5000);
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

    // Update active button
    document.querySelectorAll('.device-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.device === device);
    });

    // Update frame attribute for CSS targeting
    frame.dataset.device = device;

    // Update label
    if (label) label.textContent = DEVICES[device]?.label || device;
  }

  /* =============================================
     CONSOLE — Capture messages from iframe
     ============================================= */
  function handleIframeMessage(event) {
    if (!event.data || event.data.type !== 'console') return;
    const { method, args } = event.data;
    appendConsoleLine(method, args);
  }

  function appendConsoleLine(method, args) {
    const output = document.getElementById('consoleOutput');
    if (!output) return;

    // Enforce max lines
    if (consoleLines.length >= MAX_CONSOLE_LINES) {
      const oldest = consoleLines.shift();
      if (oldest && oldest.parentNode) oldest.parentNode.removeChild(oldest);
    }

    const iconMap = {
      log: '›',
      warn: '⚠',
      error: '✖',
      info: 'ℹ',
      debug: '·',
    };

    const div = document.createElement('div');
    div.className = `console-line ${method === 'debug' ? 'log' : method}`;
    div.innerHTML = `
      <span class="console-icon">${iconMap[method] || '›'}</span>
      <span class="console-content">${escapeHtml(args.join(' '))}</span>
    `;

    // Remove empty state message if present
    const empty = output.querySelector('.console-empty');
    if (empty) empty.remove();

    output.appendChild(div);
    output.scrollTop = output.scrollHeight;
    consoleLines.push(div);

    // Update badge
    if (method === 'error' || method === 'warn') {
      consoleCount++;
      updateConsoleBadge();
    }
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
    if (output) {
      output.innerHTML = '<p class="console-empty">No console output yet.</p>';
    }
    consoleLines = [];
    consoleCount = 0;
    updateConsoleBadge();
  }

  function toggleConsole() {
    const panel = document.getElementById('consolePanel');
    if (!panel) return;
    isConsoleOpen = !isConsoleOpen;
    panel.classList.toggle('hidden', !isConsoleOpen);
    // Reset badge when opening
    if (isConsoleOpen) {
      consoleCount = 0;
      updateConsoleBadge();
    }
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
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  return {
    init,
    render,
    forceRender,
    openFullPreview,
    openLocalhostPreview,
    setDevice,
    clearConsole,
    toggleConsole,
    openConsole,
    appendConsoleLine,
  };
})();
