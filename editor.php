<?php
/**
 * editor.php — GeoNarrative Story Editor
 * Three-panel: Outline | Section Editor / Layer Manager | Live Map
 */
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/config.php';
require_auth();

// Load story list for the selector
$files   = glob(STORIES_DIR . '*.json');
$stories = [];
foreach ($files as $f) {
    $id   = basename($f, '.json');
    $data = json_decode(file_get_contents($f), true);
    $stories[$id] = $data['title'] ?? $id;
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Story Editor — <?= APP_NAME ?></title>

  <!-- OpenLayers -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/ol@9.2.4/ol.css">
  <script src="https://cdn.jsdelivr.net/npm/ol@9.2.4/dist/ol.js"></script>

  <!-- Quill rich text editor -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/quill@2.0.2/dist/quill.snow.css">
  <script src="https://cdn.jsdelivr.net/npm/quill@2.0.2/dist/quill.js"></script>

  <!-- Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Source+Serif+4:opsz,wght@8..60,300;8..60,400;8..60,600&display=swap" rel="stylesheet">

  <link rel="stylesheet" href="css/editor.css">
  <link rel="stylesheet" href="css/layer-drag.css">
</head>
<body>

<!-- ── TOP BAR ── -->
<header id="editor-header">
  <div id="header-left">
    <span id="app-logo">GeoNarrative</span>
    <span id="editor-label">Story Editor</span>
  </div>
  <div id="header-center">
    <select id="story-selector">
      <option value="">— select a story —</option>
      <?php foreach ($stories as $id => $title): ?>
        <option value="<?= htmlspecialchars($id) ?>"><?= htmlspecialchars($title) ?></option>
      <?php endforeach; ?>
    </select>
    <button class="hdr-btn" id="btn-new-story">＋ New Story</button>
  </div>
  <div id="header-right">
    <span id="save-status">No changes</span>
    <button class="hdr-btn hdr-btn-primary" id="btn-save">💾 Save</button>
    <button class="hdr-btn" id="btn-preview">👁 Preview</button>
    <button class="hdr-btn hdr-btn-danger" id="btn-delete-story" title="Delete this story permanently">🗑 Delete</button>
    <a href="editor-logout.php" class="hdr-btn">Sign Out</a>
  </div>
</header>

<!-- ── THREE PANELS ── -->
<div id="editor-body">

  <!-- Panel 1: Story Outline -->
  <aside id="panel-outline">
    <div class="panel-heading">
      <span>Story Outline</span>
    </div>

    <!-- Story meta -->
    <div id="story-meta">
      <input type="text" id="meta-title"    class="meta-input" placeholder="Story title">
      <input type="text" id="meta-subtitle" class="meta-input" placeholder="Subtitle (optional)">
      <input type="text" id="meta-author"   class="meta-input" placeholder="Author">
    </div>

    <!-- Section list -->
    <div id="section-list">
      <!-- Filled by JS -->
    </div>

    <button id="btn-add-section" class="btn-outline-full">＋ Add Section</button>
  </aside>

  <!-- Panel 2: Section Editor / Layer Manager -->
  <main id="panel-editor">

    <!-- Tab bar -->
    <div id="panel-tabs">
      <button class="panel-tab active" data-tab="sections">✏️ Section</button>
      <button class="panel-tab"        data-tab="layers">🗂 Layers</button>
      <span id="editor-section-label" class="panel-tab-label">Select a section</span>
    </div>

    <!-- ── TAB: Section Editor ── -->
    <div id="tab-sections" class="tab-content active">
      <div id="editor-content">

        <div id="editor-placeholder">
          <div class="placeholder-icon">📖</div>
          <p>Select a section from the outline<br>or create a new story to begin.</p>
        </div>

        <!-- Section fields (hidden until a section is selected) -->
        <div id="section-fields" style="display:none">

          <div class="field-group">
            <label class="field-label">Section Title</label>
            <input type="text" id="field-title" class="field-input" placeholder="Enter section title">
          </div>

          <div class="field-group">
            <label class="field-label">Navigation Label <span class="field-hint">(short, for top nav)</span></label>
            <input type="text" id="field-navlabel" class="field-input" placeholder="Short label">
          </div>

          <div class="field-group">
            <label class="field-label">Section Text</label>
            <div id="quill-editor"></div>
          </div>

          <div class="field-group">
            <label class="field-label">Callout / Pull Quote <span class="field-hint">(optional)</span></label>
            <textarea id="field-callout" class="field-textarea" rows="3"
                      placeholder="A highlighted fact or quote..."></textarea>
          </div>

          <div class="field-group">
            <label class="field-label">Image <span class="field-hint">(optional, shown inline in the narrative text)</span></label>
            <div class="image-row">
              <input type="text" id="field-image-src"     class="field-input" placeholder="images/photo.jpg or full URL">
              <input type="text" id="field-image-alt"     class="field-input" placeholder="Alt text">
              <input type="text" id="field-image-caption" class="field-input" placeholder="Caption (optional)">
            </div>
          </div>

          <!-- Static Media — replaces the live map panel for this section -->
          <div class="field-group media-group">
            <label class="field-label">Static Media <span class="field-hint">(replaces the live map for this section)</span></label>
            <select id="field-media-type" class="field-input">
              <option value="">None — use live map</option>
              <option value="image">Image</option>
              <option value="pdf">PDF</option>
            </select>

            <div id="media-fields" style="display:none; margin-top:10px">
              <input type="text" id="field-media-src" class="field-input"
                     placeholder="maps/flood-1993.png or full URL" style="margin-bottom:8px">
              <input type="text" id="field-media-alt" class="field-input"
                     placeholder="Alt text" style="margin-bottom:8px">
              <input type="text" id="field-media-caption" class="field-input"
                     placeholder="Caption (optional)">
            </div>
          </div>

          <!-- Scene / Map settings -->
          <div class="field-group scene-group">
            <label class="field-label">Map Scene</label>

            <div id="scene-media-notice" style="display:none">
              Map controls are hidden — this section displays static media instead of the live map.
            </div>

            <div id="scene-map-fields">
              <div class="scene-coords">
                <div class="coord-row">
                  <div class="coord-field">
                    <label class="coord-label">Longitude</label>
                    <input type="number" id="field-lon" class="coord-input" step="0.0001" placeholder="-90.334">
                  </div>
                  <div class="coord-field">
                    <label class="coord-label">Latitude</label>
                    <input type="number" id="field-lat" class="coord-input" step="0.0001" placeholder="38.644">
                  </div>
                  <div class="coord-field">
                    <label class="coord-label">Zoom</label>
                    <input type="number" id="field-zoom" class="coord-input" step="0.5" min="1" max="20" placeholder="14">
                  </div>
                  <div class="coord-field">
                    <label class="coord-label">Rotation °</label>
                    <input type="number" id="field-rotation" class="coord-input" step="1" min="0" max="360" placeholder="0">
                  </div>
                </div>

                <button id="btn-capture" class="btn-capture">
                  📍 Capture Current Map View
                </button>
                <p class="capture-hint">Pan and zoom the map to your desired view, then click Capture.</p>
              </div>

              <div class="field-group" style="margin-top:16px">
                <label class="field-label">Scene Label <span class="field-hint">(overlay text on map)</span></label>
                <input type="text" id="field-scene-label" class="field-input" placeholder="e.g. Clayton, Missouri">
              </div>

              <!-- Layer visibility toggles -->
              <div id="layer-toggles-container">
                <label class="field-label" style="margin-top:16px">Layer Visibility for this Scene</label>
                <div id="layer-toggles">
                  <!-- Filled by JS when story loads -->
                </div>
              </div>
            </div><!-- /scene-map-fields -->
          </div>

          <!-- Section actions -->
          <div class="section-actions-group">
            <div class="section-actions-label">Section Actions</div>
            <div class="section-actions">
              <button id="btn-move-up"        class="btn-action">↑ Move Up</button>
              <button id="btn-move-down"      class="btn-action">↓ Move Down</button>
              <button id="btn-duplicate"      class="btn-action">⧉ Duplicate</button>
              <button id="btn-delete-section" class="btn-action btn-danger">✕ Delete</button>
            </div>
          </div>

        </div><!-- /section-fields -->
      </div><!-- /editor-content -->
    </div><!-- /tab-sections -->

    <!-- ── TAB: Layer Manager ── -->
    <div id="tab-layers" class="tab-content">

      <div id="layer-manager-placeholder" class="lm-placeholder">
        <div class="placeholder-icon">🗺</div>
        <p>Load a story to manage its layers.</p>
      </div>

      <div id="layer-manager" style="display:none">

        <!-- Basemaps section -->
        <div class="lm-section">
          <div class="lm-section-header">
            <span class="lm-section-title">Basemaps</span>
          </div>
          <div id="lm-basemap-list" class="lm-list"></div>
        </div>

        <!-- Overlay layers section -->
        <div class="lm-section">
          <div class="lm-section-header">
            <span class="lm-section-title">Overlay Layers</span>
            <button id="btn-add-layer" class="btn-lm-add">＋ Add Layer</button>
          </div>
          <div id="lm-overlay-list" class="lm-list"></div>
        </div>

      </div><!-- /layer-manager -->

      <!-- Add / Edit Layer Form -->
      <div id="layer-form" style="display:none">
        <div class="lm-form-header">
          <span id="layer-form-title">Add Layer</span>
          <button id="btn-layer-form-cancel" class="btn-action">✕ Cancel</button>
        </div>

        <div class="field-group">
          <label class="field-label">Layer ID <span class="field-hint">(unique, no spaces)</span></label>
          <input type="text" id="lf-id" class="field-input" placeholder="my_layer">
        </div>

        <div class="field-group">
          <label class="field-label">Display Label</label>
          <input type="text" id="lf-label" class="field-input" placeholder="My Layer">
        </div>

        <div class="field-group">
          <label class="field-label">Layer Type</label>
          <select id="lf-type" class="field-input">
            <option value="wms">WMS</option>
            <option value="arcgis-rest">ArcGIS REST (Map Service)</option>
            <option value="arcgis-feature">ArcGIS Feature Service</option>
            <option value="geojson-url">GeoJSON — URL</option>
            <option value="geojson-upload">GeoJSON — Upload File</option>
            <option value="qlr">QLR + GeoJSON (QGIS styling)</option>
          </select>
        </div>

        <!-- WMS fields -->
        <div class="lf-type-fields" data-for="wms">
          <div class="field-group">
            <label class="field-label">WMS URL</label>
            <input type="text" id="lf-wms-url" class="field-input" placeholder="https://your-server/wms">
          </div>
          <div class="field-group">
            <label class="field-label">Layer Name(s)</label>
            <input type="text" id="lf-wms-layers" class="field-input" placeholder="workspace:layer_name">
          </div>
          <div class="field-group">
            <label class="field-label">Version</label>
            <select id="lf-wms-version" class="field-input">
              <option value="1.3.0">1.3.0</option>
              <option value="1.1.1">1.1.1</option>
            </select>
          </div>
          <div class="field-group">
            <label class="field-label">Format</label>
            <select id="lf-wms-format" class="field-input">
              <option value="image/png">image/png</option>
              <option value="image/jpeg">image/jpeg</option>
            </select>
          </div>
        </div>

        <!-- ArcGIS REST fields -->
        <div class="lf-type-fields" data-for="arcgis-rest">
          <div class="field-group">
            <label class="field-label">MapServer URL</label>
            <input type="text" id="lf-agr-url" class="field-input"
                   placeholder="https://server/arcgis/rest/services/.../MapServer">
          </div>
          <div class="field-group">
            <label class="field-label">Layer IDs <span class="field-hint">(comma separated, or blank for all)</span></label>
            <input type="text" id="lf-agr-layers" class="field-input" placeholder="0,1,2">
          </div>
        </div>

        <!-- ArcGIS Feature Service fields -->
        <div class="lf-type-fields" data-for="arcgis-feature">
          <div class="field-group">
            <label class="field-label">FeatureServer URL</label>
            <input type="text" id="lf-agf-url" class="field-input"
                   placeholder="https://server/arcgis/rest/services/.../FeatureServer/0">
          </div>
          <div class="field-group">
            <label class="field-label">Label Field <span class="field-hint">(optional)</span></label>
            <input type="text" id="lf-agf-label-field" class="field-input" placeholder="NAME">
          </div>
        </div>

        <!-- GeoJSON URL fields -->
        <div class="lf-type-fields" data-for="geojson-url">
          <div class="field-group">
            <label class="field-label">GeoJSON URL</label>
            <input type="text" id="lf-geojson-url" class="field-input"
                   placeholder="https://your-server/data/layer.geojson">
          </div>
        </div>

        <!-- GeoJSON Upload fields -->
        <div class="lf-type-fields" data-for="geojson-upload">
          <div class="field-group">
            <label class="field-label">GeoJSON File</label>
            <input type="file" id="lf-geojson-file" class="field-input" accept=".geojson,.json">
          </div>
          <div class="field-group">
            <label class="field-label">Save as filename <span class="field-hint">(stored in stories/data/)</span></label>
            <input type="text" id="lf-geojson-filename" class="field-input" placeholder="my-layer.geojson">
          </div>
          <div id="lf-upload-progress"></div>
        </div>

        <!-- QLR + GeoJSON fields -->
        <div class="lf-type-fields" data-for="qlr">
          <div class="field-group">
            <label class="field-label">QGIS Layer File (.qlr)</label>
            <input type="file" id="lf-qlr-file" class="field-input" accept=".qlr">
            <div id="lf-qlr-parse-status" class="lf-parse-status"></div>
          </div>
          <div class="field-group">
            <label class="field-label">GeoJSON Source <span class="field-hint">(URL — overrides datasource in QLR)</span></label>
            <input type="text" id="lf-qlr-geojson-url" class="field-input"
                   placeholder="Optional — leave blank to use datasource from QLR">
          </div>
          <div class="field-group">
            <label class="field-label">Or Upload GeoJSON File</label>
            <input type="file" id="lf-qlr-geojson-file" class="field-input" accept=".geojson,.json">
          </div>
          <div class="field-group">
            <label class="field-label">Labels</label>
            <div class="qlr-label-row">
              <input type="checkbox" id="lf-qlr-labels" class="lf-qlr-cb">
              <label for="lf-qlr-labels" class="lf-qlr-label-text">Enable labels (if defined in QLR)</label>
            </div>
            <div id="lf-qlr-label-hint" class="lf-parse-status"></div>
          </div>
        </div><!-- /qlr fields -->

        <!-- Common style fields -->
        <div class="lm-style-section">
          <div class="lm-section-title" style="margin-bottom:10px">Style</div>

          <div class="field-group">
            <label class="field-label">Geometry Type</label>
            <select id="lf-geom-type" class="field-input">
              <option value="polygon">Polygon</option>
              <option value="point">Point</option>
              <option value="line">Line</option>
              <option value="raster">Raster (WMS / ArcGIS)</option>
            </select>
          </div>

          <div class="lf-style-vector">
            <div class="lf-color-row">
              <div class="field-group" style="flex:1">
                <label class="field-label">Fill Color</label>
                <input type="color" id="lf-fill-color" class="field-input lf-color" value="#2980b9">
              </div>
              <div class="field-group" style="flex:1">
                <label class="field-label">Stroke Color</label>
                <input type="color" id="lf-stroke-color" class="field-input lf-color" value="#1a5276">
              </div>
              <div class="field-group" style="flex:1">
                <label class="field-label">Fill Opacity</label>
                <input type="number" id="lf-fill-opacity" class="field-input"
                       min="0" max="1" step="0.05" value="0.2">
              </div>
            </div>

            <div class="field-group">
              <label class="field-label">Label Field <span class="field-hint">(optional — property name)</span></label>
              <input type="text" id="lf-label-field" class="field-input" placeholder="NAME">
            </div>
          </div>

          <!-- Scale -->
          <div class="lf-color-row">
            <div class="field-group" style="flex:1">
              <label class="field-label">Min Zoom <span class="field-hint">(optional)</span></label>
              <input type="number" id="lf-min-zoom" class="field-input" min="1" max="20" placeholder="—">
            </div>
            <div class="field-group" style="flex:1">
              <label class="field-label">Max Zoom <span class="field-hint">(optional)</span></label>
              <input type="number" id="lf-max-zoom" class="field-input" min="1" max="20" placeholder="—">
            </div>
          </div>
        </div>

        <div class="modal-actions" style="margin-top:16px">
          <button id="btn-layer-form-save" class="btn-action btn-primary-action">
            💾 Save Layer
          </button>
        </div>

      </div><!-- /layer-form -->
    </div><!-- /tab-layers -->

  </main>

  <!-- Panel 3: Live Map -->
  <div id="panel-map">
    <div class="panel-heading">
      <span>Live Map</span>
      <div id="map-coords-display"></div>
    </div>
    <div id="editor-map"></div>

    <!-- Static media preview overlay — mirrors the viewer's media-panel -->
    <div id="editor-media-panel">
      <div id="editor-media-content"></div>
      <div id="editor-media-caption"></div>
    </div>
  </div>

</div><!-- /editor-body -->

<!-- ── NEW STORY MODAL ── -->
<div id="modal-overlay" style="display:none">
  <div id="modal-box">
    <h2 class="modal-title">New Story</h2>
    <div class="field-group">
      <label class="field-label">File Name <span class="field-hint">(no spaces, e.g. my-story)</span></label>
      <input type="text" id="new-story-id" class="field-input" placeholder="my-story">
    </div>
    <div class="field-group">
      <label class="field-label">Story Title</label>
      <input type="text" id="new-story-title" class="field-input" placeholder="My Story Title">
    </div>
    <div class="field-group">
      <label class="field-label">Author</label>
      <input type="text" id="new-story-author" class="field-input" placeholder="Your Name">
    </div>
    <div class="modal-actions">
      <button id="btn-modal-cancel" class="btn-action">Cancel</button>
      <button id="btn-modal-create" class="btn-action btn-primary-action">Create Story</button>
    </div>
  </div>
</div>

<!-- Story data injected by JS after load -->
<script>
  window.STORIES_LIST = <?= json_encode($stories) ?>;
</script>
<!-- QLR engine must load before editor-map.js -->
<script src="js/qlr-engine.js"></script>
<script src="js/editor-map.js"></script>
<script src="js/editor.js"></script>
</body>
</html>
