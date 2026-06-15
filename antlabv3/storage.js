/**
 * storage.js - AntLab IDE
 * IndexedDB-based storage with localStorage fallback.
 * Manages multiple projects, auto-save, and session restoration.
 */

const Storage = (() => {
  const DB_NAME = 'AntLab-ide';
  const DB_VERSION = 2;
  const STORE_PROJECTS = 'projects';
  const STORE_META = 'meta';
  const LS_FALLBACK_KEY = 'AntLab_projects';
  const LS_CURRENT_KEY = 'AntLab_current';

  let db = null;
  let usingFallback = false;

  /* =============================================
     DEFAULT STARTER TEMPLATES
     ============================================= */
  const DEFAULT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>My Project</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>

  <div class="container">
    <h1>Hello, World! 👋</h1>
    <p>Start editing to see your changes live.</p>
    <button onclick="greet()">Click Me</button>
    <div id="output"></div>
  </div>

  <script src="script.js"><\/script>
</body>
</html>`;

  const DEFAULT_CSS = `/* === Global Reset === */
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: 'Segoe UI', system-ui, sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

.container {
  background: white;
  border-radius: 16px;
  padding: 48px;
  text-align: center;
  max-width: 480px;
  width: 90%;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
}

h1 {
  font-size: 2rem;
  margin-bottom: 12px;
  color: #1a1a2e;
}

p {
  color: #666;
  margin-bottom: 24px;
}

button {
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: white;
  border: none;
  padding: 12px 32px;
  border-radius: 8px;
  font-size: 16px;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.2s;
}

button:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(102, 126, 234, 0.4);
}

#output {
  margin-top: 20px;
  font-size: 18px;
  color: #764ba2;
  min-height: 28px;
}`;

  const DEFAULT_JS = `// AntLab IDE — script.js
// JavaScript runs live in the preview!

let count = 0;

function greet() {
  count++;
  const messages = [
    '🎉 Hello there!',
    '✨ Looking great!',
    '🚀 You\\'re on fire!',
    '💡 Keep coding!',
    '🎨 Build something awesome!'
  ];
  const msg = messages[count % messages.length];
  document.getElementById('output').textContent = msg;
  
  // Animate the output
  const el = document.getElementById('output');
  el.style.transform = 'scale(1.1)';
  setTimeout(() => el.style.transform = 'scale(1)', 200);
}

// Log something to test the console
console.log('Script loaded! Click the button to see magic ✨');
console.info('Tip: Open the console panel to see output here.');`;

  /* =============================================
     INIT — Open IndexedDB
     ============================================= */
  async function init() {
    return new Promise((resolve) => {
      if (!window.indexedDB) {
        console.warn('[Storage] IndexedDB not available, using localStorage');
        usingFallback = true;
        return resolve(false);
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains(STORE_PROJECTS)) {
          const store = database.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt');
        }
        if (!database.objectStoreNames.contains(STORE_META)) {
          database.createObjectStore(STORE_META, { keyPath: 'key' });
        }
      };
      req.onsuccess = (e) => {
        db = e.target.result;
        resolve(true);
      };
      req.onerror = () => {
        console.warn('[Storage] IndexedDB open failed, using localStorage');
        usingFallback = true;
        resolve(false);
      };
    });
  }

  /* =============================================
     IDB HELPERS
     ============================================= */
  function idbGet(storeName, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function idbPut(storeName, value) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).put(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function idbDelete(storeName, key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  function idbGetAll(storeName) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /* =============================================
     PROJECT DATA STRUCTURE
     ============================================= */
  function createProject(name) {
    return {
      id: 'proj_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      name: name || 'untitled-project',
      html: DEFAULT_HTML,
      css: DEFAULT_CSS,
      js: DEFAULT_JS,
      extraFiles: [], // [{name, type, content}]
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  /* =============================================
     LOCALSTORAGE FALLBACK
     ============================================= */
  function lsGetAll() {
    try {
      return JSON.parse(localStorage.getItem(LS_FALLBACK_KEY) || '[]');
    } catch { return []; }
  }

  function lsSaveAll(projects) {
    try { localStorage.setItem(LS_FALLBACK_KEY, JSON.stringify(projects)); } catch {}
  }

  function lsGetCurrent() {
    return localStorage.getItem(LS_CURRENT_KEY) || null;
  }

  function lsSetCurrent(id) {
    localStorage.setItem(LS_CURRENT_KEY, id);
  }

  /* =============================================
     PUBLIC API
     ============================================= */

  async function getAllProjects() {
    if (usingFallback) return lsGetAll().sort((a, b) => b.updatedAt - a.updatedAt);
    const all = await idbGetAll(STORE_PROJECTS);
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async function getProject(id) {
    if (usingFallback) return lsGetAll().find(p => p.id === id) || null;
    return await idbGet(STORE_PROJECTS, id) || null;
  }

  async function saveProject(project) {
    project.updatedAt = Date.now();
    if (usingFallback) {
      const all = lsGetAll();
      const idx = all.findIndex(p => p.id === project.id);
      if (idx >= 0) all[idx] = project; else all.unshift(project);
      lsSaveAll(all);
      return;
    }
    await idbPut(STORE_PROJECTS, project);
  }

  async function deleteProject(id) {
    if (usingFallback) {
      lsSaveAll(lsGetAll().filter(p => p.id !== id));
      return;
    }
    await idbDelete(STORE_PROJECTS, id);
  }

  async function getCurrentProjectId() {
    if (usingFallback) return lsGetCurrent();
    const meta = await idbGet(STORE_META, 'currentProjectId');
    return meta ? meta.value : null;
  }

  async function setCurrentProjectId(id) {
    if (usingFallback) { lsSetCurrent(id); return; }
    await idbPut(STORE_META, { key: 'currentProjectId', value: id });
  }

  async function getOrCreateCurrentProject() {
    let id = await getCurrentProjectId();
    if (id) {
      const project = await getProject(id);
      if (project) return project;
    }
    // Create default project
    const project = createProject('my-first-project');
    await saveProject(project);
    await setCurrentProjectId(project.id);
    return project;
  }

  return {
    init,
    getAllProjects,
    getProject,
    saveProject,
    deleteProject,
    getCurrentProjectId,
    setCurrentProjectId,
    getOrCreateCurrentProject,
    createProject,
  };
})();
