<?php
/**
 * save-level.php
 *
 * POST endpoint for Goose level editor.
 * Writes a level JSON file to ../level/{name}.json
 * and regenerates ../level/manifest.json so the level
 * appears in the Load Level dialog.
 *
 * Usage:
 *   POST /api/save-level.php
 *   Content-Type: application/json
 *   Body: { "name": "MyLevel", "data": "{...serialized level...}", "token": "your-secret" }
 *
 * Security:
 *   Change SET_TOKEN_HERE to a secret phrase you enter in the editor's
 *   'Server Token' field (or set manually in goose_config below).
 */

/* ═══════ CONFIG ════════════════════════════════════════════ */
$SECRET_TOKEN = 'mammut33';  // ← CHANGE THIS to a secret of your choice

/* ════════════════════════════════════════════════════════════ */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok'=>false, 'error'=>'Method not allowed']);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);
if (!$input) {
    http_response_code(400);
    echo json_encode(['ok'=>false, 'error'=>'Invalid JSON body']);
    exit;
}

// Sanitise the token (fail fast if wrong)
if (!isset($input['token']) || $input['token'] !== $SECRET_TOKEN) {
    http_response_code(403);
    echo json_encode(['ok'=>false, 'error'=>'Invalid or missing token']);
    exit;
}

$name = trim($input['name'] ?? '');
$data = $input['data'] ?? '';

if (!$name || !$data) {
    http_response_code(400);
    echo json_encode(['ok'=>false, 'error'=>'Missing name or data']);
    exit;
}

// Sanitise the filename: alphanumeric, underscores, hyphens only
$safeName = preg_replace('/[^a-z0-9_-]/i', '_', $name);
if (!$safeName) {
    http_response_code(400);
    echo json_encode(['ok'=>false, 'error'=>'Invalid level name']);
    exit;
}

// Resolve paths relative to this script's directory
$levelDir = __DIR__ . '/../level';
$manifestPath = $levelDir . '/manifest.json';
$levelPath = $levelDir . '/' . $safeName . '.json';

// Write the level file
$written = file_put_contents($levelPath, $data);
if ($written === false) {
    http_response_code(500);
    echo json_encode(['ok'=>false, 'error'=>'Failed to write level file']);
    exit;
}

// Regenerate manifest.json: list all .json except manifest itself, sorted
$files = array_values(array_filter(
    scandir($levelDir),
    fn($f) => $f !== '.' && $f !== '..' && $f !== 'manifest.json' && str_ends_with($f, '.json')
));
sort($files, SORT_STRING | SORT_FLAG_CASE);
file_put_contents($manifestPath, json_encode($files, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n");

echo json_encode(['ok'=>true, 'file'=> $safeName . '.json', 'levelsCount'=> count($files)]);