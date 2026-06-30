/**
 * editor.js — Monaco editor integration.
 *
 * Loads Monaco from CDN (AMD loader), manages one model per open file,
 * auto-saves changes back to the VFS, and exposes editor commands
 * (find, replace, go-to-line, fold, word-wrap, font size).
 */
import { vfs } from '../core/vfs.js';
import { bus, EVT } from '../core/eventBus.js';
import { langOf } from '../core/mime.js';
import { $, debounce } from '../core/utils.js';

const MONACO_BASE = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs';

let monaco = null;
let editor = null;
let ready = null;
const models = new Map();      // path -> monaco model
let currentPath = null;
let fontSize = 14;
let wordWrap = 'on';

/** Load the Monaco AMD loader and the editor core. */
function loadMonaco() {
  if (ready) return ready;
  ready = new Promise((resolve, reject) => {
    const loader = document.createElement('script');
    loader.src = `${MONACO_BASE}/loader.js`;
    loader.onload = () => {
      window.require.config({ paths: { vs: MONACO_BASE } });
      // Worker must be served cross-origin via a small proxy worker.
      window.MonacoEnvironment = {
        getWorkerUrl() {
          // baseUrl must point to the folder CONTAINING the `vs` directory
          // so the worker resolves `vs/...` paths correctly (no double /vs/vs/).
          const baseUrl = MONACO_BASE.replace(/\/vs$/, '/');
          const proxy = `self.MonacoEnvironment={baseUrl:'${baseUrl}'};importScripts('${MONACO_BASE}/base/worker/workerMain.js');`;
          return URL.createObjectURL(new Blob([proxy], { type: 'text/javascript' }));
        },
      };
      window.require(['vs/editor/editor.main'], () => {
        monaco = window.monaco;
        defineThemes();
        resolve(monaco);
      });
    };
    loader.onerror = reject;
    document.head.appendChild(loader);
  });
  return ready;
}

function defineThemes() {
  monaco.editor.defineTheme('orbit-light', {
    base: 'vs', inherit: true, rules: [],
    colors: { 'editor.background': '#ffffff' },
  });
  monaco.editor.defineTheme('orbit-dark', {
    base: 'vs-dark', inherit: true, rules: [],
    colors: { 'editor.background': '#16191f' },
  });
}

function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'orbit-dark' : 'orbit-light';
}

/** Initialize the editor instance into #editorHost. */
export async function initEditor() {
  await loadMonaco();
  editor = monaco.editor.create($('#editorHost'), {
    value: '',
    theme: currentTheme(),
    automaticLayout: true,
    fontSize,
    fontFamily: 'var(--font-mono), monospace',
    minimap: { enabled: !matchMedia('(max-width: 860px)').matches },
    wordWrap,
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    cursorSmoothCaretAnimation: 'on',
    tabSize: 2,
    folding: true,
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true, indentation: true },
    renderWhitespace: 'selection',
    padding: { top: 10 },
    quickSuggestions: true,
    suggestOnTriggerCharacters: true,
    formatOnPaste: true,
    autoIndent: 'full',
    scrollbar: { useShadows: false },
  });

  // Auto-save (debounced) back to the VFS.
  const save = debounce(() => {
    if (!currentPath) return;
    const model = models.get(currentPath);
    if (!model) return;
    vfs.setText(currentPath, model.getValue(), { silent: true });
    bus.emit(EVT.FILE_UPDATED, { path: currentPath });
  }, 350);
  editor.onDidChangeModelContent(() => save());

  bus.on(EVT.THEME_CHANGED, () => monaco.editor.setTheme(currentTheme()));

  return editor;
}

/** Open a text file in the editor, creating a model if needed. */
export async function openInEditor(path) {
  await loadMonaco();
  $('#editorEmpty').classList.add('hidden');
  $('#editorHost').classList.remove('hidden');

  let model = models.get(path);
  if (!model) {
    const uri = monaco.Uri.parse(`inmemory://model/${encodeURIComponent(path)}`);
    model = monaco.editor.createModel(vfs.readText(path) ?? '', langOf(path), uri);
    models.set(path, model);
  } else {
    // keep model in sync if file changed externally (rename etc.)
    const fromVfs = vfs.readText(path);
    if (fromVfs != null && fromVfs !== model.getValue()) model.setValue(fromVfs);
  }
  editor.setModel(model);
  currentPath = path;
  editor.focus();
}

/** Remove a model when its tab closes. */
export function disposeModel(path) {
  const m = models.get(path);
  if (m) { m.dispose(); models.delete(path); }
  if (currentPath === path) currentPath = null;
}

/** Reflect a path rename in the model registry. */
export function renameModel(from, to) {
  const m = models.get(from);
  if (!m) return;
  models.delete(from);
  models.set(to, m);
  if (currentPath === from) currentPath = to;
}

export function showEmpty() {
  $('#editorHost').classList.add('hidden');
  $('#editorEmpty').classList.remove('hidden');
  if (editor) editor.setModel(null);
  currentPath = null;
}

/* ---- Commands exposed to the toolbar / command palette ---- */
export const editorCommands = {
  find() { editor?.getAction('actions.find')?.run(); },
  replace() { editor?.getAction('editor.action.startFindReplaceAction')?.run(); },
  gotoLine() { editor?.getAction('editor.action.gotoLine')?.run(); },
  format() { editor?.getAction('editor.action.formatDocument')?.run(); },
  foldAll() { editor?.getAction('editor.foldAll')?.run(); },
  unfoldAll() { editor?.getAction('editor.unfoldAll')?.run(); },
  commandPalette() { editor?.getAction('editor.action.quickCommand')?.run(); },
  toggleWrap() {
    wordWrap = wordWrap === 'on' ? 'off' : 'on';
    editor?.updateOptions({ wordWrap });
    return wordWrap;
  },
  fontInc() { fontSize = Math.min(28, fontSize + 1); editor?.updateOptions({ fontSize }); return fontSize; },
  fontDec() { fontSize = Math.max(9, fontSize - 1); editor?.updateOptions({ fontSize }); return fontSize; },
  revealLine(line) {
    if (!editor || !line) return;
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: 1 });
    editor.focus();
  },
};

/** Set diagnostic markers for a file path. severity: 'error'|'warning'|'info' */
export function setMarkers(path, markers) {
  if (!monaco) return;
  const model = models.get(path);
  if (!model) return;
  const sev = { error: monaco.MarkerSeverity.Error, warning: monaco.MarkerSeverity.Warning, info: monaco.MarkerSeverity.Info };
  monaco.editor.setModelMarkers(model, 'orbit', markers.map(m => ({
    severity: sev[m.severity] || sev.error,
    message: m.message,
    startLineNumber: m.line || 1, startColumn: m.column || 1,
    endLineNumber: m.line || 1, endColumn: m.endColumn || 200,
  })));
}

export function getEditor() { return editor; }
export function getCurrentPath() { return currentPath; }
