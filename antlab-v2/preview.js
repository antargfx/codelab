/**
 * preview.js — AntLab v2
 * -----------------------------------------------------
 * Uses the Service Worker VFS to serve the project at real URLs so the
 * preview iframe behaves exactly like a localhost dev server.
 *
 * Responsibilities:
 *   • Register / negotiate with sw.js
 *   • Push updated file map to the SW whenever the user edits code
 *   • Manage the browser-style URL bar (editable, history, home, reload)
 *   • Capture console + errors from the iframe (via bridge injected by SW)
 *   • Device viewport modes (desktop / tablet / mobile)
 *   • Open-in-new-tab
 */

const Preview = (() => {
  let iframeEl = null;
  let swReg = null;
  let swReady = false;
  let currentProject = null;
  let currentPath = '';           // current preview file path (e.g. "pages/about.html")
  let history = [];               // navigation history: [{ path }]
  let historyIdx = -1;
  let consoleLines = [];
  let consoleCount = 0;
  let isConsoleOpen = false;
  const MAX_CONSOLE = 300;
  let pushTimer = null;
  let lastSentSig = '';           // signature of last-sent files (so we skip no-ops)

  /* ================= SW Registration ================= */
  async function registerSW() {
    if (!('serviceWorker' in navigator)) {
      console.warn('[AntLab] No Service Worker support — falling back to srcdoc mode.');
      return null;
    }
    try {
      // Scope defaults to the folder containing sw.js — same folder as index.html
      swReg = await navigator.serviceWorker.register('sw.js');
      // Wait for a controlling worker
      if (!navigator.serviceWorker.controller) {
        // Trigger controller by claiming (SW does this on activate).
        // Give it a moment to install/activate.
        await new Promise((res) => {
          if (navigator.serviceWorker.controller) return res();
          const listener = () => { navigator.serviceWorker.removeEventListener('controllerchange', listener); res(); };
          navigator.serviceWorker.addEventListener('controllerchange', listener);
          setTimeout(res, 1500); // hard timeout — proceed anyway
        });
      }
      swReady = true;
      return swReg;
    } catch (err) {
      console.error('[AntLab] SW registration failed:', err);
      return null;
    }
  }

  function activeWorker() {
    return (swReg && (swReg.active || swReg.waiting || swReg.installing)) || navigator.serviceWorker.controller;
  }

  /* ================= INIT ================= */
  async function init() {
    iframeEl = document.getElementById('preview');
    await registerSW();

    // Listen for messages from iframe (console + nav)
    window.addEventListener('message', onIframeMessage);

    // URL bar
    const urlBar = document.getElementById('urlBar');
    const urlGo  = document.getElementById('urlGoBtn');
    urlBar?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); navigateTo(urlBar.value, true); }
    });
    urlBar?.addEventListener('focus', () => urlBar.select());
    urlGo?.addEventListener('click', () => navigateTo(urlBar.value, true));

    // Nav buttons
    document.getElementById('navBack')?.addEventListener('click', goBack);
    document.getElementById('navForward')?.addEventListener('click', goForward);
    document.getElementById('navReload')?.addEventListener('click', reload);
    document.getElementById('navHome')?.addEventListener('click', goHome);

    // Device buttons
    document.querySelectorAll('.device-btn').forEach(btn => {
      btn.addEventListener('click', () => setDevice(btn.dataset.device));
    });

    // Console
    document.getElementById('consoleToggle')?.addEventListener('click', toggleConsole);
    document.getElementById('clearConsole')?.addEventListener('click', clearConsole);
  }

  /* ================= Update project in SW ================= */
  async function setProject(project) {
    currentProject = project;
    await pushFiles(true);
    // On project switch, go to the entry
    currentPath = project.entry || 'index.html';
    resetHistory(currentPath);
    loadUrl(currentPath);
  }

  async function updateFiles(files, entry) {
    if (!currentProject) return;
    currentProject.files = files;
    if (entry) currentProject.entry = entry;
    await pushFiles(false);
  }

  function _sig(files, entry) {
    // Lightweight signature for change detection
    let s = 'E:' + (entry || '') + '|';
    Object.keys(files).sort().forEach(k => { s += k + ':' + files[k].length + ';'; });
    return s;
  }

  async function pushFiles(reloadAfter) {
    if (!currentProject) return;
    const w = activeWorker();
    if (!w) {
      // Fall back to srcdoc mode if SW unavailable
      srcdocFallback();
      return;
    }
    const sig = _sig(currentProject.files, currentProject.entry);
    if (!reloadAfter && sig === lastSentSig) return; // no changes
    lastSentSig = sig;

    return new Promise((resolve) => {
      const ch = new MessageChannel();
      const done = () => { navigator.serviceWorker.removeEventListener('message', onMsg); resolve(); };
      const onMsg = (ev) => {
        if (ev.data?.type === 'antlab-project-ready') { done(); }
      };
      navigator.serviceWorker.addEventListener('message', onMsg);
      try {
        w.postMessage({
          type: 'antlab-update-project',
          projectId: currentProject.id,
          files: currentProject.files,
          entry: currentProject.entry || 'index.html',
        });
      } catch(_){}
      setTimeout(done, 400); // fallback if the SW doesn't reply
    }).then(() => {
      if (reloadAfter) loadUrl(currentPath || currentProject.entry);
      else scheduleSoftReload();
    });
  }

  // Debounced reload of the iframe after edits (so we don't reload on every keystroke)
  function scheduleSoftReload() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => reload(), 250);
  }

  /* ================= URL / navigation ================= */
  function baseUrl() {
    // e.g. "./__preview__/{projectId}/"
    const scope = swReg?.scope || (location.origin + location.pathname.replace(/[^/]*$/,''));
    return scope.replace(/\/?$/,'/') + '__preview__/' + (currentProject?.id || 'unknown') + '/';
  }

  function fullUrlFor(path) {
    return baseUrl() + (path || '').replace(/^\/+/, '');
  }

  function loadUrl(path) {
    if (!iframeEl) return;
    currentPath = path || currentProject?.entry || 'index.html';
    updateUrlBar(currentPath);
    // Add cache-buster to guarantee latest content
    const bust = 'v=' + Date.now();
    const url = fullUrlFor(currentPath);
    iframeEl.src = url + (url.includes('?') ? '&' : '?') + bust;
  }

  function pushHistory(path) {
    // If we navigated after a back(), truncate the forward history
    if (historyIdx < history.length - 1) history = history.slice(0, historyIdx + 1);
    // Avoid duplicate consecutive entries
    if (history[historyIdx]?.path !== path) {
      history.push({ path });
      historyIdx = history.length - 1;
    }
    updateNavButtons();
  }

  function resetHistory(path) {
    history = [{ path }];
    historyIdx = 0;
    updateNavButtons();
  }

  function goBack() {
    if (historyIdx <= 0) return;
    historyIdx--;
    loadUrl(history[historyIdx].path);
    updateNavButtons();
  }

  function goForward() {
    if (historyIdx >= history.length - 1) return;
    historyIdx++;
    loadUrl(history[historyIdx].path);
    updateNavButtons();
  }

  function reload() {
    // Push files first (in case they've changed since last soft reload)
    pushFiles(false).then(() => loadUrl(currentPath));
  }

  function goHome() {
    const entry = currentProject?.entry || 'index.html';
    navigateTo(entry, true);
  }

  function navigateTo(input, addToHistory) {
    if (!currentProject) return;
    let path = String(input || '').trim();
    if (!path) path = currentProject.entry || 'index.html';

    // Support full URLs by extracting the path segment after __preview__/{id}/
    const marker = '__preview__/' + currentProject.id + '/';
    if (path.includes(marker)) path = path.split(marker)[1] || '';
    // Support "/" leading
    path = path.replace(/^\/+/, '');
    // Strip query/hash for signature but keep for loading? — keep it
    currentPath = path;
    if (addToHistory) pushHistory(path);
    loadUrl(path);
  }

  function updateUrlBar(path) {
    const bar = document.getElementById('urlBar');
    if (bar) bar.value = '/' + (path || '').replace(/^\/+/, '');
  }

  function updateNavButtons() {
    document.getElementById('navBack')?.toggleAttribute('disabled', historyIdx <= 0);
    document.getElementById('navForward')?.toggleAttribute('disabled', historyIdx >= history.length - 1);
  }

  /* ================= srcdoc fallback (no SW) ================= */
  function srcdocFallback() {
    if (!iframeEl || !currentProject) return;
    const html = currentProject.files['index.html']
              || currentProject.files[currentProject.entry]
              || '<h1>No index.html</h1>';
    iframeEl.srcdoc = html;
  }

  /* ================= Iframe message handling ================= */
  function onIframeMessage(event) {
    const d = event.data;
    if (!d || !d.type) return;
    if (d.type === 'console') { appendConsoleLine(d.method, d.args); return; }
    if (d.type === 'antlab-nav') {
      // The iframe navigated to a new URL — reflect in URL bar and history
      const raw = String(d.url || '');
      const marker = '__preview__/' + (currentProject?.id || '') + '/';
      let path = raw;
      if (raw.includes(marker)) path = raw.split(marker)[1] || '';
      path = path.replace(/^\/+/, '');
      // Strip cache buster
      path = path.replace(/([?&])v=\d+(&|$)/, (m, p1, p2) => p2 === '&' ? p1 : '').replace(/[?&]$/, '');
      if (path && path !== currentPath) {
        currentPath = path;
        pushHistory(path);
        updateUrlBar(path);
      } else {
        updateUrlBar(path || currentPath);
      }
    }
  }

  /* ================= Open in new tab ================= */
  function openInNewTab() {
    // Push latest files first, then open the current URL
    pushFiles(false).then(() => {
      const url = fullUrlFor(currentPath || currentProject?.entry || 'index.html');
      window.open(url, '_blank');
    });
  }

  /* ================= Device modes ================= */
  const DEVICES = { desktop:'Desktop', tablet:'Tablet (768px)', mobile:'Mobile (390px)' };
  function setDevice(dev) {
    const frame = document.getElementById('previewFrame');
    document.querySelectorAll('.device-btn').forEach(b => b.classList.toggle('active', b.dataset.device === dev));
    frame.dataset.device = dev;
  }

  /* ================= Console ================= */
  function appendConsoleLine(method, args) {
    const out = document.getElementById('consoleOutput');
    if (!out) return;
    if (consoleLines.length >= MAX_CONSOLE) {
      const old = consoleLines.shift(); old?.parentNode?.removeChild(old);
    }
    const icon = { log:'›', warn:'⚠', error:'✖', info:'ℹ', debug:'·' }[method] || '›';
    const line = document.createElement('div');
    line.className = 'console-line ' + (method === 'debug' ? 'log' : method);
    line.innerHTML = `<span class="console-icon">${icon}</span><span class="console-content">${escHtml((args||[]).join(' '))}</span>`;
    out.querySelector('.console-empty')?.remove();
    out.appendChild(line);
    out.scrollTop = out.scrollHeight;
    consoleLines.push(line);
    if (method === 'error' || method === 'warn') { consoleCount++; updateBadge(); }
  }
  function updateBadge() {
    const b = document.getElementById('consoleBadge'); if (!b) return;
    if (consoleCount > 0 && !isConsoleOpen) { b.textContent = consoleCount > 99 ? '99+' : consoleCount; b.classList.remove('hidden'); }
    else b.classList.add('hidden');
  }
  function clearConsole() {
    const out = document.getElementById('consoleOutput');
    if (out) out.innerHTML = '<p class="console-empty">No console output yet.</p>';
    consoleLines = []; consoleCount = 0; updateBadge();
  }
  function toggleConsole() {
    const p = document.getElementById('consolePanel'); if (!p) return;
    isConsoleOpen = !isConsoleOpen;
    p.classList.toggle('hidden', !isConsoleOpen);
    if (isConsoleOpen) { consoleCount = 0; updateBadge(); }
  }
  function openConsole() {
    const p = document.getElementById('consolePanel'); if (!p) return;
    isConsoleOpen = true; p.classList.remove('hidden'); consoleCount = 0; updateBadge();
  }

  /* ================= Util ================= */
  function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  /* ================= Public API ================= */
  return {
    init,
    setProject,
    updateFiles,
    reload,
    navigateTo,
    openInNewTab,
    setDevice,
    clearConsole,
    toggleConsole,
    openConsole,
    isSWReady: () => swReady,
  };
})();
