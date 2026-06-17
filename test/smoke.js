/* ═══════════════════════════════════════════════════════════
   GOOSE SMOKE TESTS
   Lightweight regression guards for the module split. Run in a browser
   (the modules pull in scene.js, which needs WebGL/DOM):

       npx serve   →   open  http://localhost:3000/test/smoke.html

   Covers: (1) the core modules load, (2) the AI generators produce valid
   levels, (3) level serialize → deserialize round-trips. These import only the
   bootstrap-free part of the graph, so loading this page does NOT start the game.
   Results render on the page and are also on window.__smoke for headless checks.
   ═══════════════════════════════════════════════════════════ */
import { generateAILabyrinth, generateArchitectLevel, generateArchitectLevel2, generateArchitectLevel3 } from '../js/ai-levels.js';
import { Level3D, serializeLevel, deserializeLevel } from '../js/level.js';
import * as scene from '../js/scene.js';
import * as meshes from '../js/meshes.js';
import * as ui from '../js/ui.js';
import * as particles from '../js/particles.js';
import { S } from '../js/state.js';

const results = [];
const check = (name, cond, detail = '') => results.push({ name, pass: !!cond, detail });

try {
  // 1 — modules load and expose their API
  check('ai-levels: generators exported',
    [generateAILabyrinth, generateArchitectLevel, generateArchitectLevel2, generateArchitectLevel3].every(f => typeof f === 'function'));
  check('level: Level3D/serialize/deserialize exported',
    typeof Level3D === 'function' && typeof serializeLevel === 'function' && typeof deserializeLevel === 'function');
  check('scene: renderer/scene/camera live', !!scene.scene && !!scene.camera && typeof scene.getPlayerWorldPos === 'function');
  check('leaf modules load (meshes/ui/particles)',
    typeof meshes.createBlockMesh === 'function' && typeof ui.showMessage === 'function' && typeof particles.spawnTrailParticle === 'function');
  check('state: S object present', S && typeof S === 'object' && 'activeLevel' in S);

  // 2 — generators produce valid levels
  const lab = generateAILabyrinth();
  check('generateAILabyrinth: blocks > 0', lab.blocks.size > 0, `${lab.blocks.size} blocks`);
  check('generateAILabyrinth: has start & exit', !!lab.start && !!lab.exit);
  check('generateAILabyrinth: prisms placed', lab.prisms.size > 0, `${lab.prisms.size} prisms`);

  const a1 = generateArchitectLevel(5);
  check('generateArchitectLevel(5): blocks > 0', a1.blocks.size > 0, `${a1.blocks.size} blocks`);

  const a3 = generateArchitectLevel3({ arenaSize: 25, pathLength: 30, enemies: 2, prisms: 4 });
  check('generateArchitectLevel3: blocks > 0', a3.blocks.size > 0, `${a3.blocks.size} blocks`);
  check('generateArchitectLevel3: enemies honored', a3.enemies.size > 0, `${a3.enemies.size} enemies`);

  // 3 — serialize → deserialize round-trip
  const json = serializeLevel(lab);
  check('serializeLevel returns JSON string', typeof json === 'string' && json.length > 0);
  const round = deserializeLevel(json);
  check('round-trip: block count preserved', round.blocks.size === lab.blocks.size, `${lab.blocks.size} → ${round.blocks.size}`);
  check('round-trip: prism count preserved', round.prisms.size === lab.prisms.size, `${lab.prisms.size} → ${round.prisms.size}`);
  check('round-trip: start preserved', JSON.stringify(round.start) === JSON.stringify(lab.start));
  check('round-trip: exit preserved', JSON.stringify(round.exit) === JSON.stringify(lab.exit));
} catch (e) {
  check('NO EXCEPTION during smoke run', false, e && e.message);
  console.error(e);
}

const passed = results.filter(r => r.pass).length;
const total = results.length;
const ok = passed === total;
window.__smoke = { ok, passed, total, results };

const out = document.getElementById('out');
if (out) {
  out.innerHTML = `<span class="${ok ? 'pass' : 'fail'}">${ok ? '✓' : '✗'} ${passed}/${total} passed</span>\n\n` +
    results.map(r => `<span class="${r.pass ? 'pass' : 'fail'}">${r.pass ? 'PASS' : 'FAIL'}</span>  ${r.name}${r.detail ? '  — ' + r.detail : ''}`).join('\n');
}
console.log(`%cSMOKE ${passed}/${total} passed`, `color:${ok ? '#6f6' : '#f66'};font-size:16px;`, window.__smoke);
