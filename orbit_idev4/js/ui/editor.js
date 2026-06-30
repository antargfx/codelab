/**
 * editor.js — code editor integration.
 *
 * Primary: Monaco editor (loaded from CDN) with one model per open file,
 * auto-save to the VFS, and full command surface.
 * Fallback: if Monaco cannot load (flaky network / blocked CDN) within a
 * timeout, a dependency-free line-numbered editor is used instead, so code
 * is ALWAYS visible and editable.
 */
import { vfs } from '../core/vfs.js';
import { bus, EVT } from '../core/eventBus.js';
import { langOf } from '../core/mime.js';
import { $, debounce, isMobile, isTouch } from '../core/utils.js';
import { initFallback, fbOpen, fbCommands, fbRelayout } from './fallbackEditor.js';

const MONACO_BASE = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs';
const LOAD_TIMEOUT = 9000;

let monaco = null;
let editor = null;
let ready = null;
let useFallback = false;
const models = new Map();      // path -> monaco model
let currentPath = null;
let fontSize = 14;
let wordWrap = 'on';

/** Load the Monaco AMD loader and editor core, rejecting on timeout. */
function loadMonaco() {
  if (ready) return ready;
  ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Monaco load timeout')), LOAD_TIMEOUT);
    const loader = document.createElement('script');
    loader.src = `${MONACO_BASE}/loader.js`;
    loader.onload = () => {
      try {
        window.require.config({ paths: { vs: MONACO_BASE } });
        window.MonacoEnvironment = {
          getWorkerUrl() {
            const baseUrl = MONACO_BASE.replace(/\/vs$/, '/');
            const proxy = `self.MonacoEnvironment={baseUrl:'${baseUrl}'};importScripts('${MONACO_BASE}/base/worker/workerMain.js');`;
            return URL.createObjectURL(new Blob([proxy], { type: 'text/javascript' }));
          },
        };
        window.require(['vs/editor/editor.main'], () => {
          clearTimeout(timer);
          monaco = window.monaco;
          defineThemes();
          resolve(monaco);
        }, (err) => { clearTimeout(timer); reject(err); });
      } catch (err) { clearTimeout(timer); reject(err); }
    };
    loader.onerror = () => { clearTimeout(timer); reject(new Error('Monaco loader failed')); };
    document.head.appendChild(loader);
  });
  return ready;
}

function defineThemes() {
  monaco.editor.defineTheme('orbit-light', { base: 'vs', inherit: true, rules: [], colors: { 'editor.background': '#ffffff' } });
  monaco.editor.defineTheme('orbit-dark', { base: 'vs-dark', inherit: true, rules: [], colors: { 'editor.background': '#16191f' } });
}
function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'orbit-dark' : 'orbit-light';
}

/** Initialize the editor. Falls back to the simple editor on failure. */
export async function initEditor() {
  // On mobile/touch, Monaco frequently renders blank when created inside a
  // hidden pane (and is awkward to use with touch keyboards). Use the
  // reliable built-in editor there; keep Monaco for desktop.
  if (isMobile() || isTouch) {
    useFallback = true;
    initFallback();
    bus.on(EVT.THEME_CHANGED, () => {});
    return null;
  }

  try {
    await loadMonaco();
  } catch (err) {
    console.warn('[editor] Monaco unavailable, using fallback editor:', err.message);
    useFallback = true;
    initFallback();
    bus.on(EVT.THEME_CHANGED, () => {});
    return null;
  }

  editor = monaco.editor.create($('#editorHost'), {
    value: '', theme: currentTheme(), automaticLayout: true,
    fontSize, fontFamily: 'var(--font-mono), monospace',
    minimap: { enabled: !matchMedia('(max-width: 860px)').matches },
    wordWrap, scrollBeyondLastLine: false, smoothScrolling: true,
    cursorSmoothCaretAnimation: 'on', tabSize: 2, folding: true,
    lineNumbers: 'on', lineNumbersMinChars: 3, glyphMargin: false,
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true, indentation: true },
    renderWhitespace: 'selection', padding: { top: 10 },
    quickSuggestions: true, suggestOnTriggerCharacters: true,
    formatOnPaste: true, autoIndent: 'full', scrollbar: { useShadows: false },
  });

  const save = debounce(() => {
    if (!currentPath) return;
    const model = models.get(currentPath);
    if (!model) return;
    vfs.setText(currentPath, model.getValue(), { silent: true });
    bus.emit(EVT.FILE_UPDATED, { path: currentPath });
  }, 350);
  editor.onDidChangeModelContent(() => save());

  bus.on(EVT.THEME_CHANGED, () => monaco.editor.setTheme(currentTheme()));
  // Recompute layout when the window changes (covers mobile pane reveals).
  window.addEventListener('resize', () => relayout());
  return editor;
}

/** Open a text file, creating a model if needed. */
export async function openInEditor(path) {
  $('#editorEmpty').classList.add('hidden');
  $('#editorHost').classList.remove('hidden');

  if (useFallback) {
    fbOpen(path);
    currentPath = path;
    return;
  }

  let model = models.get(path);
  if (!model) {
    const uri = monaco.Uri.parse(`inmemory://model/${encodeURIComponent(path)}`);
    model = monaco.editor.createModel(vfs.readText(path) ?? '', langOf(path), uri);
    models.set(path, model);
  } else {
    const fromVfs = vfs.readText(path);
    if (fromVfs != null && fromVfs !== model.getValue()) model.setValue(fromVfs);
  }
  editor.setModel(model);
  currentPath = path;
  // Force a layout pass after the pane is visible (critical on mobile).
  relayout();
  requestAnimationFrame(relayout);
  setTimeout(relayout, 120);
  editor.focus();
}

/** Recompute editor dimensions (no-op for fallback besides gutter). */
export function relayout() {
  if (useFallback) { fbRelayout(); return; }
  if (editor) {
    const host = $('#editorHost');
    if (host && host.clientHeight > 0) editor.layout();
    else editor.layout();
  }
}

export function disposeModel(path) {
  const m = models.get(path);
  if (m) { m.dispose(); models.delete(path); }
  if (currentPath === path) currentPath = null;
}

export function renameModel(from, to) {
  const m = models.get(from);
  if (!m) return;
  models.delete(from); models.set(to, m);
  if (currentPath === from) currentPath = to;
}

export function showEmpty() {
  $('#editorHost').classList.add('hidden');
  $('#editorEmpty').classList.remove('hidden');
  if (editor) editor.setModel(null);
  currentPath = null;
}

/* ---- Commands ---- */
export const editorCommands = {
  find() { useFallback ? fbCommands.find() : editor?.getAction('actions.find')?.run(); },
  replace() { if (!useFallback) editor?.getAction('editor.action.startFindReplaceAction')?.run(); },
  gotoLine() { if (!useFallback) editor?.getAction('editor.action.gotoLine')?.run(); },
  format() { if (!useFallback) editor?.getAction('editor.action.formatDocument')?.run(); },
  foldAll() { if (!useFallback) editor?.getAction('editor.foldAll')?.run(); },
  unfoldAll() { if (!useFallback) editor?.getAction('editor.unfoldAll')?.run(); },
  commandPalette() { if (!useFallback) editor?.getAction('editor.action.quickCommand')?.run(); },
  toggleWrap() {
    if (useFallback) return fbCommands.toggleWrap();
    wordWrap = wordWrap === 'on' ? 'off' : 'on';
    editor?.updateOptions({ wordWrap });
    return wordWrap;
  },
  fontInc() {
    if (useFallback) return fbCommands.fontInc();
    fontSize = Math.min(28, fontSize + 1); editor?.updateOptions({ fontSize }); return fontSize;
  },
  fontDec() {
    if (useFallback) return fbCommands.fontDec();
    fontSize = Math.max(9, fontSize - 1); editor?.updateOptions({ fontSize }); return fontSize;
  },
  revealLine(line) {
    if (useFallback) return fbCommands.revealLine(line);
    if (!editor || !line) return;
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: 1 });
    editor.focus();
  },
};

export function setMarkers(path, markers) {
  if (useFallback || !monaco) return;
  const model = models.get(path);
  if (!model) return;
  const sev = { error: monaco.MarkerSeverity.Error, warning: monaco.MarkerSeverity.Warning, info: monaco.MarkerSeverity.Info };
  monaco.editor.setModelMarkers(model, 'orbit', markers.map(m => ({
    severity: sev[m.severity] || sev.error, message: m.message,
    startLineNumber: m.line || 1, startColumn: m.column || 1,
    endLineNumber: m.line || 1, endColumn: m.endColumn || 200,
  })));
}

export function getEditor() { return editor; }
export function getCurrentPath() { return currentPath; }
export function isFallback() { return useFallback; }
