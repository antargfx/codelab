/**
 * inspector.js — AntLab IDE
 * Chrome DevTools-style DOM Inspector.
 *
 * Features:
 *  • Element picker mode — click/hover any element in the preview to inspect it
 *  • DOM tree explorer — collapsible tree with expand/collapse, live node selection
 *  • Computed styles panel — shows all active CSS properties on the selected element
 *  • Live style editor — click any property value to edit it inline, applied instantly
 *  • Attribute editor — click any HTML attribute to edit it inline
 *  • Box model visualiser — shows margin/border/padding/content dimensions
 *  • Breadcrumb trail — shows ancestor path like Chrome's bottom bar
 *  • Hover highlight overlay — purple outline + label while picking
 *  • "Copy as HTML" and "Copy as CSS" buttons
 *  • Writes changes back to the editor source
 */

const Inspector = (() => {

  /* =============================================
     STATE
     ============================================= */
  let isOpen       = false;
  let pickMode     = false;   // element-picker cursor active
  let selectedPath = [];      // [{tag,idx}] path to selected node in iframe DOM
  let iframeDoc    = null;    // reference to iframe's contentDocument
  let _onWriteBack = null;    // callback(html) to sync changes to editor
  let _resizing    = false;
  let _inspectorH  = 340;     // panel height in px

  const HIGHLIGHT_ID  = '__pf_inspector_hl__';
  const OVERLAY_ID    = '__pf_inspector_ov__';

  /* =============================================
     INJECT PICKER BRIDGE INTO IFRAME
     The preview iframe already has allow-same-origin,
     so we can access its contentDocument directly after load.
     We also inject a thin script for hover/click messages.
     ============================================= */
  const PICKER_BRIDGE = /* html */`
<script id="__pf_picker__">
(function(){
  var _highlight = null;
  var _overlay   = null;
  var _active    = false;

  function ensureOverlay() {
    if (_overlay) return _overlay;
    _overlay = document.createElement('div');
    _overlay.id = '__pf_inspector_ov__';
    _overlay.style.cssText = [
      'position:fixed','top:0','left:0','pointer-events:none',
      'z-index:2147483647','transition:all .08s ease',
      'background:rgba(109,40,217,.08)',
      'outline:2px solid #7c3aed',
      'border-radius:2px',
    ].join(';');
    document.body.appendChild(_overlay);
    return _overlay;
  }

  function getPath(el) {
    var path = [];
    var node = el;
    while (node && node !== document.documentElement) {
      var idx = 0;
      var sib = node.previousElementSibling;
      while (sib) { idx++; sib = sib.previousElementSibling; }
      path.unshift({ tag: node.tagName.toLowerCase(), idx: idx });
      node = node.parentElement;
    }
    path.unshift({ tag: 'html', idx: 0 });
    return path;
  }

  function getElInfo(el) {
    var rect = el.getBoundingClientRect();
    var styles = window.getComputedStyle(el);
    var propsToSend = [
      'display','position','width','height','margin','marginTop','marginRight','marginBottom','marginLeft',
      'padding','paddingTop','paddingRight','paddingBottom','paddingLeft',
      'border','borderTop','borderRight','borderBottom','borderLeft','borderRadius',
      'color','background','backgroundColor','backgroundImage',
      'font','fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','textAlign','textDecoration',
      'flexDirection','alignItems','justifyContent','flexWrap','gap',
      'gridTemplateColumns','gridTemplateRows','gridGap',
      'overflow','overflowX','overflowY','zIndex','opacity','transform','transition','boxShadow',
      'cursor','pointerEvents','visibility',
      'top','right','bottom','left',
    ];
    var computed = {};
    propsToSend.forEach(function(p) { computed[p] = styles[p]; });

    var attrs = {};
    for (var i = 0; i < el.attributes.length; i++) {
      attrs[el.attributes[i].name] = el.attributes[i].value;
    }

    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      classList: Array.from(el.classList),
      attrs: attrs,
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      outerHTML: el.outerHTML.slice(0, 4000),
      innerHTML: el.innerHTML.slice(0, 2000),
      textContent: el.textContent.slice(0, 200),
      computed: computed,
      path: getPath(el),
    };
  }

  function highlight(el) {
    if (!el || el === document.body || el === document.documentElement) { hideOverlay(); return; }
    var ov = ensureOverlay();
    var rect = el.getBoundingClientRect();
    ov.style.top    = rect.top    + 'px';
    ov.style.left   = rect.left   + 'px';
    ov.style.width  = rect.width  + 'px';
    ov.style.height = rect.height + 'px';
    ov.style.display = 'block';

    // Tag label
    var label = ov.querySelector('.__pf_label__');
    if (!label) {
      label = document.createElement('div');
      label.className = '__pf_label__';
      label.style.cssText = 'position:absolute;top:-22px;left:0;background:#7c3aed;color:#fff;font:700 11px/1 monospace;padding:3px 7px;border-radius:4px;white-space:nowrap;pointer-events:none;';
      ov.appendChild(label);
    }
    var idStr = el.id ? '#' + el.id : '';
    var clStr = el.classList.length ? '.' + Array.from(el.classList).join('.') : '';
    label.textContent = el.tagName.toLowerCase() + idStr + clStr +
      ' — ' + Math.round(rect.width) + 'x' + Math.round(rect.height);
  }

  function hideOverlay() {
    if (_overlay) _overlay.style.display = 'none';
  }

  function activate() {
    _active = true;
    document.body.style.cursor = 'crosshair';
  }
  function deactivate() {
    _active = false;
    document.body.style.cursor = '';
    hideOverlay();
  }

  document.addEventListener('mouseover', function(e) {
    if (!_active) return;
    e.stopPropagation();
    highlight(e.target);
    window.parent.postMessage({ type: 'inspector_hover', info: getElInfo(e.target) }, '*');
  }, true);

  document.addEventListener('click', function(e) {
    if (!_active) return;
    e.preventDefault(); e.stopPropagation();
    deactivate();
    window.parent.postMessage({ type: 'inspector_select', info: getElInfo(e.target) }, '*');
  }, true);

  // Allow parent to send commands
  window.addEventListener('message', function(e) {
    if (!e.data) return;
    if (e.data.type === 'inspector_activate')   activate();
    if (e.data.type === 'inspector_deactivate') deactivate();

    // Apply inline style change
    if (e.data.type === 'inspector_apply_style') {
      var el = resolvePathEl(e.data.path);
      if (el) { el.style[e.data.prop] = e.data.value; }
    }
    // Apply attribute change
    if (e.data.type === 'inspector_apply_attr') {
      var el2 = resolvePathEl(e.data.path);
      if (el2) {
        if (e.data.value === '') el2.removeAttribute(e.data.attr);
        else el2.setAttribute(e.data.attr, e.data.value);
        window.parent.postMessage({ type: 'inspector_select', info: getElInfo(el2) }, '*');
      }
    }
    // Re-highlight selected path
    if (e.data.type === 'inspector_rehighlight') {
      var el3 = resolvePathEl(e.data.path);
      if (el3) highlight(el3);
    }
    // Request fresh info for path
    if (e.data.type === 'inspector_refresh') {
      var el4 = resolvePathEl(e.data.path);
      if (el4) window.parent.postMessage({ type: 'inspector_select', info: getElInfo(el4) }, '*');
    }
  });

  function resolvePathEl(path) {
    if (!path || !path.length) return null;
    var el = document.documentElement;
    for (var i = 1; i < path.length; i++) {
      var step = path[i];
      var children = Array.from(el.children).filter(function(c) {
        return c.tagName.toLowerCase() === step.tag;
      });
      if (!children[step.idx]) return null;
      el = children[step.idx];
    }
    return el;
  }

  window.__pfInspectorReady = true;
})();
<\/script>`;

  /* =============================================
     PANEL HTML (injected into #previewPanel)
     ============================================= */
  function buildPanelHTML() {
    return `
<div id="inspectorPanel">
  <!-- Resize handle -->
  <div id="inspectorResizeHandle" title="Drag to resize"></div>

  <!-- Inspector header tabs -->
  <div id="inspectorHeader">
    <div class="insp-tabs">
      <button class="insp-tab active" data-itab="elements">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        Elements
      </button>
      <button class="insp-tab" data-itab="styles">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M12 3v18M3 12h18" stroke="currentColor" stroke-width="1.5"/></svg>
        Styles
      </button>
      <button class="insp-tab" data-itab="boxmodel">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="1" stroke="currentColor" stroke-width="2"/><rect x="8" y="8" width="8" height="8" stroke="currentColor" stroke-width="1.5"/></svg>
        Box Model
      </button>
    </div>
    <div class="insp-actions">
      <button id="inspPickBtn" class="insp-pick-btn" title="Pick element (click to activate)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7l10 5 10-5-10-5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Pick
      </button>
      <button id="inspRefreshBtn" class="insp-icon-btn" title="Refresh inspector">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><polyline points="23 4 23 10 17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button id="inspCopyBtn" class="insp-icon-btn" title="Copy element HTML">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" stroke-width="2"/></svg>
      </button>
      <button id="inspCloseBtn" class="insp-icon-btn" title="Close inspector">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    </div>
  </div>

  <!-- Breadcrumb -->
  <div id="inspBreadcrumb" class="insp-breadcrumb">
    <span class="insp-bc-empty">No element selected — click Pick or hover over the preview</span>
  </div>

  <!-- Tab content -->
  <div id="inspTabContent">

    <!-- ELEMENTS TAB -->
    <div class="insp-tab-pane active" id="itab-elements">
      <div id="inspDomTree" class="insp-dom-tree">
        <p class="insp-empty">Select an element to inspect its DOM structure.</p>
      </div>
    </div>

    <!-- STYLES TAB -->
    <div class="insp-tab-pane" id="itab-styles">
      <div id="inspStylesPanel" class="insp-styles-panel">
        <p class="insp-empty">Select an element to see its computed styles.</p>
      </div>
    </div>

    <!-- BOX MODEL TAB -->
    <div class="insp-tab-pane" id="itab-boxmodel">
      <div id="inspBoxModel" class="insp-boxmodel-wrap">
        <p class="insp-empty">Select an element to view its box model.</p>
      </div>
    </div>

  </div>
</div>`;
  }

  /* =============================================
     INIT
     ============================================= */
  function init(onWriteBack) {
    _onWriteBack = onWriteBack;

    // Add Inspect button to preview toolbar
    const controls = document.querySelector('.preview-controls');
    if (controls) {
      const btn = document.createElement('button');
      btn.id = 'inspectorToggleBtn';
      btn.className = 'icon-btn';
      btn.title = 'Toggle Inspector (DOM Inspector)';
      btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="M11 8v3l2 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 20l-3-3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
      controls.insertBefore(btn, controls.firstChild);
      btn.addEventListener('click', toggleInspector);
    }

    // Inject panel HTML into previewPanel
    const previewPanel = document.getElementById('previewPanel');
    if (previewPanel) {
      const div = document.createElement('div');
      div.innerHTML = buildPanelHTML();
      previewPanel.appendChild(div.firstElementChild);
    }

    // Listen for messages from iframe
    window.addEventListener('message', handleMessage);

    // Wire up panel buttons (deferred to after DOM is ready)
    setTimeout(wirePanelButtons, 100);

    // Inspector resize handle
    setTimeout(setupInspectorResize, 100);
  }

  /* =============================================
     TOGGLE
     ============================================= */
  function toggleInspector() {
    isOpen ? closeInspector() : openInspector();
  }

  function openInspector() {
    isOpen = true;
    const panel = document.getElementById('inspectorPanel');
    const btn   = document.getElementById('inspectorToggleBtn');
    if (panel) panel.classList.add('open');
    if (btn)   btn.classList.add('active');
    injectPickerBridgeIfNeeded();
  }

  function closeInspector() {
    isOpen = false;
    pickMode = false;
    const panel = document.getElementById('inspectorPanel');
    const btn   = document.getElementById('inspectorToggleBtn');
    const pickBtn = document.getElementById('inspPickBtn');
    if (panel) panel.classList.remove('open');
    if (btn)   btn.classList.remove('active');
    if (pickBtn) pickBtn.classList.remove('active');
    deactivatePicker();
  }

  /* =============================================
     INJECT PICKER BRIDGE
     ============================================= */
  function injectPickerBridgeIfNeeded() {
    const iframe = document.getElementById('preview');
    if (!iframe) return;

    const tryInject = () => {
      try {
        const doc = iframe.contentDocument;
        if (!doc || !doc.body) return false;
        if (doc.getElementById('__pf_picker__')) return true; // already injected
        const div = doc.createElement('div');
        div.innerHTML = PICKER_BRIDGE;
        const script = div.querySelector('script');
        const s = doc.createElement('script');
        s.id = '__pf_picker__';
        s.textContent = script.textContent;
        doc.head.appendChild(s);
        return true;
      } catch(e) { return false; }
    };

    if (!tryInject()) {
      iframe.addEventListener('load', () => {
        setTimeout(tryInject, 100);
      }, { once: true });
    }
  }

  // Re-inject after every preview render
  function onPreviewRendered() {
    if (!isOpen) return;
    setTimeout(() => {
      injectPickerBridgeIfNeeded();
      if (pickMode) activatePicker();
    }, 200);
  }

  /* =============================================
     PICKER
     ============================================= */
  function activatePicker() {
    pickMode = true;
    const pickBtn = document.getElementById('inspPickBtn');
    if (pickBtn) pickBtn.classList.add('active');
    const iframe = document.getElementById('preview');
    if (iframe) {
      try { iframe.contentWindow.postMessage({ type: 'inspector_activate' }, '*'); } catch(e){}
    }
    // Change iframe cursor via pointer-events trick
    const frame = document.getElementById('previewFrame');
    if (frame) frame.classList.add('pick-mode');
  }

  function deactivatePicker() {
    pickMode = false;
    const pickBtn = document.getElementById('inspPickBtn');
    if (pickBtn) pickBtn.classList.remove('active');
    const iframe = document.getElementById('preview');
    if (iframe) {
      try { iframe.contentWindow.postMessage({ type: 'inspector_deactivate' }, '*'); } catch(e){}
    }
    const frame = document.getElementById('previewFrame');
    if (frame) frame.classList.remove('pick-mode');
  }

  /* =============================================
     MESSAGE HANDLER
     ============================================= */
  function handleMessage(e) {
    if (!e.data || !e.data.type) return;
    if (e.data.type === 'inspector_hover' && pickMode) {
      renderBreadcrumb(e.data.info);
    }
    if (e.data.type === 'inspector_select') {
      pickMode = false;
      const pickBtn = document.getElementById('inspPickBtn');
      if (pickBtn) pickBtn.classList.remove('active');
      const frame = document.getElementById('previewFrame');
      if (frame) frame.classList.remove('pick-mode');
      selectedPath = e.data.info.path;
      renderInspector(e.data.info);
    }
  }

  /* =============================================
     RENDER INSPECTOR — called when element selected
     ============================================= */
  function renderInspector(info) {
    renderBreadcrumb(info);
    renderDomTree(info);
    renderStyles(info);
    renderBoxModel(info);
  }

  /* ---- Breadcrumb ---- */
  function renderBreadcrumb(info) {
    const el = document.getElementById('inspBreadcrumb');
    if (!el) return;
    const path = info.path || [];
    el.innerHTML = path.map((step, i) => {
      const isLast = i === path.length - 1;
      return `<span class="insp-bc-item${isLast ? ' active' : ''}" data-idx="${i}">${step.tag}</span>${isLast ? '' : '<span class="insp-bc-sep">›</span>'}`;
    }).join('');
  }

  /* ---- DOM Tree ---- */
  function renderDomTree(info) {
    const container = document.getElementById('inspDomTree');
    if (!container) return;

    const attrs  = info.attrs  || {};
    const cls    = info.classList || [];
    const tag    = info.tag    || 'unknown';
    const inner  = info.innerHTML || '';

    // Build attribute string
    const attrStr = Object.entries(attrs).map(([k, v]) => {
      return `<span class="insp-attr-item" data-attr="${esc(k)}">
        <span class="insp-attr-name">${esc(k)}</span>=<span class="insp-attr-val">"<span class="insp-attr-val-text" contenteditable="true" data-attr="${esc(k)}">${esc(v)}</span>"</span>
      </span>`;
    }).join(' ');

    // Opening tag
    const openTag = `<span class="insp-tag-bracket"><</span><span class="insp-tag-name">${esc(tag)}</span>${attrStr ? ' ' + attrStr : ''}<span class="insp-tag-bracket">></span>`;

    // Children preview (first ~400 chars of innerHTML, parsed into child element names)
    const childTags = getChildTags(inner);
    const childrenHTML = childTags.length
      ? childTags.map(ct => `<div class="insp-tree-child"><span class="insp-tag-bracket"><</span><span class="insp-tag-name">${esc(ct)}</span><span class="insp-tag-bracket">>…</${esc(ct)}></span></div>`).join('')
      : (info.textContent?.trim() ? `<div class="insp-tree-text">"${esc(info.textContent.trim().slice(0, 80))}"</div>` : '');

    const closeTag = `<span class="insp-tag-bracket"></</span><span class="insp-tag-name">${esc(tag)}</span><span class="insp-tag-bracket">></span>`;

    container.innerHTML = `
      <div class="insp-tree-node selected">
        <div class="insp-tree-line">${openTag}</div>
        <div class="insp-tree-children">${childrenHTML}</div>
        <div class="insp-tree-line">${closeTag}</div>
      </div>
      <div class="insp-outer-html-wrap">
        <div class="insp-section-label">outerHTML <button class="insp-micro-btn" id="copyOuterHtml">copy</button></div>
        <pre class="insp-outer-html" id="outerHtmlPre">${esc(info.outerHTML || '')}</pre>
      </div>`;

    // Wire attribute editing
    container.querySelectorAll('[contenteditable]').forEach(span => {
      span.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); span.blur(); }
        if (e.key === 'Escape') { e.preventDefault(); span.blur(); }
      });
      span.addEventListener('blur', () => {
        const attr = span.dataset.attr;
        const val  = span.textContent;
        applyAttrChange(attr, val);
      });
    });

    // Copy outerHTML
    container.querySelector('#copyOuterHtml')?.addEventListener('click', () => {
      navigator.clipboard?.writeText(info.outerHTML || '').catch(() => {});
      showToast('Copied HTML ✓');
    });
  }

  function getChildTags(html) {
    const tags = [];
    const rx = /<([a-z][a-z0-9]*)[^>]*>/gi;
    let m;
    while ((m = rx.exec(html)) !== null) {
      if (!['script','style','meta','link'].includes(m[1].toLowerCase())) tags.push(m[1]);
      if (tags.length >= 8) break;
    }
    return tags;
  }

  /* ---- Styles Panel ---- */
  function renderStyles(info) {
    const panel = document.getElementById('inspStylesPanel');
    if (!panel) return;
    const computed = info.computed || {};

    // Group properties
    const groups = {
      'Layout': ['display','position','top','right','bottom','left','zIndex','overflow','overflowX','overflowY','visibility'],
      'Dimensions': ['width','height'],
      'Spacing': ['margin','marginTop','marginRight','marginBottom','marginLeft','padding','paddingTop','paddingRight','paddingBottom','paddingLeft'],
      'Border': ['border','borderTop','borderRight','borderBottom','borderLeft','borderRadius','boxShadow'],
      'Typography': ['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','color','textAlign','textDecoration'],
      'Background': ['background','backgroundColor','backgroundImage'],
      'Flexbox': ['flexDirection','alignItems','justifyContent','flexWrap','gap'],
      'Grid': ['gridTemplateColumns','gridTemplateRows','gridGap'],
      'Effects': ['opacity','transform','transition','cursor','pointerEvents'],
    };

    let html = '';
    for (const [groupName, props] of Object.entries(groups)) {
      const rows = props
        .filter(p => computed[p] && computed[p] !== 'none' && computed[p] !== 'normal' && computed[p] !== 'auto' && computed[p] !== '' && computed[p] !== 'initial')
        .map(p => {
          const val = computed[p] || '';
          const colorSwatch = isColor(val) ? `<span class="insp-color-swatch" style="background:${val}"></span>` : '';
          return `<div class="insp-style-row" data-prop="${esc(p)}">
            <span class="insp-prop-name">${camelToKebab(p)}</span>
            <span class="insp-prop-sep">:</span>
            <span class="insp-prop-value-wrap">
              ${colorSwatch}<span class="insp-prop-value" contenteditable="true" data-prop="${esc(p)}">${esc(val)}</span>
            </span>
          </div>`;
        });
      if (rows.length) {
        html += `<div class="insp-style-group">
          <div class="insp-style-group-name">${groupName}</div>
          ${rows.join('')}
        </div>`;
      }
    }

    if (!html) html = '<p class="insp-empty">No significant styles found.</p>';

    panel.innerHTML = `
      <div class="insp-section-label">Computed Styles
        <button class="insp-micro-btn" id="copyCssBtn">copy CSS</button>
      </div>
      <div class="insp-style-add-row">
        <input class="insp-add-prop" id="inspAddProp" placeholder="property" />
        <input class="insp-add-val"  id="inspAddVal"  placeholder="value" />
        <button class="insp-apply-btn" id="inspApplyNewStyle">+</button>
      </div>
      ${html}`;

    // Wire inline editing
    panel.querySelectorAll('.insp-prop-value[contenteditable]').forEach(span => {
      let originalVal = span.textContent;
      span.addEventListener('focus', () => { originalVal = span.textContent; });
      span.addEventListener('keydown', (e) => {
        if (e.key === 'Enter')  { e.preventDefault(); span.blur(); }
        if (e.key === 'Escape') { e.preventDefault(); span.textContent = originalVal; span.blur(); }
        if (e.key === 'ArrowUp')   { e.preventDefault(); nudgeValue(span, +1); }
        if (e.key === 'ArrowDown') { e.preventDefault(); nudgeValue(span, -1); }
      });
      span.addEventListener('blur', () => {
        const prop = span.dataset.prop;
        const val  = span.textContent.trim();
        if (val !== originalVal) applyStyleChange(prop, val);
      });
    });

    // Add new property
    panel.querySelector('#inspApplyNewStyle')?.addEventListener('click', () => {
      const prop = panel.querySelector('#inspAddProp')?.value.trim();
      const val  = panel.querySelector('#inspAddVal')?.value.trim();
      if (prop && val) {
        applyStyleChange(camelCase(prop), val);
        panel.querySelector('#inspAddProp').value = '';
        panel.querySelector('#inspAddVal').value  = '';
      }
    });
    panel.querySelector('#inspAddVal')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') panel.querySelector('#inspApplyNewStyle')?.click();
    });

    // Copy CSS
    panel.querySelector('#copyCssBtn')?.addEventListener('click', () => {
      const lines = Object.entries(computed)
        .filter(([,v]) => v && v !== 'none' && v !== '' && v !== 'initial')
        .map(([k, v]) => `  ${camelToKebab(k)}: ${v};`).join('\n');
      const selector = buildSelector(info);
      navigator.clipboard?.writeText(`${selector} {\n${lines}\n}`).catch(()=>{});
      showToast('Copied CSS ✓');
    });
  }

  /* ---- Box Model ---- */
  function renderBoxModel(info) {
    const wrap = document.getElementById('inspBoxModel');
    if (!wrap) return;
    const c = info.computed || {};
    const r = info.rect    || {};

    const mt = strip(c.marginTop),    mr = strip(c.marginRight),
          mb = strip(c.marginBottom), ml = strip(c.marginLeft);
    const pt = strip(c.paddingTop),   pr = strip(c.paddingRight),
          pb = strip(c.paddingBottom),pl = strip(c.paddingLeft);
    const bt = strip(c.borderTop),    br2 = strip(c.borderRight),
          bb = strip(c.borderBottom), bl = strip(c.borderLeft);
    const w = Math.round(r.width  || 0);
    const h = Math.round(r.height || 0);

    wrap.innerHTML = `
      <div class="insp-bm-outer" title="Margin (orange)">
        <span class="bm-label">margin</span>
        <span class="bm-top">${mt}</span>
        <span class="bm-right">${mr}</span>
        <span class="bm-bottom">${mb}</span>
        <span class="bm-left">${ml}</span>
        <div class="insp-bm-border" title="Border (yellow)">
          <span class="bm-label">border</span>
          <span class="bm-top">${bt}</span>
          <span class="bm-right">${br2}</span>
          <span class="bm-bottom">${bb}</span>
          <span class="bm-left">${bl}</span>
          <div class="insp-bm-padding" title="Padding (green)">
            <span class="bm-label">padding</span>
            <span class="bm-top">${pt}</span>
            <span class="bm-right">${pr}</span>
            <span class="bm-bottom">${pb}</span>
            <span class="bm-left">${pl}</span>
            <div class="insp-bm-content" title="Content (blue)">
              <span class="bm-dim">${w} × ${h}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="insp-bm-legend">
        <span><i class="bm-dot" style="background:#f97316"></i>Margin</span>
        <span><i class="bm-dot" style="background:#eab308"></i>Border</span>
        <span><i class="bm-dot" style="background:#22c55e"></i>Padding</span>
        <span><i class="bm-dot" style="background:#3b82f6"></i>Content</span>
      </div>
    `;
  }

  /* =============================================
     APPLY STYLE CHANGE  →  send to iframe + write back to editor
     ============================================= */
  function applyStyleChange(prop, value) {
    // 1. Apply instantly in iframe via postMessage
    const iframe = document.getElementById('preview');
    if (iframe) {
      try {
        iframe.contentWindow.postMessage({
          type: 'inspector_apply_style',
          path: selectedPath,
          prop: prop,
          value: value,
        }, '*');
      } catch(e){}
    }
    // 2. Write back — inject/update inline style in editor HTML
    writeStyleBack(prop, value);
    // 3. Refresh computed display after short delay
    setTimeout(() => refreshSelected(), 80);
  }

  function applyAttrChange(attr, value) {
    const iframe = document.getElementById('preview');
    if (iframe) {
      try {
        iframe.contentWindow.postMessage({
          type: 'inspector_apply_attr',
          path: selectedPath,
          attr: attr,
          value: value,
        }, '*');
      } catch(e){}
    }
    writeAttrBack(attr, value);
  }

  /* =============================================
     WRITE BACK TO EDITOR SOURCE
     ============================================= */
  function writeStyleBack(prop, value) {
    if (!_onWriteBack || !selectedPath.length) return;
    const vals = window._currentEditorValues;
    if (!vals) return;
    let html = vals.html;
    const cssKebab = camelToKebab(prop);
    const selector = buildSelectorFromPath(selectedPath);

    // Strategy: if element has an id/class, prefer updating style tag; otherwise add inline style
    // For simplicity, we add/update an inline style attribute directly on the matched tag
    const tag = selectedPath[selectedPath.length - 1]?.tag;
    if (!tag) return;

    // Build a regex to find the tag opening in HTML source and inject style
    // This is a best-effort approach — we match the nth occurrence based on path index
    try {
      html = injectInlineStyle(html, selectedPath, cssKebab, value);
      if (_onWriteBack) _onWriteBack(html);
    } catch(e) { console.warn('[Inspector] writeStyleBack failed:', e); }
  }

  function writeAttrBack(attr, value) {
    if (!_onWriteBack || !selectedPath.length) return;
    const vals = window._currentEditorValues;
    if (!vals) return;
    try {
      let html = injectAttrChange(vals.html, selectedPath, attr, value);
      if (_onWriteBack) _onWriteBack(html);
    } catch(e) { console.warn('[Inspector] writeAttrBack failed:', e); }
  }

  function injectInlineStyle(html, path, prop, value) {
    const step = path[path.length - 1];
    if (!step) return html;
    const tag  = step.tag;
    const idx  = step.idx;

    // Find the nth opening tag (handling self-closing and attributes)
    const rx = new RegExp(`<${tag}(\\s[^>]*)?>`, 'gi');
    let count = 0;
    return html.replace(rx, (match, attrs) => {
      if (count !== idx) { count++; return match; }
      count++;
      // Parse existing style attribute
      const styleRx = /\bstyle\s*=\s*["']([^"']*)["']/i;
      const styleMatch = (attrs || '').match(styleRx);
      let existingStyle = styleMatch ? styleMatch[1] : '';

      // Update or add property
      const propRx = new RegExp(prop + '\\s*:[^;]+;?', 'i');
      if (propRx.test(existingStyle)) {
        existingStyle = existingStyle.replace(propRx, `${prop}: ${value};`);
      } else {
        existingStyle = (existingStyle + `; ${prop}: ${value};`).replace(/^;\s*/, '');
      }

      if (styleMatch) {
        return match.replace(styleRx, `style="${existingStyle}"`);
      } else {
        return match.replace(/>$/, ` style="${existingStyle}">`);
      }
    });
  }

  function injectAttrChange(html, path, attr, value) {
    const step = path[path.length - 1];
    if (!step) return html;
    const tag = step.tag;
    const idx = step.idx;
    const rx  = new RegExp(`<${tag}(\\s[^>]*)?>`, 'gi');
    let count = 0;
    return html.replace(rx, (match, attrs) => {
      if (count !== idx) { count++; return match; }
      count++;
      const attrRx = new RegExp(`\\b${attr}\\s*=\\s*["'][^"']*["']`, 'i');
      if (value === '') {
        return match.replace(attrRx, '').replace(/\s+>/, '>');
      }
      if (attrRx.test(match)) {
        return match.replace(attrRx, `${attr}="${value}"`);
      }
      return match.replace(/>$/, ` ${attr}="${value}">`);
    });
  }

  /* =============================================
     REFRESH SELECTED ELEMENT
     ============================================= */
  function refreshSelected() {
    if (!selectedPath.length) return;
    const iframe = document.getElementById('preview');
    if (iframe) {
      try {
        iframe.contentWindow.postMessage({ type: 'inspector_refresh', path: selectedPath }, '*');
      } catch(e){}
    }
  }

  /* =============================================
     PANEL WIRING
     ============================================= */
  function wirePanelButtons() {
    // Tab switching
    document.querySelectorAll('.insp-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.insp-tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.insp-tab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const pane = document.getElementById('itab-' + btn.dataset.itab);
        if (pane) pane.classList.add('active');
      });
    });

    // Pick button
    document.getElementById('inspPickBtn')?.addEventListener('click', () => {
      if (pickMode) { deactivatePicker(); }
      else {
        injectPickerBridgeIfNeeded();
        setTimeout(activatePicker, 100);
      }
    });

    // Refresh
    document.getElementById('inspRefreshBtn')?.addEventListener('click', () => {
      injectPickerBridgeIfNeeded();
      refreshSelected();
    });

    // Copy HTML
    document.getElementById('inspCopyBtn')?.addEventListener('click', () => {
      const pre = document.getElementById('outerHtmlPre');
      if (pre) navigator.clipboard?.writeText(pre.textContent).catch(()=>{});
      showToast('Copied HTML ✓');
    });

    // Close
    document.getElementById('inspCloseBtn')?.addEventListener('click', closeInspector);
  }

  /* =============================================
     INSPECTOR RESIZE HANDLE
     ============================================= */
  function setupInspectorResize() {
    const handle = document.getElementById('inspectorResizeHandle');
    const panel  = document.getElementById('inspectorPanel');
    if (!handle || !panel) return;

    handle.addEventListener('mousedown', (e) => {
      _resizing = true;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'row-resize';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!_resizing) return;
      const previewPanel = document.getElementById('previewPanel');
      if (!previewPanel) return;
      const rect = previewPanel.getBoundingClientRect();
      const newH = Math.max(160, Math.min(rect.bottom - e.clientY, rect.height - 80));
      _inspectorH = newH;
      panel.style.height = newH + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!_resizing) return;
      _resizing = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    });
  }

  /* =============================================
     HELPERS
     ============================================= */
  function esc(str) {
    return String(str || '').replace(/&/g,'&').replace(/</g,'<').replace(/>/g,'>').replace(/"/g,'&quot;');
  }

  function strip(val) {
    if (!val || val === '0px' || val === '0') return '0';
    return val.replace(/(\d+\.\d{2})\d*/g, '$1');
  }

  function isColor(val) {
    return /^(#|rgb|rgba|hsl|hsla|[a-z]+$)/.test(val) && !/inherit|initial|none/.test(val);
  }

  function camelToKebab(str) {
    return str.replace(/([A-Z])/g, g => '-' + g[0].toLowerCase());
  }

  function camelCase(str) {
    return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  }

  function buildSelector(info) {
    let s = info.tag || 'element';
    if (info.id) s += '#' + info.id;
    else if (info.classList?.length) s += '.' + info.classList[0];
    return s;
  }

  function buildSelectorFromPath(path) {
    if (!path.length) return 'element';
    const last = path[path.length - 1];
    return last.tag + ':nth-of-type(' + (last.idx + 1) + ')';
  }

  function nudgeValue(span, delta) {
    const txt = span.textContent;
    const numRx = /(-?\d*\.?\d+)(px|em|rem|%|vh|vw|pt)?/;
    const m = txt.match(numRx);
    if (m) {
      const newVal = (parseFloat(m[1]) + delta).toFixed(m[1].includes('.') ? 1 : 0) + (m[2] || 'px');
      span.textContent = txt.replace(numRx, newVal);
    }
  }

  function showToast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;padding:7px 16px;border-radius:8px;font-size:12px;font-weight:700;z-index:9000;box-shadow:0 4px 14px rgba(0,0,0,.2);pointer-events:none;';
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity='0'; t.style.transition='opacity .3s'; setTimeout(()=>t.remove(),350); }, 1600);
  }

  /* =============================================
     PUBLIC API
     ============================================= */
  return {
    init,
    openInspector,
    closeInspector,
    toggleInspector,
    onPreviewRendered,  // call this after every iframe render
    isOpen: () => isOpen,
  };

})();
