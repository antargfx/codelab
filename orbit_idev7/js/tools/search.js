/**
 * search.js — project-wide search & replace.
 * Supports plain text and regex, case sensitivity, and replace-all.
 * Results are grouped per file; clicking a hit opens the file at the line.
 */
import { vfs } from '../core/vfs.js';
import { bus, EVT } from '../core/eventBus.js';
import { $, el, debounce } from '../core/utils.js';
import { isText } from '../core/mime.js';
import { openFileAt } from '../devtools/sourceLink.js';
import { toast } from '../ui/notify.js';

const opts = { regex: false, caseSensitive: false, word: false };

export function initSearch() {
  const pane = $('#searchPane');
  pane.innerHTML = '';

  const queryInput = el('input', { type: 'search', placeholder: 'Search across files…' });
  const replaceInput = el('input', { type: 'text', placeholder: 'Replace…' });

  const head = el('div', { class: 'search-head' }, [
    queryInput,
    el('div', { style: 'display:flex;gap:6px' }, [
      replaceInput,
      el('button', { class: 'btn', text: 'Replace all', style: 'white-space:nowrap', onclick: () => replaceAll(queryInput.value, replaceInput.value) }),
    ]),
    el('div', { class: 'search-opts' }, [
      optChip('Aa', 'caseSensitive', 'Case sensitive'),
      optChip('\\b', 'word', 'Whole word'),
      optChip('.*', 'regex', 'Regex'),
    ]),
  ]);
  const results = el('div', { class: 'search-results', id: 'searchResults' });
  const summary = el('div', { class: 'search-summary', id: 'searchSummary' });
  pane.append(head, summary, results);

  const run = debounce(() => doSearch(queryInput.value), 200);
  queryInput.addEventListener('input', run);
  bus.on(EVT.FS_CHANGED, () => { if (queryInput.value) doSearch(queryInput.value); });
}

function optChip(label, key, title) {
  const chip = el('button', { class: 'opt', text: label, title });
  chip.addEventListener('click', () => { opts[key] = !opts[key]; chip.classList.toggle('on', opts[key]); doSearch($('#searchPane input[type=search]').value); });
  return chip;
}

function buildRegex(query) {
  if (!query) return null;
  let pattern = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (opts.word) pattern = `\\b${pattern}\\b`;
  const flags = 'g' + (opts.caseSensitive ? '' : 'i');
  try { return new RegExp(pattern, flags); } catch { return null; }
}

function doSearch(query) {
  const results = $('#searchResults');
  const summary = $('#searchSummary');
  results.innerHTML = '';
  if (!query) { summary.textContent = ''; return; }
  const re = buildRegex(query);
  if (!re) { summary.textContent = 'Invalid regex'; return; }

  let fileCount = 0, hitCount = 0;
  for (const path of vfs.paths().sort()) {
    if (!isText(path)) continue;
    const text = vfs.readText(path);
    const lines = text.split('\n');
    const hits = [];
    lines.forEach((line, i) => {
      re.lastIndex = 0;
      if (re.test(line)) hits.push({ line: i + 1, text: line });
    });
    if (!hits.length) continue;
    fileCount++; hitCount += hits.length;
    results.appendChild(fileGroup(path, hits, re));
  }
  summary.textContent = hitCount ? `${hitCount} result(s) in ${fileCount} file(s)` : 'No results';
}

function fileGroup(path, hits, re) {
  const group = el('div', { class: 'search-file' });
  const header = el('div', { class: 'search-file__name' }, [
    el('span', { text: path }),
    el('span', { class: 'search-file__count', text: ` ${hits.length}` }),
  ]);
  const hitWrap = el('div', {});
  for (const h of hits) {
    const hit = el('div', { class: 'search-hit', onclick: () => openFileAt(path, h.line) });
    hit.appendChild(el('span', { class: 'ln', text: h.line }));
    hit.appendChild(highlight(h.text, re));
    hitWrap.appendChild(hit);
  }
  header.addEventListener('click', () => hitWrap.style.display = hitWrap.style.display === 'none' ? '' : 'none');
  group.append(header, hitWrap);
  return group;
}

function highlight(text, re) {
  const span = el('span', {});
  re.lastIndex = 0;
  let last = 0, m;
  const snippet = text.length > 200 ? text.slice(0, 200) : text;
  while ((m = re.exec(snippet)) !== null) {
    if (m.index > last) span.appendChild(document.createTextNode(snippet.slice(last, m.index)));
    span.appendChild(el('mark', { text: m[0] }));
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  if (last < snippet.length) span.appendChild(document.createTextNode(snippet.slice(last)));
  return span;
}

async function replaceAll(query, replacement) {
  if (!query) return;
  const re = buildRegex(query);
  if (!re) { toast('Invalid pattern', { type: 'error' }); return; }
  let files = 0, count = 0;
  for (const path of vfs.paths()) {
    if (!isText(path)) continue;
    const text = vfs.readText(path);
    re.lastIndex = 0;
    if (!re.test(text)) continue;
    re.lastIndex = 0;
    const matches = text.match(re);
    const replaced = text.replace(re, replacement);
    if (replaced !== text) { vfs.setText(path, replaced); files++; count += matches ? matches.length : 0; }
  }
  toast(`Replaced ${count} occurrence(s) in ${files} file(s)`, { type: 'success' });
  bus.emit(EVT.PREVIEW_RELOAD);
  doSearch(query);
}
