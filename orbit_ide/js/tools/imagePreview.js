/**
 * imagePreview.js — image viewer with zoom and metadata.
 * Renders PNG/JPG/GIF/WEBP/ICO/BMP/AVIF in a checkerboard stage.
 */
import { vfs } from '../core/vfs.js';
import { $, el, fmtBytes, basename } from '../core/utils.js';

let zoom = 1;
let currentPath = null;

export function showImage(path) {
  currentPath = path;
  zoom = 1;
  const host = $('#imageHost');
  host.hidden = false;
  host.innerHTML = '';

  const url = vfs.blobUrl(path);
  const img = el('img', { src: url, alt: basename(path) });
  const meta = el('span', { class: 'image-host__meta' });

  img.onload = () => {
    meta.textContent = `${img.naturalWidth} × ${img.naturalHeight} px · ${fmtBytes(vfs.get(path)?.size)}`;
  };

  const apply = () => { img.style.transform = `scale(${zoom})`; zoomLabel.textContent = Math.round(zoom * 100) + '%'; };
  const zoomLabel = el('span', { class: 'hint', text: '100%' });

  const bar = el('div', { class: 'image-host__bar' }, [
    el('button', { class: 'btn ghost', text: '−', onclick: () => { zoom = Math.max(0.1, zoom - 0.25); apply(); } }),
    zoomLabel,
    el('button', { class: 'btn ghost', text: '+', onclick: () => { zoom = Math.min(8, zoom + 0.25); apply(); } }),
    el('button', { class: 'btn ghost', text: 'Fit', onclick: () => { zoom = 1; apply(); } }),
    el('span', { style: 'font-weight:600', text: basename(path) }),
    meta,
  ]);
  const stage = el('div', { class: 'image-host__stage' }, [img]);
  host.append(bar, stage);

  // pinch / wheel zoom
  stage.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoom = Math.min(8, Math.max(0.1, zoom + (e.deltaY < 0 ? 0.1 : -0.1)));
    apply();
  }, { passive: false });
}

export function hideImage() {
  const host = $('#imageHost');
  host.hidden = true;
  host.innerHTML = '';
  currentPath = null;
}
