<?php
/**
 * api/upload-geojson.php — GeoJSON file upload endpoint
 *
 * POST: multipart/form-data
 *   file     — the .geojson or .json file
 *   filename — desired filename (sanitized server-side)
 *
 * Returns:
 *   { "ok": true, "url": "stories/data/my-layer.geojson" }
 *   { "error": "message" }
 *
 * Protected: requires active editor session.
 */

require_once __DIR__ . '/../auth.php';
require_once __DIR__ . '/../config.php';
require_auth();

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

// ── Validate file upload ──────────────────────────────────────────
if (empty($_FILES['file'])) {
    http_response_code(400);
    echo json_encode(['error' => 'No file uploaded']);
    exit;
}

$file = $_FILES['file'];

if ($file['error'] !== UPLOAD_ERR_OK) {
    http_response_code(400);
    echo json_encode(['error' => 'Upload error code: ' . $file['error']]);
    exit;
}

// Max 10MB
if ($file['size'] > 10 * 1024 * 1024) {
    http_response_code(400);
    echo json_encode(['error' => 'File too large (max 10MB)']);
    exit;
}

// ── Validate it's actually GeoJSON ────────────────────────────────
$raw  = file_get_contents($file['tmp_name']);
$json = json_decode($raw, true);

if (!$json || !isset($json['type'])) {
    http_response_code(400);
    echo json_encode(['error' => 'File does not appear to be valid GeoJSON']);
    exit;
}

$validTypes = ['FeatureCollection', 'Feature', 'GeometryCollection',
               'Point', 'MultiPoint', 'LineString', 'MultiLineString',
               'Polygon', 'MultiPolygon'];

if (!in_array($json['type'], $validTypes)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid GeoJSON type: ' . $json['type']]);
    exit;
}

// ── Sanitize filename ─────────────────────────────────────────────
$filename = $_POST['filename'] ?? $file['name'];
$filename = preg_replace('/[^a-zA-Z0-9_\-]/', '', pathinfo($filename, PATHINFO_FILENAME));
$filename = $filename . '.geojson';

if (empty($filename) || $filename === '.geojson') {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid filename']);
    exit;
}

// ── Save to stories/data/ ─────────────────────────────────────────
$data_dir = STORIES_DIR . 'data/';
if (!is_dir($data_dir)) {
    mkdir($data_dir, 0755, true);
}

$dest_path = $data_dir . $filename;
$dest_url  = 'stories/data/' . $filename;

// Write atomically
$tmp = $dest_path . '.tmp.' . uniqid();
if (file_put_contents($tmp, $raw) === false) {
    http_response_code(500);
    echo json_encode(['error' => 'Failed to write file']);
    exit;
}
if (!rename($tmp, $dest_path)) {
    @unlink($tmp);
    http_response_code(500);
    echo json_encode(['error' => 'Failed to finalize file']);
    exit;
}

echo json_encode(['ok' => true, 'url' => $dest_url, 'filename' => $filename]);
