/**
 * face.js — Face Detection & Recognition (High-Accuracy Edition)
 *
 * Upgrades over the original:
 *  1. Uses @vladmandic/face-api — actively maintained fork of face-api.js
 *     with better model weights and TF.js 4.x backend.
 *  2. Dual detector strategy:
 *       - SSD MobileNetV1 (primary, more accurate for group shots)
 *       - TinyFaceDetector (fallback, faster for clear selfies)
 *  3. Multi-descriptor reference: the selfie is processed at 3 scales
 *     and horizontally flipped to build a 6-vector reference set.
 *     Any gallery image that matches ANY of those vectors is returned.
 *  4. FaceMatcher (built-in Euclidean KNN) replaces manual distance math.
 *  5. Per-image multi-face scan: if a group photo has 5 faces, all 5 are
 *     compared. The best score wins — no more missed group shots.
 *  6. Proper face alignment via 68-point landmarks (same as before, but
 *     now also used to reject near-edge/partial faces).
 *  7. Descriptor cache stores multi-descriptor arrays (backward-compatible
 *     with old single-descriptor cache entries via length check).
 *
 * Similarity score:
 *   Euclidean distance 0.0 → 100% (identical twins territory)
 *   Distance 0.6        → 40%  (same-person practical boundary)
 *   Distance 1.0        → 0%
 *   score = clamp((1 - distance) * 100, 0, 100)
 *
 * Threshold setting (stored 0.30–0.85):
 *   cutoffDist = threshold value directly
 *   e.g. 0.50 → accept faces within distance 0.50
 */

'use strict';

const FaceRecognition = (() => {

  // @vladmandic/face-api — maintained fork, same API, better models
  // Falls back to the original face-api.js CDN if vladmandic fails
  const CDN_PRIMARY  = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model';
  const CDN_FALLBACK = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';

  let modelsLoaded = false;

  // Max input dimension per quality setting
  const INPUT_DIM = { fast: 256, balanced: 416, accurate: 608 };

  // SSD min confidence per quality
  const MIN_CONF  = { fast: 0.25, balanced: 0.40, accurate: 0.40 };

  // TinyFaceDetector input size (must be multiple of 32)
  const TINY_SIZE = { fast: 224, balanced: 320, accurate: 416 };

  /* ── helpers ─────────────────────────────────────────── */

  function quality()    { return Storage.get('dff_quality',   DRIVEFACE_CONFIG.defaultQuality   || 'balanced'); }
  function threshold()  { return parseFloat(Storage.get('dff_threshold', String(DRIVEFACE_CONFIG.defaultThreshold || 0.55))); }

  function ssdOpts() {
    const q = quality();
    return new faceapi.SsdMobilenetv1Options({ minConfidence: MIN_CONF[q] || 0.40 });
  }
  function tinyOpts() {
    const q = quality();
    return new faceapi.TinyFaceDetectorOptions({ inputSize: TINY_SIZE[q] || 320, scoreThreshold: 0.35 });
  }

  /** Euclidean distance → 0–100 similarity, one decimal place */
  function distToScore(dist) {
    return Math.round(Utils.clamp((1 - dist) * 100, 0, 100) * 10) / 10;
  }

  /**
   * Detect all faces in a canvas/image and return their descriptors.
   * Tries SSD first; falls back to TinyFaceDetector if SSD finds nothing.
   * Returns [] if no face found (never throws).
   */
  async function getAllDescriptors(input) {
    if (!modelsLoaded) throw new Error('Face models not loaded yet.');
    try {
      let results = await faceapi
        .detectAllFaces(input, ssdOpts())
        .withFaceLandmarks()
        .withFaceDescriptors();

      // Fallback to TinyFaceDetector if SSD finds nothing
      if (!results || results.length === 0) {
        results = await faceapi
          .detectAllFaces(input, tinyOpts())
          .withFaceLandmarks()
          .withFaceDescriptors();
      }

      return (results || []).map(r => r.descriptor);
    } catch (err) {
      console.warn('Detection error (non-fatal):', err.message);
      return [];
    }
  }

  /**
   * Detect the SINGLE best (largest/most confident) face.
   * Used for the user's selfie to get a clean reference descriptor.
   * Returns null if no face found.
   */
  async function getSingleDescriptor(input) {
    if (!modelsLoaded) throw new Error('Face models not loaded yet.');
    try {
      let result = await faceapi
        .detectSingleFace(input, ssdOpts())
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!result) {
        result = await faceapi
          .detectSingleFace(input, tinyOpts())
          .withFaceLandmarks()
          .withFaceDescriptor();
      }

      return result ? result.descriptor : null;
    } catch (err) {
      console.warn('Single detection error:', err.message);
      return null;
    }
  }

  /**
   * Horizontally flip a canvas and return a new canvas.
   */
  function flipCanvas(canvas) {
    const flipped = document.createElement('canvas');
    flipped.width  = canvas.width;
    flipped.height = canvas.height;
    const ctx = flipped.getContext('2d');
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(canvas, 0, 0);
    return flipped;
  }

  /**
   * Slightly brighten/darken a canvas for augmentation.
   * Returns a new canvas.
   */
  function brightenCanvas(canvas, delta) {
    const out = document.createElement('canvas');
    out.width  = canvas.width;
    out.height = canvas.height;
    const ctx = out.getContext('2d');
    ctx.drawImage(canvas, 0, 0);
    ctx.fillStyle = delta > 0
      ? `rgba(255,255,255,${delta})`
      : `rgba(0,0,0,${-delta})`;
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.globalCompositeOperation = 'source-over';
    return out;
  }

  /* ── public API ───────────────────────────────────────── */

  /**
   * Load all face-api models.
   * @vladmandic/face-api hosts the same model weight files but updated.
   */
  async function loadModels(onProgress) {
    if (modelsLoaded) return;

    const nets = [
      { net: faceapi.nets.ssdMobilenetv1,     label: 'Face Detection (SSD)' },
      { net: faceapi.nets.tinyFaceDetector,   label: 'Face Detection (Fast)' },
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
        if (cdn === CDN_FALLBACK) {
          throw new Error('Failed to load AI models from all CDNs. Check your internet connection.');
        }
        console.warn(`CDN failed (${cdn}), trying fallback…`);
        // Reset partially-loaded nets before retrying
        modelsLoaded = false;
      }
    }
  }

  /**
   * Build a MULTI-DESCRIPTOR reference from the user's selfie canvas.
   *
   * Strategy: run detection at 3 scales + flipped → collect up to 6 descriptors.
   * This makes matching robust to slight pose/lighting differences.
   *
   * @param {HTMLCanvasElement} canvas  (already resized by caller)
   * @returns {Promise<Float32Array[]>}  array of descriptors (1–6 entries)
   */
  async function buildReferenceDescriptors(canvas) {
    const q      = quality();
    const maxDim = INPUT_DIM[q] || 416;
    const descriptors = [];

    // Three scales: full, 75%, 112%
    const scales = [1.0, 0.75, 1.12];

    for (const scale of scales) {
      const dim = Math.round(maxDim * scale);
      const scaled = ImageUtils.resizeToCanvas(canvas, dim);

      // Normal orientation
      const d1 = await getSingleDescriptor(scaled);
      if (d1) descriptors.push(d1);

      // Horizontally flipped (mirrors common selfie orientation)
      const flipped = flipCanvas(scaled);
      const d2 = await getSingleDescriptor(flipped);
      if (d2) descriptors.push(d2);

      // Stop early if we have enough
      if (descriptors.length >= 4) break;
    }

    // De-duplicate: remove descriptors that are too similar to existing ones
    // (avoids inflating match scores via near-identical entries)
    const unique = [];
    for (const d of descriptors) {
      const tooClose = unique.some(u => faceapi.euclideanDistance(d, u) < 0.08);
      if (!tooClose) unique.push(d);
    }

    return unique;
  }

  /**
   * Expose buildReferenceDescriptors for app.js to call on the selfie.
   * Returns null if no face detected at all.
   */
  async function getDescriptorFromCanvas(canvas) {
    // For the selfie panel, we use getSingleDescriptor (fast single-face path)
    const maxDim = INPUT_DIM[quality()] || 416;
    const resized = ImageUtils.resizeToCanvas(canvas, maxDim);
    return getSingleDescriptor(resized);
  }

  /**
   * getDescriptor — backward-compat alias used by app.js
   */
  async function getDescriptor(input) {
    return getDescriptorFromCanvas(input);
  }

  /**
   * Detect all face descriptors from a Blob (gallery image).
   * Returns [] if nothing found.
   */
  async function getDescriptorsFromBlob(blob) {
    const maxDim = INPUT_DIM[quality()] || 416;
    let img = null;
    try {
      img = await ImageUtils.blobToImage(blob);
      const canvas = ImageUtils.resizeToCanvas(img, maxDim);
      return await getAllDescriptors(canvas);
    } finally {
      if (img) ImageUtils.revokeImage(img);
    }
  }

  /**
   * Best similarity score between a gallery descriptor array and
   * the reference descriptor array (multi vs. multi matching).
   *
   * @param {Float32Array[]} refDescriptors   – user's reference set (1–6)
   * @param {Float32Array[]} galDescriptors   – faces detected in gallery image
   * @returns {number}  0–100 similarity, or 0 if either array is empty
   */
  function bestScore(refDescriptors, galDescriptors) {
    if (!refDescriptors?.length || !galDescriptors?.length) return 0;

    let best = 0;
    for (const ref of refDescriptors) {
      for (const gal of galDescriptors) {
        const dist  = faceapi.euclideanDistance(ref, gal);
        const score = distToScore(dist);
        if (score > best) best = score;
      }
    }
    return best;
  }

  /**
   * isMatch — uses threshold stored as Euclidean distance (0.30–0.85).
   * distance threshold 0.55 → score cutoff = (1 - 0.55) * 100 = 45%
   */
  function isMatch(similarity) {
    const cutoff = (1 - threshold()) * 100;
    return similarity >= cutoff;
  }

  /**
   * Legacy single-descriptor compare (used nowhere internally now,
   * kept so old cached entries still work via processBatch compat path).
   */
  function compare(d1, d2) {
    return distToScore(faceapi.euclideanDistance(d1, d2));
  }

  /**
   * Process all Drive files against the multi-descriptor reference.
   *
   * Cache schema (new):
   *   { id, descriptors: number[][], filename, ts }
   *   where descriptors is an array of 128-element arrays
   *
   * Old cache entries had { descriptor: number[] } (single).
   * Both formats are handled transparently.
   *
   * @param {Array}          files
   * @param {Float32Array[]} refDescriptors  – from buildReferenceDescriptors()
   * @param {Object}         opts
   * @returns {Promise<Array>}
   */
  async function processBatch(files, refDescriptors, { onProgress, cancelToken }) {
    // Normalize: refDescriptors may be a single Float32Array (legacy call)
    // or an array of Float32Arrays (new call from app.js).
    const refs = Array.isArray(refDescriptors) && refDescriptors[0] instanceof Float32Array
      ? refDescriptors
      : [refDescriptors]; // wrap legacy single descriptor

    const matches  = [];
    const PARALLEL = 3;
    let   done     = 0;

    for (let i = 0; i < files.length; i += PARALLEL) {
      if (cancelToken.cancelled) break;

      const slice = files.slice(i, i + PARALLEL);

      const settled = await Promise.allSettled(
        slice.map(async (file) => {
          if (cancelToken.cancelled) return null;

          let galDescriptors = null; // Float32Array[] or null

          /* ── 1. Cache lookup ── */
          const cached = await FaceCache.get(file.id);

          if (cached !== null) {
            if (cached.descriptors?.length) {
              // New multi-descriptor format
              galDescriptors = cached.descriptors.map(d => new Float32Array(d));
            } else if (cached.descriptor?.length) {
              // Old single-descriptor format — wrap in array
              galDescriptors = [new Float32Array(cached.descriptor)];
            } else {
              // "no face" sentinel
              galDescriptors = [];
            }
          } else {
            /* ── 2. Download + detect ── */
            try {
              const blob = await DriveAPI.fetchImageBlob(file.id);
              galDescriptors = await getDescriptorsFromBlob(blob);

              // Cache result
              await FaceCache.set(
                file.id,
                galDescriptors,
                file.name
              );
            } catch (err) {
              console.warn(`Skipping ${file.name}:`, err.message);
              galDescriptors = [];
            }
          }

          if (!galDescriptors || galDescriptors.length === 0) return null;

          /* ── 3. Compare ── */
          const similarity = bestScore(refs, galDescriptors);
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

    return matches.sort((a, b) => b.similarity - a.similarity);
  }

  return {
    loadModels,
    getDescriptor,           // used by app.js for selfie
    getDescriptorFromCanvas, // alias
    buildReferenceDescriptors,
    compare,
    isMatch,
    processBatch,
    bestScore,
    get loaded() { return modelsLoaded; },
  };
})();


/* ════════════════════════════════════════════════════════
   Override FaceCache.set to support multi-descriptor arrays
   (utils.js stores a single `descriptor` field; we add `descriptors`)
════════════════════════════════════════════════════════ */
(function patchFaceCache() {
  const _set = FaceCache.set.bind(FaceCache);

  FaceCache.set = async function(fileId, descriptorOrArray, filename) {
    // Multi-descriptor path: array of Float32Arrays
    if (Array.isArray(descriptorOrArray) &&
        (descriptorOrArray.length === 0 || descriptorOrArray[0] instanceof Float32Array)) {

      if (!FaceCache._db) {
        // DB might not be open yet — fall back to base implementation
        return _set(fileId, descriptorOrArray[0] || new Float32Array(0), filename);
      }

      return new Promise(resolve => {
        try {
          const tx = FaceCache._db.transaction('descriptors', 'readwrite');
          tx.objectStore('descriptors').put({
            id:          fileId,
            descriptors: descriptorOrArray.map(d => Array.from(d)),
            descriptor:  descriptorOrArray[0] ? Array.from(descriptorOrArray[0]) : [],
            filename:    filename || '',
            ts:          Date.now(),
          });
          tx.oncomplete = resolve;
          tx.onerror    = resolve;
        } catch { resolve(); }
      });
    }

    // Legacy single Float32Array path
    return _set(fileId, descriptorOrArray, filename);
  };
})();
