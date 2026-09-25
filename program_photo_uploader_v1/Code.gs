/**
 * Program Photos — Google Apps Script backend
 *
 * Receives one photograph per request (as multipart/form-data),
 * validates it, and saves the ORIGINAL, unmodified file directly
 * into one pre-existing Google Drive folder. Never creates
 * subfolders, never resizes or re-encodes the image.
 *
 * Deployment: Deploy > New deployment > Web app
 *   Execute as:      Me
 *   Who has access:  Anyone
 * See README.md for the full step-by-step walkthrough.
 */

/* ============================================================
   1) CONFIGURATION — the only things you need to edit
   ============================================================ */
const CONFIG = {
  // Paste the ID from your Google Drive folder's URL:
  // https://drive.google.com/drive/folders/PASTE_THIS_PART
  DRIVE_FOLDER_ID: "1lA62w9U1jQRTkXZI9M4xmOJxXC36Ekq0",

  // Leave empty ("") to allow anyone with the link to upload with no
  // code. Set a value to require it — see README.md "About the PIN"
  // for why this is a deterrent, not real security.
  UPLOAD_PIN: "",

  // Server-side hard limit. Requests for files larger than this are
  // rejected. Keep this at or below what Apps Script can reliably
  // accept in one request (see README.md "Upload limits").
  MAX_FILE_SIZE_MB: 45,

  // Simple abuse guard: maximum uploads accepted across ALL users in
  // any rolling 60-second window. This is a shared, global counter,
  // not a true per-person rate limit — see README.md for why.
  MAX_UPLOADS_PER_MINUTE: 60
};

/* ============================================================
   2) ENTRY POINT
   ============================================================ */
function doPost(e) {
  try {
    return handleUpload(e);
  } catch (err) {
    return jsonResponse({
      success: false,
      filename: (e && e.parameter && e.parameter.filename) || "",
      message: "Server error: " + describeError(err)
    });
  }
}

// A GET request just confirms the deployment is live; it never
// accepts uploads (uploads must be POST).
function doGet(e) {
  return jsonResponse({
    success: false,
    message: "This endpoint only accepts photo uploads via POST."
  });
}

/* ============================================================
   3) UPLOAD HANDLING
   ============================================================ */
function handleUpload(e) {
  if (!e || !e.parameter) {
    return jsonResponse({ success: false, message: "No data received." });
  }

  // ---- Rate limiting (simple, global, best-effort) ----
  if (!checkRateLimit()) {
    return jsonResponse({
      success: false,
      message: "Too many uploads right now. Please wait a moment and try again."
    });
  }

  // ---- PIN check (server-side; the only place this is meaningful) ----
  if (CONFIG.UPLOAD_PIN && CONFIG.UPLOAD_PIN.length > 0) {
    const suppliedPin = (e.parameter.pin || "").toString();
    if (suppliedPin !== CONFIG.UPLOAD_PIN) {
      return jsonResponse({ success: false, message: "Incorrect or missing access code." });
    }
  }

  // ---- Folder ID configured? ----
  if (!CONFIG.DRIVE_FOLDER_ID || CONFIG.DRIVE_FOLDER_ID.indexOf("PASTE_YOUR_FOLDER_ID") !== -1) {
    return jsonResponse({ success: false, message: "Server is not configured: DRIVE_FOLDER_ID is missing." });
  }

  // ---- The uploaded file itself ----
  // When a browser POSTs multipart/form-data to an Apps Script web
  // app, a file input field arrives in e.parameter as a Blob object
  // (not a filename string) — this is standard Apps Script behavior.
  const blob = e.parameter.file;
  const requestedFilename = (e.parameter.filename || (blob && blob.getName && blob.getName()) || "photo").toString();

  if (!blob || typeof blob.getBytes !== "function") {
    return jsonResponse({ success: false, filename: requestedFilename, message: "No image file was received." });
  }

  // ---- Validate it is actually an image ----
  const contentType = blob.getContentType() || "";
  if (contentType.indexOf("image/") !== 0) {
    return jsonResponse({ success: false, filename: requestedFilename, message: "Only image files are accepted." });
  }

  // ---- Validate size ----
  const sizeBytes = blob.getBytes().length;
  const maxBytes = CONFIG.MAX_FILE_SIZE_MB * 1024 * 1024;
  if (sizeBytes > maxBytes) {
    return jsonResponse({
      success: false,
      filename: requestedFilename,
      message: "File is larger than the " + CONFIG.MAX_FILE_SIZE_MB + " MB limit."
    });
  }

  // ---- Get the target folder (must already exist; never created here) ----
  let folder;
  try {
    folder = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
  } catch (err) {
    return jsonResponse({
      success: false,
      filename: requestedFilename,
      message: "Invalid Drive folder ID, or this account cannot access it."
    });
  }

  // ---- Resolve a filename that won't overwrite an existing photo ----
  const safeName = getNonCollidingFilename(folder, sanitizeFilename(requestedFilename));

  // ---- Save the ORIGINAL bytes, unmodified, directly into the folder ----
  blob.setName(safeName);
  const file = folder.createFile(blob);

  return jsonResponse({
    success: true,
    filename: file.getName(),
    fileId: file.getId(),
    message: "Photo uploaded successfully."
  });
}

/* ============================================================
   4) HELPERS
   ============================================================ */

// Strips characters that are awkward in Drive filenames and trims
// length, without touching the image bytes themselves.
function sanitizeFilename(name) {
  let clean = name.replace(/[\/\\:*?"<>|\x00-\x1F]/g, "_").trim();
  if (clean.length === 0) clean = "photo";
  if (clean.length > 180) clean = clean.slice(0, 180);
  return clean;
}

// If "IMG_001.jpg" already exists in the folder, tries
// "IMG_001 (1).jpg", "IMG_001 (2).jpg", etc. until a free name is
// found. The original filename is preserved as-is whenever possible.
function getNonCollidingFilename(folder, filename) {
  if (!folder.getFilesByName(filename).hasNext()) {
    return filename;
  }

  const dotIndex = filename.lastIndexOf(".");
  const base = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  const ext = dotIndex > 0 ? filename.slice(dotIndex) : "";

  for (let n = 1; n < 1000; n++) {
    const candidate = base + " (" + n + ")" + ext;
    if (!folder.getFilesByName(candidate).hasNext()) {
      return candidate;
    }
  }
  // Extremely unlikely fallback: make it unique with a timestamp.
  return base + " (" + new Date().getTime() + ")" + ext;
}

// Best-effort global rate limiter using CacheService. This is shared
// across everyone hitting the script at once — it is NOT a per-user
// or per-IP limit (Apps Script web apps do not reliably expose the
// caller's IP address). It exists only to blunt accidental floods or
// runaway scripts, not to stop a determined abuser.
function checkRateLimit() {
  const cache = CacheService.getScriptCache();
  const key = "uploadCount_" + Math.floor(new Date().getTime() / 60000); // per-minute bucket
  const current = Number(cache.get(key) || 0);
  if (current >= CONFIG.MAX_UPLOADS_PER_MINUTE) {
    return false;
  }
  cache.put(key, String(current + 1), 70); // expires just after the minute window
  return true;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function describeError(err) {
  return (err && err.message) ? err.message : String(err);
}
