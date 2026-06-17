import * as THREE from 'three';
import { TILE_SIZE, CUBE_S, ROLL_DUR_NORMAL, ROLL_DUR_MINI, CAM_LERP, BALANCE_WINDOW, COMBO_TIMEOUT, MAX_LIVES, BLOCK_TOOLS } from './constants.js';
import { WORLDS, DEMO_LEVEL } from './levels-data.js';
import { S, audio } from './state.js';
import {
  renderer, scene, camera, underGlow, starfield, starUniforms,
  matTileBase, matTileFragile, matTileIce, matTileSwitch, matTileTp, matTileExit,
  matCube, matPrism, matMiniPrism, matPrismGlow, matBridge, matSwitchPillar,
  matCrate, matPressurePlate, matDanger, matShaker, matBooster,
  matPlutonium, matPlutoniumGlow, matContainer,
  geoTile, geoThinTile, geoCube, geoPrism, geoRing, geoPillar, geoTrail,
  worldGroup, tilesGroup, prismsGroup, effectsGroup, bridgeGroup,
  getPlayerWorldPos
} from './scene.js';
import { Level3D, MovingPlatform, serializeLevel, deserializeLevel } from './level.js';
import { generateAILabyrinth, generateArchitectLevel, generateArchitectLevel2, generateArchitectLevel3 } from './ai-levels.js';
import {
  spawnEntranceParticles, spawnCollectParticles, spawnBreakParticles, spawnLandingParticles,
  spawnTeleportParticles, spawnPlutoniumDepositParticles, spawnLevelCompleteExplosion,
  spawnTrailParticle, addShake, flashScreen
} from './particles.js';
import {
  updatePrismUI, updatePlutoniumUI, updateMoveUI, updateTimerUI, updateComboUI,
  showMessage, playTypewriterTitle, groupMemberCount, refreshGroupingIndicator, setGroupingUI
} from './ui.js';
import {
  enemyBFS, findEnemySpawnKey, checkEnemiesTrappedWin, startEnemyRoll, loseLife, updateLivesUI
} from './enemies.js';
import {
  createBlockMesh, createPrismMesh, spawnEnemy, createEnemyMarker, setMeshOpacity, disposeMaterial
} from './meshes.js';
import {
  getBlocksInColumn, checkRidingPlatform, checkPushedByPlatform, enterBalancing, executePush,
  updatePressurePlates, triggerSwitchTargets, executeRollBack, canReverseRoll, reverseCurrentRoll,
  triggerShakerCrumble, isLastMoveKeyHeld, startRoll, executeRoll, onRollComplete, breakFragileBlock,
  triggerSwitch, triggerTeleport, checkPrismCollection, activateMiniCube, checkGrowBack,
  checkLevelComplete, advanceCompletedLevel, completeLevel, respawnPlayer
} from './gameplay.js';
import {
  pushUndoSnapshot, editorUndo, updateUndoButton, enterEditMode, exitEditMode, lvlInsertDefaultBlocks,
  renderVerticalRuler, updateEditorSlicing, drawEditorWires, editorRaycast, snapItemCell, editorEraseKey,
  editorPlaceBlock, editorPlacePrism, editorPlaceEnemy, editorSetStart, editorFillPlane, editorClearPlane,
  commitPlaneDraw, handleEditorClick, handleEditorDragClick, enterPlaytestMode, exitPlaytestMode,
  adjustEditHeight, updateLibraryList, loadFolderLevels, selectToolByName
} from './editor.js';
import { animate, updateDynamicTransparency } from './gameloop.js';

// Re-exported for the gameplay/enemies/editor/gameloop modules (circular imports; resolved at call time, not module eval).
export { buildLevel3D, loadPreMadeLevel, loadDemoLevel, applyXrayOverride, toolButtons, handleMove, updatePauseOrbitCamera };

/* ═══ TRUE CONSTANTS (all mutable state lives on the S object in state.js) ═══ */
const XRAY_OPACITY = 0.3;


/* ═══════════════════════════════════════════════════════════
   CLEAR / BUILD LEVEL
   ═══════════════════════════════════════════════════════════ */
function clearLevel() {
  [tilesGroup, prismsGroup, effectsGroup, bridgeGroup].forEach(g => {
    while (g.children.length) {
      const c = g.children[g.children.length-1];
      disposeMaterial(c.material);
      c.children.forEach(ch => { disposeMaterial(ch.material); });
      g.remove(c);
    }
  });
  if (S.playerCube) { worldGroup.remove(S.playerCube); S.playerCube = null; }
  if (S.exitRing) { worldGroup.remove(S.exitRing); S.exitRing = null; }
  S.enemies.forEach(en => { worldGroup.remove(en.cube); disposeMaterial(en.cube.material); });
  S.enemies = [];
  S.enemyMarkers.clear(); // marker meshes live in prismsGroup, disposed by the group loop above
  S.particles.length = 0; S.trailParts.length = 0;

  S.movingPlatformsList.forEach(mp => mp.dispose());
  S.movingPlatformsList = [];
  S.ridingPlatform = null;
  S.rollCarrier = null;
  S.activeBlocks.clear();
  S.activePrisms.clear();
  S.containerMeshes = [];
  S.switchMap.clear();
  S.teleporterMap.clear();
  S.switchStates.clear();
  S.linkerSourceKey = null;
  S.currentGroupId = null;
  S.completeAnimStartTime = 0;
  if (typeof starfield !== 'undefined' && starfield) {
    starfield.scale.setScalar(1.0);
    starfield.rotation.set(0, 0, 0);
  }
  // A rebuild (level change / restart) clears any active pause.
  if (S.isPaused) { S.isPaused = false; document.getElementById('pause-overlay')?.classList.remove('show'); }
  S.pausePointers.clear(); S.pausePinchDist = null;
}

function buildLevel3D(level3D) {
  clearLevel();
  S.isCarryingPlutonium = 0;
  S.plutoniumTimer = level3D.plutoniumTimeLimit ?? 30.0;
  S.depositedPlutonium = 0;
  S.hasCollectedPlutoniumThisRun = false;
  const phud = document.getElementById('plutonium-hud-bar');
  if (phud) phud.style.display = 'none';

  S.activeLevel = level3D;
  S.levelSnapshot = serializeLevel(level3D);
  const world = WORLDS[level3D.world];

  scene.background = new THREE.Color(world.bg);
  // No fog while editing — zooming out shouldn't darken the level. Fog is kept
  // for normal play and playtesting.
  scene.fog = (S.isEditMode && !S.isPlaytesting) ? null : new THREE.Fog(world.bg, 12, 38);
  audio.startAmbient(level3D.world);

  // Parse Level Configs (everything starts active; link targets are switched off below)
  level3D.blocks.forEach((b, k) => {
    S.activeBlocks.set(k, { ...b, broken: false, active: true });
  });
  level3D.prisms.forEach((p, k) => {
    S.activePrisms.set(k, { ...p, collected: false });
  });

  level3D.links.forEach(l => {
    if (l.type === 'switch-trigger') {
      if (!S.switchMap.has(l.from)) S.switchMap.set(l.from, []);
      S.switchMap.get(l.from).push(l.to);
      const target = S.activeBlocks.get(l.to);
      // Triggered bridges/platforms start off until their switch activates them
      if (target && (target.type === 'bridge' || target.type === 'moving')) target.active = false;
    } else if (l.type === 'teleporter-link') {
      S.teleporterMap.set(l.k1, l.k2);
      S.teleporterMap.set(l.k2, l.k1);
    }
  });

  // Render Blocks
  S.activeBlocks.forEach((block, key) => {
    if (block.type === 'moving') {
      const mp = new MovingPlatform(
        key, block.x, block.y, block.z,
        block.properties.targetX ?? block.x, block.properties.targetY ?? block.y, block.properties.targetZ ?? block.z,
        block.properties.speed ?? 1.5, block.active !== false
      );
      S.movingPlatformsList.push(mp);
      block.platformInstance = mp;
      return;
    }
    createBlockMesh(block, key);
  });

  // Compound objects: a moving block tagged with a group id drives the whole
  // object. Every other member of that group rides along as a passenger so the
  // entire structure translates together — not just the single moving tile.
  const groupMembers = new Map();
  S.activeBlocks.forEach(b => {
    const g = b.properties && b.properties.group;
    if (g === undefined || g === null) return;
    if (!groupMembers.has(g)) groupMembers.set(g, []);
    groupMembers.get(g).push(b);
  });
  groupMembers.forEach(members => {
    const driverBlock = members.find(b => b.type === 'moving' && b.platformInstance);
    if (!driverBlock) return; // group has no mover — nothing to carry
    const driver = driverBlock.platformInstance;
    members.forEach(other => {
      if (other === driverBlock) return;
      let mesh = other.mesh;
      if (other.type === 'moving' && other.platformInstance && other.platformInstance !== driver) {
        // A second mover in the group: freeze its own motion and let the driver carry it
        mesh = other.platformInstance.mesh;
        other.platformInstance.active = false;
        other.platformInstance.isPassenger = true;
        other.platformInstance.end.copy(other.platformInstance.start);
      }
      if (mesh) driver.attachMember(other, mesh);
    });
  });

  // Render Prisms
  S.activePrisms.forEach((p, key) => createPrismMesh(key, p));

  // Goal exit
  S.exitPos = { ...level3D.exit };
  S.exitRing = new THREE.Mesh(geoRing, new THREE.MeshStandardMaterial({
    color:'#00ffaa', roughness:0.15, metalness:0.4, emissive:'#00ff88', emissiveIntensity:1.2,
  }));
  S.exitRing.rotation.x = -Math.PI/2;
  S.exitRing.position.set(S.exitPos.x, S.exitPos.y + 0.5, S.exitPos.z);
  S.exitRing.scale.set(0.01, 0.01, 0.01);
  worldGroup.add(S.exitRing);

  // Player cube
  S.playerGridPos = { ...level3D.start };
  S.isMini = false; S.miniTimer = 0;
  S.playerCube = new THREE.Mesh(geoCube, matCube.clone());
  S.playerCube.position.copy(getPlayerWorldPos(S.playerGridPos.x, S.playerGridPos.y, S.playerGridPos.z, false));
  S.playerCube.castShadow = true; S.playerCube.receiveShadow = true;
  worldGroup.add(S.playerCube);

  // Enemies – placed in the editor. During gameplay/playtest each spawn point
  // becomes a live chaser; in pure edit mode we show a static marker instead.
  if (!S.isEditMode || S.isPlaytesting) {
    if (level3D.enemies.size > 0) {
      level3D.enemies.forEach((e, key) => spawnEnemy(key));
    } else if (!S.isCustomLevel && !S.isEditMode) {
      // Built-in campaign levels predate enemy placement — keep their original
      // single auto-spawned chaser at the most distant reachable cell.
      spawnEnemy(findEnemySpawnKey());
    }
  } else {
    level3D.enemies.forEach((e, key) => createEnemyMarker(key));
  }
  S.playerInvincible = false;
  S.playerInvincibleTimer = 0;

  S.cameraTarget.copy(S.playerCube.position);
  S.cameraLookAt.copy(S.playerCube.position);

  S.moveCount = 0; S.elapsedTime = 0; S.gameTimer = 0; S.comboCount = 0; S.comboTimer = 0;
  S.isRolling = false; S.isBalancing = false; S.isTeleporting = false; S.isFalling = false; S.isLevelComplete = false;

  document.getElementById('world-name').textContent = world.name.toUpperCase();
  playTypewriterTitle(document.getElementById('level-name'), level3D.name);
  document.getElementById('level-number').textContent = S.isEditMode ? 'E' : (S.isCustomLevel ? 'C' : S.currentLevelIdx + 1);
  S.placedBlocksCount = 0;
  updatePrismUI(); updatePlutoniumUI(); updateMoveUI(); updateTimerUI(); updateBuildUI();
  if (document.getElementById('level-build-limit-input')) {
    document.getElementById('level-build-limit-input').value = level3D.buildBlocksLimit ?? 10;
  }
  document.getElementById('mini-hud-bar').style.display = 'none';

  spawnEntranceParticles(S.playerGridPos.x, S.playerGridPos.y, S.playerGridPos.z);
  updatePressurePlates();
  updateLivesUI();
  updateEditorSlicing();

  // Apply the see-through (X-ray) pass right now, with up-to-date world matrices,
  // so it is correct on the very first frame after a (re)build. The pass is
  // normally throttled (every 6 frames); without this immediate run the first
  // throttled pass after an R-restart could fire before the renderer refreshed
  // the freshly-rebuilt meshes' matrices, raycast against stale transforms, find
  // no occluders, and leave blocks opaque — which is why the effect only kicked
  // in "ab und zu" after a restart.
  worldGroup.updateMatrixWorld(true);
  S.transparencyUpdateTimer = 0;
  updateDynamicTransparency();
}


// X-ray view: force every currently-visible block / platform see-through so the
// whole 3D structure reads through nearer geometry. Runs as the last step of
// updateEditorSlicing so it survives slicing, edits and rebuilds. Prisms, enemy
// markers and edge outlines stay opaque to remain readable.
function applyXrayOverride() {
  // X-ray transparency removed at user request
}

function toggleXray() {
  S.xrayMode = !S.xrayMode;
  audio.playXrayToggle(S.xrayMode);
  updateEditorSlicing();        // editor: applies / restores slicing opacity
  updateDynamicTransparency();  // play: apply (or clear) the see-through pass at once
  showMessage(S.xrayMode ? 'X-RAY VIEW ON' : 'X-RAY VIEW OFF', 1.2);
}

// Orbit the camera around the (frozen) player while paused. Player stays centred.
function updatePauseOrbitCamera() {
  if (!S.playerCube) return;
  const t = S.playerCube.position;
  camera.position.set(
    t.x + Math.sin(S.pauseYaw) * Math.cos(S.pausePitch) * S.pauseZoom,
    t.y + Math.sin(S.pausePitch) * S.pauseZoom,
    t.z + Math.cos(S.pauseYaw) * Math.cos(S.pausePitch) * S.pauseZoom
  );
  camera.lookAt(t);
}

function togglePause() {
  if (S.isEditMode && !S.isPlaytesting) return; // pause only applies to play / playtest
  S.isPaused = !S.isPaused;
  audio.playPauseToggle(S.isPaused);
  const ov = document.getElementById('pause-overlay');
  if (S.isPaused) {
    // Seed the orbit from the current camera so there's no jump on pause.
    if (S.playerCube) {
      const rel = camera.position.clone().sub(S.playerCube.position);
      S.pauseZoom = Math.max(3, rel.length());
      S.pausePitch = Math.asin(THREE.MathUtils.clamp(rel.y / S.pauseZoom, -1, 1));
      S.pauseYaw = Math.atan2(rel.x, rel.z);
    }
    S.pausePointers.clear(); S.pausePinchDist = null;
    ov && ov.classList.add('show');
  } else {
    ov && ov.classList.remove('show');
  }
}

function loadDemoLevel() {
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
async function loadLevelManifest() {
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

function loadPreMadeLevel(idx) {
  S.isCustomLevel = false;
  S.playerLives = MAX_LIVES;
  if (!S.premadeLevels.length) return; // manifest not ready (or no level files)
  const n = S.premadeLevels.length;
  const i = ((idx % n) + n) % n;
  const lvl3D = deserializeLevel(S.premadeLevels[i]);
  buildLevel3D(lvl3D);
}

/* ═══════════════════════════════════════════════════════════
   INPUT CONTROLS
   ═══════════════════════════════════════════════════════════ */
function handleMove(dirX, dirZ) {
  if (S.isLevelComplete || S.isEditMode && !S.isPlaytesting) return;
  // Re-decide mid-step: pressing the direction opposite to the current roll
  // aborts it and rolls back to the origin cell.
  if (S.isRolling && canReverseRoll() && dirX === -S.lastMoveDir.x && dirZ === -S.lastMoveDir.z) {
    reverseCurrentRoll();
    return;
  }
  startRoll(dirX, dirZ);
}

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  audio.init();
  S.keysPressed[e.code] = true;

  // Never hijack keys while typing in inputs (level name, import JSON, …)
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) return;

  // Help overlay toggles with H from anywhere; while open it swallows other keys.
  if (e.code === 'KeyH') { setHelpOpen(!S.isHelpOpen); return; }
  if (S.isHelpOpen) { if (e.code === 'Escape') setHelpOpen(false); return; }

  // X-ray view toggle via KeyT removed at user request to restrict transparency effects to middle click.

  // Pause + free-orbit camera toggle (play / playtest only).
  if (e.code === 'KeyP') { e.preventDefault(); togglePause(); return; }
  // While paused, swallow every other key so the frozen game can't be driven.
  if (S.isPaused) return;

  // Place block in front of player at same level (E) or one level up (Q)
  if (e.code === 'KeyE' || e.code === 'KeyQ') {
    if (!S.isEditMode || S.isPlaytesting) {
      e.preventDefault();
      tryPlaceBlock(e.code === 'KeyQ');
    }
    return;
  }

  if (S.isBalancing) {
    let rollBack = false;
    if (S.lastMoveDir.x === 1 && (e.code === 'ArrowLeft' || e.code === 'KeyA')) rollBack = true;
    if (S.lastMoveDir.x === -1 && (e.code === 'ArrowRight' || e.code === 'KeyD')) rollBack = true;
    if (S.lastMoveDir.z === 1 && (e.code === 'ArrowUp' || e.code === 'KeyW')) rollBack = true;
    if (S.lastMoveDir.z === -1 && (e.code === 'ArrowDown' || e.code === 'KeyS')) rollBack = true;
    if (rollBack) {
      executeRollBack();
      return;
    }
  }

  if (S.isEditMode && !S.isPlaytesting) {
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); editorUndo(); return; }
    if (e.code === 'KeyU') { e.preventDefault(); editorUndo(); return; }
    // Tool hotkeys: 1-9 and 0 pick the first ten tools, X = eraser, L = linker
    const digit = e.code.match(/^Digit(\d)$/);
    if (digit) {
      const idx = (parseInt(digit[1], 10) + 9) % 10;
      if (toolButtons[idx]) selectToolByName(toolButtons[idx].dataset.tool);
      return;
    }
    if (e.code === 'KeyX') { selectToolByName('eraser'); return; }
    if (e.code === 'KeyL') { selectToolByName('linker'); return; }
    if (e.code === 'KeyO') {
      if (e.repeat) return; // ignore key-repeat while O is held down
      // Start a new compound object: every block placed while O is held shares
      // this id. Pick max existing group + 1 so it stays unique after load.
      let maxG = 0;
      S.activeLevel.blocks.forEach(b => {
        if (b.properties && typeof b.properties.group === 'number' && b.properties.group > maxG) maxG = b.properties.group;
      });
      S.currentGroupId = maxG + 1;
      audio.init();
      audio.playGroupStart();
      setGroupingUI(true);
      refreshGroupingIndicator();
      drawEditorWires(); // highlight current-group members (orange boxes)
      return;
    }
    if (e.code === 'Escape') {
      if (S.linkerSourceKey) {
        S.linkerSourceKey = null;
        showMessage('LINK CANCELLED', 1);
        audio.playLinkCancel();
      }
      return;
    }
    // Camera pan (WASD/arrows) and rotate (Q/E) are applied continuously in the
    // render loop from S.keysPressed, so holding a key keeps moving smoothly.
    if (e.code === 'KeyR') { e.preventDefault(); adjustEditHeight(1); }
    if (e.code === 'KeyF') { e.preventDefault(); adjustEditHeight(-1); }
    return;
  }

  // Normal gameplay keys
  // Arm held-key auto-repeat for the pressed direction (loop repeats every 300ms).
  const moveMap = { ArrowUp:[0,-1], KeyW:[0,-1], ArrowDown:[0,1], KeyS:[0,1], ArrowLeft:[-1,0], KeyA:[-1,0], ArrowRight:[1,0], KeyD:[1,0] };
  if (moveMap[e.code]) { S.repeatMoveCode = e.code; S.repeatMoveDir = { x: moveMap[e.code][0], z: moveMap[e.code][1] }; S.moveRepeatTimer = 0; }
  switch (e.code) {
    case 'ArrowUp': case 'KeyW': e.preventDefault(); handleMove(0, -1); break;
    case 'ArrowDown': case 'KeyS': e.preventDefault(); handleMove(0, 1); break;
    case 'ArrowLeft': case 'KeyA': e.preventDefault(); handleMove(-1, 0); break;
    case 'ArrowRight': case 'KeyD': e.preventDefault(); handleMove(1, 0); break;
    case 'KeyR': e.preventDefault(); respawnPlayer(); break;
    case 'Space': e.preventDefault();
      if (S.isLevelComplete) {
        advanceCompletedLevel();
      }
      break;
  }
});

window.addEventListener('keyup', (e) => {
  S.keysPressed[e.code] = false;
  if (e.code === 'KeyV' && S.isDrawingPlane) {
    commitPlaneDraw();
  }
  if (e.code === 'KeyO' && S.currentGroupId !== null) {
    const n = groupMemberCount(S.currentGroupId);
    S.currentGroupId = null;
    setGroupingUI(false);
    audio.playGroupEnd();
    if (n > 0) showMessage(`OBJECT GROUPED — ${n} BLOCK${n === 1 ? '' : 'S'}`, 1.5);
    drawEditorWires();
  }
});

// Mobile Controls
document.querySelectorAll('.ctrl-btn').forEach(btn => {
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault(); audio.init();
    const d = btn.dataset.dir;
    if (d==='up') handleMove(0,-1); else if (d==='down') handleMove(0,1);
    else if (d==='left') handleMove(-1,0); else if (d==='right') handleMove(1,0);
  });
});

/* ═══════════════════════════════════════════════════════════
   MOUSE DRAGGING & RAYCAST IN EDITOR
   ═══════════════════════════════════════════════════════════ */
renderer.domElement.addEventListener('mousedown', (e) => {
  if (!S.isEditMode || S.isPlaytesting) return;
  if (e.button === 0) {
    if (S.keysPressed['KeyV'] && (BLOCK_TOOLS.includes(S.selectedTool) || S.selectedTool === 'eraser')) {
      const hit = editorRaycast(e);
      if (hit) {
        S.planeStartPos = { x: hit.x, y: S.editY, z: hit.z };
        S.planeEndPos = { x: hit.x, y: S.editY, z: hit.z };
        S.isDrawingPlane = true;
      }
      return;
    }

    // Snapshot once per click / paint-stroke (skip pure linker source-select).
    if (!(S.selectedTool === 'linker' && S.linkerSourceKey === null)) pushUndoSnapshot();
    // Left click edit block
    if (S.selectedTool !== 'linker' && !S.keysPressed['KeyV']) {
      S.isPainting = true;
    }
    handleEditorClick(e);
  } else {
    // Right click rotate camera / erase
    S.isDraggingCamera = true;
    S.rightDragMoved = false;
    S.dragStartMouse = { x: e.clientX, y: e.clientY };
  }
});

renderer.domElement.addEventListener('mousemove', (e) => {
  if (!S.isEditMode || S.isPlaytesting) return;

  if (S.isDraggingCamera) {
    const dx = e.clientX - S.dragStartMouse.x;
    const dy = e.clientY - S.dragStartMouse.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) S.rightDragMoved = true;
    S.editorCameraYaw -= dx * 0.005;
    S.editorCameraPitch = Math.max(0.1, Math.min(Math.PI/2 - 0.1, S.editorCameraPitch + dy * 0.005));
    S.dragStartMouse = { x: e.clientX, y: e.clientY };
  } else {
    // Update Ghost Block Position
    const hit = editorRaycast(e);
    const tooltip = document.getElementById('editor-tooltip');
    
    if (S.isDrawingPlane) {
      if (S.editorGhostBlock) S.editorGhostBlock.visible = false;
      if (tooltip) tooltip.style.display = 'none';

      if (hit) {
        S.planeEndPos = { x: hit.x, y: S.editY, z: hit.z };
        const minX = Math.min(S.planeStartPos.x, S.planeEndPos.x);
        const maxX = Math.max(S.planeStartPos.x, S.planeEndPos.x);
        const minZ = Math.min(S.planeStartPos.z, S.planeEndPos.z);
        const maxZ = Math.max(S.planeStartPos.z, S.planeEndPos.z);
        
        const width = (maxX - minX) + 1;
        const length = (maxZ - minZ) + 1;
        const centerX = (minX + maxX) / 2;
        const centerZ = (minZ + maxZ) / 2;
        
        if (S.editorPlanePreview) {
          S.editorPlanePreview.position.set(centerX, S.editY, centerZ);
          S.editorPlanePreview.scale.set(width, 1.05, length);
          S.editorPlanePreview.material.color.setHex(S.selectedTool === 'eraser' ? 0xff3355 : 0x00ffaa);
          S.editorPlanePreview.visible = true;
        }
      }
    } else {
      if (S.editorPlanePreview) S.editorPlanePreview.visible = false;
      if (hit && S.editorGhostBlock) {
        // Block-placement preview is only shown on the currently selected level.
        let ghostVisible = !(BLOCK_TOOLS.includes(S.selectedTool) && hit.y !== S.editY);
        // Set ghost block color, geometry and position dynamically based on tool
        if (S.selectedTool === 'eraser') {
          S.editorGhostBlock.material.color.setHex(0xff3355);
          S.editorGhostBlock.scale.set(1, 1, 1);
          if (hit.hitType === 'bridge') {
            S.editorGhostBlock.geometry = geoThinTile;
            S.editorGhostBlock.position.set(hit.x, hit.y + 0.4, hit.z);
          } else if (hit.hitType === 'container') {
            S.editorGhostBlock.geometry = geoCube;
            S.editorGhostBlock.scale.set(0.8, 0.8, 0.8);
            S.editorGhostBlock.position.set(hit.x, hit.y, hit.z);
          } else if (hit.hitType === 'plutonium') {
            S.editorGhostBlock.geometry = geoCube;
            S.editorGhostBlock.scale.set(0.4, 0.4, 0.4);
            S.editorGhostBlock.position.set(hit.x, hit.y + 1.0, hit.z);
          } else if (hit.hitType === 'prism' || hit.hitType === 'miniprism') {
            S.editorGhostBlock.geometry = geoPrism;
            if (hit.hitType === 'miniprism') S.editorGhostBlock.scale.set(0.6, 0.6, 0.6);
            S.editorGhostBlock.position.set(hit.x, hit.y + 0.55, hit.z);
          } else if (hit.hitType === 'enemy') {
            S.editorGhostBlock.geometry = geoCube;
            S.editorGhostBlock.position.set(hit.x, hit.y + 1, hit.z);
          } else {
            S.editorGhostBlock.geometry = geoTile;
            S.editorGhostBlock.position.set(hit.x, hit.y, hit.z);
          }
        } else if (S.selectedTool === 'linker') {
          S.editorGhostBlock.material.color.setHex(0xffaa00);
          S.editorGhostBlock.scale.set(1, 1, 1);
          if (hit.hitType === 'bridge') {
            S.editorGhostBlock.geometry = geoThinTile;
            S.editorGhostBlock.position.set(hit.x, hit.y + 0.4, hit.z);
          } else if (hit.hitType === 'container') {
            S.editorGhostBlock.geometry = geoCube;
            S.editorGhostBlock.scale.set(0.8, 0.8, 0.8);
            S.editorGhostBlock.position.set(hit.x, hit.y, hit.z);
          } else if (hit.hitType === 'plutonium') {
            S.editorGhostBlock.geometry = geoCube;
            S.editorGhostBlock.scale.set(0.4, 0.4, 0.4);
            S.editorGhostBlock.position.set(hit.x, hit.y + 1.0, hit.z);
          } else if (hit.hitType === 'prism' || hit.hitType === 'miniprism') {
            S.editorGhostBlock.geometry = geoPrism;
            if (hit.hitType === 'miniprism') S.editorGhostBlock.scale.set(0.6, 0.6, 0.6);
            S.editorGhostBlock.position.set(hit.x, hit.y + 0.55, hit.z);
          } else {
            S.editorGhostBlock.geometry = geoTile;
            S.editorGhostBlock.position.set(hit.x, hit.y, hit.z);
          }
        } else {
          let ghostColor = 0x00ffcc;
          if (S.selectedTool === 'pushable') ghostColor = 0x8b5a2b;
          else if (S.selectedTool === 'pressureplate') ghostColor = 0x3366ff;
          else if (S.selectedTool === 'danger') ghostColor = 0xff3333;
          else if (S.selectedTool === 'shaker') ghostColor = 0x554444;
          else if (S.selectedTool === 'booster') ghostColor = 0xffcc00;
          else if (S.selectedTool === 'container') ghostColor = 0xa21caf;
          else if (S.selectedTool === 'start') ghostColor = 0xff6600;
          else if (S.selectedTool === 'exit') ghostColor = 0x00ffaa;
          else if (S.selectedTool === 'enemy') ghostColor = 0xff0066;
          else if (S.selectedTool === 'plutonium') ghostColor = 0xd946ef;
          // While grouping (O held), tint the placement preview orange to signal
          // that the next block will join the current compound object.
          if (S.currentGroupId !== null && BLOCK_TOOLS.includes(S.selectedTool)) ghostColor = 0xffbb33;

          S.editorGhostBlock.material.color.setHex(ghostColor);
          S.editorGhostBlock.scale.set(1, 1, 1);
          let targetY = hit.y;
          if (S.selectedTool === 'bridge') {
            S.editorGhostBlock.geometry = geoThinTile;
            targetY = hit.y + 0.4;
          } else if (S.selectedTool === 'container') {
            S.editorGhostBlock.geometry = geoCube;
            S.editorGhostBlock.scale.set(0.8, 0.8, 0.8);
            targetY = hit.y;
          } else if (S.selectedTool === 'plutonium') {
            S.editorGhostBlock.geometry = geoCube;
            S.editorGhostBlock.scale.set(0.4, 0.4, 0.4);
            targetY = hit.y + 1.0;
          } else if (S.selectedTool === 'prism' || S.selectedTool === 'miniprism') {
            S.editorGhostBlock.geometry = geoPrism;
            if (S.selectedTool === 'miniprism') S.editorGhostBlock.scale.set(0.6, 0.6, 0.6);
            targetY = hit.y + 0.55;
          } else if (S.selectedTool === 'start' || S.selectedTool === 'exit' || S.selectedTool === 'enemy') {
            // Marker preview floats where the player cube / exit ring appears
            S.editorGhostBlock.geometry = geoCube;
            targetY = hit.y + 1;
          } else {
            S.editorGhostBlock.geometry = geoTile;
          }
          S.editorGhostBlock.position.set(hit.x, targetY, hit.z);
        }
        S.editorGhostBlock.visible = ghostVisible;

        // Update Tooltip
        if (tooltip && ghostVisible) {
          let text = `${S.selectedTool.toUpperCase()}`;
          text += ` <span class="tooltip-coord">(${hit.x}, ${hit.y}, ${hit.z})</span>`;
          if (hit.hitKey && BLOCK_TOOLS.includes(S.selectedTool)) {
            text += ` <span class="tooltip-stacking">Stacking</span>`;
          }
          tooltip.innerHTML = text;
          tooltip.style.left = (e.clientX + 15) + 'px';
          tooltip.style.top = (e.clientY + 15) + 'px';
          tooltip.style.display = 'block';
        } else if (tooltip) {
          tooltip.style.display = 'none';
        }
      } else if (S.editorGhostBlock) {
        S.editorGhostBlock.visible = false;
        if (tooltip) tooltip.style.display = 'none';
      }

      if (S.isPainting) {
        handleEditorDragClick(e);
      }
    }
  }
});

window.addEventListener('mouseup', (e) => {
  S.isDraggingCamera = false;
  if (e.button === 0) {
    S.isPainting = false;
    if (S.isDrawingPlane) {
      commitPlaneDraw();
    }
  }
});

renderer.domElement.addEventListener('contextmenu', (e) => {
  if (!S.isEditMode) return;
  e.preventDefault();
  // Erase voxel on right-click TAP only — not after rotating the camera
  if (S.isPlaytesting || S.rightDragMoved) return;
  const hit = editorRaycast(e);
  if (hit && hit.hitKey) {
    if (editorEraseKey(hit.hitKey)) audio.playBreak();
  }
});

window.addEventListener('wheel', (e) => {
  if (!S.isEditMode || S.isPlaytesting) return;
  if (e.shiftKey) {
    // Adjust edit height
    adjustEditHeight(e.deltaY < 0 ? 1 : -1);
  } else {
    // Zoom camera
    S.editorCameraZoom = Math.max(5, Math.min(45, S.editorCameraZoom + (e.deltaY * 0.01)));
  }
});

/* ═══ GAMEPLAY MOUSE: middle-click X-ray · left-drag camera peek ═══
   Active during play and playtest (not pure editing, not while paused — the
   editor and the pause orbit own the mouse in those modes). */
function isGameplayMouseMode() {
  return (!S.isEditMode || S.isPlaytesting) && !S.isPaused;
}
renderer.domElement.addEventListener('mousedown', (e) => {
  if (!isGameplayMouseMode()) return;
  if (e.button === 1) {
    // Middle click → toggle full see-through (all blocks transparent).
    e.preventDefault();
    audio.init();
    toggleXray();
  } else if (e.button === 0) {
    // Left button → start a camera peek; released → it swings back (render loop).
    S.peekActive = true;
    S.peekLast = { x: e.clientX, y: e.clientY };
  }
});
window.addEventListener('mousemove', (e) => {
  if (!S.peekActive) return;
  const dx = e.clientX - S.peekLast.x;
  const dy = e.clientY - S.peekLast.y;
  S.peekLast = { x: e.clientX, y: e.clientY };
  S.peekYaw = THREE.MathUtils.clamp(S.peekYaw - dx * 0.005, -0.6, 0.6);
  S.peekPitch = THREE.MathUtils.clamp(S.peekPitch + dy * 0.004, -0.30, 0.45);
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) S.peekActive = false; // release → ease back to default angle
});
// Suppress the middle-click autoscroll puck during play.
renderer.domElement.addEventListener('auxclick', (e) => {
  if (e.button === 1 && isGameplayMouseMode()) e.preventDefault();
});

/* ═══ PAUSE FREE-ORBIT INPUT (mouse + touch): drag to rotate, wheel/pinch to zoom ═══ */
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!S.isPaused) return;
  S.pausePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!S.isPaused || !S.pausePointers.has(e.pointerId)) return;
  const prev = S.pausePointers.get(e.pointerId);
  S.pausePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (S.pausePointers.size >= 2) {
    // Two-finger pinch → zoom
    const pts = [...S.pausePointers.values()];
    const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    if (S.pausePinchDist != null && d > 0) S.pauseZoom = Math.max(3, Math.min(45, S.pauseZoom * (S.pausePinchDist / d)));
    S.pausePinchDist = d;
  } else {
    // Single pointer → orbit (full 360° yaw, clamped pitch)
    S.pauseYaw -= (e.clientX - prev.x) * 0.008;
    S.pausePitch = Math.max(0.05, Math.min(1.5, S.pausePitch + (e.clientY - prev.y) * 0.008));
  }
});
window.addEventListener('pointerup', (e) => {
  S.pausePointers.delete(e.pointerId);
  if (S.pausePointers.size < 2) S.pausePinchDist = null;
});
window.addEventListener('pointercancel', (e) => {
  S.pausePointers.delete(e.pointerId);
  if (S.pausePointers.size < 2) S.pausePinchDist = null;
});
window.addEventListener('wheel', (e) => {
  if (!S.isPaused) return;
  e.preventDefault();
  S.pauseZoom = Math.max(3, Math.min(45, S.pauseZoom * (e.deltaY > 0 ? 1.08 : 0.92)));
}, { passive: false });

/* ═══════════════════════════════════════════════════════════
   LEVEL EDITOR BUTTON EVENTS
   ═══════════════════════════════════════════════════════════ */
document.getElementById('btn-play-load').addEventListener('click', () => {
  audio.init();
  audio.playClick();
  updateLibraryList();
  document.getElementById('editor-library-panel').style.display = 'flex';
});

document.getElementById('btn-editor-toggle').addEventListener('click', () => {
  audio.init();
  audio.playClick();
  if (S.isEditMode) exitEditMode(); else enterEditMode();
});

// Toolbox items select
const toolButtons = Array.from(document.querySelectorAll('.tool-btn'));
toolButtons.forEach((btn, i) => {
  if (i < 10) btn.title += ` [${(i + 1) % 10}]`;
  btn.addEventListener('click', () => selectToolByName(btn.dataset.tool));
});

document.getElementById('btn-height-down').addEventListener('click', () => adjustEditHeight(-1));
document.getElementById('btn-height-up').addEventListener('click', () => adjustEditHeight(1));
document.getElementById('ruler-up').addEventListener('click', () => adjustEditHeight(1));
document.getElementById('ruler-down').addEventListener('click', () => adjustEditHeight(-1));

document.getElementById('btn-toggle-slice').addEventListener('click', () => {
  audio.init();
  S.sliceModeActive = !S.sliceModeActive;
  audio.playSwitch();
  document.getElementById('btn-toggle-slice').textContent = S.sliceModeActive ? 'Slice: ON' : 'Slice: OFF';
  document.getElementById('btn-toggle-slice').className = `editor-btn ${S.sliceModeActive ? 'success' : 'danger'}`;
  updateEditorSlicing();
});

document.getElementById('btn-playtest').addEventListener('click', enterPlaytestMode);
document.getElementById('btn-editor-exit').addEventListener('click', exitEditMode);
document.getElementById('btn-undo').addEventListener('click', () => { audio.init(); editorUndo(); });

document.getElementById('btn-demo-level').addEventListener('click', () => {
  audio.init();
  if (confirm("Load the '★ Element Showcase' demo level? This will overwrite your current design.")) {
    pushUndoSnapshot();
    loadDemoLevel();
    adjustEditHeight(-S.editY); // reset editing height to 0
  }
});

// AI generator dropdown — show the difficulty picker only for AI Pro, and run
// the chosen generator (the four hidden buttons still hold the actual logic).
{
  const genSelect = document.getElementById('ai-generator-select');
  const diffSelect = document.getElementById('architect-difficulty');
  const syncDiff = () => { diffSelect.style.display = (genSelect.value === 'aipro') ? '' : 'none'; };
  genSelect.addEventListener('change', syncDiff);
  syncDiff();
  document.getElementById('btn-ai-run').addEventListener('click', () => {
    audio.playClick();
    const map = { aigen: 'btn-ai-generate', aipro: 'btn-ai-architect', aipro2: 'btn-ai-architect2', aipro3: 'btn-ai-architect3' };
    const id = map[genSelect.value];
    if (id) document.getElementById(id).click();
  });
}

document.getElementById('btn-ai-generate').addEventListener('click', () => {
  audio.init();
  if (confirm("Generate a complex 3D AI Labyrinth? This will overwrite your current design.")) {
    pushUndoSnapshot();
    const lvl = generateAILabyrinth();
    S.activeLevel = lvl;
    document.getElementById('level-name-input').value = lvl.name;
    document.getElementById('world-select').value = lvl.world;
    adjustEditHeight(-S.editY); // Reset edit height to 0
    buildLevel3D(lvl);
    drawEditorWires();
    showMessage('AI LABYRINTH GENERATED');
    audio.playAIGenerate();
  }
});

document.getElementById('btn-ai-architect').addEventListener('click', () => {
  audio.init();
  const difficulty = parseInt(document.getElementById('architect-difficulty').value, 10) || 5;
  if (confirm(`Generate a difficulty-${difficulty} Architect level? This will overwrite your current design.`)) {
    pushUndoSnapshot();
    const lvl = generateArchitectLevel(difficulty);
    S.activeLevel = lvl;
    document.getElementById('level-name-input').value = lvl.name;
    document.getElementById('world-select').value = lvl.world;
    adjustEditHeight(-S.editY); // Reset edit height to 0
    buildLevel3D(lvl);
    drawEditorWires();
    showMessage(`ARCHITECT LEVEL — DIFFICULTY ${difficulty}`);
    audio.playAIGenerate();
  }
});

// AI Pro2 — open the criteria modal, then generate from the chosen toggles.
document.getElementById('btn-ai-architect2').addEventListener('click', () => {
  audio.init();
  document.getElementById('ai-pro2-modal').style.display = 'flex';
});
document.getElementById('btn-ai-pro2-close').addEventListener('click', () => {
  document.getElementById('ai-pro2-modal').style.display = 'none';
});
{
  const ai2Size = document.getElementById('ai2-size');
  ai2Size.addEventListener('input', () => {
    document.getElementById('ai2-size-val').textContent = ai2Size.value;
  });
}
document.getElementById('btn-ai-pro2-generate').addEventListener('click', () => {
  audio.init();
  const cb = id => document.getElementById(id).checked;
  const opts = {
    size: parseInt(document.getElementById('ai2-size').value, 10) || 5,
    verticality: cb('ai2-verticality'),
    branching:   cb('ai2-branching'),
    teleporters: cb('ai2-teleporters'),
    switchGates: cb('ai2-switchGates'),
    movers:      cb('ai2-movers'),
    crates:      cb('ai2-crates'),
    collapse:    cb('ai2-collapse'),
    ice:         cb('ai2-ice'),
    danger:      cb('ai2-danger'),
    enemies:     cb('ai2-enemies'),
  };
  pushUndoSnapshot();
  const lvl = generateArchitectLevel2(opts);
  S.activeLevel = lvl;
  document.getElementById('level-name-input').value = lvl.name;
  document.getElementById('world-select').value = lvl.world;
  adjustEditHeight(-S.editY); // reset edit height to 0
  buildLevel3D(lvl);
  drawEditorWires();
  document.getElementById('ai-pro2-modal').style.display = 'none';
  showMessage(`AI PRO2 — ${lvl.name}`);
  audio.playAIGenerate();
});

// AI Pro3 — criteria + per-criterion quantities, then generate.
document.getElementById('btn-ai-architect3').addEventListener('click', () => {
  audio.init();
  document.getElementById('ai-pro3-modal').style.display = 'flex';
});
document.getElementById('btn-ai-pro3-close').addEventListener('click', () => {
  document.getElementById('ai-pro3-modal').style.display = 'none';
});
{
  const ai3Size = document.getElementById('ai3-size');
  ai3Size.addEventListener('input', () => {
    document.getElementById('ai3-size-val').textContent = ai3Size.value;
  });
  // Dim a row's quantity field while its criterion is unchecked.
  document.querySelectorAll('#ai-pro3-modal .ai3-option input[type=checkbox]').forEach(cb => {
    const qty = cb.parentElement.querySelector('.ai3-qty');
    if (!qty) return;
    const sync = () => { qty.disabled = !cb.checked; };
    cb.addEventListener('change', sync);
    sync();
  });
}
document.getElementById('btn-ai-pro3-generate').addEventListener('click', () => {
  audio.init();
  const cb  = id => document.getElementById(id).checked;
  const num = id => parseInt(document.getElementById(id).value, 10);
  // qty(name) → the quantity when the criterion is on, else false (off).
  const qty = name => cb(`ai3-${name}`) ? num(`ai3-${name}-n`) : false;
  // knob(name) → the custom value when enabled, else null (auto).
  const knob = name => cb(`ai3-${name}`) ? num(`ai3-${name}-n`) : null;
  const opts = {
    size: num('ai3-size') || 5,
    // Element families — boolean toggle plus an explicit quantity.
    verticality: cb('ai3-verticality'), floors:        num('ai3-verticality-n'),
    branching:   cb('ai3-branching'),   branches:      num('ai3-branching-n'),
    collapse:    cb('ai3-collapse'),    collapseTiles: num('ai3-collapse-n'),
    ice:         cb('ai3-ice'),         iceTiles:      num('ai3-ice-n'),
    danger:      cb('ai3-danger'),      dangerTiles:   num('ai3-danger-n'),
    // Families whose option value IS the count (number when on, false when off).
    teleporters:  qty('teleporters'),
    switchGates:  qty('switchGates'),
    movers:       qty('movers'),
    crates:       qty('crates'),
    enemies:      qty('enemies'),
    boosters:     qty('boosters'),
    prisms:       qty('prisms'),
    miniprisms:   qty('miniprisms'),
    secretRooms:  qty('secretRooms'),
    iceCorridors: qty('iceCorridors'),
    plutonium:    qty('plutonium'),
    // Tuning knobs — custom value when checked, otherwise auto from size.
    pathLength:   knob('pathLength'),
    arenaSize:    knob('arenaSize'),
    parTightness: knob('parTightness'),
    branchLen:    knob('branchLen'),
    moverSpeed:   knob('moverSpeed'),
    plutoniumTime: cb('ai3-plutoniumTime') ? num('ai3-plutoniumTime-n') : 30,
    buildLimit:   cb('ai3-buildLimit') ? num('ai3-buildLimit-n') : 10,
  };

  pushUndoSnapshot();
  const lvl = generateArchitectLevel3(opts);
  S.activeLevel = lvl;
  document.getElementById('level-name-input').value = lvl.name;
  document.getElementById('world-select').value = lvl.world;
  if (document.getElementById('level-build-limit-input')) {
    document.getElementById('level-build-limit-input').value = lvl.buildBlocksLimit ?? 10;
  }
  adjustEditHeight(-S.editY); // reset edit height to 0
  buildLevel3D(lvl);
  drawEditorWires();
  document.getElementById('ai-pro3-modal').style.display = 'none';
  showMessage(`AI PRO3 — ${lvl.name}`);
  audio.playAIGenerate();
});

document.getElementById('btn-clear-grid').addEventListener('click', () => {
  if (confirm("Clear all blocks in this level?")) {
    pushUndoSnapshot();
    S.activeLevel.blocks.clear();
    S.activeLevel.prisms.clear();
    S.activeLevel.links = [];
    lvlInsertDefaultBlocks(S.activeLevel);
    buildLevel3D(S.activeLevel);
    drawEditorWires();
    audio.playClear();
  }
});

document.getElementById('btn-save-local').addEventListener('click', () => {
  audio.playClick();
  const name = document.getElementById('level-name-input').value.trim();
  if (!name) return alert("Please specify level name.");
  S.activeLevel.name = name;
  S.activeLevel.world = parseInt(document.getElementById('world-select').value);
  if (document.getElementById('level-build-limit-input')) {
    S.activeLevel.buildBlocksLimit = parseInt(document.getElementById('level-build-limit-input').value, 10) || 10;
  }

  let store = {};
  try { store = JSON.parse(localStorage.getItem('goose_levels') || '{}'); } catch(e){}
  store[name] = serializeLevel(S.activeLevel);
  localStorage.setItem('goose_levels', JSON.stringify(store));
  showMessage('LEVEL SAVED SUCCESSFULLY');
});

document.getElementById('btn-load-local').addEventListener('click', () => {
  audio.playClick();
  updateLibraryList();
  document.getElementById('editor-library-panel').style.display = 'flex';
});
document.getElementById('btn-library-upload').addEventListener('click', () => {
  audio.playClick();
  document.getElementById('import-file-input').click();
});
document.getElementById('btn-close-library').addEventListener('click', () => {
  audio.playClick();
  document.getElementById('editor-library-panel').style.display = 'none';
});

// Export Level
document.getElementById('btn-export-level').addEventListener('click', () => {
  audio.playClick();
  // Persist the name/theme the user typed into the form so the exported JSON
  // (and the download filename) carry the current level name, not a stale one.
  const typedName = document.getElementById('level-name-input').value.trim();
  if (typedName) S.activeLevel.name = typedName;
  S.activeLevel.world = parseInt(document.getElementById('world-select').value, 10) || 0;
  if (document.getElementById('level-build-limit-input')) {
    S.activeLevel.buildBlocksLimit = parseInt(document.getElementById('level-build-limit-input').value, 10) || 10;
  }
  const data = serializeLevel(S.activeLevel);
  document.getElementById('modal-title').textContent = 'EXPORT LEVEL';
  document.getElementById('modal-textarea').value = data;
  document.getElementById('modal-textarea').readOnly = true;
  document.getElementById('btn-modal-load').style.display = 'none';
  document.getElementById('btn-modal-copy').style.display = 'block';
  document.getElementById('btn-modal-download').style.display = 'block';
  document.getElementById('btn-modal-upload').style.display = 'none';
  document.getElementById('export-import-modal').style.display = 'flex';
});

// Import Level
document.getElementById('btn-import-level').addEventListener('click', () => {
  audio.playClick();
  document.getElementById('modal-title').textContent = 'IMPORT LEVEL';
  document.getElementById('modal-textarea').value = '';
  document.getElementById('modal-textarea').readOnly = false;
  document.getElementById('btn-modal-load').style.display = 'block';
  document.getElementById('btn-modal-copy').style.display = 'none';
  document.getElementById('btn-modal-download').style.display = 'none';
  document.getElementById('btn-modal-upload').style.display = 'block';
  document.getElementById('export-import-modal').style.display = 'flex';
});

document.getElementById('btn-modal-close').addEventListener('click', () => {
  audio.playClick();
  document.getElementById('export-import-modal').style.display = 'none';
});
document.getElementById('btn-modal-copy').addEventListener('click', () => {
  audio.playClick();
  const area = document.getElementById('modal-textarea');
  area.select(); document.execCommand('copy');
  showMessage('Copied to clipboard');
});
document.getElementById('btn-modal-download').addEventListener('click', () => {
  audio.playClick();
  const data = document.getElementById('modal-textarea').value;
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${S.activeLevel.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showMessage('File downloaded');
});
document.getElementById('btn-modal-upload').addEventListener('click', () => {
  audio.playClick();
  document.getElementById('import-file-input').click();
});
document.getElementById('import-file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      S.isCustomLevel = true;
      const lvl = deserializeLevel(evt.target.result);
      S.activeLevel = lvl;
      document.getElementById('level-name-input').value = lvl.name;
      document.getElementById('world-select').value = lvl.world;
      buildLevel3D(lvl);
      drawEditorWires();
      document.getElementById('export-import-modal').style.display = 'none';
      document.getElementById('editor-library-panel').style.display = 'none';
      showMessage('LEVEL IMPORTED SUCCESSFULLY');
    } catch(err) {
      alert("Invalid level JSON file.");
    }
  };
  reader.readAsText(file);
});
document.getElementById('btn-modal-load').addEventListener('click', () => {
  try {
    const jsonStr = document.getElementById('modal-textarea').value;
    const lvl = deserializeLevel(jsonStr);
    if (S.isEditMode && !S.isPlaytesting) pushUndoSnapshot();
    S.activeLevel = lvl;
    document.getElementById('level-name-input').value = lvl.name;
    document.getElementById('world-select').value = lvl.world;
    buildLevel3D(lvl);
    drawEditorWires();
    document.getElementById('export-import-modal').style.display = 'none';
    showMessage('LEVEL IMPORTED SUCCESSFULLY');
  } catch(e) {
    alert("Invalid level data JSON code.");
  }
});

document.getElementById('complete-overlay').addEventListener('click', () => {
  if (S.isLevelComplete) {
    advanceCompletedLevel();
  }
});


// Window resizing
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ═══════════════════════════════════════════════════════════
   HELP OVERLAY + STARTUP SPLASH
   ═══════════════════════════════════════════════════════════ */
const HELP_ELEMENTS = [
  { name:'Normal',         swatch:'background:#2a2a38;border:1px solid #555577;', desc:'Solid ground — roll across freely.' },
  { name:'Fragile',        swatch:'background:#442222;border:1px solid #883333;', desc:'Cracks and collapses moments after you roll off it. No going back.' },
  { name:'Ice',            swatch:'background:#335566;border:1px solid #6699aa;', desc:'Slippery — you keep sliding the same direction until something stops you.' },
  { name:'Switch',         swatch:'background:#333344;border:1px solid #6677cc;', desc:'Roll onto it to toggle its linked bridges or moving platforms on/off.' },
  { name:'Bridge',         swatch:'background:#334455;border:1px solid #335577;height:10px;margin-top:10px;', desc:'A thin platform that appears or vanishes when its switch is triggered.' },
  { name:'Portal',         swatch:'background:#2a2244;border:1px solid #8855dd;', desc:'Teleports you instantly to its linked portal.' },
  { name:'Moving',         swatch:'background:#445544;border:1px solid #44aa55;', desc:'Travels between two points and carries you rigidly while you stand on it. It can also shove you out of its path.' },
  { name:'Crate',          swatch:'background:#8b5a2b;border:1px solid #ffaa44;', desc:'Push it one cell by rolling into it — if the space behind is clear.' },
  { name:'Pressure Plate', swatch:'background:#2244aa;border:1px solid #3366ff;', desc:'A momentary switch — only active while something rests on it.' },
  { name:'Hazard',         swatch:'background:#221111;border:1px solid #ff3355;', desc:'Deadly. Touching it sends you back to the start.' },
  { name:'Shaker',         swatch:'background:#554444;border:1px solid #887777;', desc:'Trembles and crumbles away right after you step on it.' },
  { name:'Booster',        swatch:'background:#223322;border:1px solid #ffcc00;', desc:'Speed pad — your next few moves are much faster.' },
  { name:'Start',          swatch:'background:#ff6600;border-radius:50%;', desc:'Your spawn position.' },
  { name:'Exit',           swatch:'background:#00ffaa;border-radius:50%;', desc:'The goal ring — reach it (with every prism) to clear the level.' },
  { name:'Prism',          swatch:'background:#ffdd44;clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);', desc:'Collect them all — usually required to finish a level.' },
  { name:'Mini-Prism',     swatch:'background:#00ccff;clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);transform:scale(0.7);', desc:'Shrinks you for a short time — climb walls and squeeze under bridges.' },
  { name:'Plutonium',      swatch:'background:#a21caf;box-shadow:0 0 8px #a21caf;border:1px solid #d946ef;border-radius:4px;transform:scale(0.8);', desc:'Purple-black pulsating small cube. Starts a countdown timer once collected.' },
  { name:'Container',      swatch:'animation: plutoniumBtnPulse 1.5s ease-in-out infinite; border:1px solid #d946ef; border-radius:4px;', desc:'Purple/black pulsating cube (same colors as Plutonium, but larger and slower rotating). Step on it to deposit your Plutonium before the timer runs out.' },
];

(function setupHelp() {
  const elGrid = document.getElementById('help-elements');
  if (elGrid) {
    HELP_ELEMENTS.forEach(e => {
      const card = document.createElement('div');
      card.className = 'help-el';
      card.innerHTML = `<span class="help-el-swatch" style="${e.swatch}"></span>` +
        `<div class="help-el-text"><div class="help-el-name">${e.name}</div><div class="help-el-desc">${e.desc}</div></div>`;
      elGrid.appendChild(card);
    });
  }
  const overlay = document.getElementById('help-overlay');
  document.getElementById('help-close')?.addEventListener('click', () => setHelpOpen(false));
  document.getElementById('help-hint')?.addEventListener('click', () => setHelpOpen(true));
  overlay?.addEventListener('click', (e) => { if (e.target === overlay) setHelpOpen(false); });

  // Fullscreen toggle (bottom-left).
  const fsBtn = document.getElementById('fullscreen-btn');
  const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  const syncFsIcon = () => fsBtn?.classList.toggle('active', isFs());
  fsBtn?.addEventListener('click', () => {
    audio.init(); audio.playClick();
    const p = isFs()
      ? (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)
      : (document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen)?.call(document.documentElement);
    if (p && typeof p.catch === 'function') p.catch(() => {}); // ignore gesture/permission rejections
  });
  document.addEventListener('fullscreenchange', syncFsIcon);
  document.addEventListener('webkitfullscreenchange', syncFsIcon);

  // Title card: show for ~1 second, then fade out.
  const title = document.getElementById('title-splash');
  if (title) {
    setTimeout(() => title.classList.add('hide'), 1000);
    setTimeout(() => { title.style.display = 'none'; }, 1700);
  }

  // Briefly fade the credits splash in, then out.
  const splash = document.getElementById('intro-splash');
  if (splash) {
    requestAnimationFrame(() => splash.classList.add('show'));
    setTimeout(() => splash.classList.remove('show'), 1000);
    setTimeout(() => { splash.style.display = 'none'; }, 1900);
  }
})();

function setHelpOpen(open) {
  S.isHelpOpen = open;
  document.getElementById('help-overlay')?.classList.toggle('open', open);
}

// Global click feedback sound for all UI buttons
document.addEventListener('click', (e) => {
  if (e.target.closest('button') || e.target.closest('select')) {
    if (!e.target.closest('#music-ui')) {
      audio.playClick();
    }
  }
});

function updateBuildUI() {
  const el = document.getElementById('build-counter');
  if (!el) return;
  const limit = S.activeLevel.buildBlocksLimit ?? 10;
  const remaining = Math.max(0, limit - S.placedBlocksCount);
  el.textContent = `${remaining} block${remaining !== 1 ? 's' : ''}`;
  el.style.color = remaining === 0 ? '#ff3355' : '#aaa';
}

function tryPlaceBlock(stepUp) {
  if (S.isRolling || S.isFalling || S.isTeleporting || S.isLevelComplete) return;

  const limit = S.activeLevel.buildBlocksLimit ?? 10;
  if (S.placedBlocksCount >= limit) {
    audio.playLinkCancel();
    showMessage('BLOCK LIMIT REACHED!', 1.2);
    return;
  }

  const dx = S.lastMoveDir.x !== 0 || S.lastMoveDir.z !== 0 ? S.lastMoveDir.x : 0;
  const dz = S.lastMoveDir.x !== 0 || S.lastMoveDir.z !== 0 ? S.lastMoveDir.z : -1;

  const targetX = S.playerGridPos.x + dx;
  const targetY = S.playerGridPos.y + (stepUp ? 1 : 0);
  const targetZ = S.playerGridPos.z + dz;

  const key = `${targetX},${targetY},${targetZ}`;

  if (S.activeBlocks.has(key)) {
    audio.playLinkCancel();
    showMessage('BLOCKED!', 1.0);
    return;
  }

  const block = { x: targetX, y: targetY, z: targetZ, type: 'normal', properties: {}, active: true, broken: false, playerPlaced: true };
  S.activeBlocks.set(key, block);
  createBlockMesh(block, key);

  spawnEntranceParticles(targetX, targetY, targetZ);

  S.placedBlocksCount++;
  updateBuildUI();

  audio.playSwitch();

  const remaining = limit - S.placedBlocksCount;
  showMessage(`BLOCK PLACED! (${remaining} LEFT)`, 1.0);
}

// Duplicate setMeshOpacity and disposeMaterial declarations removed

// START — fetch the level manifest, load level 1, then begin the render loop.
(async () => {
  S.premadeLevels = await loadLevelManifest();
  if (!S.premadeLevels.length) console.warn('No /level/*.json files found — start the game from a web server.');
  loadPreMadeLevel(0);
  requestAnimationFrame(animate);
  console.log(`%c🟧 GOOSE — 3D & Level Editor Ready (${S.premadeLevels.length} levels)`, 'color:#ff6600;font-size:18px;');
})();
