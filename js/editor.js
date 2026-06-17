/* ═══════════════════════════════════════════════════════════
   LEVEL EDITOR
   Undo history, edit-mode lifecycle, vertical ruler + layer slicing, wireframe
   overlays, raycasting, block/prism/enemy placement & erasing, plane fill/draw,
   click/drag handling, playtest enter/exit, height adjust, the level library,
   and tool selection. buildLevel3D/clearLevel + the DOM button wiring stay in
   main.js, which imports these and is imported back for a few orchestration calls.
   ═══════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { S, audio } from './state.js';
import { MAX_LIVES, rulerMinY, rulerMaxY, UNDO_LIMIT, BLOCK_TOOLS } from './constants.js';
import {
  scene, camera, renderer, getPlayerWorldPos,
  matTileBase, matTileFragile, matTileIce, matTileSwitch, matTileTp, matTileExit,
  matCube, matPrism, matMiniPrism, matPrismGlow, matBridge, matSwitchPillar,
  matCrate, matPressurePlate, matDanger, matShaker, matBooster,
  matPlutonium, matPlutoniumGlow, matContainer,
  geoTile, geoThinTile, geoCube, geoPrism, geoRing, geoPillar, geoTrail,
  worldGroup, tilesGroup, prismsGroup, effectsGroup, bridgeGroup
} from './scene.js';
import { Level3D, MovingPlatform, serializeLevel, deserializeLevel } from './level.js';
import { createBlockMesh, createPrismMesh, createEnemyMarker, disposeMaterial, setMeshOpacity } from './meshes.js';
import { groupMemberCount, refreshGroupingIndicator, setGroupingUI, showMessage } from './ui.js';
import { WORLDS } from './levels-data.js';
import { buildLevel3D, applyXrayOverride } from './main.js';
import { toolButtons } from './bootstrap.js';
import { loadDemoLevel, loadPreMadeLevel } from './levels.js';
import { renderLevelPreview, stopPreviewAnimation } from './level-preview.js';

// Snapshot the current level onto the undo history before a mutating edit.
export function pushUndoSnapshot() {
  if (!S.activeLevel) return;
  S.undoStack.push(serializeLevel(S.activeLevel));
  if (S.undoStack.length > UNDO_LIMIT) S.undoStack.shift();
  updateUndoButton();
}

export function editorUndo() {
  if (!S.isEditMode || S.isPlaytesting) return;
  if (!S.undoStack.length) { showMessage('NOTHING TO UNDO', 1); return; }
  const snap = S.undoStack.pop();
  const lvl = deserializeLevel(snap);
  document.getElementById('level-name-input').value = lvl.name;
  document.getElementById('world-select').value = lvl.world;
  buildLevel3D(lvl); // sets S.activeLevel and rebuilds meshes
  drawEditorWires();
  updateEditorSlicing();
  renderVerticalRuler();
  updateUndoButton();
  showMessage(`UNDO — ${S.undoStack.length} STEP${S.undoStack.length === 1 ? '' : 'S'} LEFT`, 1);
  audio.playUndo();
}

export function updateUndoButton() {
  const btn = document.getElementById('btn-undo');
  if (btn) btn.disabled = S.undoStack.length === 0;
}

export function enterEditMode() {
  if (S.isEditMode) return;
  S.isEditMode = true;
  S.undoStack = [];
  updateUndoButton();
  document.getElementById('editor-ui').style.display = 'block';
  document.getElementById('hud').style.display = 'none';
  document.getElementById('controls-hint').style.display = 'none';

  // Spawn Editor Camera values
  S.editorCameraTarget.copy(S.playerCube ? S.playerCube.position : new THREE.Vector3(0,0,0));
  S.editorCameraZoom = 15;

  // Add Grid Helper
  S.editorGridHelper = new THREE.GridHelper(50, 50, 0x00ccff, 0x223344);
  S.editorGridHelper.position.set(0.5, S.editY - 0.49, 0.5);
  scene.add(S.editorGridHelper);

  // Add Transparent Grid Plane (disabled at user request to avoid transparency)
  const planeGeo = new THREE.PlaneGeometry(50, 50);
  const planeMat = new THREE.MeshBasicMaterial({ visible: false });
  S.editorGridPlane = new THREE.Mesh(planeGeo, planeMat);
  S.editorGridPlane.rotation.x = -Math.PI/2;
  S.editorGridPlane.position.set(0.5, S.editY - 0.49, 0.5);
  scene.add(S.editorGridPlane);

  // Add Ghost Block (wireframe representation to avoid transparency)
  S.editorGhostBlock = new THREE.Mesh(geoTile, new THREE.MeshBasicMaterial({ color: 0x00ffcc, wireframe: true }));
  scene.add(S.editorGhostBlock);

  // Add Plane Preview (wireframe box helper shown while drawing a rectangular area with V held)
  S.editorPlanePreview = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x00ffaa, wireframe: true, depthTest: false })
  );
  S.editorPlanePreview.visible = false;
  scene.add(S.editorPlanePreview);

  S.editorWiresGroup = new THREE.Group();
  scene.add(S.editorWiresGroup);

  // Build temporary level if none exists
  if (!S.activeLevel) {
    S.activeLevel = new Level3D();
    lvlInsertDefaultBlocks(S.activeLevel);
  }
  buildLevel3D(S.activeLevel);
  drawEditorWires();
  updateLibraryList();

  // Usability updates
  document.getElementById('btn-toggle-slice').textContent = S.sliceModeActive ? 'Slice: ON' : 'Slice: OFF';
  document.getElementById('btn-toggle-slice').className = `editor-btn ${S.sliceModeActive ? 'success' : 'danger'}`;
  renderVerticalRuler();
  updateEditorSlicing();
}

export function exitEditMode() {
  if (!S.isEditMode) return;
  S.isEditMode = false;
  S.isPainting = false;
  S.currentGroupId = null;
  setGroupingUI(false);
  document.getElementById('editor-ui').style.display = 'none';
  document.getElementById('hud').style.display = 'flex';
  document.getElementById('editor-tooltip').style.display = 'none';

  if (S.editorGridHelper) { scene.remove(S.editorGridHelper); S.editorGridHelper = null; }
  if (S.editorGridPlane) { scene.remove(S.editorGridPlane); S.editorGridPlane = null; }
  if (S.editorGhostBlock) { scene.remove(S.editorGhostBlock); S.editorGhostBlock = null; }
  if (S.editorWiresGroup) { scene.remove(S.editorWiresGroup); S.editorWiresGroup = null; }
  if (S.editorPlanePreview) {
    scene.remove(S.editorPlanePreview);
    S.editorPlanePreview.geometry.dispose();
    S.editorPlanePreview.material.dispose();
    S.editorPlanePreview = null;
  }

  // Reset slicing opacities / visibilities
  updateEditorSlicing();

  loadPreMadeLevel(S.currentLevelIdx);
}

export function lvlInsertDefaultBlocks(lvl) {
  for (let x=0; x<5; x++) {
    for (let z=0; z<5; z++) {
      lvl.blocks.set(`${x},0,${z}`, { x, y:0, z, type:'normal', properties:{} });
    }
  }
  lvl.start = { x:0, y:0, z:0 };
  lvl.exit = { x:4, y:0, z:4 };
}

export function renderVerticalRuler() {
  const container = document.getElementById('ruler-levels-list');
  if (!container) return;
  container.innerHTML = '';
  for (let y = rulerMaxY; y >= rulerMinY; y--) {
    const btn = document.createElement('button');
    btn.className = `ruler-level-btn ${y === S.editY ? 'active' : ''}`;
    btn.textContent = y;
    btn.addEventListener('click', () => {
      adjustEditHeight(y - S.editY);
    });
    container.appendChild(btn);
  }
}

export function updateEditorSlicing() {
  if (!S.isEditMode || S.isPlaytesting) {
    S.activeBlocks.forEach(b => {
      if (b.mesh) {
        b.mesh.visible = true;
        setMeshOpacity(b.mesh, 1.0, true);
      }
      if (b.pillar) b.pillar.visible = true;
    });
    S.activePrisms.forEach(p => {
      if (p.mesh) p.mesh.visible = true;
    });
    S.movingPlatformsList.forEach(mp => {
      mp.mesh.visible = true;
    });
    applyXrayOverride();
    return;
  }
  S.activeBlocks.forEach(b => {
    if (!b.mesh) return;
    if (S.sliceModeActive && b.y > S.editY) {
      b.mesh.visible = false;
      if (b.pillar) b.pillar.visible = false;
    } else {
      b.mesh.visible = true;
      if (b.pillar) b.pillar.visible = true;
      const isBelow = (S.sliceModeActive && b.y < S.editY);
      const isInactiveBridge = (b.type === 'bridge' && b.active === false);
      if (isBelow) {
        b.mesh.traverse(m => {
          if (m.isMesh && m.material) {
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            mats.forEach(mat => {
              mat.wireframe = false;
            });
          }
        });
        setMeshOpacity(b.mesh, 1.0, true);
      } else if (isInactiveBridge) {
        b.mesh.traverse(m => {
          if (m.isMesh && m.material) {
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            mats.forEach(mat => {
              mat.wireframe = true;
              mat.transparent = false;
              mat.opacity = 1.0;
            });
          }
        });
      } else {
        b.mesh.traverse(m => {
          if (m.isMesh && m.material) {
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            mats.forEach(mat => {
              mat.wireframe = false;
            });
          }
        });
        setMeshOpacity(b.mesh, 1.0, true);
      }
    }
  });
  S.activePrisms.forEach((p, k) => {
    if (!p.mesh) return;
    const py = k.split(',').map(Number)[1]; // key is "x,y,z" → y is the height
    if (S.sliceModeActive && py > S.editY) {
      p.mesh.visible = false;
    } else {
      p.mesh.visible = true;
      p.mesh.material.transparent = false;
      p.mesh.material.opacity = 1.0;
    }
  });
  S.enemyMarkers.forEach((m, k) => {
    const ey = k.split(',').map(Number)[1];
    if (S.sliceModeActive && ey > S.editY) {
      m.visible = false;
    } else {
      m.visible = true;
      m.material.transparent = false;
      m.material.opacity = 1.0;
    }
  });
  S.movingPlatformsList.forEach(mp => {
    const mpy = Math.round(mp.position.y);
    if (S.sliceModeActive && mpy > S.editY) {
      mp.mesh.visible = false;
    } else {
      mp.mesh.visible = true;
      mp.mesh.material.transparent = false;
      mp.mesh.material.opacity = 1.0;
    }
  });
  applyXrayOverride();
}

export function updateLibraryList() {
  const list = document.getElementById('custom-levels-list');
  const token = ++S.libraryListToken;
  list.innerHTML = '';
  // Built-in demo level showcasing every gameplay element
  const demoItem = document.createElement('div');
  demoItem.className = 'library-item';
  demoItem.innerHTML = `<span style="color:var(--gold);">★ Element Showcase</span>`;
  demoItem.addEventListener('click', () => {
    loadDemoLevel();
    document.getElementById('editor-library-panel').style.display = 'none';
  });
  list.appendChild(demoItem);
  // Attach preview for the demo level (imported from levels-data.js)
  import('./levels-data.js').then(mod => {
    attachLevelPreviewHover(demoItem, JSON.stringify(mod.DEMO_LEVEL), '★ Element Showcase');
  }).catch(() => {});
  // Load local custom levels keys
  let store = {};
  try {
    store = JSON.parse(localStorage.getItem('goose_levels') || '{}');
  } catch(e){}
  Object.keys(store).forEach(name => {
    const div = document.createElement('div');
    div.className = 'library-item';
    div.innerHTML = `<span>${name}</span><button class="delete-btn">×</button>`;
    div.querySelector('span').addEventListener('click', () => {
      S.isCustomLevel = true;
      S.activeLevel = deserializeLevel(store[name]);
      document.getElementById('level-name-input').value = S.activeLevel.name;
      document.getElementById('world-select').value = S.activeLevel.world;
      buildLevel3D(S.activeLevel);
      drawEditorWires();
      showMessage('LEVEL LOADED');
      document.getElementById('editor-library-panel').style.display = 'none';
    });
    div.querySelector('.delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      delete store[name];
      localStorage.setItem('goose_levels', JSON.stringify(store));
      updateLibraryList();
    });
    list.appendChild(div);
    // Preview for custom levels
    attachLevelPreviewHover(div, store[name], name);
  });
  // Levels shipped as files in the /level folder (read-only, no delete button)
  loadFolderLevels(list, token);
}

// Fetch level files from the /level folder and add them to the Load Level list.
// Uses level/manifest.json (array of filenames) which must be generated by
// `npm run generate-manifest` (or `npm run build`).
// Every .json file in /level/ except manifest.json itself is included.

// ── Level Preview hover helper ─────────────────────────────
function attachLevelPreviewHover(div, jsonStr, levelName) {
  let hoverTimeout = null;

  div.addEventListener('mouseenter', () => {
    hoverTimeout = setTimeout(() => {
      const overlay = document.getElementById('level-preview-overlay');
      const canvas = document.getElementById('level-preview-canvas');
      const nameLabel = document.getElementById('preview-level-label');
      const worldLabel = document.getElementById('preview-world-label');
      if (!overlay || !canvas) return;

      let data;
      try { data = JSON.parse(jsonStr); } catch (e) { return; }
      if (!data || !Array.isArray(data.blocks)) return;

      const wIdx = data.world !== undefined ? data.world : 0;
      const world = WORLDS[wIdx] || WORLDS[0];
      nameLabel.textContent = data.name || levelName || 'Unknown Level';
      worldLabel.textContent = world.name.toUpperCase();

      overlay.classList.add('show');
      renderLevelPreview(data, canvas);
    }, 300);
  });

  div.addEventListener('mousemove', (e) => {
    const overlay = document.getElementById('level-preview-overlay');
    if (!overlay.classList.contains('show')) return;
    const pad = 16;
    let left = e.clientX + pad;
    let top = e.clientY + pad;
    const ow = 308;
    const oh = 330;
    if (left + ow > window.innerWidth) left = e.clientX - ow - pad;
    if (top + oh > window.innerHeight) top = e.clientY - oh - pad;
    if (left < 0) left = pad;
    if (top < 0) top = pad;
    overlay.style.left = left + 'px';
    overlay.style.top = top + 'px';
  });

  div.addEventListener('mouseleave', () => {
    if (hoverTimeout) { clearTimeout(hoverTimeout); hoverTimeout = null; }
    const overlay = document.getElementById('level-preview-overlay');
    if (overlay) overlay.classList.remove('show');
    stopPreviewAnimation();
  });
}

export async function loadFolderLevels(list, token) {
  // Refresh the manifest on the server so newly added level files are picked up
  try {
    await fetch('/api/refresh-manifest', { cache: 'no-store' });
  } catch (_) { /* server not available — use existing manifest */ }

  let files = [];
  try {
    const res = await fetch('level/manifest.json', { cache: 'no-store' });
    if (res.ok) {
      const m = await res.json();
      if (Array.isArray(m)) files = m.map(f => (typeof f === 'string' ? f : f.file)).filter(Boolean);
    }
  } catch (e) { /* no manifest */ }
  if (!files.length) {
    console.warn('[loadFolderLevels] No manifest.json found – no level files loaded.');
    return;
  }
  for (const file of files) {
    if (token !== S.libraryListToken) return; // a newer refresh superseded us
    let jsonStr;
    try {
      const r = await fetch(`level/${file}`, { cache: 'no-store' });
      if (!r.ok) continue;
      jsonStr = await r.text();
    } catch (e) { continue; }
    let data;
    try { data = JSON.parse(jsonStr); } catch (e) { continue; }
    if (token !== S.libraryListToken) return;
    const div = document.createElement('div');
    div.className = 'library-item';
    div.innerHTML = `<span style="color:var(--accent2);">📁 ${data.name || file}</span>`;
    div.querySelector('span').addEventListener('click', () => {
      S.isCustomLevel = true;
      S.activeLevel = deserializeLevel(jsonStr);
      document.getElementById('level-name-input').value = S.activeLevel.name;
      document.getElementById('world-select').value = S.activeLevel.world;
      buildLevel3D(S.activeLevel);
      drawEditorWires();
      showMessage('LEVEL LOADED');
      document.getElementById('editor-library-panel').style.display = 'none';
    });
    list.appendChild(div);

    // Attach preview hover — only for campaign levels (1.json, 2.json, …)
    attachLevelPreviewHover(div, jsonStr, data.name || file);
  }
}

export function drawEditorWires() {
  if (!S.editorWiresGroup) return;
  // Clear old
  while (S.editorWiresGroup.children.length) {
    const c = S.editorWiresGroup.children[0];
    disposeMaterial(c.material);
    S.editorWiresGroup.remove(c);
  }

  // Draw wire paths for links
  S.activeLevel.links.forEach(l => {
    let matColor = 0x00ffff;
    let fromPos, toPos;
    if (l.type === 'switch-trigger') {
      matColor = 0x00ff88;
      const [fx,fy,fz] = l.from.split(',').map(Number);
      const [tx,ty,tz] = l.to.split(',').map(Number);
      fromPos = new THREE.Vector3(fx, fy+0.5, fz);
      toPos = new THREE.Vector3(tx, ty+0.5, tz);
    } else if (l.type === 'teleporter-link') {
      matColor = 0x9955ff;
      const [fx,fy,fz] = l.k1.split(',').map(Number);
      const [tx,ty,tz] = l.k2.split(',').map(Number);
      fromPos = new THREE.Vector3(fx, fy+0.5, fz);
      toPos = new THREE.Vector3(tx, ty+0.5, tz);
    }
    if (fromPos && toPos) {
      const geo = new THREE.BufferGeometry().setFromPoints([fromPos, toPos]);
      const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: matColor, dashSize: 0.3, gapSize: 0.15 }));
      line.computeLineDistances();
      S.editorWiresGroup.add(line);
    }
  });

  // Draw faint links between members of each compound object so groupings
  // are visible in the editor.
  const groups = new Map(); // groupId -> [block,...]
  S.activeLevel.blocks.forEach(b => {
    const g = b.properties && b.properties.group;
    if (g === undefined || g === null) return;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(b);
  });
  groups.forEach(members => {
    if (members.length < 2) return;
    const cx = members.reduce((s, b) => s + b.x, 0) / members.length;
    const cy = members.reduce((s, b) => s + b.y, 0) / members.length + 0.5;
    const cz = members.reduce((s, b) => s + b.z, 0) / members.length;
    const centroid = new THREE.Vector3(cx, cy, cz);
    members.forEach(b => {
      const geo = new THREE.BufferGeometry().setFromPoints([centroid, new THREE.Vector3(b.x, b.y + 0.5, b.z)]);
      const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: 0xffaa00, dashSize: 0.18, gapSize: 0.12, opacity: 1.0, transparent: false }));
      line.computeLineDistances();
      S.editorWiresGroup.add(line);
    });
  });

  // While grouping (O held), wrap every member of the active group in a bright
  // orange wireframe box so it's obvious which blocks are being combined.
  if (S.currentGroupId !== null) {
    const boxGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.12, 1.12, 1.12));
    S.activeLevel.blocks.forEach(b => {
      if (!b.properties || b.properties.group !== S.currentGroupId) return;
      const yOff = (b.type === 'bridge') ? 0.4 : 0;
      const box = new THREE.LineSegments(boxGeo, new THREE.LineBasicMaterial({ color: 0xffbb33 }));
      box.position.set(b.x, b.y + yOff, b.z);
      S.editorWiresGroup.add(box);
    });
  }

  // Draw paths for moving platforms
  S.activeLevel.blocks.forEach((b, k) => {
    if (b.type === 'moving' && b.properties.targetX !== undefined) {
      const start = new THREE.Vector3(b.x, b.y + 0.5, b.z);
      const end = new THREE.Vector3(b.properties.targetX, b.properties.targetY + 0.5, b.properties.targetZ);
      const geo = new THREE.BufferGeometry().setFromPoints([start, end]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x44aa55 }));
      S.editorWiresGroup.add(line);
    }
  });
}

export function editorRaycast(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, camera);

  // Raycast against existing blocks, moving platforms, and prisms
  const targets = [...tilesGroup.children, ...bridgeGroup.children, ...prismsGroup.children];
  const intersects = raycaster.intersectObjects(targets, false);
  if (intersects.length > 0) {
    const hit = intersects[0];
    const normal = hit.face.normal;
    const blockPos = hit.object.position.clone();
    // Voxel stack position
    const targetPos = blockPos.clone();
    // Only block tools build adjacent to the clicked face; items (start/exit/
    // prism), eraser and linker target the clicked cell itself.
    if (BLOCK_TOOLS.includes(S.selectedTool)) {
      targetPos.add(normal);
    }
    return {
      x: Math.round(targetPos.x),
      y: Math.round(targetPos.y),
      z: Math.round(targetPos.z),
      hitKey: hit.object.userData.key,
      hitType: hit.object.userData.type
    };
  }

  // Fallback to editing grid helper plane
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(S.editY - 0.5));
  const intersectPoint = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(plane, intersectPoint)) {
    return {
      x: Math.round(intersectPoint.x),
      y: Math.round(S.editY),
      z: Math.round(intersectPoint.z),
      hitKey: null,
      hitType: null
    };
  }
  return null;
}

export function snapItemCell(hit) {
  // Items (start/exit/prisms) must sit on a block cell to be reachable.
  // When clicking a block, use that cell; on empty grid cells, snap down
  // to the top block of the column.
  if (hit.hitKey && hit.hitType !== 'prism' && hit.hitType !== 'miniprism' && hit.hitType !== 'enemy') {
    return { x: hit.x, y: hit.y, z: hit.z };
  }
  let topY = null;
  S.activeLevel.blocks.forEach(b => {
    if (b.x === hit.x && b.z === hit.z && b.y <= hit.y && (topY === null || b.y > topY)) topY = b.y;
  });
  return { x: hit.x, y: topY !== null ? topY : hit.y, z: hit.z };
}

// Incremental editing — avoids a full level rebuild (and audio restart) on
// every placed/erased voxel, which made painting large levels laggy.
export function editorEraseKey(key, kinds = ['block', 'prism', 'enemy']) {
  let removed = false;
  if (kinds.includes('enemy') && S.activeLevel.enemies.has(key)) {
    S.activeLevel.enemies.delete(key);
    const m = S.enemyMarkers.get(key);
    if (m) {
      prismsGroup.remove(m);
      disposeMaterial(m.material);
      m.children.forEach(ch => { if (ch.geometry) ch.geometry.dispose(); disposeMaterial(ch.material); });
    }
    S.enemyMarkers.delete(key);
    removed = true;
  }
  if (kinds.includes('prism') && S.activeLevel.prisms.has(key)) {
    S.activeLevel.prisms.delete(key);
    const p = S.activePrisms.get(key);
    if (p && p.mesh) { prismsGroup.remove(p.mesh); disposeMaterial(p.mesh.material); }
    S.activePrisms.delete(key);
    removed = true;
  }
  if (kinds.includes('block') && S.activeLevel.blocks.has(key)) {
    const hasLinks = S.activeLevel.links.some(l => l.from === key || l.to === key || l.k1 === key || l.k2 === key);
    S.activeLevel.blocks.delete(key);
    if (hasLinks) {
      // Removing a linked block changes trigger wiring — full rebuild
      S.activeLevel.links = S.activeLevel.links.filter(l => l.from !== key && l.to !== key && l.k1 !== key && l.k2 !== key);
      if (!S.batchEditing) {
        buildLevel3D(S.activeLevel);
        drawEditorWires();
      } else {
        S.batchRebuildNeeded = true;
      }
      return true;
    }
    const b = S.activeBlocks.get(key);
    if (b) {
      if (b.platformInstance) {
        const i = S.movingPlatformsList.indexOf(b.platformInstance);
        if (i >= 0) S.movingPlatformsList.splice(i, 1);
        b.platformInstance.dispose();
      }
      if (b.mesh) {
        tilesGroup.remove(b.mesh);
        disposeMaterial(b.mesh.material);
        b.mesh.children.forEach(ch => { disposeMaterial(ch.material); });
      }
      S.activeBlocks.delete(key);
    }
    removed = true;
    if (!S.batchEditing) {
      drawEditorWires();
    }
  }
  return removed;
}

export function editorPlaceBlock(x, y, z, type) {
  const key = `${x},${y},${z}`;
  const existing = S.activeLevel.blocks.get(key);
  if (existing && existing.type === type) return false;
  if (existing) editorEraseKey(key, ['block']);
  const b = { x, y, z, type, properties: {} };
  if (S.currentGroupId !== null) b.properties.group = S.currentGroupId;
  S.activeLevel.blocks.set(key, b);
  const rb = { ...b, broken: false, active: true };
  S.activeBlocks.set(key, rb);
  if (type === 'moving') {
    const mp = new MovingPlatform(key, x, y, z, x, y, z, 1.5, true);
    S.movingPlatformsList.push(mp);
    rb.platformInstance = mp;
  } else {
    createBlockMesh(rb, key);
  }
  if (!S.batchEditing) {
    updateEditorSlicing();
    // While grouping (O held), give live audio + visual feedback per added block.
    if (S.currentGroupId !== null) {
      audio.playGroupAdd(groupMemberCount(S.currentGroupId));
      refreshGroupingIndicator();
      drawEditorWires();
    }
  }
  return true;
}

export function editorPlacePrism(x, y, z, type) {
  const key = `${x},${y},${z}`;
  const existing = S.activeLevel.prisms.get(key);
  if (existing && existing.type === type) return false;
  if (existing) editorEraseKey(key, ['prism']);
  S.activeLevel.prisms.set(key, { type });
  const p = { type, collected: false };
  S.activePrisms.set(key, p);
  createPrismMesh(key, p);
  updateEditorSlicing();
  return true;
}

export function editorPlaceEnemy(x, y, z) {
  const key = `${x},${y},${z}`;
  if (S.activeLevel.enemies.has(key)) return false;
  S.activeLevel.enemies.set(key, {});
  createEnemyMarker(key);
  updateEditorSlicing();
  return true;
}

export function editorSetStart(c) {
  S.activeLevel.start = { x: c.x, y: c.y, z: c.z };
  S.playerGridPos = { ...S.activeLevel.start };
  if (S.playerCube) {
    S.playerCube.position.copy(getPlayerWorldPos(c.x, c.y, c.z, false));
    S.playerCube.quaternion.identity();
  }
  audio.playPlace('start');
}

export function editorFillPlane(y, type) {
  S.batchEditing = true;
  S.batchRebuildNeeded = false;
  let placedAny = false;

  for (let x = -25; x <= 25; x++) {
    for (let z = -25; z <= 25; z++) {
      if (editorPlaceBlock(x, y, z, type)) {
        placedAny = true;
      }
    }
  }

  S.batchEditing = false;
  if (S.batchRebuildNeeded) {
    buildLevel3D(S.activeLevel);
  } else if (placedAny) {
    updateEditorSlicing();
  }
  drawEditorWires();
}

export function editorClearPlane(y) {
  S.batchEditing = true;
  S.batchRebuildNeeded = false;
  let erasedAny = false;

  const keysToErase = [];
  S.activeLevel.blocks.forEach((b, k) => {
    if (b.y === y) keysToErase.push({ key: k, kinds: ['block'] });
  });
  S.activeLevel.prisms.forEach((p, k) => {
    const py = k.split(',').map(Number)[1];
    if (py === y) keysToErase.push({ key: k, kinds: ['prism'] });
  });
  S.activeLevel.enemies.forEach((e, k) => {
    const ey = k.split(',').map(Number)[1];
    if (ey === y) keysToErase.push({ key: k, kinds: ['enemy'] });
  });

  keysToErase.forEach(item => {
    if (editorEraseKey(item.key, item.kinds)) {
      erasedAny = true;
    }
  });

  S.batchEditing = false;
  if (S.batchRebuildNeeded) {
    buildLevel3D(S.activeLevel);
  } else if (erasedAny) {
    updateEditorSlicing();
  }
  drawEditorWires();
}

export function commitPlaneDraw() {
  if (!S.isDrawingPlane || !S.planeStartPos || !S.planeEndPos) return;
  S.isDrawingPlane = false;
  if (S.editorPlanePreview) S.editorPlanePreview.visible = false;

  const minX = Math.min(S.planeStartPos.x, S.planeEndPos.x);
  const maxX = Math.max(S.planeStartPos.x, S.planeEndPos.x);
  const minZ = Math.min(S.planeStartPos.z, S.planeEndPos.z);
  const maxZ = Math.max(S.planeStartPos.z, S.planeEndPos.z);

  pushUndoSnapshot();

  S.batchEditing = true;
  S.batchRebuildNeeded = false;
  let changedAny = false;

  if (BLOCK_TOOLS.includes(S.selectedTool)) {
    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        if (editorPlaceBlock(x, S.editY, z, S.selectedTool)) {
          changedAny = true;
        }
      }
    }
    if (changedAny) audio.playPlace(S.selectedTool);
  } else if (S.selectedTool === 'eraser') {
    const keysToErase = [];
    S.activeLevel.blocks.forEach((b, k) => {
      if (b.y === S.editY && b.x >= minX && b.x <= maxX && b.z >= minZ && b.z <= maxZ) {
        keysToErase.push({ key: k, kinds: ['block'] });
      }
    });
    S.activeLevel.prisms.forEach((p, k) => {
      const [px, py, pz] = k.split(',').map(Number);
      if (py === S.editY && px >= minX && px <= maxX && pz >= minZ && pz <= maxZ) {
        keysToErase.push({ key: k, kinds: ['prism'] });
      }
    });
    S.activeLevel.enemies.forEach((e, k) => {
      const [ex, ey, ez] = k.split(',').map(Number);
      if (ey === S.editY && ex >= minX && ex <= maxX && ez >= minZ && ez <= maxZ) {
        keysToErase.push({ key: k, kinds: ['enemy'] });
      }
    });

    keysToErase.forEach(item => {
      if (editorEraseKey(item.key, item.kinds)) {
        changedAny = true;
      }
    });
    if (changedAny) audio.playBreak();
  }

  S.batchEditing = false;
  if (S.batchRebuildNeeded) {
    buildLevel3D(S.activeLevel);
  } else if (changedAny) {
    updateEditorSlicing();
  }
  drawEditorWires();

  S.planeStartPos = null;
  S.planeEndPos = null;
}

export function handleEditorClick(e) {
  const hit = editorRaycast(e);
  if (!hit) return;

  if (S.keysPressed['KeyV']) {
    if (BLOCK_TOOLS.includes(S.selectedTool)) {
      editorFillPlane(S.editY, S.selectedTool);
      audio.playPlace(S.selectedTool);
      return;
    } else if (S.selectedTool === 'eraser') {
      editorClearPlane(S.editY);
      audio.playBreak();
      return;
    }
  }

  if (S.selectedTool === 'eraser') {
    if (hit.hitKey) {
      let kinds = ['block'];
      if (hit.hitType === 'prism' || hit.hitType === 'miniprism') kinds = ['prism'];
      else if (hit.hitType === 'enemy') kinds = ['enemy'];
      if (editorEraseKey(hit.hitKey, kinds)) audio.playBreak();
    }
    return;
  }

  if (S.selectedTool === 'linker') {
    if (S.linkerSourceKey === null) {
      // Set Source
      if (!hit.hitKey) return;
      const block = S.activeLevel.blocks.get(hit.hitKey);
      if (block && (block.type === 'switch' || block.type === 'pressureplate' || block.type === 'teleporter' || block.type === 'moving')) {
        S.linkerSourceKey = hit.hitKey;
        const srcGroup = block.properties && block.properties.group;
        const srcGrouped = srcGroup !== undefined && srcGroup !== null;
        if (block.type === 'moving') showMessage(srcGrouped ? 'OBJECT SELECTED — CLICK DESTINATION CELL' : 'PLATFORM SELECTED — CLICK DESTINATION CELL');
        else if (block.type === 'teleporter') showMessage('PORTAL SELECTED — CLICK SECOND PORTAL');
        else showMessage(srcGrouped ? 'OBJECT SOURCE — CLICK ANY ELEMENT OF TARGET OBJECT' : 'SOURCE SELECTED — CLICK A BRIDGE, MOVER OR GROUPED BLOCK');
      } else {
        showMessage('SELECT A SWITCH, PLATE, PORTAL OR MOVING PLATFORM', 1.6);
      }
      return;
    }
    // Connect to Target
    const source = S.activeLevel.blocks.get(S.linkerSourceKey);
    const target = hit.hitKey ? S.activeLevel.blocks.get(hit.hitKey) : null;
    let linked = false;
    if (source && source.type === 'moving' && S.linkerSourceKey !== hit.hitKey) {
      // Moving platforms may target any cell, including empty grid cells.
      // For compound groups: apply the same displacement vector to every
      // mover in the group so the whole object travels as one piece.
      const destX = target ? target.x : hit.x;
      const destY = target ? target.y : hit.y;
      const destZ = target ? target.z : hit.z;
      const dispX = destX - source.x, dispY = destY - source.y, dispZ = destZ - source.z;
      source.properties.targetX = destX;
      source.properties.targetY = destY;
      source.properties.targetZ = destZ;
      const g = source.properties.group;
      let moverCount = 1;
      if (g !== undefined && g !== null) {
        S.activeLevel.blocks.forEach((b, k) => {
          if (b.properties && b.properties.group === g && b.type === 'moving' && k !== S.linkerSourceKey) {
            b.properties.targetX = b.x + dispX;
            b.properties.targetY = b.y + dispY;
            b.properties.targetZ = b.z + dispZ;
            moverCount++;
          }
        });
      }
      showMessage(moverCount > 1 ? `OBJECT DESTINATION SET (${moverCount} MOVERS)` : 'PLATFORM DESTINATION SET');
      linked = true;
    } else if (source && target && S.linkerSourceKey !== hit.hitKey) {
      if (source.type === 'switch' || source.type === 'pressureplate') {
        // Accept any block as target — if it belongs to a compound group,
        // find all triggerable (bridge / moving) members of that group.
        // This lets the user click on ANY element of a grouped object.
        const groupId = target.properties && target.properties.group;
        let members = [];
        if (target.type === 'bridge' || target.type === 'moving') members = [target];
        if (groupId !== undefined && groupId !== null) {
          const groupLinkable = [...S.activeLevel.blocks.values()].filter(b =>
            b.properties && b.properties.group === groupId &&
            (b.type === 'bridge' || b.type === 'moving'));
          if (groupLinkable.length > 0) members = groupLinkable;
        }
        if (members.length > 0) {
          members.forEach(m => {
            const tk = `${m.x},${m.y},${m.z}`;
            if (!S.activeLevel.links.some(l => l.type === 'switch-trigger' && l.from === S.linkerSourceKey && l.to === tk)) {
              S.activeLevel.links.push({ type: 'switch-trigger', from: S.linkerSourceKey, to: tk });
            }
          });
          showMessage(members.length > 1 ? `OBJECT TRIGGER LINKED (${members.length} ELEMENTS)` : 'TRIGGER LINKED');
          linked = true;
        } else {
          showMessage('INVALID LINK TARGET — CLICK A BRIDGE, MOVER OR GROUPED OBJECT', 1.6);
        }
      } else if (source.type === 'teleporter' && target.type === 'teleporter') {
        S.activeLevel.links.push({ type: 'teleporter-link', k1: S.linkerSourceKey, k2: hit.hitKey });
        showMessage('PORTALS LINKED');
        linked = true;
      } else {
        showMessage('INVALID LINK TARGET', 1.4);
      }
    }
    S.linkerSourceKey = null;
    if (linked) {
      audio.playLinkSuccess();
      buildLevel3D(S.activeLevel);
      drawEditorWires();
    } else {
      audio.playLinkCancel();
    }
    return;
  }

  // Placement tools — blocks go only onto the selected level (raise the height
  // ruler to build higher); drag-painting already snaps to that plane.
  if (BLOCK_TOOLS.includes(S.selectedTool)) {
    if (hit.y === S.editY && editorPlaceBlock(hit.x, hit.y, hit.z, S.selectedTool)) audio.playPlace(S.selectedTool);
  } else if (S.selectedTool === 'prism' || S.selectedTool === 'miniprism' || S.selectedTool === 'plutonium') {
    const c = snapItemCell(hit);
    if (editorPlacePrism(c.x, c.y, c.z, S.selectedTool)) audio.playPlace(S.selectedTool);
  } else if (S.selectedTool === 'enemy') {
    const c = snapItemCell(hit);
    if (editorPlaceEnemy(c.x, c.y, c.z)) audio.playPlace('enemy');
  } else if (S.selectedTool === 'start') {
    editorSetStart(snapItemCell(hit));
  } else if (S.selectedTool === 'exit') {
    const c = snapItemCell(hit);
    S.activeLevel.exit = { x: c.x, y: c.y, z: c.z };
    buildLevel3D(S.activeLevel);
    audio.playPlace('exit');
  }
  drawEditorWires();
}

export function handleEditorDragClick(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, camera);

  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(S.editY - 0.5));
  const intersectPoint = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(plane, intersectPoint)) {
    const gx = Math.round(intersectPoint.x);
    const gy = Math.round(S.editY);
    const gz = Math.round(intersectPoint.z);
    const key = `${gx},${gy},${gz}`;

    if (S.selectedTool === 'eraser') {
      if (editorEraseKey(key)) audio.playBreak();
    } else if (BLOCK_TOOLS.includes(S.selectedTool)) {
      if (editorPlaceBlock(gx, gy, gz, S.selectedTool)) audio.playPlace(S.selectedTool);
    } else if (S.selectedTool === 'prism' || S.selectedTool === 'miniprism' || S.selectedTool === 'plutonium') {
      const c = snapItemCell({ x: gx, y: gy, z: gz, hitKey: null });
      if (editorPlacePrism(c.x, c.y, c.z, S.selectedTool)) audio.playPlace(S.selectedTool);
    } else if (S.selectedTool === 'enemy') {
      const c = snapItemCell({ x: gx, y: gy, z: gz, hitKey: null });
      if (editorPlaceEnemy(c.x, c.y, c.z)) audio.playPlace('enemy');
    } else if (S.selectedTool === 'start') {
      const c = snapItemCell({ x: gx, y: gy, z: gz, hitKey: null });
      if (S.activeLevel.start.x !== c.x || S.activeLevel.start.y !== c.y || S.activeLevel.start.z !== c.z) {
        editorSetStart(c);
      }
    } else if (S.selectedTool === 'exit') {
      const c = snapItemCell({ x: gx, y: gy, z: gz, hitKey: null });
      if (S.activeLevel.exit.x !== c.x || S.activeLevel.exit.y !== c.y || S.activeLevel.exit.z !== c.z) {
        S.activeLevel.exit = { x: c.x, y: c.y, z: c.z };
        buildLevel3D(S.activeLevel);
        drawEditorWires();
        audio.playPlace('exit');
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════════
   PLAYTEST MODE
   ═══════════════════════════════════════════════════════════ */

export function enterPlaytestMode() {
  S.isPlaytesting = true;
  S.isPainting = false;
  S.currentGroupId = null;
  setGroupingUI(false);
  S.playerLives = MAX_LIVES;
  S.savedEditorLevel = serializeLevel(S.activeLevel); // Save design snapshot

  document.getElementById('editor-toolbox').style.display = 'none';
  document.getElementById('editor-top-bar').style.display = 'none';
  document.getElementById('editor-bottom-bar').innerHTML = `
    <span style="letter-spacing:0.1em; color:var(--green)">PLAYTESTING CUSTOM LEVEL</span>
    <button id="btn-playtest-stop" class="editor-btn danger">STOP PLAYTEST</button>
  `;
  document.getElementById('editor-instructions').style.display = 'none';
  document.getElementById('editor-height-ruler').style.display = 'none';

  if (S.editorGridHelper) S.editorGridHelper.visible = false;
  if (S.editorGhostBlock) S.editorGhostBlock.visible = false;
  if (S.editorWiresGroup) S.editorWiresGroup.visible = false;

  // Build play level
  buildLevel3D(S.activeLevel);
  // Focus playing controls
  document.getElementById('btn-playtest-stop').addEventListener('click', exitPlaytestMode);
  audio.playPlaytestEnter();
}

export function exitPlaytestMode() {
  S.isPlaytesting = false;
  S.activeLevel = deserializeLevel(S.savedEditorLevel);

  document.getElementById('editor-toolbox').style.display = 'flex';
  document.getElementById('editor-top-bar').style.display = 'flex';
  document.getElementById('editor-bottom-bar').innerHTML = `
    <div style="display:flex; align-items:center; gap:12px;">
      <span>EDITING HEIGHT (Y):</span>
      <button id="btn-height-down" class="height-btn">▼</button>
      <span id="height-display" style="font-size:16px; font-weight:bold; color:var(--accent2); width:20px; text-align:center;">${S.editY}</span>
      <button id="btn-height-up" class="height-btn">▲</button>
      <span style="opacity:0.5; font-size:11px; margin-left:10px;">(Scroll to change)</span>
    </div>
    <div style="display:flex; gap:10px;">
      <button id="btn-playtest" class="editor-btn success">PLAYTEST</button>
      <button id="btn-editor-exit" class="editor-btn">EXIT</button>
    </div>
  `;
  document.getElementById('editor-instructions').style.display = 'flex';
  document.getElementById('editor-height-ruler').style.display = 'flex';

  if (S.editorGridHelper) S.editorGridHelper.visible = true;
  if (S.editorGhostBlock) S.editorGhostBlock.visible = true;
  if (S.editorWiresGroup) S.editorWiresGroup.visible = true;

  // Bind new element buttons
  document.getElementById('btn-height-down').addEventListener('click', () => adjustEditHeight(-1));
  document.getElementById('btn-height-up').addEventListener('click', () => adjustEditHeight(1));
  document.getElementById('btn-playtest').addEventListener('click', enterPlaytestMode);
  document.getElementById('btn-editor-exit').addEventListener('click', exitEditMode);

  buildLevel3D(S.activeLevel);
  drawEditorWires();
  audio.playPlaytestExit();
}

export function adjustEditHeight(val) {
  const oldY = S.editY;
  S.editY = Math.max(rulerMinY, Math.min(rulerMaxY, S.editY + val));
  if (S.editY !== oldY) {
    audio.playHeightChange(val > 0);
  }
  document.getElementById('height-display').textContent = S.editY;
  if (S.editorGridHelper) S.editorGridHelper.position.set(0.5, S.editY - 0.49, 0.5);
  if (S.editorGridPlane) S.editorGridPlane.position.set(0.5, S.editY - 0.49, 0.5);
  renderVerticalRuler();
  updateEditorSlicing();
}

export function selectToolByName(name) {
  toolButtons.forEach(b => b.classList.toggle('active', b.dataset.tool === name));
  S.selectedTool = name;
  S.linkerSourceKey = null;
  audio.playToolSelect();
}
