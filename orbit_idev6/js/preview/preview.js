/**
 * preview.js — live preview controller.
 *
 * Registers the virtual-localhost service worker, keeps it in sync with the
 * VFS, drives the iframe (navigation, address bar, reload), toggles the
 * element picker, and fans incoming runtime messages out onto the event bus.
 */
import { vfs } from '../core/vfs.js';
import { bus, EVT } from '../core/eventBus.js';
import { $, debounce, basename } from '../core/utils.js';
import { toast } from '../ui/notify.js';

let swReg = null;
let swReady = false;
let entry = 'index.html';
let currentPath = 'index.html';
let pickerOn = false;

const frame = () => $('#previewFrame');

/* ---------- service worker ---------- */
export async function initPreview() {
  if (!('serviceWorker' in navigator)) {
    toast('Service workers unavailable — preview limited', { type: 'error', duration: 4000 });
  } else {
    try {
      swReg = await navigator.serviceWorker.register('sw.js');
      await navigator.serviceWorker.ready;
      // Wait until a controller is active.
      if (!navigator.serviceWorker.controller) {
        await new Promise((res) => {
          const t = setTimeout(res, 1500);
          navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(t); res(); }, { once: true });
        });
      }
      swReady = true;
    } catch (err) {
      console.error('SW registration failed', err);
      toast('Preview server failed to start', { type: 'error' });
    }
  }

  wireControls();
  wireRuntimeMessages();

  // Rebuild preview when files change (debounced for fast typing).
  const reload = debounce(() => rebuild(), 250);
  bus.on(EVT.FILE_UPDATED, ({ path }) => { syncOne(path); reload(); });
  bus.on(EVT.FS_CHANGED, () => { reload(); });
  bus.on(EVT.PREVIEW_RELOAD, () => rebuild());
  bus.on(EVT.PREVIEW_NAVIGATE, ({ path }) => navigate(path));
}

/** Active service worker target. */
function sw() {
  return navigator.serviceWorker.controller || (swReg && swReg.active);
}

function postSW(msg) {
  return new Promise((resolve) => {
    const target = sw();
    if (!target) return resolve(null);
    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => resolve(e.data);
    target.postMessage(msg, [ch.port2]);
  });
}

/* ---------- VFS → SW snapshot ---------- */
function fileToPayload(node) {
  if (node.isText) return { mime: node.mime, isText: true, text: node.text ?? '' };
  return { mime: node.mime, isText: false, b64: bytesToB64(node.bytes) };
}

function bytesToB64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

async function syncAll() {
  if (!swReady) return;
  const files = {};
  for (const node of vfs.files.values()) files[node.path] = fileToPayload(node);
  await postSW({ type: 'vfs-set-all', files });
}

async function syncOne(path) {
  if (!swReady) return;
  const node = vfs.get(path);
  if (node) await postSW({ type: 'vfs-set-one', path, file: fileToPayload(node) });
}

/* ---------- preview lifecycle ---------- */
/** Full rebuild: push all files and reload the current page. */
export async function rebuild() {
  await syncAll();
  loadFrame(currentPath);
}

/** Point preview at the project entry and refresh. */
export async function startProject() {
  entry = vfs.defaultEntry() || 'index.html';
  currentPath = entry;
  await syncAll();
  loadFrame(currentPath);
}

function frameUrl(path) {
  const base = new URL('./__vfs__/' + path.replace(/^\//, ''), location.href);
  return base.href + '?t=' + Date.now();
}

function loadFrame(path) {
  currentPath = path;
  $('#previewUrl').value = path;
  frame().src = frameUrl(path);
}

export function navigate(path) {
  loadFrame(path.replace(/^\//, ''));
}

/* ---------- controls ---------- */
function wireControls() {
  $('#btnPreviewReload').addEventListener('click', () => rebuild());
  $('#btnRun').addEventListener('click', () => rebuild());
  $('#previewUrl').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.target.blur(); navigate(e.target.value.trim()); }
  });
  $('#btnPreviewExternal').addEventListener('click', () => {
    window.open(frameUrl(currentPath), '_blank');
  });
  $('#btnPickElement').addEventListener('click', togglePicker);
}

export function togglePicker(force) {
  pickerOn = typeof force === 'boolean' ? force : !pickerOn;
  $('#btnPickElement').classList.toggle('is-active', pickerOn);
  postFrame({ cmd: pickerOn ? 'pick-start' : 'pick-stop' });
  if (pickerOn) toast('Tap any element in the preview');
}

/* ---------- frame messaging ---------- */
export function postFrame(msg) {
  const w = frame().contentWindow;
  if (w) w.postMessage(Object.assign({ __orbit: 'host' }, msg), '*');
}

function wireRuntimeMessages() {
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || m.__orbit !== 'runtime') return;
    switch (m.kind) {
      case 'ready':
      case 'loaded':
        currentPath = m.path || currentPath;
        $('#previewUrl').value = currentPath;
        if (pickerOn) postFrame({ cmd: 'pick-start' });
        bus.emit(EVT.DOM_SNAPSHOT, null); // request refresh elsewhere
        break;
      case 'console': bus.emit(EVT.CONSOLE_MSG, m); break;
      case 'console-clear': bus.emit(EVT.CONSOLE_MSG, { kind: 'console-clear' }); break;
      case 'error': bus.emit(EVT.RUNTIME_ERROR, m); break;
      case 'network': bus.emit(EVT.NETWORK_MSG, m); break;
      case 'dom': bus.emit(EVT.DOM_SNAPSHOT, m); break;
      case 'pick':
        bus.emit(EVT.PICK_RESULT, m.el);
        pickerOn = false; $('#btnPickElement').classList.remove('is-active');
        break;
      case 'storage': bus.emit('storage:data', m.data); break;
    }
  });
}

export function requestDom() { postFrame({ cmd: 'request-dom' }); }
export function getCurrentPath() { return currentPath; }
