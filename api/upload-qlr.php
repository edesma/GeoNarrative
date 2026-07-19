<?php
/**
 * api/upload-qlr.php — QLR file upload endpoint
 *
 * POST: multipart/form-data
 *   file     — the .qlr file
 *   filename — desired filename (sanitized server-side)
 *
 * Returns:
 *   { "ok": true, "url": "stories/data/my-layer.qlr" }
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

// Max 5MB — QLR files are XML and should be well under this
if ($file['size'] > 5 * 1024 * 1024) {
    http_response_code(400);
    echo json_encode(['error' => 'File too large (max 5MB)']);
    exit;
}

// Validate it's XML / contains qlr root element
$raw = file_get_contents($file['tmp_name']);
if (stripos($raw, '<qlr') === false && stripos($raw, '<qgis') === false) {
    http_response_code(400);
    echo json_encode(['error' => 'File does not appear to be a valid QLR file']);
    exit;
}

// Sanitize filename
$filename = $_POST['filename'] ?? $file['name'];
$filename = preg_replace('/[^a-zA-Z0-9_\-]/', '', pathinfo($filename, PATHINFO_FILENAME));
$filename = $filename . '.qlr';

if (empty($filename) || $filename === '.qlr') {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid filename']);
    exit;
}

// Save to stories/data/
$data_dir = STORIES_DIR . 'data/';
if (!is_dir($data_dir)) {
    mkdir($data_dir, 0755, true);
}

$dest_path = $data_dir . $filename;
$dest_url  = 'stories/data/' . $filename;

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
