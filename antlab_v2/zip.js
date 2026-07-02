/**
 * zip.js - AntLab IDE
 * Project import/export via ZIP using JSZip.
 * Also handles individual file uploads and downloads.
 */

const Zip = (() => {

  /* =============================================
     EXPORT — Download project as ZIP
     ============================================= */
  async function exportProject(project) {
    if (typeof JSZip === 'undefined') {
      alert('JSZip library not loaded. Please check your internet connection.');
      return;
    }

    const zip = new JSZip();
    const name = sanitizeName(project.name || 'my-project');

    // Add every project file (index.html, style.css, script.js, extra pages…)
    const files = Array.isArray(project.files) ? project.files : [];
    let hasReadme = false;
    files.forEach((f) => {
      if (f && f.name && f.content !== undefined) {
        zip.file(f.name, f.content);
        if (/^readme\.md$/i.test(f.name)) hasReadme = true;
      }
    });

    // Add a README if the project doesn't already have one
    if (!hasReadme) zip.file('README.md', generateReadme(name));

    try {
      const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });

      downloadBlob(blob, `${name}.zip`);
    } catch (err) {
      console.error('[Zip] Export failed:', err);
      alert('Failed to create ZIP file: ' + err.message);
    }
  }

  /* =============================================
     IMPORT — Load project from ZIP
     ============================================= */
  async function importProject(file) {
    if (typeof JSZip === 'undefined') {
      alert('JSZip library not loaded. Please check your internet connection.');
      return null;
    }

    try {
      const zip = await JSZip.loadAsync(file);
      const name = file.name.replace(/\.zip$/i, '').replace(/[^a-zA-Z0-9_-]/g, '-') || 'imported-project';

      // Import EVERY text-based file, preserving its relative path & name.
      const TEXT_EXT = ['html','htm','css','js','mjs','json','svg','xml','txt','md','csv'];
      const entries = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
      const files = [];
      // Detect a common top-level folder (e.g. "project/…") and strip it.
      const topDirs = new Set(entries.map((n) => (n.includes('/') ? n.split('/')[0] : '')));
      const strip = (topDirs.size === 1 && !topDirs.has('')) ? [...topDirs][0] + '/' : '';

      for (const entry of entries) {
        const rel = strip && entry.startsWith(strip) ? entry.slice(strip.length) : entry;
        if (!rel || rel.startsWith('__MACOSX') || rel.startsWith('.')) continue;
        const ext = (rel.split('.').pop() || '').toLowerCase();
        if (!TEXT_EXT.includes(ext)) continue; // skip binaries (images, fonts…)
        const content = await zip.files[entry].async('text');
        files.push({ name: rel, type: guessType(rel), content });
      }

      return { name, files };
    } catch (err) {
      console.error('[Zip] Import failed:', err);
      alert('Failed to read ZIP file: ' + err.message);
      return null;
    }
  }

  /* =============================================
     FILE UPLOAD — Handle single file upload
     ============================================= */
  function handleFileUpload(file, currentProject) {
    const ext = file.name.split('.').pop().toLowerCase();
    const reader = new FileReader();

    return new Promise((resolve) => {
      reader.onload = (e) => {
        const content = e.target.result;
        if (ext === 'html' || ext === 'htm') {
          resolve({ type: 'html', content });
        } else if (ext === 'css') {
          resolve({ type: 'css', content });
        } else if (ext === 'js') {
          resolve({ type: 'js', content });
        } else {
          alert(`Unsupported file type: .${ext}\nSupported: .html, .css, .js, .zip`);
          resolve(null);
        }
      };
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    });
  }

  /* =============================================
     INDIVIDUAL FILE DOWNLOAD
     ============================================= */
  function downloadFile(content, filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const mimeMap = {
      html: 'text/html',
      css: 'text/css',
      js: 'application/javascript',
      txt: 'text/plain',
    };
    const mime = mimeMap[ext] || 'text/plain';
    const blob = new Blob([content], { type: mime });
    downloadBlob(blob, filename);
  }

  function downloadCurrentFile(type, content) {
    const names = { html: 'index.html', css: 'style.css', js: 'script.js' };
    downloadFile(content, names[type] || `file.${type}`);
  }

  /* =============================================
     DRAG & DROP
     ============================================= */
  function setupDragDrop(container, onFiles) {
    let dragCounter = 0;

    container.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      container.classList.add('drag-over');
    });

    container.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        container.classList.remove('drag-over');
      }
    });

    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });

    container.addEventListener('drop', (e) => {
      e.preventDefault();
      dragCounter = 0;
      container.classList.remove('drag-over');
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) onFiles(files);
    });
  }

  /* =============================================
     HELPERS
     ============================================= */
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function findFile(zip, patterns) {
    const files = Object.keys(zip.files).filter((name) => !zip.files[name].dir);

    for (const pattern of patterns) {
      if (typeof pattern === 'string') {
        // Exact match (case-insensitive, basename)
        const found = files.find(
          (f) => f.split('/').pop().toLowerCase() === pattern.toLowerCase()
        );
        if (found) return zip.files[found];
      } else if (pattern instanceof RegExp) {
        // Regex match on filename
        const found = files.find((f) => pattern.test(f.split('/').pop()));
        if (found) return zip.files[found];
      }
    }
    return null;
  }

  function guessType(name) {
    const ext = (String(name).split('.').pop() || '').toLowerCase();
    if (ext === 'htm' || ext === 'html') return 'html';
    if (ext === 'css') return 'css';
    if (ext === 'mjs' || ext === 'js') return 'js';
    return ext || 'txt';
  }

  function sanitizeName(name) {
    return name
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 50)
      || 'project';
  }

  function generateReadme(name) {
    return `# ${name}

Generated by [AntLab IDE](https://antarweb.github.io/antlab) — a browser-based coding playground.

## Files

- \`index.html\` — Main HTML document
- \`style.css\` — Stylesheet
- \`script.js\` — JavaScript

## Usage

Open \`index.html\` in any browser to run the project.
`;
  }

  return {
    exportProject,
    importProject,
    handleFileUpload,
    downloadFile,
    downloadCurrentFile,
    setupDragDrop,
  };
})();
