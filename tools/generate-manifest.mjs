/**
 * generate-manifest.mjs
 * 
 * Scans all .json files in the /level/ directory and writes a manifest.json
 * that lists every file (sorted alphabetically). The web app then loads this
 * manifest to discover levels instead of guessing numbered filenames.
 * 
 * Usage:
 *   node tools/generate-manifest.mjs
 * 
 * Or via npm:
 *   npm run generate-manifest
 */

import { readdirSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';

const LEVEL_DIR = resolve(import.meta.dirname, '../level');
const MANIFEST_PATH = join(LEVEL_DIR, 'manifest.json');

if (!existsSync(LEVEL_DIR)) {
  console.error(`[manifest] ERROR: Level directory not found: ${LEVEL_DIR}`);
  process.exit(1);
}

const files = readdirSync(LEVEL_DIR)
  .filter(f => f.endsWith('.json') && f !== 'manifest.json')
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

if (files.length === 0) {
  console.warn('[manifest] WARNING: No .json level files found in /level/');
}

writeFileSync(MANIFEST_PATH, JSON.stringify(files, null, 2) + '\n');

console.log(`[manifest] Generated manifest.json with ${files.length} level file(s):`);
files.forEach(f => console.log(`  - ${f}`));