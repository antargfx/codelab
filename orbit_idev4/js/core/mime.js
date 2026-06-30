/**
 * mime.js
 * File-type helpers: extension → MIME type, editor language, category.
 */

const MIME = {
  html: 'text/html', htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript',
  json: 'application/json',
  txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown',
  xml: 'application/xml', svg: 'image/svg+xml',
  csv: 'text/csv',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon', bmp: 'image/bmp', avif: 'image/avif',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  pdf: 'application/pdf',
};

const LANG = {
  html: 'html', htm: 'html',
  css: 'css',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json',
  ts: 'typescript', jsx: 'javascript', tsx: 'typescript',
  md: 'markdown', markdown: 'markdown',
  xml: 'xml', svg: 'xml',
  txt: 'plaintext', csv: 'plaintext',
  yml: 'yaml', yaml: 'yaml',
  scss: 'scss', less: 'less',
};

const TEXT_EXT = new Set([
  'html','htm','css','js','mjs','cjs','json','txt','md','markdown','xml','svg',
  'csv','ts','jsx','tsx','yml','yaml','scss','less','map',
]);
const IMAGE_EXT = new Set(['png','jpg','jpeg','gif','webp','ico','bmp','avif','svg']);
const FONT_EXT = new Set(['woff','woff2','ttf','otf','eot']);
const AUDIO_EXT = new Set(['mp3','wav','ogg','m4a','aac']);
const VIDEO_EXT = new Set(['mp4','webm','mov']);

export function ext(path) {
  const base = path.split('/').pop() || '';
  const i = base.lastIndexOf('.');
  return i >= 0 ? base.slice(i + 1).toLowerCase() : '';
}

export function mimeOf(path) {
  return MIME[ext(path)] || 'application/octet-stream';
}

export function langOf(path) {
  return LANG[ext(path)] || 'plaintext';
}

export function isText(path) { return TEXT_EXT.has(ext(path)); }
export function isImage(path) { return IMAGE_EXT.has(ext(path)); }
export function isFont(path) { return FONT_EXT.has(ext(path)); }
export function isAudio(path) { return AUDIO_EXT.has(ext(path)); }
export function isVideo(path) { return VIDEO_EXT.has(ext(path)); }
export function isJson(path) { return ext(path) === 'json'; }

/** Category for icon coloring. */
export function categoryOf(path) {
  const e = ext(path);
  if (e === 'html' || e === 'htm') return 'html';
  if (e === 'css' || e === 'scss' || e === 'less') return 'css';
  if (e === 'js' || e === 'mjs' || e === 'cjs' || e === 'ts' || e === 'jsx' || e === 'tsx') return 'js';
  if (e === 'json') return 'json';
  if (IMAGE_EXT.has(e)) return 'img';
  if (FONT_EXT.has(e)) return 'font';
  if (AUDIO_EXT.has(e) || VIDEO_EXT.has(e)) return 'media';
  return 'default';
}
