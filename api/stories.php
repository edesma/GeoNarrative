<?php
/**
 * api/stories.php
 * Returns a list of available stories or the content of a specific story.
 *
 * GET /api/stories.php           → JSON array of story metadata
 * GET /api/stories.php?id=demo   → JSON content of demo.json
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

$stories_dir = __DIR__ . '/../stories/';

// ── Single story load ──────────────────────────────────────────────
if (isset($_GET['id'])) {
    $id   = preg_replace('/[^a-zA-Z0-9_-]/', '', $_GET['id']);
    $path = $stories_dir . $id . '.json';

    if (!file_exists($path)) {
        http_response_code(404);
        echo json_encode(['error' => 'Story not found']);
        exit;
    }

    $content = file_get_contents($path);
    $data    = json_decode($content, true);

    if (!$data) {
        http_response_code(500);
        echo json_encode(['error' => 'Invalid JSON in story file']);
        exit;
    }

    echo json_encode($data);
    exit;
}

// ── Story index ────────────────────────────────────────────────────
$files = glob($stories_dir . '*.json');
$list  = [];

foreach ($files as $file) {
    $id      = basename($file, '.json');
    $content = file_get_contents($file);
    $data    = json_decode($content, true);

    if (!$data) continue;

    $list[] = [
        'id'       => $id,
        'title'    => $data['title']    ?? $id,
        'subtitle' => $data['subtitle'] ?? '',
        'author'   => $data['author']   ?? '',
        'sections' => count($data['sections'] ?? []),
    ];
}

echo json_encode($list);
