const CONFIG = {
  DRIVE_FOLDER_ID: "1lA62w9U1jQRTkXZI9M4xmOJxXC36Ekq0",

  UPLOAD_PIN: "",

  MAX_FILE_SIZE_MB: 45,

  MAX_UPLOADS_PER_MINUTE: 60
};

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

function doGet(e) {
  return jsonResponse({
    success: false,
    message: "This endpoint only accepts photo uploads via POST."
  });
}

function handleUpload(e) {
  if (!e || !e.parameter) {
    return jsonResponse({ success: false, message: "No data received." });
  }

  if (!checkRateLimit()) {
    return jsonResponse({
      success: false,
      message: "Too many uploads right now. Please wait a moment and try again."
    });
  }

  if (CONFIG.UPLOAD_PIN && CONFIG.UPLOAD_PIN.length > 0) {
    const suppliedPin = (e.parameter.pin || "").toString();
    if (suppliedPin !== CONFIG.UPLOAD_PIN) {
      return jsonResponse({ success: false, message: "Incorrect or missing access code." });
    }
  }

  const blob = e.parameter.file;
  const requestedFilename = (e.parameter.filename || (blob && blob.getName && blob.getName()) || "photo").toString();

  if (!blob || typeof blob.getBytes !== "function") {
    return jsonResponse({ success: false, filename: requestedFilename, message: "No image file was received." });
  }

  const contentType = blob.getContentType() || "";
  if (contentType.indexOf("image/") !== 0) {
    return jsonResponse({ success: false, filename: requestedFilename, message: "Only image files are accepted." });
  }

  const sizeBytes = blob.getBytes().length;
  const maxBytes = CONFIG.MAX_FILE_SIZE_MB * 1024 * 1024;
  if (sizeBytes > maxBytes) {
    return jsonResponse({
      success: false,
      filename: requestedFilename,
      message: "File is larger than the " + CONFIG.MAX_FILE_SIZE_MB + " MB limit."
    });
  }

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

  const safeName = getNonCollidingFilename(folder, sanitizeFilename(requestedFilename));

  blob.setName(safeName);
  const file = folder.createFile(blob);

  return jsonResponse({
    success: true,
    filename: file.getName(),
    fileId: file.getId(),
    message: "Photo uploaded successfully."
  });
}

function sanitizeFilename(name) {
  let clean = name.replace(/[\/\\:*?"<>|\x00-\x1F]/g, "_").trim();
  if (clean.length === 0) clean = "photo";
  if (clean.length > 180) clean = clean.slice(0, 180);
  return clean;
}

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
  return base + " (" + new Date().getTime() + ")" + ext;
}

function checkRateLimit() {
  const cache = CacheService.getScriptCache();
  const key = "uploadCount_" + Math.floor(new Date().getTime() / 60000);
  const current = Number(cache.get(key) || 0);
  if (current >= CONFIG.MAX_UPLOADS_PER_MINUTE) {
    return false;
  }
  cache.put(key, String(current + 1), 70);
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
