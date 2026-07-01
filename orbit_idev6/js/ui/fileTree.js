/**
 * fileTree.js — explorer tree with expand/collapse, filtering, drag & drop,
 * and a full context menu (new/rename/duplicate/move/copy/paste/delete).
 */
import { vfs } from '../core/vfs.js';
import { bus, EVT } from '../core/eventBus.js';
import { categoryOf } from '../core/mime.js';
import { $, el, normalizePath, dirname, basename } from '../core/utils.js';
import { showContextMenu, bindContextTrigger } from './contextMenu.js';
import { promptSheet, confirmSheet } from './bottomSheet.js';
import { toast } from './notify.js';
import { tabRenamed, tabDeleted } from './tabs.js';

const collapsed = new Set();   // folder paths that are collapsed
let filterText = '';
let clipboard = null;          // { path, op: 'copy' | 'cut' }
let selectedPath = null;

const ICONS = {
  folder: '<svg viewBox="0 0 24 24" class="ico ficon folder"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>',
  twisty: '<svg viewBox="0 0 24 24" class="ico" style="width:14px;height:14px"><path d="M9 6l6 6-6 6"/></svg>',
};
function fileIcon(cat) {
  return `<svg viewBox="0 0 24 24" class="ico ficon ${cat}"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>`;
}

/** Re-render the whole tree. */
export function renderTree() {
  const host = $('#fileTree');
  const empty = $('#explorerEmpty');
  host.innerHTML = '';
  if (vfs.count() === 0 && vfs.folders.size === 0) {
    empty.classList.add('show');
    return;
  }
  empty.classList.remove('show');

  const root = vfs.tree();
  const frag = document.createDocumentFragment();
  const matches = buildFilterSet();
  for (const child of root.children) renderNode(child, 0, frag, matches);
  host.appendChild(frag);
}

/** When filtering, compute the set of paths (and ancestor folders) to show. */
function buildFilterSet() {
  if (!filterText) return null;
  const q = filterText.toLowerCase();
  const keep = new Set();
  for (const p of vfs.paths()) {
    if (p.toLowerCase().includes(q)) {
      keep.add(p);
      let d = dirname(p);
      while (d) { keep.add(d); d = dirname(d); }
    }
  }
  return keep;
}

function renderNode(node, depth, parent, matches) {
  if (matches && !matches.has(node.path)) return;
  const pad = 8 + depth * 14;

  if (node.type === 'folder') {
    const isCollapsed = collapsed.has(node.path) && !filterText;
    const row = el('div', {
      class: `tree-row${isCollapsed ? ' collapsed' : ''}${node.path === selectedPath ? ' active' : ''}`,
      style: `padding-left:${pad}px`,
      dataset: { path: node.path, type: 'folder' },
    }, [
      el('span', { class: 'twisty', html: ICONS.twisty }),
      el('span', { html: ICONS.folder }),
      el('span', { class: 'fname', text: node.name }),
    ]);
    row.addEventListener('click', () => { selectedPath = node.path; toggleFolder(node.path); });
    bindContextTrigger(row, (pos) => openMenu(pos, node));
    enableDrop(row, node.path);
    enableDrag(row, node.path);
    parent.appendChild(row);

    const childWrap = el('div', { class: `tree-children${isCollapsed ? ' collapsed' : ''}` });
    for (const child of node.children) renderNode(child, depth + 1, childWrap, matches);
    parent.appendChild(childWrap);
  } else {
    const cat = categoryOf(node.path);
    const row = el('div', {
      class: `tree-row${node.path === selectedPath ? ' active' : ''}${clipboard?.op === 'cut' && clipboard.path === node.path ? ' cut' : ''}`,
      style: `padding-left:${pad + 16}px`,
      dataset: { path: node.path, type: 'file' },
    }, [
      el('span', { html: fileIcon(cat) }),
      el('span', { class: 'fname', text: node.name }),
    ]);
    row.addEventListener('click', () => { selectedPath = node.path; markActive(); bus.emit(EVT.FILE_OPEN, { path: node.path }); });
    bindContextTrigger(row, (pos) => openMenu(pos, node));
    enableDrag(row, node.path);
    parent.appendChild(row);
  }
}

function markActive() {
  $('#fileTree').querySelectorAll('.tree-row').forEach(r => {
    r.classList.toggle('active', r.dataset.path === selectedPath);
  });
}

function toggleFolder(path) {
  if (collapsed.has(path)) collapsed.delete(path); else collapsed.add(path);
  renderTree();
}

export function collapseAll() {
  for (const f of vfs.folders) collapsed.add(f);
  renderTree();
}

export function setFilter(text) {
  filterText = text.trim();
  renderTree();
}

/* ---------------- Drag & Drop (desktop) ---------------- */
function enableDrag(row, path) {
  row.draggable = true;
  row.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/orbit-path', path);
    e.dataTransfer.effectAllowed = 'move';
  });
}
function enableDrop(row, folderPath) {
  row.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('text/orbit-path')) { e.preventDefault(); row.style.background = 'var(--accent-soft)'; }
  });
  row.addEventListener('dragleave', () => { row.style.background = ''; });
  row.addEventListener('drop', (e) => {
    row.style.background = '';
    const from = e.dataTransfer.getData('text/orbit-path');
    if (!from) return;
    e.preventDefault();
    const to = normalizePath(`${folderPath}/${basename(from)}`);
    if (from === to || to.startsWith(from + '/')) return;
    doMove(from, to);
  });
}

/* ---------------- Context menu ---------------- */
function openMenu(pos, node) {
  selectedPath = node.path; markActive();
  const isFolder = node.type === 'folder';
  const targetDir = isFolder ? node.path : dirname(node.path);
  const items = [];
  if (isFolder) {
    items.push({ label: 'New File', onClick: () => createFile(targetDir) });
    items.push({ label: 'New Folder', onClick: () => createFolder(targetDir) });
    items.push({ sep: true });
  } else {
    items.push({ label: 'Open', onClick: () => bus.emit(EVT.FILE_OPEN, { path: node.path }) });
    items.push({ sep: true });
  }
  items.push({ label: 'Rename', onClick: () => renameEntry(node.path) });
  if (!isFolder) items.push({ label: 'Duplicate', onClick: () => duplicateEntry(node.path) });
  items.push({ label: 'Copy', onClick: () => { clipboard = { path: node.path, op: 'copy' }; renderTree(); toast('Copied'); } });
  items.push({ label: 'Cut', onClick: () => { clipboard = { path: node.path, op: 'cut' }; renderTree(); toast('Cut'); } });
  if (clipboard) items.push({ label: 'Paste', onClick: () => pasteInto(targetDir) });
  items.push({ label: 'Move to…', onClick: () => moveEntry(node.path) });
  items.push({ sep: true });
  items.push({ label: 'Delete', danger: true, onClick: () => deleteEntry(node.path) });
  showContextMenu(pos, items);
}

/* ---------------- Operations ---------------- */
export async function createFile(dir = '') {
  const name = await promptSheet({ title: 'New File', label: 'File name', placeholder: 'index.html' });
  if (!name) return;
  const path = normalizePath(`${dir}/${name}`);
  if (vfs.has(path)) { toast('File already exists', { type: 'error' }); return; }
  vfs.setText(path, '');
  bus.emit(EVT.FILE_OPEN, { path });
}

export async function createFolder(dir = '') {
  const name = await promptSheet({ title: 'New Folder', label: 'Folder name', placeholder: 'components' });
  if (!name) return;
  vfs.mkdir(normalizePath(`${dir}/${name}`));
}

async function renameEntry(path) {
  const name = await promptSheet({ title: 'Rename', label: 'New name', value: basename(path) });
  if (!name) return;
  const to = normalizePath(`${dirname(path)}/${name}`);
  if (to === path) return;
  if (vfs.has(to)) { toast('Target already exists', { type: 'error' }); return; }
  vfs.move(path, to);
  tabRenamed(path, to);
  bus.emit(EVT.PREVIEW_RELOAD);
}

function duplicateEntry(path) {
  const np = vfs.duplicate(path);
  if (np) { renderTree(); toast('Duplicated'); }
}

async function moveEntry(path) {
  const dest = await promptSheet({ title: 'Move', label: 'Destination path', value: path });
  if (!dest) return;
  doMove(path, normalizePath(dest));
}

function doMove(from, to) {
  if (vfs.has(to)) { toast('Target already exists', { type: 'error' }); return; }
  vfs.move(from, to);
  tabRenamed(from, to);
  bus.emit(EVT.PREVIEW_RELOAD);
  toast('Moved');
}

function pasteInto(dir) {
  if (!clipboard) return;
  const from = clipboard.path;
  const to = normalizePath(`${dir}/${basename(from)}`);
  if (from === to && clipboard.op === 'cut') return;
  if (clipboard.op === 'copy') {
    if (vfs.has(from)) {
      const f = vfs.get(from);
      let finalTo = to;
      let i = 1;
      while (vfs.has(finalTo)) {
        const b = basename(from); const dot = b.lastIndexOf('.');
        const stem = dot > 0 ? b.slice(0, dot) : b; const e = dot > 0 ? b.slice(dot) : '';
        finalTo = normalizePath(`${dir}/${stem}_copy${i > 1 ? i : ''}${e}`); i++;
      }
      if (f.isText) vfs.setText(finalTo, f.text); else vfs.setBytes(finalTo, f.bytes.slice());
    }
  } else {
    if (vfs.has(to)) { toast('Target exists', { type: 'error' }); return; }
    vfs.move(from, to);
    tabRenamed(from, to);
    clipboard = null;
  }
  renderTree();
  bus.emit(EVT.PREVIEW_RELOAD);
  toast('Pasted');
}

async function deleteEntry(path) {
  const ok = await confirmSheet({
    title: 'Delete', message: `Delete "${basename(path)}"? This cannot be undone.`,
    confirmText: 'Delete', danger: true,
  });
  if (!ok) return;
  tabDeleted(path);
  vfs.delete(path);
  bus.emit(EVT.PREVIEW_RELOAD);
}

// Keep tree in sync with FS changes.
bus.on(EVT.FS_CHANGED, renderTree);
