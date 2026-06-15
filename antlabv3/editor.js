/**
 * editor.js — AntLab IDE
 * Dynamic multi-tab CodeMirror editor.
 * Supports unlimited CSS/JS/HTML files, each with its own named tab.
 * Core files: index.html, style.css, script.js (always present, not closeable)
 * Extra files: any additional .css or .js file uploaded — get their own tab.
 */

const Editor = (() => {

  /* =============================================
     STATE
     ============================================= */
  // editors[fileId] = CodeMirror instance
  // fileId = 'html' | 'css' | 'js' | filename (e.g. 'utils.js', 'theme.css')
  const editors   = {};
  // files[fileId] = { id, name, type, content }
  const files     = {};
  let activeFile  = 'html';
  let saveTimer   = null;
  let onChangeCallback = null;
  let onSaveCallback   = null;
  let isDark      = false;

  // Core (non-closeable) file IDs
  const CORE_IDS  = ['html', 'css', 'js'];
  const CORE_INFO = {
    html: { name: 'index.html', type: 'html' },
    css:  { name: 'style.css',  type: 'css'  },
    js:   { name: 'script.js',  type: 'js'   },
  };

  /* =============================================
     CODEMIRROR CONFIG
     ============================================= */
  const BASE_CONFIG = {
    lineNumbers:       true,
    matchBrackets:     true,
    autoCloseBrackets: true,
    autoCloseTags:     true,
    styleActiveLine:   true,
    indentUnit:        2,
    tabSize:           2,
    indentWithTabs:    false,
    lineWrapping:      false,
    foldGutter:        true,
    gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
    extraKeys: {
      'Tab':          (cm) => cm.execCommand('indentMore'),
      'Shift-Tab':    (cm) => cm.execCommand('indentLess'),
      'Ctrl-/':       (cm) => cm.execCommand('toggleComment'),
      'Cmd-/':        (cm) => cm.execCommand('toggleComment'),
      'Ctrl-S':       ()   => triggerSave(),
      'Cmd-S':        ()   => triggerSave(),
      'Ctrl-Z':       (cm) => cm.execCommand('undo'),
      'Cmd-Z':        (cm) => cm.execCommand('undo'),
      'Ctrl-Y':       (cm) => cm.execCommand('redo'),
      'Ctrl-Shift-Z': (cm) => cm.execCommand('redo'),
      'Cmd-Shift-Z':  (cm) => cm.execCommand('redo'),
      'Ctrl-A':       (cm) => cm.execCommand('selectAll'),
      'Cmd-A':        (cm) => cm.execCommand('selectAll'),
      'Ctrl-F':       ()   => openFindReplace(true),
      'Cmd-F':        ()   => openFindReplace(true),
      'Ctrl-H':       ()   => openFindReplace(true),
      'Cmd-H':        ()   => openFindReplace(true),
    },
    scrollbarStyle: 'native',
    inputStyle: 'contenteditable',
  };

  function modeForType(type) {
    if (type === 'html') return 'htmlmixed';
    if (type === 'css')  return 'css';
    return { name: 'javascript', json: false };
  }

  function themeForDark(dark) { return dark ? 'dracula' : 'eclipse'; }

  /* =============================================
     CREATE / MOUNT EDITOR PANE
     ============================================= */
  function createEditorPane(fileId, fileType, value) {
    const area = document.getElementById('editorArea');
    if (!area) return null;

    // Reuse existing pane if present
    let pane = document.getElementById('editor-' + fileId);
    if (!pane) {
      pane = document.createElement('div');
      pane.id        = 'editor-' + fileId;
      pane.className = 'editor-pane';
      area.appendChild(pane);
    }

    if (!editors[fileId]) {
      const cm = CodeMirror(pane, {
        ...BASE_CONFIG,
        mode:  modeForType(fileType),
        theme: themeForDark(isDark),
        value: value || '',
      });

      cm.on('cursorActivity', () => {
        if (fileId === activeFile) updateStatusBar(cm);
      });

      cm.on('change', () => {
        updateSaveStatus('saving');
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          if (onChangeCallback) onChangeCallback(getAllFiles());
          triggerSave();
        }, 800);
      });

      editors[fileId] = cm;
    } else {
      // Pane already exists — just update value
      const cm = editors[fileId];
      cm.setValue(value || '');
      cm.clearHistory();
    }

    return editors[fileId];
  }

  /* =============================================
     TAB BAR — render all tabs dynamically
     ============================================= */
  const DOT_COLORS = { html: '#e44d26', css: '#264de4', js: '#f0db4f' };

  function dotColor(type) { return DOT_COLORS[type] || '#10b981'; }

  function renderTabBar() {
    const tabBar = document.getElementById('fileTabs');
    if (!tabBar) return;
    tabBar.innerHTML = '';

    Object.values(files).forEach((f) => {
      const isCore   = CORE_IDS.includes(f.id);
      const isActive = f.id === activeFile;

      const tab = document.createElement('button');
      tab.className  = 'file-tab' + (isActive ? ' active' : '');
      tab.dataset.file = f.id;
      tab.title      = f.name;

      const dotStyle = `background:${dotColor(f.type)};${f.type === 'js' ? 'outline:1px solid rgba(0,0,0,.12);' : ''}`;
      tab.innerHTML  = `<span class="tab-dot" style="${dotStyle}"></span><span class="tab-name">${escHtml(f.name)}</span>`;

      // Close button on non-core tabs
      if (!isCore) {
        const x = document.createElement('button');
        x.className = 'tab-close';
        x.title     = 'Close tab';
        x.innerHTML = '×';
        x.addEventListener('click', (e) => { e.stopPropagation(); closeTab(f.id); });
        tab.appendChild(x);
      }

      tab.addEventListener('click', () => switchTab(f.id));
      tabBar.appendChild(tab);
    });

    // + New file button
    const addBtn = document.createElement('button');
    addBtn.className = 'tab-add-btn';
    addBtn.title     = 'Add new file';
    addBtn.textContent = '+';
    addBtn.addEventListener('click', promptNewFile);
    tabBar.appendChild(addBtn);
  }

  /* =============================================
     SWITCH TAB
     ============================================= */
  function switchTab(fileId) {
    if (!editors[fileId] && !files[fileId]) return;
    activeFile = fileId;

    // Show/hide panes
    document.querySelectorAll('.editor-pane').forEach((p) => {
      p.classList.toggle('active', p.id === 'editor-' + fileId);
    });

    // Re-render tab bar active state
    document.querySelectorAll('.file-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.file === fileId);
    });

    // Status bar language
    const f = files[fileId];
    const langMap = { html: 'HTML', css: 'CSS', js: 'JavaScript' };
    document.getElementById('statusLang').textContent =
      langMap[f?.type] || (f?.type || fileId).toUpperCase();

    // Find & replace: re-search on new tab
    if (fr.open) {
      _clearMarks();
      fr.matches = [];
      fr.currentIdx = -1;
      fr.overlays = [];
      setTimeout(() => _doSearch(), 60);
    }

    requestAnimationFrame(() => {
      editors[fileId]?.refresh();
      editors[fileId]?.focus();
      if (editors[fileId]) updateStatusBar(editors[fileId]);
    });
  }

  /* =============================================
     ADD FILE (from upload or new-file prompt)
     ============================================= */
  function addFile(name, type, content, activate) {
    // Normalise: map .htm → html, .mjs → js, etc.
    const ext = name.split('.').pop().toLowerCase();
    const normType = ext === 'htm' ? 'html'
      : ext === 'mjs' ? 'js'
      : (['html','css','js'].includes(ext) ? ext : type || 'js');

    // For core files, use their fixed IDs so we don't duplicate
    let fileId;
    if (normType === 'html' && name.match(/^index\.(html|htm)$/i)) fileId = 'html';
    else if (normType === 'css' && name.match(/^style(s)?\.css$/i)) fileId = 'css';
    else if (normType === 'js'  && name.match(/^(script|app|main)\.js$/i)) fileId = 'js';
    else fileId = name; // use exact filename as ID for extra files

    files[fileId] = { id: fileId, name, type: normType, content: content || '' };
    createEditorPane(fileId, normType, content || '');
    renderTabBar();
    if (activate !== false) switchTab(fileId);
    return fileId;
  }

  /* =============================================
     CLOSE EXTRA TAB
     ============================================= */
  function closeTab(fileId) {
    if (CORE_IDS.includes(fileId)) return; // protect core tabs
    const pane = document.getElementById('editor-' + fileId);
    if (pane) pane.remove();
    if (editors[fileId]) { editors[fileId].toTextArea?.(); delete editors[fileId]; }
    delete files[fileId];

    // Switch away if this was active
    if (activeFile === fileId) {
      const remaining = Object.keys(files);
      switchTab(remaining[remaining.length - 1] || 'html');
    }
    renderTabBar();

    // Notify change
    if (onChangeCallback) onChangeCallback(getAllFiles());
    triggerSave();
  }

  /* =============================================
     PROMPT NEW FILE
     ============================================= */
  function promptNewFile() {
    const name = window.prompt('New file name (e.g. utils.js or theme.css):');
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    const ext = trimmed.split('.').pop().toLowerCase();
    if (!['html','htm','css','js'].includes(ext)) {
      alert('Supported types: .html, .css, .js');
      return;
    }
    addFile(trimmed, ext === 'htm' ? 'html' : ext, '', true);
    if (onChangeCallback) onChangeCallback(getAllFiles());
    triggerSave();
  }

  /* =============================================
     INIT
     ============================================= */
  function init(onChange, onSave) {
    onChangeCallback = onChange;
    onSaveCallback   = onSave;

    // Register core file slots (panes already in HTML)
    CORE_IDS.forEach((id) => {
      const info = CORE_INFO[id];
      files[id] = { id, name: info.name, type: info.type, content: '' };
      const pane = document.getElementById('editor-' + id);
      if (pane) {
        const cm = CodeMirror(pane, {
          ...BASE_CONFIG,
          mode:  modeForType(info.type),
          theme: themeForDark(isDark),
          value: '',
        });
        cm.on('cursorActivity', () => { if (id === activeFile) updateStatusBar(cm); });
        cm.on('change', () => {
          updateSaveStatus('saving');
          clearTimeout(saveTimer);
          saveTimer = setTimeout(() => {
            if (onChangeCallback) onChangeCallback(getAllFiles());
            triggerSave();
          }, 800);
        });
        editors[id] = cm;
      }
    });

    renderTabBar();
    updateStatusBar(editors['html']);
    initFindReplace();
  }

  /* =============================================
     STATUS BAR
     ============================================= */
  function updateStatusBar(cm) {
    const c = cm.getCursor();
    const el = document.getElementById('statusCursor');
    if (el) el.textContent = `Ln ${c.line + 1}, Col ${c.ch + 1}`;
  }

  function updateSaveStatus(status) {
    const el = document.getElementById('saveStatus');
    if (!el) return;
    if (status === 'saving') { el.textContent = 'Saving…'; el.classList.add('saving'); }
    else { el.textContent = 'Saved ✓'; el.classList.remove('saving'); }
  }

  function triggerSave() {
    updateSaveStatus('saved');
    if (onSaveCallback) onSaveCallback(getAllFiles());
  }

  /* =============================================
     GET / SET — all files
     ============================================= */
  function getAllFiles() {
    // Returns { html, css, js, extraFiles: [{name, type, content}] }
    const result = { html: '', css: '', js: '', extraFiles: [] };
    Object.values(files).forEach((f) => {
      const val = editors[f.id]?.getValue() || f.content || '';
      if (f.id === 'html') result.html = val;
      else if (f.id === 'css') result.css = val;
      else if (f.id === 'js')  result.js  = val;
      else result.extraFiles.push({ name: f.name, type: f.type, content: val });
    });
    return result;
  }

  // Legacy compat — returns {html, css, js} only
  function getAll() {
    const all = getAllFiles();
    return { html: all.html, css: all.css, js: all.js };
  }

  function setAll(data) {
    // Sets core files; optionally loads extraFiles array
    if (data.html !== undefined && editors.html) { editors.html.setValue(data.html); editors.html.clearHistory(); }
    if (data.css  !== undefined && editors.css)  { editors.css.setValue(data.css);   editors.css.clearHistory();  }
    if (data.js   !== undefined && editors.js)   { editors.js.setValue(data.js);     editors.js.clearHistory();   }

    // Remove any previously added extra tabs
    const extra = Object.keys(files).filter(id => !CORE_IDS.includes(id));
    extra.forEach(id => {
      const pane = document.getElementById('editor-' + id);
      if (pane) pane.remove();
      delete editors[id];
      delete files[id];
    });

    // Load extra files if provided
    if (Array.isArray(data.extraFiles)) {
      data.extraFiles.forEach(f => {
        addFile(f.name, f.type, f.content, false);
      });
    }

    renderTabBar();
    switchTab(activeFile in files ? activeFile : 'html');
    updateSaveStatus('saved');
  }

  function getValue(fileId) {
    return editors[fileId]?.getValue() || '';
  }

  function setValue(fileId, value) {
    if (editors[fileId]) editors[fileId].setValue(value);
  }

  function getActiveFile() { return activeFile; }
  function getFiles()      { return { ...files }; }

  /* =============================================
     UNDO / REDO / SELECT ALL
     ============================================= */
  function undo()      { editors[activeFile]?.execCommand('undo');      editors[activeFile]?.focus(); }
  function redo()      { editors[activeFile]?.execCommand('redo');      editors[activeFile]?.focus(); }
  function selectAll() { editors[activeFile]?.execCommand('selectAll'); editors[activeFile]?.focus(); }

  /* =============================================
     THEME
     ============================================= */
  function setTheme(dark) {
    isDark = dark;
    const theme = themeForDark(dark);
    Object.values(editors).forEach((cm) => cm.setOption('theme', theme));
  }

  /* =============================================
     FOCUS / REFRESH
     ============================================= */
  function focus()      { editors[activeFile]?.focus(); }
  function refreshAll() { Object.values(editors).forEach((cm) => cm.refresh()); }

  /* =============================================
     DOWNLOAD ACTIVE FILE
     ============================================= */
  function downloadActiveFile() {
    const f   = files[activeFile];
    if (!f) return;
    const val = editors[activeFile]?.getValue() || '';
    Zip.downloadFile(val, f.name);
  }

  /* =============================================
     HELPER
     ============================================= */
  function escHtml(s) {
    return String(s||'').replace(/&/g,'&').replace(/</g,'<').replace(/>/g,'>');
  }

  /* =============================================
     FIND & REPLACE (unchanged logic, scoped to active editor)
     ============================================= */
  const fr = {
    open: false, query: '',
    caseSensitive: false, useRegex: false, wholeWord: false,
    matches: [], currentIdx: -1, overlays: [], _currentMark: null,
  };

  function openFindReplace(withSelection) {
    fr.open = true;
    const panel = document.getElementById('findReplacePanel');
    if (panel) panel.classList.add('open');
    const cm = editors[activeFile];
    if (cm && withSelection) {
      const sel = cm.getSelection();
      if (sel && sel.length < 200) {
        const inp = document.getElementById('frFind');
        if (inp) { inp.value = sel; fr.query = sel; }
      }
    }
    setTimeout(() => {
      const inp = document.getElementById('frFind');
      if (inp) { inp.focus(); inp.select(); }
      _doSearch();
    }, 30);
  }

  function closeFindReplace() {
    fr.open = false;
    const panel = document.getElementById('findReplacePanel');
    if (panel) panel.classList.remove('open');
    _clearMarks();
    _updateMatchCount(null);
    editors[activeFile]?.focus();
  }

  function _buildRegex(query) {
    if (!query) return null;
    try {
      let p = fr.useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (fr.wholeWord && !fr.useRegex) p = '\\b' + p + '\\b';
      return new RegExp(p, fr.caseSensitive ? 'g' : 'gi');
    } catch(e) { return null; }
  }

  function _doSearch() {
    const cm = editors[activeFile];
    if (!cm) return;
    _clearMarks();
    fr.matches = []; fr.currentIdx = -1;
    const query = (document.getElementById('frFind')?.value || '').trim();
    fr.query = query;
    const inp = document.getElementById('frFind');
    if (!query) { _updateMatchCount(null); if (inp) inp.classList.remove('no-match','has-match'); return; }
    const rx = _buildRegex(query);
    if (!rx) { if (inp) inp.classList.add('no-match'); _updateMatchCount(null); return; }
    cm.getValue().split('\n').forEach((line, lineNo) => {
      rx.lastIndex = 0;
      let m;
      while ((m = rx.exec(line)) !== null) {
        fr.matches.push({ from:{line:lineNo,ch:m.index}, to:{line:lineNo,ch:m.index+m[0].length} });
        if (rx.lastIndex === m.index) rx.lastIndex++;
      }
    });
    fr.overlays = fr.matches.map(match => cm.markText(match.from, match.to, {className:'fr-highlight'}));
    if (fr.matches.length > 0) {
      const cursor = cm.getCursor();
      let best = 0;
      for (let i = 0; i < fr.matches.length; i++) {
        const m = fr.matches[i];
        if (m.from.line > cursor.line || (m.from.line===cursor.line && m.from.ch>=cursor.ch)) { best=i; break; }
        best = i;
      }
      fr.currentIdx = best; _highlightCurrent();
    }
    _updateMatchCount(fr.matches.length);
    if (inp) { inp.classList.toggle('no-match', fr.matches.length===0); inp.classList.toggle('has-match', fr.matches.length>0); }
  }

  function _clearMarks() {
    fr.overlays.forEach(m => { try { m.clear(); } catch(e){} });
    fr.overlays = [];
    if (fr._currentMark) { try { fr._currentMark.clear(); } catch(e){} fr._currentMark = null; }
  }

  function _highlightCurrent() {
    if (fr._currentMark) { try { fr._currentMark.clear(); } catch(e){} fr._currentMark = null; }
    if (fr.currentIdx < 0 || fr.currentIdx >= fr.matches.length) return;
    const cm = editors[activeFile];
    const match = fr.matches[fr.currentIdx];
    fr._currentMark = cm.markText(match.from, match.to, {className:'fr-highlight-current'});
    cm.scrollIntoView({from:match.from, to:match.to}, 80);
    cm.setSelection(match.from, match.to);
  }

  function findNext() {
    if (!fr.matches.length) { _doSearch(); return; }
    fr.currentIdx = (fr.currentIdx+1) % fr.matches.length;
    _highlightCurrent(); _updateMatchCount(fr.matches.length);
  }

  function findPrev() {
    if (!fr.matches.length) { _doSearch(); return; }
    fr.currentIdx = (fr.currentIdx-1+fr.matches.length) % fr.matches.length;
    _highlightCurrent(); _updateMatchCount(fr.matches.length);
  }

  function replaceOne() {
    const cm = editors[activeFile];
    if (!cm || !fr.matches.length) return;
    if (fr.currentIdx < 0) fr.currentIdx = 0;
    const match = fr.matches[fr.currentIdx];
    const replaceVal = document.getElementById('frReplace')?.value ?? '';
    let replacement = replaceVal;
    if (fr.useRegex) {
      const rx = _buildRegex(fr.query);
      if (rx) { const src = cm.getRange(match.from, match.to); rx.lastIndex=0; replacement = src.replace(rx, replaceVal); }
    }
    cm.replaceRange(replacement, match.from, match.to);
    setTimeout(() => _doSearch(), 10);
  }

  function replaceAll() {
    const cm = editors[activeFile];
    if (!cm || !fr.matches.length) return;
    const replaceVal = document.getElementById('frReplace')?.value ?? '';
    const rx = _buildRegex(fr.query);
    if (!rx) return;
    const count = fr.matches.length;
    try { cm.setValue(cm.getValue().replace(rx, replaceVal)); } catch(e) { return; }
    _clearMarks(); fr.matches=[]; fr.currentIdx=-1; _updateMatchCount(0);
    const inp = document.getElementById('frFind');
    if (inp) inp.classList.remove('no-match','has-match');
    _toast('Replaced ' + count + ' occurrence' + (count!==1?'s':''));
  }

  function _updateMatchCount(total) {
    const el = document.getElementById('frMatchCount');
    if (!el) return;
    if (total===null) { el.textContent=''; return; }
    if (total===0)    { el.textContent='No results'; return; }
    el.textContent = (fr.currentIdx+1) + ' / ' + total;
  }

  function _toast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;padding:8px 18px;border-radius:8px;font-size:13px;font-weight:600;z-index:9000;box-shadow:0 4px 16px rgba(0,0,0,.2);pointer-events:none;transition:opacity .3s;';
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity='0'; setTimeout(() => t.remove(), 350); }, 1800);
  }

  function initFindReplace() {
    const frFind    = document.getElementById('frFind');
    const frReplace = document.getElementById('frReplace');
    if (!frFind) return;
    frFind.addEventListener('input', () => _doSearch());
    frFind.addEventListener('keydown', (e) => {
      if (e.key==='Enter'  && !e.shiftKey) { e.preventDefault(); findNext(); }
      if (e.key==='Enter'  &&  e.shiftKey) { e.preventDefault(); findPrev(); }
      if (e.key==='Escape')                { e.preventDefault(); closeFindReplace(); }
      if (e.key==='Tab')                   { e.preventDefault(); frReplace?.focus(); }
    });
    frReplace?.addEventListener('keydown', (e) => {
      if (e.key==='Enter')              { e.preventDefault(); replaceOne(); }
      if (e.key==='Escape')             { e.preventDefault(); closeFindReplace(); }
      if (e.key==='Tab' && e.shiftKey)  { e.preventDefault(); frFind.focus(); }
    });
    document.getElementById('frNext')?.addEventListener('click',       () => findNext());
    document.getElementById('frPrev')?.addEventListener('click',       () => findPrev());
    document.getElementById('frClose')?.addEventListener('click',      () => closeFindReplace());
    document.getElementById('frReplaceOne')?.addEventListener('click', () => replaceOne());
    document.getElementById('frReplaceAll')?.addEventListener('click', () => replaceAll());
    function toggleOpt(btn, key) { fr[key]=!fr[key]; btn.classList.toggle('active',fr[key]); _doSearch(); }
    const frCase  = document.getElementById('frCaseSensitive');
    const frRxBtn = document.getElementById('frRegex');
    const frWord  = document.getElementById('frWholeWord');
    frCase?.addEventListener('click',  () => toggleOpt(frCase,  'caseSensitive'));
    frRxBtn?.addEventListener('click', () => toggleOpt(frRxBtn, 'useRegex'));
    frWord?.addEventListener('click',  () => toggleOpt(frWord,  'wholeWord'));
  }

  /* =============================================
     PUBLIC API
     ============================================= */
  return {
    init,
    addFile,
    closeTab,
    switchTab,
    getAllFiles,
    getAll,        // legacy: {html,css,js}
    setAll,
    getValue,
    setValue,
    getActiveFile,
    getFiles,
    downloadActiveFile,
    openFindReplace,
    closeFindReplace,
    undo, redo, selectAll,
    setTheme,
    focus,
    refreshAll,
    updateSaveStatus,
  };
})();
