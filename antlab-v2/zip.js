/**
 * zip.js — AntLab v2
 * Import/export projects as ZIPs. Preserves folder structure.
 */

const Zip = (() => {

  async function exportProject(project) {
    if (typeof JSZip === 'undefined') { alert('JSZip not loaded.'); return; }
    const zip = new JSZip();
    const name = sanitize(project.name || 'my-project');
    Object.entries(project.files || {}).forEach(([path, content]) => {
      zip.file(path, content ?? '');
    });
    zip.file('README.md', `# ${name}\n\nExported from AntLab IDE v2.\n\nOpen \`${project.entry || 'index.html'}\` in a browser (or serve the folder via any static server) to run.\n`);
    const blob = await zip.generateAsync({ type:'blob', compression:'DEFLATE', compressionOptions:{ level:6 } });
    downloadBlob(blob, name + '.zip');
  }

  async function importProject(file) {
    if (typeof JSZip === 'undefined') { alert('JSZip not loaded.'); return null; }
    try {
      const zip = await JSZip.loadAsync(file);
      const files = {};
      // Detect common root folder so we can strip it
      const allPaths = Object.keys(zip.files).filter(p => !zip.files[p].dir);
      let rootPrefix = '';
      if (allPaths.length > 1) {
        const first = allPaths[0].split('/')[0];
        if (first && allPaths.every(p => p.startsWith(first + '/'))) rootPrefix = first + '/';
      }
      for (const path of allPaths) {
        if (path.endsWith('/')) continue;
        const rel = path.replace(rootPrefix, '');
        if (!rel) continue;
        // Skip meta / hidden files
        if (rel.startsWith('.') || rel === 'README.md') { /* still include README */ }
        const entry = zip.files[path];
        // Try text; if binary the string will contain garbage but we'll allow it
        try {
          files[rel] = await entry.async('text');
        } catch (_) {
          files[rel] = '';
        }
      }
      // Best-guess entry
      let entry = 'index.html';
      if (!files[entry]) {
        entry = Object.keys(files).find(p => /^index\.html?$/i.test(p))
              || Object.keys(files).find(p => /\.html?$/i.test(p))
              || Object.keys(files)[0] || 'index.html';
      }
      const name = file.name.replace(/\.zip$/i,'') || 'imported';
      return { name, files, entry };
    } catch (err) {
      console.error('[Zip] import failed', err);
      alert('Failed to read ZIP: ' + err.message);
      return null;
    }
  }

  function downloadFile(content, filename) {
    const mime = mimeFor(filename);
    const blob = new Blob([content], { type: mime });
    downloadBlob(blob, filename);
  }

  function mimeFor(name) {
    const e = (name.split('.').pop() || '').toLowerCase();
    return ({
      html:'text/html', htm:'text/html', css:'text/css',
      js:'application/javascript', json:'application/json',
      svg:'image/svg+xml', txt:'text/plain', md:'text/markdown', xml:'application/xml',
    })[e] || 'text/plain';
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function sanitize(name) {
    return String(name).replace(/\s+/g,'-').replace(/[^a-zA-Z0-9_.-]/g,'').slice(0,60) || 'project';
  }

  function setupDragDrop(container, onFiles) {
    let dc = 0;
    container.addEventListener('dragenter', (e) => { e.preventDefault(); dc++; container.classList.add('drag-over'); });
    container.addEventListener('dragleave', (e) => { e.preventDefault(); dc--; if (dc<=0){dc=0;container.classList.remove('drag-over');} });
    container.addEventListener('dragover',  (e) => { e.preventDefault(); e.dataTransfer.dropEffect='copy'; });
    container.addEventListener('drop',      (e) => { e.preventDefault(); dc=0; container.classList.remove('drag-over');
      const files = Array.from(e.dataTransfer.files); if (files.length) onFiles(files); });
  }

  return { exportProject, importProject, downloadFile, downloadBlob, setupDragDrop };
})();
