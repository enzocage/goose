/**
 * server.mjs
 *
 * Simple development HTTP server for Goose.
 * - Serves all static files from the project root.
 * - Provides GET /api/refresh-manifest that regenerates level/manifest.json
 *   on demand (the frontend calls this automatically when opening the Load Level dialog).
 *
 * Usage:
 *   node tools/server.mjs
 *
 * Or via npm:
 *   npm start
 *   npm run dev
 */

import { createServer } from 'http';
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'fs';
import { extname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const PORT = parseInt(process.env.PORT, 10) || 1984;

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const ROOT = resolve(__dirname, '..');
const LEVEL_DIR = join(ROOT, 'level');
const MANIFEST_PATH = join(LEVEL_DIR, 'manifest.json');

/* ── MIME types for common static file extensions ── */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.webp': 'image/webp',
  '.mp3':  'audio/mpeg',
  '.wav':  'audio/wav',
  '.ogg':  'audio/ogg',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
};

/* ── Refresh manifest.json by scanning /level/ ── */
function refreshManifest() {
  if (!existsSync(LEVEL_DIR)) {
    console.warn(`[server] Level directory not found: ${LEVEL_DIR}`);
    return false;
  }

  const files = readdirSync(LEVEL_DIR)
    .filter(f => f.endsWith('.json') && f !== 'manifest.json')
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  writeFileSync(MANIFEST_PATH, JSON.stringify(files, null, 2) + '\n');
  console.log(`[server] Manifest refreshed — ${files.length} level file(s)`);
  files.forEach(f => console.log(`  → ${f}`));
  return true;
}

/* ── Serve a static file ── */
function serveFile(res, filePath) {
  try {
    const data = readFileSync(filePath);
    const ext = extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
}

/* ── HTTP server ── */
const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = url.pathname;

  // CORS headers (allow the browser frontend from any origin during dev)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API: refresh manifest
  if (pathname === '/api/refresh-manifest') {
    refreshManifest();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // Map / to index.html so the root works
  if (pathname === '/') pathname = '/index.html';

  // Serve from project root
  const filePath = join(ROOT, pathname);

  // Security: ensure the resolved path stays inside the project root
  const resolved = resolve(filePath);
  if (!resolved.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  serveFile(res, resolved);
});

server.listen(PORT, () => {
  console.log(`\n  🟧 GOOSE — Dev Server running at http://localhost:${PORT}\n`);
});