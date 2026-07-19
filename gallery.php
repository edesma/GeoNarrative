<?php
// Load story list
$stories_dir = __DIR__ . '/stories/';
$files       = glob($stories_dir . '*.json');
$stories     = [];

foreach ($files as $file) {
    $id   = basename($file, '.json');
    $data = json_decode(file_get_contents($file), true);
    if (!$data) continue;
    $stories[] = [
        'id'       => $id,
        'title'    => $data['title']    ?? $id,
        'subtitle' => $data['subtitle'] ?? '',
        'author'   => $data['author']   ?? '',
        'count'    => count($data['sections'] ?? []),
    ];
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>GeoNarrative — Story Gallery</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Source+Serif+4:opsz,wght@8..60,300;8..60,400&display=swap" rel="stylesheet">
  <style>
    :root {
      --ink: #1a1a2e; --paper: #faf8f4; --paper-dark: #f0ece4;
      --accent: #c0392b; --gold: #b8860b;
      --serif: 'Playfair Display', Georgia, serif;
      --body: 'Source Serif 4', Georgia, serif;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--body);
      background: var(--paper);
      color: var(--ink);
      min-height: 100vh;
    }
    header {
      background: var(--ink);
      color: var(--paper);
      padding: 40px 48px;
      border-bottom: 3px solid var(--accent);
    }
    header h1 {
      font-family: var(--serif);
      font-size: 2.2rem;
      letter-spacing: -0.01em;
    }
    header p {
      margin-top: 8px;
      font-size: 0.9rem;
      color: rgba(250,248,244,0.6);
      font-style: italic;
    }
    main {
      max-width: 960px;
      margin: 0 auto;
      padding: 56px 32px;
    }
    h2.section-heading {
      font-family: var(--serif);
      font-size: 1rem;
      font-weight: 400;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--gold);
      margin-bottom: 28px;
    }
    .story-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 24px;
    }
    .story-card {
      background: white;
      border-radius: 4px;
      border: 1px solid rgba(26,26,46,0.1);
      overflow: hidden;
      text-decoration: none;
      color: inherit;
      transition: box-shadow 0.25s ease, transform 0.25s ease;
      display: block;
    }
    .story-card:hover {
      box-shadow: 0 8px 32px rgba(26,26,46,0.14);
      transform: translateY(-3px);
    }
    .card-accent { height: 4px; background: var(--accent); }
    .card-body { padding: 24px; }
    .card-body h3 {
      font-family: var(--serif);
      font-size: 1.25rem;
      line-height: 1.25;
      margin-bottom: 8px;
    }
    .card-body .subtitle {
      font-size: 0.82rem;
      color: #7a7a99;
      font-style: italic;
      margin-bottom: 14px;
    }
    .card-meta {
      display: flex;
      justify-content: space-between;
      font-size: 0.72rem;
      color: #aaa;
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px solid var(--paper-dark);
    }
    .btn-open {
      display: inline-block;
      margin-top: 16px;
      padding: 8px 20px;
      background: var(--accent);
      color: white;
      border-radius: 20px;
      font-size: 0.78rem;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    .empty {
      padding: 60px;
      text-align: center;
      color: #aaa;
      font-style: italic;
    }
  </style>
</head>
<body>
  <header>
    <h1>GeoNarrative</h1>
    <p>Interactive story maps powered by OpenLayers</p>
  </header>
  <main>
    <h2 class="section-heading">Available Stories</h2>

    <?php if (empty($stories)): ?>
      <p class="empty">No stories found. Add JSON files to the <code>stories/</code> folder.</p>
    <?php else: ?>
      <div class="story-grid">
        <?php foreach ($stories as $s): ?>
          <a href="index.php?story=<?= urlencode($s['id']) ?>" class="story-card">
            <div class="card-accent"></div>
            <div class="card-body">
              <h3><?= htmlspecialchars($s['title']) ?></h3>
              <?php if ($s['subtitle']): ?>
                <p class="subtitle"><?= htmlspecialchars($s['subtitle']) ?></p>
              <?php endif; ?>
              <div class="card-meta">
                <span><?= (int)$s['count'] ?> sections</span>
                <?php if ($s['author']): ?>
                  <span><?= htmlspecialchars($s['author']) ?></span>
                <?php endif; ?>
              </div>
              <span class="btn-open">Open Story →</span>
            </div>
          </a>
        <?php endforeach; ?>
      </div>
    <?php endif; ?>
  </main>
</body>
</html>
