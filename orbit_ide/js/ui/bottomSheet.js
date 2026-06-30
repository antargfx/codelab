/**
 * bottomSheet.js — modal bottom sheet used for prompts and forms.
 * Mobile-first replacement for window.prompt/confirm.
 */
import { $, el } from '../core/utils.js';

function close() {
  $('#bottomSheet').hidden = true;
  $('#bottomSheet').innerHTML = '';
  $('#sheetBackdrop').hidden = true;
}

$('#sheetBackdrop').addEventListener('click', close);

/** Generic sheet. `build(body, resolve)` populates the body. */
function openSheet(build) {
  return new Promise((resolve) => {
    const sheet = $('#bottomSheet');
    const backdrop = $('#sheetBackdrop');
    sheet.innerHTML = '';
    sheet.appendChild(el('div', { class: 'bottom-sheet__grip' }));
    const done = (val) => { close(); resolve(val); };
    build(sheet, done);
    backdrop.hidden = false;
    sheet.hidden = false;
  });
}

/** Prompt for a single text value. */
export function promptSheet({ title, label = 'Name', value = '', placeholder = '', confirmText = 'OK' }) {
  return openSheet((sheet, done) => {
    sheet.appendChild(el('h3', { text: title }));
    const input = el('input', { value, placeholder, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    const field = el('div', { class: 'field' }, [el('label', { text: label }), input]);
    sheet.appendChild(field);
    const submit = () => done(input.value.trim() || null);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') done(null); });
    sheet.appendChild(el('div', { class: 'actions' }, [
      el('button', { class: 'btn ghost', text: 'Cancel', onclick: () => done(null) }),
      el('button', { class: 'btn primary', text: confirmText, onclick: submit }),
    ]));
    setTimeout(() => { input.focus(); input.select(); }, 50);
  });
}

/** Confirm dialog. Resolves true/false. */
export function confirmSheet({ title, message, confirmText = 'Confirm', danger = false }) {
  return openSheet((sheet, done) => {
    sheet.appendChild(el('h3', { text: title }));
    if (message) sheet.appendChild(el('p', { text: message, class: 'hint', style: 'margin-bottom:16px' }));
    sheet.appendChild(el('div', { class: 'actions' }, [
      el('button', { class: 'btn ghost', text: 'Cancel', onclick: () => done(false) }),
      el('button', { class: `btn ${danger ? 'danger' : 'primary'}`, text: confirmText, onclick: () => done(true) }),
    ]));
  });
}

/** Choice list. Resolves chosen value or null. */
export function chooseSheet({ title, options }) {
  return openSheet((sheet, done) => {
    sheet.appendChild(el('h3', { text: title }));
    for (const opt of options) {
      sheet.appendChild(el('button', {
        class: 'btn block', style: 'margin-bottom:8px;justify-content:flex-start',
        text: opt.label, onclick: () => done(opt.value),
      }));
    }
    sheet.appendChild(el('div', { class: 'actions' }, [
      el('button', { class: 'btn ghost', text: 'Cancel', onclick: () => done(null) }),
    ]));
  });
}

export { close as closeSheet, openSheet };
