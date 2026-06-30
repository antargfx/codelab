/**
 * splitPane.js — pointer-driven resizers for sidebar, editor/preview, dock.
 * Works with mouse and touch (Pointer Events).
 */
import { $ } from '../core/utils.js';

function makeResizer(handle, onMove, onStart, onEnd) {
  if (!handle) return;
  let active = false;
  handle.addEventListener('pointerdown', (e) => {
    active = true;
    handle.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
    document.body.style.cursor = handle.classList.contains('resizer--h') ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
    onStart && onStart(e);
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => { if (active) onMove(e); });
  const end = (e) => {
    if (!active) return;
    active = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    onEnd && onEnd(e);
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

export function initSplitPanes() {
  const sidebar = $('#sidebar');
  const paneEditor = $('#paneEditor');
  const panePreview = $('#panePreview');
  const dock = $('#dock');
  const main = $('#main');

  // Sidebar width
  makeResizer($('#resizeSidebar'), (e) => {
    const w = Math.min(Math.max(e.clientX, 180), Math.min(520, innerWidth - 320));
    sidebar.style.width = `${w}px`;
  });

  // Editor / preview split (flex-basis)
  makeResizer($('#resizeMain'), (e) => {
    const rect = main.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const clamped = Math.min(Math.max(ratio, 0.2), 0.8);
    paneEditor.style.flex = `1 1 ${clamped * 100}%`;
    panePreview.style.flex = `1 1 ${(1 - clamped) * 100}%`;
  });

  // Dock height (drag up grows)
  makeResizer($('#resizeDock'), (e) => {
    const h = Math.min(Math.max(innerHeight - e.clientY, 80), innerHeight * 0.75);
    dock.style.height = `${h}px`;
    dock.classList.remove('collapsed');
  });
}
