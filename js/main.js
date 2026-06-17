import * as THREE from 'three';
import { WORLDS } from './levels-data.js';
import { S, audio } from './state.js';
import {
  renderer, scene, camera, starfield,
  matCube, geoCube, geoRing,
  worldGroup, tilesGroup, prismsGroup, effectsGroup, bridgeGroup, getPlayerWorldPos
} from './scene.js';
import { MovingPlatform, serializeLevel } from './level.js';
import { spawnEntranceParticles } from './particles.js';
import { updatePrismUI, updatePlutoniumUI, updateMoveUI, updateTimerUI, showMessage, playTypewriterTitle } from './ui.js';
import { findEnemySpawnKey, updateLivesUI } from './enemies.js';
import { createBlockMesh, createPrismMesh, spawnEnemy, createEnemyMarker, disposeMaterial } from './meshes.js';
import { updatePressurePlates } from './gameplay.js';
import { updateEditorSlicing } from './editor.js';
import { updateDynamicTransparency } from './gameloop.js';
import { updateBuildUI } from './bootstrap.js';

// main.js is the game core: clear/build level + a few view/pause helpers. All
// shared state lives on S (state.js); DOM wiring + startup live in bootstrap.js.
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

export function buildLevel3D(level3D) {
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
export function applyXrayOverride() {
  // X-ray transparency removed at user request
}

export function toggleXray() {
  S.xrayMode = !S.xrayMode;
  audio.playXrayToggle(S.xrayMode);
  updateEditorSlicing();        // editor: applies / restores slicing opacity
  updateDynamicTransparency();  // play: apply (or clear) the see-through pass at once
  showMessage(S.xrayMode ? 'X-RAY VIEW ON' : 'X-RAY VIEW OFF', 1.2);
}

// Orbit the camera around the (frozen) player while paused. Player stays centred.
export function updatePauseOrbitCamera() {
  if (!S.playerCube) return;
  const t = S.playerCube.position;
  camera.position.set(
    t.x + Math.sin(S.pauseYaw) * Math.cos(S.pausePitch) * S.pauseZoom,
    t.y + Math.sin(S.pausePitch) * S.pauseZoom,
    t.z + Math.cos(S.pauseYaw) * Math.cos(S.pausePitch) * S.pauseZoom
  );
  camera.lookAt(t);
}

export function togglePause() {
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

