/**
 * editor.js — AntLab IDE
 * ------------------------------------------------------------
 * Dynamic multi-tab CodeMirror editor.
 *
 * Every file is a first-class tab keyed by its real filename
 * (index.html, style.css, script.js, page.html, data.json, …).
 * ALL tabs are closeable — including index.html / style.css /
 * script.js — and new files of many text types can be created.
 * ------------------------------------------------------------
 */

const Editor = (() => {

  /* =============================================
     STATE
     ============================================= */
  // editors[name] = CodeMirror instance ; files[name] = {id,name,type,content}
  const editors   = {};
  const files     = {};
  let activeFile  = null;
  let saveTimer   = null;
  let onChangeCallback = null;
  let onSaveCallback   = null;
  let isDark      = false;

  const TEXT_EXTS = ['html','htm','css','js','mjs','json','svg','xml','txt','md','csv'];

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

  function typeForName(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (ext === 'htm' || ext === 'html') return 'html';
    if (ext === 'css') return 'css';
    if (ext === 'mjs' || ext === 'js') return 'js';
    return ext || 'txt';
  }

  function modeForType(type) {
    if (type === 'html') return 'htmlmixed';
    if (type === 'css')  return 'css';
    if (type === 'js')   return { name: 'javascript', json: false };
    if (type === 'json') return { name: 'javascript', json: true };
    if (type === 'svg' || type === 'xml') return 'xml';
    return null; // plain text (md, txt, csv, …)
  }

  function themeForDark(dark) { return dark ? 'dracula' : 'eclipse'; }

  /* =============================================
     CREATE / MOUNT EDITOR PANE
     ============================================= */
  function createEditorPane(name, type, value) {
    const area = document.getElementById('editorArea');
    if (!area) return null;

    let pane = document.getElementById('editor-' + name);
    if (!pane) {
      pane = document.createElement('div');
      pane.id        = 'editor-' + name;
      pane.className = 'editor-pane';
      area.appendChild(pane);
    }

    if (!editors[name]) {
      const cm = CodeMirror(pane, {
        ...BASE_CONFIG,
        mode:  modeForType(type),
        theme: themeForDark(isDark),
        value: value || '',
      });
      cm.on('cursorActivity', () => { if (name === activeFile) updateStatusBar(cm); });
      cm.on('change', scheduleChange);
      editors[name] = cm;
    } else {
      const cm = editors[name];
      cm.setValue(value || '');
      cm.clearHistory();
    }
    return editors[name];
  }

  function scheduleChange() {
    updateSaveStatus('saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (onChangeCallback) onChangeCallback(getVirtualFiles());
      triggerSave();
    }, 700);
  }

  /* =============================================
     TAB BAR
     ============================================= */
  const DOT_COLORS = { html: '#e44d26', css: '#264de4', js: '#f0db4f', json: '#f5a623' };
  function dotColor(type) { return DOT_COLORS[type] || '#10b981'; }

  function renderTabBar() {
    const tabBar = document.getElementById('fileTabs');
    if (!tabBar) return;
    tabBar.innerHTML = '';

    Object.values(files).forEach((f) => {
      const isActive = f.id === activeFile;
      const tab = document.createElement('button');
      tab.className  = 'file-tab' + (isActive ? ' active' : '');
      tab.dataset.file = f.id;
      tab.title      = f.name;

      const dotStyle = `background:${dotColor(f.type)};${f.type === 'js' ? 'outline:1px solid rgba(0,0,0,.12);' : ''}`;
      tab.innerHTML  = `<span class="tab-dot" style="${dotStyle}"></span><span class="tab-name">${escHtml(f.name)}</span>`;

      // Every tab is closeable now.
      const x = document.createElement('button');
      x.className = 'tab-close';
      x.title     = 'Close tab';
      x.innerHTML = '×';
      x.addEventListener('click', (e) => { e.stopPropagation(); closeTab(f.id); });
      tab.appendChild(x);

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
    if (!files[fileId]) {
      // nothing to show
      activeFile = null;
      document.querySelectorAll('.editor-pane').forEach((p) => p.classList.remove('active'));
      return;
    }
    activeFile = fileId;

    document.querySelectorAll('.editor-pane').forEach((p) => {
      p.classList.toggle('active', p.id === 'editor-' + fileId);
    });
    document.querySelectorAll('.file-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.file === fileId);
    });

    const f = files[fileId];
    const langMap = { html: 'HTML', css: 'CSS', js: 'JavaScript', json: 'JSON', svg: 'SVG', xml: 'XML', md: 'Markdown', csv: 'CSV', txt: 'Text' };
    const langEl = document.getElementById('statusLang');
    if (langEl) langEl.textContent = langMap[f?.type] || (f?.type || fileId).toUpperCase();

    if (fr.open) {
      _clearMarks(); fr.matches = []; fr.currentIdx = -1; fr.overlays = [];
      setTimeout(() => _doSearch(), 60);
    }

    requestAnimationFrame(() => {
      editors[fileId]?.refresh();
      editors[fileId]?.focus();
      if (editors[fileId]) updateStatusBar(editors[fileId]);
    });
  }

  /* =============================================
     ADD FILE
     ============================================= */
  function addFile(name, type, content, activate) {
    name = String(name).trim();
    const normType = type || typeForName(name);
    files[name] = { id: name, name, type: normType, content: content || '' };
    createEditorPane(name, normType, content || '');
    renderTabBar();
    if (activate !== false) switchTab(name);
    return name;
  }

  /* =============================================
     CLOSE TAB (deletes the file from the project)
     ============================================= */
  function closeTab(fileId) {
    const pane = document.getElementById('editor-' + fileId);
    if (pane) pane.remove();
    if (editors[fileId]) { try { editors[fileId].toTextArea?.(); } catch (e) {} delete editors[fileId]; }
    delete files[fileId];

    if (activeFile === fileId) {
      const remaining = Object.keys(files);
      switchTab(remaining[remaining.length - 1] || null);
    }
    renderTabBar();

    if (onChangeCallback) onChangeCallback(getVirtualFiles());
    triggerSave();
  }

  /* =============================================
     PROMPT NEW FILE
     ============================================= */
  function promptNewFile() {
    const name = window.prompt('New file name (e.g. page.html, data.json, utils.js, theme.css):');
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    const ext = (trimmed.split('.').pop() || '').toLowerCase();
    if (!TEXT_EXTS.includes(ext)) {
      alert('Supported types: ' + TEXT_EXTS.map((e) => '.' + e).join(', '));
      return;
    }
    if (files[trimmed]) { switchTab(trimmed); return; }
    addFile(trimmed, typeForName(trimmed), '', true);
    if (onChangeCallback) onChangeCallback(getVirtualFiles());
    triggerSave();
  }

  /* =============================================
     INIT
     ============================================= */
  function init(onChange, onSave) {
    onChangeCallback = onChange;
    onSaveCallback   = onSave;
    initFindReplace();
  }

  /* =============================================
     LOAD FILES  — files: [{name,type,content}]
     ============================================= */
  function loadFiles(fileList) {
    // Tear down existing editors/panes
    Object.keys(editors).forEach((id) => {
      const pane = document.getElementById('editor-' + id);
      if (pane) pane.remove();
      delete editors[id];
    });
    Object.keys(files).forEach((id) => delete files[id]);

    const area = document.getElementById('editorArea');
    if (area) area.innerHTML = '';

    (fileList || []).forEach((f) => {
      const type = f.type || typeForName(f.name);
      files[f.name] = { id: f.name, name: f.name, type, content: f.content || '' };
      createEditorPane(f.name, type, f.content || '');
    });

    renderTabBar();
    const names = Object.keys(files);
    const first = names.find((n) => /^index\.html?$/i.test(n)) || names[0] || null;
    switchTab(first);
    if (editors[first]) updateStatusBar(editors[first]);
    updateSaveStatus('saved');
  }

  /* =============================================
     STATUS BAR
     ============================================= */
  function updateStatusBar(cm) {
    if (!cm) return;
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
    if (onSaveCallback) onSaveCallback(getVirtualFiles());
  }

  /* =============================================
     GET / SET
     ============================================= */
  // Canonical: array of every open file with current content.
  function getVirtualFiles() {
    return Object.values(files).map((f) => ({
      name: f.name,
      type: f.type,
      content: editors[f.id]?.getValue() ?? f.content ?? '',
    }));
  }

  // Legacy compat — {html, css, js, extraFiles:[]} derived by filename.
  function getAllFiles() {
    const result = { html: '', css: '', js: '', extraFiles: [] };
    getVirtualFiles().forEach((f) => {
      if (/^index\.html?$/i.test(f.name) && !result.html) result.html = f.content;
      else if (/^style(s)?\.css$/i.test(f.name) && !result.css) result.css = f.content;
      else if (/^(script|app|main)\.js$/i.test(f.name) && !result.js) result.js = f.content;
      else result.extraFiles.push({ name: f.name, type: f.type, content: f.content });
    });
    return result;
  }

  function getAll() {
    const a = getAllFiles();
    return { html: a.html, css: a.css, js: a.js };
  }

  function getValue(fileId)      { return editors[fileId]?.getValue() || ''; }
  function setValue(fileId, val) { if (editors[fileId]) editors[fileId].setValue(val); }
  function setValueByName(name, val) {
    if (editors[name]) editors[name].setValue(val);
    else addFile(name, typeForName(name), val, false);
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
     THEME / FOCUS / REFRESH
     ============================================= */
  function setTheme(dark) {
    isDark = dark;
    const theme = themeForDark(dark);
    Object.values(editors).forEach((cm) => cm.setOption('theme', theme));
  }
  function focus()      { editors[activeFile]?.focus(); }
  function refreshAll() { Object.values(editors).forEach((cm) => cm.refresh()); }

  /* =============================================
     DOWNLOAD ACTIVE FILE
     ============================================= */
  function downloadActiveFile() {
    const f = files[activeFile];
    if (!f) return;
    const val = editors[activeFile]?.getValue() || '';
    Zip.downloadFile(val, f.name);
  }

  function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* =============================================
     FIND & REPLACE  (scoped to active editor)
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
    } catch (e) { return null; }
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
    loadFiles,
    addFile,
    closeTab,
    switchTab,
    getVirtualFiles,
    getAllFiles,
    getAll,
    getValue,
    setValue,
    setValueByName,
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
