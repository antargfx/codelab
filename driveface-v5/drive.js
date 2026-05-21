/**
 * drive.js — Google Drive Integration (No API Key Required)
 *
 * How it works:
 * ─────────────
 * 1. The photographer deploys a Google Apps Script web app once.
 *    That script runs under THEIR Google account and can read
 *    their Drive folders freely.
 *
 * 2. This module calls that web app URL to list images in a folder.
 *    Guests need no Google account, no API key, nothing.
 *
 * 3. Image content (for face detection) is fetched directly from
 *    Google's CDN using publicly-shared file URLs — no auth needed
 *    as long as the folder is shared as "Anyone with the link".
 *
 * Image URL strategy:
 * ────────────────────
 *  • Thumbnails (gallery display):
 *      https://drive.google.com/thumbnail?id=FILE_ID&sz=w400
 *
 *  • Full quality (lightbox):
 *      https://lh3.googleusercontent.com/d/FILE_ID
 *
 *  • For face detection (needs pixel access via canvas):
 *      Fetched as Blob via fetch(), converted to object URL.
 *      lh3.googleusercontent.com serves public images with CORS
 *      headers, so canvas access works without a proxy.
 */

'use strict';

const DriveAPI = (() => {

  /* ── helpers ──────────────────────────────────────────── */

  function getScriptUrl() {
    // Priority: localStorage override → config file default
    return Storage.get('dff_scriptUrl', '') || DRIVEFACE_CONFIG.appsScriptUrl || '';
  }

  /**
   * Fetch with automatic retry on transient failures.
   * Backs off exponentially on 429 / 5xx.
   */
  async function fetchRetry(url, opts = {}, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch(url, { redirect: 'follow', ...opts });
        if ((res.status === 429 || res.status >= 500) && i < retries - 1) {
          await Utils.sleep(Math.pow(2, i) * 900 + Math.random() * 200);
          continue;
        }
        return res;
      } catch (err) {
        if (i === retries - 1) throw err;
        await Utils.sleep(Math.pow(2, i) * 700);
      }
    }
  }

  /**
   * Call the Apps Script web app with query parameters.
   * Returns parsed JSON or throws a descriptive error.
   */
  async function callScript(params) {
    const base = getScriptUrl();
    if (!base) {
      throw new Error(
        'Apps Script URL not configured. ' +
        'Open Settings → Photographer Setup to add it.'
      );
    }

    const url = base + '?' + new URLSearchParams(params).toString();

    let res;
    try {
      res = await fetchRetry(url);
    } catch (err) {
      throw new Error(
        'Could not reach the Apps Script endpoint. ' +
        'Check your internet connection and the URL in Settings. ' +
        `(${err.message})`
      );
    }

    // Apps Script might redirect; after following redirects the
    // final response is always JSON when properly deployed.
    let body;
    try {
      body = await res.json();
    } catch {
      throw new Error(
        'Apps Script returned an unexpected response. ' +
        'Make sure the script is deployed as a Web App with ' +
        '"Anyone" access and "Execute as: Me".'
      );
    }

    if (!body.ok) {
      throw new Error(body.error || 'Apps Script returned an error.');
    }

    return body;
  }

  /* ── public API ───────────────────────────────────────── */

  /**
   * Validate a folder ID and return its name + image count.
   * @param {string} folderId
   * @returns {{ valid: boolean, name?: string, total?: number, error?: string }}
   */
  async function validateFolder(folderId) {
    if (!folderId) return { valid: false, error: 'No folder ID provided.' };
    if (!getScriptUrl()) {
      return {
        valid: false,
        error: 'Apps Script URL not configured. Open Settings to add it.',
      };
    }

    try {
      const data = await callScript({ action: 'info', folderId });
      return { valid: true, name: data.folderName, total: data.total };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  /**
   * Fetch ALL image files from a Drive folder via the Apps Script.
   * Handles pagination transparently.
   *
   * @param {string}   folderId
   * @param {number}   maxFiles  – stop after this many images
   * @param {Function} onPage    – (loaded, total) => void  progress callback
   * @returns {Promise<Array>}   – array of { id, name, mimeType }
   */
  async function getFolderImages(folderId, maxFiles = 800, onPage) {
    const PAGE_SIZE = 200;
    const all  = [];
    let   page = 0;
    let   total = Infinity;

    while (all.length < Math.min(maxFiles, total)) {
      const data = await callScript({
        action:   'list',
        folderId,
        page,
        size: Math.min(PAGE_SIZE, maxFiles - all.length),
      });

      total = data.total;
      all.push(...(data.files || []));
      if (onPage) onPage(all.length, total);

      if (!data.hasMore) break;
      page++;
    }

    return all.slice(0, maxFiles);
  }

  /**
   * Fetch a Drive image as a Blob for face detection.
   *
   * We try two URL strategies:
   *  1. lh3.googleusercontent.com/d/FILE_ID
   *     → Google's CDN; serves images for publicly shared files
   *       with CORS headers, so canvas pixel access works.
   *  2. drive.google.com/thumbnail?id=FILE_ID&sz=w640
   *     → Thumbnail endpoint; fallback if lh3 fails.
   *
   * @param {string} fileId
   * @returns {Promise<Blob>}
   */
  async function fetchImageBlob(fileId) {
    const strategies = [
      `https://lh3.googleusercontent.com/d/${fileId}`,
      `https://drive.google.com/thumbnail?id=${fileId}&sz=w640`,
    ];

    for (const url of strategies) {
      try {
        const res = await fetchRetry(url, {}, 2);
        if (res.ok) {
          const blob = await res.blob();
          // Sanity check: must be an actual image
          if (blob.type.startsWith('image/') || blob.size > 1000) {
            return blob;
          }
        }
      } catch { /* try next strategy */ }
    }

    throw new Error(`Could not fetch image ${fileId} from Google Drive.`);
  }

  /**
   * Build the best available view URL for an image (lightbox / download).
   */
  function viewUrl(fileId) {
    return `https://lh3.googleusercontent.com/d/${fileId}`;
  }

  /**
   * Build a thumbnail URL suitable for gallery cards.
   * @param {Object} file   – Drive file object with .id and optional .thumbnailLink
   * @param {number} size   – pixel width
   */
  function thumbUrl(file, size = 400) {
    if (file.thumbnailLink) {
      return file.thumbnailLink.replace(/=s\d+$/, `=s${size}`);
    }
    return `https://drive.google.com/thumbnail?id=${file.id}&sz=w${size}`;
  }

  /**
   * Test the Apps Script connection and return status.
   */
  async function testConnection(scriptUrl) {
    if (!scriptUrl) return { ok: false, error: 'No URL provided.' };

    const testUrl = scriptUrl + '?action=ping';
    try {
      const res  = await fetchRetry(testUrl, {}, 2);
      const body = await res.json().catch(() => null);
      // Any valid JSON response means the endpoint is reachable
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  return {
    validateFolder,
    getFolderImages,
    fetchImageBlob,
    viewUrl,
    thumbUrl,
    testConnection,
    get scriptUrl() { return getScriptUrl(); },
  };
})();
