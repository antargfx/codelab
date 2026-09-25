const CONFIG = {
  UPLOAD_ENDPOINT: "https://script.google.com/macros/s/AKfycbwarCAvo-x_6B9LuAWjSlAGfpsFmcpDRMHkiKLD8oo93pxCTS2ZjVl2NMtsGpclZu_wAQ",

  REQUIRE_PIN: false,

  EVENT_TITLE: "Program Photos",
  EVENT_SUBTITLE: "Share the photographs you took — they'll go straight into the shared album.",

  MAX_FILE_SIZE_MB: 45,

  MAX_CONCURRENT_UPLOADS: 3,

  UPLOAD_TIMEOUT_MS: 120000
};

let selectedItems = [];
let isUploading = false;
let uploadedFolderNote = "";

const el = {
  title: document.getElementById("event-title"),
  subtitle: document.getElementById("event-subtitle"),
  pinPanel: document.getElementById("pinPanel"),
  pinInput: document.getElementById("pinInput"),
  pinSubmit: document.getElementById("pinSubmit"),
  pinHelp: document.getElementById("pinHelp"),
  uploaderSection: document.getElementById("uploaderSection"),
  dropzone: document.getElementById("dropzone"),
  fileInput: document.getElementById("fileInput"),
  selectionBar: document.getElementById("selectionBar"),
  selectionCount: document.getElementById("selectionCount"),
  clearAllBtn: document.getElementById("clearAllBtn"),
  previewGrid: document.getElementById("previewGrid"),
  uploadAction: document.getElementById("uploadAction"),
  uploadBtn: document.getElementById("uploadBtn"),
  progressPanel: document.getElementById("progressPanel"),
  progressLabel: document.getElementById("progressLabel"),
  progressCount: document.getElementById("progressCount"),
  progressFill: document.getElementById("progressFill"),
  fileStatusList: document.getElementById("fileStatusList"),
  resultPanel: document.getElementById("resultPanel"),
  resultIcon: document.getElementById("resultIcon"),
  resultTitle: document.getElementById("resultTitle"),
  resultMessage: document.getElementById("resultMessage"),
  retryBtn: document.getElementById("retryBtn"),
  uploadMoreBtn: document.getElementById("uploadMoreBtn"),
  srStatus: document.getElementById("srStatus")
};

function init() {
  el.title.textContent = CONFIG.EVENT_TITLE;
  el.subtitle.textContent = CONFIG.EVENT_SUBTITLE;

  if (CONFIG.REQUIRE_PIN) {
    el.pinPanel.hidden = false;
  }

  if (!CONFIG.UPLOAD_ENDPOINT || CONFIG.UPLOAD_ENDPOINT.indexOf("YOUR_GOOGLE_APPS_SCRIPT") !== -1) {
    announce("This page hasn't been configured yet: UPLOAD_ENDPOINT is missing in app.js.");
    el.dropzone.setAttribute("aria-disabled", "true");
  }

  el.fileInput.addEventListener("change", (e) => {
    addFiles(e.target.files);
    el.fileInput.value = "";
  });

  el.dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      el.fileInput.click();
    }
  });

  ["dragenter", "dragover"].forEach((evt) => {
    el.dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      el.dropzone.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach((evt) => {
    el.dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      el.dropzone.classList.remove("dragover");
    });
  });
  el.dropzone.addEventListener("drop", (e) => {
    if (e.dataTransfer && e.dataTransfer.files) {
      addFiles(e.dataTransfer.files);
    }
  });

  el.clearAllBtn.addEventListener("click", clearAll);
  el.uploadBtn.addEventListener("click", startUpload);
  el.retryBtn.addEventListener("click", retryFailed);
  el.uploadMoreBtn.addEventListener("click", resetForMore);

  el.pinSubmit.addEventListener("click", () => {
    if (el.pinInput.value.trim().length === 0) {
      el.pinHelp.textContent = "Please enter the access code.";
      el.pinHelp.classList.add("error");
      return;
    }
    el.pinHelp.classList.remove("error");
    el.pinPanel.hidden = true;
  });

  window.addEventListener("beforeunload", (e) => {
    if (isUploading) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

function addFiles(fileList) {
  const incoming = Array.from(fileList || []);
  if (incoming.length === 0) return;

  let rejectedType = 0;
  let rejectedSize = 0;
  let rejectedDuplicate = 0;

  incoming.forEach((file) => {
    if (!file.type || file.type.indexOf("image/") !== 0) {
      rejectedType++;
      return;
    }
    const maxBytes = CONFIG.MAX_FILE_SIZE_MB * 1024 * 1024;
    if (file.size > maxBytes) {
      rejectedSize++;
      return;
    }
    const isDuplicate = selectedItems.some(
      (item) => item.file.name === file.name &&
                 item.file.size === file.size &&
                 item.file.lastModified === file.lastModified
    );
    if (isDuplicate) {
      rejectedDuplicate++;
      return;
    }
    selectedItems.push({
      id: "f" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
      file: file,
      url: URL.createObjectURL(file),
      status: "waiting",
      errorMessage: ""
    });
  });

  const notes = [];
  if (rejectedType > 0) notes.push(`${rejectedType} file(s) skipped — not an image`);
  if (rejectedSize > 0) notes.push(`${rejectedSize} file(s) skipped — over ${CONFIG.MAX_FILE_SIZE_MB} MB`);
  if (rejectedDuplicate > 0) notes.push(`${rejectedDuplicate} file(s) already selected`);
  if (notes.length > 0) announce(notes.join(". "));

  renderPreviews();
}

function removeItem(id) {
  const item = selectedItems.find((it) => it.id === id);
  if (item) URL.revokeObjectURL(item.url);
  selectedItems = selectedItems.filter((it) => it.id !== id);
  renderPreviews();
}

function clearAll() {
  selectedItems.forEach((it) => URL.revokeObjectURL(it.url));
  selectedItems = [];
  renderPreviews();
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  if (bytes >= 1024) return Math.round(bytes / 1024) + " KB";
  return bytes + " B";
}

function renderPreviews() {
  const count = selectedItems.length;
  el.selectionBar.hidden = count === 0;
  el.previewGrid.hidden = count === 0;
  el.uploadAction.hidden = count === 0;
  el.selectionCount.textContent = count === 1 ? "1 photo selected" : `${count} photos selected`;

  el.previewGrid.innerHTML = "";
  selectedItems.forEach((item) => {
    const li = document.createElement("li");
    li.className = "preview-card status-" + item.status;
    li.dataset.id = item.id;

    const img = document.createElement("img");
    img.className = "preview-thumb";
    img.src = item.url;
    img.alt = "";
    li.appendChild(img);

    if (item.status !== "waiting") {
      const badge = document.createElement("span");
      badge.className = "preview-badge " + item.status;
      badge.textContent = item.status === "uploaded" ? "Uploaded"
        : item.status === "failed" ? "Failed"
        : "Uploading…";
      li.appendChild(badge);
    }

    const meta = document.createElement("div");
    meta.className = "preview-meta";
    const name = document.createElement("div");
    name.className = "preview-name";
    name.textContent = item.file.name;
    name.title = item.file.name;
    const size = document.createElement("div");
    size.className = "preview-size";
    size.textContent = formatSize(item.file.size);
    meta.appendChild(name);
    meta.appendChild(size);
    li.appendChild(meta);

    if (!isUploading) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "preview-remove";
      removeBtn.setAttribute("aria-label", "Remove " + item.file.name);
      removeBtn.innerHTML = "&times;";
      removeBtn.addEventListener("click", () => removeItem(item.id));
      li.appendChild(removeBtn);
    }

    el.previewGrid.appendChild(li);
  });
}

function startUpload() {
  if (isUploading) return;
  if (selectedItems.length === 0) return;

  if (CONFIG.REQUIRE_PIN && !el.pinPanel.hidden) {
    el.pinHelp.textContent = "Please enter the access code first.";
    el.pinHelp.classList.add("error");
    return;
  }

  runUploadQueue(selectedItems);
}

function retryFailed() {
  const failedItems = selectedItems.filter((it) => it.status === "failed");
  if (failedItems.length === 0) return;
  failedItems.forEach((it) => { it.status = "waiting"; it.errorMessage = ""; });
  runUploadQueue(failedItems);
}

function runUploadQueue(items) {
  isUploading = true;
  el.uploadBtn.disabled = true;
  el.uploadBtn.textContent = "Uploading…";
  el.clearAllBtn.style.display = "none";
  el.resultPanel.hidden = true;
  el.progressPanel.hidden = false;
  el.progressLabel.textContent = "Uploading photos…";
  renderPreviews();
  renderFileStatusList();
  updateProgress();

  let nextIndex = 0;
  let activeWorkers = 0;
  let finishedCount = 0;
  const totalCount = items.length;

  return new Promise((resolve) => {
    function launchNext() {
      if (nextIndex >= totalCount) {
        if (activeWorkers === 0) resolve();
        return;
      }
      const item = items[nextIndex++];
      activeWorkers++;
      item.status = "uploading";
      updatePreviewCard(item);
      renderFileStatusList();

      uploadOne(item)
        .then(() => { item.status = "uploaded"; item.errorMessage = ""; })
        .catch((err) => { item.status = "failed"; item.errorMessage = err.message || "Upload failed"; })
        .finally(() => {
          finishedCount++;
          activeWorkers--;
          updatePreviewCard(item);
          renderFileStatusList();
          updateProgress(finishedCount, totalCount);
          launchNext();
          if (nextIndex >= totalCount && activeWorkers === 0) resolve();
        });
    }

    const workerCount = Math.min(CONFIG.MAX_CONCURRENT_UPLOADS, totalCount);
    for (let i = 0; i < workerCount; i++) launchNext();
  }).then(() => onUploadQueueFinished());
}

function uploadOne(item) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("file", item.file, item.file.name);
    formData.append("filename", item.file.name);
    if (CONFIG.REQUIRE_PIN) {
      formData.append("pin", el.pinInput.value.trim());
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.UPLOAD_TIMEOUT_MS);

    fetch(CONFIG.UPLOAD_ENDPOINT, {
      method: "POST",
      body: formData,
      signal: controller.signal
    })
      .then((response) => {
        clearTimeout(timer);
        if (!response.ok) {
          throw new Error("Server responded with an error (" + response.status + ")");
        }
        return response.text();
      })
      .then((text) => {
        let data;
        try {
          data = JSON.parse(text);
        } catch (parseErr) {
          throw new Error("Unexpected response from the server");
        }
        if (data && data.success) {
          resolve(data);
        } else {
          reject(new Error((data && data.message) || "Upload failed"));
        }
      })
      .catch((err) => {
        clearTimeout(timer);
        if (err.name === "AbortError") {
          reject(new Error("Upload timed out — check your connection and try again"));
        } else {
          reject(new Error(err.message || "Network error — check your connection"));
        }
      });
  });
}

function onUploadQueueFinished() {
  isUploading = false;
  el.uploadBtn.disabled = false;
  el.uploadBtn.textContent = "Upload photos";
  el.clearAllBtn.style.display = "";

  const uploadedCount = selectedItems.filter((it) => it.status === "uploaded").length;
  const failedCount = selectedItems.filter((it) => it.status === "failed").length;
  const totalCount = selectedItems.length;

  el.progressPanel.hidden = true;
  el.resultPanel.hidden = false;
  el.resultPanel.classList.remove("has-errors", "all-failed");

  if (failedCount === 0) {
    el.resultIcon.textContent = "✓";
    el.resultTitle.textContent = "Upload complete";
    el.resultMessage.textContent = totalCount === 1
      ? "1 photograph uploaded successfully. Thank you for sharing it!"
      : `${uploadedCount} photographs uploaded successfully. Thank you for sharing them!`;
    el.retryBtn.hidden = true;
  } else if (uploadedCount === 0) {
    el.resultPanel.classList.add("all-failed");
    el.resultIcon.textContent = "!";
    el.resultTitle.textContent = "Upload failed";
    el.resultMessage.textContent = `${failedCount} photograph(s) could not be uploaded. Check your connection and try again.`;
    el.retryBtn.hidden = false;
  } else {
    el.resultPanel.classList.add("has-errors");
    el.resultIcon.textContent = "!";
    el.resultTitle.textContent = "Upload completed with errors";
    el.resultMessage.textContent = `${uploadedCount} photograph(s) uploaded, ${failedCount} failed.`;
    el.retryBtn.hidden = false;
  }

  announce(el.resultTitle.textContent + ". " + el.resultMessage.textContent);
  renderPreviews();
}

function resetForMore() {
  selectedItems.forEach((it) => URL.revokeObjectURL(it.url));
  selectedItems = [];
  el.resultPanel.hidden = true;
  renderPreviews();
}

function updateProgress(done, total) {
  done = done || 0;
  total = total || selectedItems.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  el.progressFill.style.width = pct + "%";
  el.progressCount.textContent = `${done} / ${total}`;
}

function updatePreviewCard(item) {
  const card = el.previewGrid.querySelector(`[data-id="${item.id}"]`);
  if (!card) { renderPreviews(); return; }
  card.className = "preview-card status-" + item.status;
  let badge = card.querySelector(".preview-badge");
  if (item.status === "waiting") {
    if (badge) badge.remove();
  } else {
    if (!badge) {
      badge = document.createElement("span");
      card.appendChild(badge);
    }
    badge.className = "preview-badge " + item.status;
    badge.textContent = item.status === "uploaded" ? "Uploaded"
      : item.status === "failed" ? "Failed"
      : "Uploading…";
  }
}

function renderFileStatusList() {
  el.fileStatusList.innerHTML = "";
  selectedItems.forEach((item) => {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "file-status-name";
    name.textContent = item.file.name;
    const state = document.createElement("span");
    state.className = "file-status-state " + item.status;
    state.textContent = {
      waiting: "Waiting",
      uploading: "Uploading…",
      uploaded: "✓ Uploaded",
      failed: "Failed"
    }[item.status] || item.status;
    li.appendChild(name);
    li.appendChild(state);
    el.fileStatusList.appendChild(li);
  });
}

function announce(message) {
  el.srStatus.textContent = message;
}

document.addEventListener("DOMContentLoaded", init);
