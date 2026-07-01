/**
 * console.js — Chrome-like console panel.
 * Renders console.* output from the preview with timestamps, levels,
 * filters, search, table support and clickable source references.
 */
import { bus, EVT } from '../core/eventBus.js';
import { $, el, timestamp } from '../core/utils.js';
import { openSourceRef } from './sourceLink.js';

const messages = [];
const filters = { log: true, info: true, warn: true, error: true };
let query = '';

const ICONS = { log: '', info: 'ℹ', warn: '⚠', error: '✖' };

export function initConsole() {
  const panel = $('#panelConsole');
  panel.innerHTML = '';
  panel.appendChild(el('div', { class: 'panel-toolbar' }, [
    el('button', { class: 'icon-btn sm', title: 'Clear console', onclick: clearConsole,
      html: '<svg viewBox="0 0 24 24" class="ico"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/></svg>' }),
    ...['log', 'info', 'warn', 'error'].map((lvl) =>
      el('button', { class: `filter-chip on`, dataset: { lvl }, text: lvl,
        onclick: (e) => { filters[lvl] = !filters[lvl]; e.target.classList.toggle('on', filters[lvl]); render(); } })),
    el('input', { type: 'search', placeholder: 'Filter output…', oninput: (e) => { query = e.target.value.toLowerCase(); render(); } }),
  ]));
  panel.appendChild(el('div', { class: 'console-list', id: 'consoleList' }));

  bus.on(EVT.CONSOLE_MSG, (m) => {
    if (m.kind === 'console-clear') { clearConsole(); return; }
    if (m.kind !== 'console') return;
    messages.push(m);
    if (messages.length > 1000) messages.shift();
    appendRow(m);
    updateBadge();
  });
  render();
}

function clearConsole() {
  messages.length = 0;
  render();
  updateBadge();
}

function updateBadge() {
  const b = $('#badgeConsole');
  b.textContent = messages.length;
  b.dataset.zero = messages.length === 0;
}

function passes(m) {
  if (m.method in filters && !filters[m.method]) return false;
  if (query) {
    const text = m.args.map(a => a.text || '').join(' ').toLowerCase();
    if (!text.includes(query)) return false;
  }
  return true;
}

function render() {
  const list = $('#consoleList');
  if (!list) return;
  list.innerHTML = '';
  const visible = messages.filter(passes);
  if (!visible.length) {
    list.appendChild(el('div', { class: 'empty-state', text: 'Console output from your site appears here.' }));
    return;
  }
  for (const m of visible) list.appendChild(rowEl(m));
  list.scrollTop = list.scrollHeight;
}

function appendRow(m) {
  const list = $('#consoleList');
  if (!list) return;
  if (list.querySelector('.empty-state')) list.innerHTML = '';
  if (passes(m)) { list.appendChild(rowEl(m)); list.scrollTop = list.scrollHeight; }
}

function rowEl(m) {
  const row = el('div', { class: `con-row ${m.method}` });
  row.appendChild(el('span', { class: 'con-time', text: timestamp(new Date(m.time)) }));
  if (ICONS[m.method]) row.appendChild(el('span', { class: 'con-icon', text: ICONS[m.method] }));
  const msg = el('span', { class: 'con-msg' });

  if (m.method === 'table' && m.args[0] && (m.args[0].k === 'array' || m.args[0].k === 'object')) {
    msg.appendChild(renderTable(m.args[0]));
  } else {
    m.args.forEach((a, i) => {
      if (i) msg.appendChild(document.createTextNode(' '));
      msg.appendChild(renderValue(a));
    });
  }
  row.appendChild(msg);

  if (m.stack && m.stack.url) {
    const src = el('span', { class: 'con-src', text: srcLabel(m.stack),
      onclick: () => openSourceRef(m.stack.url, m.stack.line) });
    row.appendChild(src);
  }
  return row;
}

function srcLabel(s) {
  const i = s.url.indexOf('/__vfs__/');
  const name = i >= 0 ? s.url.slice(i + 9) : s.url;
  return `${name}:${s.line}`;
}

/** Render a serialized value (see runtime serializer). */
function renderValue(a) {
  if (!a) return document.createTextNode('undefined');
  switch (a.k) {
    case 'prim':
      if (a.t === 'string') return el('span', { text: a.text });
      return el('span', { class: 'con-obj', style: 'color:inherit', text: a.text });
    case 'null': return el('span', { class: 'con-obj', text: 'null' });
    case 'undefined': return el('span', { class: 'con-obj', text: 'undefined' });
    case 'fn': return el('span', { class: 'con-obj', text: a.text });
    case 'node': return el('span', { class: 'con-obj', style: 'color:var(--info)', text: a.text });
    case 'error': return el('span', { style: 'color:var(--danger)', text: a.text + (a.stack ? '\n' + a.stack : '') });
    case 'array':
    case 'object':
      return renderExpandable(a);
    default: return document.createTextNode(a.text || '');
  }
}

function renderExpandable(a) {
  const details = el('details', {});
  const summary = el('summary', { style: 'cursor:pointer;color:#c678dd;display:inline' });
  summary.appendChild(document.createTextNode(a.k === 'array' ? `Array(${a.len})` : (a.name || 'Object')));
  details.appendChild(summary);
  const body = el('div', { style: 'padding-left:16px' });
  if (a.k === 'array') {
    a.items.forEach((it, i) => {
      const line = el('div', {}, [el('span', { class: 'jt-key', text: i + ': ' })]);
      line.appendChild(renderValue(it));
      body.appendChild(line);
    });
  } else {
    for (const [k, v] of Object.entries(a.entries || {})) {
      const line = el('div', {}, [el('span', { class: 'jt-key', text: k + ': ' })]);
      line.appendChild(renderValue(v));
      body.appendChild(line);
    }
  }
  details.appendChild(body);
  return details;
}

function renderTable(a) {
  const rows = a.k === 'array' ? a.items : Object.values(a.entries || {});
  const keys = new Set();
  rows.forEach((r) => { if (r.k === 'object') Object.keys(r.entries).forEach(k => keys.add(k)); });
  const table = el('table', { class: 'con-table' });
  const head = el('tr', {}, [el('th', { text: '(index)' }), ...[...keys].map(k => el('th', { text: k }))]);
  table.appendChild(head);
  rows.forEach((r, i) => {
    const tr = el('tr', {}, [el('td', { text: a.k === 'array' ? i : Object.keys(a.entries)[i] })]);
    [...keys].forEach((k) => {
      const cell = r.entries && r.entries[k];
      tr.appendChild(el('td', { text: cell ? (cell.text ?? '') : '' }));
    });
    table.appendChild(tr);
  });
  return table;
}
