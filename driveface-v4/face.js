/**
 * face.js — Face Detection & Recognition
 *
 * Uses face-api.js (TensorFlow.js), loaded from CDN.
 *
 * Models loaded:
 *   • SSD MobileNetV1    — detect face bounding boxes
 *   • FaceLandmark68Net  — 68-point landmark detection
 *   • FaceRecognitionNet — 128-dimensional face embedding
 *
 * Similarity score:
 *   We convert Euclidean distance → 0–100% similarity.
 *   distance ≈ 0.0 → identical  (100%)
 *   distance ≈ 0.6 → same-person boundary  (40%)
 *   distance > 1.0 → different people  (0%)
 *
 * Caching:
 *   Descriptors for each Drive file ID are stored in IndexedDB.
 *   On repeat scans of the same folder, already-processed images
 *   are retrieved from cache — making rescans near-instant.
 */

'use strict';

const FaceRecognition = (() => {

  // Pre-trained model weights hosted on jsDelivr CDN
  const CDN_PRIMARY = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';
  const CDN_FALLBACK = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights';

  let modelsLoaded = false;

  // Input image dimensions per quality setting
  // Larger = more accurate face detection, but slower
  const INPUT_DIM = { fast: 224, balanced: 320, accurate: 416 };

  // Minimum detection confidence per quality setting
  const MIN_CONF  = { fast: 0.3, balanced: 0.5, accurate: 0.5 };

  /* ── internal helpers ─────────────────────────────────── */

  function quality() { return Storage.get('dff_quality', DRIVEFACE_CONFIG.defaultQuality || 'balanced'); }
  function threshold() { return parseFloat(Storage.get('dff_threshold', String(DRIVEFACE_CONFIG.defaultThreshold || 0.55))); }

  function detectionOpts() {
    const q = quality();
    return new faceapi.SsdMobilenetv1Options({ minConfidence: MIN_CONF[q] || 0.5 });
  }

  /** Euclidean distance → similarity % (0–100, higher = more similar) */
  function distToScore(dist) {
    return Math.round(Utils.clamp((1 - dist) * 100, 0, 100) * 10) / 10;
  }

  /* ── public API ───────────────────────────────────────── */

  /**
   * Load all three face-api.js model networks.
   * Tries primary CDN first; falls back to GitHub raw on failure.
   *
   * @param {Function} onProgress  (pct:number, label:string) => void
   */
  async function loadModels(onProgress) {
    if (modelsLoaded) return;

    const nets = [
      { net: faceapi.nets.ssdMobilenetv1,     label: 'Face Detection' },
      { net: faceapi.nets.faceLandmark68Net,  label: 'Landmark Detection' },
      { net: faceapi.nets.faceRecognitionNet, label: 'Face Recognition' },
    ];

    for (const cdn of [CDN_PRIMARY, CDN_FALLBACK]) {
      try {
        for (let i = 0; i < nets.length; i++) {
          const { net, label } = nets[i];
          if (onProgress) onProgress(Math.round((i / nets.length) * 88), `Loading ${label} model…`);
          await net.loadFromUri(cdn);
        }
        modelsLoaded = true;
        if (onProgress) onProgress(100, 'Models ready!');
        return;
      } catch (err) {
        if (cdn === CDN_FALLBACK) throw new Error('Failed to load AI models from both CDNs. Check your internet connection.');
        console.warn('Primary model CDN failed, trying fallback…');
      }
    }
  }

  /**
   * Extract a 128-dimensional face descriptor from a canvas / image element.
   * Returns null when no face is detected (non-fatal).
   *
   * @param {HTMLCanvasElement|HTMLImageElement} input
   * @returns {Promise<Float32Array|null>}
   */
async function getDescriptor(input) {
  if (!modelsLoaded) {
    throw new Error('Face models not loaded yet.');
  }

  try {

    const detections = await faceapi
      .detectAllFaces(input, detectionOpts())
      .withFaceLandmarks()
      .withFaceDescriptors();

    if (!detections || detections.length === 0) {
      return null;
    }

    // Ignore tiny / blurry background faces
    const validFaces = detections.filter(d => {
      const box = d.detection.box;
      return box.width >= 50 && box.height >= 50;
    });

    if (!validFaces.length) {
      return null;
    }

    // Choose the largest face
    const best = validFaces.sort((a, b) => {
      const areaA = a.detection.box.width * a.detection.box.height;
      const areaB = b.detection.box.width * b.detection.box.height;
      return areaB - areaA;
    })[0];

    return best.descriptor;

  } catch (err) {
    console.warn('Detection error (non-fatal):', err.message);
    return null;
  }
}

  /**
   * Detect a face in a Blob downloaded from Google Drive.
   * Blob → Image element → resized canvas → descriptor
   *
   * @param {Blob} blob
   * @returns {Promise<Float32Array|null>}
   */
  async function getDescriptorFromBlob(blob) {
    const maxDim = INPUT_DIM[quality()] || 320;
    let img = null;
    try {
      img = await ImageUtils.blobToImage(blob);
      const canvas = ImageUtils.resizeToCanvas(img, maxDim);
      return await getDescriptor(canvas);
    } finally {
      if (img) ImageUtils.revokeImage(img);
    }
  }

  /**
   * Similarity score between two descriptors (0–100%).
   */
  function compare(d1, d2) {
    return distToScore(faceapi.euclideanDistance(d1, d2));
  }

  /**
   * True when similarity clears the user-configured threshold.
   * Threshold is stored as a Euclidean distance (0.30–0.85).
   * We convert: threshold 0.55 → cutoff score 45%.
   */
  function isMatch(similarity) {
    const cutoff = (1 - threshold()) * 100;
    return similarity >= cutoff;
  }

  /**
   * Process all files in a Drive folder against the reference descriptor.
   *
   * Workflow per file:
   *   1. Check IndexedDB cache for existing descriptor
   *   2. If cached → restore Float32Array, skip download
   *   3. If not cached → download blob, detect face, cache result
   *   4. Compare against reference descriptor
   *   5. Collect matches above threshold
   *
   * @param {Array}        files         – Drive file objects from DriveAPI
   * @param {Float32Array} refDescriptor – user's 128-dim face vector
   * @param {Object}       opts
   * @param {Function}     opts.onProgress  – (pct, done, total, matchCount) => void
   * @param {{ cancelled: boolean }} opts.cancelToken
   * @returns {Promise<Array>}  matched files sorted by similarity desc
   */
  async function processBatch(files, refDescriptor, { onProgress, cancelToken }) {
    const matches  = [];
    const PARALLEL = 3; // concurrent image downloads
    let   done     = 0;

    for (let i = 0; i < files.length; i += PARALLEL) {
      if (cancelToken.cancelled) break;

      const slice = files.slice(i, i + PARALLEL);

      const settled = await Promise.allSettled(
        slice.map(async (file) => {
          if (cancelToken.cancelled) return null;

          /* 1. Cache lookup */
          let descriptor = null;
          const cached   = await FaceCache.get(file.id);

          if (cached !== null) {
            // null descriptor  → "no face" sentinel (stored as empty array)
            // array descriptor → valid face data
            descriptor = cached.descriptor?.length
              ? new Float32Array(cached.descriptor)
              : null;
          } else {
            /* 2. Download from Drive + detect */
            try {
              const blob = await DriveAPI.fetchImageBlob(file.id);
              descriptor = await getDescriptorFromBlob(blob);
              // Cache result (empty array = no-face sentinel)
              await FaceCache.set(file.id, descriptor || new Float32Array(0), file.name);
            } catch (err) {
              console.warn(`Skipping ${file.name}:`, err.message);
            }
          }

          if (!descriptor || descriptor.length === 0) return null;

          /* 3. Compare */
          const similarity = compare(refDescriptor, descriptor);
          return isMatch(similarity) ? { ...file, similarity } : null;
        })
      );

      settled.forEach(r => {
        if (r.status === 'fulfilled' && r.value) matches.push(r.value);
      });

      done += slice.length;
      if (onProgress) onProgress(
        Math.round((done / files.length) * 100),
        done,
        files.length,
        matches.length
      );
    }

    // Best matches first
    return matches.sort((a, b) => b.similarity - a.similarity);
  }

  return {
    loadModels,
    getDescriptor,
    getDescriptorFromBlob,
    compare,
    isMatch,
    processBatch,
    get loaded() { return modelsLoaded; },
  };
})();
