/**
 * network.js — network monitor.
 * Records every request the preview makes (page loads, CSS, JS, images,
 * JSON, fetch, XHR) with URL, status, type, size and timing.
 */
import { bus, EVT } from '../core/eventBus.js';
import { $, el, fmtBytes, fmtMs } from '../core/utils.js';
import { openSourceRef } from './sourceLink.js';

const entries = [];
let typeFilter = 'all';
let query = '';

const TYPE_OF = (ct, url) => {
  ct = (ct || '').toLowerCase();
  if (ct.includes('html')) return 'doc';
  if (ct.includes('css')) return 'css';
  if (ct.includes('javascript')) return 'js';
  if (ct.includes('json')) return 'json';
  if (ct.includes('image') || /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(url)) return 'img';
  if (ct.includes('font') || /\.(woff2?|ttf|otf)$/i.test(url)) return 'font';
  if (ct.includes('audio') || ct.includes('video')) return 'media';
  if (/\.css$/i.test(url)) return 'css';
  if (/\.js$/i.test(url)) return 'js';
  if (/\.json$/i.test(url)) return 'json';
  return 'other';
};

export function initNetwork() {
  const panel = $('#panelNetwork');
  panel.innerHTML = '';
  panel.appendChild(el('div', { class: 'panel-toolbar' }, [
    el('button', { class: 'icon-btn sm', title: 'Clear', onclick: () => { entries.length = 0; render(); },
      html: '<svg viewBox="0 0 24 24" class="ico"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>' }),
    ...['all', 'doc', 'css', 'js', 'json', 'img', 'font', 'media'].map((t) =>
      el('button', { class: `filter-chip ${t === 'all' ? 'on' : ''}`, dataset: { t }, text: t,
        onclick: (e) => { typeFilter = t; panel.querySelectorAll('.filter-chip').forEach(c => c.classList.toggle('on', c.dataset.t === t)); render(); } })),
    el('input', { type: 'search', placeholder: 'Filter URL…', oninput: (e) => { query = e.target.value.toLowerCase(); render(); } }),
  ]));
  panel.appendChild(el('div', { id: 'netBody' }));

  bus.on(EVT.NETWORK_MSG, (m) => {
    entries.push({ ...m, kind: TYPE_OF(m.type, m.url) });
    if (entries.length > 800) entries.shift();
    render();
  });
  // reset list on full reload
  bus.on(EVT.PREVIEW_RELOAD, () => { /* keep history; user can clear */ });
  render();
}

function passes(e) {
  if (typeFilter !== 'all' && e.kind !== typeFilter) return false;
  if (query && !e.url.toLowerCase().includes(query)) return false;
  return true;
}

function render() {
  const body = $('#netBody');
  if (!body) return;
  const visible = entries.filter(passes);
  const badge = $('#badgeNetwork');
  badge.textContent = entries.length;
  badge.dataset.zero = entries.length === 0;

  if (!visible.length) {
    body.innerHTML = '';
    body.appendChild(el('div', { class: 'empty-state', text: 'Requests made by your site appear here.' }));
    return;
  }
  const table = el('table', { class: 'net-table' });
  table.appendChild(el('tr', {}, [
    el('th', { text: 'Name' }), el('th', { text: 'Status' }), el('th', { text: 'Type' }),
    el('th', { text: 'Size' }), el('th', { text: 'Time' }), el('th', { text: 'Init' }),
  ]));
  for (const e of visible) table.appendChild(rowEl(e));
  body.innerHTML = '';
  body.appendChild(table);
}

function shortName(url) {
  try {
    const i = url.indexOf('/__vfs__/');
    if (i >= 0) return url.slice(i + 9).split(/[?#]/)[0] || 'index.html';
    const u = new URL(url, location.href);
    return (u.pathname.split('/').pop() || u.host) + (u.search || '');
  } catch { return url; }
}

function rowEl(e) {
  const statusClass = e.failed || e.status === 0 || e.status >= 400 ? 'err' : 'ok';
  const statusText = e.failed ? '(failed)' : (e.status || '—');
  return el('tr', {}, [
    el('td', {}, [el('span', { class: 'net-name', title: e.url, text: shortName(e.url),
      onclick: () => openSourceRef(e.url, 1) })]),
    el('td', {}, [el('span', { class: `net-status ${statusClass}`, text: statusText })]),
    el('td', {}, [el('span', { class: 'net-type', text: e.kind })]),
    el('td', { text: fmtBytes(e.size) }),
    el('td', { text: fmtMs(e.time) }),
    el('td', { text: e.init }),
  ]);
}
