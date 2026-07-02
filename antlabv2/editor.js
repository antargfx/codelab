/**
 * editor.js — AntLab v2
 * Fully dynamic multi-file CodeMirror editor.
 * Every tab is closeable and renamable. Any file type (html, css, js, json,
 * svg, md, txt, xml, wasm-text, etc.) can be edited.
 *
 * Public API is documented at the bottom of this file.
 */

const Editor = (() => {

  /* ================= State ================= */
  //  files[path]   = { path, content }
  //  editors[path] = CodeMirror instance (lazily created on first activation)
  //  openTabs      = [path, ...]  (order matters — the tab bar)
  const files    = {};
  const editors  = {};
  let openTabs   = [];
  let activePath = null;

  let onChangeCb = null;
  let onSaveCb   = null;
  let onLayoutCb = null;    // fires whenever tabs/files change (so app can persist)
  let saveTimer  = null;
  let isDark     = false;

  /* ================= CodeMirror config ================= */
  const BASE_CONFIG = {
    lineNumbers: true,
    matchBrackets: true,
    autoCloseBrackets: true,
    autoCloseTags: true,
    styleActiveLine: true,
    indentUnit: 2,
    tabSize: 2,
    lineWrapping: false,
    foldGutter: true,
    gutters: ['CodeMirror-linenumbers','CodeMirror-foldgutter'],
    extraKeys: {
      'Tab':          (cm) => cm.execCommand('indentMore'),
      'Shift-Tab':    (cm) => cm.execCommand('indentLess'),
      'Ctrl-/':       (cm) => cm.execCommand('toggleComment'),
      'Cmd-/':        (cm) => cm.execCommand('toggleComment'),
      'Ctrl-S':       () => triggerSave(),
      'Cmd-S':        () => triggerSave(),
      'Ctrl-F':       () => openFindReplace(true),
      'Cmd-F':        () => openFindReplace(true),
      'Ctrl-H':       () => openFindReplace(true),
      'Cmd-H':        () => openFindReplace(true),
    },
    scrollbarStyle: 'native',
    inputStyle: 'contenteditable',
  };

  function extOf(path) { return (path.split('.').pop() || '').toLowerCase(); }

  function modeForPath(path) {
    const e = extOf(path);
    if (e === 'html' || e === 'htm' || e === 'xml' || e === 'svg') return 'htmlmixed';
    if (e === 'css') return 'css';
    if (e === 'json') return { name:'javascript', json:true };
    if (e === 'js' || e === 'mjs') return { name:'javascript', json:false };
    if (e === 'md' || e === 'txt') return null; // plain text
    return { name:'javascript' };
  }

  function langLabel(path) {
    const e = extOf(path);
    const map = { html:'HTML', htm:'HTML', css:'CSS', js:'JavaScript', mjs:'JavaScript',
                  json:'JSON', svg:'SVG', xml:'XML', md:'Markdown', txt:'Text' };
    return map[e] || e.toUpperCase() || 'Plain';
  }

  function iconDotColor(path) {
    const e = extOf(path);
    return {
      html:'#e44d26', htm:'#e44d26',
      css:'#264de4',
      js:'#f0db4f', mjs:'#f0db4f',
      json:'#8e44ad',
      svg:'#f97316',
      md:'#0ea5e9', txt:'#6b7280',
    }[e] || '#10b981';
  }

  const themeFor = (dark) => dark ? 'dracula' : 'eclipse';

  /* ================= Editor pane management ================= */
  function ensureEditorPane(path) {
    const area = document.getElementById('editorArea');
    if (!area) return null;
    const paneId = 'editor-pane-' + encodeId(path);
    let pane = document.getElementById(paneId);
    if (!pane) {
      pane = document.createElement('div');
      pane.id = paneId;
      pane.className = 'editor-pane';
      area.appendChild(pane);
    }
    if (!editors[path]) {
      const cm = CodeMirror(pane, {
        ...BASE_CONFIG,
        mode: modeForPath(path),
        theme: themeFor(isDark),
        value: files[path]?.content || '',
      });
      cm.on('cursorActivity', () => { if (path === activePath) updateStatusBar(cm); });
      cm.on('change', () => {
        files[path].content = cm.getValue();
        updateSaveStatus('saving');
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          if (onChangeCb) onChangeCb(getAllFiles());
          triggerSave();
        }, 500);
      });
      editors[path] = cm;
    }
    return pane;
  }

  function encodeId(p) { return p.replace(/[^a-zA-Z0-9_-]/g, '_'); }

  /* ================= Tab bar ================= */
  function renderTabBar() {
    const bar = document.getElementById('fileTabs');
    if (!bar) return;
    bar.innerHTML = '';

    openTabs.forEach((path) => {
      const isActive = path === activePath;
      const tab = document.createElement('button');
      tab.className = 'file-tab' + (isActive ? ' active' : '');
      tab.dataset.path = path;
      tab.title = path;

      const dot = `<span class="tab-dot" style="background:${iconDotColor(path)};${extOf(path)==='js' ? 'outline:1px solid rgba(0,0,0,.12);' : ''}"></span>`;
      const badge = path === (currentProjectEntry() || 'index.html')
        ? '<span class="tab-home" title="Home file">🏠</span>' : '';
      tab.innerHTML = `${dot}<span class="tab-name">${escHtml(path)}</span>${badge}`;

      // Close button — on EVERY tab now (v2 makes all tabs closeable)
      const x = document.createElement('button');
      x.className = 'tab-close';
      x.title = 'Close tab';
      x.innerHTML = '×';
      x.addEventListener('click', (e) => { e.stopPropagation(); closeTab(path); });
      tab.appendChild(x);

      tab.addEventListener('click', () => switchTab(path));
      // Middle-click to close
      tab.addEventListener('mousedown', (e) => { if (e.button === 1) { e.preventDefault(); closeTab(path); } });
      // Double-click to rename
      tab.addEventListener('dblclick', () => promptRename(path));
      bar.appendChild(tab);
    });

    // "+" new file
    const add = document.createElement('button');
    add.className = 'tab-add-btn';
    add.title = 'New file';
    add.textContent = '+';
    add.addEventListener('click', promptNewFile);
    bar.appendChild(add);

    // "Files…" popup — lets user open a file that isn't currently a tab
    const more = document.createElement('button');
    more.className = 'tab-more-btn';
    more.title = 'All files in project';
    more.textContent = '☰';
    more.addEventListener('click', showAllFilesMenu);
    bar.appendChild(more);
  }

  // Access current entry — set by app via setEntryGetter
  let _entryGetter = () => 'index.html';
  function setEntryGetter(fn) { _entryGetter = fn || (() => 'index.html'); }
  function currentProjectEntry() { try { return _entryGetter(); } catch(_) { return 'index.html'; } }

  /* ================= Switch / open / close ================= */
  function switchTab(path) {
    if (!files[path]) return;
    if (!openTabs.includes(path)) openTabs.push(path);
    activePath = path;

    ensureEditorPane(path);

    // Show/hide panes
    document.querySelectorAll('.editor-pane').forEach(p => {
      p.classList.toggle('active', p.id === 'editor-pane-' + encodeId(path));
    });

    renderTabBar();
    document.getElementById('statusLang').textContent = langLabel(path);

    if (fr.open) { _clearMarks(); fr.matches=[]; fr.currentIdx=-1; fr.overlays=[]; setTimeout(_doSearch, 50); }
    requestAnimationFrame(() => { editors[path]?.refresh(); editors[path]?.focus(); if (editors[path]) updateStatusBar(editors[path]); });
    if (onLayoutCb) onLayoutCb();
  }

  function openFile(path, activate=true) {
    if (!files[path]) return;
    if (!openTabs.includes(path)) openTabs.push(path);
    if (activate) switchTab(path); else renderTabBar();
  }

  function closeTab(path) {
    if (!openTabs.includes(path)) return;
    // Confirm before closing an unsaved file? not needed - autosave.
    const wasActive = path === activePath;
    openTabs = openTabs.filter(p => p !== path);
    // Dispose editor + pane
    if (editors[path]) {
      const wrapper = editors[path].getWrapperElement();
      wrapper.parentNode?.remove();
      delete editors[path];
    }
    if (wasActive) {
      const next = openTabs[openTabs.length - 1] || null;
      activePath = null;
      if (next) switchTab(next);
      else showEmptyState();
    } else {
      renderTabBar();
    }
    if (onLayoutCb) onLayoutCb();
  }

  function showEmptyState() {
    const area = document.getElementById('editorArea');
    if (!area) return;
    let empty = document.getElementById('editorEmptyState');
    if (!empty) {
      empty = document.createElement('div');
      empty.id = 'editorEmptyState';
      empty.className = 'editor-empty-state';
      empty.innerHTML = `
        <div class="ees-inner">
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <polyline points="14 2 14 8 20 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <h3>No file open</h3>
          <p>Click <b>+</b> to create a new file, or <b>☰</b> to open one from this project.</p>
        </div>`;
      area.appendChild(empty);
    }
    empty.classList.remove('hidden');
    document.getElementById('statusLang').textContent = '—';
    document.getElementById('statusCursor').textContent = '';
    renderTabBar();
  }

  function hideEmptyState() {
    const e = document.getElementById('editorEmptyState');
    if (e) e.classList.add('hidden');
  }

  /* ================= Add / rename / delete files ================= */
  function addFile(path, content='', activate=true) {
    path = normalisePath(path);
    if (!path) return null;
    if (!files[path]) files[path] = { path, content };
    else files[path].content = content;
    hideEmptyState();
    if (activate) openFile(path, true); else renderTabBar();
    if (onLayoutCb) onLayoutCb();
    return path;
  }

  function renameFile(oldPath, newPath) {
    oldPath = normalisePath(oldPath); newPath = normalisePath(newPath);
    if (!oldPath || !newPath || oldPath === newPath) return false;
    if (!files[oldPath]) return false;
    if (files[newPath]) { alert('A file named "' + newPath + '" already exists.'); return false; }

    files[newPath] = { path:newPath, content:files[oldPath].content };
    delete files[oldPath];

    // Move editor if present
    if (editors[oldPath]) {
      const cm = editors[oldPath];
      const val = cm.getValue();
      // Re-create editor because mode may change with extension
      const wrap = cm.getWrapperElement();
      wrap.parentNode?.remove();
      delete editors[oldPath];
      files[newPath].content = val;
    }

    // Update openTabs
    openTabs = openTabs.map(p => p === oldPath ? newPath : p);
    if (activePath === oldPath) activePath = newPath;

    // Recreate editor pane if this was open
    if (openTabs.includes(newPath)) {
      ensureEditorPane(newPath);
      if (activePath === newPath) switchTab(newPath);
    }
    renderTabBar();
    if (onRenameCb) onRenameCb(oldPath, newPath);
    if (onChangeCb) onChangeCb(getAllFiles());
    triggerSave();
    if (onLayoutCb) onLayoutCb();
    return true;
  }

  function deleteFile(path) {
    if (!files[path]) return;
    if (!confirm('Delete "' + path + '" permanently?')) return;
    if (openTabs.includes(path)) closeTab(path);
    delete files[path];
    if (onChangeCb) onChangeCb(getAllFiles());
    triggerSave();
    if (onLayoutCb) onLayoutCb();
  }

  function normalisePath(p) {
    if (!p) return '';
    return p.trim().replace(/^\/+/,'').replace(/\\/g,'/');
  }

  /* ================= Prompts ================= */
  function promptNewFile() {
    const name = window.prompt('New file (path can include folders like "pages/about.html"):', 'newfile.html');
    if (!name) return;
    const p = normalisePath(name);
    if (!p) return;
    if (files[p]) { openFile(p); return; }
    addFile(p, defaultTemplateFor(p), true);
  }

  function promptRename(path) {
    const nn = window.prompt('Rename "' + path + '" to:', path);
    if (!nn) return;
    renameFile(path, nn);
  }

  function defaultTemplateFor(path) {
    const e = extOf(path);
    if (e === 'html' || e === 'htm') return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${path}</title>
</head>
<body>
  <h1>${path}</h1>
</body>
</html>`;
    if (e === 'css') return `/* ${path} */\n\nbody {\n  \n}\n`;
    if (e === 'js' || e === 'mjs') return `// ${path}\n\nconsole.log('${path} loaded');\n`;
    if (e === 'json') return `{\n  \n}\n`;
    if (e === 'svg') return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">\n  \n</svg>\n`;
    return '';
  }

  /* ================= All-files menu ================= */
  function showAllFilesMenu(e) {
    // Toggle if already open
    const existing = document.getElementById('allFilesMenu');
    if (existing) { existing.remove(); return; }

    const menu = document.createElement('div');
    menu.id = 'allFilesMenu';
    menu.className = 'download-menu';
    menu.style.position = 'absolute';
    menu.style.zIndex = 500;

    const rect = e.currentTarget.getBoundingClientRect();
    menu.style.top  = (rect.bottom + 4) + 'px';
    menu.style.left = Math.max(8, rect.right - 220) + 'px';
    menu.style.minWidth = '220px';
    menu.style.maxHeight = '340px';
    menu.style.overflowY = 'auto';

    const entryPath = currentProjectEntry();
    Object.keys(files).sort().forEach(path => {
      const btn = document.createElement('button');
      btn.className = 'download-menu-item';
      const dot = `<span class="dm-dot" style="background:${iconDotColor(path)}"></span>`;
      const homeMark = path === entryPath ? ' 🏠' : '';
      const openMark = openTabs.includes(path) ? '<span style="font-size:10px;color:var(--text-muted);margin-left:auto;">open</span>' : '';
      btn.innerHTML = `${dot}<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(path)}${homeMark}</span>${openMark}`;
      btn.addEventListener('click', () => { openFile(path, true); menu.remove(); });

      // Right-click / long-press: rename or delete
      btn.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        const action = window.prompt('Type "r" to rename, "d" to delete, or "h" to set as Home:', '');
        if (action === 'r') promptRename(path);
        else if (action === 'd') deleteFile(path);
        else if (action === 'h' && onSetHomeCb) onSetHomeCb(path);
        menu.remove();
      });
      menu.appendChild(btn);
    });

    if (Object.keys(files).length === 0) {
      menu.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:12px;text-align:center;">No files yet.</div>';
    }

    document.body.appendChild(menu);
    const outside = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', outside); } };
    setTimeout(() => document.addEventListener('mousedown', outside), 0);
  }

  // Callback for "set as home"
  let onSetHomeCb = null;
  function setOnSetHome(cb) { onSetHomeCb = cb; }

  // Callback for rename — the app can update project.entry if the entry file was renamed
  let onRenameCb = null;
  function setOnRename(cb) { onRenameCb = cb; }

  /* ================= Bulk load / dump ================= */
  function setAll(project) {
    // Wipe editors and files
    Object.keys(editors).forEach(p => {
      const w = editors[p].getWrapperElement();
      w.parentNode?.remove();
    });
    Object.keys(editors).forEach(p => delete editors[p]);
    Object.keys(files).forEach(p => delete files[p]);

    // Load project files
    const projFiles = project.files || {};
    Object.keys(projFiles).forEach(p => { files[p] = { path:p, content: String(projFiles[p]) }; });

    // Restore tab layout
    openTabs = (project.openTabs || []).filter(p => files[p]);
    if (openTabs.length === 0) {
      // Open the first three files as a sensible default
      openTabs = Object.keys(files).slice(0, 3);
    }
    activePath = project.activeTab && files[project.activeTab] ? project.activeTab
                  : (openTabs[0] || null);

    if (activePath) {
      // Prepare pane
      ensureEditorPane(activePath);
      switchTab(activePath);
      hideEmptyState();
    } else {
      renderTabBar();
      showEmptyState();
    }
    updateSaveStatus('saved');
  }

  function getAllFiles() {
    const out = {};
    Object.keys(files).forEach(p => {
      // Prefer live editor value if this file has an editor
      out[p] = editors[p] ? editors[p].getValue() : files[p].content;
    });
    return out;
  }

  function getLayout() {
    return { openTabs: [...openTabs], activeTab: activePath };
  }

  /* ================= Status bar ================= */
  function updateStatusBar(cm) {
    const c = cm.getCursor();
    const el = document.getElementById('statusCursor');
    if (el) el.textContent = `Ln ${c.line + 1}, Col ${c.ch + 1}`;
  }

  function updateSaveStatus(state) {
    const el = document.getElementById('saveStatus');
    if (!el) return;
    if (state === 'saving') { el.textContent = 'Saving…'; el.classList.add('saving'); }
    else { el.textContent = 'Saved ✓'; el.classList.remove('saving'); }
  }

  function triggerSave() {
    updateSaveStatus('saved');
    if (onSaveCb) onSaveCb(getAllFiles());
  }

  /* ================= Undo / Redo / Select All ================= */
  function undo()      { editors[activePath]?.execCommand('undo');      editors[activePath]?.focus(); }
  function redo()      { editors[activePath]?.execCommand('redo');      editors[activePath]?.focus(); }
  function selectAll() { editors[activePath]?.execCommand('selectAll'); editors[activePath]?.focus(); }

  /* ================= Theme ================= */
  function setTheme(dark) {
    isDark = dark;
    const t = themeFor(dark);
    Object.values(editors).forEach(cm => cm.setOption('theme', t));
  }

  function refreshAll() { Object.values(editors).forEach(cm => cm.refresh()); }

  /* ================= Init ================= */
  function init({ onChange, onSave, onLayoutChange, entryGetter, onSetHome, onRename } = {}) {
    onChangeCb = onChange; onSaveCb = onSave; onLayoutCb = onLayoutChange;
    setEntryGetter(entryGetter);
    setOnSetHome(onSetHome);
    setOnRename(onRename);
    initFindReplace();
  }

  /* ================= Find & Replace (scoped to active) ================= */
  const fr = { open:false, query:'', caseSensitive:false, useRegex:false, wholeWord:false,
               matches:[], currentIdx:-1, overlays:[], _currentMark:null };

  function openFindReplace(withSelection) {
    fr.open = true;
    const panel = document.getElementById('findReplacePanel');
    if (panel) panel.classList.add('open');
    const cm = editors[activePath];
    if (cm && withSelection) {
      const sel = cm.getSelection();
      if (sel && sel.length < 200) { const i = document.getElementById('frFind'); if (i) { i.value = sel; fr.query = sel; } }
    }
    setTimeout(() => { document.getElementById('frFind')?.focus(); document.getElementById('frFind')?.select(); _doSearch(); }, 30);
  }
  function closeFindReplace() {
    fr.open = false;
    document.getElementById('findReplacePanel')?.classList.remove('open');
    _clearMarks(); _updateMatchCount(null);
    editors[activePath]?.focus();
  }
  function _buildRegex(q) {
    if (!q) return null;
    try {
      let p = fr.useRegex ? q : q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      if (fr.wholeWord && !fr.useRegex) p = '\\b'+p+'\\b';
      return new RegExp(p, fr.caseSensitive ? 'g' : 'gi');
    } catch(e) { return null; }
  }
  function _doSearch() {
    const cm = editors[activePath]; if (!cm) return;
    _clearMarks(); fr.matches=[]; fr.currentIdx=-1;
    const q = (document.getElementById('frFind')?.value || '').trim();
    fr.query = q;
    const inp = document.getElementById('frFind');
    if (!q) { _updateMatchCount(null); inp?.classList.remove('no-match','has-match'); return; }
    const rx = _buildRegex(q);
    if (!rx) { inp?.classList.add('no-match'); _updateMatchCount(null); return; }
    cm.getValue().split('\n').forEach((line, ln) => {
      rx.lastIndex = 0; let m;
      while ((m = rx.exec(line)) !== null) {
        fr.matches.push({from:{line:ln,ch:m.index}, to:{line:ln,ch:m.index+m[0].length}});
        if (rx.lastIndex === m.index) rx.lastIndex++;
      }
    });
    fr.overlays = fr.matches.map(m => cm.markText(m.from, m.to, {className:'fr-highlight'}));
    if (fr.matches.length) {
      const cur = cm.getCursor();
      let best = 0;
      for (let i=0;i<fr.matches.length;i++) {
        const mm = fr.matches[i];
        if (mm.from.line > cur.line || (mm.from.line===cur.line && mm.from.ch>=cur.ch)) { best=i; break; }
        best = i;
      }
      fr.currentIdx = best; _highlightCurrent();
    }
    _updateMatchCount(fr.matches.length);
    if (inp) { inp.classList.toggle('no-match', fr.matches.length===0); inp.classList.toggle('has-match', fr.matches.length>0); }
  }
  function _clearMarks() { fr.overlays.forEach(m => { try { m.clear(); } catch(_){}}); fr.overlays=[]; if (fr._currentMark) { try { fr._currentMark.clear(); } catch(_){}; fr._currentMark=null; } }
  function _highlightCurrent() {
    if (fr._currentMark) { try { fr._currentMark.clear(); } catch(_){}; fr._currentMark=null; }
    if (fr.currentIdx < 0 || fr.currentIdx >= fr.matches.length) return;
    const cm = editors[activePath]; const m = fr.matches[fr.currentIdx];
    fr._currentMark = cm.markText(m.from, m.to, {className:'fr-highlight-current'});
    cm.scrollIntoView({from:m.from, to:m.to}, 80); cm.setSelection(m.from, m.to);
  }
  function findNext() { if (!fr.matches.length) { _doSearch(); return; } fr.currentIdx = (fr.currentIdx+1) % fr.matches.length; _highlightCurrent(); _updateMatchCount(fr.matches.length); }
  function findPrev() { if (!fr.matches.length) { _doSearch(); return; } fr.currentIdx = (fr.currentIdx-1+fr.matches.length) % fr.matches.length; _highlightCurrent(); _updateMatchCount(fr.matches.length); }
  function replaceOne() {
    const cm = editors[activePath]; if (!cm || !fr.matches.length) return;
    if (fr.currentIdx < 0) fr.currentIdx = 0;
    const m = fr.matches[fr.currentIdx];
    const val = document.getElementById('frReplace')?.value ?? '';
    let rep = val;
    if (fr.useRegex) { const rx = _buildRegex(fr.query); if (rx) { const src = cm.getRange(m.from,m.to); rx.lastIndex=0; rep = src.replace(rx, val); } }
    cm.replaceRange(rep, m.from, m.to);
    setTimeout(_doSearch, 10);
  }
  function replaceAll() {
    const cm = editors[activePath]; if (!cm || !fr.matches.length) return;
    const val = document.getElementById('frReplace')?.value ?? '';
    const rx = _buildRegex(fr.query); if (!rx) return;
    const n = fr.matches.length;
    try { cm.setValue(cm.getValue().replace(rx, val)); } catch(_){ return; }
    _clearMarks(); fr.matches=[]; fr.currentIdx=-1; _updateMatchCount(0);
    document.getElementById('frFind')?.classList.remove('no-match','has-match');
    _toast('Replaced ' + n + ' occurrence' + (n!==1?'s':''));
  }
  function _updateMatchCount(t) { const el = document.getElementById('frMatchCount'); if (!el) return;
    if (t===null) { el.textContent=''; return; }
    if (t===0)    { el.textContent='No results'; return; }
    el.textContent = (fr.currentIdx+1) + ' / ' + t;
  }
  function _toast(msg) {
    const t = document.createElement('div'); t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;padding:8px 18px;border-radius:8px;font-size:13px;font-weight:600;z-index:9000;box-shadow:0 4px 16px rgba(0,0,0,.2);pointer-events:none;transition:opacity .3s;';
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity='0'; setTimeout(() => t.remove(), 350); }, 1800);
  }
  function initFindReplace() {
    const F = document.getElementById('frFind'); if (!F) return;
    const R = document.getElementById('frReplace');
    F.addEventListener('input', _doSearch);
    F.addEventListener('keydown', (e) => {
      if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); findNext(); }
      else if (e.key==='Enter' && e.shiftKey) { e.preventDefault(); findPrev(); }
      else if (e.key==='Escape') { e.preventDefault(); closeFindReplace(); }
      else if (e.key==='Tab')    { e.preventDefault(); R?.focus(); }
    });
    R?.addEventListener('keydown', (e) => {
      if (e.key==='Enter') { e.preventDefault(); replaceOne(); }
      else if (e.key==='Escape') { e.preventDefault(); closeFindReplace(); }
      else if (e.key==='Tab' && e.shiftKey) { e.preventDefault(); F.focus(); }
    });
    document.getElementById('frNext')?.addEventListener('click', findNext);
    document.getElementById('frPrev')?.addEventListener('click', findPrev);
    document.getElementById('frClose')?.addEventListener('click', closeFindReplace);
    document.getElementById('frReplaceOne')?.addEventListener('click', replaceOne);
    document.getElementById('frReplaceAll')?.addEventListener('click', replaceAll);
    const tog = (btn, key) => { fr[key] = !fr[key]; btn.classList.toggle('active', fr[key]); _doSearch(); };
    document.getElementById('frCaseSensitive')?.addEventListener('click', (e) => tog(e.currentTarget,'caseSensitive'));
    document.getElementById('frRegex')?.addEventListener('click', (e) => tog(e.currentTarget,'useRegex'));
    document.getElementById('frWholeWord')?.addEventListener('click', (e) => tog(e.currentTarget,'wholeWord'));
  }

  /* ================= Util ================= */
  function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  /* ================= Public API ================= */
  return {
    init,
    setAll,
    getAllFiles,       // returns { path: content, ... }
    getLayout,         // returns { openTabs, activeTab }
    openFile,
    switchTab,
    closeTab,
    addFile,
    renameFile,
    deleteFile,
    promptNewFile,
    promptRename,
    getActivePath: () => activePath,
    getFileNames: () => Object.keys(files),
    setTheme,
    refreshAll,
    undo, redo, selectAll,
    openFindReplace,
    closeFindReplace,
    updateSaveStatus,
  };
})();
