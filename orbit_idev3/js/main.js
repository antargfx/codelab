/**
 * main.js — application bootstrap and global wiring.
 * Initializes every subsystem and connects the chrome (top bar, docks,
 * mobile navigation, theme) to the underlying modules.
 */
import { vfs } from './core/vfs.js';
import { bus, EVT } from './core/eventBus.js';
import { $, $$, el, isMobile } from './core/utils.js';
import { isJson } from './core/mime.js';

import { initEditor, editorCommands } from './ui/editor.js';
import { renderTabs } from './ui/tabs.js';
import { renderTree, setFilter, collapseAll, createFile, createFolder } from './ui/fileTree.js';
import { initSplitPanes } from './ui/splitPane.js';
import { toast } from './ui/notify.js';

import { initPreview, startProject, togglePicker } from './preview/preview.js';
import { initConsole } from './devtools/console.js';
import { initErrors, validateAll } from './devtools/errors.js';
import { initNetwork } from './devtools/network.js';
import { initInspector } from './devtools/inspector.js';
import { initStorage, refresh as refreshStorage } from './devtools/storage.js';

import { initSearch } from './tools/search.js';
import { initUploader, setImportCallback } from './tools/uploader.js';
import { exportProject } from './tools/exporter.js';
import { openJsonViewer, closeJsonViewer } from './tools/jsonViewer.js';

/* ---------------- boot ---------------- */
async function boot() {
  buildEditorToolbar();
  await initEditor();
  renderTabs();
  renderTree();

  initConsole();
  initErrors();
  initNetwork();
  initInspector();
  initStorage();
  initSearch();

  initUploader();
  setImportCallback(onProjectImported);

  initSplitPanes();
  wireChrome();
  await initPreview();

  // restore theme preference
  const saved = localStorage.getItem('orbit-theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);

  document.body.dataset.mview = 'files';
}

function onProjectImported() {
  renderTree();
  startProject();
  validateAll();
  const entry = vfs.defaultEntry();
  if (entry) bus.emit(EVT.FILE_OPEN, { path: entry });
  if (isMobile()) setMobileView('preview');
}

/* ---------------- editor toolbar ---------------- */
function buildEditorToolbar() {
  const pane = $('#paneEditor');
  const bar = el('div', { class: 'editor-toolbar' });
  const mk = (label, title, fn) => el('button', { class: 'icon-btn sm', title, onclick: fn, html: label });
  bar.append(
    el('button', { class: 'btn ghost', style: 'padding:5px 10px;font-size:12px', text: 'Find', onclick: editorCommands.find }),
    el('button', { class: 'btn ghost', style: 'padding:5px 10px;font-size:12px', text: 'Replace', onclick: editorCommands.replace }),
    el('button', { class: 'btn ghost', style: 'padding:5px 10px;font-size:12px', text: 'Go to', onclick: editorCommands.gotoLine }),
    el('button', { class: 'btn ghost', style: 'padding:5px 10px;font-size:12px', text: 'Format', onclick: editorCommands.format }),
    el('div', { style: 'flex:1' }),
    el('button', { class: 'btn ghost', id: 'btnJsonView', style: 'padding:5px 10px;font-size:12px;display:none', text: 'JSON ▤', onclick: openActiveJson }),
    el('button', { class: 'btn ghost', style: 'padding:5px 10px;font-size:12px', title: 'Toggle word wrap', text: '⤶', onclick: () => { const m = editorCommands.toggleWrap(); toast('Word wrap: ' + m); } }),
    el('button', { class: 'btn ghost', style: 'padding:5px 10px;font-size:12px', title: 'Decrease font', text: 'A−', onclick: () => editorCommands.fontDec() }),
    el('button', { class: 'btn ghost', style: 'padding:5px 10px;font-size:12px', title: 'Increase font', text: 'A+', onclick: () => editorCommands.fontInc() }),
    el('button', { class: 'btn ghost', style: 'padding:5px 10px;font-size:12px', title: 'Fold all', text: '⊟', onclick: () => editorCommands.foldAll() }),
  );
  // insert after the tabs strip
  const tabs = $('#tabs');
  tabs.insertAdjacentElement('afterend', bar);
}

function openActiveJson() {
  import('./ui/tabs.js').then(({ getActive }) => {
    const p = getActive();
    if (p && isJson(p)) openJsonViewer(p);
  });
}

/* ---------------- chrome wiring ---------------- */
function wireChrome() {
  // sidebar toggle (desktop collapse / mobile drawer)
  $('#btnToggleSidebar').addEventListener('click', () => {
    const sb = $('#sidebar');
    if (isMobile()) setMobileView(document.body.dataset.mview === 'files' ? 'editor' : 'files');
    else sb.classList.toggle('collapsed');
  });

  // theme
  $('#btnTheme').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') || 'light';
    const next = cur === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('orbit-theme', next);
    bus.emit(EVT.THEME_CHANGED, next);
  });

  // export
  $('#btnExport').addEventListener('click', () => exportProject('project'));

  // preview toggle (desktop hides/shows preview pane)
  $('#btnTogglePreview').addEventListener('click', () => {
    if (isMobile()) { setMobileView('preview'); return; }
    const pane = $('#panePreview');
    const hidden = pane.style.display === 'none';
    pane.style.display = hidden ? '' : 'none';
    $('#resizeMain').style.display = hidden ? '' : 'none';
  });

  // explorer toolbar
  $('#btnNewFile').addEventListener('click', () => createFile(''));
  $('#btnNewFolder').addEventListener('click', () => createFolder(''));
  $('#btnCollapseAll').addEventListener('click', collapseAll);
  $('#fileFilter').addEventListener('input', (e) => setFilter(e.target.value));

  // sidebar tabs (files / search)
  $$('.side-tab').forEach(t => t.addEventListener('click', () => {
    $$('.side-tab').forEach(x => x.classList.toggle('is-active', x === t));
    $$('.side-panel').forEach(p => p.classList.toggle('is-active', p.dataset.panel === t.dataset.side));
  }));

  // dock tabs
  $$('.dock-tab').forEach(t => t.addEventListener('click', () => {
    const which = t.dataset.dock;
    $$('.dock-tab').forEach(x => x.classList.toggle('is-active', x === t));
    $$('.dock-panel').forEach(p => p.classList.toggle('is-active', p.dataset.panel === which));
    $('#dock').classList.remove('collapsed');
    if (which === 'storage') refreshStorage();
  }));

  // dock collapse
  $('#btnDockToggle').addEventListener('click', () => $('#dock').classList.toggle('collapsed'));

  // mobile nav
  $$('.mnav-btn').forEach(b => b.addEventListener('click', () => setMobileView(b.dataset.view)));

  // when an element is picked, surface the Inspector
  bus.on(EVT.PICK_RESULT, () => {
    $('.dock-tab[data-dock="inspector"]').click();
    if (isMobile()) setMobileView('devtools');
  });

  // toggle JSON viewer button visibility on active change + reveal editor on mobile
  bus.on(EVT.ACTIVE_CHANGED, ({ path }) => {
    closeJsonViewer();
    $('#btnJsonView').style.display = isJson(path) ? '' : 'none';
    // On mobile, opening a file must surface the editor pane (it's hidden otherwise).
    if (isMobile()) setMobileView('editor');
  });

  // keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 's') { e.preventDefault(); toast('Auto-save is on'); }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); $('.side-tab[data-side="search"]').click(); }
    if (mod && e.key === 'e') { e.preventDefault(); exportProject('project'); }
  });
}

function setMobileView(view) {
  document.body.dataset.mview = view;
  $$('.mnav-btn').forEach(b => b.classList.toggle('is-active', b.dataset.view === view));
  if (view === 'devtools') $('#dock').classList.remove('collapsed');
}

boot();
