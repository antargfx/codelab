/**
 * contextMenu.js — touch-friendly context menu.
 * Opens on right-click (desktop) and long-press (touch).
 */
import { $, el } from '../core/utils.js';

let openEl = null;

function closeMenu() {
  if (openEl) { openEl.hidden = true; openEl.innerHTML = ''; openEl = null; }
}

document.addEventListener('pointerdown', (e) => {
  if (openEl && !openEl.contains(e.target)) closeMenu();
}, true);
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);
addEventListener('scroll', closeMenu, true);

/**
 * Show a context menu at (x, y).
 * @param {{x:number,y:number}} pos
 * @param {Array<{label?:string,icon?:string,onClick?:Function,danger?:boolean,sep?:boolean,key?:string}>} items
 */
export function showContextMenu(pos, items) {
  const menu = $('#ctxMenu');
  closeMenu();
  menu.innerHTML = '';
  for (const it of items) {
    if (it.sep) { menu.appendChild(el('div', { class: 'ctx-sep' })); continue; }
    const btn = el('button', {
      class: `ctx-item${it.danger ? ' danger' : ''}`,
      onclick: () => { closeMenu(); it.onClick && it.onClick(); },
    }, [
      it.icon ? el('span', { html: it.icon }) : null,
      el('span', { text: it.label }),
      it.key ? el('span', { class: 'key', text: it.key }) : null,
    ]);
    menu.appendChild(btn);
  }
  menu.hidden = false;
  openEl = menu;

  // Position within viewport
  const vw = innerWidth, vh = innerHeight;
  const rect = menu.getBoundingClientRect();
  let x = pos.x, y = pos.y;
  if (x + rect.width > vw - 8) x = vw - rect.width - 8;
  if (y + rect.height > vh - 8) y = vh - rect.height - 8;
  menu.style.left = `${Math.max(8, x)}px`;
  menu.style.top = `${Math.max(8, y)}px`;
}

export { closeMenu };

/**
 * Attach long-press + contextmenu handlers to an element.
 * @param {HTMLElement} target
 * @param {(pos:{x:number,y:number})=>void} handler
 */
export function bindContextTrigger(target, handler) {
  target.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    handler({ x: e.clientX, y: e.clientY });
  });

  let timer = null, startPos = null, fired = false;
  const clear = () => { clearTimeout(timer); timer = null; };

  target.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return; // handled by contextmenu
    fired = false;
    startPos = { x: e.clientX, y: e.clientY };
    timer = setTimeout(() => {
      fired = true;
      if (navigator.vibrate) navigator.vibrate(12);
      handler({ x: startPos.x, y: startPos.y });
    }, 500);
  });
  target.addEventListener('pointermove', (e) => {
    if (!startPos) return;
    if (Math.hypot(e.clientX - startPos.x, e.clientY - startPos.y) > 10) clear();
  });
  target.addEventListener('pointerup', clear);
  target.addEventListener('pointercancel', clear);
  // prevent click after long-press
  target.addEventListener('click', (e) => { if (fired) { e.preventDefault(); e.stopPropagation(); fired = false; } }, true);
}
