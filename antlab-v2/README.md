# AntLab IDE v2

A browser-based coding playground that runs your projects on a **virtual localhost** — powered by a Service Worker VFS. Everything you'd expect from `python -m http.server` or VS Code's Live Server works out of the box.

## What's new in v2

| v1 | v2 |
| --- | --- |
| Preview via `srcdoc` (no origin) | Preview via **Service Worker** → real URLs (real origin) |
| `fetch('data.json')` broken | ✅ Works |
| Multi-page navigation broken | ✅ Works (`<a href="page.html">`) |
| Relative `<img>`, `<link>`, `<script>` broken | ✅ Works |
| ES modules broken | ✅ Works |
| 3 fixed tabs (`html/css/js`), `+` for extras | Every file is a first-class tab; **all closeable, renamable** |
| Fixed filenames | Any path, any extension (`pages/about.html`, `assets/logo.svg`, `data.json`, …) |
| Refresh-only preview | **Editable URL bar + Back / Forward / Reload / Home** like a browser |

## Files

```
antlab-v2/
  index.html    ← app shell
  style.css
  app.js        ← top-level controller
  editor.js     ← dynamic CodeMirror tabs (multi-file)
  preview.js    ← URL bar, iframe navigation, SW messaging
  storage.js    ← IndexedDB persistence (+ localStorage fallback, v1 auto-migration)
  zip.js        ← import / export project ZIPs
  sw.js         ← 🔑 Service Worker virtual file system
```

## Running

### Localhost
Any static server will do — the Service Worker requires HTTP(S) (not `file://`).
```bash
cd antlab-v2
python -m http.server 8000
# open http://localhost:8000/
```
Or with Node:
```bash
npx serve .
```

### GitHub Pages
Just push the folder. Because `sw.js` sits at the app root, the SW scope covers the whole app automatically. The preview will be served at:
```
https://<user>.github.io/<repo>/__preview__/<projectId>/index.html
```
(This URL only exists inside the iframe — the URL bar in the app shows a clean `/index.html`.)

## Tab keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd+S` | Force save |
| `Ctrl/Cmd+F` / `Ctrl/Cmd+H` | Find & replace |
| `Ctrl/Cmd+R` | Reload preview |
| `Middle-click` a tab | Close it |
| `Double-click` a tab | Rename it |

## Setting the "Home" file
By default `index.html` is Home. To change it, click **☰** (right of the tab bar) to open the file list, right-click any file, and type `h`.

## Notes
- All project data lives in your browser's IndexedDB. Nothing is uploaded.
- v1 projects are auto-migrated on first load.
- Binary files (images, fonts, wasm) are stored as text — the SW still serves them with the correct MIME type. If you need true binary support, drop the files as base64 or fetch them from a CDN.
