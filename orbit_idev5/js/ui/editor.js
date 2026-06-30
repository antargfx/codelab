/**
 * editor.js — code editor powered by CodeMirror 5.
 *
 * CodeMirror is lightweight and renders reliably on Android Chrome (Monaco
 * was rendering blank on mobile). One CodeMirror instance is reused; each
 * open file gets its own CodeMirror.Doc that is swapped in on activation.
 * Changes auto-save to the VFS. If the CDN cannot load, a built-in
 * line-numbered fallback editor is used so code is always visible.
 */
import { vfs } from '../core/vfs.js';
import { bus, EVT } from '../core/eventBus.js';
import { ext } from '../core/mime.js';
import { $, debounce } from '../core/utils.js';
import { initFallback, fbOpen, fbCommands, fbRelayout } from './fallbackEditor.js';

const CM = 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16';
const LOAD_TIMEOUT = 12000;

let cm = null;                 // the single CodeMirror instance
let ready = null;
let useFallback = false;
const docs = new Map();        // path -> CodeMirror.Doc
const markersByPath = new Map();
let currentPath = null;
let fontSize = 14;
let wrapOn = false;

/* ---------- resource loading ---------- */
function loadCSS(href) {
  return new Promise((resolve) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href;
    l.onload = resolve; l.onerror = resolve; // non-fatal
    document.head.appendChild(l);
  });
}
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = false;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
}

function loadCodeMirror() {
  if (ready) return ready;
  ready = (async () => {
    // Styles (order matters for theme overrides)
    loadCSS(`${CM}/codemirror.min.css`);
    loadCSS(`${CM}/theme/eclipse.min.css`);
    loadCSS(`${CM}/theme/dracula.min.css`);
    loadCSS(`${CM}/addon/fold/foldgutter.min.css`);
    loadCSS(`${CM}/addon/dialog/dialog.min.css`);

    // Core first, then modes, then addons — order is significant.
    const scripts = [
      `${CM}/codemirror.min.js`,
      `${CM}/mode/xml/xml.min.js`,
      `${CM}/mode/javascript/javascript.min.js`,
      `${CM}/mode/css/css.min.js`,
      `${CM}/mode/htmlmixed/htmlmixed.min.js`,
      `${CM}/mode/markdown/markdown.min.js`,
      `${CM}/addon/edit/closebrackets.min.js`,
      `${CM}/addon/edit/closetag.min.js`,
      `${CM}/addon/edit/matchbrackets.min.js`,
      `${CM}/addon/comment/comment.min.js`,
      `${CM}/addon/selection/active-line.min.js`,
      `${CM}/addon/fold/foldcode.min.js`,
      `${CM}/addon/fold/foldgutter.min.js`,
      `${CM}/addon/fold/brace-fold.min.js`,
      `${CM}/addon/fold/xml-fold.min.js`,
      `${CM}/addon/fold/comment-fold.min.js`,
      `${CM}/addon/dialog/dialog.min.js`,
      `${CM}/addon/search/searchcursor.min.js`,
      `${CM}/addon/search/search.min.js`,
      `${CM}/addon/search/jump-to-line.min.js`,
      `${CM}/addon/hint/show-hint.min.js`,
    ];
    for (const src of scripts) await loadScript(src);
    if (!window.CodeMirror) throw new Error('CodeMirror global missing');
  })();

  return Promise.race([
    ready,
    new Promise((_, rej) => setTimeout(() => rej(new Error('CodeMirror load timeout')), LOAD_TIMEOUT)),
  ]);
}

/* ---------- mode + theme helpers ---------- */
function modeForPath(path) {
  switch (ext(path)) {
    case 'html': case 'htm': return 'htmlmixed';
    case 'css': case 'scss': case 'less': return 'css';
    case 'js': case 'mjs': case 'cjs': case 'jsx': return { name: 'javascript', json: false };
    case 'json': return { name: 'javascript', json: true };
    case 'xml': case 'svg': return 'xml';
    case 'md': case 'markdown': return 'markdown';
    default: return 'null';
  }
}
function themeName() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dracula' : 'eclipse';
}

/* ---------- init ---------- */
export async function initEditor() {
  try {
    await loadCodeMirror();
  } catch (err) {
    console.warn('[editor] CodeMirror unavailable, using fallback:', err.message);
    useFallback = true;
    initFallback();
    return null;
  }

  const host = $('#editorHost');
  host.innerHTML = '';
  cm = window.CodeMirror(host, {
    value: '',
    mode: 'htmlmixed',
    theme: themeName(),
    lineNumbers: true,
    matchBrackets: true,
    autoCloseBrackets: true,
    autoCloseTags: true,
    styleActiveLine: true,
    indentUnit: 2,
    tabSize: 2,
    indentWithTabs: false,
    lineWrapping: false,
    foldGutter: true,
    gutters: ['CodeMirror-linenumbers', 'orbit-errors', 'CodeMirror-foldgutter'],
    scrollbarStyle: 'native',
    inputStyle: 'contenteditable',  // crucial for reliable mobile keyboards
    extraKeys: {
      'Tab': (c) => c.execCommand('indentMore'),
      'Shift-Tab': (c) => c.execCommand('indentLess'),
      'Ctrl-/': (c) => c.execCommand('toggleComment'),
      'Cmd-/': (c) => c.execCommand('toggleComment'),
      'Ctrl-F': 'findPersistent', 'Cmd-F': 'findPersistent',
      'Ctrl-H': 'replace', 'Cmd-Alt-F': 'replace',
      'Ctrl-Space': 'autocomplete',
    },
  });

  const save = debounce(() => {
    if (!currentPath) return;
    vfs.setText(currentPath, cm.getValue(), { silent: true });
    bus.emit(EVT.FILE_UPDATED, { path: currentPath });
  }, 350);
  cm.on('change', () => save());

  bus.on(EVT.THEME_CHANGED, () => cm.setOption('theme', themeName()));
  window.addEventListener('resize', () => relayout());
  applyFont();
  return cm;
}

/* ---------- open / manage docs ---------- */
export async function openInEditor(path) {
  $('#editorEmpty').classList.add('hidden');
  $('#editorHost').classList.remove('hidden');

  if (useFallback) { fbOpen(path); currentPath = path; return; }
  if (!cm) return;

  let doc = docs.get(path);
  if (!doc) {
    doc = window.CodeMirror.Doc(vfs.readText(path) ?? '', modeForPath(path));
    docs.set(path, doc);
  } else {
    const fromVfs = vfs.readText(path);
    if (fromVfs != null && fromVfs !== doc.getValue()) doc.setValue(fromVfs);
  }
  cm.swapDoc(doc);
  currentPath = path;
  applyMarkers(path);
  // Refresh after the pane is visible (covers mobile pane reveal).
  relayout();
  requestAnimationFrame(relayout);
  setTimeout(relayout, 120);
  cm.focus();
}

export function relayout() {
  if (useFallback) { fbRelayout(); return; }
  if (cm) cm.refresh();
}

export function disposeModel(path) {
  docs.delete(path);
  markersByPath.delete(path);
  if (currentPath === path) currentPath = null;
}

export function renameModel(from, to) {
  if (docs.has(from)) { docs.set(to, docs.get(from)); docs.delete(from); }
  if (markersByPath.has(from)) { markersByPath.set(to, markersByPath.get(from)); markersByPath.delete(from); }
  if (currentPath === from) currentPath = to;
}

export function showEmpty() {
  $('#editorHost').classList.add('hidden');
  $('#editorEmpty').classList.remove('hidden');
  if (cm) cm.swapDoc(window.CodeMirror.Doc('', 'null'));
  currentPath = null;
}

/* ---------- error markers (gutter) ---------- */
export function setMarkers(path, markers) {
  markersByPath.set(path, markers || []);
  if (path === currentPath) applyMarkers(path);
}
function applyMarkers(path) {
  if (useFallback || !cm) return;
  cm.clearGutter('orbit-errors');
  const markers = markersByPath.get(path) || [];
  for (const m of markers) {
    const line = (m.line || 1) - 1;
    const dot = document.createElement('div');
    dot.textContent = m.severity === 'warning' ? '▲' : '●';
    dot.title = m.message || '';
    dot.style.cssText = `color:${m.severity === 'warning' ? '#ea580c' : '#dc2626'};font-size:11px;line-height:1`;
    try { cm.setGutterMarker(line, 'orbit-errors', dot); } catch {}
  }
}

/* ---------- commands ---------- */
export const editorCommands = {
  find() { useFallback ? fbCommands.find() : cm && cm.execCommand('findPersistent'); },
  replace() { if (!useFallback && cm) cm.execCommand('replace'); },
  gotoLine() { if (!useFallback && cm) cm.execCommand('jumpToLine'); },
  format() {
    if (useFallback || !cm) return;
    cm.operation(() => {
      const last = cm.lineCount();
      for (let i = 0; i < last; i++) cm.indentLine(i, 'smart');
    });
  },
  foldAll() {
    if (useFallback || !cm) return;
    cm.operation(() => {
      for (let i = 0; i < cm.lineCount(); i++) cm.foldCode(window.CodeMirror.Pos(i, 0), null, 'fold');
    });
  },
  unfoldAll() {
    if (useFallback || !cm) return;
    cm.operation(() => {
      for (let i = 0; i < cm.lineCount(); i++) cm.foldCode(window.CodeMirror.Pos(i, 0), null, 'unfold');
    });
  },
  commandPalette() {},
  toggleWrap() {
    if (useFallback) return fbCommands.toggleWrap();
    wrapOn = !wrapOn;
    cm && cm.setOption('lineWrapping', wrapOn);
    return wrapOn ? 'on' : 'off';
  },
  fontInc() {
    if (useFallback) return fbCommands.fontInc();
    fontSize = Math.min(28, fontSize + 1); applyFont(); return fontSize;
  },
  fontDec() {
    if (useFallback) return fbCommands.fontDec();
    fontSize = Math.max(9, fontSize - 1); applyFont(); return fontSize;
  },
  revealLine(line) {
    if (useFallback) return fbCommands.revealLine(line);
    if (!cm || !line) return;
    cm.setCursor({ line: line - 1, ch: 0 });
    const top = cm.charCoords({ line: line - 1, ch: 0 }, 'local').top;
    cm.scrollTo(null, top - cm.getScrollInfo().clientHeight / 2);
    cm.focus();
  },
};

function applyFont() {
  if (useFallback || !cm) return;
  cm.getWrapperElement().style.fontSize = fontSize + 'px';
  cm.refresh();
}

export function getEditor() { return cm; }
export function getCurrentPath() { return currentPath; }
export function isFallback() { return useFallback; }
