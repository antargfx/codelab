/**
 * eventBus.js
 * Tiny pub/sub used to decouple modules. Modules emit and listen for
 * application events instead of holding direct references to each other.
 */

class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._map = new Map();
  }

  /** Subscribe to an event. Returns an unsubscribe function. */
  on(type, handler) {
    if (!this._map.has(type)) this._map.set(type, new Set());
    this._map.get(type).add(handler);
    return () => this.off(type, handler);
  }

  /** Subscribe once. */
  once(type, handler) {
    const off = this.on(type, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  off(type, handler) {
    const set = this._map.get(type);
    if (set) set.delete(handler);
  }

  /** Emit an event with an optional payload. */
  emit(type, payload) {
    const set = this._map.get(type);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        handler(payload);
      } catch (err) {
        console.error(`[eventBus] handler for "${type}" threw`, err);
      }
    }
  }
}

export const bus = new EventBus();

/** Centralized event name constants to avoid typos. */
export const EVT = {
  FS_CHANGED: 'fs:changed',          // structure changed (add/remove/rename/move)
  FILE_UPDATED: 'file:updated',      // file content changed { path }
  FILE_OPEN: 'file:open',            // request to open a file { path }
  FILE_OPENED: 'file:opened',        // a file was opened { path }
  ACTIVE_CHANGED: 'tabs:active',     // active tab changed { path }
  PREVIEW_RELOAD: 'preview:reload',  // force preview rebuild
  PREVIEW_NAVIGATE: 'preview:navigate', // { path }
  CONSOLE_MSG: 'console:msg',
  NETWORK_MSG: 'network:msg',
  RUNTIME_ERROR: 'runtime:error',
  DOM_SNAPSHOT: 'dom:snapshot',
  PICK_RESULT: 'pick:result',
  THEME_CHANGED: 'theme:changed',
};
