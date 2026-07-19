/**
 * map.js — OpenLayers Map Controller
 * Handles map init, layer management, WMS, GeoJSON, fly animation, popups
 */

const MapController = (() => {

  // ── Internal state ──────────────────────────────────────────────
  let map = null;
  let popupOverlay = null;
  let vectorLayers = {};   // id → ol.layer.Vector
  let wmsLayers    = {};   // id → ol.layer.Tile (WMS / ArcGIS REST)
  let baseLayers   = {};   // id → ol.layer.Tile (basemap)
  let activeBaseId = null;

  // ── Vector source registry (label layers share parent sources) ───
  const vectorSources = {};

  // ── Default style helpers ────────────────────────────────────────

  function makePointStyle(cfg = {}) {
    return new ol.style.Style({
      image: new ol.style.Circle({
        radius: cfg.radius ?? 7,
        fill:   new ol.style.Fill({ color: cfg.fill ?? '#c0392b' }),
        stroke: new ol.style.Stroke({ color: cfg.stroke ?? '#fff', width: cfg.strokeWidth ?? 2 }),
      }),
    });
  }

  function makeLineStyle(cfg = {}) {
    return new ol.style.Style({
      stroke: new ol.style.Stroke({
        color: cfg.color ?? '#2980b9',
        width: cfg.width ?? 2,
        lineDash: cfg.dash ?? undefined,
      }),
    });
  }

  // makePolygonStyle returns either a static Style or a style FUNCTION
  // when a label config is present.
  function makePolygonStyle(cfg = {}) {
    const baseStyle = new ol.style.Style({
      fill:   new ol.style.Fill({ color: cfg.fill ?? 'rgba(41,128,185,0.15)' }),
      stroke: new ol.style.Stroke({ color: cfg.stroke ?? '#2980b9', width: cfg.strokeWidth ?? 1.5 }),
    });

    if (!cfg.label) return baseStyle;

    const labelCfg = cfg.label;
    const labelStyle = new ol.style.Style({
      text: new ol.style.Text({
        font:     labelCfg.font     ?? '12px Calibri,sans-serif',
        overflow: labelCfg.overflow !== false,
        fill:     new ol.style.Fill({ color: labelCfg.fill  ?? '#000000' }),
        stroke:   new ol.style.Stroke({
          color: labelCfg.haloColor ?? '#ffffff',
          width: labelCfg.haloWidth ?? 3,
        }),
      }),
    });

    const field    = labelCfg.field    ?? 'name';
    const maxWidth = labelCfg.maxWidth ?? 16;

    return function (feature) {
      const raw  = feature.get(field) ?? '';
      const text = stringDivider(raw, maxWidth, '\n');
      labelStyle.getText().setText(text);
      return [baseStyle, labelStyle];
    };
  }

  // Label-only style: renders only text, no fill or stroke on the geometry.
  function makeLabelOnlyStyle(cfg) {
    const labelStyle = new ol.style.Style({
      text: new ol.style.Text({
        font:     cfg.font     ?? '12px Calibri,sans-serif',
        overflow: cfg.overflow !== false,
        fill:     new ol.style.Fill({ color: cfg.fill       ?? '#000000' }),
        stroke:   new ol.style.Stroke({
          color: cfg.haloColor ?? '#ffffff',
          width: cfg.haloWidth ?? 3,
        }),
      }),
    });

    const field    = cfg.field    ?? 'name';
    const maxWidth = cfg.maxWidth ?? 16;

    return function (feature) {
      const raw = feature.get(field) ?? '';
      labelStyle.getText().setText(stringDivider(raw, maxWidth, '\n'));
      return [labelStyle];
    };
  }

  // ── String divider (word-wrap helper for map labels) ─────────────
  function stringDivider(str, width, separator) {
    if (!str || str.length <= width) return str;
    let p = width;
    while (p > 0 && str[p] !== ' ') p--;
    if (p > 0) {
      const left  = str.substring(0, p);
      const right = str.substring(p + 1);
      return left + separator + stringDivider(right, width, separator);
    }
    return str;
  }

  function styleFromConfig(styleCfg) {
    if (!styleCfg) return null;
    switch (styleCfg.type) {
      case 'point':   return makePointStyle(styleCfg);
      case 'line':    return makeLineStyle(styleCfg);
      case 'polygon': return makePolygonStyle(styleCfg);
      default:        return null;
    }
  }

  // ── Build basemap layer ──────────────────────────────────────────

  function buildBasemap(cfg) {
    const type = cfg.type ?? 'xyz';
    if (type === 'xyz') {
      return new ol.layer.Tile({
        source: new ol.source.XYZ({ url: cfg.url, attributions: cfg.attribution ?? '' }),
        visible: true,
      });
    }
    if (type === 'osm') {
      return new ol.layer.Tile({ source: new ol.source.OSM() });
    }
    if (type === 'wms') {
      return buildWMSLayer(cfg);
    }
    return new ol.layer.Tile({ source: new ol.source.OSM() });
  }

  // ── Build WMS layer ──────────────────────────────────────────────

  function buildWMSLayer(cfg) {
    const params = {
      LAYERS:  cfg.layers,
      TILED:   true,
      VERSION: cfg.version ?? '1.3.0',
      FORMAT:  cfg.format  ?? 'image/png',
      TRANSPARENT: cfg.transparent ?? true,
    };
    if (cfg.styles)     params.STYLES     = cfg.styles;
    if (cfg.cql_filter) params.CQL_FILTER = cfg.cql_filter;
    if (cfg.sld_body)   params.SLD_BODY   = cfg.sld_body;

    const layerOpts = {
      opacity: cfg.opacity ?? 1,
      visible: cfg.visible !== false,
      source: new ol.source.TileWMS({
        url:         cfg.url,
        params:      params,
        serverType:  cfg.serverType ?? 'geoserver',
        crossOrigin: 'anonymous',
        attributions: cfg.attribution ?? '',
      }),
    };
    if (cfg.minZoom !== undefined) layerOpts.minZoom = cfg.minZoom;
    if (cfg.maxZoom !== undefined) layerOpts.maxZoom = cfg.maxZoom;

    return new ol.layer.Tile(layerOpts);
  }

  // ── Build ArcGIS REST (tiled map service) layer ─────────────────

  function buildArcGISRestLayer(cfg) {
    const layerOpts = {
      opacity: cfg.opacity ?? 1,
      visible: cfg.visible !== false,
      source:  new ol.source.TileArcGISRest({
        url:         cfg.url,
        params:      cfg.layers ? { LAYERS: 'show:' + cfg.layers } : {},
        crossOrigin: 'anonymous',
        attributions: cfg.attribution ?? '',
      }),
    };
    if (cfg.minZoom !== undefined) layerOpts.minZoom = cfg.minZoom;
    if (cfg.maxZoom !== undefined) layerOpts.maxZoom = cfg.maxZoom;
    return new ol.layer.Tile(layerOpts);
  }

  // ── Build ArcGIS Feature Service layer ───────────────────────────

  function buildArcGISFeatureLayer(cfg) {
    const source = new ol.source.Vector({
      loader: function (extent, resolution, projection, success, failure) {
        const url = cfg.url + '/query?where=1%3D1&outFields=*&f=geojson&inSR=4326&outSR=4326';
        fetch(url)
          .then(r => r.json())
          .then(geojson => {
            const features = new ol.format.GeoJSON().readFeatures(geojson, {
              featureProjection: projection,
            });
            source.addFeatures(features);
            success(features);
          })
          .catch(() => failure());
      },
      strategy: ol.loadingstrategy.all,
    });

    vectorSources[cfg.id] = source;

    let styleFn;
    if (cfg.style?.type === 'label') {
      styleFn = makeLabelOnlyStyle(cfg.style);
    } else {
      styleFn = styleFromConfig(cfg.style);
    }

    const layerOpts = {
      source,
      visible: cfg.visible !== false,
      opacity: cfg.opacity ?? 1,
      style:   styleFn || undefined,
    };
    if (cfg.minZoom !== undefined) layerOpts.minZoom = cfg.minZoom;
    if (cfg.maxZoom !== undefined) layerOpts.maxZoom = cfg.maxZoom;
    return new ol.layer.Vector(layerOpts);
  }

  // ── Build GeoJSON vector layer ───────────────────────────────────
  // Supports two modes:
  //   Normal:  cfg.url or cfg.data  → loads its own GeoJSON source
  //   Label:   cfg.labelsFor        → shares the source of another vector
  //            layer (no double download). Use with style.type = "label".

  function buildVectorLayer(cfg) {
    let source;

    if (cfg.labelsFor) {
      source = vectorSources[cfg.labelsFor] ?? new ol.source.Vector();
    } else if (cfg.data) {
      source = new ol.source.Vector({
        features: new ol.format.GeoJSON().readFeatures(cfg.data, {
          featureProjection: 'EPSG:3857',
        }),
      });
    } else if (cfg.url) {
      source = new ol.source.Vector({
        url:    cfg.url,
        format: new ol.format.GeoJSON(),
      });
    } else {
      source = new ol.source.Vector();
    }

    vectorSources[cfg.id] = source;

    let styleFn;
    if (cfg.style?.type === 'label') {
      styleFn = makeLabelOnlyStyle(cfg.style);
    } else {
      styleFn = styleFromConfig(cfg.style);
    }

    const layerOpts = {
      source,
      visible: cfg.visible !== false,
      opacity: cfg.opacity ?? 1,
      style:   styleFn || undefined,
    };
    if (cfg.minZoom !== undefined) layerOpts.minZoom = cfg.minZoom;
    if (cfg.maxZoom !== undefined) layerOpts.maxZoom = cfg.maxZoom;

    return new ol.layer.Vector(layerOpts);
  }

  // ── Build QLR-styled vector layer ───────────────────────────────
  // Fetches the QLR file, runs QLREngine.parseQLR(), and returns an
  // ol.layer.Vector with the QGIS-accurate style function applied.
  // The layer is added asynchronously after the map is created so the
  // rest of the init flow stays synchronous.

  async function buildQLRLayer(cfg) {
    const qlrRes  = await fetch(cfg.qlrUrl);
    if (!qlrRes.ok) throw new Error(`QLR fetch failed: ${qlrRes.status} ${cfg.qlrUrl}`);
    const qlrText = await qlrRes.text();
    const parsed  = await QLREngine.parseQLR(qlrText);

    // cfg.url overrides the datasource baked into the QLR (e.g. a filtered query URL)
    const sourceUrl = cfg.url || parsed.datasource;
    if (!sourceUrl) throw new Error(`No GeoJSON source for QLR layer "${cfg.id}"`);

    const source = new ol.source.Vector({
      url:    sourceUrl,
      format: new ol.format.GeoJSON(),
    });
    vectorSources[cfg.id] = source;

    // Apply stored label toggle — off by default per QLR engine design
    parsed.labelState.visible = cfg.labelsEnabled === true;

    const layerOpts = {
      source,
      visible: cfg.visible !== false,
      opacity: cfg.opacity ?? parsed.layerOpacity,
      style:   parsed.styleFunction,
    };
    if (cfg.minZoom !== undefined) layerOpts.minZoom = cfg.minZoom;
    if (cfg.maxZoom !== undefined) layerOpts.maxZoom = cfg.maxZoom;

    const layer = new ol.layer.Vector(layerOpts);
    // Stash parsed metadata on the layer for legend / label-toggle access
    layer._qlr = parsed;
    return layer;
  }

  // ── Init ─────────────────────────────────────────────────────────

  function init(storyData) {
    const mapCfg   = storyData.map ?? {};
    const center   = ol.proj.fromLonLat(mapCfg.center ?? [-90.09, 38.63]);
    const zoom     = mapCfg.zoom ?? 11;
    const rotation = (mapCfg.rotation ?? 0) * Math.PI / 180;

    // Build basemaps
    const basemapDefs = mapCfg.basemaps ?? [{ id: 'osm', type: 'osm', label: 'OpenStreetMap' }];
    basemapDefs.forEach((bm, i) => {
      const layer = buildBasemap(bm);
      layer.setVisible(i === 0);
      baseLayers[bm.id] = layer;
    });
    activeBaseId = basemapDefs[0].id;

    // Build global WMS / ArcGIS REST layers
    const wmsLayerDefs = mapCfg.wmsLayers ?? [];
    wmsLayerDefs.forEach(ld => {
      if (ld.type === 'arcgis-rest') {
        wmsLayers[ld.id] = buildArcGISRestLayer(ld);
      } else {
        wmsLayers[ld.id] = buildWMSLayer(ld);
      }
    });

    // Build synchronous vector layers first
    const vectorDefs    = mapCfg.vectorLayers ?? [];
    const syncVectorDefs = vectorDefs.filter(ld => ld.type !== 'qlr');
    const qlrDefs        = vectorDefs.filter(ld => ld.type === 'qlr');

    syncVectorDefs.forEach(ld => {
      if (ld.type === 'arcgis-feature') {
        vectorLayers[ld.id] = buildArcGISFeatureLayer(ld);
      } else {
        vectorLayers[ld.id] = buildVectorLayer(ld);
      }
    });

    // Assemble synchronous layer stack: basemaps → WMS → sync vectors
    const allLayers = [
      ...Object.values(baseLayers),
      ...Object.values(wmsLayers),
      ...Object.values(vectorLayers),
    ];

    // Create map
    map = new ol.Map({
      target: 'map',
      layers: allLayers,
      view: new ol.View({
        center,
        zoom,
        rotation,
        projection: 'EPSG:3857',
      }),
      controls: ol.control.defaults.defaults({ attributionOptions: { collapsible: true } }),
    });

    // Popup overlay
    const popupEl = document.getElementById('popup');
    popupOverlay = new ol.Overlay({
      element: popupEl,
      positioning: 'bottom-center',
      stopEvent: true,
      offset: [0, -4],
    });
    map.addOverlay(popupOverlay);

    document.getElementById('popup-closer').addEventListener('click', () => {
      popupOverlay.setPosition(undefined);
      popupEl.classList.remove('visible');
    });

    map.on('click', (evt) => {
      const feature = map.forEachFeatureAtPixel(evt.pixel, f => f);
      if (feature) {
        showPopup(feature, evt.coordinate);
      } else {
        popupEl.classList.remove('visible');
        popupOverlay.setPosition(undefined);
      }
    });

    map.on('pointermove', (evt) => {
      const hit = map.hasFeatureAtPixel(evt.pixel);
      map.getTargetElement().style.cursor = hit ? 'pointer' : '';
    });

    buildLayerPanel(storyData);
    initLayerPanelToggle();

    // Load QLR layers asynchronously and add to map after creation
    if (qlrDefs.length > 0) {
      Promise.all(qlrDefs.map(async ld => {
        try {
          const layer = await buildQLRLayer(ld);
          vectorLayers[ld.id] = layer;
          map.addLayer(layer);
          // Rebuild layer panel so QLR layers appear in the toggle list
          buildLayerPanel(storyData);
        } catch (err) {
          console.warn(`[GeoNarrative] QLR layer "${ld.id}" failed to load:`, err);
        }
      }));
    }
  }

  // ── Collapsible layer panel ───────────────────────────────────────

  function initLayerPanelToggle() {
    const panel = document.getElementById('layer-panel');
    const btn   = document.getElementById('layer-panel-toggle');
    const title = document.getElementById('layer-panel-title');
    if (!panel || !btn) return;

    function toggle() {
      panel.classList.toggle('collapsed');
      btn.title = panel.classList.contains('collapsed')
        ? 'Expand layer panel'
        : 'Collapse layer panel';
    }

    btn.addEventListener('click',   (e) => { e.stopPropagation(); toggle(); });
    title.addEventListener('click', toggle);
  }

  // ── Popup ────────────────────────────────────────────────────────

  function showPopup(feature, coord) {
    const props = feature.getProperties();
    const name  = props.name  ?? props.Name  ?? props.NAME  ?? 'Location';
    const type  = props.type  ?? props.Type  ?? '';
    const desc  = props.description ?? props.desc ?? props.address ?? '';
    const hours = props.hours ?? '';
    const phone = props.phone ?? '';

    let typeClass = '';
    if (/coffee|café|cafe/i.test(type)) typeClass = 'coffee';
    else if (/book/i.test(type))        typeClass = 'bookstore';
    else if (/hood|neighbor/i.test(type)) typeClass = 'neighborhood';

    let html = '';
    if (type) html += `<span class="popup-type ${typeClass}">${type}</span>`;
    html += `<h3>${name}</h3>`;
    if (desc)  html += `<p>${desc}</p>`;
    if (hours) html += `<p>🕐 ${hours}</p>`;
    if (phone) html += `<p>📞 ${phone}</p>`;

    document.getElementById('popup-content').innerHTML = html;
    popupOverlay.setPosition(coord);
    document.getElementById('popup').classList.add('visible');
  }

  // ── Fly to scene ─────────────────────────────────────────────────

  // Track the scene we are animating TOWARD so late-firing callbacks
  // from cancelled animations never apply stale layer state.
  let pendingScene = null;

  function flyToScene(scene) {
    if (!map || !scene) return;

    const view     = map.getView();
    const center   = ol.proj.fromLonLat(scene.center);
    const zoom     = scene.zoom;
    const rotation = (scene.rotation ?? 0) * Math.PI / 180;
    const duration = scene.duration ?? 1400;

    pendingScene = scene;

    // Apply layers immediately — correct destination state right away,
    // not after the animation finishes.
    if (scene.layers) {
      applyLayerVisibility(scene.layers);
    }

    view.cancelAnimations();

    view.animate(
      { center, duration: duration * 0.5, easing: ol.easing.easeIn },
      { zoom: zoom - 1, duration: duration * 0.25 },
      { zoom, center, rotation, duration: duration * 0.5, easing: ol.easing.easeOut },
      (complete) => {
        if (complete && pendingScene === scene && scene.label) {
          showSceneLabel(scene.label);
        }
      }
    );

    if (scene.label) {
      showSceneLabel(scene.label);
    }
  }

  // ── Layer visibility ─────────────────────────────────────────────

  function applyLayerVisibility(layerDefs) {
    // Pass 1: find the intended active basemap.
    // Fall back to the first basemap if the scene doesn't declare one —
    // prevents a previous section's basemap from "leaking" forward.
    let targetBaseId = null;
    layerDefs.forEach(ld => {
      if (baseLayers[ld.id] && ld.visible !== false && targetBaseId === null) {
        targetBaseId = ld.id;
      }
    });
    if (!targetBaseId) {
      targetBaseId = Object.keys(baseLayers)[0] ?? null;
    }
    if (targetBaseId) {
      Object.values(baseLayers).forEach(l => l.setVisible(false));
      baseLayers[targetBaseId].setVisible(true);
      activeBaseId = targetBaseId;
    }

    // Pass 2: WMS and vector layers
    layerDefs.forEach(ld => {
      if (vectorLayers[ld.id]) {
        vectorLayers[ld.id].setVisible(ld.visible !== false);
        if (ld.opacity !== undefined) vectorLayers[ld.id].setOpacity(ld.opacity);
      }
      if (wmsLayers[ld.id]) {
        wmsLayers[ld.id].setVisible(ld.visible !== false);
        if (ld.opacity !== undefined) wmsLayers[ld.id].setOpacity(ld.opacity);
      }
    });

    updateLayerPanel();
  }

  // ── Scene label ──────────────────────────────────────────────────

  let labelTimer = null;
  function showSceneLabel(text) {
    const el = document.getElementById('map-scene-label');
    el.textContent = text;
    el.classList.add('visible');
    clearTimeout(labelTimer);
    labelTimer = setTimeout(() => el.classList.remove('visible'), 3000);
  }

  // ── Static media (image / PDF) — replaces the live map ───────────

  function escAttr(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function showMedia(media) {
    if (!media) return;
    const panel    = document.getElementById('media-panel');
    const content  = document.getElementById('media-content');
    const caption  = document.getElementById('media-caption');
    const mapPanel = document.getElementById('map-panel');
    if (!panel || !content) return;

    const src = escAttr(media.src ?? '');
    const alt = escAttr(media.alt ?? '');

    if (media.type === 'pdf') {
      content.innerHTML = `<iframe src="${src}" title="${alt}"></iframe>`;
    } else {
      content.innerHTML = `<img src="${src}" alt="${alt}" />`;
    }

    caption.textContent = media.caption ?? '';

    panel.classList.add('visible');
    if (mapPanel) mapPanel.classList.add('media-active');
  }

  function hideMedia() {
    const panel    = document.getElementById('media-panel');
    const mapPanel = document.getElementById('map-panel');
    if (panel) panel.classList.remove('visible');
    if (mapPanel) mapPanel.classList.remove('media-active');
  }

  // ── Layer panel ──────────────────────────────────────────────────

  function buildLayerPanel(storyData) {
    const list = document.getElementById('layer-list');
    list.innerHTML = '';

    const mapCfg = storyData.map ?? {};

    // Basemaps: radio group (only one active at a time)
    const basemapDefs = mapCfg.basemaps ?? [];
    if (basemapDefs.length > 1) {
      const grp = document.createElement('div');
      grp.className = 'layer-group-label';
      grp.textContent = 'Basemap';
      list.appendChild(grp);

      basemapDefs.forEach(bm => {
        const item = makeLayerItem(bm.id, bm.label ?? bm.id, '#888', 'base',
                                   bm.id === activeBaseId);
        list.appendChild(item);
      });
    }

    // Overlays: checkboxes
    const overlayWMS = (mapCfg.wmsLayers ?? []).filter(l => l.showInPanel !== false);
    const overlayVec = (mapCfg.vectorLayers ?? []).filter(l => l.showInPanel !== false);

    if (overlayWMS.length + overlayVec.length > 0) {
      const grp = document.createElement('div');
      grp.className = 'layer-group-label';
      grp.textContent = 'Overlays';
      list.appendChild(grp);

      overlayWMS.forEach(ld => {
        const vis  = wmsLayers[ld.id]?.getVisible() ?? false;
        const item = makeLayerItem(ld.id, ld.label ?? ld.id, ld.color ?? '#2980b9', 'wms', vis);
        list.appendChild(item);
      });

      overlayVec.forEach(ld => {
        const vis   = vectorLayers[ld.id]?.getVisible() ?? false;
        const color = ld.style?.fill ?? ld.style?.color ?? '#c0392b';
        const item  = makeLayerItem(ld.id, ld.label ?? ld.id, color, 'vector', vis);
        list.appendChild(item);
      });
    }
  }

  function makeLayerItem(id, label, color, kind, visible) {
    const div = document.createElement('div');
    div.className = 'layer-item';
    div.dataset.layerId = id;
    div.dataset.kind    = kind;

    const input = document.createElement('input');
    if (kind === 'base') {
      input.type  = 'radio';
      input.name  = 'viewer-basemap';
      input.className = 'layer-radio';
      input.checked   = visible;
      input.addEventListener('change', () => {
        if (input.checked) toggleLayer(id, kind, true);
      });
    } else {
      input.type  = 'checkbox';
      input.className = 'layer-checkbox';
      input.checked   = visible;
      input.addEventListener('change', () => toggleLayer(id, kind, input.checked));
    }

    const swatch = document.createElement('span');
    swatch.className = 'layer-swatch';
    swatch.style.background = color;

    const lbl = document.createElement('span');
    lbl.textContent = label;

    div.append(input, swatch, lbl);
    return div;
  }

  function toggleLayer(id, kind, visible) {
    if (kind === 'base') {
      Object.values(baseLayers).forEach(l => l.setVisible(false));
      if (baseLayers[id]) { baseLayers[id].setVisible(true); activeBaseId = id; }
      updateLayerPanel();
    } else if (kind === 'wms' && wmsLayers[id]) {
      wmsLayers[id].setVisible(visible);
    } else if (kind === 'vector' && vectorLayers[id]) {
      vectorLayers[id].setVisible(visible);
    }
  }

  function updateLayerPanel() {
    document.querySelectorAll('.layer-item').forEach(item => {
      const id   = item.dataset.layerId;
      const kind = item.dataset.kind;

      if (kind === 'base') {
        const rb = item.querySelector('input[type=radio]');
        if (rb) rb.checked = (id === activeBaseId);
      } else {
        const cb = item.querySelector('input[type=checkbox]');
        if (!cb) return;
        if (kind === 'wms')    cb.checked = wmsLayers[id]?.getVisible()    ?? false;
        if (kind === 'vector') cb.checked = vectorLayers[id]?.getVisible() ?? false;
      }
    });
  }

  // ── Public API ───────────────────────────────────────────────────
  return {
    init,
    flyToScene,
    applyLayerVisibility,
    showSceneLabel,
    showMedia,
    hideMedia,
  };

})();