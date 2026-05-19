/**
 * appsscript.gs — Google Apps Script for DriveFace Finder
 *
 * ════════════════════════════════════════════════════════════
 *  PHOTOGRAPHER SETUP — paste this entire file into
 *  script.google.com and deploy as a web app.
 *  Takes about 5 minutes. Do it once, works forever.
 * ════════════════════════════════════════════════════════════
 *
 * STEP-BY-STEP:
 * ─────────────
 * 1. Go to https://script.google.com/
 * 2. Click "New project"
 * 3. Delete the default code
 * 4. Paste ALL of this code
 * 5. Click the floppy-disk icon to save
 * 6. Click "Deploy" → "New deployment"
 * 7. Click the gear ⚙ next to "Type" → choose "Web app"
 * 8. Set:
 *      Description:  DriveFace Finder API
 *      Execute as:   Me  (your Google account)
 *      Who has access: Anyone
 * 9. Click "Deploy"
 * 10. Copy the Web App URL that appears — it looks like:
 *       https://script.google.com/macros/s/AKfyc.../exec
 * 11. Paste that URL into config.js → appsScriptUrl
 *
 * THAT'S IT. Guests never need a Google account or API key.
 */

// ── CORS headers required for browser fetch() ────────────
function setCorsHeaders(output) {
  // Note: Google Apps Script automatically adds CORS headers
  // when deployed as "Anyone" web app. This is just a safety belt.
  return output;
}

// ── Main entry point ──────────────────────────────────────
function doGet(e) {
  try {
    const action   = e.parameter.action   || 'list';
    const folderId = e.parameter.folderId || '';
    const page     = parseInt(e.parameter.page  || '0', 10);
    const pageSize = parseInt(e.parameter.size  || '200', 10);

    if (!folderId) {
      return jsonOut({ ok: false, error: 'folderId is required' });
    }

    if (action === 'info') {
      return handleFolderInfo(folderId);
    }

    return handleList(folderId, page, pageSize);

  } catch (err) {
    return jsonOut({ ok: false, error: err.message || 'Unknown error' });
  }
}

// ── Return folder name + total image count ────────────────
function handleFolderInfo(folderId) {
  const folder = DriveApp.getFolderById(folderId);
  const iter   = folder.getFiles();
  let count    = 0;
  while (iter.hasNext()) {
    const f = iter.next();
    if (isImage(f)) count++;
  }
  return jsonOut({
    ok:         true,
    folderName: folder.getName(),
    total:      count,
  });
}

// ── Return paginated list of image files ──────────────────
function handleList(folderId, page, pageSize) {
  const folder = DriveApp.getFolderById(folderId);
  const iter   = folder.getFiles();
  const all    = [];

  while (iter.hasNext()) {
    const f = iter.next();
    if (isImage(f)) {
      all.push({
        id:       f.getId(),
        name:     f.getName(),
        mimeType: f.getMimeType(),
      });
    }
  }

  // Sort by name for consistent ordering across pages
  all.sort((a, b) => a.name.localeCompare(b.name));

  const start = page * pageSize;
  const slice = all.slice(start, start + pageSize);

  return jsonOut({
    ok:         true,
    folderName: folder.getName(),
    files:      slice,
    page:       page,
    pageSize:   pageSize,
    total:      all.length,
    hasMore:    start + pageSize < all.length,
  });
}

// ── Helpers ───────────────────────────────────────────────
function isImage(file) {
  const mime = file.getMimeType();
  return mime === 'image/jpeg' ||
         mime === 'image/png'  ||
         mime === 'image/webp' ||
         mime === 'image/gif'  ||
         mime === 'image/bmp'  ||
         mime === 'image/tiff';
}

function jsonOut(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
