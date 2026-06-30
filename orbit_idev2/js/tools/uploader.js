/**
 * uploader.js — import projects via folder picker, file picker or drag & drop.
 * Preserves folder structure (webkitRelativePath / DataTransferItem entries).
 */
import { vfs } from '../core/vfs.js';
import { bus, EVT } from '../core/eventBus.js';
import { $, normalizePath } from '../core/utils.js';
import { toast } from '../ui/notify.js';

let onImported = () => {};
export function setImportCallback(fn) { onImported = fn; }

/** Wire up upload buttons and drag & drop. */
export function initUploader() {
  $('#btnUploadFolder').addEventListener('click', () => $('#folderInput').click());
  $('#btnEmptyUpload').addEventListener('click', () => $('#folderInput').click());
  $('#btnUploadFiles').addEventListener('click', () => $('#filesInput').click());

  $('#folderInput').addEventListener('change', (e) => importFileList(e.target.files));
  $('#filesInput').addEventListener('change', (e) => importFileList(e.target.files, true));

  initDragDrop();
}

async function importFileList(fileList, flat = false) {
  const files = [...fileList];
  if (!files.length) return;
  // strip a common top-level folder so paths are project-relative
  let common = null;
  if (!flat) {
    const rels = files.map(f => f.webkitRelativePath || f.name);
    const firstSeg = rels[0].split('/')[0];
    if (rels.every(r => r.startsWith(firstSeg + '/'))) common = firstSeg + '/';
  }
  let n = 0;
  for (const f of files) {
    let rel = f.webkitRelativePath || f.name;
    if (common && rel.startsWith(common)) rel = rel.slice(common.length);
    rel = normalizePath(rel);
    if (!rel) continue;
    try { await vfs.addFromFile(rel, f); n++; } catch (e) { console.error('import failed', rel, e); }
  }
  finishImport(n);
}

function finishImport(n) {
  bus.emit(EVT.FS_CHANGED);
  toast(`Imported ${n} file(s)`, { type: 'success' });
  onImported();
}

/* ---------- drag & drop with directory support ---------- */
function initDragDrop() {
  const body = document.body;
  let depth = 0;
  ['dragenter', 'dragover'].forEach(ev => body.addEventListener(ev, (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    if (ev === 'dragenter') depth++;
    body.classList.add('dropzone-active');
  }));
  body.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; body.classList.remove('dropzone-active'); } });
  body.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    body.classList.remove('dropzone-active');
    const items = e.dataTransfer.items;
    const collected = [];
    if (items && items.length && items[0].webkitGetAsEntry) {
      const entries = [...items].map(i => i.webkitGetAsEntry()).filter(Boolean);
      for (const entry of entries) await walkEntry(entry, '', collected);
    } else {
      for (const f of e.dataTransfer.files) collected.push({ path: f.name, file: f });
    }
    let n = 0;
    for (const { path, file } of collected) {
      try { await vfs.addFromFile(normalizePath(path), file); n++; } catch (err) { console.error(err); }
    }
    finishImport(n);
  });
}

function walkEntry(entry, prefix, out) {
  return new Promise((resolve) => {
    if (entry.isFile) {
      entry.file((file) => { out.push({ path: prefix + entry.name, file }); resolve(); }, () => resolve());
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const all = [];
      const readBatch = () => reader.readEntries(async (batch) => {
        if (!batch.length) {
          for (const e of all) await walkEntry(e, prefix + entry.name + '/', out);
          resolve();
        } else { all.push(...batch); readBatch(); }
      }, () => resolve());
      readBatch();
    } else resolve();
  });
}
