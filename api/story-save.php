<?php
/**
 * api/story-save.php — Story save endpoint
 *
 * POST body (JSON):
 *   { "id": "story-name", "story": { ...full story object... } }
 *
 * Returns:
 *   { "ok": true }           on success
 *   { "error": "message" }   on failure
 *
 * Protected: requires active editor session.
 */

// Auth check — must be logged in
require_once __DIR__ . '/../auth.php';
require_once __DIR__ . '/../config.php';
require_auth();

header('Content-Type: application/json');

// ── Only accept POST ──────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

// ── Parse request body ────────────────────────────────────────────
$raw  = file_get_contents('php://input');
$body = json_decode($raw, true);

if (!$body || !isset($body['id'], $body['story'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing id or story in request body']);
    exit;
}

// ── Sanitize story ID ─────────────────────────────────────────────
$id = preg_replace('/[^a-zA-Z0-9_-]/', '', $body['id']);

if (empty($id)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid story ID']);
    exit;
}

// ── Validate story object ─────────────────────────────────────────
$story = $body['story'];

if (!isset($story['title']) || !isset($story['sections'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Story must have title and sections']);
    exit;
}

if (!is_array($story['sections']) || count($story['sections']) === 0) {
    http_response_code(400);
    echo json_encode(['error' => 'Story must have at least one section']);
    exit;
}

// ── Build file path ────────────────────────────────────────────────
if (!is_dir(STORIES_DIR)) {
    mkdir(STORIES_DIR, 0755, true);
}

$file_path = STORIES_DIR . $id . '.json';

// ── Write atomically: write to temp file, then rename ────────────
// This prevents a corrupt file if the server crashes mid-write
$tmp_path = $file_path . '.tmp.' . uniqid();

$json = json_encode($story, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

if (file_put_contents($tmp_path, $json) === false) {
    http_response_code(500);
    echo json_encode(['error' => 'Failed to write story file. Check directory permissions.']);
    exit;
}

if (!rename($tmp_path, $file_path)) {
    @unlink($tmp_path);
    http_response_code(500);
    echo json_encode(['error' => 'Failed to finalize story file.']);
    exit;
}

echo json_encode(['ok' => true, 'id' => $id]);
