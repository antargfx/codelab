/**
 * errors.js — error panel.
 * Aggregates JS runtime errors, unhandled rejections, plus static
 * HTML/CSS/JSON validation issues. Clicking an error opens the file + line.
 */
import { vfs } from '../core/vfs.js';
import { bus, EVT } from '../core/eventBus.js';
import { $, el } from '../core/utils.js';
import { isJson, isText, ext } from '../core/mime.js';
import { openSourceRef, openFileAt } from './sourceLink.js';
import { setMarkers } from '../ui/editor.js';

const runtimeErrors = [];

export function initErrors() {
  const panel = $('#panelErrors');
  panel.innerHTML = '';
  panel.appendChild(el('div', { class: 'panel-toolbar' }, [
    el('button', { class: 'icon-btn sm', title: 'Clear', onclick: () => { runtimeErrors.length = 0; render(); },
      html: '<svg viewBox="0 0 24 24" class="ico"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>' }),
    el('button', { class: 'btn ghost', text: 'Re-validate', onclick: validateAll, style: 'padding:5px 10px' }),
    el('span', { class: 'hint', id: 'errSummary' }),
  ]));
  panel.appendChild(el('div', { id: 'errList' }));

  bus.on(EVT.RUNTIME_ERROR, (m) => {
    runtimeErrors.push({ kind: 'runtime', message: m.message, url: m.filename, line: m.line, col: m.col, stack: m.stack, time: m.time });
    render();
  });
  // re-validate when files change
  bus.on(EVT.FILE_UPDATED, () => debouncedValidate());
  bus.on(EVT.FS_CHANGED, () => debouncedValidate());
  render();
}

let vtimer;
function debouncedValidate() { clearTimeout(vtimer); vtimer = setTimeout(validateAll, 600); }

let staticErrors = [];

/** Run lightweight static validation across the project. */
export function validateAll() {
  staticErrors = [];
  for (const path of vfs.paths()) {
    if (!isText(path)) continue;
    const text = vfs.readText(path);
    const e = ext(path);
    if (e === 'json') validateJson(path, text);
    else if (e === 'html' || e === 'htm') validateHtml(path, text);
    else if (e === 'css') validateCss(path, text);
  }
  // push markers into Monaco per file
  const byFile = new Map();
  for (const er of staticErrors) {
    if (!byFile.has(er.path)) byFile.set(er.path, []);
    byFile.get(er.path).push({ severity: er.severity || 'error', message: er.message, line: er.line, column: er.col });
  }
  for (const [path, markers] of byFile) setMarkers(path, markers);
  render();
}

function validateJson(path, text) {
  if (!text.trim()) return;
  try { JSON.parse(text); }
  catch (err) {
    const pos = posFromJsonError(err, text);
    staticErrors.push({ kind: 'json', path, message: 'JSON: ' + err.message, line: pos.line, col: pos.col });
  }
}
function posFromJsonError(err, text) {
  const m = /position (\d+)/.exec(err.message);
  if (m) {
    const idx = +m[1];
    const before = text.slice(0, idx);
    const line = before.split('\n').length;
    const col = idx - before.lastIndexOf('\n');
    return { line, col };
  }
  return { line: 1, col: 1 };
}

function validateHtml(path, text) {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const perr = doc.querySelector('parsererror');
  if (perr) staticErrors.push({ kind: 'html', path, message: 'HTML parse error', line: 1, col: 1 });
  // unclosed tag heuristic: mismatched counts of common tags
  const checkTags = ['div', 'span', 'section', 'article', 'header', 'footer', 'ul', 'li', 'table'];
  for (const tag of checkTags) {
    const open = (text.match(new RegExp(`<${tag}[\\s>]`, 'gi')) || []).length;
    const close = (text.match(new RegExp(`</${tag}>`, 'gi')) || []).length;
    if (open !== close) {
      staticErrors.push({ kind: 'html', path, severity: 'warning', message: `Possible unbalanced <${tag}> (${open} open / ${close} close)`, line: 1, col: 1 });
    }
  }
}

function validateCss(path, text) {
  const open = (text.match(/{/g) || []).length;
  const close = (text.match(/}/g) || []).length;
  if (open !== close) {
    staticErrors.push({ kind: 'css', path, message: `Unbalanced braces ({ ${open} / } ${close})`, line: lineOfLastBrace(text), col: 1 });
  }
}
function lineOfLastBrace(text) {
  const idx = Math.max(text.lastIndexOf('{'), text.lastIndexOf('}'));
  return idx < 0 ? 1 : text.slice(0, idx).split('\n').length;
}

function render() {
  const list = $('#errList');
  if (!list) return;
  list.innerHTML = '';
  const all = [...staticErrors, ...runtimeErrors];
  const badge = $('#badgeErrors');
  badge.textContent = all.length;
  badge.dataset.zero = all.length === 0;
  $('#errSummary').textContent = `${staticErrors.length} static · ${runtimeErrors.length} runtime`;

  if (!all.length) {
    list.appendChild(el('div', { class: 'empty-state', text: 'No errors detected. 🎉' }));
    return;
  }
  for (const e of all) list.appendChild(errRow(e));
}

function errRow(e) {
  const isWarn = e.severity === 'warning';
  const label = e.kind === 'runtime' ? 'Runtime' : e.kind.toUpperCase();
  const where = e.path ? `${e.path}${e.line ? ':' + e.line : ''}` : (e.url ? `${e.url.split('/__vfs__/').pop()}:${e.line || ''}` : '');
  const row = el('div', { class: `con-row ${isWarn ? 'warn' : 'error'}`, style: 'cursor:pointer',
    onclick: () => { if (e.path) openFileAt(e.path, e.line); else if (e.url) openSourceRef(e.url, e.line); } });
  row.appendChild(el('span', { class: 'con-icon', text: isWarn ? '⚠' : '✖' }));
  const body = el('span', { class: 'con-msg' }, [
    el('strong', { text: `[${label}] ` }),
    document.createTextNode(e.message),
  ]);
  if (e.stack) body.appendChild(el('div', { class: 'hint', style: 'white-space:pre-wrap;margin-top:4px', text: e.stack }));
  row.appendChild(body);
  if (where) row.appendChild(el('span', { class: 'con-src', text: where }));
  return row;
}
