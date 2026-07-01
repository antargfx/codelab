/**
 * editor.js — editor facade.
 *
 * Delegates to the self-contained, CDN-free code editor (codeEditor.js).
 * This editor uses inline styles and a native <textarea>, so it renders
 * reliably on every browser (notably Android Chrome) regardless of stylesheet
 * caching or CDN availability. The facade keeps a stable public API for the
 * rest of the app (tabs, errors, source links, main).
 */
import {
  initEditor2, openInEditor2, showEmpty2, relayout2, editorCommands2, getCurrentPath2,
} from './codeEditor.js';

let started = false;

export async function initEditor() {
  initEditor2();
  started = true;
  return null;
}

export async function openInEditor(path) {
  if (!started) initEditor();
  openInEditor2(path);
}

/** No per-tab models in the lightweight editor; the VFS is the source of truth. */
export function disposeModel(/* path */) {}
export function renameModel(/* from, to */) {}

export function showEmpty() { showEmpty2(); }

export function relayout() { relayout2(); }

export const editorCommands = editorCommands2;

/** Diagnostics are surfaced in the Errors panel; editor markers are a no-op here. */
export function setMarkers(/* path, markers */) {}

export function getEditor() { return null; }
export function getCurrentPath() { return getCurrentPath2(); }
export function isFallback() { return true; }
