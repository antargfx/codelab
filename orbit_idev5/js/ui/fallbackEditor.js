/**
 * fallbackEditor.js — dependency-free code editor.
 *
 * Used when the Monaco CDN fails to load (e.g. flaky mobile networks or a
 * blocked CDN). Provides a line-numbered, scrollable, editable textarea that
 * auto-saves to the VFS — guaranteeing code is always visible and editable.
 */
import { vfs } from '../core/vfs.js';
import { bus, EVT } from '../core/eventBus.js';
import { $, el, debounce } from '../core/utils.js';

let host, gutter, area, wrap;
let currentPath = null;
let fontSize = 14;
let wrapOn = false;

export function initFallback() {
  host = $('#editorHost');
  host.innerHTML = '';
  wrap = el('div', { class: 'fb-editor' });
  gutter = el('div', { class: 'fb-gutter', 'aria-hidden': 'true' });
  area = el('textarea', {
    class: 'fb-area', spellcheck: 'false', autocapitalize: 'off',
    autocomplete: 'off', autocorrect: 'off', wrap: 'off',
  });
  wrap.append(gutter, area);
  host.appendChild(wrap);

  const save = debounce(() => {
    if (!currentPath) return;
    vfs.setText(currentPath, area.value, { silent: true });
    bus.emit(EVT.FILE_UPDATED, { path: currentPath });
  }, 350);

  area.addEventListener('input', () => { renderGutter(); save(); });
  area.addEventListener('scroll', () => { gutter.scrollTop = area.scrollTop; });
  // Tab inserts two spaces instead of moving focus.
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = area.selectionStart, en = area.selectionEnd;
      area.value = area.value.slice(0, s) + '  ' + area.value.slice(en);
      area.selectionStart = area.selectionEnd = s + 2;
      renderGutter(); save();
    }
  });
  applyFont();
}

export function fbOpen(path) {
  currentPath = path;
  area.value = vfs.readText(path) ?? '';
  renderGutter();
  area.scrollTop = 0;
}

function renderGutter() {
  const lines = area.value.split('\n').length || 1;
  let html = '';
  for (let i = 1; i <= lines; i++) html += i + '\n';
  gutter.textContent = html;
  gutter.scrollTop = area.scrollTop;
}

function applyFont() {
  if (!wrap) return;
  wrap.style.fontSize = fontSize + 'px';
  wrap.style.lineHeight = Math.round(fontSize * 1.5) + 'px';
}

export const fbCommands = {
  find() { /* browser native find */ try { area.blur(); } catch {} },
  fontInc() { fontSize = Math.min(28, fontSize + 1); applyFont(); renderGutter(); return fontSize; },
  fontDec() { fontSize = Math.max(9, fontSize - 1); applyFont(); renderGutter(); return fontSize; },
  toggleWrap() {
    wrapOn = !wrapOn;
    area.setAttribute('wrap', wrapOn ? 'soft' : 'off');
    area.style.whiteSpace = wrapOn ? 'pre-wrap' : 'pre';
    return wrapOn ? 'on' : 'off';
  },
  revealLine(line) {
    if (!area || !line) return;
    const lh = Math.round(fontSize * 1.5);
    area.scrollTop = Math.max(0, (line - 3) * lh);
    // place caret at start of that line
    const pos = area.value.split('\n').slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0);
    area.focus(); area.selectionStart = area.selectionEnd = pos;
  },
};

export function fbRelayout() { renderGutter(); }
export function fbGetPath() { return currentPath; }
