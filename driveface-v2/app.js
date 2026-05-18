/**
 * app.js — DriveFace Finder · Main Application Controller
 *
 * Guest experience (zero friction):
 *   1. Page loads, AI models download in background (first visit only)
 *   2. Guest enters folder ID / link shared by the photographer
 *   3. Guest uploads a selfie or takes one with the camera
 *   4. App validates folder, fetches image list via Apps Script,
 *      runs face detection + comparison entirely in the browser
 *   5. Matched photos shown in gallery — download individually or as ZIP
 *
 * No Google account, no API key, no sign-in required from guests.
 */

'use strict';

const App = (() => {

  /* ══════════════════════════════════════════════════════
     STATE
  ══════════════════════════════════════════════════════ */
  const S = {
    faceDescriptor: null,    // Float32Array — user's 128-dim face vector
    faceDataURL:    null,    // preview data URL

    folderId:       null,
    folderName:     null,

    allMatches:     [],      // full result set
    filtered:       [],      // after confidence filter applied

    scanning:       false,
    cancel:         { cancelled: false },

    lbIndex:        0,       // lightbox current index
    page:           0,       // results gallery page
  };

  const PAGE = 24;           // cards per page

  /* ══════════════════════════════════════════════════════
     DOM CACHE
  ══════════════════════════════════════════════════════ */
  let D = {};

  function cacheDOM() {
    [
      'appNameHeader',
      // Folder
      'folderInput','clearFolder','recentSearches','folderStatus','folderFieldLabel',
      // Face
      'dropZone','faceRing','faceEmpty','faceImg','faceCheck','faceMeta',
      'uploadFaceBtn','cameraBtn','faceFileInput',
      // Search
      'searchBtn','ctaNote',
      // Face processing modal
      'faceProcessModal','fpThumb','fpHeadline','fpSub',
      // Scanning modal
      'scanModal','progressLabel','progressBar','progressStats','matchCount','cancelBtn',
      // Results
      'resultsSection','resultsGrid','resultCount','emptyState',
      'loadMoreContainer','loadMoreBtn','confidenceFilter','confidenceValue',
      'gridSizeSlider','exportLinksBtn','downloadAllBtn',
      // Camera
      'cameraModal','cameraBackdrop','cameraFeed','cameraCanvas','captureBtn','closeCameraModal',
      // Lightbox
      'lightbox','lbBackdrop','lbClose','lbPrev','lbNext','lbImg','lbLoader','lbName','lbConfidence','lbDownload',
      // Settings
      'settingsModal','settingsBackdrop','closeSettings',
      'thresholdSlider','thresholdValue',
      'maxImagesSlider','maxImagesValue',
      'qualitySelect','clearCacheBtn','clearHistoryBtn','cacheInfo',
      // History
      'historyModal','historyBackdrop','closeHistory','historyList',
      // Header
      'historyBtn','settingsBtn','themeBtn','themeIcon',
      // Model overlay
      'modelOverlay','modelProgressBar','modelStatusText',
    ].forEach(id => { D[id] = document.getElementById(id); });
  }

  /* ══════════════════════════════════════════════════════
     INIT
  ══════════════════════════════════════════════════════ */
  async function init() {
    cacheDOM();
    Toast.init();

    applyTheme(Storage.get('dff_theme', 'dark'), false);
    applyConfig();
    loadSettingsValues();
    renderRecentSearches();
    bindEvents();
    spawnParticles();

    // Pre-fill folder from URL query params (highest priority)
    // then fall back to config.js defaultFolderId
    readURLParams();

    await loadModels();
  }

  /**
   * Read folder ID from the page URL query string.
   *
   * Supported formats — all of these work:
   *   ?id=1ap1sn3Tc_URPvukDdCicQsDMvpcxReM5          ← bare folder ID
   *   ?folder=1ap1sn3Tc_URPvukDdCicQsDMvpcxReM5      ← alternative key
   *   ?event=1ap1sn3Tc_URPvukDdCicQsDMvpcxReM5       ← friendly alias
   *   ?id=https://drive.google.com/drive/folders/ID  ← full Drive URL also works
   *
   * After setting the folder the function auto-validates it so the guest
   * immediately sees a green "folder accessible" status without clicking anything.
   *
   * Usage — share links like:
   *   https://antargfx.github.io/codelab/driveface?id=FOLDER_ID
   *   https://antargfx.github.io/codelab/driveface?event=smith-wedding&id=FOLDER_ID
   */
  function readURLParams() {
    const params   = new URLSearchParams(window.location.search);
    const raw      = params.get('id') || params.get('folder') || params.get('event') || '';
    const fromURL  = !!raw;

    // Priority: URL param → config.js default → leave empty
    const source   = raw || DRIVEFACE_CONFIG.defaultFolderId || '';
    if (!source) return;

    const folderId = Utils.extractFolderId(source);
    if (!folderId) return;

    // Fill the input field
    D.folderInput.value = source.includes('drive.google.com') ? source : folderId;
    S.folderId = folderId;

    // Pulse the input so the user notices it was auto-filled
    if (fromURL) {
      D.folderInput.classList.remove('url-injected'); // reset if already set
      void D.folderInput.offsetWidth;                 // force reflow to restart animation
      D.folderInput.classList.add('url-injected');
    }

    updateSearchBtn();

    // Show a subtle "loading" status while we validate in the background
    if (fromURL) {
      setFolderStatus('checking', 'Checking folder…');
    }

    // Auto-validate asynchronously — don't block the rest of init
    autoValidateFolder(folderId, fromURL);
  }

  /**
   * Quietly validate a pre-filled folder ID in the background.
   * Updates the folder status indicator without user interaction.
   */
  async function autoValidateFolder(folderId, showToast = false) {
    // Wait until models start loading (script URL must be ready)
    await Utils.sleep(800);

    if (!DriveAPI.scriptUrl) {
      setFolderStatus(null);
      return;
    }

    try {
      const result = await DriveAPI.validateFolder(folderId);
      if (result.valid) {
        S.folderName = result.name;
        setFolderStatus('ok', `"${result.name}" — ${result.total ?? '?'} photos`);
        if (showToast) Toast.success(`Folder loaded: ${result.name}`);
        // Save to recent searches automatically
        RecentSearches.add(folderId, result.name);
        renderRecentSearches();
      } else {
        setFolderStatus('err', result.error || 'Could not access folder');
      }
    } catch {
      setFolderStatus(null); // silently ignore network errors on auto-validate
    }

    updateSearchBtn();
  }

  /** Apply branding from config.js */
  function applyConfig() {
    const cfg = DRIVEFACE_CONFIG;
    if (cfg.appName && D.appNameHeader) {
      const parts = cfg.appName.match(/^(.+?)(\w+)$/) || [cfg.appName, cfg.appName, ''];
      D.appNameHeader.innerHTML = Utils.esc(parts[1]) + `<em>${Utils.esc(parts[2])}</em>`;
    }
    if (cfg.folderLabel && D.folderFieldLabel) {
      D.folderFieldLabel.textContent = cfg.folderLabel;
    }
    if (cfg.tagline) {
      const el = document.getElementById('heroTagline');
      if (el) el.textContent = cfg.tagline;
    }
    document.title = cfg.appName || 'DriveFace Finder';
  }

  /* ── model loader ──────────────────────────────────── */
  async function loadModels() {
    D.modelOverlay.style.display = 'flex';
    try {
      await FaceCache.init();
      await FaceRecognition.loadModels((pct, label) => {
        D.modelProgressBar.style.width = pct + '%';
        D.modelStatusText.textContent  = label;
      });
      await Utils.sleep(350);
      D.modelOverlay.style.display = 'none';
      updateCacheInfo();
    } catch (err) {
      D.modelStatusText.textContent = '⚠ Failed to load AI models. Please refresh the page.';
      Toast.error('Could not load AI models. Check your internet connection.', 8000);
      console.error(err);
    }
  }

  /* ══════════════════════════════════════════════════════
     EVENT BINDING
  ══════════════════════════════════════════════════════ */
  function bindEvents() {
    /* folder */
    D.folderInput.addEventListener('input', Utils.debounce(onFolderInput, 350));
    D.folderInput.addEventListener('focus', () => showRecent(true));
    D.folderInput.addEventListener('blur',  () => setTimeout(() => showRecent(false), 180));
    D.clearFolder.addEventListener('click', clearFolder);

    /* face */
    D.uploadFaceBtn.addEventListener('click', () => D.faceFileInput.click());
    D.faceFileInput.addEventListener('change', e => handleFaceFile(e.target.files[0]));

    /* camera */
    D.cameraBtn.addEventListener('click', openCamera);
    D.closeCameraModal.addEventListener('click', closeCamera);
    D.cameraBackdrop.addEventListener('click', closeCamera);
    D.captureBtn.addEventListener('click', capturePhoto);

    /* drag & drop */
    D.dropZone.addEventListener('dragover',  e => { e.preventDefault(); D.dropZone.classList.add('drag-over'); });
    D.dropZone.addEventListener('dragleave', ()  => D.dropZone.classList.remove('drag-over'));
    D.dropZone.addEventListener('drop', e => {
      e.preventDefault();
      D.dropZone.classList.remove('drag-over');
      const f = e.dataTransfer.files[0];
      if (f?.type.startsWith('image/')) handleFaceFile(f);
      else Toast.warning('Please drop an image file.');
    });

    /* search */
    D.searchBtn.addEventListener('click', startSearch);
    D.cancelBtn.addEventListener('click', () => { S.cancel.cancelled = true; });

    /* results */
    D.confidenceFilter.addEventListener('input', onConfidenceFilter);
    D.gridSizeSlider.addEventListener('input', () => {
      D.resultsGrid.style.setProperty('--card-min', D.gridSizeSlider.value + 'px');
    });
    D.downloadAllBtn.addEventListener('click', downloadAll);
    D.exportLinksBtn.addEventListener('click', exportLinks);
    D.loadMoreBtn.addEventListener('click', () => renderCards(true));

    /* lightbox */
    D.lbBackdrop.addEventListener('click', closeLightbox);
    D.lbClose.addEventListener('click',    closeLightbox);
    D.lbPrev.addEventListener('click',     () => shiftLightbox(-1));
    D.lbNext.addEventListener('click',     () => shiftLightbox(+1));
    D.lbDownload.addEventListener('click', downloadLightboxFile);
    document.addEventListener('keydown', e => {
      if (D.lightbox.classList.contains('hidden')) return;
      if (e.key === 'Escape')      closeLightbox();
      if (e.key === 'ArrowLeft')   shiftLightbox(-1);
      if (e.key === 'ArrowRight')  shiftLightbox(+1);
    });

    /* settings */
    D.settingsBtn.addEventListener('click', openSettings);
    D.closeSettings.addEventListener('click', () => closeModal('settingsModal'));
    D.settingsBackdrop.addEventListener('click', () => closeModal('settingsModal'));

    D.thresholdSlider.addEventListener('input', () => {
      D.thresholdValue.textContent = D.thresholdSlider.value;
      Storage.set('dff_threshold', D.thresholdSlider.value);
    });
    D.maxImagesSlider.addEventListener('input', () => {
      D.maxImagesValue.textContent = D.maxImagesSlider.value;
      Storage.set('dff_maxImages', D.maxImagesSlider.value);
    });
    D.qualitySelect.addEventListener('change', () => {
      Storage.set('dff_quality', D.qualitySelect.value);
    });
    D.clearCacheBtn.addEventListener('click', async () => {
      await FaceCache.clear();
      updateCacheInfo();
      Toast.success('Face cache cleared.');
    });
    D.clearHistoryBtn.addEventListener('click', () => {
      ScanHistory.clear();
      RecentSearches.clear();
      renderRecentSearches();
      Toast.success('History cleared.');
    });

    /* history */
    D.historyBtn.addEventListener('click', openHistory);
    D.closeHistory.addEventListener('click', () => closeModal('historyModal'));
    D.historyBackdrop.addEventListener('click', () => closeModal('historyModal'));

    /* theme */
    D.themeBtn.addEventListener('click', toggleTheme);
  }

  /* ══════════════════════════════════════════════════════
     SETTINGS
  ══════════════════════════════════════════════════════ */
  function loadSettingsValues() {
    const cfg = DRIVEFACE_CONFIG;
    D.thresholdSlider.value      = Storage.get('dff_threshold', String(cfg.defaultThreshold || 0.55));
    D.thresholdValue.textContent = D.thresholdSlider.value;
    D.maxImagesSlider.value      = Storage.get('dff_maxImages', String(cfg.maxImages || 800));
    D.maxImagesValue.textContent = D.maxImagesSlider.value;
    D.qualitySelect.value        = Storage.get('dff_quality', cfg.defaultQuality || 'balanced');
  }

  function openSettings() {
    loadSettingsValues();
    updateCacheInfo();
    openModal('settingsModal');
  }

  async function updateCacheInfo() {
    const n = await FaceCache.count();
    if (D.cacheInfo) {
      D.cacheInfo.textContent = n
        ? `${n} face descriptor${n !== 1 ? 's' : ''} cached — repeat scans are instant.`
        : 'No descriptors cached yet.';
    }
  }

  /* ══════════════════════════════════════════════════════
     FOLDER INPUT
  ══════════════════════════════════════════════════════ */
  function onFolderInput() {
    const raw = D.folderInput.value.trim();
    S.folderId = Utils.extractFolderId(raw);
    setFolderStatus(null);
    updateSearchBtn();
  }

  function clearFolder() {
    D.folderInput.value = '';
    S.folderId          = null;
    S.folderName        = null;
    setFolderStatus(null);
    updateSearchBtn();
  }

  function setFolderStatus(type, text) {
    D.folderStatus.className = 'folder-status';
    if (!type) { D.folderStatus.classList.add('hidden'); return; }
    D.folderStatus.classList.remove('hidden');
    D.folderStatus.classList.add(type);
    const icons = {
      ok:       'fa-circle-check',
      err:      'fa-circle-xmark',
      checking: 'fa-spinner fa-spin',
    };
    const icon = icons[type] || icons.err;
    D.folderStatus.innerHTML = `<i class="fa-solid ${icon}"></i> ${Utils.esc(text)}`;
  }

  /* recent searches drop-down */
  function showRecent(visible) {
    const list = RecentSearches.get();
    if (!visible || !list.length) { D.recentSearches.classList.add('hidden'); return; }
    D.recentSearches.classList.remove('hidden');
  }

  function renderRecentSearches() {
    const list = RecentSearches.get();
    D.recentSearches.innerHTML = '';
    if (!list.length) { D.recentSearches.classList.add('hidden'); return; }

    list.forEach(r => {
      const el = document.createElement('div');
      el.className = 'recent-item';
      el.innerHTML = `<i class="fa-solid fa-clock-rotate-left"></i><span>${Utils.esc(r.name || r.id)}</span>`;
      el.addEventListener('click', () => {
        D.folderInput.value = r.id;
        S.folderId          = r.id;
        S.folderName        = r.name;
        showRecent(false);
        updateSearchBtn();
      });
      D.recentSearches.appendChild(el);
    });
  }

  /* ══════════════════════════════════════════════════════
     FACE HANDLING
  ══════════════════════════════════════════════════════ */

  /** Show the face-processing modal with the given image src and status text */
  function showFaceProcessModal(imgSrc, headline, sub) {
    D.fpThumb.src           = imgSrc || '';
    D.fpThumb.classList.remove('done');
    D.fpHeadline.textContent = headline || 'Analysing your photo…';
    D.fpSub.textContent      = sub      || 'Looking for a face';

    // Re-trigger SVG animations by forcing a reflow
    const overlay = D.faceProcessModal.querySelector('.fp-overlay');
    if (overlay) {
      overlay.style.display = 'none';
      void overlay.offsetWidth; // force reflow
      overlay.style.display = '';
    }

    D.faceProcessModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  /** Update the status text inside the modal */
  function updateFaceProcessModal(headline, sub) {
    if (D.fpHeadline) D.fpHeadline.textContent = headline;
    if (D.fpSub)      D.fpSub.textContent      = sub;
  }

  /** Hide the face-processing modal */
  function hideFaceProcessModal() {
    if (D.fpThumb) D.fpThumb.classList.add('done'); // unsaturate → full colour
    setTimeout(() => {
      D.faceProcessModal.classList.add('hidden');
      document.body.style.overflow = '';
    }, 280); // short delay so user sees the "done" state
  }

  async function handleFaceFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { Toast.error('Please select an image file.'); return; }
    if (!FaceRecognition.loaded) { Toast.warning('AI models are still loading — please wait a moment.'); return; }

    // Read file → show modal immediately with the preview thumbnail
    let dataURL;
    try {
      dataURL = await ImageUtils.fileToDataURL(file);
    } catch {
      Toast.error('Could not read the image file.'); return;
    }

    showFaceProcessModal(dataURL, 'Analysing your photo…', 'Loading image');

    try {
      updateFaceProcessModal('Analysing your photo…', 'Resizing for AI…');
      const img    = await ImageUtils.dataURLToImage(dataURL);
      const canvas = ImageUtils.resizeToCanvas(img, 640);

      updateFaceProcessModal('Detecting face…', 'Running face detection model');
      const desc   = await FaceRecognition.getDescriptor(canvas);

      if (!desc) {
        hideFaceProcessModal();
        Toast.error('No face detected. Use a clear, front-facing, well-lit photo.');
        return;
      }

      updateFaceProcessModal('Face found! ✓', 'Building your face profile');
      await Utils.sleep(420); // brief moment so user reads the success state

      hideFaceProcessModal();
      setFaceResult(desc, dataURL, file.name);
      Toast.success('Face detected — ready to search!');
    } catch (err) {
      hideFaceProcessModal();
      Toast.error('Error processing image: ' + err.message);
      console.error(err);
    }
  }

  function setFaceResult(descriptor, dataURL, filename) {
    S.faceDescriptor = descriptor;
    S.faceDataURL    = dataURL;

    D.faceImg.src    = dataURL;
    D.faceImg.classList.remove('hidden');
    D.faceEmpty.classList.add('hidden');
    D.faceCheck.classList.remove('hidden');
    D.faceRing.classList.add('has-face');
    D.faceMeta.textContent = filename ? `✓ ${filename}` : '✓ Face detected';
    updateSearchBtn();
  }

  /* ══════════════════════════════════════════════════════
     CAMERA
  ══════════════════════════════════════════════════════ */
  let camStream = null;

  async function openCamera() {
    try {
      camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      D.cameraFeed.srcObject = camStream;
      openModal('cameraModal');
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        Toast.error('Camera access denied. Please allow it in your browser settings.');
      } else {
        Toast.error('Could not start camera: ' + err.message);
      }
    }
  }

  function closeCamera() {
    if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
    D.cameraFeed.srcObject = null;
    closeModal('cameraModal');
  }

  async function capturePhoto() {
    const video  = D.cameraFeed;
    const canvas = D.cameraCanvas;
    canvas.width  = video.videoWidth  || 640;
    canvas.height = video.videoHeight || 480;

    const ctx = canvas.getContext('2d');
    // Un-mirror the CSS-mirrored feed so the captured image is correct
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
    ctx.restore();

    closeCamera();

    if (!FaceRecognition.loaded) { Toast.warning('Models still loading.'); return; }

    // Show preview in modal immediately
    const dataURL = canvas.toDataURL('image/jpeg', 0.9);
    showFaceProcessModal(dataURL, 'Analysing selfie…', 'Loading capture');

    try {
      updateFaceProcessModal('Analysing selfie…', 'Resizing for AI…');
      const small = ImageUtils.resizeToCanvas(canvas, 640);

      updateFaceProcessModal('Detecting face…', 'Running face detection model');
      const desc  = await FaceRecognition.getDescriptor(small);

      if (!desc) {
        hideFaceProcessModal();
        Toast.error('No face detected. Move closer and ensure good lighting.');
        return;
      }

      updateFaceProcessModal('Face found! ✓', 'Building your face profile');
      await Utils.sleep(420);

      hideFaceProcessModal();
      setFaceResult(desc, dataURL, 'Camera selfie');
      Toast.success('Selfie captured!');
    } catch (err) {
      hideFaceProcessModal();
      Toast.error('Capture error: ' + err.message);
    }
  }

  /* ══════════════════════════════════════════════════════
     SEARCH
  ══════════════════════════════════════════════════════ */
  function updateSearchBtn() {
    const ready = !!(S.folderId && S.faceDescriptor && !S.scanning);
    D.searchBtn.disabled = !ready;

    if (!S.folderId) {
      D.ctaNote.textContent = 'Enter the event folder link or ID above';
    } else if (!S.faceDescriptor) {
      D.ctaNote.textContent = 'Upload or take a selfie to continue';
    } else {
      D.ctaNote.textContent = 'All set — tap to find your photos!';
    }
  }

  async function startSearch() {
    if (!S.folderId || !S.faceDescriptor || !DriveAPI.scriptUrl) return;
    if (!FaceRecognition.loaded) { Toast.warning('AI models are still loading.'); return; }

    S.scanning  = true;
    S.cancel    = { cancelled: false };
    S.allMatches = [];
    S.filtered   = [];

    D.searchBtn.disabled = true;
    D.resultsSection.classList.add('hidden');
    D.resultsGrid.innerHTML = '';
    D.emptyState.classList.add('hidden');

    // Show scanning modal
    D.scanModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    const maxImages = parseInt(Storage.get('dff_maxImages', String(DRIVEFACE_CONFIG.maxImages || 800)));
    const scanStart = Date.now();

    try {
      /* ── 1. Validate folder ── */
      setProgress(0, 'Connecting to folder…');
      const check = await DriveAPI.validateFolder(S.folderId);

      if (!check.valid) {
        Toast.error(check.error || 'Invalid folder.');
        setFolderStatus('err', check.error || 'Could not access folder');
        return;
      }

      S.folderName = check.name;
      setFolderStatus('ok', `"${check.name}" — ${check.total ?? '?'} photos found`);
      RecentSearches.add(S.folderId, check.name);
      renderRecentSearches();

      /* ── 2. Fetch image list ── */
      setProgress(5, `Loading photo list from "${check.name}"…`);

      const files = await DriveAPI.getFolderImages(
        S.folderId,
        maxImages,
        (loaded, total) => {
          const pct = total ? Math.min(5 + Math.round((loaded / total) * 10), 15) : 8;
          setProgress(pct, `Loading list… ${loaded} / ${total || '?'}`);
        }
      );

      if (!files.length) {
        Toast.warning('No images found in this folder. Make sure it contains photos.');
        return;
      }

      Toast.info(`Scanning ${files.length} photo${files.length !== 1 ? 's' : ''} for your face…`);

      /* ── 3. Run face comparison ── */
      const matches = await FaceRecognition.processBatch(
        files,
        S.faceDescriptor,
        {
          cancelToken: S.cancel,
          onProgress: (pct, done, total, found) => {
            setProgress(15 + pct * 0.85, `Scanning ${done} / ${total}…`);
            D.progressStats.textContent = `${done} / ${total} photos scanned`;
            D.matchCount.textContent    = `${found} match${found !== 1 ? 'es' : ''} found`;
          },
        }
      );

      if (S.cancel.cancelled) { Toast.warning('Scan cancelled.'); return; }

      /* ── 4. Show results ── */
      ScanHistory.add({
        folder:   check.name,
        folderId: S.folderId,
        total:    files.length,
        matches:  matches.length,
        duration: Date.now() - scanStart,
        ts:       Date.now(),
      });

      S.allMatches = matches;
      S.filtered   = [...matches];
      showResults();

      if (matches.length === 0) {
        Toast.warning('No matches found. Try a clearer selfie or ask the photographer to lower the threshold.');
      } else {
        Toast.success(`Found ${matches.length} photo${matches.length !== 1 ? 's' : ''} of you! 🎉`);
      }

    } catch (err) {
      Toast.error(err.message, 7000);
      console.error('Search error:', err);
    } finally {
      S.scanning = false;
      // Hide scanning modal
      D.scanModal.classList.add('hidden');
      document.body.style.overflow = '';
      updateSearchBtn();
    }
  }

  function setProgress(pct, label) {
    D.progressBar.style.width   = Utils.clamp(pct, 0, 100) + '%';
    D.progressLabel.textContent = label;
  }

  /* ══════════════════════════════════════════════════════
     RESULTS GALLERY
  ══════════════════════════════════════════════════════ */
  function showResults() {
    S.page = 0;
    D.resultsSection.classList.remove('hidden');
    D.resultsGrid.innerHTML = '';
    D.resultCount.textContent = `${S.filtered.length} found`;

    if (!S.filtered.length) {
      D.emptyState.classList.remove('hidden');
      D.loadMoreContainer.classList.add('hidden');
      return;
    }
    D.emptyState.classList.add('hidden');
    renderCards(false);
    D.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderCards(append = false) {
    if (!append) { S.page = 0; D.resultsGrid.innerHTML = ''; }

    const start = S.page * PAGE;
    const slice = S.filtered.slice(start, start + PAGE);

    slice.forEach((result, i) => {
      const card = buildCard(result, start + i);
      card.style.animationDelay = (i * 28) + 'ms';
      D.resultsGrid.appendChild(card);
    });

    S.page++;
    const hasMore = S.page * PAGE < S.filtered.length;
    D.loadMoreContainer.classList.toggle('hidden', !hasMore);
  }

  function buildCard(result, index) {
    const thumb = DriveAPI.thumbUrl(result, 400);
    const { label, cls } = Utils.confidenceInfo(result.similarity);

    const card = document.createElement('div');
    card.className = 'r-card';
    card.style.animation = 'cardIn 0.4s cubic-bezier(0.34,1.56,0.64,1) both';
    card.innerHTML = `
      <img
        src="${Utils.esc(thumb)}"
        alt="${Utils.esc(result.name)}"
        loading="lazy"
        decoding="async"
        onerror="this.style.display='none'"
      >
      <div class="r-overlay">
        <div class="r-overlay-row">
          <span class="conf-tag ${cls}">${Utils.esc(label)}</span>
          <button class="r-dl-btn" title="Download" aria-label="Download this photo">
            <i class="fa-solid fa-download"></i>
          </button>
        </div>
      </div>
    `;

    card.querySelector('.r-dl-btn').addEventListener('click', e => {
      e.stopPropagation();
      downloadSingle(result);
    });
    card.addEventListener('click', () => openLightbox(index));
    return card;
  }

  /* card entrance animation */
  (() => {
    const s = document.createElement('style');
    s.textContent = '@keyframes cardIn{from{opacity:0;transform:scale(0.88) translateY(12px)}to{opacity:1;transform:none}}';
    document.head.appendChild(s);
  })();

  /* ── confidence filter ── */
  function onConfidenceFilter() {
    const val = parseInt(D.confidenceFilter.value, 10);
    D.confidenceValue.textContent = val === 0 ? 'All' : `≥${val}%`;
    S.filtered = val === 0
      ? [...S.allMatches]
      : S.allMatches.filter(r => r.similarity >= val);
    D.resultCount.textContent = `${S.filtered.length} found`;
    showResults();
  }

  /* ══════════════════════════════════════════════════════
     LIGHTBOX
  ══════════════════════════════════════════════════════ */
  function openLightbox(index) {
    S.lbIndex = index;
    renderLightbox();
    D.lightbox.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function renderLightbox() {
    const r = S.filtered[S.lbIndex];
    if (!r) return;

    D.lbImg.style.opacity    = '0';
    D.lbLoader.style.display = 'flex';

    const url = DriveAPI.viewUrl(r.id);
    D.lbImg.onload  = () => { D.lbLoader.style.display = 'none'; D.lbImg.style.opacity = '1'; D.lbImg.style.transition = 'opacity 0.2s'; };
    D.lbImg.onerror = () => {
      // fallback to thumbnail
      D.lbImg.src = DriveAPI.thumbUrl(r, 1200);
      D.lbLoader.style.display = 'none';
      D.lbImg.style.opacity = '1';
    };
    D.lbImg.src = url;

    D.lbName.textContent       = r.name;
    D.lbConfidence.textContent = `${r.similarity}% match`;
    D.lbPrev.disabled          = S.lbIndex === 0;
    D.lbNext.disabled          = S.lbIndex === S.filtered.length - 1;
  }

  function closeLightbox() {
    D.lightbox.classList.add('hidden');
    D.lbImg.src = '';
    document.body.style.overflow = '';
  }

  function shiftLightbox(dir) {
    const next = S.lbIndex + dir;
    if (next < 0 || next >= S.filtered.length) return;
    S.lbIndex = next;
    renderLightbox();
  }

  function downloadLightboxFile() {
    const r = S.filtered[S.lbIndex];
    if (r) downloadSingle(r);
  }

  /* ══════════════════════════════════════════════════════
     DOWNLOADS
  ══════════════════════════════════════════════════════ */
  async function downloadSingle(result) {
    Toast.info('Preparing download…');
    try {
      // Fetch via blob to force download (vs. browser opening the image)
      const res  = await fetch(DriveAPI.viewUrl(result.id));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const ext  = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
      const name = result.name || `photo_${result.id}.${ext}`;
      const a    = document.createElement('a');
      a.href     = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      Toast.success('Download started!');
    } catch {
      // Fallback: open in new tab
      window.open(`https://drive.google.com/file/d/${result.id}/view`, '_blank');
      Toast.warning('Opened in Google Drive — download from there.');
    }
  }

  async function downloadAll() {
    if (!S.filtered.length) { Toast.warning('No photos to download.'); return; }

    const orig = D.downloadAllBtn.innerHTML;
    D.downloadAllBtn.disabled = true;
    Toast.info(`Packaging ${S.filtered.length} photos into a ZIP…`);

    try {
      await ZipDownloader.download(
        S.filtered,
        null, // no API key needed — uses lh3 URLs directly
        pct => { D.downloadAllBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${pct}%`; }
      );
      Toast.success('ZIP download ready!');
    } catch (err) {
      Toast.error('ZIP failed: ' + err.message);
    } finally {
      D.downloadAllBtn.innerHTML = orig;
      D.downloadAllBtn.disabled  = false;
    }
  }

  function exportLinks() {
    if (!S.filtered.length) { Toast.warning('No results to export.'); return; }

    const header = 'Filename\tMatch %\tView URL';
    const rows   = S.filtered.map(r =>
      [r.name, r.similarity + '%', DriveAPI.viewUrl(r.id)].join('\t')
    );
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/tab-separated-values' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `my_photos_${Date.now()}.tsv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    Toast.success(`Exported ${S.filtered.length} links.`);
  }

  /* ══════════════════════════════════════════════════════
     MODALS
  ══════════════════════════════════════════════════════ */
  function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
  function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
    document.body.style.overflow = '';
  }

  function openHistory() { renderHistory(); openModal('historyModal'); }

  function renderHistory() {
    const list = ScanHistory.get();
    D.historyList.innerHTML = '';
    if (!list.length) {
      D.historyList.innerHTML = `<div class="empty-state-sm"><i class="fa-solid fa-box-open"></i><p>No scans yet</p></div>`;
      return;
    }
    list.forEach(h => {
      const el = document.createElement('div');
      el.className = 'h-item';
      el.innerHTML = `
        <div class="h-item-left">
          <span class="h-folder">${Utils.esc(h.folder || h.folderId)}</span>
          <span class="h-meta">${Utils.fmtDate(h.ts)} · ${h.total} photos · ${Utils.fmtDuration(h.duration || 0)}</span>
        </div>
        <span class="h-matches">${h.matches} match${h.matches !== 1 ? 'es' : ''}</span>
      `;
      el.addEventListener('click', () => {
        D.folderInput.value = h.folderId;
        S.folderId          = h.folderId;
        S.folderName        = h.folder;
        closeModal('historyModal');
        updateSearchBtn();
      });
      D.historyList.appendChild(el);
    });
  }

  /* ══════════════════════════════════════════════════════
     THEME
  ══════════════════════════════════════════════════════ */
  function applyTheme(theme, save = true) {
    document.documentElement.setAttribute('data-theme', theme);
    if (save) Storage.set('dff_theme', theme);
    if (D.themeIcon) D.themeIcon.className = `fa-solid ${theme === 'dark' ? 'fa-moon' : 'fa-sun'}`;
  }
  function toggleTheme() {
    applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  }

  /* ══════════════════════════════════════════════════════
     HERO PARTICLES
  ══════════════════════════════════════════════════════ */
  function spawnParticles() {
    const container = document.getElementById('heroParticles');
    if (!container) return;
    const n = window.innerWidth < 600 ? 14 : 28;
    for (let i = 0; i < n; i++) {
      const p = document.createElement('div');
      p.className = 'hero-particle';
      p.style.cssText = `
        left:${Math.random() * 100}%;
        top:${15 + Math.random() * 75}%;
        --dur:${7 + Math.random() * 9}s;
        --delay:-${Math.random() * 10}s;
        width:${Math.random() > 0.5 ? 2 : 3}px;
        height:${Math.random() > 0.5 ? 2 : 3}px;
        background:${Math.random() > 0.5 ? 'var(--violet)' : 'var(--sky)'};
      `;
      container.appendChild(p);
    }
  }

  /* ══════════════════════════════════════════════════════
     PUBLIC
  ══════════════════════════════════════════════════════ */
  return { init, openModal, closeModal };
})();

document.addEventListener('DOMContentLoaded', () => {
  App.init().catch(err => console.error('App init failed:', err));
});
