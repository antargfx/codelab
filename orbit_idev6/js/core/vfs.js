/**
 * vfs.js
 * In-memory Virtual File System.
 *
 * Holds the whole uploaded project. Text files are stored as strings;
 * binary files are stored as Uint8Array. Provides CRUD plus tree building
 * and Blob URL generation used by the preview/runtime layer.
 */

import { bus, EVT } from './eventBus.js';
import { isText, mimeOf } from './mime.js';
import { normalizePath, basename, dirname, readAsText, readAsArrayBuffer } from './utils.js';

/**
 * @typedef {Object} FileNode
 * @property {string} path
 * @property {string} name
 * @property {boolean} isText
 * @property {string} mime
 * @property {string=} text        // for text files
 * @property {Uint8Array=} bytes   // for binary files
 * @property {number} size
 * @property {string|null} blobUrl // cached object URL
 */

class VFS {
  constructor() {
    /** @type {Map<string, FileNode>} */
    this.files = new Map();
    /** @type {Set<string>} explicit folders (incl. empty) */
    this.folders = new Set();
  }

  clear() {
    for (const f of this.files.values()) if (f.blobUrl) URL.revokeObjectURL(f.blobUrl);
    this.files.clear();
    this.folders.clear();
    bus.emit(EVT.FS_CHANGED);
  }

  has(path) { return this.files.has(normalizePath(path)); }
  get(path) { return this.files.get(normalizePath(path)); }
  count() { return this.files.size; }

  /** Register all parent folders for a path. */
  _ensureFolders(path) {
    let dir = dirname(path);
    while (dir) {
      this.folders.add(dir);
      dir = dirname(dir);
    }
  }

  mkdir(path) {
    path = normalizePath(path);
    if (!path) return;
    this.folders.add(path);
    this._ensureFolders(path + '/_');
    bus.emit(EVT.FS_CHANGED);
  }

  /** Add or replace a text file. */
  setText(path, text, { silent = false } = {}) {
    path = normalizePath(path);
    const existing = this.files.get(path);
    if (existing?.blobUrl) { URL.revokeObjectURL(existing.blobUrl); existing.blobUrl = null; }
    const node = {
      path, name: basename(path), isText: true, mime: mimeOf(path),
      text, bytes: undefined, size: new Blob([text]).size, blobUrl: null,
    };
    this.files.set(path, node);
    this._ensureFolders(path);
    if (!silent) { bus.emit(EVT.FS_CHANGED); }
    bus.emit(EVT.FILE_UPDATED, { path });
    return node;
  }

  /** Add or replace a binary file. */
  setBytes(path, bytes, { silent = false } = {}) {
    path = normalizePath(path);
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const existing = this.files.get(path);
    if (existing?.blobUrl) { URL.revokeObjectURL(existing.blobUrl); existing.blobUrl = null; }
    const node = {
      path, name: basename(path), isText: false, mime: mimeOf(path),
      text: undefined, bytes: u8, size: u8.byteLength, blobUrl: null,
    };
    this.files.set(path, node);
    this._ensureFolders(path);
    if (!silent) bus.emit(EVT.FS_CHANGED);
    return node;
  }

  /** Import a browser File object, choosing text/binary automatically. */
  async addFromFile(path, file) {
    path = normalizePath(path);
    if (isText(path)) {
      const text = await readAsText(file);
      return this.setText(path, text, { silent: true });
    }
    const buf = await readAsArrayBuffer(file);
    return this.setBytes(path, new Uint8Array(buf), { silent: true });
  }

  readText(path) {
    const f = this.get(path);
    if (!f) return null;
    if (f.isText) return f.text ?? '';
    return new TextDecoder().decode(f.bytes);
  }

  /** Get a Blob for a file (used to build object URLs). */
  toBlob(path) {
    const f = this.get(path);
    if (!f) return null;
    const data = f.isText ? f.text : f.bytes;
    return new Blob([data], { type: f.mime });
  }

  /** Get (and cache) a Blob URL for a file. */
  blobUrl(path) {
    const f = this.get(path);
    if (!f) return null;
    if (!f.blobUrl) f.blobUrl = URL.createObjectURL(this.toBlob(path));
    return f.blobUrl;
  }

  /** Invalidate cached blob URLs (call before rebuilding preview). */
  revokeBlobUrls() {
    for (const f of this.files.values()) {
      if (f.blobUrl) { URL.revokeObjectURL(f.blobUrl); f.blobUrl = null; }
    }
  }

  delete(path) {
    path = normalizePath(path);
    let changed = false;
    // file?
    if (this.files.has(path)) {
      const f = this.files.get(path);
      if (f.blobUrl) URL.revokeObjectURL(f.blobUrl);
      this.files.delete(path);
      changed = true;
    }
    // folder? delete recursively
    if (this.folders.has(path)) { this.folders.delete(path); changed = true; }
    const prefix = path + '/';
    for (const p of [...this.files.keys()]) {
      if (p.startsWith(prefix)) {
        const f = this.files.get(p);
        if (f.blobUrl) URL.revokeObjectURL(f.blobUrl);
        this.files.delete(p);
        changed = true;
      }
    }
    for (const d of [...this.folders]) {
      if (d.startsWith(prefix)) { this.folders.delete(d); changed = true; }
    }
    if (changed) bus.emit(EVT.FS_CHANGED);
    return changed;
  }

  /** Rename / move a file or folder to a new path. */
  move(from, to) {
    from = normalizePath(from);
    to = normalizePath(to);
    if (from === to) return false;

    // moving a file
    if (this.files.has(from)) {
      const f = this.files.get(from);
      if (f.blobUrl) { URL.revokeObjectURL(f.blobUrl); f.blobUrl = null; }
      this.files.delete(from);
      f.path = to; f.name = basename(to); f.mime = mimeOf(to); f.isText = isText(to);
      this.files.set(to, f);
      this._ensureFolders(to);
      bus.emit(EVT.FS_CHANGED);
      return true;
    }

    // moving a folder (and everything beneath it)
    const isFolder = this.folders.has(from) || [...this.files.keys()].some(p => p.startsWith(from + '/'));
    if (isFolder) {
      const fromPrefix = from + '/';
      for (const p of [...this.files.keys()]) {
        if (p.startsWith(fromPrefix)) {
          const np = to + '/' + p.slice(fromPrefix.length);
          const f = this.files.get(p);
          if (f.blobUrl) { URL.revokeObjectURL(f.blobUrl); f.blobUrl = null; }
          this.files.delete(p);
          f.path = np; f.name = basename(np); f.mime = mimeOf(np); f.isText = isText(np);
          this.files.set(np, f);
        }
      }
      for (const d of [...this.folders]) {
        if (d === from || d.startsWith(fromPrefix)) {
          const nd = to + (d === from ? '' : '/' + d.slice(fromPrefix.length));
          this.folders.delete(d);
          this.folders.add(normalizePath(nd));
        }
      }
      this.folders.add(to);
      this._ensureFolders(to + '/_');
      bus.emit(EVT.FS_CHANGED);
      return true;
    }
    return false;
  }

  /** Duplicate a file, returning the new path. */
  duplicate(path) {
    path = normalizePath(path);
    const f = this.files.get(path);
    if (!f) return null;
    const dot = f.name.lastIndexOf('.');
    const stem = dot > 0 ? f.name.slice(0, dot) : f.name;
    const e = dot > 0 ? f.name.slice(dot) : '';
    const dir = dirname(path);
    let i = 1, np;
    do {
      np = normalizePath(`${dir}/${stem}_copy${i > 1 ? i : ''}${e}`);
      i++;
    } while (this.files.has(np));
    if (f.isText) this.setBytes; // no-op guard
    if (f.isText) this.setText(np, f.text);
    else this.setBytes(np, f.bytes.slice());
    return np;
  }

  /** Build a sorted nested tree of {name, path, type, children}. */
  tree() {
    const root = { name: '', path: '', type: 'folder', children: new Map() };
    const ensure = (parts) => {
      let cur = root, acc = '';
      for (const part of parts) {
        acc = acc ? `${acc}/${part}` : part;
        if (!cur.children.has(part)) {
          cur.children.set(part, { name: part, path: acc, type: 'folder', children: new Map() });
        }
        cur = cur.children.get(part);
      }
      return cur;
    };
    for (const folder of this.folders) {
      ensure(folder.split('/'));
    }
    for (const f of this.files.values()) {
      const parts = f.path.split('/');
      const name = parts.pop();
      const parent = parts.length ? ensure(parts) : root;
      parent.children.set(name, { name, path: f.path, type: 'file' });
    }
    const sort = (node) => {
      if (!node.children) return node;
      const arr = [...node.children.values()].map(sort);
      arr.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true });
      });
      node.children = arr;
      return node;
    };
    return sort(root);
  }

  /** Find a sensible default entry HTML (index.html preferred). */
  defaultEntry() {
    const htmls = [...this.files.keys()].filter(p => /\.html?$/i.test(p));
    if (!htmls.length) return null;
    const rootIndex = htmls.find(p => p.toLowerCase() === 'index.html');
    if (rootIndex) return rootIndex;
    htmls.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
    const anyIndex = htmls.find(p => basename(p).toLowerCase() === 'index.html');
    return anyIndex || htmls[0];
  }

  /** All file paths. */
  paths() { return [...this.files.keys()]; }
}

export const vfs = new VFS();
