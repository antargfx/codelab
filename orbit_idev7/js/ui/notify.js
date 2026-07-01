/**
 * notify.js — transient toast notifications.
 */
import { $, el } from '../core/utils.js';

export function toast(message, { type = 'default', duration = 2400 } = {}) {
  const host = $('#toastHost');
  const t = el('div', { class: `toast ${type}`, text: message });
  host.appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .25s, transform .25s';
    t.style.opacity = '0';
    t.style.transform = 'translateY(8px)';
    setTimeout(() => t.remove(), 260);
  }, duration);
}
