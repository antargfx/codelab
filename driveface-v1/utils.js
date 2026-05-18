/**
 * utils.js — Shared utilities for DriveFace Finder
 *
 * Globals exported:
 *   Toast            – notification system
 *   FaceCache        – IndexedDB face descriptor cache
 *   Storage          – localStorage wrapper
 *   RecentSearches   – last 5 searched folders
 *   ScanHistory      – last 20 scan results
 *   ImageUtils       – image loading / resizing helpers
 *   ZipDownloader    – bulk photo ZIP creator
 *   Utils            – misc helpers (debounce, escape, etc.)
 */

'use strict';

/* ════════════════════════════════════════════════════════
   TOAST NOTIFICATIONS
════════════════════════════════════════════════════════ */
const Toast = (() => {
  let container = null;

  const ICONS = {
    success: 'fa-circle-check',
    error:   'fa-circle-xmark',
    warning: 'fa-triangle-exclamation',
    info:    'fa-circle-info',
  };

  function init() { container = document.getElementById('toast-container'); }

  function show(message, type = 'info', duration = 4500) {
    if (!container) init();
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<i class="fa-solid ${ICONS[type] || ICONS.info}"></i><span>${esc(String(message))}</span>`;
    container.appendChild(el);

    const dismiss = () => {
      el.classList.add('out');
      el.addEventListener('animationend', () => el.remove(), { once: true });
    };
    const timer = setTimeout(dismiss, duration);
    el.addEventListener('click', () => { clearTimeout(timer); dismiss(); });
  }

  function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  return {
    init,
    show,
    success: (m, d) => show(m, 'success', d),
    error:   (m, d) => show(m, 'error',   d),
    warning: (m, d) => show(m, 'warning', d),
    info:    (m, d) => show(m, 'info',    d),
  };
})();


/* ════════════════════════════════════════════════════════
   INDEXEDDB — FACE DESCRIPTOR CACHE
   Key: Drive file ID
   Value: { id, descriptor: number[], filename, ts }
   Empty descriptor (length 0) = "no face found" sentinel.
════════════════════════════════════════════════════════ */
const FaceCache = (() => {
  const DB   = 'DriveFaceFinder';
  const VER  = 1;
  const STR  = 'descriptors';
  let db = null;

  async function init() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, VER);
      r.onerror = () => rej(r.error);
      r.onsuccess = () => { db = r.result; res(); };
      r.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STR)) d.createObjectStore(STR, { keyPath: 'id' });
      };
    });
  }

  async function get(fileId) {
    if (!db) return null; // treat as cache miss
    return new Promise(resolve => {
      try {
        const tx  = db.transaction(STR, 'readonly');
        const req = tx.objectStore(STR).get(fileId);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror   = () => resolve(null);
      } catch { resolve(null); }
    });
  }

  async function set(fileId, descriptor, filename) {
    if (!db) return;
    return new Promise(resolve => {
      try {
        const tx = db.transaction(STR, 'readwrite');
        tx.objectStore(STR).put({
          id:         fileId,
          descriptor: descriptor ? Array.from(descriptor) : [],
          filename:   filename || '',
          ts:         Date.now(),
        });
        tx.oncomplete = resolve;
        tx.onerror    = resolve;
      } catch { resolve(); }
    });
  }

  async function clear() {
    if (!db) return;
    return new Promise(resolve => {
      try {
        const tx = db.transaction(STR, 'readwrite');
        tx.objectStore(STR).clear();
        tx.oncomplete = resolve;
        tx.onerror    = resolve;
      } catch { resolve(); }
    });
  }

  async function count() {
    if (!db) return 0;
    return new Promise(resolve => {
      try {
        const tx  = db.transaction(STR, 'readonly');
        const req = tx.objectStore(STR).count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror   = () => resolve(0);
      } catch { resolve(0); }
    });
  }

  return { init, get, set, clear, count };
})();


/* ════════════════════════════════════════════════════════
   LOCALSTORAGE WRAPPER
════════════════════════════════════════════════════════ */
const Storage = {
  get(key, def = null) {
    try { const v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : def; }
    catch { return def; }
  },
  set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} },
  remove(key)   { try { localStorage.removeItem(key); } catch {} },
};


/* ════════════════════════════════════════════════════════
   RECENT SEARCHES
════════════════════════════════════════════════════════ */
const RecentSearches = {
  KEY: 'dff_recent', MAX: 5,
  get()  { return Storage.get(this.KEY, []); },
  add(id, name) {
    let l = this.get().filter(r => r.id !== id);
    l.unshift({ id, name: name || id, ts: Date.now() });
    Storage.set(this.KEY, l.slice(0, this.MAX));
  },
  clear() { Storage.remove(this.KEY); },
};


/* ════════════════════════════════════════════════════════
   SCAN HISTORY
════════════════════════════════════════════════════════ */
const ScanHistory = {
  KEY: 'dff_history', MAX: 20,
  get()  { return Storage.get(this.KEY, []); },
  add(entry) {
    let l = this.get();
    l.unshift({ ...entry, id: Date.now() });
    Storage.set(this.KEY, l.slice(0, this.MAX));
  },
  clear() { Storage.remove(this.KEY); },
};


/* ════════════════════════════════════════════════════════
   IMAGE UTILITIES
════════════════════════════════════════════════════════ */
const ImageUtils = {
  /**
   * Resize an image element to fit within maxDim × maxDim.
   * Returns a canvas ready for face-api.js inference.
   */
  resizeToCanvas(img, maxDim = 640) {
    let w = img.naturalWidth  || img.width  || 640;
    let h = img.naturalHeight || img.height || 480;
    if (w > h) { if (w > maxDim) { h = Math.round(h * maxDim / w); w = maxDim; } }
    else        { if (h > maxDim) { w = Math.round(w * maxDim / h); h = maxDim; } }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c;
  },

  /**
   * Load a Blob as an HTMLImageElement via object URL.
   * Call revokeImage() when done to avoid memory leaks.
   */
  blobToImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img._objUrl = url;
      img.onload  = () => resolve(img);
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
      img.src = url;
    });
  },

  revokeImage(img) {
    if (img?._objUrl) { URL.revokeObjectURL(img._objUrl); img._objUrl = null; }
  },

  fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload  = e => resolve(e.target.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  },

  dataURLToImage(dataURL) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload  = () => resolve(img);
      img.onerror = reject;
      img.src = dataURL;
    });
  },
};


/* ════════════════════════════════════════════════════════
   ZIP DOWNLOADER
   Downloads matched Drive images and packages them as ZIP.
   Uses lh3.googleusercontent.com — no API key required.
════════════════════════════════════════════════════════ */
const ZipDownloader = {
  /**
   * @param {Array<{id, name}>} files      Drive file objects
   * @param {null}              _apiKey    (unused — kept for API compat)
   * @param {Function}          onProgress (pct:number) => void
   */
  async download(files, _apiKey, onProgress) {
    if (!window.JSZip) throw new Error('JSZip library not loaded.');

    const zip    = new JSZip();
    const folder = zip.folder('my_photos');
    let   done   = 0;
    const BATCH  = 4; // parallel downloads

    for (let i = 0; i < files.length; i += BATCH) {
      const batch = files.slice(i, i + BATCH);

      await Promise.allSettled(batch.map(async file => {
        // Primary: lh3 CDN URL (CORS-enabled for public files)
        const urls = [
          `https://lh3.googleusercontent.com/d/${file.id}`,
          `https://drive.google.com/thumbnail?id=${file.id}&sz=w1600`,
        ];

        for (const url of urls) {
          try {
            const res = await fetch(url, { redirect: 'follow' });
            if (!res.ok) continue;
            const blob = await res.blob();
            if (blob.size < 500) continue; // skip tiny/error responses

            const ext  = blob.type.includes('png')  ? 'png'
                       : blob.type.includes('webp') ? 'webp'
                       : 'jpg';
            const name = file.name || `photo_${file.id}.${ext}`;
            folder.file(name, blob);
            break; // success
          } catch { /* try next URL */ }
        }
      }));

      done += batch.length;
      if (onProgress) onProgress(Math.round((done / files.length) * 100));
    }

    const content = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 2 }, // fast — photos are already compressed
    });

    const a = document.createElement('a');
    a.href     = URL.createObjectURL(content);
    a.download = `my_photos_${Date.now()}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  },
};


/* ════════════════════════════════════════════════════════
   GENERAL UTILITIES
════════════════════════════════════════════════════════ */
const Utils = {
  /** Safely escape a string for use in innerHTML */
  esc(str) {
    const d = document.createElement('div');
    d.textContent = String(str ?? '');
    return d.innerHTML;
  },

  /**
   * Extract a Google Drive folder ID from a URL or bare ID string.
   *
   * Handles:
   *   https://drive.google.com/drive/folders/FOLDER_ID
   *   https://drive.google.com/drive/u/0/folders/FOLDER_ID
   *   https://drive.google.com/open?id=FOLDER_ID
   *   A bare FOLDER_ID (alphanumeric, _, -)
   */
  extractFolderId(input) {
    if (!input) return null;
    const s = input.trim();
    // Bare ID check — Drive IDs are 25–44 chars
    if (/^[A-Za-z0-9_-]{20,60}$/.test(s)) return s;
    for (const p of [
      /\/folders\/([A-Za-z0-9_-]{15,})/,
      /[?&]id=([A-Za-z0-9_-]{15,})/,
      /\/d\/([A-Za-z0-9_-]{15,})/,
    ]) {
      const m = s.match(p);
      if (m) return m[1];
    }
    return null;
  },

  /** Format a timestamp → "Jan 5, 2025" */
  fmtDate(ts) {
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  },

  /** Milliseconds → "1m 23s" */
  fmtDuration(ms) {
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  },

  /** Map a 0-100 similarity score to a label + CSS modifier class */
  confidenceInfo(score) {
    if (score >= 82) return { label: `${score}% · High`, cls: '' };
    if (score >= 65) return { label: `${score}% · Med`,  cls: 'med' };
    return               { label: `${score}% · Low`,  cls: 'low' };
  },

  clamp: (n, lo, hi) => Math.max(lo, Math.min(hi, n)),
  sleep: ms => new Promise(r => setTimeout(r, ms)),

  debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  },

  throttle(fn, ms) {
    let last = 0;
    return (...args) => { const now = Date.now(); if (now - last >= ms) { last = now; fn(...args); } };
  },
};
