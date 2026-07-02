/**
 * app.js — AntLab v2
 * Wires everything together: storage, editor, preview (SW-backed), zip, UI.
 */

(async () => {
  /* ================= State ================= */
  let currentProject = null;
  let isDark = false;
  let mobileView = 'editor';
  let resizing = false;
  let modalResolve = null;
  let downloadOpen = false;
  let pendingUploadFiles = [];

  /* ================= Splash ================= */
  function setSplashStatus(t) { const el = document.getElementById('splashStatus'); if (el) el.textContent = t; }
  function hideSplash() {
    const s = document.getElementById('splash'), a = document.getElementById('app');
    setTimeout(() => {
      s.classList.add('fade-out');
      a.classList.remove('hidden');
      setTimeout(() => { s.style.display = 'none'; }, 500);
    }, 400);
  }

  /* ================= Init ================= */
  async function init() {
    setSplashStatus('Loading storage…');
    await Storage.init();

    setSplashStatus('Loading project…');
    currentProject = await Storage.getOrCreateCurrentProject();
    // ensure required fields
    currentProject.files = currentProject.files || {};
    currentProject.entry = currentProject.entry || 'index.html';

    setSplashStatus('Starting editor…');
    Editor.init({
      onChange: (files) => {
        // Live update files map, push to preview SW (debounced reload)
        currentProject.files = files;
        // If entry no longer exists, fall back to any HTML file, then any file
        if (!files[currentProject.entry]) {
          currentProject.entry = Object.keys(files).find(p => /\.html?$/i.test(p))
                              || Object.keys(files)[0]
                              || 'index.html';
        }
        Preview.updateFiles(files, currentProject.entry);
      },
      onSave: async (files) => {
        currentProject.files = files;
        const layout = Editor.getLayout();
        currentProject.openTabs = layout.openTabs;
        currentProject.activeTab = layout.activeTab;
        await Storage.saveProject(currentProject);
      },
      onLayoutChange: async () => {
        const layout = Editor.getLayout();
        currentProject.openTabs = layout.openTabs;
        currentProject.activeTab = layout.activeTab;
        // Persist without waiting
        Storage.saveProject(currentProject);
      },
      entryGetter: () => currentProject?.entry || 'index.html',
      onSetHome: (path) => setHomeFile(path),
      onRename: (oldPath, newPath) => {
        if (currentProject?.entry === oldPath) currentProject.entry = newPath;
      },
    });
    Editor.setAll(currentProject);

    setSplashStatus('Starting virtual server…');
    await Preview.init();
    await Preview.setProject(currentProject);

    updateProjectNameDisplay();
    applyTheme(false);
    setupEventListeners();
    Zip.setupDragDrop(document.getElementById('app'), handleDroppedFiles);
    setMobileView('editor');
    await renderProjectList();

    hideSplash();
  }

  /* ================= Project name ================= */
  function updateProjectNameDisplay() {
    const el = document.getElementById('projectName');
    if (el && currentProject) el.textContent = currentProject.name;
  }

  /* ================= Theme ================= */
  function applyTheme(dark) {
    isDark = dark;
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    Editor.setTheme(dark);
    const icon = document.getElementById('themeIcon');
    if (dark) {
      icon.innerHTML = '<path d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
    } else {
      icon.innerHTML = '<circle cx="12" cy="12" r="5" stroke="currentColor" stroke-width="2"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
    }
  }

  /* ================= Home file (entry) ================= */
  async function setHomeFile(path) {
    if (!currentProject) return;
    if (!currentProject.files[path]) { alert('That file does not exist.'); return; }
    currentProject.entry = path;
    await Storage.saveProject(currentProject);
    Preview.updateFiles(currentProject.files, currentProject.entry);
    toast('Home set to ' + path);
  }

  /* ================= Projects ================= */
  async function loadProject(project) {
    currentProject = project;
    currentProject.files = currentProject.files || {};
    currentProject.entry = currentProject.entry || 'index.html';
    await Storage.setCurrentProjectId(project.id);
    Editor.setAll(currentProject);
    await Preview.setProject(currentProject);
    updateProjectNameDisplay();
    closeDrawer();
  }

  async function createNewProject() {
    const name = await showInputModal('New Project', 'Project name:', 'my-project');
    if (name === null) return;
    const p = Storage.createProject(name || 'untitled');
    await Storage.saveProject(p);
    await loadProject(p);
    await renderProjectList();
  }

  async function renameProject(id) {
    const p = await Storage.getProject(id); if (!p) return;
    const nn = await showInputModal('Rename Project', 'New name:', p.name);
    if (nn === null || nn === p.name) return;
    p.name = nn || p.name; await Storage.saveProject(p);
    if (currentProject && currentProject.id === id) { currentProject.name = p.name; updateProjectNameDisplay(); }
    await renderProjectList();
  }

  async function deleteProject(id) {
    const ok = await showConfirmModal('Delete project', 'This cannot be undone. Delete?');
    if (!ok) return;
    await Storage.deleteProject(id);
    if (currentProject?.id === id) {
      const all = await Storage.getAllProjects();
      if (all.length) await loadProject(all[0]);
      else { const p = Storage.createProject('untitled'); await Storage.saveProject(p); await loadProject(p); }
    }
    await renderProjectList();
  }

  async function renderProjectList() {
    const list = document.getElementById('projectList'); if (!list) return;
    const all = await Storage.getAllProjects(); list.innerHTML = '';
    if (!all.length) { list.innerHTML = '<p style="padding:12px 16px;font-size:12px;color:var(--text-muted)">No projects yet.</p>'; return; }
    all.forEach(p => {
      const active = currentProject?.id === p.id;
      const item = document.createElement('div');
      item.className = 'project-item' + (active ? ' active' : '');
      const date = new Date(p.updatedAt).toLocaleDateString(undefined, { month:'short', day:'numeric' });
      const fileCount = Object.keys(p.files || {}).length;
      item.innerHTML = `
        <div style="flex:1;overflow:hidden;">
          <div class="project-item-name">${escapeHtml(p.name)}</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">${date} • ${fileCount} files</div>
        </div>
        <div class="project-item-actions">
          <button class="project-action-btn" data-a="rename" data-id="${p.id}" title="Rename">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button class="project-action-btn danger" data-a="delete" data-id="${p.id}" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>`;
      item.addEventListener('click', async (e) => {
        if (e.target.closest('.project-action-btn')) return;
        const pp = await Storage.getProject(p.id); if (pp) await loadProject(pp);
      });
      list.appendChild(item);
    });
    list.querySelectorAll('.project-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (btn.dataset.a === 'rename') renameProject(btn.dataset.id);
        if (btn.dataset.a === 'delete') deleteProject(btn.dataset.id);
      });
    });
  }

  /* ================= Drawer ================= */
  function openDrawer()  { document.getElementById('sideDrawer').classList.add('open'); document.body.style.overflow='hidden'; }
  function closeDrawer() { document.getElementById('sideDrawer').classList.remove('open'); document.body.style.overflow=''; }

  /* ================= Download menu ================= */
  function closeDownload() { downloadOpen = false; document.getElementById('downloadMenu')?.classList.add('hidden'); }

  function buildDownloadMenu() {
    const menu = document.getElementById('downloadMenu'); if (!menu) return;
    menu.innerHTML = '';
    const files = Editor.getAllFiles();
    Object.keys(files).sort().forEach(path => {
      const btn = document.createElement('button');
      btn.className = 'download-menu-item';
      btn.innerHTML = `<span class="dm-dot" style="background:${dotColorFor(path)}"></span>${escapeHtml(path)}`;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        Zip.downloadFile(files[path], path.split('/').pop());
        closeDownload();
      });
      menu.appendChild(btn);
    });
    // Divider + "Download ZIP"
    const div = document.createElement('div');
    div.style.cssText = 'border-top:1px solid var(--bg-border);margin:4px 0;';
    menu.appendChild(div);
    const zipBtn = document.createElement('button');
    zipBtn.className = 'download-menu-item';
    zipBtn.innerHTML = `<span class="dm-dot" style="background:#10b981"></span><b>Download entire project (.zip)</b>`;
    zipBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      // Sync latest files
      currentProject.files = Editor.getAllFiles();
      await Zip.exportProject(currentProject);
      closeDownload();
    });
    menu.appendChild(zipBtn);
  }

  function dotColorFor(path) {
    const e = (path.split('.').pop() || '').toLowerCase();
    return ({ html:'#e44d26', htm:'#e44d26', css:'#264de4', js:'#f0db4f', mjs:'#f0db4f',
              json:'#8e44ad', svg:'#f97316', md:'#0ea5e9' })[e] || '#10b981';
  }

  /* ================= Upload modal ================= */
  async function showUploadModal(initialFiles) {
    pendingUploadFiles = [];
    return new Promise((resolve) => {
      modalResolve = resolve;
      document.getElementById('modalTitle').textContent = 'Upload Files';
      document.getElementById('modalConfirm').textContent = 'Import';
      document.getElementById('modalBody').innerHTML = `
        <div class="upload-drop-zone" id="uploadDropZone">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            <polyline points="17,8 12,3 7,8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            <line x1="12" y1="3" x2="12" y2="15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <p><strong>Drop files here</strong> or click to browse</p>
          <span>Any text file. ZIPs are extracted into the project.</span>
        </div>
        <div class="upload-file-list" id="uploadFileList"></div>
        <p id="uploadHint" style="font-size:11px;color:var(--text-muted);text-align:center;display:none;padding-top:4px;">
          Files are added to the project. Duplicate paths will be overwritten.
        </p>`;
      document.getElementById('modalOverlay').classList.remove('hidden');

      const picker = document.createElement('input');
      picker.type = 'file'; picker.multiple = true; picker.style.display = 'none';
      document.body.appendChild(picker);

      const dz = document.getElementById('uploadDropZone');
      dz.addEventListener('click', () => picker.click());
      picker.addEventListener('change', async (e) => { await addFilesToQueue(Array.from(e.target.files)); picker.remove(); });
      dz.addEventListener('dragover',  (e) => { e.preventDefault(); dz.classList.add('drag-active'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('drag-active'));
      dz.addEventListener('drop', async (e) => {
        e.preventDefault(); dz.classList.remove('drag-active');
        await addFilesToQueue(Array.from(e.dataTransfer.files));
      });

      if (initialFiles?.length) addFilesToQueue(initialFiles);
    });
  }

  async function addFilesToQueue(files) {
    for (const file of files) {
      if (pendingUploadFiles.find(f => f.file.name === file.name)) continue;
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      if (ext === 'zip') {
        pendingUploadFiles.push({ file, type:'zip', name:file.name, content:'' });
        continue;
      }
      const content = await readAsText(file);
      pendingUploadFiles.push({ file, type:ext, name:file.name, content });
    }
    renderUploadList();
  }

  function renderUploadList() {
    const list = document.getElementById('uploadFileList');
    const hint = document.getElementById('uploadHint');
    if (!list) return;
    list.innerHTML = '';
    if (!pendingUploadFiles.length) { if (hint) hint.style.display='none'; return; }
    if (hint) hint.style.display='block';
    pendingUploadFiles.forEach((item, idx) => {
      const lines = item.content ? item.content.split('\n').length : '—';
      const el = document.createElement('div');
      el.className = 'upload-file-item';
      el.innerHTML = `
        <span class="ufi-dot" style="background:${dotColorFor(item.name)};border-radius:50%;"></span>
        <span class="ufi-name">${escapeHtml(item.name)}</span>
        <span class="ufi-type">${item.type.toUpperCase()} · ${item.type==='zip'?'archive':(lines+' ln')}</span>
        <button class="ufi-remove" data-idx="${idx}">✕</button>`;
      list.appendChild(el);
    });
    list.querySelectorAll('.ufi-remove').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); pendingUploadFiles.splice(Number(btn.dataset.idx),1); renderUploadList(); });
    });
  }

  function readAsText(file) {
    return new Promise((res) => { const r = new FileReader(); r.onload = e => res(e.target.result); r.onerror = () => res(''); r.readAsText(file); });
  }

  async function applyUploadedFiles() {
    for (const item of pendingUploadFiles) {
      if (item.type === 'zip') {
        const data = await Zip.importProject(item.file);
        if (data) {
          Object.entries(data.files).forEach(([p,c]) => { currentProject.files[p] = c; });
        }
      } else {
        // Add/overwrite as a top-level file with its original name (path)
        currentProject.files[item.name] = item.content;
      }
    }
    // Refresh editor with new files, keep current open tabs & add newly uploaded ones
    const newlyUploaded = pendingUploadFiles.map(i => i.type === 'zip' ? null : i.name).filter(Boolean);
    const layout = Editor.getLayout();
    currentProject.openTabs = Array.from(new Set([...(layout.openTabs || []), ...newlyUploaded]));
    currentProject.activeTab = newlyUploaded[newlyUploaded.length - 1] || layout.activeTab;
    await Storage.saveProject(currentProject);

    Editor.setAll(currentProject);
    await Preview.setProject(currentProject);
    pendingUploadFiles = [];
  }

  /* ================= Dropped files handler ================= */
  async function handleDroppedFiles(files) {
    await showUploadModal(files);
  }

  /* ================= Mobile view ================= */
  function setMobileView(view) {
    mobileView = view;
    const ws = document.getElementById('workspace');
    ws.className = ws.className.split(' ').filter(c => !c.startsWith('mobile-')).join(' ');
    ws.classList.add('mobile-' + view);
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    if (view === 'console') Preview.openConsole();
    if (view === 'editor')  setTimeout(() => Editor.refreshAll(), 50);
  }

  /* ================= Resize handle ================= */
  function setupResizeHandle() {
    const handle = document.getElementById('resizeHandle');
    const editor = document.getElementById('editorPanel');
    const ws     = document.getElementById('workspace');
    if (!handle || !editor) return;
    handle.addEventListener('mousedown', (e) => {
      resizing = true; handle.classList.add('dragging');
      document.body.style.cursor = 'col-resize'; document.body.style.userSelect='none';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!resizing) return;
      const r = ws.getBoundingClientRect();
      const w = Math.max(280, Math.min(e.clientX - r.left, r.width - 280));
      editor.style.width = w + 'px';
      Editor.refreshAll();
    });
    document.addEventListener('mouseup', () => {
      if (!resizing) return;
      resizing = false; handle.classList.remove('dragging');
      document.body.style.cursor = ''; document.body.style.userSelect = '';
    });
  }

  /* ================= Modals ================= */
  function showInputModal(title, label, def) {
    return new Promise((resolve) => {
      modalResolve = resolve;
      document.getElementById('modalTitle').textContent = title;
      document.getElementById('modalBody').innerHTML = `
        <label style="display:block;margin-bottom:8px;font-size:13px;color:var(--text-secondary);">${escapeHtml(label)}</label>
        <input class="modal-input" id="modalInput" type="text" value="${escapeHtml(def)}" />`;
      document.getElementById('modalConfirm').textContent = 'OK';
      document.getElementById('modalOverlay').classList.remove('hidden');
      setTimeout(() => { const i = document.getElementById('modalInput'); if (i) { i.focus(); i.select(); } }, 50);
      document.getElementById('modalInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') confirmModal();
        if (e.key === 'Escape') cancelModal();
      });
    });
  }
  function showConfirmModal(title, msg) {
    return new Promise((resolve) => {
      modalResolve = resolve;
      document.getElementById('modalTitle').textContent = title;
      document.getElementById('modalBody').innerHTML = `<p style="font-size:14px;color:var(--text-secondary);line-height:1.6;">${escapeHtml(msg)}</p>`;
      document.getElementById('modalConfirm').textContent = 'Confirm';
      document.getElementById('modalOverlay').classList.remove('hidden');
    });
  }
  async function confirmModal() {
    if (document.getElementById('uploadDropZone')) {
      await applyUploadedFiles();
      closeModal(); if (modalResolve) { modalResolve(true); modalResolve=null; } return;
    }
    const input = document.getElementById('modalInput');
    const val = input ? input.value.trim() : true;
    closeModal();
    if (modalResolve) { modalResolve(val || true); modalResolve = null; }
  }
  function cancelModal() { pendingUploadFiles = []; closeModal(); if (modalResolve) { modalResolve(null); modalResolve = null; } }
  function closeModal() { document.getElementById('modalOverlay').classList.add('hidden'); document.getElementById('modalBody').innerHTML = ''; }

  /* ================= Wire up UI ================= */
  function setupEventListeners() {
    // Header
    document.getElementById('menuBtn')?.addEventListener('click', openDrawer);
    document.getElementById('themeBtn')?.addEventListener('click', () => applyTheme(!isDark));
    document.getElementById('openPreviewBtn')?.addEventListener('click', () => Preview.openInNewTab());

    // Drawer
    document.getElementById('closeDrawer')?.addEventListener('click', closeDrawer);
    document.getElementById('drawerOverlay')?.addEventListener('click', closeDrawer);
    document.getElementById('newProjectBtn')?.addEventListener('click', createNewProject);
    document.getElementById('exportZipBtn')?.addEventListener('click', async () => {
      if (!currentProject) return;
      currentProject.files = Editor.getAllFiles();
      await Zip.exportProject(currentProject);
      closeDrawer();
    });
    document.getElementById('importZipBtn')?.addEventListener('click', () => document.getElementById('zipImportInput').click());
    document.getElementById('zipImportInput')?.addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (f) await handleDroppedFiles([f]);
      e.target.value = ''; closeDrawer();
    });
    document.getElementById('uploadFileBtn')?.addEventListener('click', async () => { closeDrawer(); await showUploadModal([]); });

    // Editor toolbar
    document.getElementById('tbUndo')?.addEventListener('click', () => Editor.undo());
    document.getElementById('tbRedo')?.addEventListener('click', () => Editor.redo());
    document.getElementById('tbSelectAll')?.addEventListener('click', () => Editor.selectAll());
    document.getElementById('tbUpload')?.addEventListener('click', async () => await showUploadModal([]));
    document.getElementById('tbRename')?.addEventListener('click', () => {
      const p = Editor.getActivePath(); if (p) Editor.promptRename(p);
    });
    document.getElementById('tbFind')?.addEventListener('click', () => Editor.openFindReplace(true));

    // Download menu
    document.getElementById('tbDownload')?.addEventListener('click', (e) => {
      e.stopPropagation();
      buildDownloadMenu();
      downloadOpen = !downloadOpen;
      document.getElementById('downloadMenu')?.classList.toggle('hidden', !downloadOpen);
    });
    document.addEventListener('click', (e) => { if (downloadOpen && !e.target.closest('.toolbar-download-wrap')) closeDownload(); });

    // Mobile nav
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.view;
        if (v === 'projects') openDrawer();
        else setMobileView(v);
      });
    });

    // Modals
    document.getElementById('modalConfirm')?.addEventListener('click', confirmModal);
    document.getElementById('modalCancel')?.addEventListener('click', cancelModal);
    document.getElementById('modalClose')?.addEventListener('click', cancelModal);
    document.getElementById('modalOverlay')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) cancelModal(); });

    setupResizeHandle();

    // Global keys
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeDrawer(); cancelModal(); closeDownload(); Editor.closeFindReplace(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'h') && !e.target.matches('.fr-input, .CodeMirror *, input, textarea')) {
        e.preventDefault(); Editor.openFindReplace(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'r' && !e.target.matches('input, textarea, .CodeMirror *')) {
        e.preventDefault(); Preview.reload();
      }
    });

    // Project name click → rename
    document.getElementById('projectName')?.addEventListener('click', async () => {
      if (!currentProject) return;
      const nn = await showInputModal('Rename project', 'Project name:', currentProject.name);
      if (nn && nn !== currentProject.name) {
        currentProject.name = nn; await Storage.saveProject(currentProject);
        updateProjectNameDisplay(); await renderProjectList();
      }
    });

    // Responsive
    window.matchMedia('(max-width: 768px)').addEventListener('change', (e) => {
      if (!e.matches) document.getElementById('workspace').className = '';
      else setMobileView(mobileView);
    });
  }

  /* ================= Utility ================= */
  function escapeHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  function toast(msg) {
    const t = document.createElement('div'); t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;padding:8px 18px;border-radius:8px;font-size:13px;font-weight:600;z-index:9000;box-shadow:0 4px 16px rgba(0,0,0,.2);pointer-events:none;transition:opacity .3s;';
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity='0'; setTimeout(() => t.remove(), 350); }, 1600);
  }

  init().catch(err => {
    console.error('[AntLab v2] init failed:', err);
    setSplashStatus('Error: ' + err.message);
  });
})();
