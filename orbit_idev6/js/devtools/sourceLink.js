/**
 * sourceLink.js — turn a runtime URL/path into an editor jump.
 * Maps `/__vfs__/<path>` (and absolute paths) to a VFS file, opens it
 * in a tab and reveals the referenced line.
 */
import { vfs } from '../core/vfs.js';
import { bus, EVT } from '../core/eventBus.js';
import { normalizePath } from '../core/utils.js';
import { editorCommands } from '../ui/editor.js';
import { toast } from '../ui/notify.js';

/** Convert any runtime URL to a VFS path (or null). */
export function urlToVfsPath(url) {
  if (!url) return null;
  const i = url.indexOf('/__vfs__/');
  let p = i >= 0 ? url.slice(i + 9) : url;
  p = p.split(/[?#]/)[0];
  try { p = decodeURIComponent(p); } catch {}
  p = normalizePath(p);
  if (vfs.has(p)) return p;
  // try without leading origin for absolute paths
  const base = p.split('/').slice(-1)[0];
  const match = vfs.paths().find(x => x.endsWith('/' + base) || x === base);
  return match || null;
}

/** Open a file at a line from a runtime URL. */
export function openSourceRef(url, line) {
  const path = urlToVfsPath(url);
  if (!path) { toast('Source not found in project', { type: 'error' }); return; }
  bus.emit(EVT.FILE_OPEN, { path });
  if (line) setTimeout(() => editorCommands.revealLine(line), 200);
}

/** Open a file at a line directly by path. */
export function openFileAt(path, line) {
  if (!vfs.has(path)) { toast('File not found', { type: 'error' }); return; }
  bus.emit(EVT.FILE_OPEN, { path });
  if (line) setTimeout(() => editorCommands.revealLine(line), 200);
}
