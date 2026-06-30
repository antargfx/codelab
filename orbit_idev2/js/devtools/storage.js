/**
 * storage.js — storage viewer.
 * Inspects the preview's localStorage, sessionStorage, cookies and IndexedDB
 * by asking the injected runtime to read them, then renders key/value tables.
 */
import { bus } from '../core/eventBus.js';
import { $, el, esc } from '../core/utils.js';
import { postFrame } from '../preview/preview.js';

let data = { local: {}, session: {}, cookies: {}, indexeddb: [] };
let section = 'local';

export function initStorage() {
  const panel = $('#panelStorage');
  panel.innerHTML = '';
  const wrap = el('div', { class: 'storage-wrap' });
  const nav = el('div', { class: 'storage-nav', id: 'storageNav' });
  const sections = [
    ['local', 'Local Storage'], ['session', 'Session Storage'],
    ['cookies', 'Cookies'], ['indexeddb', 'IndexedDB'],
  ];
  for (const [key, label] of sections) {
    nav.appendChild(el('div', { class: `s-item ${key === section ? 'active' : ''}`, dataset: { key }, text: label,
      onclick: () => { section = key; nav.querySelectorAll('.s-item').forEach(s => s.classList.toggle('active', s.dataset.key === key)); renderBody(); } }));
  }
  const body = el('div', { class: 'storage-body', id: 'storageBody' });
  wrap.append(nav, body);

  panel.appendChild(el('div', { class: 'panel-toolbar' }, [
    el('button', { class: 'btn ghost', text: 'Refresh', style: 'padding:5px 10px', onclick: refresh }),
    el('span', { class: 'hint', text: 'Reads storage from the running preview.' }),
  ]));
  panel.appendChild(wrap);

  bus.on('storage:data', (d) => { data = d; renderBody(); });
  refresh();
}

export function refresh() {
  postFrame({ cmd: 'read-storage' });
}

function renderBody() {
  const body = $('#storageBody');
  if (!body) return;
  body.innerHTML = '';
  if (section === 'indexeddb') return renderIndexedDb(body);
  if (section === 'cookies') return renderKV(body, data.cookies || {}, false);
  renderKV(body, (section === 'local' ? data.local : data.session) || {}, section === 'local');
}

function renderKV(body, obj, editable) {
  const keys = Object.keys(obj);
  if (!keys.length) { body.appendChild(el('div', { class: 'empty-state', text: 'Empty.' })); return; }
  const table = el('table', { class: 'kv-table' });
  table.appendChild(el('tr', {}, [el('th', { text: 'Key' }), el('th', { text: 'Value' }), editable ? el('th', { text: '' }) : null]));
  for (const k of keys) {
    const tr = el('tr', {}, [el('td', { text: k }), el('td', { text: String(obj[k]) })]);
    if (editable) {
      tr.appendChild(el('td', {}, [el('button', { class: 'btn ghost danger', style: 'padding:3px 8px;font-size:12px', text: 'Delete',
        onclick: () => { postFrame({ cmd: 'del-local', key: k }); delete obj[k]; renderBody(); } })]));
    }
    table.appendChild(tr);
  }
  body.appendChild(table);
}

function renderIndexedDb(body) {
  const dbs = data.indexeddb || [];
  if (!dbs.length) { body.appendChild(el('div', { class: 'empty-state', text: 'No IndexedDB databases.' })); return; }
  for (const db of dbs) {
    body.appendChild(el('h4', { style: 'margin:8px 0 4px', text: `${db.name} (v${db.version})` }));
    const stores = db.stores || {};
    for (const [sn, items] of Object.entries(stores)) {
      body.appendChild(el('div', { class: 'hint', style: 'margin:6px 0', text: `Store: ${sn} — ${items.length} record(s)` }));
      const table = el('table', { class: 'kv-table' });
      table.appendChild(el('tr', {}, [el('th', { text: 'Key' }), el('th', { text: 'Value' })]));
      for (const it of items) {
        table.appendChild(el('tr', {}, [el('td', { text: it.key }), el('td', { text: safeJson(it.value) })]));
      }
      body.appendChild(table);
    }
  }
}

function safeJson(v) {
  try { return JSON.stringify(v); } catch { return String(v); }
}
