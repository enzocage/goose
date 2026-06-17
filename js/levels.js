/* ═══════════════════════════════════════════════════════════
   LEVEL LOADING
   Fetches the pre-made level manifest (/level/N.json), loads a campaign level
   by index, and loads the built-in demo level. Builds via buildLevel3D (main).
   ═══════════════════════════════════════════════════════════ */
import { S } from './state.js';
import { MAX_LIVES } from './constants.js';
import { DEMO_LEVEL } from './levels-data.js';
import { deserializeLevel } from './level.js';
import { buildLevel3D } from './main.js';
import { drawEditorWires } from './editor.js';
import { showMessage } from './ui.js';

export function loadDemoLevel() {
  S.isCustomLevel = true;
  S.playerLives = MAX_LIVES;
  S.activeLevel = deserializeLevel(JSON.stringify(DEMO_LEVEL));
  document.getElementById('level-name-input').value = S.activeLevel.name;
  document.getElementById('world-select').value = S.activeLevel.world;
  buildLevel3D(S.activeLevel);
  if (S.isEditMode && !S.isPlaytesting) drawEditorWires();
  showMessage('DEMO LEVEL LOADED');
}



/* ═══════════════════════════════════════════════════════════
   PRE-MADE LEVEL LOADER
   ═══════════════════════════════════════════════════════════ */
// Probe /level for sequential files (1.json, 2.json, …) and keep their raw JSON.
// Stops at the first gap, so dropping in N.json files extends the campaign with
// no code change. Guards against SPA fallbacks (a 200 that isn't valid level
// JSON) and caps the probe so a misconfigured server can't loop forever.
export async function loadLevelManifest() {
  const levels = [];
  for (let i = 1; i <= 200; i++) {
    let res;
    try { res = await fetch(`level/${i}.json`, { cache: 'no-cache' }); }
    catch (e) { break; }
    if (!res.ok) break;
    let text;
    try { text = await res.text(); } catch (e) { break; }
    let data;
    try { data = JSON.parse(text); } catch (e) { break; } // not real level JSON → stop
    if (!data || !Array.isArray(data.blocks) || !data.start || !data.exit) break;
    levels.push(text);
  }
  return levels;
}

export function loadPreMadeLevel(idx) {
  S.isCustomLevel = false;
  S.playerLives = MAX_LIVES;
  if (!S.premadeLevels.length) return; // manifest not ready (or no level files)
  const n = S.premadeLevels.length;
  const i = ((idx % n) + n) % n;
  const lvl3D = deserializeLevel(S.premadeLevels[i]);
  buildLevel3D(lvl3D);
}

