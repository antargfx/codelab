/**
 * app.js - AntLab IDE
 * Main application controller.
 * Features: light theme default, editor toolbar (undo/redo/select-all),
 * multi-file upload modal, individual file download dropdown.
 */

(async () => {
  /* =============================================
     STATE
     ============================================= */
  let currentProject  = null;
  let isDark          = false;   // Default: LIGHT theme
  let isMobileView    = 'editor';
  let resizing        = false;
  let modalResolve    = null;
  let downloadMenuOpen = false;
  let pendingUploadFiles = [];   // [{ file, type, content, name }]

  /* =============================================
     SPLASH
     ============================================= */
  function hideSplash() {
    const splash = document.getElementById('splash');
    const app    = document.getElementById('app');
    setTimeout(() => {
      splash.classList.add('fade-out');
      app.classList.remove('hidden');
      setTimeout(() => { splash.style.display = 'none'; }, 500);
    }, 1600);
  }

  /* =============================================
     INIT
     ============================================= */
  async function init() {
    await Storage.init();
    currentProject = await Storage.getOrCreateCurrentProject();

    Editor.init(onEditorChange, onEditorSave);
    Editor.loadFiles(currentProject.files);

    // Preview.init() sets up the service-worker virtual server (async).
    await Preview.init();
    window._currentVFS = Editor.getVirtualFiles();

    Preview.render(window._currentVFS, true, { navigateHome: true });

    // Initialize Inspector — write DOM edits back to the currently previewed page.
    Inspector.init((updatedHtml) => {
      if (!currentProject) return;
      const page = (window.Preview && Preview.getCurrentPageName) ? Preview.getCurrentPageName() : 'index.html';
      Editor.setValueByName(page, updatedHtml);
      currentProject.files = Editor.getVirtualFiles();
      Storage.saveProject(currentProject);
    });

    updateProjectNameDisplay();

    // Force light theme by default
    isDark = false;
    applyTheme(false);

    setupEventListeners();
    Zip.setupDragDrop(document.getElementById('app'), handleDroppedFiles);
    setMobileView('editor');
    await renderProjectList();
    hideSplash();
  }

  /* =============================================
     EDITOR CALLBACKS
     ============================================= */
  function onEditorChange(files) {
    // files = [{name, type, content}]
    window._currentVFS = files;
    Preview.render(files, false);
    setTimeout(() => Inspector.onPreviewRendered(), 800);
  }

  async function onEditorSave(files) {
    if (!currentProject) return;
    currentProject.files = files;
    await Storage.saveProject(currentProject);
  }

  /* =============================================
     PROJECT NAME
     ============================================= */
  function updateProjectNameDisplay() {
    const el = document.getElementById('projectName');
    if (el && currentProject) el.textContent = currentProject.name;
  }

  /* =============================================
     THEME
     ============================================= */
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

  /* =============================================
     PROJECT MANAGEMENT
     ============================================= */
  async function loadProject(project) {
    currentProject = project;
    await Storage.setCurrentProjectId(project.id);
    Editor.loadFiles(project.files);
    window._currentVFS = Editor.getVirtualFiles();

    Preview.render(window._currentVFS, true, { navigateHome: true });
    updateProjectNameDisplay();
    closeDrawer();
  }

  async function createNewProject() {
    const name = await showInputModal('New Project', 'Project name:', 'my-project');
    if (name === null) return;
    const project = Storage.createProject(name || 'untitled');
    await Storage.saveProject(project);
    await loadProject(project);
    await renderProjectList();
  }

  async function renameProject(id) {
    const project = await Storage.getProject(id);
    if (!project) return;
    const name = await showInputModal('Rename Project', 'New name:', project.name);
    if (name === null || name === project.name) return;
    project.name = name || project.name;
    await Storage.saveProject(project);
    if (currentProject && currentProject.id === id) {
      currentProject.name = project.name;
      updateProjectNameDisplay();
    }
    await renderProjectList();
  }

  async function deleteProject(id) {
    const ok = await showConfirmModal('Delete Project', 'This cannot be undone. Delete this project?');
    if (!ok) return;
    await Storage.deleteProject(id);
    if (currentProject && currentProject.id === id) {
      const all = await Storage.getAllProjects();
      if (all.length > 0) { await loadProject(all[0]); }
      else { const f = Storage.createProject('untitled'); await Storage.saveProject(f); await loadProject(f); }
    }
    await renderProjectList();
  }

  /* =============================================
     PROJECT LIST UI
     ============================================= */
  async function renderProjectList() {
    const list = document.getElementById('projectList');
    if (!list) return;
    const projects = await Storage.getAllProjects();
    list.innerHTML = '';
    if (projects.length === 0) {
      list.innerHTML = '<p style="padding:12px 16px;font-size:12px;color:var(--text-muted)">No projects yet.</p>';
      return;
    }
    projects.forEach((project) => {
      const isActive = currentProject && currentProject.id === project.id;
      const item = document.createElement('div');
      item.className = 'project-item' + (isActive ? ' active' : '');
      const dateStr = new Date(project.updatedAt).toLocaleDateString(undefined, { month:'short', day:'numeric' });
      item.innerHTML = `
        <div style="flex:1;overflow:hidden;">
          <div class="project-item-name">${escapeHtml(project.name)}</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">${dateStr}</div>
        </div>
        <div class="project-item-actions">
          <button class="project-action-btn" data-action="rename" data-id="${project.id}" title="Rename">

<svg id="Layer_1" data-name="Layer 1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><style>.cls-1{fill:#fdab02;}.cls-2{fill:#fdbe03;}.cls-3{fill:#fc5a68;}.cls-4{fill:#f5d3a6;}.cls-5{fill:#bcbcbc;}.cls-6{fill:#dbdbdb;}</style></defs><path class="cls-1" d="M17.78,10.09a3.44,3.44,0,0,1-.41.44c-1.57,1.56-3.14,3.23-7.51,7.52L8.1,19.77l0,0a1.68,1.68,0,0,1-.37-.45,1,1,0,0,1-.06-.53,2.32,2.32,0,0,1-1.77-1.88h0c.41-.37.77-.78,1.16-1.17l.6-.61c1.34-1.37,2.71-2.7,4-4.07,1.15-1.18,2.32-2.34,3.49-3.5l.05,0L16.61,9Z"/><path class="cls-2" d="M15.17,7.51C14,8.67,12.83,9.83,11.68,11c-1.33,1.37-2.7,2.7-4,4.07l-.6.61c-.39.39-.75.8-1.16,1.17H5.56a1.78,1.78,0,0,1-.89-.49,2.11,2.11,0,0,1-.4-.55l0-.05,0,0L9.92,10l3.72-3.75c.06,0,.1-.13.17-.16a3.59,3.59,0,0,0,.38.4Z"/><path class="cls-3" d="M15.83,4.12a1.63,1.63,0,0,1,.3-.34c.33-.33.63-.69,1-1a1.51,1.51,0,0,1,1.93,0c.43.39.83.82,1.25,1.23.22.22.45.43.66.66a1.56,1.56,0,0,1,.16,2,5.58,5.58,0,0,1-.71.75c-.16.18-.34.35-.52.53,0,0-.06.09-.12.06s0-.05-.05-.06L18.47,6.75,16.64,4.91C16.37,4.64,16.12,4.36,15.83,4.12Z"/><path class="cls-4" d="M4.42,16.06a1.81,1.81,0,0,0,.25.31,1.76,1.76,0,0,0,.89.49h.29a2.32,2.32,0,0,0,1.77,1.88,1.48,1.48,0,0,0,.21.69,1,1,0,0,0,.27.33c-.85.32-1.72.63-2.62.93L4.69,21,4,20.28c-.29-.3-.58-.6-.89-.87.09-.32.17-.63.28-.94s.2-.67.54-1.73l.31-1A2.12,2.12,0,0,0,4.42,16.06Z"/><path class="cls-5" d="M15.17,7.51l-1-1a3.59,3.59,0,0,1-.38-.4s0-.07.08-.1c.28-.28.56-.57.85-.85,0,0,.06-.08.12-.08s0,.09.08.12l.38.37L18.69,9s.06.08.12.08a.09.09,0,0,1,0,.08l-.91.92-.07,0L16.61,9l-1.39-1.4Z"/><path class="cls-6" d="M18.81,9.05c-.06,0-.08,0-.12-.08L15.32,5.59l-.38-.37s-.08-.06-.08-.12a.15.15,0,0,1,0-.09l.87-.86s0,0,.06,0c.29.24.54.52.81.79l1.83,1.84L19.72,8s0,0,.05.06-.19.26-.3.36a6.57,6.57,0,0,0-.59.59A.08.08,0,0,1,18.81,9.05Z"/><path class="cls-3" d="M3.11,19.41c.31.27.6.57.89.87l.69.68a.55.55,0,0,1-.28.12l-1.22.43a.42.42,0,0,1-.47-.08A.41.41,0,0,1,2.61,21c.15-.48.3-1,.44-1.44C3.07,19.5,3.07,19.44,3.11,19.41Z"/></svg>


</button>
          <button class="project-action-btn danger" data-action="delete" data-id="${project.id}" title="Delete">

<svg id="Layer_4" data-name="Layer 4" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="32" height="32" viewBox="0 0 24 24"><defs><style>.recycle-cls-1{fill:#b9e4ea;}.recycle-cls-2{fill:#94d1e0;}.recycle-cls-3{fill:url(#linear-gradient);}.recycle-cls-4{fill:url(#radial-gradient);}.recycle-cls-5{fill:#84b0c1;}.recycle-cls-6{fill:#a8e3f0;}</style><linearGradient id="linear-gradient" x1="12.02" y1="7.34" x2="12.02" y2="-3" gradientTransform="matrix(1, 0, 0, -1, 0, 24)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#82afc1"/><stop offset="1" stop-color="#2f7889"/></linearGradient><radialGradient id="radial-gradient" cx="12.27" cy="33.53" r="9.38" gradientTransform="matrix(1, 0, 0, -0.45, 0, 17.95)" gradientUnits="userSpaceOnUse"><stop offset="0.72" stop-color="#94d1e0"/><stop offset="1" stop-color="#94d1e0" stop-opacity="0"/></radialGradient></defs><ellipse class="cls-1" cx="11.99" cy="19.34" rx="6.28" ry="2.44"/><path class="cls-2" d="M5.9,20.29C5.9,19,8.62,18.13,12,18.13s6.09.88,6.09,2.16S15.35,22.71,12,22.71,5.9,21.57,5.9,20.29Z"/><path class="cls-3" d="M20,6.41l-.41,2.21L18.39,7.43,19,6.82l-1.75.51.11.1L15.92,8.89,14.74,7.71,13,7.86l-1,1L10.88,7.77,9.27,7.68,8.07,8.89,6.61,7.43l.15-.14L5.08,6.93l.51.5L4.44,8.58,4,6.37,3.22,5.9l2.6,14.42C6,21.69,8.64,22.76,12,22.76s5.93-1.07,6.19-2.44L20.82,5.89ZM15.6,20.35l-1.13-1.14,1.45-1.45,1.45,1.45h0l-.85.85C16.23,20.17,15.92,20.26,15.6,20.35Zm-8-.19-.94-.95h0l1.45-1.45,1.45,1.45L8.35,20.38C8.07,20.31,7.8,20.24,7.55,20.16Zm5.89-.94L12,20.67l-1.45-1.45L12,17.76Zm-.94-2L14,15.8l1.46,1.45L14,18.7ZM10,18.7,8.57,17.25,10,15.8l1.46,1.45Zm0,1,1.1,1.1a17.74,17.74,0,0,1-1.94-.26Zm2.83,1.1,1.1-1.1.83.82A15.47,15.47,0,0,1,12.85,20.83Zm4.9-2.25-1.32-1.33,1.45-1.45.32.32Zm.83-4.5-.7.69-1.45-1.45,1.45-1.45.93.93Zm-1.21,1.21-1.45,1.45-1.45-1.45,1.45-1.45ZM14,14.78,12.5,13.32,14,11.87l1.45,1.45Zm-.51.51L12,16.74l-1.45-1.45L12,13.84ZM10,14.78,8.57,13.32,10,11.87l1.46,1.45Zm-.51.51L8.06,16.74,6.61,15.29l1.45-1.45ZM6.1,14.78l-.67-.67-.24-1.33.91-.91,1.45,1.46Zm0,1,1.45,1.45L6.23,18.57l-.44-2.46ZM19,11.94l-.58-.58.84-.84ZM17.88,8,19.33,9.4l-1.45,1.45L16.43,9.4Zm-2,2,1.45,1.45-1.45,1.45-1.45-1.45ZM14,8,15.4,9.4,14,10.85,12.5,9.4Zm-.51,3.41L12,12.81l-1.45-1.45L12,9.91ZM10,8,11.48,9.4,10,10.85,8.57,9.4Zm-.51,3.41L8.06,12.81,6.61,11.36,8.06,9.91ZM6.1,8,7.55,9.4,6.1,10.85,4.65,9.4Zm-.52,3.41L5,11.91l-.25-1.34Z"/><path class="cls-4" d="M19.8,4.91,18.35,3.46l.41-.41a2.59,2.59,0,0,0-.69-.33L17.84,3l-.37-.37a3.56,3.56,0,0,0-1.27-.24l1.13,1.12L15.88,4.92,14.43,3.46l1.19-1.19a3.08,3.08,0,0,0-.91-.12l-.8.8L13,2l-1,0L13.4,3.46,12,4.92,10.49,3.46l1.42-1.41-1.07,0L10,3,9.13,2.1l-.9.12L9.47,3.46,8,4.92,6.57,3.46,7.7,2.33a7.55,7.55,0,0,0-1.3.28L6.06,3l-.22-.21A2,2,0,0,0,5.11,3l.43.43-1.3,1.3a.94.94,0,0,0,.51.52L6.06,4,7.51,5.43l-.76.75a1.38,1.38,0,0,0,.85.18L8,5.94,9.07,7l1.77,0L12,5.94,13,7,14.87,7l1-1,.44.45a1.66,1.66,0,0,0,.87-.16l-.8-.8L17.84,4l1.45,1.45S19.74,5.16,19.8,4.91ZM10,6.88,8.53,5.43,10,4l1.45,1.45Zm3.92,0L12.46,5.43,13.91,4l1.45,1.45Z"/><path class="cls-5" d="M12,1.24c-5.35,0-9.69,1.05-9.69,3.36C2.31,6.43,6.65,8,12,8s9.69-1.53,9.69-3.36C21.69,2.54,17.35,1.24,12,1.24Zm0,5.44c-4.31,0-7.8-1.07-7.8-2.39s3.49-2.1,7.8-2.1,7.8.77,7.8,2.1S16.31,6.68,12,6.68Z"/><path class="cls-6" d="M19.8,3.34c.37.3.7.8.3,1.26s-.25.5,0,.45a1.06,1.06,0,0,0,.83-1.29C20.66,3,19.37,2.5,18.51,2.32c-.24,0-.63-.1-.7,0A15.78,15.78,0,0,1,19.8,3.34Z"/><path class="cls-6" d="M7.2,6.85c-.83-.09-2.88-.3-4-1.74a1.35,1.35,0,0,1,.08-1.75c.77-.77,1.79-.79,1.56-.65-.62.38-1.85,1-.82,2.21S7.68,6.51,8.1,6.57,8.55,7,7.2,6.85Z"/></svg>

</button>
        </div>`;
      item.addEventListener('click', async (e) => {
        if (e.target.closest('.project-action-btn')) return;
        const p = await Storage.getProject(project.id);
        if (p) await loadProject(p);
      });
      list.appendChild(item);
    });
    list.querySelectorAll('.project-action-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (btn.dataset.action === 'rename') renameProject(btn.dataset.id);
        if (btn.dataset.action === 'delete') deleteProject(btn.dataset.id);
      });
    });
  }

  /* =============================================
     DRAWER
     ============================================= */
  function openDrawer()  { document.getElementById('sideDrawer').classList.add('open'); document.body.style.overflow='hidden'; }
  function closeDrawer() { document.getElementById('sideDrawer').classList.remove('open'); document.body.style.overflow=''; }

  /* =============================================
     DOWNLOAD MENU — individual file download
     ============================================= */
  function closeDownloadMenu() {
    downloadMenuOpen = false;
    document.getElementById('downloadMenu')?.classList.add('hidden');
  }

  function downloadFile(type) {
    const vals = Editor.getAll();
    const map  = {
      html: { name: 'index.html', content: vals.html },
      css:  { name: 'style.css',  content: vals.css  },
      js:   { name: 'script.js',  content: vals.js   },
    };
    const { name, content } = map[type];
    Zip.downloadFile(content, name);
    closeDownloadMenu();
  }

  /* =============================================
     MULTI-FILE UPLOAD MODAL
     ============================================= */
  async function showUploadModal(initialFiles) {
    pendingUploadFiles = [];

    return new Promise((resolve) => {
      modalResolve = resolve;
      document.getElementById('modalTitle').textContent = 'Upload Files';
      document.getElementById('modalConfirm').textContent = 'Import Files';
      document.getElementById('modalBody').innerHTML = `
        <div class="upload-drop-zone" id="uploadDropZone">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            <polyline points="17,8 12,3 7,8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            <line x1="12" y1="3" x2="12" y2="15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <p><strong>Drop files here</strong> or click to browse</p>
          <span>Supports .html, .css, .js, .zip &mdash; multiple files OK</span>
        </div>
        <div class="upload-file-list" id="uploadFileList"></div>
        <p id="uploadHint" style="font-size:11px;color:var(--text-muted);text-align:center;display:none;padding-top:4px;">
          Each file will replace the matching tab in your project.
        </p>`;

      document.getElementById('modalOverlay').classList.remove('hidden');

      // File picker
      const picker = document.createElement('input');
      picker.type = 'file'; picker.accept = '.html,.css,.js,.zip'; picker.multiple = true;
      picker.style.display = 'none';
      document.body.appendChild(picker);

      const dropZone = document.getElementById('uploadDropZone');
      dropZone.addEventListener('click', () => picker.click());
      picker.addEventListener('change', async (e) => {
        await addFilesToQueue(Array.from(e.target.files));
        picker.remove();
      });

      // Drag-drop inside modal
      dropZone.addEventListener('dragover',  (e) => { e.preventDefault(); dropZone.classList.add('drag-active'); });
      dropZone.addEventListener('dragleave', ()  => dropZone.classList.remove('drag-active'));
      dropZone.addEventListener('drop', async (e) => {
        e.preventDefault(); dropZone.classList.remove('drag-active');
        await addFilesToQueue(Array.from(e.dataTransfer.files));
      });

      if (initialFiles && initialFiles.length > 0) addFilesToQueue(initialFiles);
    });
  }

  async function addFilesToQueue(files) {
    for (const file of files) {
      const ext = file.name.split('.').pop().toLowerCase();
      if (!['html','htm','css','js','zip'].includes(ext)) continue;
      if (pendingUploadFiles.find((f) => f.file.name === file.name)) continue;
      const content = await readFileText(file);
      const type    = ext === 'htm' ? 'html' : ext;
      pendingUploadFiles.push({ file, type, content, name: file.name });
    }
    renderUploadFileList();
  }

  function renderUploadFileList() {
    const list = document.getElementById('uploadFileList');
    const hint = document.getElementById('uploadHint');
    if (!list) return;
    list.innerHTML = '';
    if (pendingUploadFiles.length === 0) { if (hint) hint.style.display = 'none'; return; }
    if (hint) hint.style.display = 'block';
    const dotColors = { html:'#e44d26', css:'#264de4', js:'#f0db4f', zip:'#10b981' };
    pendingUploadFiles.forEach((item, idx) => {
      const lines = item.content ? item.content.split('\n').length : '—';
      const el = document.createElement('div');
      el.className = 'upload-file-item';
      el.innerHTML = `
        <span class="ufi-dot" style="background:${dotColors[item.type]||'#888'};${item.type==='js'?'outline:1px solid #ccc;':''};border-radius:50%;"></span>
        <span class="ufi-name">${escapeHtml(item.name)}</span>
        <span class="ufi-type">${item.type.toUpperCase()} &middot; ${lines} ln</span>
        <button class="ufi-remove" data-idx="${idx}" title="Remove">✕</button>`;
      list.appendChild(el);
    });
    list.querySelectorAll('.ufi-remove').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        pendingUploadFiles.splice(Number(btn.dataset.idx), 1);
        renderUploadFileList();
      });
    });
  }

  function readFileText(file) {
    return new Promise((res) => {
      const r = new FileReader();
      r.onload  = (e) => res(e.target.result);
      r.onerror = () => res('');
      r.readAsText(file);
    });
  }

  async function applyUploadedFiles() {
    for (const item of pendingUploadFiles) {
      if (item.type === 'zip') {
        const data = await Zip.importProject(item.file);
        if (data && Array.isArray(data.files)) {
          // Merge zip files into the current project (add each as its own tab)
          data.files.forEach((f) => Editor.addFile(f.name, f.type, f.content, false));
        }
      } else {
        // Every uploaded file (html/css/js/json/…) gets its own tab
        Editor.addFile(item.name, item.type, item.content, true);
      }
    }

    // Sync editor state back to the project
    const vfs = Editor.getVirtualFiles();
    currentProject.files = vfs;
    await Storage.saveProject(currentProject);
    window._currentVFS = vfs;
    Preview.render(vfs, true, { navigateHome: true });
    pendingUploadFiles = [];
  }

  /* =============================================
     DROPPED FILES (app-level drag-and-drop)
     ============================================= */
  async function handleDroppedFiles(files) {
    const zips    = files.filter((f) =>  /\.zip$/i.test(f.name));
    const nonZips = files.filter((f) => !/\.zip$/i.test(f.name));

    if (nonZips.length > 0) await showUploadModal(nonZips);

    for (const file of zips) {
      const data = await Zip.importProject(file);
      if (!data) continue;
      const ok = await showConfirmModal('Import ZIP', `Replace current project with "${data.name}"?`);
      if (!ok) continue;
      currentProject.name  = data.name;
      currentProject.files = (Array.isArray(data.files) && data.files.length)
        ? data.files
        : currentProject.files;
      await Storage.saveProject(currentProject);
      Editor.loadFiles(currentProject.files);
      window._currentVFS = Editor.getVirtualFiles();
      Preview.render(window._currentVFS, true, { navigateHome: true });
      updateProjectNameDisplay();
      await renderProjectList();
    }
  }

  /* =============================================
     MOBILE NAVIGATION
     ============================================= */
  function setMobileView(view) {
    isMobileView = view;
    const ws = document.getElementById('workspace');
    ws.className = ws.className.split(' ').filter((c) => !c.startsWith('mobile-')).join(' ');
    ws.classList.add('mobile-' + view);
    document.querySelectorAll('.nav-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.view === view));
    if (view === 'console') Preview.openConsole();
    if (view === 'editor')  setTimeout(() => Editor.refreshAll(), 50);
  }

  /* =============================================
     RESIZE HANDLE
     ============================================= */
  function setupResizeHandle() {
    const handle = document.getElementById('resizeHandle');
    const editor = document.getElementById('editorPanel');
    const ws     = document.getElementById('workspace');
    if (!handle || !editor) return;

    handle.addEventListener('mousedown', (e) => {
      resizing = true;
      handle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
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
      resizing = false;
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    });
  }

  /* =============================================
     MODALS
     ============================================= */
  function showInputModal(title, label, placeholder) {
    return new Promise((resolve) => {
      modalResolve = resolve;
      document.getElementById('modalTitle').textContent = title;
      document.getElementById('modalBody').innerHTML = `
        <label style="display:block;margin-bottom:8px;font-size:13px;color:var(--text-secondary);">${escapeHtml(label)}</label>
        <input class="modal-input" id="modalInput" type="text" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(placeholder)}" />`;
      document.getElementById('modalConfirm').textContent = 'Create';
      document.getElementById('modalOverlay').classList.remove('hidden');
      setTimeout(() => { const i = document.getElementById('modalInput'); if (i) { i.focus(); i.select(); } }, 50);
      document.getElementById('modalInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') confirmModal();
        if (e.key === 'Escape') cancelModal();
      });
    });
  }

  function showConfirmModal(title, message) {
    return new Promise((resolve) => {
      modalResolve = resolve;
      document.getElementById('modalTitle').textContent = title;
      document.getElementById('modalBody').innerHTML = `<p style="font-size:14px;color:var(--text-secondary);line-height:1.6;">${escapeHtml(message)}</p>`;
      document.getElementById('modalConfirm').textContent = 'Confirm';
      document.getElementById('modalOverlay').classList.remove('hidden');
    });
  }

  async function confirmModal() {
    // If upload modal is showing, apply files
    if (document.getElementById('uploadDropZone')) {
      await applyUploadedFiles();
      closeModal();
      if (modalResolve) { modalResolve(true); modalResolve = null; }
      return;
    }
    const input = document.getElementById('modalInput');
    const value = input ? input.value.trim() : true;
    closeModal();
    if (modalResolve) { modalResolve(value || true); modalResolve = null; }
  }

  function cancelModal() {
    pendingUploadFiles = [];
    closeModal();
    if (modalResolve) { modalResolve(null); modalResolve = null; }
  }

  function closeModal() {
    document.getElementById('modalOverlay').classList.add('hidden');
    document.getElementById('modalBody').innerHTML = '';
  }

  /* =============================================
     EVENT LISTENERS
     ============================================= */
  /* =============================================
     BUILD DYNAMIC DOWNLOAD MENU
     ============================================= */
  function buildDownloadMenu() {
    const menu = document.getElementById('downloadMenu');
    if (!menu) return;
    menu.innerHTML = '';
    const fileObjs = Editor.getFiles();
    const dotColors = { html:'#e44d26', css:'#264de4', js:'#f0db4f' };
    Object.values(fileObjs).forEach((f) => {
      const btn = document.createElement('button');
      btn.className = 'download-menu-item';
      const dotColor = dotColors[f.type] || '#10b981';
      const dotExtra = f.type === 'js' ? 'outline:1px solid #ccc;outline-offset:-1px;' : '';
      btn.innerHTML = `<span class="dm-dot" style="background:${dotColor};${dotExtra}border-radius:50%"></span>${escapeHtml(f.name)}`;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const content = Editor.getValue(f.id);
        const mimeMap = { html:'text/html', css:'text/css', js:'application/javascript' };
        const mime = mimeMap[f.type] || 'text/plain';
        const blob = new Blob([content], { type: mime });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = f.name;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        setTimeout(() => closeDownloadMenu(), 150);
      });
      menu.appendChild(btn);
    });
  }

  function setupEventListeners() {
    // Header
    document.getElementById('menuBtn')?.addEventListener('click', openDrawer);
    document.getElementById('themeBtn')?.addEventListener('click', () => applyTheme(!isDark));
    document.getElementById('openPreviewBtn')?.addEventListener('click', () => {
      Preview.openFullPreview(Editor.getVirtualFiles());
    });

    // Drawer
    document.getElementById('closeDrawer')?.addEventListener('click', closeDrawer);
    document.getElementById('drawerOverlay')?.addEventListener('click', closeDrawer);
    document.getElementById('newProjectBtn')?.addEventListener('click', createNewProject);

    document.getElementById('exportZipBtn')?.addEventListener('click', async () => {
      if (!currentProject) return;
      currentProject.files = Editor.getVirtualFiles();
      await Zip.exportProject(currentProject);
      closeDrawer();
    });

    document.getElementById('importZipBtn')?.addEventListener('click', () => document.getElementById('zipImportInput').click());
    document.getElementById('zipImportInput')?.addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (f) await handleDroppedFiles([f]);
      e.target.value = '';
      closeDrawer();
    });

    document.getElementById('uploadFileBtn')?.addEventListener('click', async () => { closeDrawer(); await showUploadModal([]); });
    document.getElementById('fileUploadInput')?.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      if (files.length > 0) await showUploadModal(files);
      e.target.value = '';
    });

    // ---- EDITOR TOOLBAR ----
    document.getElementById('tbUndo')?.addEventListener('click',      () => Editor.undo());
    document.getElementById('tbRedo')?.addEventListener('click',      () => Editor.redo());
    document.getElementById('tbSelectAll')?.addEventListener('click', () => Editor.selectAll());
    document.getElementById('tbUpload')?.addEventListener('click',    async () => await showUploadModal([]));

    // Find & Replace
    document.getElementById('tbFind')?.addEventListener('click', () => {
      Editor.openFindReplace(true);
    });

    // Download menu — now handles all tabs including extra files dynamically
    document.getElementById('tbDownload')?.addEventListener('click', (e) => {
      e.stopPropagation();
      // Build dynamic menu from current open files
      buildDownloadMenu();
      downloadMenuOpen = !downloadMenuOpen;
      document.getElementById('downloadMenu')?.classList.toggle('hidden', !downloadMenuOpen);
    });

    // Close menu when clicking outside the download wrap
    document.addEventListener('click', (e) => {
      if (downloadMenuOpen && !e.target.closest('.toolbar-download-wrap')) closeDownloadMenu();
    });

    // Mobile nav
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        if (view === 'projects') openDrawer();
        else setMobileView(view);
      });
    });

    // Modals
    document.getElementById('modalConfirm')?.addEventListener('click', confirmModal);
    document.getElementById('modalCancel')?.addEventListener('click',  cancelModal);
    document.getElementById('modalClose')?.addEventListener('click',   cancelModal);
    document.getElementById('modalOverlay')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) cancelModal(); });

    setupResizeHandle();

    // Global keys
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeDrawer(); cancelModal(); closeDownloadMenu(); Editor.closeFindReplace(); if(Inspector.isOpen()) Inspector.closeInspector(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'h') && !e.target.matches('.fr-input, .CodeMirror *')) {
        e.preventDefault();
        Editor.openFindReplace(true);
      }
    });

    // Preview refresh
    document.getElementById('refreshPreview')?.addEventListener('click', () => {
      Preview.reloadCurrent();
    });

    // Project name click → rename
    document.getElementById('projectName')?.addEventListener('click', async () => {
      if (!currentProject) return;
      const name = await showInputModal('Rename Project', 'Project name:', currentProject.name);
      if (name && name !== currentProject.name) {
        currentProject.name = name;
        await Storage.saveProject(currentProject);
        updateProjectNameDisplay();
        await renderProjectList();
      }
    });

    // Responsive
    window.matchMedia('(max-width: 768px)').addEventListener('change', (e) => {
      if (!e.matches) document.getElementById('workspace').className = '';
      else setMobileView(isMobileView);
    });
  }

  /* =============================================
     UTILITIES
     ============================================= */
  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g,'&').replace(/</g,'<').replace(/>/g,'>')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  /* =============================================
     START
     ============================================= */
  init().catch((err) => {
    console.error('[AntLab] Init error:', err);
    const s = document.querySelector('.splash-status');
    if (s) s.textContent = 'Error initializing. Please refresh.';
  });

})();
