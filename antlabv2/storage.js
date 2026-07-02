/**
 * storage.js — AntLab v2
 * IndexedDB-based storage. Projects hold an arbitrary flat file map:
 *   project.files = { 'index.html': '...', 'style.css': '...',
 *                     'pages/about.html': '...', 'data.json': '...', ... }
 *   project.entry = 'index.html'   (Home file)
 * Legacy v1 projects (html/css/js/extraFiles) are auto-migrated on load.
 */

const Storage = (() => {
  const DB_NAME  = 'AntLab-ide-v2';
  const DB_VER   = 1;
  const S_PROJ   = 'projects';
  const S_META   = 'meta';
  const LS_PROJ  = 'AntLab_v2_projects';
  const LS_CUR   = 'AntLab_v2_current';

  let db = null;
  let usingFallback = false;

  /* Starter template — same feel as v1 but as a flat file map */
  const DEFAULT_FILES = {
    'index.html':
`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AntLab v2 Demo</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <main class="card">
    <h1>Hello, World! 👋</h1>
    <p>This preview runs on a virtual localhost. Try <code>fetch()</code>, multi-page navigation, images — everything works!</p>
    <p><a href="about.html">→ Go to about page</a></p>
    <button id="btn">Fetch demo</button>
    <pre id="out"></pre>
  </main>
  <script src="script.js"></script>
</body>
</html>`,

    'about.html':
`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>About — AntLab v2</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <main class="card">
    <h1>About page ✨</h1>
    <p>Multi-page navigation works because AntLab v2 serves your project
       from a real URL via a Service Worker.</p>
    <p><a href="index.html">← Back home</a></p>
  </main>
</body>
</html>`,

    'style.css':
`*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
body{font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;
  min-height:100vh;background:linear-gradient(135deg,#667eea,#764ba2);
  display:flex;align-items:center;justify-content:center;padding:20px;}
.card{background:#fff;border-radius:16px;padding:40px;max-width:520px;
  width:100%;box-shadow:0 20px 60px rgba(0,0,0,.2);text-align:center;}
h1{margin-bottom:12px;color:#1a1a2e;}
p{color:#555;margin-bottom:16px;}
a{color:#764ba2;font-weight:600;text-decoration:none;}
a:hover{text-decoration:underline;}
button{background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;
  border:none;padding:12px 28px;border-radius:8px;font-size:15px;
  cursor:pointer;font-weight:600;margin-top:8px;}
button:hover{opacity:.9;}
pre{background:#f4f4f8;padding:12px;border-radius:8px;margin-top:16px;
  font-size:12px;text-align:left;overflow:auto;max-height:180px;color:#333;}
code{background:#f4f4f8;padding:2px 6px;border-radius:4px;font-size:.9em;}`,

    'script.js':
`// AntLab v2 — real fetch() works!
console.log('Script loaded ✓');

document.getElementById('btn').addEventListener('click', async () => {
  const out = document.getElementById('out');
  out.textContent = 'Loading…';
  try {
    // Both external APIs AND local files work
    const res = await fetch('data.json');
    const local = await res.json();

    const api = await fetch('https://jsonplaceholder.typicode.com/todos/1');
    const remote = await api.json();

    out.textContent = 'LOCAL data.json:\\n' + JSON.stringify(local, null, 2) +
      '\\n\\nREMOTE api response:\\n' + JSON.stringify(remote, null, 2);
    console.info('Fetch succeeded ✓');
  } catch (err) {
    out.textContent = 'Error: ' + err.message;
    console.error(err);
  }
});`,

    'data.json':
`{
  "message": "This is a real fetch() from a local project file!",
  "items": ["one", "two", "three"]
}`,
  };

  /* ================= Init ================= */
  async function init() {
    return new Promise((resolve) => {
      if (!window.indexedDB) { usingFallback = true; return resolve(false); }
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(S_PROJ)) {
          const s = d.createObjectStore(S_PROJ, { keyPath:'id' });
          s.createIndex('updatedAt','updatedAt');
        }
        if (!d.objectStoreNames.contains(S_META)) {
          d.createObjectStore(S_META, { keyPath:'key' });
        }
      };
      req.onsuccess = (e) => { db = e.target.result; resolve(true); };
      req.onerror   = () => { usingFallback = true; resolve(false); };
    });
  }

  /* ================= IDB helpers ================= */
  const idb = (store, mode='readonly') => db.transaction(store, mode).objectStore(store);
  const wrap = (req) => new Promise((res, rej) => { req.onsuccess=()=>res(req.result); req.onerror=()=>rej(req.error); });

  /* ================= Project shape / migration ================= */
  function createProject(name) {
    return {
      id: 'proj_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
      name: name || 'untitled-project',
      files: { ...DEFAULT_FILES },
      entry: 'index.html',
      openTabs: ['index.html', 'style.css', 'script.js'],
      activeTab: 'index.html',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  // Migrate a v1-shaped project (html/css/js + extraFiles) into v2 (files map)
  function migrateIfNeeded(p) {
    if (!p) return p;
    if (p.files && typeof p.files === 'object') return p; // already v2
    const files = {};
    if (p.html) files['index.html'] = p.html;
    if (p.css)  files['style.css']  = p.css;
    if (p.js)   files['script.js']  = p.js;
    (p.extraFiles || []).forEach(f => { if (f && f.name) files[f.name] = f.content || ''; });
    p.files = files;
    p.entry = 'index.html';
    p.openTabs = Object.keys(files);
    p.activeTab = 'index.html';
    delete p.html; delete p.css; delete p.js; delete p.extraFiles;
    return p;
  }

  /* ================= LS fallback ================= */
  const lsAll   = () => { try { return JSON.parse(localStorage.getItem(LS_PROJ) || '[]'); } catch { return []; } };
  const lsSave  = (arr) => { try { localStorage.setItem(LS_PROJ, JSON.stringify(arr)); } catch(_){} };

  /* ================= Public API ================= */
  async function getAllProjects() {
    let arr;
    if (usingFallback) arr = lsAll();
    else arr = await wrap(idb(S_PROJ).getAll());
    return arr.map(migrateIfNeeded).sort((a,b) => b.updatedAt - a.updatedAt);
  }

  async function getProject(id) {
    let p;
    if (usingFallback) p = lsAll().find(x => x.id === id) || null;
    else p = await wrap(idb(S_PROJ).get(id)) || null;
    return migrateIfNeeded(p);
  }

  async function saveProject(project) {
    project.updatedAt = Date.now();
    if (usingFallback) {
      const arr = lsAll();
      const i = arr.findIndex(p => p.id === project.id);
      if (i >= 0) arr[i] = project; else arr.unshift(project);
      lsSave(arr); return;
    }
    await wrap(idb(S_PROJ,'readwrite').put(project));
  }

  async function deleteProject(id) {
    if (usingFallback) { lsSave(lsAll().filter(p => p.id !== id)); return; }
    await wrap(idb(S_PROJ,'readwrite').delete(id));
  }

  async function getCurrentProjectId() {
    if (usingFallback) return localStorage.getItem(LS_CUR) || null;
    const m = await wrap(idb(S_META).get('currentProjectId'));
    return m ? m.value : null;
  }

  async function setCurrentProjectId(id) {
    if (usingFallback) { localStorage.setItem(LS_CUR, id); return; }
    await wrap(idb(S_META,'readwrite').put({ key:'currentProjectId', value:id }));
  }

  async function getOrCreateCurrentProject() {
    const id = await getCurrentProjectId();
    if (id) {
      const p = await getProject(id);
      if (p) return p;
    }
    const p = createProject('my-first-project');
    await saveProject(p);
    await setCurrentProjectId(p.id);
    return p;
  }

  return {
    init,
    createProject,
    getAllProjects,
    getProject,
    saveProject,
    deleteProject,
    getCurrentProjectId,
    setCurrentProjectId,
    getOrCreateCurrentProject,
  };
})();
