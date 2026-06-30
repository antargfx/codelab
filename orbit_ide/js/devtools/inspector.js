/**
 * inspector.js — Chrome DevTools-style element inspector.
 *
 * Left: live DOM tree (expand/collapse, hover highlight, click to select).
 * Right: computed styles, matched CSS rules, box model, and editors for
 * text / id / class / attributes / inline styles plus node operations.
 * All edits are pushed to the preview runtime for instant updates.
 */
import { vfs } from '../core/vfs.js';
import { bus, EVT } from '../core/eventBus.js';
import { $, el, esc } from '../core/utils.js';
import { postFrame, requestDom, getCurrentPath, togglePicker } from '../preview/preview.js';
import { openFileAt } from './sourceLink.js';
import { urlToVfsPath } from './sourceLink.js';
import { toast } from '../ui/notify.js';

let domTree = null;
let selected = null;       // current element descriptor (from pick)
const collapsed = new Set();

export function initInspector() {
  const panel = $('#panelInspector');
  panel.innerHTML = '';
  const bar = el('div', { class: 'dom-edit-bar' }, [
    el('button', { class: 'btn', text: '🎯 Pick', onclick: () => togglePicker(true) }),
    el('button', { class: 'btn', text: 'Refresh', onclick: requestDom }),
  ]);
  const wrap = el('div', { class: 'inspector' }, [
    el('div', { class: 'inspector__dom', id: 'inspectorDom' }),
    el('div', { class: 'inspector__styles', id: 'inspectorStyles' }),
  ]);
  panel.append(bar, wrap);

  bus.on(EVT.DOM_SNAPSHOT, (m) => { if (m && m.tree) { domTree = m.tree; renderDom(); } });
  bus.on(EVT.PICK_RESULT, (descr) => { selected = descr; renderStyles(); highlightInTree(descr.id); });

  renderDom();
  renderStyles();
}

/* ---------------- DOM tree ---------------- */
function renderDom() {
  const host = $('#inspectorDom');
  if (!host) return;
  host.innerHTML = '';
  if (!domTree) { host.appendChild(el('div', { class: 'empty-state', text: 'Run the preview to inspect the DOM.' })); return; }
  const root = el('div', { class: 'dom-node' });
  renderNode(domTree, 0, root);
  host.appendChild(root);
}

function renderNode(node, depth, parent) {
  if (node.type === 'text') {
    parent.appendChild(el('div', { class: 'dom-line', style: `padding-left:${depth * 12 + 4}px` },
      [el('span', { class: 'dom-text', text: '"' + node.text + '"' })]));
    return;
  }
  const hasChildren = node.children && node.children.length;
  const isCollapsed = collapsed.has(node.id);
  const line = el('div', { class: 'dom-line', dataset: { id: node.id }, style: `padding-left:${depth * 12 + 4}px` });

  const twisty = el('span', { class: `dom-twisty${isCollapsed ? ' collapsed' : ''}`, text: hasChildren ? '▾' : '' });
  if (hasChildren) twisty.addEventListener('click', (e) => { e.stopPropagation(); if (collapsed.has(node.id)) collapsed.delete(node.id); else collapsed.add(node.id); renderDom(); });
  line.appendChild(twisty);

  const tag = el('span', {}, [
    el('span', { class: 'dom-tag', text: '<' + node.tag }),
    ...attrSpans(node.attrs),
    el('span', { class: 'dom-tag', text: '>' }),
  ]);
  line.appendChild(tag);

  line.addEventListener('mouseenter', () => postFrame({ cmd: 'highlight', id: node.id }));
  line.addEventListener('mouseleave', () => postFrame({ cmd: 'highlight', id: null }));
  line.addEventListener('click', () => { postFrame({ cmd: 'select', id: node.id }); });
  parent.appendChild(line);

  if (hasChildren) {
    const childWrap = el('div', { class: `dom-children${isCollapsed ? ' hidden' : ''}` });
    for (const c of node.children) renderNode(c, depth + 1, childWrap);
    parent.appendChild(childWrap);
  }
}

function attrSpans(attrs) {
  const out = [];
  for (const [k, v] of Object.entries(attrs || {})) {
    out.push(document.createTextNode(' '));
    out.push(el('span', { class: 'dom-attr', text: k }));
    out.push(document.createTextNode('="'));
    out.push(el('span', { class: 'dom-attr-val', text: v }));
    out.push(document.createTextNode('"'));
  }
  return out;
}

function highlightInTree(id) {
  $('#inspectorDom')?.querySelectorAll('.dom-line').forEach(l => l.classList.toggle('selected', l.dataset.id === id));
}

/* ---------------- Styles panel ---------------- */
function renderStyles() {
  const host = $('#inspectorStyles');
  if (!host) return;
  host.innerHTML = '';
  if (!selected) { host.appendChild(el('div', { class: 'empty-state', text: 'Select an element to inspect its styles.' })); return; }

  host.appendChild(headerSection());
  host.appendChild(domEditSection());
  host.appendChild(boxModelSection());
  host.appendChild(inlineStyleSection());
  host.appendChild(rulesSection());
  host.appendChild(computedSection());
}

function headerSection() {
  const s = el('div', { class: 'styles-section' });
  s.appendChild(el('div', { class: 'css-rule' }, [
    el('span', { class: 'css-selector', text: selected.selector || selected.tag }),
  ]));
  s.appendChild(el('button', { class: 'btn ghost', style: 'padding:5px 10px;margin-top:6px', text: '↦ Jump to HTML', onclick: jumpToHtml }));
  return s;
}

function domEditSection() {
  const s = el('div', { class: 'styles-section' });
  s.appendChild(el('h4', { text: 'DOM' }));

  // text
  if (selected.text !== undefined && !selected.outerHTML.includes('<', 1)) { /* leaf-ish */ }
  s.appendChild(fieldRow('Text', selected.text || '', (v) => postFrame({ cmd: 'set-text', id: selected.id, value: v })));
  s.appendChild(fieldRow('id', selected.idAttr || '', (v) => postFrame({ cmd: 'set-id', id: selected.id, value: v })));
  s.appendChild(fieldRow('class', selected.cls || '', (v) => postFrame({ cmd: 'set-class', id: selected.id, value: v })));

  // attributes editor
  const attrs = selected.attrs || {};
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class' || k === 'id' || k === 'style') continue;
    s.appendChild(fieldRow(k, v, (val) => postFrame({ cmd: 'set-attr', id: selected.id, name: k, value: val }),
      () => postFrame({ cmd: 'set-attr', id: selected.id, name: k, value: null })));
  }
  // add attribute / node ops
  const ops = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:8px' }, [
    el('button', { class: 'btn ghost', style: 'padding:5px 9px;font-size:12px', text: '+ Attribute', onclick: addAttr }),
    el('button', { class: 'btn ghost', style: 'padding:5px 9px;font-size:12px', text: '+ Child', onclick: () => postFrame({ cmd: 'add-child', id: selected.id, tag: 'div', text: 'New element' }) }),
    el('button', { class: 'btn ghost', style: 'padding:5px 9px;font-size:12px', text: '⧉ Duplicate', onclick: () => postFrame({ cmd: 'duplicate-node', id: selected.id }) }),
    el('button', { class: 'btn ghost danger', style: 'padding:5px 9px;font-size:12px', text: '🗑 Remove', onclick: () => postFrame({ cmd: 'remove-node', id: selected.id }) }),
  ]);
  s.appendChild(ops);
  return s;
}

function fieldRow(label, value, onCommit, onDelete) {
  const input = el('input', { value, style: 'padding:5px 8px;font-size:12px' });
  const commit = () => onCommit(input.value);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commit(); input.blur(); } });
  input.addEventListener('blur', commit);
  const row = el('div', { style: 'display:flex;gap:6px;align-items:center;margin-bottom:6px' }, [
    el('span', { style: 'min-width:54px;color:var(--muted);font-size:12px', text: label }),
    input,
  ]);
  if (onDelete) row.appendChild(el('button', { class: 'icon-btn sm', text: '×', onclick: onDelete, style: 'width:26px;height:26px' }));
  return row;
}

async function addAttr() {
  const { promptSheet } = await import('../ui/bottomSheet.js');
  const name = await promptSheet({ title: 'Add attribute', label: 'Attribute name', placeholder: 'data-role' });
  if (!name) return;
  const val = await promptSheet({ title: 'Attribute value', label: name, placeholder: '' });
  postFrame({ cmd: 'set-attr', id: selected.id, name, value: val || '' });
}

/* ---- box model ---- */
function boxModelSection() {
  const s = el('div', { class: 'styles-section' });
  s.appendChild(el('h4', { text: 'Box Model' }));
  const b = selected.box;
  const editable = (val, side, kind) => {
    const span = el('span', { class: 'bm-val', contenteditable: 'true', text: String(val) });
    span.addEventListener('blur', () => {
      const prop = kind + (side === 'all' ? '' : '-' + side);
      postFrame({ cmd: 'set-inline-style', id: selected.id, prop, value: span.textContent.trim() + 'px' });
    });
    span.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); span.blur(); } });
    return span;
  };
  const margin = el('div', { class: 'bm-layer bm-margin' }, [
    el('span', { class: 'bm-label', text: 'margin' }),
    el('div', {}, [editable(b.margin.top, 'top', 'margin')]),
    el('div', { class: 'bm-layer bm-border' }, [
      el('span', { class: 'bm-label', text: 'border' }),
      el('div', {}, [editable(b.border.top, 'top', 'border-width')]),
      el('div', { class: 'bm-layer bm-padding' }, [
        el('span', { class: 'bm-label', text: 'padding' }),
        el('div', {}, [editable(b.padding.top, 'top', 'padding')]),
        el('div', { class: 'bm-layer bm-content' }, [
          `${b.width} × ${b.height}`,
        ]),
        el('div', {}, [editable(b.padding.bottom, 'bottom', 'padding')]),
      ]),
      el('div', {}, [editable(b.border.bottom, 'bottom', 'border-width')]),
    ]),
    el('div', {}, [editable(b.margin.bottom, 'bottom', 'margin')]),
  ]);
  const horiz = el('div', { class: 'css-computed-row' }, [
    el('span', { class: 'k', text: 'margin L/R' }), el('span', {}, [editable(b.margin.left, 'left', 'margin'), document.createTextNode(' / '), editable(b.margin.right, 'right', 'margin')]),
  ]);
  const horizP = el('div', { class: 'css-computed-row' }, [
    el('span', { class: 'k', text: 'padding L/R' }), el('span', {}, [editable(b.padding.left, 'left', 'padding'), document.createTextNode(' / '), editable(b.padding.right, 'right', 'padding')]),
  ]);
  s.append(el('div', { class: 'boxmodel' }, [margin]), horiz, horizP);
  return s;
}

/* ---- inline style ---- */
function inlineStyleSection() {
  const s = el('div', { class: 'styles-section' });
  s.appendChild(el('h4', { text: 'element.style' }));
  const ta = el('textarea', { rows: 2, placeholder: 'color: red; font-size: 14px;', text: selected.inlineStyle || '' });
  ta.value = selected.inlineStyle || '';
  ta.addEventListener('blur', () => postFrame({ cmd: 'set-style-attr', id: selected.id, value: ta.value }));
  s.appendChild(ta);
  return s;
}

/* ---- matched rules ---- */
function rulesSection() {
  const s = el('div', { class: 'styles-section' });
  s.appendChild(el('h4', { text: 'Matched CSS Rules' }));
  if (!selected.rules || !selected.rules.length) {
    s.appendChild(el('div', { class: 'hint', text: 'No author rules matched.' }));
    return s;
  }
  for (const rule of selected.rules) {
    const block = el('div', { class: 'css-rule' });
    const sel = el('div', {}, [
      el('span', { class: 'css-selector', text: rule.selector }),
      document.createTextNode(' {'),
    ]);
    if (rule.href) {
      sel.appendChild(el('span', { class: 'con-src', style: 'float:right', text: srcName(rule.href),
        onclick: () => jumpToCss(rule.href, rule.selector) }));
    }
    block.appendChild(sel);
    for (const d of rule.decls) {
      const val = el('span', { class: 'css-val', contenteditable: 'true', text: d.value });
      val.addEventListener('blur', () => postFrame({ cmd: 'set-inline-style', id: selected.id, prop: d.prop, value: val.textContent.trim() }));
      val.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); val.blur(); } });
      block.appendChild(el('div', { class: 'css-decl' }, [
        el('span', { class: 'css-prop', text: d.prop }), document.createTextNode(': '), val, document.createTextNode(';'),
      ]));
    }
    block.appendChild(document.createTextNode('}'));
    s.appendChild(block);
  }
  return s;
}

/* ---- computed ---- */
function computedSection() {
  const s = el('div', { class: 'styles-section' });
  s.appendChild(el('h4', { text: 'Computed' }));
  for (const [k, v] of Object.entries(selected.computed || {})) {
    if (!v) continue;
    s.appendChild(el('div', { class: 'css-computed-row' }, [
      el('span', { class: 'k', text: k }), el('span', { text: v }),
    ]));
  }
  return s;
}

/* ---------------- jumps ---------------- */
function srcName(href) { const i = href.indexOf('/__vfs__/'); return i >= 0 ? href.slice(i + 9) : href.split('/').pop(); }

function jumpToHtml() {
  const path = getCurrentPath();
  if (!vfs.has(path)) { toast('HTML source not found', { type: 'error' }); return; }
  const text = vfs.readText(path);
  const line = findElementLine(text, selected);
  openFileAt(path, line);
}

function findElementLine(text, descr) {
  const lines = text.split('\n');
  let needle = null;
  if (descr.idAttr) needle = new RegExp(`id\\s*=\\s*["']${escapeRe(descr.idAttr)}["']`);
  else if (descr.cls) needle = new RegExp(`class\\s*=\\s*["'][^"']*${escapeRe(descr.cls.split(' ')[0])}`);
  else needle = new RegExp(`<${descr.tag}[\\s>]`, 'i');
  for (let i = 0; i < lines.length; i++) { if (needle.test(lines[i])) return i + 1; }
  return 1;
}

function jumpToCss(href, selector) {
  const path = urlToVfsPath(href);
  if (!path) { toast('CSS source not found', { type: 'error' }); return; }
  const text = vfs.readText(path);
  const lines = text.split('\n');
  const first = selector.split(',')[0].trim();
  let line = 1;
  for (let i = 0; i < lines.length; i++) { if (lines[i].includes(first)) { line = i + 1; break; } }
  openFileAt(path, line);
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
