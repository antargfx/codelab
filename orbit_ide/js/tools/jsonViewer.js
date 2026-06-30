/**
 * jsonViewer.js — pretty JSON tree viewer with validation.
 * Opens as an overlay over the editor; collapsible nodes, format, validate.
 */
import { vfs } from '../core/vfs.js';
import { $, el, esc } from '../core/utils.js';
import { toast } from '../ui/notify.js';

let currentPath = null;

export function openJsonViewer(path) {
  currentPath = path;
  const host = $('#jsonHost');
  host.hidden = false;
  host.innerHTML = '';

  const status = el('span', {});
  const bar = el('div', { class: 'json-host__bar' }, [
    el('span', { style: 'font-weight:600', text: path.split('/').pop() }),
    status,
    el('div', { style: 'flex:1' }),
    el('button', { class: 'btn ghost', text: 'Format', onclick: () => format() }),
    el('button', { class: 'btn ghost', text: 'Expand all', onclick: () => toggleAll(false) }),
    el('button', { class: 'btn ghost', text: 'Collapse all', onclick: () => toggleAll(true) }),
    el('button', { class: 'btn ghost', text: 'Close', onclick: closeJsonViewer }),
  ]);
  const body = el('div', { class: 'json-host__body', id: 'jsonBody' });
  host.append(bar, body);

  const text = vfs.readText(path) || '';
  let data;
  try {
    data = JSON.parse(text);
    status.className = 'json-valid';
    status.textContent = '● Valid JSON';
  } catch (err) {
    status.className = 'json-invalid';
    status.textContent = '● Invalid: ' + err.message;
    body.appendChild(el('pre', { text }));
    return;
  }
  body.appendChild(renderTree(data, 'root', true));
}

function format() {
  if (!currentPath) return;
  try {
    const data = JSON.parse(vfs.readText(currentPath));
    vfs.setText(currentPath, JSON.stringify(data, null, 2));
    toast('Formatted');
    openJsonViewer(currentPath);
  } catch { toast('Cannot format invalid JSON', { type: 'error' }); }
}

function toggleAll(collapse) {
  $('#jsonBody').querySelectorAll('.jt-children').forEach(c => c.classList.toggle('hidden', collapse));
  $('#jsonBody').querySelectorAll('.jt-toggle').forEach(t => t.textContent = collapse ? '▸' : '▾');
}

function renderTree(value, key, isRoot) {
  const row = el('div', { class: 'jt-row' });
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;

  if (type === 'object' || type === 'array') {
    const entries = type === 'array' ? value.map((v, i) => [i, v]) : Object.entries(value);
    const toggle = el('span', { class: 'jt-toggle', text: '▾' });
    const head = el('span', {}, [
      toggle,
      key !== 'root' ? el('span', { class: 'jt-key', text: `"${key}": ` }) : null,
      el('span', { class: 'jt-collapsed-preview', text: type === 'array' ? `[${entries.length}]` : `{${entries.length}}` }),
    ]);
    const children = el('div', { class: 'jt-children', style: 'padding-left:18px' });
    for (const [k, v] of entries) children.appendChild(renderTree(v, k, false));
    toggle.addEventListener('click', () => {
      const hidden = children.classList.toggle('hidden');
      toggle.textContent = hidden ? '▸' : '▾';
    });
    row.append(head, children);
  } else {
    const valSpan = el('span', { class: valueClass(type), text: type === 'string' ? `"${value}"` : String(value) });
    row.append(
      el('span', { class: 'jt-toggle', text: ' ' }),
      key !== 'root' ? el('span', { class: 'jt-key', text: `"${key}": ` }) : null,
      valSpan,
    );
  }
  return row;
}

function valueClass(type) {
  return { string: 'jt-string', number: 'jt-number', boolean: 'jt-bool', null: 'jt-null' }[type] || '';
}

export function closeJsonViewer() {
  const host = $('#jsonHost');
  host.hidden = true;
  host.innerHTML = '';
  currentPath = null;
}
