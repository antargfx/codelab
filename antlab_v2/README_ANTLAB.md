# AntLab IDE — v2

A browser-based coding playground that now behaves like a real **localhost dev server**
(similar to VS Code Live Server).

## What's new in v2

1. **Real localhost-style preview (Service Worker virtual server)**
   - `sw.js` serves every project file at a real same-origin URL.
   - `fetch('data.json')`, relative paths, `<link href="style.css">`,
     `<script src="script.js">` and external API calls (`fetch('https://…')`)
     all work exactly like a real server.
2. **Browser-style address bar** above the preview
   - Back / Forward / Reload / Home buttons + an **editable URL field**.
   - Type `page.html` (or any file) and hit Enter to navigate.
   - Multi-page projects work: link between `index.html`, `page.html`, etc.
3. **All tabs are closeable** — including `index.html`, `style.css`, `script.js`.
   - New files of many text types can be added: `.html .htm .css .js .mjs
     .json .svg .xml .txt .md .csv`.

## IMPORTANT: how to run it

Service Workers require an **http/https origin** (they do **not** work from `file://`).

- **Locally:** open the folder with VS Code **Live Server**, or run:
  ```bash
  python3 -m http.server 8000
  # then open http://localhost:8000/
  ```
- **GitHub Pages:** just push these files. Pages is served over https, so the
  service worker registers automatically. `sw.js` must sit in the same folder as
  `index.html` (its scope covers the whole app path, including `/<repo>/`).

If a Service Worker can't start (e.g. you opened `index.html` directly via
`file://`), the preview automatically falls back to the older inline mode
(single-page, no `fetch`/multi-page) so it still renders.

## Files

| File          | Purpose                                              |
|---------------|------------------------------------------------------|
| index.html    | App shell + address bar UI                           |
| style.css     | Styles (incl. address bar)                           |
| app.js        | Controller / wiring                                  |
| editor.js     | Multi-tab CodeMirror editor (all tabs closeable)     |
| preview.js    | SW virtual server + address-bar navigation           |
| sw.js         | Service Worker that serves the virtual file system   |
| storage.js    | IndexedDB project storage (files[] model + migration)|
| zip.js        | Import/export whole projects as ZIP                  |
| inspector.js  | DOM inspector                                        |
