/**
 * editor.js — GeoNarrative Story Editor Logic
 */

(function () {
  'use strict';

  // ── State ─────────────────────────────────────────────────────────
  let story      = null;
  let storyId    = null;
  let activeIdx  = -1;
  let dirty      = false;
  let isLoading  = false;
  let quill      = null;
  let editingLayerId = null;

  // ── Boot ─────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', () => {
    EditorMap.init();
    initQuill();
    bindUI();

    const params  = new URLSearchParams(window.location.search);
    const preload = params.get('story');
    if (preload) {
      document.getElementById('story-selector').value = preload;
      loadStory(preload);
    }
  });

  // ── Quill ─────────────────────────────────────────────────────────

  function initQuill() {
    quill = new Quill('#quill-editor', {
      theme: 'snow',
      placeholder: 'Write your section narrative here...',
      modules: {
        toolbar: [
          ['bold', 'italic', 'underline'],
          [{ list: 'ordered' }, { list: 'bullet' }],
          ['link'],
          ['clean'],
        ],
      },
    });
    quill.on('text-change', () => markDirty());
  }

  // ── Bind UI ───────────────────────────────────────────────────────

  function bindUI() {

    // Story selector
    document.getElementById('story-selector').addEventListener('change', (e) => {
      if (!e.target.value) return;
      if (dirty && !confirm('You have unsaved changes. Load a different story anyway?')) {
        e.target.value = storyId ?? '';
        return;
      }
      loadStory(e.target.value);
    });

    // Tab switching
    document.querySelectorAll('.panel-tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Save
    document.getElementById('btn-save').addEventListener('click', saveStory);

    // Preview
    document.getElementById('btn-preview').addEventListener('click', () => {
      if (!storyId) return showToast('No story loaded.', 'error');
      window.open('index.php?story=' + encodeURIComponent(storyId), '_blank');
    });

    // Delete story
    document.getElementById('btn-delete-story').addEventListener('click', deleteStory);

    // Add section
    document.getElementById('btn-add-section').addEventListener('click', addSection);

    // Capture view
    document.getElementById('btn-capture').addEventListener('click', captureMapView);

    // Section field inputs → mark dirty
    ['field-title','field-navlabel','field-callout',
     'field-scene-label','field-image-src','field-image-alt','field-image-caption',
     'field-lon','field-lat','field-zoom','field-rotation'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => {
        writeFieldsToSection();
        markDirty();
      });
    });

    // Static media fields
    document.getElementById('field-media-type').addEventListener('change', () => {
      updateMediaFieldsVisibility();
      writeFieldsToSection();
      refreshSectionMapOrMedia();
      markDirty();
    });
    ['field-media-src', 'field-media-alt', 'field-media-caption'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', () => {
        writeFieldsToSection();
        refreshSectionMapOrMedia();
        markDirty();
      });
    });

    // Story meta fields
    ['meta-title','meta-subtitle','meta-author'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', () => {
        if (!story) return;
        story.title    = document.getElementById('meta-title').value;
        story.subtitle = document.getElementById('meta-subtitle').value;
        story.author   = document.getElementById('meta-author').value;
        markDirty();
      });
    });

    // Section actions
    document.getElementById('btn-move-up')   .addEventListener('click', () => moveSection(-1));
    document.getElementById('btn-move-down') .addEventListener('click', () => moveSection(1));
    document.getElementById('btn-duplicate') .addEventListener('click', duplicateSection);
    document.getElementById('btn-delete-section').addEventListener('click', deleteSection);

    // New story modal
    document.getElementById('btn-new-story')  .addEventListener('click', () => showModal(true));
    document.getElementById('btn-modal-cancel').addEventListener('click', () => showModal(false));
    document.getElementById('btn-modal-create').addEventListener('click', createNewStory);

    // Warn on unload if dirty
    window.addEventListener('beforeunload', (e) => {
      if (dirty) { e.preventDefault(); e.returnValue = ''; }
    });

    // Ctrl/Cmd+S → save
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveStory();
      }
    });
  }

  // ── Load story ────────────────────────────────────────────────────

  async function loadStory(id) {
    try {
      isLoading = true;
      activeIdx = -1;
      setSaveStatus('loading…', '');

      const res = await fetch('api/stories.php?id=' + encodeURIComponent(id));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      story   = await res.json();
      storyId = id;
      dirty   = false;

      renderMeta();
      renderOutline();
      buildLayerToggles();
      renderLayerManager();
      EditorMap.loadStoryLayers(story);
      selectSection(0);

      dirty     = false;
      isLoading = false;
      setSaveStatus('No changes', '');
      history.replaceState(null, '', '?story=' + id);

    } catch (err) {
      isLoading = false;
      showToast('Failed to load story: ' + err.message, 'error');
      setSaveStatus('Error', '');
    }
  }

  // ── Save story ────────────────────────────────────────────────────

  async function saveStory() {
    if (!story || !storyId) return showToast('No story to save.', 'error');
    writeFieldsToSection();
    setSaveStatus('Saving…', 'saving');
    try {
      const res  = await fetch('api/story-save.php', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id: storyId, story }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? 'Save failed');
      dirty = false;
      setSaveStatus('Saved ✓', 'saved');
      showToast('Story saved successfully.', 'success');
    } catch (err) {
      setSaveStatus('Save failed', '');
      showToast('Save error: ' + err.message, 'error');
    }
  }

  // ── Delete story ──────────────────────────────────────────────────

  async function deleteStory() {
    if (!storyId) return showToast('No story loaded.', 'error');
    const title = story?.title ?? storyId;
    if (!confirm(`Permanently delete "${title}"?\n\nThis cannot be undone.`)) return;

    try {
      const res  = await fetch('api/story-delete.php', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id: storyId }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? 'Delete failed');

      const sel = document.getElementById('story-selector');
      const opt = sel.querySelector(`option[value="${storyId}"]`);
      if (opt) opt.remove();
      sel.value = '';

      story   = null;
      storyId = null;
      dirty   = false;
      activeIdx = -1;

      document.getElementById('section-list').innerHTML = '';
      document.getElementById('story-meta').querySelectorAll('input')
        .forEach(i => i.value = '');
      document.getElementById('section-fields').style.display     = 'none';
      document.getElementById('editor-placeholder').style.display = 'flex';
      document.getElementById('layer-manager').style.display      = 'none';
      document.getElementById('layer-manager-placeholder').style.display = 'flex';
      document.getElementById('layer-toggles').innerHTML = '';
      hideEditorMedia();

      EditorMap.reset();
      setSaveStatus('No changes', '');
      history.replaceState(null, '', 'editor.php');
      showToast(`"${title}" deleted.`, 'success');

    } catch (err) {
      showToast('Delete error: ' + err.message, 'error');
    }
  }

  // ── Render meta ───────────────────────────────────────────────────

  function renderMeta() {
    document.getElementById('meta-title').value    = story.title    ?? '';
    document.getElementById('meta-subtitle').value = story.subtitle ?? '';
    document.getElementById('meta-author').value   = story.author   ?? '';
  }

  // ── Render outline ────────────────────────────────────────────────

  function renderOutline() {
    const list = document.getElementById('section-list');
    list.innerHTML = '';

    (story.sections ?? []).forEach((sec, i) => {
      const item = document.createElement('div');
      item.className = 'outline-item' + (i === activeIdx ? ' active' : '');
      item.dataset.index = i;
      item.draggable = true;
      item.innerHTML = `
        <span class="outline-drag" title="Drag to reorder">⠿</span>
        <span class="outline-num">${i + 1}</span>
        <span class="outline-title">${esc(sec.title ?? sec.navLabel ?? 'Untitled')}</span>
      `;
      item.addEventListener('click', () => selectSection(i));

      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', i);
        item.classList.add('dragging');
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        document.querySelectorAll('.outline-item').forEach(el => el.classList.remove('drag-over'));
      });
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        document.querySelectorAll('.outline-item').forEach(el => el.classList.remove('drag-over'));
        item.classList.add('drag-over');
      });
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
        const toIdx   = i;
        if (fromIdx === toIdx) return;
        writeFieldsToSection();
        const secs  = story.sections;
        const moved = secs.splice(fromIdx, 1)[0];
        secs.splice(toIdx, 0, moved);
        activeIdx = toIdx;
        renderOutline();
        selectSection(toIdx);
        markDirty();
      });

      list.appendChild(item);
    });
  }

  // ── Select section ────────────────────────────────────────────────

  function selectSection(idx) {
    if (!story?.sections) return;
    idx = Math.max(0, Math.min(idx, story.sections.length - 1));
    if (activeIdx >= 0) writeFieldsToSection();
    activeIdx = idx;
    const sec = story.sections[idx];

    document.getElementById('editor-placeholder').style.display = 'none';
    document.getElementById('section-fields').style.display     = 'block';

    const sectionLabel = document.getElementById('editor-section-label');
    if (sectionLabel) {
      sectionLabel.textContent =
        'Section ' + (idx + 1) + ' of ' + story.sections.length;
    }

    // Populate fields
    document.getElementById('field-title').value     = sec.title    ?? '';
    document.getElementById('field-navlabel').value  = sec.navLabel ?? '';
    document.getElementById('field-callout').value   = sec.callout  ?? '';

    quill.root.innerHTML = textToHtml(sec.text ?? '');

    document.getElementById('field-image-src').value     = sec.image?.src     ?? '';
    document.getElementById('field-image-alt').value     = sec.image?.alt     ?? '';
    document.getElementById('field-image-caption').value = sec.image?.caption ?? '';

    const scene = sec.scene ?? {};
    document.getElementById('field-lon').value         = scene.center?.[0] ?? '';
    document.getElementById('field-lat').value         = scene.center?.[1] ?? '';
    document.getElementById('field-zoom').value        = scene.zoom        ?? '';
    document.getElementById('field-rotation').value    = scene.rotation    ?? 0;
    document.getElementById('field-scene-label').value = scene.label       ?? '';

    // Static media fields
    const media = scene.media ?? null;
    document.getElementById('field-media-type').value    = media?.type    ?? '';
    document.getElementById('field-media-src').value     = media?.src     ?? '';
    document.getElementById('field-media-alt').value     = media?.alt     ?? '';
    document.getElementById('field-media-caption').value = media?.caption ?? '';
    updateMediaFieldsVisibility();

    updateLayerToggles(scene.layers ?? []);

    refreshSectionMapOrMedia();

    document.querySelectorAll('.outline-item').forEach((el, i) => {
      el.classList.toggle('active', i === idx);
    });
  }

  // ── Static media field visibility + live preview ──────────────────

  function updateMediaFieldsVisibility() {
    const type   = document.getElementById('field-media-type').value;
    const hasMedia = !!type;

    document.getElementById('media-fields').style.display      = hasMedia ? 'block' : 'none';
    document.getElementById('scene-map-fields').style.display  = hasMedia ? 'none'  : 'block';
    document.getElementById('scene-media-notice').style.display = hasMedia ? 'block' : 'none';
  }

  // Shows either the live editor map or the static media preview,
  // mirroring exactly what the viewer will show for this section.
  function refreshSectionMapOrMedia() {
    const type = document.getElementById('field-media-type').value;
    if (type) {
      const media = {
        type:    type,
        src:     document.getElementById('field-media-src').value,
        alt:     document.getElementById('field-media-alt').value,
        caption: document.getElementById('field-media-caption').value,
      };
      showEditorMedia(media);
    } else {
      hideEditorMedia();
      const sec = story?.sections?.[activeIdx];
      const scene = sec?.scene;
      if (scene?.center) {
        EditorMap.flyTo(scene.center[0], scene.center[1], scene.zoom ?? 11, scene.rotation ?? 0);
      }
      if (scene?.layers) {
        EditorMap.applyVisibility(scene.layers);
      }
    }
  }

  function escAttr(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function showEditorMedia(media) {
    const panel   = document.getElementById('editor-media-panel');
    const content = document.getElementById('editor-media-content');
    const caption = document.getElementById('editor-media-caption');
    if (!panel || !content) return;

    const src = escAttr(media.src ?? '');
    const alt = escAttr(media.alt ?? '');

    if (!media.src) {
      content.innerHTML = '<p style="color:rgba(250,248,244,0.5);font-style:italic;font-size:0.85rem">Enter a media URL to preview it here.</p>';
    } else if (media.type === 'pdf') {
      content.innerHTML = `<iframe src="${src}" title="${alt}"></iframe>`;
    } else {
      content.innerHTML = `<img src="${src}" alt="${alt}" />`;
    }

    caption.textContent = media.caption ?? '';
    panel.classList.add('visible');
  }

  function hideEditorMedia() {
    document.getElementById('editor-media-panel')?.classList.remove('visible');
  }

  // ── Write fields to section ───────────────────────────────────────

  function writeFieldsToSection() {
    if (activeIdx < 0 || !story?.sections) return;
    const sec = story.sections[activeIdx];

    sec.title    = document.getElementById('field-title').value;
    sec.navLabel = document.getElementById('field-navlabel').value;
    sec.callout  = document.getElementById('field-callout').value || undefined;
    sec.text     = htmlToTextArray(quill.root.innerHTML);

    const src = document.getElementById('field-image-src').value;
    if (src) {
      sec.image = {
        src,
        alt:     document.getElementById('field-image-alt').value,
        caption: document.getElementById('field-image-caption').value || undefined,
      };
    } else {
      delete sec.image;
    }

    const lon  = parseFloat(document.getElementById('field-lon').value);
    const lat  = parseFloat(document.getElementById('field-lat').value);
    const zoom = parseFloat(document.getElementById('field-zoom').value);
    const rot  = parseFloat(document.getElementById('field-rotation').value) || 0;
    const lbl  = document.getElementById('field-scene-label').value;

    if (!isNaN(lon) && !isNaN(lat) && !isNaN(zoom)) {
      sec.scene          = sec.scene ?? {};
      sec.scene.center   = [lon, lat];
      sec.scene.zoom     = zoom;
      sec.scene.rotation = rot || undefined;
      sec.scene.label    = lbl || undefined;
    }

    // Static media
    const mediaType = document.getElementById('field-media-type').value;
    if (mediaType) {
      sec.scene = sec.scene ?? {};
      sec.scene.media = {
        type:    mediaType,
        src:     document.getElementById('field-media-src').value,
        alt:     document.getElementById('field-media-alt').value || undefined,
        caption: document.getElementById('field-media-caption').value || undefined,
      };
    } else if (sec.scene) {
      delete sec.scene.media;
    }

    const item = document.querySelector(`.outline-item[data-index="${activeIdx}"] .outline-title`);
    if (item) item.textContent = esc(sec.title ?? sec.navLabel ?? 'Untitled');
  }

  // ── Capture map view ──────────────────────────────────────────────

  function captureMapView() {
    const view = EditorMap.captureView();
    if (!view) return;
    document.getElementById('field-lon').value      = view.lon.toFixed(5);
    document.getElementById('field-lat').value      = view.lat.toFixed(5);
    document.getElementById('field-zoom').value     = view.zoom;
    document.getElementById('field-rotation').value = view.rotation;
    writeFieldsToSection();
    markDirty();
    showToast('Map view captured ✓', 'success');
    const btn = document.getElementById('btn-capture');
    btn.textContent = '✓ Captured!';
    setTimeout(() => btn.textContent = '📍 Capture Current Map View', 1500);
  }

  // ── Layer toggles ─────────────────────────────────────────────────

  function buildLayerToggles() {
    const container = document.getElementById('layer-toggles');
    container.innerHTML = '';
    if (!story?.map) return;

    const basemaps = story.map.basemaps ?? [];
    if (basemaps.length > 0) {
      const groupLabel = document.createElement('div');
      groupLabel.className = 'layer-group-label';
      groupLabel.textContent = 'Basemap';
      container.appendChild(groupLabel);

      basemaps.forEach((ld, i) => {
        const row = document.createElement('div');
        row.className = 'layer-toggle-row';
        row.dataset.layerId = ld.id;
        row.dataset.kind    = 'base';

        const rb = document.createElement('input');
        rb.type    = 'radio';
        rb.name    = 'basemap-select';
        rb.id      = 'lt-' + ld.id;
        rb.checked = (i === 0);
        rb.addEventListener('change', () => { writeLayerVisibility(); markDirty(); });

        const swatch = document.createElement('span');
        swatch.className = 'layer-toggle-swatch';
        swatch.style.background = '#888';

        const lbl = document.createElement('label');
        lbl.htmlFor   = 'lt-' + ld.id;
        lbl.className = 'layer-toggle-label';
        lbl.textContent = ld.label ?? ld.id;

        row.append(rb, swatch, lbl);
        container.appendChild(row);
      });
    }

    const overlays = [
      ...(story.map.wmsLayers    ?? []).map(l => ({ ...l, kind: 'wms' })),
      ...(story.map.vectorLayers ?? []).map(l => ({ ...l, kind: 'vector' })),
    ];

    if (overlays.length > 0) {
      const groupLabel = document.createElement('div');
      groupLabel.className = 'layer-group-label';
      groupLabel.textContent = 'Overlays';
      container.appendChild(groupLabel);

      overlays.forEach(ld => {
        const row = document.createElement('div');
        row.className = 'layer-toggle-row';
        row.dataset.layerId = ld.id;
        row.dataset.kind    = ld.kind;

        const color = ld.style?.fill ?? ld.style?.color ?? ld.color ?? '#2980b9';

        const cb = document.createElement('input');
        cb.type    = 'checkbox';
        cb.id      = 'lt-' + ld.id;
        cb.checked = ld.visible !== false;
        cb.addEventListener('change', () => { writeLayerVisibility(); markDirty(); });

        const swatch = document.createElement('span');
        swatch.className = 'layer-toggle-swatch';
        swatch.style.background = color;

        const lbl = document.createElement('label');
        lbl.htmlFor   = 'lt-' + ld.id;
        lbl.className = 'layer-toggle-label';
        lbl.textContent = ld.label ?? ld.id;

        row.append(cb, swatch, lbl);
        container.appendChild(row);
      });
    }
  }

  function updateLayerToggles(sceneLayers) {
    const visMap = {};
    (sceneLayers ?? []).forEach(l => { visMap[l.id] = l.visible !== false; });

    const basemapIds = (story?.map?.basemaps ?? []).map(b => b.id);
    let activeBase = null;
    (sceneLayers ?? []).forEach(l => {
      if (basemapIds.includes(l.id) && l.visible !== false && activeBase === null) {
        activeBase = l.id;
      }
    });
    if (!activeBase) activeBase = basemapIds[0] ?? null;

    document.querySelectorAll('.layer-toggle-row').forEach(row => {
      const id   = row.dataset.layerId;
      const kind = row.dataset.kind;

      if (kind === 'base') {
        const rb = row.querySelector('input[type=radio]');
        if (rb) rb.checked = (id === activeBase);
      } else {
        const cb = row.querySelector('input[type=checkbox]');
        if (!cb) return;
        if (id in visMap) {
          cb.checked = visMap[id];
        } else {
          const allOverlays = [
            ...(story?.map?.wmsLayers    ?? []),
            ...(story?.map?.vectorLayers ?? []),
          ];
          const def = allOverlays.find(l => l.id === id);
          cb.checked = def ? (def.visible !== false) : true;
        }
      }
    });
  }

  function writeLayerVisibility() {
    if (activeIdx < 0 || !story?.sections) return;
    const sec   = story.sections[activeIdx];
    sec.scene   = sec.scene ?? {};
    const layers = [];

    document.querySelectorAll('.layer-toggle-row').forEach(row => {
      const id   = row.dataset.layerId;
      const kind = row.dataset.kind;
      if (kind === 'base') {
        const rb = row.querySelector('input[type=radio]');
        if (rb && rb.checked) layers.push({ id, visible: true });
      } else {
        const cb = row.querySelector('input[type=checkbox]');
        if (cb) layers.push({ id, visible: cb.checked });
      }
    });

    sec.scene.layers = layers;

    // Only push to the live map if this section isn't showing static media
    if (!sec.scene.media) {
      EditorMap.applyVisibility(layers);
    }
  }

  // ── Section actions ───────────────────────────────────────────────

  function addSection() {
    if (!story) return showToast('Load a story first.', 'error');
    story.sections.push({
      navLabel: 'New Section',
      title:    'New Section',
      text:     ['Start writing your narrative here.'],
      scene:    { center: [-90.09, 38.63], zoom: 11, layers: [] },
    });
    renderOutline();
    selectSection(story.sections.length - 1);
    markDirty();
  }

  function moveSection(delta) {
    if (activeIdx < 0 || !story?.sections) return;
    const newIdx = activeIdx + delta;
    if (newIdx < 0 || newIdx >= story.sections.length) return;
    writeFieldsToSection();
    const secs = story.sections;
    [secs[activeIdx], secs[newIdx]] = [secs[newIdx], secs[activeIdx]];
    activeIdx = newIdx;
    renderOutline();
    selectSection(newIdx);
    markDirty();
  }

  function duplicateSection() {
    if (activeIdx < 0 || !story?.sections) return;
    writeFieldsToSection();
    const copy = JSON.parse(JSON.stringify(story.sections[activeIdx]));
    copy.title    = (copy.title    ?? '') + ' (copy)';
    copy.navLabel = (copy.navLabel ?? '') + ' (copy)';
    story.sections.splice(activeIdx + 1, 0, copy);
    renderOutline();
    selectSection(activeIdx + 1);
    markDirty();
  }

  function deleteSection() {
    if (activeIdx < 0 || !story?.sections) return;
    if (story.sections.length <= 1) {
      return showToast('A story must have at least one section.', 'error');
    }
    if (!confirm('Delete this section? This cannot be undone.')) return;
    story.sections.splice(activeIdx, 1);
    const newIdx = Math.min(activeIdx, story.sections.length - 1);
    activeIdx = -1;
    renderOutline();
    selectSection(newIdx);
    markDirty();
  }

  // ── Tab switching ─────────────────────────────────────────────────

  function switchTab(tabId) {
    document.querySelectorAll('.panel-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-content').forEach(c => {
      c.classList.toggle('active', c.id === 'tab-' + tabId);
    });
  }

  // ── Layer Manager ─────────────────────────────────────────────────

  const DEFAULT_BASEMAPS = [
    { id: 'osm',          type: 'osm',  label: 'OpenStreetMap' },
    { id: 'esri_topo',    type: 'xyz',  label: 'Esri Topo',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles © Esri, HERE, Garmin, FAO, NOAA, USGS' },
    { id: 'esri_street',  type: 'xyz',  label: 'Esri Street',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles © Esri, USGS, HERE, Garmin' },
    { id: 'esri_imagery', type: 'xyz',  label: 'Esri Imagery',
      url: 'https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles © Esri, USGS, Garmin, Earthstar Geographics' },
    { id: 'esri_natgeo',  type: 'xyz',  label: 'Esri NatGeo',
      url: 'https://server.arcgisonline.com/arcgis/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles © Esri, National Geographic, USGS, NASA' },
    { id: 'open_topo',    type: 'xyz',  label: 'OpenTopo',
      url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
      attribution: '© OpenTopoMap contributors' },
  ];

  function renderLayerManager() {
    const placeholder = document.getElementById('layer-manager-placeholder');
    const manager     = document.getElementById('layer-manager');
    if (!story?.map) {
      placeholder.style.display = 'flex';
      manager.style.display     = 'none';
      return;
    }
    placeholder.style.display = 'none';
    manager.style.display     = 'block';

    renderLMBasemaps();
    renderLMOverlays();

    document.getElementById('btn-add-layer').onclick = () => openLayerForm(null);
  }

  function renderLMBasemaps() {
    const list = document.getElementById('lm-basemap-list');
    list.innerHTML = '';

    const note = document.createElement('p');
    note.className   = 'lm-basemap-note';
    note.textContent = 'Select which basemaps are available in this story. ' +
                       'OpenStreetMap is always included as the default fallback.';
    list.appendChild(note);

    const activeIds = new Set((story.map.basemaps ?? []).map(b => b.id));

    DEFAULT_BASEMAPS.forEach(bm => {
      const isOSM     = bm.id === 'osm';
      const isChecked = isOSM || activeIds.has(bm.id);

      const row = document.createElement('div');
      row.className = 'lm-basemap-row';

      const cb = document.createElement('input');
      cb.type     = 'checkbox';
      cb.id       = 'bm-sel-' + bm.id;
      cb.checked  = isChecked;
      cb.disabled = isOSM;
      cb.className = 'lm-basemap-cb';
      cb.addEventListener('change', () => onBasemapSelectionChange());

      const lbl = document.createElement('label');
      lbl.htmlFor   = 'bm-sel-' + bm.id;
      lbl.className = 'lm-basemap-label' + (isOSM ? ' lm-basemap-required' : '');
      lbl.textContent = bm.label + (isOSM ? ' (required)' : '');

      row.append(cb, lbl);
      list.appendChild(row);
    });
  }

  function onBasemapSelectionChange() {
    const newBasemaps = DEFAULT_BASEMAPS.filter(bm => {
      const cb = document.getElementById('bm-sel-' + bm.id);
      return cb ? cb.checked : false;
    });

    story.map.basemaps = newBasemaps;

    const validIds = new Set(newBasemaps.map(b => b.id));
    (story.sections ?? []).forEach(sec => {
      if (sec.scene?.layers) {
        sec.scene.layers = sec.scene.layers.filter(l =>
          !DEFAULT_BASEMAPS.find(b => b.id === l.id) || validIds.has(l.id)
        );
      }
    });

    markDirty();
    buildLayerToggles();
    EditorMap.loadStoryLayers(story);
  }

  function renderLMOverlays() {
    const list = document.getElementById('lm-overlay-list');
    list.innerHTML = '';
    const allOverlays = [
      ...(story.map.wmsLayers    ?? []).map(l => ({ ...l, _registry: 'wms' })),
      ...(story.map.vectorLayers ?? []).map(l => ({ ...l, _registry: 'vector' })),
    ];
    allOverlays.forEach((ld, i) => list.appendChild(makeLMRow(ld, ld._registry, i)));
  }

  function makeLMRow(ld, registry, index) {
    const row = document.createElement('div');
    row.className        = 'lm-row';
    row.dataset.id       = ld.id;
    row.dataset.registry = registry;
    row.dataset.index    = index;

    const isDraggable = (registry !== 'base');
    if (isDraggable) row.draggable = true;

    const color     = ld.style?.fill ?? ld.style?.color ?? ld.color ?? '#888';
    const typeLabel = {
      wms: 'WMS', 'arcgis-rest': 'ArcGIS REST',
      'arcgis-feature': 'ArcGIS Feature',
      'geojson-url': 'GeoJSON', qlr: 'QLR (QGIS style)',
      base: 'Basemap', vector: 'Vector', osm: 'OSM', xyz: 'XYZ',
    };

    row.innerHTML = `
      ${isDraggable ? '<span class="lm-drag-handle" title="Drag to reorder">⠿</span>' : '<span style="width:18px;display:inline-block"></span>'}
      <span class="lm-row-swatch" style="background:${color}"></span>
      <div class="lm-row-info">
        <div class="lm-row-label">${esc(ld.label ?? ld.id)}</div>
        <div class="lm-row-meta">${typeLabel[ld.type ?? registry] ?? registry} · ${esc(ld.id)}</div>
      </div>
      <div class="lm-row-actions">
        ${registry !== 'base'
          ? `<button class="btn-lm-row edit-btn">✏️ Edit</button>
             <button class="btn-lm-row danger del-btn">✕</button>`
          : ''}
      </div>
    `;

    if (registry !== 'base') {
      row.querySelector('.edit-btn').addEventListener('click', () => openLayerForm(ld, registry));
      row.querySelector('.del-btn').addEventListener('click', () => deleteLayer(ld.id, registry));

      row.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', JSON.stringify({ id: ld.id, registry, index }));
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        document.querySelectorAll('.lm-row').forEach(r => r.classList.remove('drag-over'));
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        document.querySelectorAll('.lm-row').forEach(r => r.classList.remove('drag-over'));
        row.classList.add('drag-over');
      });
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        const from = JSON.parse(e.dataTransfer.getData('text/plain'));
        if (from.id === ld.id) return;
        reorderLayer(from.id, from.registry, ld.id, registry);
      });
    }

    return row;
  }

  function reorderLayer(fromId, fromRegistry, toId, toRegistry) {
    const getArr = (reg) => reg === 'wms'
      ? (story.map.wmsLayers    ?? [])
      : (story.map.vectorLayers ?? []);

    const fromArr = getArr(fromRegistry);
    const toArr   = getArr(toRegistry);
    const fromIdx = fromArr.findIndex(l => l.id === fromId);
    const toIdx   = toArr.findIndex(l => l.id === toId);

    if (fromIdx < 0 || toIdx < 0) return;

    if (fromRegistry === toRegistry) {
      const [moved] = fromArr.splice(fromIdx, 1);
      fromArr.splice(toIdx, 0, moved);
    } else {
      const [moved] = fromArr.splice(fromIdx, 1);
      if (fromRegistry === 'wms') {
        story.map.wmsLayers = fromArr;
        toArr.splice(toIdx, 0, moved);
        story.map.vectorLayers = toArr;
      } else {
        story.map.vectorLayers = fromArr;
        toArr.splice(toIdx, 0, moved);
        story.map.wmsLayers = toArr;
      }
    }

    markDirty();
    EditorMap.loadStoryLayers(story);
    renderLayerManager();
    buildLayerToggles();
    showToast('Layer order updated.', 'success');
  }

  // ── Layer form ────────────────────────────────────────────────────

  function openLayerForm(ld, registry) {
    document.getElementById('layer-manager').style.display = 'none';
    document.getElementById('layer-form').style.display    = 'block';
    document.getElementById('layer-form-title').textContent = ld ? 'Edit Layer' : 'Add Layer';
    editingLayerId = ld ? ld.id : null;

    document.getElementById('lf-id').value             = ld?.id        ?? '';
    document.getElementById('lf-label').value          = ld?.label     ?? '';
    document.getElementById('lf-geom-type').value      = ld?.style?.type ?? 'polygon';
    document.getElementById('lf-fill-color').value     = rgbaToHex(ld?.style?.fill    ?? '#2980b9');
    document.getElementById('lf-stroke-color').value   = rgbaToHex(ld?.style?.stroke  ?? '#1a5276');
    document.getElementById('lf-fill-opacity').value   = ld?.style?.fillOpacity ?? 0.2;
    document.getElementById('lf-label-field').value    = ld?.style?.label?.field ?? '';
    document.getElementById('lf-min-zoom').value       = ld?.minZoom ?? '';
    document.getElementById('lf-max-zoom').value       = ld?.maxZoom ?? '';

    // Detect layer type — including qlr which was previously mapped
    // incorrectly to 'geojson-url', causing edits to strip the QLR style.
    let ltype = 'wms';
    if (registry === 'vector') {
      if      (ld?.type === 'arcgis-feature') ltype = 'arcgis-feature';
      else if (ld?.type === 'qlr')            ltype = 'qlr';
      else                                    ltype = 'geojson-url';
    } else if (ld?.type === 'arcgis-rest')    ltype = 'arcgis-rest';
    document.getElementById('lf-type').value = ltype;

    // Standard type-specific fields
    document.getElementById('lf-wms-url').value          = ld?.url     ?? '';
    document.getElementById('lf-wms-layers').value       = ld?.layers  ?? '';
    document.getElementById('lf-wms-version').value      = ld?.version ?? '1.3.0';
    document.getElementById('lf-wms-format').value       = ld?.format  ?? 'image/png';
    document.getElementById('lf-agr-url').value          = ld?.url     ?? '';
    document.getElementById('lf-agr-layers').value       = ld?.layers  ?? '';
    document.getElementById('lf-agf-url').value          = ld?.url     ?? '';
    document.getElementById('lf-agf-label-field').value  = ld?.style?.label?.field ?? '';
    document.getElementById('lf-geojson-url').value      = ld?.url     ?? '';

    // ── QLR fields — always clear file inputs (they can't be pre-filled
    //    for security reasons), but restore URL and labels state ────────
    const qlrFile = document.getElementById('lf-qlr-file');
    if (qlrFile) qlrFile.value = '';
    const qlrGeoFile = document.getElementById('lf-qlr-geojson-file');
    if (qlrGeoFile) qlrGeoFile.value = '';

    const parseStatus = document.getElementById('lf-qlr-parse-status');
    if (parseStatus) {
      parseStatus.textContent = ld?.type === 'qlr' && ld?.qlrUrl
        ? 'Existing: ' + ld.qlrUrl + ' — upload a new file to replace it.'
        : '';
      parseStatus.className = 'lf-parse-status info';
    }

    const qlrGeoUrl = document.getElementById('lf-qlr-geojson-url');
    if (qlrGeoUrl) qlrGeoUrl.value = (ld?.type === 'qlr' ? ld?.url ?? '' : '');

    const qlrLabels = document.getElementById('lf-qlr-labels');
    if (qlrLabels) {
      qlrLabels.checked  = ld?.labelsEnabled === true;
      qlrLabels.disabled = false;  // will be updated by parse if user picks a new file
    }

    const labelHint = document.getElementById('lf-qlr-label-hint');
    if (labelHint) { labelHint.textContent = ''; labelHint.className = 'lf-parse-status'; }

    updateLayerFormFields();
    bindLayerFormEvents();
  }

  function bindLayerFormEvents() {
    document.getElementById('lf-type').onchange = () => {
      // Warn if user is switching AWAY from QLR — style will be lost
      const currentType = document.getElementById('lf-type').value;
      if (editingLayerId && currentType !== 'qlr') {
        const orig = [
          ...(story.map.wmsLayers    ?? []),
          ...(story.map.vectorLayers ?? []),
        ].find(l => l.id === editingLayerId);
        if (orig?.type === 'qlr') {
          if (!confirm('Changing the layer type will remove the imported QGIS styling.\n\nThe layer will use a generic style instead.\n\nContinue?')) {
            document.getElementById('lf-type').value = 'qlr';
            return;
          }
        }
      }
      updateLayerFormFields();
    };
    // Warn if geometry type is changed while editing a QLR layer
    document.getElementById('lf-geom-type').onchange = () => {
      if (editingLayerId) {
        const orig = [
          ...(story.map.wmsLayers    ?? []),
          ...(story.map.vectorLayers ?? []),
        ].find(l => l.id === editingLayerId);
        if (orig?.type === 'qlr') {
          if (!confirm('Changing the geometry type while editing a QLR layer has no effect - the QGIS QLR file defines the style.\n\nContinue anyway?')) {
            return;
          }
        }
      }
      updateLayerFormFields();
    };
    document.getElementById('btn-layer-form-cancel').onclick = closeLayerForm;
    document.getElementById('btn-layer-form-save').onclick   = saveLayerForm;

    const fileInput = document.getElementById('lf-geojson-file');
    fileInput.onchange = () => {
      const fname = fileInput.files[0]?.name ?? '';
      document.getElementById('lf-geojson-filename').value = fname;
    };

    // QLR file → parse client-side to pre-fill label/id and detect labels
    const qlrFileInput = document.getElementById('lf-qlr-file');
    qlrFileInput.onchange = () => {
      const f = qlrFileInput.files[0];
      if (!f) return;
      const status = document.getElementById('lf-qlr-parse-status');
      const labelHint = document.getElementById('lf-qlr-label-hint');
      status.textContent = 'Parsing QLR…';
      status.className   = 'lf-parse-status info';

      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const parsed = await QLREngine.parseQLR(e.target.result);

          // Pre-fill layer label and ID from the QLR's layer name
          const safeId = parsed.layerName.toLowerCase()
            .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
          if (!document.getElementById('lf-label').value) {
            document.getElementById('lf-label').value = parsed.layerName;
          }
          if (!document.getElementById('lf-id').value) {
            document.getElementById('lf-id').value = safeId;
          }

          // Show datasource if the QLR has one
          const dsUrl = document.getElementById('lf-qlr-geojson-url');
          if (!dsUrl.value && parsed.datasource) {
            dsUrl.placeholder = 'Detected: ' + parsed.datasource + ' (leave blank to use it)';
          }

          // Labels
          if (parsed.hasLabeling && parsed.labelConfig?.fieldName) {
            document.getElementById('lf-qlr-labels').disabled = false;
            document.getElementById('lf-qlr-labels').checked  = parsed.labelsEnabled;
            labelHint.textContent = `Labels available on field "${parsed.labelConfig.fieldName}"`;
            labelHint.className   = 'lf-parse-status ok';
          } else {
            document.getElementById('lf-qlr-labels').disabled = true;
            document.getElementById('lf-qlr-labels').checked  = false;
            labelHint.textContent = 'No labels defined in this QLR.';
            labelHint.className   = 'lf-parse-status';
          }

          status.textContent = `✓ Parsed: ${parsed.geometryType} — ${parsed.layerName}`;
          status.className   = 'lf-parse-status ok';

        } catch (err) {
          status.textContent = '✕ Parse error: ' + err.message;
          status.className   = 'lf-parse-status error';
        }
      };
      reader.readAsText(f);
    };
  }

  function updateLayerFormFields() {
    const ltype    = document.getElementById('lf-type').value;
    const geomType = document.getElementById('lf-geom-type').value;
    document.querySelectorAll('.lf-type-fields').forEach(el => {
      el.classList.toggle('active', el.dataset.for === ltype);
    });
    // QLR layers get their own style from the QLR file — hide the
    // generic style fields entirely.
    const isRaster = (ltype === 'wms' || ltype === 'arcgis-rest' || geomType === 'raster' || ltype === 'qlr');
    document.querySelector('.lf-style-vector').classList.toggle('hidden', isRaster);

    // Also hide the geometry-type selector for QLR — it's implicit in the file
    document.querySelector('#lf-geom-type')?.closest('.field-group')
      ?.style && (document.querySelector('#lf-geom-type').closest('.field-group').style.display =
        ltype === 'qlr' ? 'none' : '');
  }

  function closeLayerForm() {
    document.getElementById('layer-form').style.display    = 'none';
    document.getElementById('layer-manager').style.display = 'block';
    editingLayerId = null;
  }

  async function saveLayerForm() {
    const ltype    = document.getElementById('lf-type').value;
    const id       = document.getElementById('lf-id').value.trim().replace(/[^a-zA-Z0-9_]/g, '_');
    const label    = document.getElementById('lf-label').value.trim();
    const geomType = document.getElementById('lf-geom-type').value;
    const minZoom  = document.getElementById('lf-min-zoom').value;
    const maxZoom  = document.getElementById('lf-max-zoom').value;

    if (!id)    return showToast('Layer ID is required.', 'error');
    if (!label) return showToast('Display label is required.', 'error');

    if (!editingLayerId) {
      const allIds = [
        ...(story.map.wmsLayers    ?? []),
        ...(story.map.vectorLayers ?? []),
      ].map(l => l.id);
      if (allIds.includes(id)) return showToast('Layer ID already exists.', 'error');
    }

    const layerCfg = { id, label, visible: true, showInPanel: true };
    if (minZoom) layerCfg.minZoom = parseFloat(minZoom);
    if (maxZoom) layerCfg.maxZoom = parseFloat(maxZoom);

    // QLR layers get their style from the engine — never set generic style
    // on them; it would be stored in JSON and cause confusion on re-edit.
    if (geomType !== 'raster' && ltype !== 'wms' && ltype !== 'arcgis-rest' && ltype !== 'qlr') {
      const fillColor   = document.getElementById('lf-fill-color').value;
      const fillOpacity = parseFloat(document.getElementById('lf-fill-opacity').value);
      const strokeColor = document.getElementById('lf-stroke-color').value;
      const labelField  = document.getElementById('lf-label-field').value.trim();
      layerCfg.style    = {
        type: geomType,
        fill: hexToRgba(fillColor, fillOpacity),
        stroke: strokeColor,
        strokeWidth: 1.5,
      };
      if (labelField) {
        layerCfg.style.label = {
          field: labelField, font: '12px Calibri,sans-serif',
          fill: '#000000', haloColor: '#ffffff', haloWidth: 3,
        };
      }
    }

    let registry = 'wms';

    if (ltype === 'wms') {
      layerCfg.url     = document.getElementById('lf-wms-url').value.trim();
      layerCfg.layers  = document.getElementById('lf-wms-layers').value.trim();
      layerCfg.version = document.getElementById('lf-wms-version').value;
      layerCfg.format  = document.getElementById('lf-wms-format').value;
      layerCfg.transparent = true;
      if (!layerCfg.url) return showToast('WMS URL is required.', 'error');

    } else if (ltype === 'arcgis-rest') {
      layerCfg.type   = 'arcgis-rest';
      layerCfg.url    = document.getElementById('lf-agr-url').value.trim();
      layerCfg.layers = document.getElementById('lf-agr-layers').value.trim();
      if (!layerCfg.url) return showToast('MapServer URL is required.', 'error');

    } else if (ltype === 'arcgis-feature') {
      layerCfg.type = 'arcgis-feature';
      layerCfg.url  = document.getElementById('lf-agf-url').value.trim();
      const agfLF   = document.getElementById('lf-agf-label-field').value.trim();
      if (agfLF) {
        layerCfg.style = layerCfg.style ?? { type: geomType };
        layerCfg.style.label = {
          field: agfLF, font: '12px Calibri,sans-serif',
          fill: '#000000', haloColor: '#ffffff', haloWidth: 3,
        };
      }
      if (!layerCfg.url) return showToast('FeatureServer URL is required.', 'error');
      registry = 'vector';

    } else if (ltype === 'geojson-url') {
      layerCfg.url = document.getElementById('lf-geojson-url').value.trim();
      if (!layerCfg.url) return showToast('GeoJSON URL is required.', 'error');
      registry = 'vector';

    } else if (ltype === 'qlr') {
      // Upload the .qlr file first
      const qlrInput    = document.getElementById('lf-qlr-file');
      const qlrExisting = editingLayerId ? (story.map.vectorLayers ?? []).find(l => l.id === editingLayerId)?.qlrUrl : null;

      if (!qlrInput.files[0] && !qlrExisting) {
        return showToast('Please select a .qlr file.', 'error');
      }

      if (qlrInput.files[0]) {
        // Upload QLR
        try {
          const fname    = qlrInput.files[0].name;
          const safeBase = fname.replace(/\.qlr$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_');
          const formData = new FormData();
          formData.append('file',     qlrInput.files[0]);
          formData.append('filename', safeBase);
          const res  = await fetch('api/upload-qlr.php', { method: 'POST', body: formData });
          const data = await res.json();
          if (!res.ok || data.error) throw new Error(data.error ?? 'QLR upload failed');
          layerCfg.qlrUrl = data.url;
        } catch (err) {
          return showToast('QLR upload error: ' + err.message, 'error');
        }
      } else {
        layerCfg.qlrUrl = qlrExisting;  // keep existing on edit
      }

      layerCfg.type           = 'qlr';
      layerCfg.labelsEnabled  = document.getElementById('lf-qlr-labels').checked;

      // Optional GeoJSON override
      const qlrGeoUrl  = document.getElementById('lf-qlr-geojson-url').value.trim();
      const qlrGeoFile = document.getElementById('lf-qlr-geojson-file');

      if (qlrGeoFile.files[0]) {
        // Upload GeoJSON override
        try {
          const fname    = qlrGeoFile.files[0].name;
          const formData = new FormData();
          formData.append('file',     qlrGeoFile.files[0]);
          formData.append('filename', fname);
          const res  = await fetch('api/upload-geojson.php', { method: 'POST', body: formData });
          const data = await res.json();
          if (!res.ok || data.error) throw new Error(data.error ?? 'GeoJSON upload failed');
          layerCfg.url = data.url;
        } catch (err) {
          return showToast('GeoJSON upload error: ' + err.message, 'error');
        }
      } else if (qlrGeoUrl) {
        layerCfg.url = qlrGeoUrl;
      }
      // If no GeoJSON override, leave cfg.url empty — map.js will use
      // the datasource embedded in the QLR file.

      registry = 'vector';

    } else if (ltype === 'geojson-upload') {
      const fileInput = document.getElementById('lf-geojson-file');
      const filename  = document.getElementById('lf-geojson-filename').value.trim();
      if (!fileInput.files[0]) return showToast('Please select a GeoJSON file.', 'error');
      if (!filename)           return showToast('Filename is required.', 'error');

      const progress = document.getElementById('lf-upload-progress');
      if (progress) progress.textContent = 'Uploading…';
      try {
        const formData = new FormData();
        formData.append('file', fileInput.files[0]);
        formData.append('filename', filename);
        const res  = await fetch('api/upload-geojson.php', { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error ?? 'Upload failed');
        layerCfg.url = data.url;
        if (progress) progress.textContent = '✓ Uploaded';
      } catch (err) {
        if (document.getElementById('lf-upload-progress'))
          document.getElementById('lf-upload-progress').textContent = '';
        return showToast('Upload error: ' + err.message, 'error');
      }
      registry = 'vector';
    }

    story.map.wmsLayers    = story.map.wmsLayers    ?? [];
    story.map.vectorLayers = story.map.vectorLayers ?? [];

    if (editingLayerId) {
      const arr = registry === 'wms' ? story.map.wmsLayers : story.map.vectorLayers;
      const idx = arr.findIndex(l => l.id === editingLayerId);
      if (idx >= 0) arr[idx] = layerCfg;
    } else {
      if (registry === 'wms') story.map.wmsLayers.push(layerCfg);
      else                    story.map.vectorLayers.push(layerCfg);
    }

    markDirty();
    buildLayerToggles();

    // If a section is active, add the new layer to its scene layers
    // so it shows up (checked) in the Layer Visibility toggles immediately.
    // Without this, the layer exists in the story map but not in the
    // current section's layers array, making the toggle appear unchecked.
    if (!editingLayerId && activeIdx >= 0 && story.sections?.[activeIdx]) {
      const sec = story.sections[activeIdx];
      sec.scene = sec.scene ?? {};
      sec.scene.layers = sec.scene.layers ?? [];
      // Only add if not already present
      if (!sec.scene.layers.find(l => l.id === layerCfg.id)) {
        sec.scene.layers.push({ id: layerCfg.id, visible: true });
      }
      updateLayerToggles(sec.scene.layers);
    }

    EditorMap.loadStoryLayers(story);
    closeLayerForm();
    renderLayerManager();
    showToast('Layer saved ✓', 'success');
  }

  function deleteLayer(id, registry) {
    if (!confirm(`Delete layer "${id}"? This cannot be undone.`)) return;
    if (registry === 'wms') {
      story.map.wmsLayers = (story.map.wmsLayers ?? []).filter(l => l.id !== id);
    } else {
      story.map.vectorLayers = (story.map.vectorLayers ?? []).filter(l => l.id !== id);
    }
    (story.sections ?? []).forEach(sec => {
      if (sec.scene?.layers) {
        sec.scene.layers = sec.scene.layers.filter(l => l.id !== id);
      }
    });
    markDirty();
    buildLayerToggles();
    EditorMap.loadStoryLayers(story);
    renderLayerManager();
    showToast(`Layer "${id}" deleted.`, 'success');
  }

  // ── New story modal ───────────────────────────────────────────────

  function showModal(show) {
    document.getElementById('modal-overlay').style.display = show ? 'flex' : 'none';
    if (show) document.getElementById('new-story-id').focus();
  }

  async function createNewStory() {
    const id     = document.getElementById('new-story-id').value.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    const title  = document.getElementById('new-story-title').value.trim();
    const author = document.getElementById('new-story-author').value.trim();

    if (!id)    return showToast('File name is required.', 'error');
    if (!title) return showToast('Story title is required.', 'error');

    const newStory = {
      title, subtitle: '', author,
      map: {
        center: [-90.09, 38.63], zoom: 11,
        basemaps: [
          {
            id: 'osm', type: 'osm', label: 'OpenStreetMap'
          },
          {
            id: 'esri_topo', type: 'xyz', label: 'Esri Topo',
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
            attribution: 'Tiles © Esri, HERE, Garmin, FAO, NOAA, USGS'
          },
          {
            id: 'esri_street', type: 'xyz', label: 'Esri Street',
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
            attribution: 'Tiles © Esri, USGS, HERE, Garmin'
          },
          {
            id: 'esri_imagery', type: 'xyz', label: 'Esri Imagery',
            url: 'https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            attribution: 'Tiles © Esri, USGS, Garmin, Earthstar Geographics'
          },
          {
            id: 'esri_natgeo', type: 'xyz', label: 'Esri NatGeo',
            url: 'https://server.arcgisonline.com/arcgis/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}',
            attribution: 'Tiles © Esri, National Geographic, USGS, NASA'
          },
          {
            id: 'open_topo', type: 'xyz', label: 'OpenTopo',
            url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png',
            attribution: '© OpenTopoMap contributors'
          },
        ],
        wmsLayers: [], vectorLayers: [],
      },
      sections: [{
        navLabel: 'Introduction', title,
        text: ['Start writing your story here.'],
        scene: { center: [-90.09, 38.63], zoom: 11, layers: [] },
      }],
    };

    try {
      const res  = await fetch('api/story-save.php', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, story: newStory }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? 'Create failed');

      showModal(false);
      showToast('Story created!', 'success');

      const sel = document.getElementById('story-selector');
      const opt = document.createElement('option');
      opt.value = id; opt.textContent = title;
      sel.appendChild(opt);
      sel.value = id;
      await loadStory(id);

    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  }

  // ── Dirty state ───────────────────────────────────────────────────

  function markDirty() {
    if (isLoading) return;
    dirty = true;
    setSaveStatus('Unsaved changes', 'dirty');
  }

  function setSaveStatus(text, cls) {
    const el = document.getElementById('save-status');
    el.textContent = text;
    el.className   = cls;
  }

  // ── Toast ─────────────────────────────────────────────────────────

  let toastTimer = null;

  function showToast(msg, type = '') {
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.className   = 'show ' + type;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
  }

  // ── Color helpers ─────────────────────────────────────────────────

  function hexToRgba(hex, opacity = 1) {
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    return `rgba(${r},${g},${b},${opacity})`;
  }

  function rgbaToHex(color) {
    if (!color) return '#2980b9';
    if (color.startsWith('#')) return color;
    const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return '#2980b9';
    return '#' + [m[1],m[2],m[3]]
      .map(n => parseInt(n).toString(16).padStart(2,'0')).join('');
  }

  // ── Helpers ───────────────────────────────────────────────────────

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function htmlToTextArray(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    const paras = [];
    div.querySelectorAll('p').forEach(p => {
      const t = p.textContent.trim();
      if (t) paras.push(p.innerHTML.trim());
    });
    return paras.length ? paras : [div.textContent.trim()];
  }

  function textToHtml(text) {
    const decode = str => {
      const el = document.createElement('textarea');
      el.innerHTML = str;
      return el.value;
    };
    if (Array.isArray(text)) {
      return text.map(p => `<p>${decode(p)}</p>`).join('');
    }
    return text.split(/\n\n+/).map(p => `<p>${decode(p.trim())}</p>`).join('');
  }

})();