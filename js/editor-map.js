/**
 * editor-map.js — OpenLayers map for the editor panel
 *
 * Full WYSIWYG layer preview. Loads the same basemap + WMS + vector
 * layer stack as the viewer so layer toggles are reflected live.
 */

const EditorMap = (() => {

  let map  = null;
  let view = null;
  let onMoveCallback = null;

  let baseLayers   = {};
  let wmsLayers    = {};
  let vectorLayers = {};
  let activeBaseId = null;

  const DEFAULT_CENTER = ol.proj.fromLonLat([-90.09, 38.63]);
  const DEFAULT_ZOOM   = 11;

  function stringDivider(str, width, separator) {
    if (!str || str.length <= width) return str;
    let p = width;
    while (p > 0 && str[p] !== ' ') p--;
    if (p > 0) {
      return str.substring(0, p) + separator +
             stringDivider(str.substring(p + 1), width, separator);
    }
    return str;
  }

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

  function makePolygonStyle(cfg = {}) {
    const baseStyle = new ol.style.Style({
      fill:   new ol.style.Fill({ color: cfg.fill ?? 'rgba(41,128,185,0.15)' }),
      stroke: new ol.style.Stroke({ color: cfg.stroke ?? '#2980b9', width: cfg.strokeWidth ?? 1.5 }),
    });

    if (!cfg.label) return baseStyle;

    const labelCfg   = cfg.label;
    const labelStyle  = new ol.style.Style({
      text: new ol.style.Text({
        font:     labelCfg.font     ?? '12px Calibri,sans-serif',
        overflow: labelCfg.overflow !== false,
        fill:     new ol.style.Fill({ color: labelCfg.fill ?? '#000000' }),
        stroke:   new ol.style.Stroke({
          color: labelCfg.haloColor ?? '#ffffff',
          width: labelCfg.haloWidth ?? 3,
        }),
      }),
    });
    const field    = labelCfg.field    ?? 'name';
    const maxWidth = labelCfg.maxWidth ?? 16;

    return function (feature) {
      const raw = feature.get(field) ?? '';
      labelStyle.getText().setText(stringDivider(raw, maxWidth, '\n'));
      return [baseStyle, labelStyle];
    };
  }

  function styleFromConfig(cfg) {
    if (!cfg) return null;
    switch (cfg.type) {
      case 'point':   return makePointStyle(cfg);
      case 'line':    return makeLineStyle(cfg);
      case 'polygon': return makePolygonStyle(cfg);
      default:        return null;
    }
  }

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

  const vectorSources = {};

  function buildBasemap(cfg) {
    if (cfg.type === 'osm') {
      return new ol.layer.Tile({ source: new ol.source.OSM() });
    }
    if (cfg.type === 'xyz') {
      return new ol.layer.Tile({
        source: new ol.source.XYZ({
          url: cfg.url,
          attributions: cfg.attribution ?? '',
        }),
      });
    }
    return new ol.layer.Tile({ source: new ol.source.OSM() });
  }

  function buildWMSLayer(cfg) {
    return new ol.layer.Tile({
      opacity: cfg.opacity ?? 1,
      visible: cfg.visible !== false,
      source:  new ol.source.TileWMS({
        url:    cfg.url,
        params: {
          LAYERS:      cfg.layers,
          TILED:       true,
          VERSION:     cfg.version     ?? '1.3.0',
          FORMAT:      cfg.format      ?? 'image/png',
          TRANSPARENT: cfg.transparent ?? true,
        },
        serverType:  cfg.serverType ?? 'geoserver',
        crossOrigin: 'anonymous',
        attributions: cfg.attribution ?? '',
      }),
    });
  }

  function buildArcGISRestLayer(cfg) {
    const layerOpts = {
      opacity: cfg.opacity ?? 1,
      visible: cfg.visible !== false,
      source:  new ol.source.TileArcGISRest({
        url:         cfg.url,
        params:      cfg.layers ? { LAYERS: 'show:' + cfg.layers } : {},
        crossOrigin: 'anonymous',
      }),
    };
    if (cfg.minZoom !== undefined) layerOpts.minZoom = cfg.minZoom;
    if (cfg.maxZoom !== undefined) layerOpts.maxZoom = cfg.maxZoom;
    return new ol.layer.Tile(layerOpts);
  }

  function buildArcGISFeatureLayer(cfg) {
    const source = new ol.source.Vector({
      loader: function (extent, resolution, projection, success, failure) {
        const url = cfg.url + '/query?where=1%3D1&outFields=*&f=geojson&outSR=4326';
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

  // ── QLR layer builder ─────────────────────────────────────────────
  async function buildQLRLayer(cfg) {
    const qlrRes  = await fetch(cfg.qlrUrl);
    if (!qlrRes.ok) throw new Error('QLR fetch failed: ' + qlrRes.status + ' ' + cfg.qlrUrl);
    const qlrText = await qlrRes.text();
    const parsed  = await QLREngine.parseQLR(qlrText);

    const sourceUrl = cfg.url || parsed.datasource;
    if (!sourceUrl) throw new Error('No GeoJSON source for QLR layer "' + cfg.id + '"');

    const source = new ol.source.Vector({
      url:    sourceUrl,
      format: new ol.format.GeoJSON(),
    });
    vectorSources[cfg.id] = source;

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
    layer._qlr = parsed;
    return layer;
  }

  function init() {
    view = new ol.View({
      center:     DEFAULT_CENTER,
      zoom:       DEFAULT_ZOOM,
      projection: 'EPSG:3857',
    });

    const defaultOSM = new ol.layer.Tile({ source: new ol.source.OSM() });
    baseLayers   = { osm: defaultOSM };
    activeBaseId = 'osm';

    map = new ol.Map({
      target:   'editor-map',
      layers:   [defaultOSM],
      view:     view,
      controls: ol.control.defaults.defaults({ attributionOptions: { collapsible: true } }),
    });

    map.on('pointermove', (evt) => {
      const lonLat = ol.proj.toLonLat(evt.coordinate);
      const el = document.getElementById('map-coords-display');
      if (el) {
        el.textContent =
          'Lon: ' + lonLat[0].toFixed(5) +
          '  Lat: ' + lonLat[1].toFixed(5) +
          '  Z: '   + view.getZoom().toFixed(1);
      }
    });

    view.on('change', () => {
      if (onMoveCallback) onMoveCallback();
    });
  }

  function loadStoryLayers(storyData) {
    if (!map) return;
    const mapCfg = storyData.map ?? {};

    map.getLayers().clear();
    baseLayers   = {};
    wmsLayers    = {};
    vectorLayers = {};
    activeBaseId = null;
    Object.keys(vectorSources).forEach(k => delete vectorSources[k]);

    const basemapDefs = mapCfg.basemaps ??
      [{ id: 'osm', type: 'osm', label: 'Street Map' }];

    basemapDefs.forEach((bm, i) => {
      const layer = buildBasemap(bm);
      layer.setVisible(i === 0);
      baseLayers[bm.id] = layer;
      map.addLayer(layer);
    });
    activeBaseId = basemapDefs[0].id;

    (mapCfg.wmsLayers ?? []).forEach(ld => {
      const layer = ld.type === 'arcgis-rest'
        ? buildArcGISRestLayer(ld)
        : buildWMSLayer(ld);
      wmsLayers[ld.id] = layer;
      map.addLayer(layer);
    });

    // Synchronous vector / ArcGIS Feature overlays
    const syncVectors = (mapCfg.vectorLayers ?? []).filter(ld => ld.type !== 'qlr');
    const qlrDefs     = (mapCfg.vectorLayers ?? []).filter(ld => ld.type === 'qlr');

    syncVectors.forEach(ld => {
      const layer = ld.type === 'arcgis-feature'
        ? buildArcGISFeatureLayer(ld)
        : buildVectorLayer(ld);
      vectorLayers[ld.id] = layer;
      map.addLayer(layer);
    });

    // QLR layers load asynchronously after map is ready
    if (qlrDefs.length > 0) {
      Promise.all(qlrDefs.map(async ld => {
        try {
          const layer = await buildQLRLayer(ld);
          vectorLayers[ld.id] = layer;
          map.addLayer(layer);
        } catch (err) {
          console.warn(`[GeoNarrative Editor] QLR layer "${ld.id}" failed:`, err);
        }
      }));
    }

    map.updateSize();
  }

  function reset() {
    if (!map) return;

    map.getLayers().clear();
    baseLayers   = {};
    wmsLayers    = {};
    vectorLayers = {};
    activeBaseId = null;
    Object.keys(vectorSources).forEach(k => delete vectorSources[k]);

    const defaultOSM = new ol.layer.Tile({ source: new ol.source.OSM() });
    baseLayers   = { osm: defaultOSM };
    activeBaseId = 'osm';
    map.addLayer(defaultOSM);

    view.cancelAnimations();
    view.animate({
      center:   DEFAULT_CENTER,
      zoom:     DEFAULT_ZOOM,
      duration: 800,
      easing:   ol.easing.easeOut,
    });
  }

  function applyVisibility(layerDefs) {
    if (!layerDefs || !map) return;

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

    layerDefs.forEach(ld => {
      if (wmsLayers[ld.id]) {
        wmsLayers[ld.id].setVisible(ld.visible !== false);
        if (ld.opacity !== undefined) wmsLayers[ld.id].setOpacity(ld.opacity);
      }
      if (vectorLayers[ld.id]) {
        vectorLayers[ld.id].setVisible(ld.visible !== false);
        if (ld.opacity !== undefined) vectorLayers[ld.id].setOpacity(ld.opacity);
      }
    });
  }

  function flyTo(lon, lat, zoom, rotationDeg = 0, duration = 1200) {
    if (!view) return;
    const center   = ol.proj.fromLonLat([lon, lat]);
    const rotation = rotationDeg * Math.PI / 180;
    view.cancelAnimations();
    view.animate(
      { center, duration: duration * 0.5, easing: ol.easing.easeIn },
      { zoom: zoom - 1, duration: duration * 0.25 },
      { zoom, center, rotation, duration: duration * 0.5, easing: ol.easing.easeOut }
    );
  }

  function captureView() {
    if (!view) return null;
    const center   = ol.proj.toLonLat(view.getCenter());
    const zoom     = parseFloat(view.getZoom().toFixed(2));
    const rotation = parseFloat(((view.getRotation() * 180) / Math.PI).toFixed(1));
    return { lon: center[0], lat: center[1], zoom, rotation };
  }

  function onMove(cb)   { onMoveCallback = cb; }
  function updateSize() { if (map) map.updateSize(); }

  return {
    init,
    loadStoryLayers,
    applyVisibility,
    reset,
    flyTo,
    captureView,
    onMove,
    updateSize,
  };

})();