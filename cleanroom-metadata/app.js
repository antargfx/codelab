import { FFmpeg } from "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js";
import { toBlobURL } from "https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js";

/*
 * Cleanroom: browser-only metadata cleaning.
 * Image strategy: decode/re-encode using Canvas. This usually discards metadata,
 * but may alter quality/features and is not a forensic guarantee.
 * Video strategy: FFmpeg.wasm transcode with metadata mapping disabled.
 * This does not guarantee removal of all C2PA/provenance structures.
 */

const $ = (id) => document.getElementById(id);
const fileInput = $("fileInput");
const dropzone = $("dropzone");
const fileList = $("fileList");
const selectedCount = $("selectedCount");
const cleanBtn = $("cleanBtn");
const clearBtn = $("clearBtn");
const progressWrap = $("progressWrap");
const progressText = $("progressText");
const progressPercent = $("progressPercent");
const progressBar = $("progressBar");
const reportSection = $("reportSection");
const reportList = $("reportList");
const downloadZipBtn = $("downloadZipBtn");
const toast = $("toast");

const SUPPORTED_IMAGES = new Set(["jpg", "jpeg", "png", "webp"]);
const SUPPORTED_VIDEOS = new Set(["mp4", "mov", "mkv"]);
const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1 GiB soft guard; browser memory may impose a lower limit.
let items = [];
let results = [];
let ffmpeg = null;
let ffmpegLoading = null;
let isProcessing = false;
let toastTimer;

function extension(name) {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}
function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "Unknown size";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = bytes / 1024, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)} ${units[i]}`;
}
function safeName(name) {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim() || "cleaned-file";
}
function uniqueName(name, used) {
  const clean = safeName(name);
  if (!used.has(clean.toLowerCase())) { used.add(clean.toLowerCase()); return clean; }
  const dot = clean.lastIndexOf(".");
  const stem = dot > 0 ? clean.slice(0, dot) : clean;
  const ext = dot > 0 ? clean.slice(dot) : "";
  let n = 2, candidate;
  do { candidate = `${stem}_${n++}${ext}`; } while (used.has(candidate.toLowerCase()));
  used.add(candidate.toLowerCase());
  return candidate;
}
function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}
function setProgress(percent, message) {
  progressWrap.hidden = false;
  progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  progressPercent.textContent = `${Math.round(percent)}%`;
  progressText.textContent = message;
}
function addFiles(fileListLike) {
  const incoming = Array.from(fileListLike || []);
  let added = 0;
  for (const file of incoming) {
    const ext = extension(file.name);
    if (!SUPPORTED_IMAGES.has(ext) && !SUPPORTED_VIDEOS.has(ext)) {
      showToast(`Skipped unsupported file: ${file.name}`);
      continue;
    }
    if (items.some(x => x.file === file || (x.file.name === file.name && x.file.size === file.size && x.file.lastModified === file.lastModified))) continue;
    items.push({ id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`, file, status: "Ready", output: null, report: null });
    added++;
  }
  renderFiles();
  if (added) showToast(`${added} file${added === 1 ? "" : "s"} added`);
}
function renderFiles() {
  selectedCount.textContent = `${items.length} file${items.length === 1 ? "" : "s"} selected`;
  cleanBtn.disabled = isProcessing || !items.some(x => x.status === "Ready" || x.status === "Error");
  clearBtn.disabled = isProcessing || items.length === 0;
  fileInput.disabled = isProcessing;
  if (!items.length) {
    fileList.innerHTML = '<div class="empty-state"><span>▧</span><p>Your selected files will appear here.</p></div>';
    return;
  }
  fileList.innerHTML = "";
  for (const item of items) {
    const ext = extension(item.file.name);
    const row = document.createElement("div");
    row.className = "file-row";
    const icon = document.createElement("div");
    icon.className = "file-icon"; icon.textContent = ext;
    const info = document.createElement("div"); info.className = "file-info";
    const name = document.createElement("div"); name.className = "file-name"; name.textContent = item.file.name; name.title = item.file.name;
    const meta = document.createElement("div"); meta.className = "file-meta"; meta.textContent = `${formatBytes(item.file.size)} · ${SUPPORTED_IMAGES.has(ext) ? "IMAGE" : "VIDEO"}`;
    info.append(name, meta);
    const status = document.createElement("span");
    status.className = `status ${item.status === "Cleaned" ? "done" : item.status === "Error" ? "error" : ""}`;
    status.textContent = item.status;
    const remove = document.createElement("button");
    remove.className = "remove-file"; remove.type = "button"; remove.textContent = "×"; remove.title = `Remove ${item.file.name}`; remove.setAttribute("aria-label", remove.title);
    remove.disabled = isProcessing;
    remove.addEventListener("click", () => { items = items.filter(x => x.id !== item.id); renderFiles(); });
    row.append(icon, info, status, remove);
    fileList.append(row);
  }
}
function renderReports() {
  const ready = results.filter(r => r.blob);
  reportSection.hidden = results.length === 0;
  downloadZipBtn.disabled = ready.length === 0;
  reportList.innerHTML = "";
  for (const result of results) {
    const card = document.createElement("article"); card.className = "report-card";
    const top = document.createElement("div"); top.className = "report-top";
    const left = document.createElement("div");
    const h = document.createElement("h3"); h.textContent = result.name;
    const size = document.createElement("div"); size.className = "report-size";
    size.textContent = result.blob ? `${formatBytes(result.originalSize)} → ${formatBytes(result.blob.size)}` : `${formatBytes(result.originalSize)} · no output`;
    left.append(h, size);
    const badge = document.createElement("span"); badge.className = `status ${result.blob ? "done" : "error"}`; badge.textContent = result.blob ? "OUTPUT READY" : "FAILED";
    top.append(left, badge);
    const grid = document.createElement("div"); grid.className = "report-grid";
    const cells = [
      ["Input", result.inputType || "Unknown"],
      ["Output", result.blob ? `${result.outputType} · ${formatBytes(result.blob.size)}` : "Not created"],
      ["Processing", result.blob ? "Rebuilt / transcoded" : "Failed"],
      ["Metadata verification", "Not independently verified"]
    ];
    for (const [label, value] of cells) {
      const cell = document.createElement("div"); cell.className = "report-cell";
      const l = document.createElement("span"); l.textContent = label;
      const v = document.createElement("strong"); v.textContent = value;
      cell.append(l, v); grid.append(cell);
    }
    const note = document.createElement("p"); note.className = "report-note"; note.textContent = result.note;
    card.append(top, grid, note);
    if (result.blob) {
      const a = document.createElement("a"); a.className = "button button-quiet"; a.style.display = "inline-block"; a.style.marginTop = "12px"; a.style.textDecoration = "none";
      const url = URL.createObjectURL(result.blob); a.href = url; a.download = result.outputName; a.textContent = "Download cleaned file ↓";
      card.append(a);
    }
    reportList.append(card);
  }
}
function getMime(ext) {
  return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", mp4: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska" })[ext] || "application/octet-stream";
}
function canvasBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error(`Browser could not encode ${mime}`)), mime, quality));
}
async function cleanImage(file, ext) {
  const url = URL.createObjectURL(file);
  try {
    let image;
    if ("createImageBitmap" in window) {
      image = await createImageBitmap(file, { imageOrientation: "from-image" });
    } else {
      image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Image could not be decoded by this browser"));
        img.src = url;
      });
    }
    const width = image.width || image.naturalWidth;
    const height = image.height || image.naturalHeight;
    if (!width || !height) throw new Error("Image dimensions could not be read");
    // Canvas has browser/device limits. Avoid crashing on huge images.
    if (width * height > 100_000_000) throw new Error("Image is too large for safe canvas processing in this browser (over 100 megapixels)");
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: ext !== "jpg" && ext !== "jpeg" });
    if (!ctx) throw new Error("Canvas is unavailable");
    if (ext === "jpg" || ext === "jpeg") { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height); }
    ctx.drawImage(image, 0, 0, width, height);
    if (image.close) image.close();
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "png" ? "image/png" : "image/webp";
    // JPEG quality is intentionally high but still lossy. PNG remains lossless for raster pixels.
    const blob = await canvasBlob(canvas, mime, mime === "image/jpeg" ? 0.96 : mime === "image/webp" ? 0.96 : undefined);
    canvas.width = 0; canvas.height = 0;
    return { blob, ext: ext === "jpeg" ? "jpg" : ext, note: "Image decoded and re-encoded through browser canvas. This usually discards embedded EXIF/IPTC/XMP and many embedded payloads, but the file was not forensically inspected. Color profiles, animation, metadata orientation, and other image features may change." };
  } finally { URL.revokeObjectURL(url); }
}
async function ensureFFmpeg() {
  if (ffmpeg && ffmpeg.loaded) return ffmpeg;
  if (ffmpegLoading) return ffmpegLoading;
  ffmpegLoading = (async () => {
    const instance = new FFmpeg();
    instance.on("log", ({ message }) => {
      // Keep console noise low; errors are handled by the command result.
      if (message && /error|failed|invalid/i.test(message)) console.warn("[FFmpeg.wasm]", message);
    });
    instance.on("progress", ({ progress }) => {
      if (Number.isFinite(progress)) {
        const percent = 8 + Math.max(0, Math.min(1, progress)) * 84;
        setProgress(percent, "Re-encoding video in this browser…");
      }
    });
    const base = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd";
    const coreURL = await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript");
    const wasmURL = await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm");
    await instance.load({ coreURL, wasmURL });
    ffmpeg = instance;
    return instance;
  })();
  try { return await ffmpegLoading; }
  finally { ffmpegLoading = null; }
}
async function cleanVideo(file, ext, id) {
  if (file.size > MAX_FILE_SIZE) throw new Error("File exceeds the 1 GiB soft limit. Try a smaller file or a desktop tool.");
  const engine = await ensureFFmpeg();
  const inputName = `input_${id.replace(/[^a-zA-Z0-9_-]/g, "").slice(-32)}.${ext}`;
  const outputExt = ext;
  const outputName = `cleaned_${id.replace(/[^a-zA-Z0-9_-]/g, "").slice(-32)}.${outputExt}`;
  try {
    await engine.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));
    // Strict mode transcodes video and audio to common codecs; metadata mapping is disabled.
    // MP4/MOV: H.264 + AAC; MKV: H.264 + AAC in Matroska. This may not preserve all streams.
    const args = ["-y", "-i", inputName, "-map", "0:v:0?", "-map", "0:a:0?", "-map_metadata", "-1", "-map_chapters", "-1", "-dn", "-sn", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-metadata", "title=", "-metadata", "comment=", "-metadata", "artist=", "-metadata", "encoder="];
    if (ext === "mp4" || ext === "mov") args.push("-movflags", "+faststart");
    args.push(outputName);
    const exitCode = await engine.exec(args);
    if (exitCode !== 0) throw new Error(`FFmpeg returned exit code ${exitCode}. The codec or container may not be supported.`);
    const data = await engine.readFile(outputName);
    const blob = new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)], { type: getMime(ext) });
    if (!blob.size) throw new Error("FFmpeg produced an empty output file");
    return {
      blob, ext,
      note: "Video/audio streams were transcoded with ordinary metadata mapping and chapters disabled. This is not a C2PA forensic scrub; container-level or external provenance may remain. Some tracks, subtitles, attachments, HDR, rotation, timecode, or other stream properties may not be preserved."
    };
  } finally {
    try { await engine.deleteFile(inputName); } catch {}
    try { await engine.deleteFile(outputName); } catch {}
  }
}
async function processItem(item) {
  const file = item.file;
  const ext = extension(file.name);
  const inputType = `${ext.toUpperCase()} · ${SUPPORTED_IMAGES.has(ext) ? "image" : "video"}`;
  try {
    item.status = "Processing";
    renderFiles();
    let cleaned;
    if (SUPPORTED_IMAGES.has(ext)) cleaned = await cleanImage(file, ext);
    else if (SUPPORTED_VIDEOS.has(ext)) cleaned = await cleanVideo(file, ext, item.id);
    else throw new Error("Unsupported format");
    const outputName = safeName(file.name.replace(/\.(jpg|jpeg|png|webp|mp4|mov|mkv)$/i, "") + `_cleaned.${cleaned.ext}`);
    const result = { name: file.name, originalSize: file.size, inputType, outputType: `${cleaned.ext.toUpperCase()} · ${SUPPORTED_IMAGES.has(ext) ? "image" : "video"}`, blob: cleaned.blob, outputName, note: cleaned.note };
    item.status = "Cleaned"; item.output = cleaned.blob; item.report = result;
    return result;
  } catch (error) {
    item.status = "Error";
    return { name: file.name, originalSize: file.size, inputType, outputType: "—", blob: null, outputName: null, note: `Processing failed: ${error?.message || String(error)}. The original file has not been modified.` };
  } finally { renderFiles(); }
}
async function cleanAll() {
  if (isProcessing) return;
  const queue = items.filter(x => x.status === "Ready" || x.status === "Error");
  if (!queue.length) return;
  isProcessing = true; cleanBtn.disabled = true; clearBtn.disabled = true; fileInput.disabled = true;
  results = [];
  reportSection.hidden = false; reportList.innerHTML = "";
  setProgress(0, "Starting local processing…");
  try {
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      setProgress((i / queue.length) * 100, `Processing ${i + 1} of ${queue.length}: ${item.file.name}`);
      const result = await processItem(item);
      results.push(result);
      renderReports();
      setProgress(((i + 1) / queue.length) * 100, `Finished ${i + 1} of ${queue.length}`);
    }
    const successes = results.filter(r => r.blob).length;
    setProgress(100, `Finished · ${successes}/${results.length} files created`);
    showToast(`Finished: ${successes} of ${results.length} cleaned copies created`);
  } finally {
    isProcessing = false; renderFiles(); clearBtn.disabled = items.length === 0; fileInput.disabled = false;
  }
}
async function downloadZip() {
  const good = results.filter(r => r.blob);
  if (!good.length) return;
  if (!window.JSZip) { showToast("ZIP library did not load. Check your internet connection and retry."); return; }
  downloadZipBtn.disabled = true;
  try {
    const zip = new JSZip();
    const used = new Set();
    for (const r of good) zip.file(uniqueName(r.outputName, used), r.blob);
    const report = {
      generatedAt: new Date().toISOString(),
      localProcessing: true,
      metadataVerification: "Not independently verified",
      disclaimer: "This report records processing attempts, not a guarantee that all metadata, C2PA Content Credentials, watermarks, or external provenance signals have been removed.",
      files: good.map(r => ({ inputName: r.name, inputBytes: r.originalSize, outputName: r.outputName, outputBytes: r.blob.size, note: r.note }))
    };
    zip.file("cleaning-report.json", JSON.stringify(report, null, 2));
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 4 } });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `cleanroom-results-${new Date().toISOString().slice(0,10)}.zip`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
  } catch (error) { showToast(`ZIP creation failed: ${error?.message || error}`); }
  finally { downloadZipBtn.disabled = false; }
}

fileInput.addEventListener("change", e => { addFiles(e.target.files); fileInput.value = ""; });
dropzone.addEventListener("dragover", e => { e.preventDefault(); dropzone.classList.add("dragover"); });
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
dropzone.addEventListener("drop", e => { e.preventDefault(); dropzone.classList.remove("dragover"); addFiles(e.dataTransfer.files); });
dropzone.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
cleanBtn.addEventListener("click", cleanAll);
clearBtn.addEventListener("click", () => { items = []; results = []; reportSection.hidden = true; renderFiles(); });
downloadZipBtn.addEventListener("click", downloadZip);

renderFiles();
