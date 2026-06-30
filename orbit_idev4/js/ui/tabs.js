/**
 * tabs.js — open-file tab strip.
 *
 * Tracks open files, the active file, and routes each file to the correct
 * viewer (Monaco editor for text, image host for images). Auto-save means
 * tabs are never "unsaved", but a subtle dot indicates the active file.
 */
import { vfs } from '../core/vfs.js';
import { bus, EVT } from '../core/eventBus.js';
import { isImage } from '../core/mime.js';
import { $, el, basename } from '../core/utils.js';
import { openInEditor, disposeModel, renameModel, showEmpty } from './editor.js';
import { showImage, hideImage } from '../tools/imagePreview.js';

const open = [];        // ordered list of paths
let active = null;

function fileIconSvg() {
  return '<svg viewBox="0 0 24 24" class="ico" style="width:14px;height:14px"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>';
}

export function renderTabs() {
  const bar = $('#tabs');
  bar.innerHTML = '';
  for (const path of open) {
    const tab = el('div', {
      class: `tab${path === active ? ' active' : ''}`,
      title: path, role: 'tab',
      onclick: () => activate(path),
    }, [
      el('span', { class: 'tname', text: basename(path) }),
      el('button', {
        class: 'tclose', 'aria-label': 'Close',
        onclick: (e) => { e.stopPropagation(); closeTab(path); },
        html: '<svg viewBox="0 0 24 24" class="ico" style="width:14px;height:14px"><path d="M18 6L6 18M6 6l12 12"/></svg>',
      }),
    ]);
    bar.appendChild(tab);
  }
}

export function openTab(path) {
  if (!vfs.has(path)) return;
  if (!open.includes(path)) open.push(path);
  activate(path);
}

export function activate(path) {
  active = path;
  renderTabs();
  // route to viewer
  if (isImage(path) && !path.toLowerCase().endsWith('.svg')) {
    hideEditorHost();
    showImage(path);
  } else {
    hideImage();
    showEditorHost();
    openInEditor(path);
  }
  // scroll active tab into view
  const idx = open.indexOf(path);
  const node = $('#tabs').children[idx];
  node?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  bus.emit(EVT.ACTIVE_CHANGED, { path });
}

function showEditorHost() {
  $('#editorHost').classList.remove('hidden');
  $('#editorEmpty').classList.add('hidden');
}
function hideEditorHost() {
  $('#editorHost').classList.add('hidden');
  $('#editorEmpty').classList.add('hidden');
}

export function closeTab(path) {
  const idx = open.indexOf(path);
  if (idx < 0) return;
  open.splice(idx, 1);
  disposeModel(path);
  if (active === path) {
    const next = open[idx] || open[idx - 1] || null;
    if (next) activate(next);
    else { active = null; renderTabs(); hideImage(); showEmpty(); }
  } else {
    renderTabs();
  }
}

/** React to a file rename in the VFS. */
export function tabRenamed(from, to) {
  const idx = open.indexOf(from);
  if (idx >= 0) open[idx] = to;
  renameModel(from, to);
  if (active === from) active = to;
  renderTabs();
}

/** React to a deletion. */
export function tabDeleted(path) {
  // close it and any descendants (folder delete)
  const toClose = open.filter(p => p === path || p.startsWith(path + '/'));
  toClose.forEach(closeTab);
}

export function getActive() { return active; }
export function getOpen() { return [...open]; }

// Wire global events
bus.on(EVT.FILE_OPEN, ({ path }) => openTab(path));
