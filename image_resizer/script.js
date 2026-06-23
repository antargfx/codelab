/* =================================================================
 * Image Resizer — script.js
 * Vanilla JS. No frameworks.
 *
 * External libs:
 *   - Cropper.js  -> interactive crop modal (zoom/pan/move).
 *
 * Architecture overview
 *   state          -> single source of truth for the active image
 *   El             -> cached DOM lookups
 *   Toast          -> notifications
 *   ImageEngine    -> all canvas / resize / encode / target-size logic
 *   CropController -> Cropper.js lifecycle (create + destroy safely)
 *   Batch          -> multi-image queue
 *   wiring         -> event listeners
 * ================================================================= */

(function () {
  "use strict";

  /* ---------------------------------------------------------------
   * Constants
   * ------------------------------------------------------------- */
  const ACCEPTED = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
  const MAX_SOURCE_DIM = 6000; // guard against gigantic images
  const FORMAT_EXT = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };

  /* ---------------------------------------------------------------
   * Application state
   * ------------------------------------------------------------- */
  const state = {
    sourceBitmap: null,   // ImageBitmap of the ORIGINAL upload (immutable)
    baseBitmap: null,     // geometric subject: the source, OR the cropped result
    workingBitmap: null,  // the subject actually rendered
    originalFile: null,   // File object
    originalSize: 0,      // bytes
    originalW: 0,
    originalH: 0,
    lastBlob: null,       // most recent processed Blob (for download/copy)
    lastUrl: null,        // object URL for lastBlob
    busy: false,
  };

  /** Close every live bitmap exactly once and clear the references. */
  function disposeBitmaps() {
    const seen = new Set();
    [state.sourceBitmap, state.baseBitmap, state.workingBitmap]
      .forEach((b) => {
        if (b && !seen.has(b)) { seen.add(b); b.close && b.close(); }
      });
    state.sourceBitmap = state.baseBitmap = state.workingBitmap = null;
  }

  /** Dispose the current crop (but never the immutable source). */
  function clearDerivedBitmaps() {
    if (state.baseBitmap && state.baseBitmap !== state.sourceBitmap) {
      state.baseBitmap.close && state.baseBitmap.close();
    }
  }

  /* ---------------------------------------------------------------
   * DOM cache
   * ------------------------------------------------------------- */
  const $ = (sel) => document.querySelector(sel);
  const El = {
    // upload
    dropZone: $("#dropZone"),
    fileInput: $("#fileInput"),
    browseBtn: $("#browseBtn"),
    uploadProgress: $("#uploadProgress"),
    uploadBar: $("#uploadBar"),
    uploadPercent: $("#uploadPercent"),
    // info
    fileInfoCard: $("#fileInfoCard"),
    infoName: $("#infoName"),
    infoDims: $("#infoDims"),
    infoSize: $("#infoSize"),
    // actions
    actionCard: $("#actionCard"),
    cropBtn: $("#cropBtn"),
    stretchBtn: $("#stretchBtn"),
    resetBtn: $("#resetBtn"),
    // previews
    emptyState: $("#emptyState"),
    previewArea: $("#previewArea"),
    originalCard: $("#originalCard"),
    originalImg: $("#originalImg"),
    processedCard: $("#processedCard"),
    processedImg: $("#processedImg"),
    origW: $("#origW"), origH: $("#origH"), origSize: $("#origSize"),
    procW: $("#procW"), procH: $("#procH"), procSize: $("#procSize"),
    // processing
    processingBar: $("#processingBar"),
    processBar: $("#processBar"),
    processingLabel: $("#processingLabel"),
    processingPercent: $("#processingPercent"),
    // stats
    statDims: $("#statDims"),
    statSize: $("#statSize"),
    statRatio: $("#statRatio"),
    downloadBtn: $("#downloadBtn"),
    copyBtn: $("#copyBtn"),
    // settings
    widthInput: $("#widthInput"),
    heightInput: $("#heightInput"),
    lockRatio: $("#lockRatio"),
    formatSelect: $("#formatSelect"),
    qualitySlider: $("#qualitySlider"),
    qualityVal: $("#qualityVal"),
    targetSize: $("#targetSize"),
    // batch
    batchCard: $("#batchCard"),
    batchList: $("#batchList"),
    batchCount: $("#batchCount"),
    batchProcessBtn: $("#batchProcessBtn"),
    batchDownloadBtn: $("#batchDownloadBtn"),
    // crop modal
    cropModal: $("#cropModal"),
    cropImage: $("#cropImage"),
    cropConfirm: $("#cropConfirm"),
    zoomIn: $("#zoomIn"), zoomOut: $("#zoomOut"),
    rotateLeft: $("#rotateLeft"), rotateRight: $("#rotateRight"),
    cropReset: $("#cropReset"),
    // theme
    themeToggle: $("#themeToggle"),
    toastContainer: $("#toastContainer"),
  };

  /* ===============================================================
   * Utilities
   * ============================================================= */
  const Util = {
    bytes(n) {
      if (n == null) return "—";
      if (n < 1024) return n + " B";
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
      return (n / 1024 / 1024).toFixed(2) + " MB";
    },
    clamp(v, min, max) { return Math.min(max, Math.max(min, v)); },
    revoke(url) { if (url) { try { URL.revokeObjectURL(url); } catch (e) {} } },
  };

  /* ===============================================================
   * Toast notifications
   * ============================================================= */
  const Toast = {
    show(message, type = "info", title) {
      const t = document.createElement("div");
      t.className = `toast ${type}`;
      const heading = title || { success: "Success", error: "Error", info: "Heads up" }[type];
      t.innerHTML = `<div><strong></strong><span></span></div>`;
      t.querySelector("strong").textContent = heading;
      t.querySelector("span").textContent = message;
      El.toastContainer.appendChild(t);
      setTimeout(() => {
        t.classList.add("hide");
        t.addEventListener("animationend", () => t.remove(), { once: true });
      }, 3600);
    },
    success(m, t) { this.show(m, "success", t); },
    error(m, t) { this.show(m, "error", t); },
    info(m, t) { this.show(m, "info", t); },
  };

  /* ===============================================================
   * Busy / button-disable management
   * ============================================================= */
  function setBusy(isBusy, label) {
    state.busy = isBusy;
    [El.cropBtn, El.stretchBtn, El.downloadBtn, El.copyBtn, El.resetBtn,
     El.batchProcessBtn, El.batchDownloadBtn].forEach((b) => {
      if (b) b.disabled = isBusy || (b === El.downloadBtn && !state.lastBlob) || (b === El.copyBtn && !state.lastBlob);
    });
    if (isBusy) {
      El.processingBar.classList.remove("hidden");
      El.processingLabel.textContent = label || "Processing…";
      El.processingPercent.textContent = "";
    } else {
      El.processingBar.classList.add("hidden");
    }
  }

  function setProcessProgress(pct, label) {
    El.processBar.classList.remove("indeterminate");
    El.processBar.style.width = Util.clamp(pct, 0, 100) + "%";
    if (label) El.processingLabel.textContent = label;
    El.processingPercent.textContent = Math.round(pct) + "%";
  }

  /* ===============================================================
   * ImageEngine — canvas drawing, resizing, encoding, target size
   * ============================================================= */
  const ImageEngine = {
    render(bitmap, w, h, fillStr) {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      if (fillStr && fillStr !== "transparent") {
        ctx.fillStyle = fillStr;
        ctx.fillRect(0, 0, w, h);
      }

      ctx.drawImage(bitmap, 0, 0, w, h);
      return canvas;
    },

    toBlob(canvas, type, quality) {
      return new Promise((resolve, reject) => {
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("Encoding failed"))),
          type,
          quality
        );
      });
    },

    async encode(canvas, type, quality01, targetBytes, onProgress) {
      if (type === "image/png") {
        const blob = await this.toBlob(canvas, type, 1);
        return { blob, quality: 1, hitTarget: !targetBytes || blob.size <= targetBytes };
      }

      if (!targetBytes) {
        const blob = await this.toBlob(canvas, type, quality01);
        return { blob, quality: quality01, hitTarget: true };
      }

      let lo = 0.05;
      let hi = quality01;
      let best = await this.toBlob(canvas, type, hi);
      if (best.size <= targetBytes) {
        return { blob: best, quality: hi, hitTarget: true };
      }
      let bestQ = hi;
      const ITER = 8;
      for (let i = 0; i < ITER; i++) {
        const mid = (lo + hi) / 2;
        const blob = await this.toBlob(canvas, type, mid);
        if (onProgress) onProgress(((i + 1) / ITER) * 100);
        if (blob.size <= targetBytes) {
          best = blob; bestQ = mid; lo = mid;
        } else {
          hi = mid;
        }
      }
      return { blob: best, quality: bestQ, hitTarget: best.size <= targetBytes };
    },
  };

  /* ===============================================================
   * Source loading
   * ============================================================= */
  function validateFile(file) {
    if (!file) return "No file provided.";
    const typeOk = ACCEPTED.includes(file.type) ||
      /\.(jpe?g|png|webp)$/i.test(file.name);
    if (!typeOk) return `Unsupported format: ${file.type || file.name}. Use JPG, PNG or WEBP.`;
    if (file.size === 0) return "File appears to be empty.";
    return null;
  }

  function loadFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = (e.loaded / e.total) * 100;
          El.uploadBar.style.width = pct + "%";
          El.uploadPercent.textContent = Math.round(pct) + "%";
        }
      };
      reader.onerror = () => reject(new Error("Could not read file."));
      reader.onload = async () => {
        try {
          El.uploadBar.style.width = "100%";
          El.uploadPercent.textContent = "100%";
          const blob = new Blob([reader.result], { type: file.type || "image/png" });
          const bitmap = await createImageBitmap(blob);
          if (bitmap.width > MAX_SOURCE_DIM || bitmap.height > MAX_SOURCE_DIM) {
            Toast.info(`Large image (${bitmap.width}×${bitmap.height}). It will still work but may be slower.`);
          }
          resolve(bitmap);
        } catch (err) {
          reject(new Error("Could not decode image. It may be corrupt."));
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  async function setSource(file) {
    const error = validateFile(file);
    if (error) { Toast.error(error); return; }

    El.uploadProgress.classList.remove("hidden");
    El.uploadBar.style.width = "0%";
    El.uploadPercent.textContent = "0%";

    try {
      disposeBitmaps();

      const bitmap = await loadFile(file);
      state.sourceBitmap = bitmap;
      state.baseBitmap = bitmap;
      state.workingBitmap = bitmap;
      state.originalFile = file;
      state.originalSize = file.size;
      state.originalW = bitmap.width;
      state.originalH = bitmap.height;

      El.infoName.textContent = file.name;
      El.infoName.title = file.name;
      El.infoDims.textContent = `${bitmap.width} × ${bitmap.height} px`;
      El.infoSize.textContent = Util.bytes(file.size);

      const url = URL.createObjectURL(file);
      El.originalImg.onload = () => Util.revoke(url);
      El.originalImg.src = url;
      El.origW.textContent = bitmap.width;
      El.origH.textContent = bitmap.height;
      El.origSize.textContent = Util.bytes(file.size);

      El.fileInfoCard.classList.remove("hidden");
      El.actionCard.classList.remove("hidden");
      El.emptyState.classList.add("hidden");
      El.previewArea.classList.remove("hidden");
      
      // show original initially on fresh load
      El.originalCard.classList.remove("hidden");
      El.processedCard.classList.add("hidden");

      Toast.success("Image loaded. Pick a resize mode.");
    } catch (err) {
      Toast.error(err.message || "Failed to load image.");
    } finally {
      setTimeout(() => El.uploadProgress.classList.add("hidden"), 400);
    }
  }

  /* ===============================================================
   * Processing pipeline
   * ============================================================= */
  async function process(mode) {
    if (!state.workingBitmap) { Toast.error("Upload an image first."); return; }
    if (state.busy) return;

    setBusy(true, "Rendering…");
    El.processBar.classList.add("indeterminate");

    try {
      const w = Util.clamp(parseInt(El.widthInput.value, 10) || 300, 1, 8000);
      const h = Util.clamp(parseInt(El.heightInput.value, 10) || 300, 1, 8000);
      const type = El.formatSelect.value;
      let quality = parseInt(El.qualitySlider.value, 10) / 100;
      const targetKb = parseFloat(El.targetSize.value);
      const targetBytes = targetKb > 0 ? targetKb * 1024 : null;

      // Fill with white for JPEGs since they don't support transparency
      const fill = type === "image/jpeg" ? "#ffffff" : "transparent";
      
      const canvas = ImageEngine.render(state.workingBitmap, w, h, fill);

      El.processingLabel.textContent = targetBytes ? "Optimising file size…" : "Encoding…";
      const { blob, quality: usedQ, hitTarget } = await ImageEngine.encode(
        canvas, type, quality, targetBytes,
        (p) => setProcessProgress(p, "Optimising file size…")
      );

      if (targetBytes) {
        El.qualitySlider.value = Math.round(usedQ * 100);
        El.qualityVal.textContent = Math.round(usedQ * 100) + "%";
        if (!hitTarget) {
          Toast.info(`Couldn't reach ${targetKb} KB even at lowest quality. Got ${Util.bytes(blob.size)}.`);
        } else {
          Toast.success(`Optimised to ${Util.bytes(blob.size)} (≤ ${targetKb} KB).`);
        }
      }

      commitResult(blob, w, h);
    } catch (err) {
      console.error(err);
      Toast.error(err.message || "Processing failed.");
    } finally {
      setBusy(false);
    }
  }

  function commitResult(blob, w, h) {
    Util.revoke(state.lastUrl);
    state.lastBlob = blob;
    state.lastUrl = URL.createObjectURL(blob);

    El.processedImg.src = state.lastUrl;
    El.processedCard.classList.remove("hidden");

    El.procW.textContent = w;
    El.procH.textContent = h;
    El.procSize.textContent = Util.bytes(blob.size);

    El.statDims.textContent = `${w} × ${h} px`;
    El.statSize.textContent = Util.bytes(blob.size);
    const ratio = state.originalSize ? (state.originalSize / blob.size) : 0;
    El.statRatio.textContent = ratio ? `${ratio.toFixed(2)}× smaller` : "—";

    El.downloadBtn.disabled = false;
    El.copyBtn.disabled = false;
  }

  /* ===============================================================
   * CropController
   * ============================================================= */
  const CropController = {
    cropper: null,

    open() {
      if (!state.sourceBitmap) { Toast.error("Upload an image first."); return; }

      const w = Util.clamp(parseInt(El.widthInput.value, 10) || 300, 1, 8000);
      const h = Util.clamp(parseInt(El.heightInput.value, 10) || 300, 1, 8000);
      const ratio = w / h;
      const hint = document.getElementById("cropRatioHint");
      if (hint) hint.textContent = `— crop ratio ${w} : ${h}`;

      const c = ImageEngine.render(
        state.sourceBitmap, state.sourceBitmap.width, state.sourceBitmap.height,
        "transparent"
      );
      El.cropImage.src = c.toDataURL("image/png");
      El.cropModal.classList.remove("hidden");

      El.cropImage.onload = () => {
        this.destroy();
        this.cropper = new Cropper(El.cropImage, {
          aspectRatio: ratio,
          viewMode: 1,
          dragMode: "move",
          autoCropArea: 0.85,
          background: false,
          responsive: true,
          restore: false,
          zoomable: true,
          movable: true,
          guides: true,
          center: true,
        });
      };
    },

    destroy() {
      if (this.cropper) {
        this.cropper.destroy();
        this.cropper = null;
      }
    },

    close() {
      this.destroy();
      El.cropModal.classList.add("hidden");
      El.cropImage.removeAttribute("src");
    },

    async confirm() {
      if (!this.cropper) return;
      El.cropConfirm.classList.add("loading");
      try {
        const w = Util.clamp(parseInt(El.widthInput.value, 10) || 300, 1, 8000);
        const h = Util.clamp(parseInt(El.heightInput.value, 10) || 300, 1, 8000);
        const cropCanvas = this.cropper.getCroppedCanvas({
          width: w,
          height: h,
          imageSmoothingEnabled: true,
          imageSmoothingQuality: "high",
        });

        const cropBitmap = await createImageBitmap(cropCanvas);
        clearDerivedBitmaps();
        state.baseBitmap = cropBitmap;
        state.workingBitmap = cropBitmap;

        this.close();
        El.originalCard.classList.add("hidden");
        Toast.success("Crop applied.");
        await process("stretch");
      } catch (err) {
        Toast.error(err.message || "Crop failed.");
      } finally {
        El.cropConfirm.classList.remove("loading");
      }
    },
  };

  /* ===============================================================
   * Batch queue
   * ============================================================= */
  const Batch = {
    items: [],
    add(files) {
      for (const f of files) {
        if (!validateFile(f)) {
          this.items.push({ id: crypto.randomUUID(), file: f });
        }
      }
      this.render();
      if (this.items.length > 1) El.batchCard.classList.remove("hidden");
    },
    remove(id) {
      this.items = this.items.filter((it) => it.id !== id);
      this.render();
      if (this.items.length <= 1) El.batchCard.classList.add("hidden");
    },
    render() {
      El.batchCount.textContent = this.items.length;
      El.batchList.innerHTML = "";
      this.items.forEach((it) => {
        const row = document.createElement("div");
        row.className = "batch-item";
        const url = URL.createObjectURL(it.file);
        row.innerHTML = `
          <img class="batch-thumb" alt="" />
          <span class="batch-name"></span>
          <button title="Use this image" data-use aria-label="Use">▸</button>
          <button title="Remove" data-del aria-label="Remove">✕</button>`;
        const img = row.querySelector("img");
        img.src = url;
        img.onload = () => Util.revoke(url);
        row.querySelector(".batch-name").textContent = it.file.name;
        row.querySelector("[data-use]").addEventListener("click", () => setSource(it.file));
        row.querySelector("[data-del]").addEventListener("click", () => this.remove(it.id));
        El.batchList.appendChild(row);
      });
    },
    async processAll(download) {
      if (this.items.length === 0) { Toast.info("Queue is empty."); return; }
      setBusy(true, "Batch processing…");
      try {
        for (let i = 0; i < this.items.length; i++) {
          const it = this.items[i];
          setProcessProgress(((i) / this.items.length) * 100, `Image ${i + 1}/${this.items.length}`);
          await setSource(it.file);
          await process("stretch");
          if (download && state.lastBlob) {
            triggerDownload(state.lastBlob, buildFilename());
            await new Promise((r) => setTimeout(r, 250));
          }
        }
        Toast.success(`Processed ${this.items.length} image(s).`);
      } catch (err) {
        Toast.error(err.message || "Batch failed.");
      } finally {
        setBusy(false);
      }
    },
  };

  /* ===============================================================
   * Download & clipboard
   * ============================================================= */
  function buildFilename() {
    const w = parseInt(El.widthInput.value, 10) || 300;
    const h = parseInt(El.heightInput.value, 10) || 300;
    const ext = FORMAT_EXT[El.formatSelect.value] || "png";
    return `image_${w}x${h}.${ext}`;
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => Util.revoke(url), 1000);
  }

  async function copyToClipboard() {
    if (!state.lastBlob) return;
    try {
      let blob = state.lastBlob;
      if (blob.type !== "image/png") {
        const bmp = await createImageBitmap(blob);
        const c = ImageEngine.render(bmp, bmp.width, bmp.height, "#ffffff");
        blob = await ImageEngine.toBlob(c, "image/png", 1);
      }
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      Toast.success("Image copied to clipboard.");
    } catch (err) {
      Toast.error("Clipboard copy not supported in this browser.");
    }
  }

  /* ===============================================================
   * Theme
   * ============================================================= */
  function initTheme() {
    const saved = localStorage.getItem("irbe-theme");
    document.documentElement.setAttribute("data-theme", saved || "light");
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("irbe-theme", next);
  }

  /* ===============================================================
   * Reset
   * ============================================================= */
  function resetAll() {
    disposeBitmaps();
    Util.revoke(state.lastUrl);
    Object.assign(state, {
      sourceBitmap: null, baseBitmap: null, workingBitmap: null,
      originalFile: null, originalSize: 0, originalW: 0, originalH: 0,
      lastBlob: null, lastUrl: null, busy: false,
    });
    El.fileInput.value = "";
    El.fileInfoCard.classList.add("hidden");
    El.actionCard.classList.add("hidden");
    El.previewArea.classList.add("hidden");
    El.emptyState.classList.remove("hidden");
    El.downloadBtn.disabled = true;
    El.copyBtn.disabled = true;
    El.processedImg.removeAttribute("src");
    El.originalImg.removeAttribute("src");
    Batch.items = [];
    Batch.render();
    El.batchCard.classList.add("hidden");
    Toast.info("Everything reset.");
  }

  /* ===============================================================
   * Event wiring
   * ============================================================= */
  function wire() {
    /* ---- Upload ---- */
    El.browseBtn.addEventListener("click", () => El.fileInput.click());
    El.dropZone.addEventListener("click", (e) => {
      if (e.target === El.browseBtn) return;
      El.fileInput.click();
    });
    El.dropZone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); El.fileInput.click(); }
    });
    El.fileInput.addEventListener("change", (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;
      if (files.length > 1) Batch.add(files);
      setSource(files[0]);
    });

    ["dragenter", "dragover"].forEach((ev) =>
      El.dropZone.addEventListener(ev, (e) => {
        e.preventDefault(); e.stopPropagation();
        El.dropZone.classList.add("dragover");
      }));
    ["dragleave", "drop"].forEach((ev) =>
      El.dropZone.addEventListener(ev, (e) => {
        e.preventDefault(); e.stopPropagation();
        if (ev === "dragleave" && El.dropZone.contains(e.relatedTarget)) return;
        El.dropZone.classList.remove("dragover");
      }));
    El.dropZone.addEventListener("drop", (e) => {
      const files = Array.from(e.dataTransfer.files || [])
        .filter((f) => !validateFile(f));
      if (files.length === 0) { Toast.error("No supported image files dropped."); return; }
      if (files.length > 1) Batch.add(files);
      setSource(files[0]);
    });

    /* ---- Resize actions ---- */
    El.cropBtn.addEventListener("click", () => CropController.open());
    El.stretchBtn.addEventListener("click", () => {
      clearDerivedBitmaps();
      state.baseBitmap = state.sourceBitmap;
      state.workingBitmap = state.sourceBitmap;
      
      // hide original preview
      El.originalCard.classList.add("hidden");
      
      process("stretch");
    });
    El.resetBtn.addEventListener("click", resetAll);

    /* ---- Settings ---- */
    El.qualitySlider.addEventListener("input", () => {
      El.qualityVal.textContent = El.qualitySlider.value + "%";
    });
    El.qualitySlider.addEventListener("change", () => { if (state.lastBlob) process("stretch"); });

    let ratioLocked = false;
    El.lockRatio.addEventListener("click", () => {
      ratioLocked = !ratioLocked;
      El.lockRatio.setAttribute("aria-pressed", String(ratioLocked));
    });
    El.widthInput.addEventListener("input", () => {
      if (ratioLocked && state.originalW) {
        const r = state.originalH / state.originalW;
        El.heightInput.value = Math.round((parseInt(El.widthInput.value, 10) || 0) * r);
      }
    });
    El.heightInput.addEventListener("input", () => {
      if (ratioLocked && state.originalH) {
        const r = state.originalW / state.originalH;
        El.widthInput.value = Math.round((parseInt(El.heightInput.value, 10) || 0) * r);
      }
    });
    [El.widthInput, El.heightInput, El.formatSelect].forEach((el) =>
      el.addEventListener("change", () => { if (state.lastBlob) process("stretch"); }));

    document.querySelectorAll(".chip").forEach((chip) =>
      chip.addEventListener("click", () => {
        El.targetSize.value = chip.dataset.target;
        document.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        if (state.lastBlob) process("stretch");
      }));
    El.targetSize.addEventListener("change", () => {
      document.querySelectorAll(".chip").forEach((c) =>
        c.classList.toggle("active", c.dataset.target === El.targetSize.value));
      if (state.lastBlob) process("stretch");
    });

    /* ---- Result actions ---- */
    El.downloadBtn.addEventListener("click", () => {
      if (state.lastBlob) triggerDownload(state.lastBlob, buildFilename());
    });
    El.copyBtn.addEventListener("click", copyToClipboard);

    /* ---- Batch ---- */
    El.batchProcessBtn.addEventListener("click", () => Batch.processAll(false));
    El.batchDownloadBtn.addEventListener("click", () => Batch.processAll(true));

    /* ---- Crop modal ---- */
    El.cropConfirm.addEventListener("click", () => CropController.confirm());
    El.zoomIn.addEventListener("click", () => CropController.cropper && CropController.cropper.zoom(0.1));
    El.zoomOut.addEventListener("click", () => CropController.cropper && CropController.cropper.zoom(-0.1));
    El.rotateLeft.addEventListener("click", () => CropController.cropper && CropController.cropper.rotate(-90));
    El.rotateRight.addEventListener("click", () => CropController.cropper && CropController.cropper.rotate(90));
    El.cropReset.addEventListener("click", () => CropController.cropper && CropController.cropper.reset());

    document.querySelectorAll("[data-close]").forEach((el) =>
      el.addEventListener("click", () => {
        if (!El.cropModal.classList.contains("hidden")) CropController.close();
      }));

    /* ---- Theme ---- */
    El.themeToggle.addEventListener("click", toggleTheme);

    /* ---- Keyboard shortcut (Escape only for crop modal) ---- */
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !El.cropModal.classList.contains("hidden")) {
        CropController.close();
      }
    });

    window.addEventListener("beforeunload", () => {
      Util.revoke(state.lastUrl);
      CropController.destroy();
    });
  }

  function init() {
    initTheme();
    wire();
    if (typeof createImageBitmap !== "function") {
      Toast.error("Your browser lacks createImageBitmap support. Please update it.");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();