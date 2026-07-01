/**
 * codeEditor.js — self-contained code editor (no CDN, no external CSS).
 *
 * Every visual property is applied as an INLINE style from JavaScript, so the
 * editor renders correctly even if a stylesheet is stale/cached/missing or a
 * CDN is blocked. This guarantees code is always visible and editable on any
 * browser, including Android Chrome.
 *
 * Layout: [line-number gutter] [textarea]. A native <textarea> is the source
 * of truth — it always paints on every browser. Auto-saves to the VFS.
 */
import { vfs } from '../core/vfs.js';
import { bus, EVT } from '../core/eventBus.js';
import { $, debounce } from '../core/utils.js';

let host, wrap, gutter, area;
let currentPath = null;
let fontSize = 14;
let wrapOn = false;
let lastSearch = '';

const MONO = "'SFMono-Regular', ui-monospace, 'JetBrains Mono', Menlo, Consolas, 'Courier New', monospace";

function colors() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  return dark
    ? { bg: '#16191f', fg: '#e6e6e6', gutBg: '#1b1f27', gutFg: '#6b7280', border: '#2a2f3a', caret: '#ff7a45' }
    : { bg: '#ffffff', fg: '#1f1f1f', gutBg: '#f5f6f8', gutFg: '#9aa0a6', border: '#e5e7eb', caret: '#ff5a1f' };
}

export function initEditor2() {
  host = $('#editorHost');
  host.innerHTML = '';
  // Make sure the host itself is visible and sized regardless of stylesheet.
  host.style.cssText = 'position:absolute;inset:0;display:block;overflow:hidden;';

  wrap = document.createElement('div');
  gutter = document.createElement('div');
  area = document.createElement('textarea');

  gutter.setAttribute('aria-hidden', 'true');
  area.setAttribute('spellcheck', 'false');
  area.setAttribute('autocapitalize', 'off');
  area.setAttribute('autocomplete', 'off');
  area.setAttribute('autocorrect', 'off');
  area.setAttribute('wrap', 'off');

  wrap.append(gutter, area);
  host.appendChild(wrap);

  applyStyles();

  const save = debounce(() => {
    if (!currentPath) return;
    vfs.setText(currentPath, area.value, { silent: true });
    bus.emit(EVT.FILE_UPDATED, { path: currentPath });
  }, 300);

  area.addEventListener('input', () => { renderGutter(); save(); });
  area.addEventListener('scroll', () => { gutter.scrollTop = area.scrollTop; });
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = area.selectionStart, en = area.selectionEnd;
      area.value = area.value.slice(0, s) + '  ' + area.value.slice(en);
      area.selectionStart = area.selectionEnd = s + 2;
      renderGutter(); save();
    }
  });

  bus.on(EVT.THEME_CHANGED, applyStyles);
  // Keep the editor sized to its container.
  if (window.ResizeObserver) {
    new ResizeObserver(() => sizeToHost()).observe(host);
  }
  window.addEventListener('resize', sizeToHost);
}

function applyStyles() {
  const c = colors();
  const lh = Math.round(fontSize * 1.6);
  wrap.style.cssText = [
    'display:flex', 'width:100%', 'height:100%', 'min-height:200px',
    'box-sizing:border-box', `background:${c.bg}`, 'overflow:hidden',
    `font-family:${MONO}`, `font-size:${fontSize}px`, `line-height:${lh}px`,
  ].join(';');

  gutter.style.cssText = [
    'flex:0 0 auto', 'min-width:44px', 'padding:10px 8px 10px 6px', 'margin:0',
    'text-align:right', `color:${c.gutFg}`, `background:${c.gutBg}`,
    `border-right:1px solid ${c.border}`, 'white-space:pre', 'overflow:hidden',
    'user-select:none', '-webkit-user-select:none', `font-family:${MONO}`,
    `font-size:${fontSize}px`, `line-height:${lh}px`,
    'box-sizing:border-box',
  ].join(';');

  area.style.cssText = [
    'flex:1 1 auto', 'width:100%', 'height:100%', 'border:0', 'outline:0',
    'resize:none', 'margin:0', 'padding:10px 12px', 'background:transparent',
    `font-family:${MONO}`, `font-size:${fontSize}px`, `line-height:${lh}px`,
    wrapOn ? 'white-space:pre-wrap' : 'white-space:pre',
    'overflow:auto', '-webkit-overflow-scrolling:touch', 'tab-size:2',
    'box-sizing:border-box', 'display:block', 'border-radius:0',
    '-webkit-appearance:none', 'appearance:none',
  ].join(';');
  // Force color with priority so no other rule can hide the text.
  area.style.setProperty('color', c.fg, 'important');
  area.style.setProperty('caret-color', c.caret, 'important');
  area.style.setProperty('-webkit-text-fill-color', c.fg, 'important');
  renderGutter();
}

/** Ensure the wrapper has a real pixel height even if flex/absolute fails. */
function sizeToHost() {
  if (!host || !wrap) return;
  const h = host.clientHeight;
  if (h > 0) { wrap.style.height = h + 'px'; }
  else {
    // Fallback: derive from viewport so it is never zero.
    const top = host.getBoundingClientRect().top;
    wrap.style.height = Math.max(220, window.innerHeight - top - 70) + 'px';
  }
  renderGutter();
}

export function openInEditor2(path) {
  $('#editorEmpty').classList.add('hidden');
  host.classList.remove('hidden');
  host.style.display = 'block';
  currentPath = path;
  area.value = vfs.readText(path) ?? '';
  renderGutter();
  area.scrollTop = 0;
  sizeToHost();
  setTimeout(sizeToHost, 60);
}

function renderGutter() {
  if (!area || !gutter) return;
  const lines = (area.value.match(/\n/g) || []).length + 1;
  let s = '';
  for (let i = 1; i <= lines; i++) s += i + '\n';
  gutter.textContent = s;
  gutter.scrollTop = area.scrollTop;
}

export function showEmpty2() {
  $('#editorHost').classList.add('hidden');
  $('#editorEmpty').classList.remove('hidden');
  currentPath = null;
}

export function relayout2() { sizeToHost(); }

/* ---- commands (prompt-based, work everywhere incl. Android) ---- */
export const editorCommands2 = {
  find() {
    const term = window.prompt('Find:', lastSearch);
    if (term == null || term === '') return;
    lastSearch = term;
    const from = area.selectionEnd || 0;
    let idx = area.value.indexOf(term, from);
    if (idx < 0) idx = area.value.indexOf(term, 0);
    if (idx >= 0) { area.focus(); area.setSelectionRange(idx, idx + term.length); revealIndex(idx); }
    else window.alert('Not found');
  },
  replace() {
    const term = window.prompt('Replace — find:', lastSearch);
    if (!term) return;
    const repl = window.prompt('Replace with:', '');
    if (repl == null) return;
    const count = area.value.split(term).length - 1;
    area.value = area.value.split(term).join(repl);
    renderGutter(); commitSave();
    window.alert(`Replaced ${count} occurrence(s)`);
  },
  gotoLine() {
    const n = parseInt(window.prompt('Go to line:', '1'), 10);
    if (!isNaN(n)) editorCommands2.revealLine(n);
  },
  format() {/* no-op for plain editor */},
  foldAll() {}, unfoldAll() {}, commandPalette() {},
  toggleWrap() { wrapOn = !wrapOn; applyStyles(); return wrapOn ? 'on' : 'off'; },
  fontInc() { fontSize = Math.min(30, fontSize + 1); applyStyles(); sizeToHost(); return fontSize; },
  fontDec() { fontSize = Math.max(9, fontSize - 1); applyStyles(); sizeToHost(); return fontSize; },
  revealLine(line) {
    if (!area || !line) return;
    const lh = Math.round(fontSize * 1.6);
    const pos = area.value.split('\n').slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0);
    area.focus(); area.setSelectionRange(pos, pos);
    area.scrollTop = Math.max(0, (line - 3) * lh);
    gutter.scrollTop = area.scrollTop;
  },
};

function revealIndex(idx) {
  const line = area.value.slice(0, idx).split('\n').length;
  const lh = Math.round(fontSize * 1.6);
  area.scrollTop = Math.max(0, (line - 3) * lh);
  gutter.scrollTop = area.scrollTop;
}
function commitSave() {
  if (!currentPath) return;
  vfs.setText(currentPath, area.value, { silent: true });
  bus.emit(EVT.FILE_UPDATED, { path: currentPath });
}

export function getCurrentPath2() { return currentPath; }
