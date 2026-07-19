<?php
// Load story from query param or default
$story_file = isset($_GET['story']) ? preg_replace('/[^a-zA-Z0-9_-]/', '', $_GET['story']) : 'demo';
$story_path = __DIR__ . '/stories/' . $story_file . '.json';

if (!file_exists($story_path)) {
    http_response_code(404);
    die('<h2>Story not found.</h2>');
}

$story = json_decode(file_get_contents($story_path), true);
if (!$story) {
    http_response_code(500);
    die('<h2>Invalid story JSON.</h2>');
}

$story_json = json_encode($story);
$title = htmlspecialchars($story['title'] ?? 'Story Map');
$subtitle = htmlspecialchars($story['subtitle'] ?? '');
$author = htmlspecialchars($story['author'] ?? '');
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title><?= $title ?></title>

  <!-- OpenLayers -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/ol@9.2.4/ol.css" />
  <script src="https://cdn.jsdelivr.net/npm/ol@9.2.4/dist/ol.js"></script>

  <!-- Google Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Source+Serif+4:opsz,wght@8..60,300;8..60,400;8..60,600&display=swap" rel="stylesheet">

  <link rel="stylesheet" href="css/style.css" />
</head>
<body>

  <!-- ── HEADER ── -->
  <header id="app-header">
    <div id="header-inner">
      <div id="header-meta">
        <h1 id="story-title"><?= $title ?></h1>
        <?php if ($subtitle): ?>
          <p id="story-subtitle"><?= $subtitle ?></p>
        <?php endif; ?>
        <?php if ($author): ?>
          <p id="story-author">by <?= $author ?></p>
        <?php endif; ?>
      </div>
      <nav id="chapter-nav">
        <!-- Filled by JS -->
      </nav>
    </div>
  </header>

  <!-- ── MAIN LAYOUT ── -->
  <main id="app-main">

    <!-- Left: Narrative Panel -->
    <section id="narrative-panel">
      <div id="sections-container">
        <!-- Filled by JS -->
      </div>
    </section>

    <!-- Right: Map Panel -->
    <div id="map-panel">
      <div id="map"></div>

      <!-- Static media overlay — replaces the map for sections with scene.media -->
      <div id="media-panel">
        <div id="media-content"></div>
        <div id="media-caption"></div>
      </div>

      <!-- Map attribution overlay -->
      <div id="map-scene-label"></div>

      <!-- Popup -->
      <div id="popup" class="ol-popup">
        <button id="popup-closer" class="ol-popup-closer">✕</button>
        <div id="popup-content"></div>
      </div>

      <!-- Layer toggle panel -->
      <div id="layer-panel">
        <div id="layer-panel-title">
          <span>Layers</span>
          <button id="layer-panel-toggle" title="Collapse layer panel">&#9650;</button>
        </div>
        <div id="layer-list"></div>
      </div>
    </div>

  </main>

  <!-- Progress bar -->
  <div id="progress-bar"><div id="progress-fill"></div></div>

  <!-- Story data passed to JS -->
  <script>
    window.STORY_DATA = <?= $story_json ?>;
  </script>

  <!-- QLR engine must load before map.js -->
  <script src="js/qlr-engine.js"></script>
  <script src="js/map.js"></script>
  <script src="js/scroll.js"></script>
  <script src="js/app.js"></script>
</body>
</html>
