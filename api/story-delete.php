<?php
/**
 * api/story-delete.php — Delete a story file
 *
 * POST body (JSON): { "id": "story-name" }
 *
 * Returns:
 *   { "ok": true }
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

$raw  = file_get_contents('php://input');
$body = json_decode($raw, true);

if (!$body || empty($body['id'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing story id']);
    exit;
}

// Sanitize id — no path traversal
$id   = preg_replace('/[^a-zA-Z0-9_-]/', '', $body['id']);
$path = STORIES_DIR . $id . '.json';

if (!file_exists($path)) {
    http_response_code(404);
    echo json_encode(['error' => 'Story not found']);
    exit;
}

if (!unlink($path)) {
    http_response_code(500);
    echo json_encode(['error' => 'Failed to delete story file']);
    exit;
}

echo json_encode(['ok' => true, 'id' => $id]);
