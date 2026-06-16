import * as THREE from 'three';
import { TILE_SIZE, CUBE_S, ROLL_DUR_NORMAL, ROLL_DUR_MINI, CAM_LERP, BALANCE_WINDOW, COMBO_TIMEOUT, MAX_LIVES } from './constants.js';
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

// Re-exported for enemies.js (circular import; resolved at call time, never at module eval).
export { getBlocksInColumn, respawnPlayer, completeLevel };

/* ═══ TRUE CONSTANTS (all mutable state lives on the S object in state.js) ═══ */
const XRAY_OPACITY = 0.3;
const MOVE_REPEAT_MS = 300;
const ENEMY_MOVE_INTERVAL = 0.38;
const rulerMinY = -3, rulerMaxY = 10;
const UNDO_LIMIT = 250;


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

function createBlockMesh(block, key) {
  const { x, y, z, type, active } = block;
  const isInactiveBridge = type === 'bridge' && !active;
  // Inactive bridges are hidden in play, but shown as ghosts in the editor
  // so they can be selected and linked.
  if (isInactiveBridge && (!S.isEditMode || S.isPlaytesting)) return;

  let mat = matTileBase;
  if (type === 'fragile') mat = matTileFragile;
  else if (type === 'ice') mat = matTileIce;
  else if (type === 'switch') mat = matTileSwitch;
  else if (type === 'teleporter') mat = matTileTp;
  else if (type === 'bridge') mat = matBridge;
  else if (type === 'pushable') mat = matCrate;
  else if (type === 'pressureplate') mat = matPressurePlate;
  else if (type === 'danger') mat = matDanger;
  else if (type === 'shaker') mat = matShaker;
  else if (type === 'booster') mat = matBooster;
  else if (type === 'container') mat = matContainer;

  const isExit = (x === S.exitPos.x && y === S.exitPos.y && z === S.exitPos.z);
  if (isExit) mat = matTileExit;

  // Thin bridge visual or cube for container
  const geo = type === 'bridge' ? geoThinTile : (type === 'container' ? geoCube : geoTile);
  const matSide = mat.clone();
  matSide.transparent = false;
  matSide.opacity = 1.0;
  matSide.depthWrite = true;

  const matTop = mat.clone();
  matTop.transparent = false;
  matTop.opacity = 1.0;
  matTop.depthWrite = true;

  const materials = [matSide, matSide, matTop, matSide, matSide, matSide];
  const mesh = new THREE.Mesh(geo, materials);
  mesh.position.set(x, type === 'bridge' ? y + 0.4 : y, z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData = { key, type };

  // Edge outline
  const edgeGeo = new THREE.EdgesGeometry(geo);
  let eColor = '#555577';
  if (isExit) eColor = '#00ffaa';
  else if (type === 'fragile') eColor = '#883333';
  else if (type === 'ice') eColor = '#6699aa';
  else if (type === 'switch') eColor = '#6677cc';
  else if (type === 'teleporter') eColor = '#8855dd';
  else if (type === 'bridge') eColor = '#4488ff';
  else if (type === 'pushable') eColor = '#ffaa44';
  else if (type === 'pressureplate') eColor = '#33aaff';
  else if (type === 'danger') eColor = '#ff3333';
  else if (type === 'shaker') eColor = '#884444';
  else if (type === 'booster') eColor = '#ffdd00';
  else if (type === 'container') eColor = '#a21caf';

  const line = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color:eColor, transparent:false }));
  mesh.add(line);
  if (isInactiveBridge) {
    mesh.traverse(m => {
      if (m.isMesh && m.material) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach(mat => {
          mat.wireframe = true;
          mat.transparent = false;
          mat.opacity = 1.0;
        });
      }
    });
  }
  tilesGroup.add(mesh);
  block.mesh = mesh;

  if (type === 'container') {
    mesh.scale.set(0.8, 0.8, 0.8);
    S.containerMeshes.push(mesh);
  }

  // Switch pillar
  if (type === 'switch') {
    const pillarMat = matSwitchPillar.clone();
    pillarMat.transparent = true;
    pillarMat.opacity = 1.0;
    pillarMat.depthWrite = true;
    const pillar = new THREE.Mesh(geoPillar, pillarMat);
    pillar.position.set(0, 0.5 + 0.17, 0);
    pillar.castShadow = true;
    mesh.add(pillar);
    block.pillar = pillar;
  }

  // Pressure plate button visual
  if (type === 'pressureplate') {
    const plateGeo = new THREE.BoxGeometry(0.8, 0.05, 0.8);
    const plateMat = new THREE.MeshStandardMaterial({ color:'#3366ff', roughness:0.2, metalness:0.3, emissive:'#3366ff', emissiveIntensity:0.5, transparent:true, opacity:1.0, depthWrite:true });
    const plate = new THREE.Mesh(plateGeo, plateMat);
    plate.position.set(0, 0.5 + 0.025, 0);
    plate.castShadow = true;
    mesh.add(plate);
    block.plateMesh = plate;
  }

  // Danger block spikes visual
  if (type === 'danger') {
    for (let i = -1; i <= 1; i += 2) {
      for (let j = -1; j <= 1; j += 2) {
        const spikeGeo = new THREE.ConeGeometry(0.08, 0.28, 4);
        const spikeMat = new THREE.MeshStandardMaterial({ color:'#ff3355', roughness:0.5, metalness:0.1, emissive:'#ff3355', emissiveIntensity:1.0, transparent:true, opacity:1.0, depthWrite:true });
        const spike = new THREE.Mesh(spikeGeo, spikeMat);
        spike.position.set(i*0.25, 0.5 + 0.14, j*0.25);
        spike.castShadow = true;
        mesh.add(spike);
      }
    }
  }

  // Booster arrow visual
  if (type === 'booster') {
    const arrowGeo = new THREE.ConeGeometry(0.25, 0.5, 4);
    const arrowMat = new THREE.MeshStandardMaterial({ color:'#ffcc00', roughness:0.1, metalness:0.1, emissive:'#ffcc00', emissiveIntensity:1.5, transparent:true, opacity:1.0, depthWrite:true });
    const arrow = new THREE.Mesh(arrowGeo, arrowMat);
    arrow.rotation.x = Math.PI/2;
    arrow.position.set(0, 0.5 + 0.05, 0);
    mesh.add(arrow);
  }
}

function createPrismMesh(key, p) {
  const [px, py, pz] = key.split(',').map(Number);
  const isMiniPrism = p.type === 'miniprism';
  const isPlutonium = p.type === 'plutonium';
  let mat = matPrism.clone();
  if (isMiniPrism) mat = matMiniPrism.clone();
  else if (isPlutonium) mat = matPlutonium.clone();

  const mesh = new THREE.Mesh(isPlutonium ? geoCube : geoPrism, mat);
  if (isMiniPrism) mesh.scale.set(0.6, 0.6, 0.6);
  else if (isPlutonium) mesh.scale.set(0.4, 0.4, 0.4);
  mesh.position.set(px, isPlutonium ? py + 1.0 : py + 0.55, pz);
  mesh.castShadow = true;
  mesh.userData = { key, type: p.type, isMiniPrism, isPlutonium, baseY: isPlutonium ? py + 1.0 : py + 0.55 };
  prismsGroup.add(mesh);
  p.mesh = mesh;
}

// A live, player-chasing enemy at the given cell (gameplay / playtest).
function spawnEnemy(key) {
  const [x, y, z] = key.split(',').map(Number);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.22, metalness: 0.05, emissiveIntensity: 0.9 });
  const cube = new THREE.Mesh(geoCube, mat);
  cube.castShadow = true; cube.receiveShadow = true;
  cube.position.copy(getPlayerWorldPos(x, y, z, false));
  worldGroup.add(cube);
  S.enemies.push({
    cube,
    grid: { x, y, z },
    isRolling: false,
    animStartTime: 0,
    animStartPos: new THREE.Vector3(),
    animEndPos: new THREE.Vector3(),
    animStartQuat: new THREE.Quaternion(),
    animDeltaQuat: new THREE.Quaternion(),
    moveTimer: 1.5,                 // brief head start before the chase begins
    hue: Math.random()             // desync the rainbow cycle between S.enemies
  });
}

// A static editor marker so the designer can see/erase placed S.enemies. Kept
// opaque (no transparency render-order surprises) with a bright edge cage so it
// reads clearly as an enemy spawn point.
function createEnemyMarker(key) {
  const [x, y, z] = key.split(',').map(Number);
  const mesh = new THREE.Mesh(geoCube, new THREE.MeshStandardMaterial({
    color: 0xff1a66, emissive: 0xff2288, emissiveIntensity: 0.85, roughness: 0.25, metalness: 0.1
  }));
  mesh.scale.set(0.9, 0.9, 0.9);
  mesh.position.copy(getPlayerWorldPos(x, y, z, false));
  mesh.castShadow = true;
  mesh.userData = { key, type: 'enemy' };
  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(geoCube),
    new THREE.LineBasicMaterial({ color: 0xffffff })
  );
  mesh.add(edge);
  prismsGroup.add(mesh);
  S.enemyMarkers.set(key, mesh);
}

/* ═══════════════════════════════════════════════════════════
   GRID COLUMNS & PHYSICS
   ═══════════════════════════════════════════════════════════ */
function getBlocksInColumn(gx, gz) {
  const list = [];
  S.activeBlocks.forEach((block, key) => {
    // Moving drivers and compound-object passengers have dynamic positions —
    // they are reported from the platform loop below, not their static cell.
    if (block.type === 'moving' || block.isPassenger) return;
    if (block.x === gx && block.z === gz && block.active && !block.broken) {
      list.push(block);
    }
  });
  // Check moving platforms (driver tile + any carried passengers)
  S.movingPlatformsList.forEach(mp => {
    if (mp.isPassenger) return; // carried by another driver
    const mpgx = Math.round(mp.position.x);
    const mpgz = Math.round(mp.position.z);
    if (mpgx === gx && mpgz === gz) {
      list.push({ x: mpgx, y: Math.round(mp.position.y), z: mpgz, type: 'moving', platformInstance: mp });
    }
    for (const m of mp.members) {
      const cx = Math.round(mp.position.x + m.gridOffset.x);
      const cz = Math.round(mp.position.z + m.gridOffset.z);
      if (cx === gx && cz === gz) {
        list.push({ x: cx, y: Math.round(mp.position.y + m.gridOffset.y), z: cz, type: m.block.type, platformInstance: mp });
      }
    }
  });
  return list.sort((a,b) => b.y - a.y);
}

function checkRidingPlatform() {
  if (S.isRolling || S.isFalling || S.isTeleporting) return null;
  // If player stands exactly on a moving platform — its driver tile or any
  // passenger cell of a compound object.
  for (const mp of S.movingPlatformsList) {
    if (mp.isPassenger) continue;
    const mpgx = Math.round(mp.position.x);
    const mpgy = Math.round(mp.position.y);
    const mpgz = Math.round(mp.position.z);
    if (S.playerGridPos.x === mpgx && S.playerGridPos.z === mpgz && S.playerGridPos.y === mpgy) {
      return mp;
    }
    for (const m of mp.members) {
      const cx = Math.round(mp.position.x + m.gridOffset.x);
      const cy = Math.round(mp.position.y + m.gridOffset.y);
      const cz = Math.round(mp.position.z + m.gridOffset.z);
      if (S.playerGridPos.x === cx && S.playerGridPos.z === cz && S.playerGridPos.y === cy) {
        return mp;
      }
    }
  }
  return null;
}

// If a moving block is advancing into the player's cell (same level, player not
// riding it), the block shoves the player along its travel direction.
function checkPushedByPlatform() {
  if (S.isRolling || S.isFalling || S.isTeleporting || S.isBalancing) return null;
  for (const mp of S.movingPlatformsList) {
    if (mp.isPassenger || !mp.active) continue;
    if (mp.moveDir.x === 0 && mp.moveDir.y === 0 && mp.moveDir.z === 0) continue;
    const tc = mp.targetCell;
    if (S.playerGridPos.x === Math.round(tc.x) &&
        S.playerGridPos.y === Math.round(tc.y) &&
        S.playerGridPos.z === Math.round(tc.z)) {
      return mp;
    }
  }
  return null;
}

function enterBalancing() {
  S.isBalancing = true;
  S.balanceTimer = 1.5;
  audio.playBalanceStart();
  showMessage('GOOSE HANGING! HOLD KEY OR ROLL BACK', 1.2);

  // Position at midpoint of the roll
  const midPos = new THREE.Vector3().addVectors(S.animStartPos, S.animEndPos).multiplyScalar(0.5);
  midPos.y += CUBE_S * 0.15; // sit on the edge
  S.playerCube.position.copy(midPos);

  const midQuat = S.animStartQuat.clone();
  midQuat.slerp(new THREE.Quaternion().multiplyQuaternions(S.animDeltaQuat, S.animStartQuat), 0.5);
  S.playerCube.quaternion.copy(midQuat);
}

function executePush(block, toX, toY, toZ, dirX, dirZ) {
  const oldKey = `${block.x},${block.y},${block.z}`;
  
  // Find landing height
  const colBlocks = getBlocksInColumn(toX, toZ);
  const landing = colBlocks.find(b => b.y < toY);
  const finalY = landing ? landing.y + 1 : -10;

  S.activeBlocks.delete(oldKey);
  S.activeLevel.blocks.delete(oldKey);
  const newKey = `${toX},${finalY},${toZ}`;
  
  block.x = toX;
  block.y = finalY;
  block.z = toZ;
  
  if (finalY > -5) {
    S.activeBlocks.set(newKey, block);
    S.activeLevel.blocks.set(newKey, { x: toX, y: finalY, z: toZ, type: 'pushable', properties: block.properties || {} });
  }

  const mesh = block.mesh;
  if (mesh) {
    mesh.userData.key = newKey; // Update mesh key!
    const startPos = mesh.position.clone();
    const endPos = new THREE.Vector3(toX, toY, toZ);
    const finalPos = new THREE.Vector3(toX, finalY, toZ);
    
    const slideDur = 0.15;
    const startTime = performance.now()/1000;
    audio.playCratePush();
    
    const animatePush = () => {
      const elapsed = performance.now()/1000 - startTime;
      const t = Math.min(elapsed / slideDur, 1.0);
      mesh.position.lerpVectors(startPos, endPos, t);
      
      if (t < 1.0) {
        requestAnimationFrame(animatePush);
      } else {
        if (finalY < toY) {
          let velY = 0;
          const fall = () => {
            velY += 14 * 0.016;
            mesh.position.y -= velY * 0.016;
            if (mesh.position.y <= finalY) {
              if (finalY > -5) {
                mesh.position.copy(finalPos);
                audio.playCrateLand();
                spawnLandingParticles(toX, finalY, toZ);
                updatePressurePlates();
              } else {
                audio.playCrateFall();
                tilesGroup.remove(mesh);
                disposeMaterial(mesh.material);
              }
            } else {
              requestAnimationFrame(fall);
            }
          };
          fall();
        } else {
          mesh.position.copy(finalPos);
          updatePressurePlates();
        }
      }
    };
    animatePush();
  }
}

function updatePressurePlates() {
  S.activeBlocks.forEach((block, key) => {
    if (block.type === 'pressureplate') {
      const playerOnIt = (S.playerGridPos.x === block.x && S.playerGridPos.y === block.y && S.playerGridPos.z === block.z && !S.isRolling && !S.isFalling && !S.isTeleporting);
      let blockOnIt = false;
      S.activeBlocks.forEach(b => {
        // A crate resting ON the plate sits one cell above it
        if (b.type === 'pushable' && b.x === block.x && b.y === block.y + 1 && b.z === block.z) {
          blockOnIt = true;
        }
      });

      const shouldBeActive = playerOnIt || blockOnIt;
      const isCurrentlyActive = S.switchStates.get(key) || false;

      if (shouldBeActive !== isCurrentlyActive) {
        S.switchStates.set(key, shouldBeActive);
        if (shouldBeActive) {
          audio.playPlatePress();
        } else {
          audio.playPlateRelease();
        }
        if (block.mesh && block.plateMesh) {
          block.plateMesh.material.emissive.set(shouldBeActive ? '#00ff88' : '#3366ff');
          block.plateMesh.position.y = shouldBeActive ? 0.5 + 0.005 : 0.5 + 0.025;
        }
        triggerSwitchTargets(key, shouldBeActive);
      }
    }
  });
}

function triggerSwitchTargets(key, activeState) {
  const targets = S.switchMap.get(key);
  if (!targets) return;

  if (activeState) {
    audio.playBridgeExtend();
  } else {
    audio.playBridgeRetract();
  }

  targets.forEach(tk => {
    const block = S.activeBlocks.get(tk);
    if (!block) return;
    if (block.type === 'bridge') {
      block.active = activeState;
      if (activeState) {
        if (!block.mesh) {
          createBlockMesh(block, tk);
        }
        block.mesh.scale.y = 0.01;
        const grow = () => {
          if (!block.mesh) return;
          block.mesh.scale.y += (1 - block.mesh.scale.y)*0.25;
          if (block.mesh.scale.y < 0.98) requestAnimationFrame(grow);
          else block.mesh.scale.y = 1;
        };
        grow();
      } else {
        if (block.mesh) {
          const mesh = block.mesh;
          block.mesh = null;
          const shrink = () => {
            mesh.scale.y *= 0.6;
            if (mesh.scale.y > 0.02) requestAnimationFrame(shrink);
            else {
              tilesGroup.remove(mesh);
              disposeMaterial(mesh.material);
            }
          };
          shrink();
        }
      }
    } else if (block.type === 'moving' && block.platformInstance) {
      block.platformInstance.active = activeState;
    }
  });
}

function executeRollBack() {
  S.isBalancing = false;
  audio.playBalanceStop();
  audio.playRoll();

  S.playerGridPos = { ...S.rollStartGridPos };
  S.isRolling = true;
  S.animStartTime = performance.now()/1000;
  S.animStartPos.copy(S.playerCube.position);
  S.animEndPos.copy(getPlayerWorldPos(S.playerGridPos.x, S.playerGridPos.y, S.playerGridPos.z, S.isMini));
  S.animStartQuat.copy(S.playerCube.quaternion);
  
  S.animAxis.negate();
  S.animDeltaQuat.setFromAxisAngle(S.animAxis, Math.PI/4); // 45 degrees back
  S.playerCube.userData.rollAction = 'roll-back';
}

// Whether the in-progress step can be aborted and rolled back to its origin
// cell. Limited to plain ground moves on static terrain so reversing is always
// safe (no half-pushed crates, no broken fragile origin, no platform drift).
function canReverseRoll() {
  if (!S.isRolling || !S.playerCube) return false;
  const action = S.playerCube.userData.rollAction;
  if (action !== 'roll' && action !== 'climb' && action !== 'descend') return false;
  if (S.rollCarrier) return false;                       // platform-relative rolls
  if (S.playerCube.userData.rollPushedCrate) return false;
  const origin = S.activeBlocks.get(`${S.rollStartGridPos.x},${S.rollStartGridPos.y},${S.rollStartGridPos.z}`);
  if (!origin || origin.broken || origin.type === 'fragile') return false; // origin must still hold us
  return true;
}

// Abort the current step and roll the cube back to the cell it left, so the
// player can change their mind while a move is still animating.
function reverseCurrentRoll() {
  const origStartQuat = S.animStartQuat.clone();          // orientation at step start
  const backWorld = getPlayerWorldPos(S.rollStartGridPos.x, S.rollStartGridPos.y, S.rollStartGridPos.z, S.isMini);

  S.animStartTime = performance.now()/1000;
  S.animStartPos.copy(S.playerCube.position);               // from the current mid-roll pose …
  S.animEndPos.copy(backWorld);                           // … back to the origin cell
  const curQuat = S.playerCube.quaternion.clone();
  S.animStartQuat.copy(curQuat);
  // delta * cur === origStart, so the cube settles at its exact pre-step orientation.
  S.animDeltaQuat.copy(origStartQuat).multiply(curQuat.clone().invert());
  S.animFromEdge = false;
  S.rollCarrier = null;

  // Return to the origin cell and roll back the step's bookkeeping.
  S.playerGridPos = { ...S.rollStartGridPos };
  if (S.rollPreState) {
    S.moveCount = S.rollPreState.moveCount;
    S.comboCount = S.rollPreState.comboCount;
    S.comboTimer = S.rollPreState.comboTimer;
    S.lastMoveDir = { ...S.rollPreState.lastMoveDir };
    updateMoveUI(); updateComboUI();
  }
  audio.playRoll();
  S.playerCube.userData.rollAction = 'reverse';
}

function triggerShakerCrumble(block, key) {
  const originalPos = block.mesh.position.clone();
  audio.playShakerShake(); // shaking crack sound
  
  const shakeInterval = setInterval(() => {
    if (!block.mesh || block.broken) {
      clearInterval(shakeInterval);
      return;
    }
    block.mesh.position.set(
      originalPos.x + (Math.random()-0.5)*0.08,
      originalPos.y + (Math.random()-0.5)*0.08,
      originalPos.z + (Math.random()-0.5)*0.08
    );
  }, 30);
  
  setTimeout(() => {
    clearInterval(shakeInterval);
    if (block.mesh && !block.broken) {
      breakFragileBlock(key);
      if (S.playerGridPos.x === block.x && S.playerGridPos.y === block.y && S.playerGridPos.z === block.z) {
        const landing = getBlocksInColumn(block.x, block.z).find(b => b.y < S.playerGridPos.y);
        S.isFalling = true;
        S.fallVelY = 0;
        S.playerCube.userData.fallTargetY = landing ? landing.y : -10;
      }
    }
  }, 600);
}

/* ═══════════════════════════════════════════════════════════
   ROLLING PHYSICS
   ═══════════════════════════════════════════════════════════ */
function isLastMoveKeyHeld() {
  if (S.lastMoveDir.x === 1) return S.keysPressed['ArrowRight'] || S.keysPressed['KeyD'];
  if (S.lastMoveDir.x === -1) return S.keysPressed['ArrowLeft'] || S.keysPressed['KeyA'];
  if (S.lastMoveDir.z === 1) return S.keysPressed['ArrowDown'] || S.keysPressed['KeyS'];
  if (S.lastMoveDir.z === -1) return S.keysPressed['ArrowUp'] || S.keysPressed['KeyW'];
  return false;
}

function startRoll(dirX, dirZ) {
  if (S.isRolling || S.isTeleporting || S.isLevelComplete || S.isFalling || S.isBalancing) return;
  if (!audio.ready) audio.init();

  const toGX = S.playerGridPos.x + dirX;
  const toGZ = S.playerGridPos.z + dirZ;
  const colBlocks = getBlocksInColumn(toGX, toGZ);

  // Crate occupying the cell the player would roll into (resting one above
  // the player's support level, like the player itself does)
  const crate = colBlocks.find(b => b.y === S.playerGridPos.y + 1 && b.type === 'pushable' && !b.broken);
  if (crate) {
    const pushToX = toGX + dirX;
    const pushToZ = toGZ + dirZ;
    const pushCol = getBlocksInColumn(pushToX, pushToZ);
    const pushObstructed = pushCol.some(b => b.y >= crate.y);
    const floorUnderCrate = colBlocks.find(b => b.y === S.playerGridPos.y);
    if (!pushObstructed && floorUnderCrate) {
      executePush(crate, pushToX, crate.y, pushToZ, dirX, dirZ);
      executeRoll(toGX, S.playerGridPos.y, toGZ, dirX, dirZ, 'roll');
      S.playerCube.userData.rollPushedCrate = true; // can't reverse: the crate already moved
      return;
    }
    // Blocked push: the crate acts like a wall/step (handled below)
  }

  // Ceilings directly above player
  const ceilingCurrent = getBlocksInColumn(S.playerGridPos.x, S.playerGridPos.z).find(b => b.y === S.playerGridPos.y + 1);

  // Find blocks at same height, up one, down one
  const sameLevel = colBlocks.find(b => b.y === S.playerGridPos.y);
  const stepUp = colBlocks.find(b => b.y === S.playerGridPos.y + 1);
  const stepDown = colBlocks.find(b => b.y === S.playerGridPos.y - 1);

  let targetY = S.playerGridPos.y;
  let action = 'roll'; // roll, climb, descend, fall, void, blocked

  if (S.isMini && stepUp && stepUp.type !== 'bridge') {
    // Mini-cube vertical wall climb: only when a normal climb is impossible
    // (the wall continues at least two cells high) — climbs the face one
    // cell per move while staying in place.
    const aboveTwo = colBlocks.find(b => b.y === S.playerGridPos.y + 2);
    if (aboveTwo && !ceilingCurrent) {
      action = 'wall-climb';
      targetY = S.playerGridPos.y + 1;
    }
  }

  if (action !== 'wall-climb') {
    if (S.isMini && sameLevel && stepUp && stepUp.type === 'bridge') {
      // Mini cube squeezes under bridges instead of climbing onto them
      targetY = S.playerGridPos.y; action = 'roll';
    } else if (stepUp) {
      const stepUpCeiling = colBlocks.find(b => b.y === S.playerGridPos.y + 2);
      if (!stepUpCeiling && !ceilingCurrent) {
        targetY = S.playerGridPos.y + 1; action = 'climb';
      } else {
        action = 'blocked';
      }
    } else if (sameLevel) {
      const ceilingTarget = colBlocks.find(b => b.y === S.playerGridPos.y + 1);
      if (!ceilingTarget) {
        targetY = S.playerGridPos.y; action = 'roll';
      } else if (S.isMini && ceilingTarget.type === 'bridge') {
        targetY = S.playerGridPos.y; action = 'roll'; // Squeeze under bridge
      } else {
        action = 'blocked';
      }
    } else if (stepDown) {
      const stepDownCeiling = colBlocks.find(b => b.y === S.playerGridPos.y);
      if (!stepDownCeiling) {
        targetY = S.playerGridPos.y - 1; action = 'descend';
      } else {
        action = 'blocked';
      }
    } else {
      // Empty target column
      const landing = colBlocks.find(b => b.y < S.playerGridPos.y);
      if (landing) {
        targetY = landing.y; action = 'fall';
      } else {
        targetY = -10; action = 'void';
      }
    }
  }

  if (action === 'blocked') return;

  executeRoll(toGX, targetY, toGZ, dirX, dirZ, action);
}

function executeRoll(toGX, targetY, toGZ, dirX, dirZ, action) {
  S.isRolling = true;
  S.rollStartGridPos = { ...S.playerGridPos };
  // Snapshot bookkeeping so a mid-step reversal can cleanly undo this step.
  S.rollPreState = { moveCount: S.moveCount, comboCount: S.comboCount, comboTimer: S.comboTimer, lastMoveDir: { ...S.lastMoveDir } };
  S.playerCube.userData.rollPushedCrate = false;
  S.animStartTime = performance.now()/1000;
  S.animStartPos.copy(S.playerCube.position);

  const isWall = action === 'wall-climb';
  const visualTargetY = isWall ? S.playerGridPos.y + 1 : (action === 'fall' || action === 'void' ? S.playerGridPos.y : targetY);

  S.animEndPos.copy(getPlayerWorldPos(isWall ? S.playerGridPos.x : toGX, visualTargetY, isWall ? S.playerGridPos.z : toGZ, S.isMini));
  S.animStartQuat.copy(S.playerCube.quaternion);

  const axis = new THREE.Vector3(dirZ, 0, -dirX).normalize();
  S.animAxis.copy(axis);
  S.animDeltaQuat.setFromAxisAngle(axis, Math.PI/2);
  S.animFromEdge = false;

  // Platform-relative roll: when the player rides a mover (and isn't leaving it
  // downward), anchor the roll to the platform's frame. The player sits at a
  // possibly fractional world position mid-step, so snapping the target to an
  // integer cell would bend the path diagonally. Instead the target is exactly
  // one cell from the start, and the platform's own motion is added during the
  // animation — so a forward press always rolls straight relative to the deck.
  S.rollCarrier = (S.ridingPlatform && !isWall && action !== 'fall' && action !== 'void') ? S.ridingPlatform : null;
  if (S.rollCarrier) {
    S.rollCarrierStart.copy(S.rollCarrier.position);
    S.animEndPos.x = S.animStartPos.x + dirX;
    S.animEndPos.z = S.animStartPos.z + dirZ;
  }

  const prevKey = `${S.playerGridPos.x},${S.playerGridPos.y},${S.playerGridPos.z}`;
  S.playerGridPos.x = isWall ? S.playerGridPos.x : toGX;
  S.playerGridPos.y = visualTargetY;
  S.playerGridPos.z = isWall ? S.playerGridPos.z : toGZ;

  S.moveCount++; updateMoveUI();

  // Combo (visual scoring only — the extra arpeggio cue was removed)
  const sameDir = (dirX === S.lastMoveDir.x && dirZ === S.lastMoveDir.z);
  if (sameDir && S.comboTimer > 0) {
    S.comboCount++;
  } else {
    S.comboCount = 1;
  }
  S.comboTimer = COMBO_TIMEOUT;
  S.lastMoveDir = { x:dirX, z:dirZ };
  updateComboUI();

  // Movement sound on every step.
  const currKey = `${S.playerGridPos.x},${S.playerGridPos.y},${S.playerGridPos.z}`;
  const block = S.activeBlocks.get(currKey);
  if (block && block.type === 'ice') audio.playIce(); else audio.playRoll();

  // Break fragile block
  const prevBlock = S.activeBlocks.get(prevKey);
  if (prevBlock && prevBlock.type === 'fragile') {
    breakFragileBlock(prevKey);
  }

  // Next steps on complete
  S.playerCube.userData.rollAction = action;
  S.playerCube.userData.targetLandingY = targetY;
}

function onRollComplete() {
  const action = S.playerCube.userData.rollAction;
  const targetY = S.playerCube.userData.targetLandingY;

  const key = `${S.playerGridPos.x},${S.playerGridPos.y},${S.playerGridPos.z}`;

  if (action === 'roll-back') {
    S.playerCube.quaternion.identity();
    S.isRolling = false;
    return;
  }

  if (action === 'reverse') {
    // Back on the origin cell with the pre-step orientation already restored by
    // the animation's end-snap — nothing further to resolve.
    S.isRolling = false;
    return;
  }

  if (action === 'fall' || action === 'void') {
    // Initiate falling animation or check edge balancing!
    if (isLastMoveKeyHeld()) {
      enterBalancing();
      return;
    }
    S.isFalling = true;
    S.fallVelY = 0;
    S.playerCube.userData.fallTargetY = targetY;
    if (action === 'fall') {
      audio.playLeap();
    } else {
      audio.playFall();
    }
    return;
  }

  if (S.boosterMovesActive > 0) {
    S.boosterMovesActive--;
    if (S.boosterMovesActive === 0) {
      showMessage('SPEED BOOST EXPIRED', 1.0);
    }
  }

  // Switched/Collected checks
  checkPrismCollection(S.playerGridPos.x, S.playerGridPos.y, S.playerGridPos.z);

  const block = S.activeBlocks.get(key);
  if (block) {
    if (block.type === 'switch') triggerSwitch(key);
    if (block.type === 'teleporter') triggerTeleport(key);
    
    if (block.type === 'container' && S.isCarryingPlutonium > 0) {
      const depositedCount = S.isCarryingPlutonium;
      S.depositedPlutonium += depositedCount;
      S.isCarryingPlutonium = 0;
      const phud = document.getElementById('plutonium-hud-bar');
      if (phud) phud.style.display = 'none';
      audio.playCollect();
      flashScreen('#00ffaa');
      showMessage(`${depositedCount} PLUTONIUM DEPOSITED IN CONTAINER!`, 2.5);

      updatePlutoniumUI();
      spawnPlutoniumDepositParticles(block.x, block.y, block.z);

      // New level win condition: immediately win if all plutonium elements are deposited
      let totalPlutonium = 0;
      S.activePrisms.forEach(p => {
        if (p.type === 'plutonium') totalPlutonium++;
      });
      let totalContainers = 0;
      S.activeBlocks.forEach(b => {
        if (b.type === 'container') totalContainers++;
      });
      if (totalPlutonium > 0 && totalContainers > 0 && S.depositedPlutonium >= totalPlutonium) {
        completeLevel();
      }
    }
    
    // Danger block death
    if (block.type === 'danger') {
      audio.playDamage();
      respawnPlayer();
      return;
    }
    
    // Booster speed activation
    if (block.type === 'booster') {
      S.boosterMovesActive = 4;
      showMessage('SPEED BOOST ACTIVE (4 MOVES)!', 1.5);
      audio.playBooster();
    }
    
    // Shaker block crumble trigger
    if (block.type === 'shaker' && !block.broken) {
      triggerShakerCrumble(block, key);
    }
  }

  if (S.playerGridPos.x === S.exitPos.x && S.playerGridPos.y === S.exitPos.y && S.playerGridPos.z === S.exitPos.z) {
    checkLevelComplete();
  }

  // Ice sliding
  if (block && block.type === 'ice' && !S.isLevelComplete) {
    setTimeout(() => {
      if (!S.isRolling && !S.isFalling && !S.isLevelComplete) {
        startRoll(S.lastMoveDir.x, S.lastMoveDir.z);
      }
    }, 60);
  }
}

/* ═══════════════════════════════════════════════════════════
   SPECIAL BLOCKS LOGIC
   ═══════════════════════════════════════════════════════════ */
function breakFragileBlock(key) {
  const block = S.activeBlocks.get(key);
  if (!block || block.broken) return;
  block.broken = true;
  audio.playBreak();
  addShake(0.25);
  flashScreen('#ff4444');
  spawnBreakParticles(block.x, block.y, block.z);

  if (block.mesh) {
    const mesh = block.mesh;
    const shrink = () => {
      mesh.scale.multiplyScalar(0.7);
      if (mesh.scale.x > 0.05) requestAnimationFrame(shrink);
      else {
        tilesGroup.remove(mesh);
        disposeMaterial(mesh.material);
      }
    };
    shrink();
  }
}

function setMeshOpacity(mesh, opacity, depthWrite, keepTopOpaque = false, baseOpacity = 1.0) {
  if (!mesh || !mesh.material) return;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  mats.forEach(m => {
    let nextVisible, nextTransparent, nextOpacity, nextDepthWrite;
    if (opacity === 0.0) {
      nextVisible = false; nextTransparent = false; nextOpacity = 1.0; nextDepthWrite = false;
    } else if (opacity < 1.0) {
      nextVisible = true; nextTransparent = true; nextOpacity = opacity; nextDepthWrite = depthWrite;
    } else {
      nextVisible = true; nextTransparent = false; nextOpacity = 1.0; nextDepthWrite = true;
    }
    // Toggling .transparent must force a material update or the renderer can keep
    // drawing the mesh in its old (opaque) pass, so the opacity change is ignored.
    if (m.transparent !== nextTransparent) m.needsUpdate = true;
    m.visible = nextVisible; m.transparent = nextTransparent; m.opacity = nextOpacity; m.depthWrite = nextDepthWrite;
  });
}

function disposeMaterial(mat) {
  if (!mat) return;
  if (Array.isArray(mat)) {
    mat.forEach(m => { if (m && typeof m.dispose === 'function') m.dispose(); });
  } else if (typeof mat.dispose === 'function') {
    mat.dispose();
  }
}

function triggerSwitch(key) {
  const targets = S.switchMap.get(key);
  if (!targets) return;

  const activeState = !(S.switchStates.get(key) || false);
  S.switchStates.set(key, activeState);
  audio.playSwitch();
  addShake(0.12);

  const sw = S.activeBlocks.get(key);
  if (sw && sw.pillar) {
    sw.pillar.material.emissive.set(activeState ? '#00ff88' : '#4466cc');
  }

  targets.forEach(tk => {
    const block = S.activeBlocks.get(tk);
    if (!block) return;
    if (block.type === 'bridge') {
      block.active = activeState;
      if (activeState) {
        createBlockMesh(block, tk);
        block.mesh.scale.y = 0.01;
        const grow = () => {
          block.mesh.scale.y += (1 - block.mesh.scale.y)*0.25;
          if (block.mesh.scale.y < 0.98) requestAnimationFrame(grow);
          else block.mesh.scale.y = 1;
        };
        grow();
      } else {
        if (block.mesh) {
          const mesh = block.mesh;
          const shrink = () => {
            mesh.scale.y *= 0.6;
            if (mesh.scale.y > 0.02) requestAnimationFrame(shrink);
            else {
              tilesGroup.remove(mesh);
              disposeMaterial(mesh.material);
            }
          };
          shrink();
        }
      }
    } else if (block.type === 'moving' && block.platformInstance) {
      block.platformInstance.active = activeState;
    }
  });

  showMessage(activeState ? 'Mechanism online' : 'Mechanism offline', 1.2);
}

function triggerTeleport(key) {
  const destKey = S.teleporterMap.get(key);
  if (!destKey) return;
  const destBlock = S.activeBlocks.get(destKey);
  if (!destBlock || !destBlock.active) return;

  const [dx, dy, dz] = destKey.split(',').map(Number);
  S.isTeleporting = true;
  audio.playTeleport();
  spawnTeleportParticles(S.playerGridPos.x, S.playerGridPos.y, S.playerGridPos.z);

  const fadeOut = () => {
    S.playerCube.scale.multiplyScalar(0.7);
    if (S.playerCube.scale.x > 0.05) requestAnimationFrame(fadeOut);
    else {
      S.playerGridPos.x = dx; S.playerGridPos.y = dy; S.playerGridPos.z = dz;
      S.playerCube.position.copy(getPlayerWorldPos(dx, dy, dz, S.isMini));
      S.playerCube.quaternion.identity();
      spawnTeleportParticles(dx, dy, dz);

      const fadeIn = () => {
        S.playerCube.scale.lerp(new THREE.Vector3(1,1,1), 0.3);
        if (S.playerCube.scale.x < 0.95) requestAnimationFrame(fadeIn);
        else {
          S.playerCube.scale.set(1,1,1); S.isTeleporting = false;
          checkPrismCollection(dx, dy, dz);
          if (dx === S.exitPos.x && dy === S.exitPos.y && dz === S.exitPos.z) checkLevelComplete();
        }
      };
      fadeIn();
    }
  };
  fadeOut();
}

/* ═══════════════════════════════════════════════════════════
   PRISM & MINI-CUBE LOGIC
   ═══════════════════════════════════════════════════════════ */
function checkPrismCollection(gx, gy, gz) {
  const key = `${gx},${gy},${gz}`;
  const prism = S.activePrisms.get(key);
  if (prism && !prism.collected) {
    prism.collected = true;
    audio.playCollect();
    if (prism.type === 'plutonium') {
      flashScreen('#d946ef');
      if (prism.mesh) {
        spawnCollectParticles(prism.mesh.position);
        const mesh = prism.mesh;
        prism.mesh.material = matPlutoniumGlow.clone();
        setTimeout(() => prismsGroup.remove(mesh), 200);
      }
      S.isCarryingPlutonium++;
      S.plutoniumTimer = S.activeLevel.plutoniumTimeLimit ?? 30.0;
      if (!S.hasCollectedPlutoniumThisRun) {
        S.hasCollectedPlutoniumThisRun = true;
        showMessage('deposit in container', 0.5);
      } else {
        showMessage('PLUTONIUM COLLECTED! DEPOSIT IN CONTAINER', 3.0);
      }
      const phud = document.getElementById('plutonium-hud-bar');
      if (phud) phud.style.display = 'block';
    } else {
      flashScreen('#ffcc44');
      if (prism.mesh) {
        spawnCollectParticles(prism.mesh.position);
        const mesh = prism.mesh;
        prism.mesh.material = matPrismGlow.clone();
        setTimeout(() => prismsGroup.remove(mesh), 200);
      }
      if (prism.type === 'miniprism') {
        activateMiniCube();
      } else {
        updatePrismUI();
      }
    }
  }
}

function activateMiniCube() {
  if (S.isMini) {
    S.miniTimer = 15; audio.playShrink(); return;
  }
  S.isMini = true; S.miniTimer = 15;
  audio.playShrink();
  showMessage('MINI CUBE! SPEED + CLIMBING', 2);
  document.getElementById('mini-hud-bar').style.display = 'block';

  const shrink = () => {
    if (!S.isMini) return;
    S.playerCube.scale.lerp(new THREE.Vector3(0.5,0.5,0.5), 0.25);
    if (S.playerCube.scale.x > 0.51) requestAnimationFrame(shrink);
    else S.playerCube.scale.set(0.5,0.5,0.5);
  };
  shrink();
}

function checkGrowBack() {
  // Check ceiling above
  const ceiling = getBlocksInColumn(S.playerGridPos.x, S.playerGridPos.z).find(b => b.y === S.playerGridPos.y + 1);
  if (ceiling) {
    S.miniTimer = 0.5; // check again in 0.5s
    showMessage('TIGHT SPACE - CANNOT GROW!', 1);
    return;
  }
  S.isMini = false;
  audio.playGrow();
  showMessage('RESTORED SIZE', 1.5);
  document.getElementById('mini-hud-bar').style.display = 'none';

  const grow = () => {
    if (S.isMini) return;
    S.playerCube.scale.lerp(new THREE.Vector3(1,1,1), 0.25);
    if (S.playerCube.scale.x < 0.99) requestAnimationFrame(grow);
    else S.playerCube.scale.set(1,1,1);
  };
  grow();
}

/* ═══════════════════════════════════════════════════════════
   LEVEL END & COMPLETION
   ═══════════════════════════════════════════════════════════ */
function checkLevelComplete() {
  let remaining = 0;
  let totalPlutonium = 0;
  S.activePrisms.forEach(p => {
    if (p.type === 'plutonium') totalPlutonium++;
    else if (p.type !== 'miniprism' && !p.collected) remaining++;
  });
  if (remaining === 0) {
    let totalContainers = 0;
    S.activeBlocks.forEach(b => {
      if (b.type === 'container') totalContainers++;
    });
    if (totalPlutonium > 0 && totalContainers > 0 && S.depositedPlutonium < totalPlutonium) {
      showMessage(`DEPOSIT ALL PLUTONIUM FIRST! (${S.depositedPlutonium}/${totalPlutonium})`, 2.0);
      return;
    }
    completeLevel();
  }
}

function advanceCompletedLevel() {
  if (S.completeTimeoutId) {
    clearTimeout(S.completeTimeoutId);
    S.completeTimeoutId = null;
  }
  document.getElementById('complete-overlay').classList.remove('show');
  if (S.isEditMode) {
    exitPlaytestMode();
  } else {
    S.currentLevelIdx = (S.currentLevelIdx + 1) % S.premadeLevels.length;
    loadPreMadeLevel(S.currentLevelIdx);
  }
}

function completeLevel() {
  S.isLevelComplete = true;
  audio.playComplete();
  spawnLevelCompleteExplosion();
  S.completeAnimStartTime = performance.now() / 1000;

  const stars = S.moveCount <= S.activeLevel.par ? 3 : (S.moveCount <= S.activeLevel.par * 1.5 ? 2 : 1);
  document.getElementById('complete-overlay').classList.add('show');
  document.getElementById('complete-text').textContent = S.isEditMode ? 'PLAYTEST COMPLETE' : `LEVEL ${S.currentLevelIdx+1} CLEAR`;
  
  // Clean stars before sequence starts
  document.getElementById('star1').classList.remove('earned');
  document.getElementById('star2').classList.remove('earned');
  document.getElementById('star3').classList.remove('earned');

  if (stars >= 1) {
    setTimeout(() => {
      document.getElementById('star1').classList.add('earned');
      audio.playStarEarned(0);
    }, 450);
  }
  if (stars >= 2) {
    setTimeout(() => {
      document.getElementById('star2').classList.add('earned');
      audio.playStarEarned(1);
    }, 900);
  }
  if (stars >= 3) {
    setTimeout(() => {
      document.getElementById('star3').classList.add('earned');
      audio.playStarEarned(2);
    }, 1350);
  }

  if (S.completeTimeoutId) clearTimeout(S.completeTimeoutId);
  S.completeTimeoutId = setTimeout(() => {
    advanceCompletedLevel();
  }, 2500);
}

function respawnPlayer() {
  audio.playRespawn();
  addShake(0.3);
  flashScreen('#ff3355');

  // Full level reset from the pristine snapshot — restores broken fragile/
  // shaker blocks, pushed crates, switch states and prisms (no softlocks).
  if (S.levelSnapshot) {
    S.activeLevel = deserializeLevel(S.levelSnapshot);
    buildLevel3D(S.activeLevel);
  }
  showMessage('LEVEL RESTART', 1.2);
}


/* ═══════════════════════════════════════════════════════════
   LEVEL EDITOR IMPLEMENTATION
   ═══════════════════════════════════════════════════════════ */
// Snapshot the current level onto the undo history before a mutating edit.
function pushUndoSnapshot() {
  if (!S.activeLevel) return;
  S.undoStack.push(serializeLevel(S.activeLevel));
  if (S.undoStack.length > UNDO_LIMIT) S.undoStack.shift();
  updateUndoButton();
}

function editorUndo() {
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

function updateUndoButton() {
  const btn = document.getElementById('btn-undo');
  if (btn) btn.disabled = S.undoStack.length === 0;
}

function enterEditMode() {
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

function exitEditMode() {
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

function lvlInsertDefaultBlocks(lvl) {
  for (let x=0; x<5; x++) {
    for (let z=0; z<5; z++) {
      lvl.blocks.set(`${x},0,${z}`, { x, y:0, z, type:'normal', properties:{} });
    }
  }
  lvl.start = { x:0, y:0, z:0 };
  lvl.exit = { x:4, y:0, z:4 };
}

function renderVerticalRuler() {
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

function updateEditorSlicing() {
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


function updateLibraryList() {
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
  });
  // Levels shipped as files in the /level folder (read-only, no delete button)
  loadFolderLevels(list, token);
}

// Fetch level files from the /level folder and add them to the Load Level list.
// Uses level/manifest.json (array of filenames) if present; otherwise probes
// 1.json, 2.json, … until a file is missing (contiguous numbering).
async function loadFolderLevels(list, token) {
  let files = [];
  try {
    const res = await fetch('level/manifest.json', { cache: 'no-store' });
    if (res.ok) {
      const m = await res.json();
      if (Array.isArray(m)) files = m.map(f => (typeof f === 'string' ? f : f.file)).filter(Boolean);
    }
  } catch (e) { /* no manifest */ }
  if (!files.length) {
    for (let i = 1; i <= 99; i++) {
      try {
        const r = await fetch(`level/${i}.json`, { cache: 'no-store' });
        if (!r.ok) break;
        files.push(`${i}.json`);
      } catch (e) { break; }
    }
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
  }
}

function drawEditorWires() {
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

function editorRaycast(e) {
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

const BLOCK_TOOLS = ['normal', 'fragile', 'ice', 'switch', 'bridge', 'teleporter', 'moving', 'pushable', 'pressureplate', 'danger', 'shaker', 'booster', 'container'];

function snapItemCell(hit) {
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
function editorEraseKey(key, kinds = ['block', 'prism', 'enemy']) {
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

function editorPlaceBlock(x, y, z, type) {
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

function editorPlacePrism(x, y, z, type) {
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

function editorPlaceEnemy(x, y, z) {
  const key = `${x},${y},${z}`;
  if (S.activeLevel.enemies.has(key)) return false;
  S.activeLevel.enemies.set(key, {});
  createEnemyMarker(key);
  updateEditorSlicing();
  return true;
}

function editorSetStart(c) {
  S.activeLevel.start = { x: c.x, y: c.y, z: c.z };
  S.playerGridPos = { ...S.activeLevel.start };
  if (S.playerCube) {
    S.playerCube.position.copy(getPlayerWorldPos(c.x, c.y, c.z, false));
    S.playerCube.quaternion.identity();
  }
  audio.playPlace('start');
}

function editorFillPlane(y, type) {
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

function editorClearPlane(y) {
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

function commitPlaneDraw() {
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

function handleEditorClick(e) {
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

function handleEditorDragClick(e) {
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

function enterPlaytestMode() {
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

function exitPlaytestMode() {
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

function adjustEditHeight(val) {
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
function selectToolByName(name) {
  toolButtons.forEach(b => b.classList.toggle('active', b.dataset.tool === name));
  S.selectedTool = name;
  S.linkerSourceKey = null;
  audio.playToolSelect();
}
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

function updateDynamicTransparency() {
  if (S.isEditMode && !S.isPlaytesting) {
    // Reset all opacities in editor mode (rely entirely on slice mode transparency)
    S.activeBlocks.forEach(block => {
      if (block.mesh && !block.playerPlaced) {
        const isInactiveBridge = (block.type === 'bridge' && block.active === false);
        const isBelow = (S.sliceModeActive && block.y < S.editY);
        if (isBelow) {
          block.mesh.traverse(m => {
            if (m.isMesh && m.material) {
              const mats = Array.isArray(m.material) ? m.material : [m.material];
              mats.forEach(mat => {
                mat.wireframe = false;
              });
            }
          });
          setMeshOpacity(block.mesh, 1.0, true);
        } else if (isInactiveBridge) {
          block.mesh.traverse(m => {
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
          block.mesh.traverse(m => {
            if (m.isMesh && m.material) {
              const mats = Array.isArray(m.material) ? m.material : [m.material];
              mats.forEach(mat => {
                mat.wireframe = false;
              });
            }
          });
          setMeshOpacity(block.mesh, 1.0, true);
        }
      }
    });
    S.movingPlatformsList.forEach(mp => {
      if (mp.mesh) {
        const mpMat = mp.mesh.material;
        mp.mesh.visible = true;
        if (mpMat.transparent !== false) mpMat.needsUpdate = true;
        mpMat.transparent = false;
        mpMat.opacity = 1.0;
      }
    });
    return;
  }

  if (!S.playerCube) return;

  // X-ray view (toggled with a middle-mouse click): force every block and
  // platform see-through so the whole structure reads at once. Edge outlines,
  // prisms and enemy markers stay opaque, so the level is still legible.
  if (S.xrayMode) {
    S.activeBlocks.forEach(block => {
      if (!block.mesh) return;
      setMeshOpacity(block.mesh, 0.5, false); // 50% transparency
      block.mesh.traverse(child => {
        if (child !== block.mesh && child.material && !(child.isLineSegments)) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach(mat => {
            if (!mat.transparent) mat.needsUpdate = true;
            mat.visible = true; mat.transparent = true; mat.opacity = 0.5; mat.depthWrite = false;
          });
        }
      });
    });
    S.movingPlatformsList.forEach(mp => {
      if (!mp.mesh) return;
      const mpMat = mp.mesh.material;
      mp.mesh.visible = true;
      if (!mpMat.transparent) mpMat.needsUpdate = true;
      mpMat.transparent = true; mpMat.opacity = 0.5; mpMat.depthWrite = false;
    });
    return;
  }

  // If S.xrayMode is false, make everything solid / opaque.
  S.activeBlocks.forEach(block => {
    if (!block.mesh) return;
    setMeshOpacity(block.mesh, 1.0, true);
    block.mesh.traverse(child => {
      if (child !== block.mesh && child.material && !child.isLineSegments) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(mat => {
          if (mat.transparent !== false) mat.needsUpdate = true;
          mat.visible = true; mat.transparent = false; mat.opacity = 1.0; mat.depthWrite = true;
        });
      }
    });
  });
  S.movingPlatformsList.forEach(mp => {
    if (!mp.mesh) return;
    const mpMat = mp.mesh.material;
    mp.mesh.visible = true;
    if (mpMat.transparent !== false) mpMat.needsUpdate = true;
    mpMat.transparent = false; mpMat.opacity = 1.0; mpMat.depthWrite = true;
  });
}

/* ═══════════════════════════════════════════════════════════
   ANIMATION & RENDER LOOP
   ═══════════════════════════════════════════════════════════ */
const clock = new THREE.Clock();

function animate(timestamp) {
  requestAnimationFrame(animate);
  const now = timestamp/1000;
  const dt = Math.min(clock.getDelta(), 0.1);



  // Dynamic transparency update (throttled for high performance)
  S.transparencyUpdateTimer++;
  if (S.transparencyUpdateTimer % 6 === 0) {
    updateDynamicTransparency();
  }

  // Spatial starfield: a star dome around the camera, only while playing (not in
  // the editor). Recentre on the camera so it never clips, and drift it slowly
  // so orbiting the level sweeps the stars across the view for depth.
  if (starfield) {
    const playing = !(S.isEditMode && !S.isPlaytesting);
    starfield.visible = playing;
    if (playing) {
      starfield.position.copy(camera.position);
      if (S.isLevelComplete && S.completeAnimStartTime > 0) {
        const elapsed = now - S.completeAnimStartTime;
        starfield.rotation.y += dt * 0.45;
        starfield.rotation.x += dt * 0.15;
        const blast = 1 + Math.pow(elapsed * 12.0, 2.2);
        starfield.scale.setScalar(blast);
        starUniforms.uTime.value = now * 10.0;
      } else {
        starfield.rotation.y += dt * 0.010;
        starfield.rotation.x += dt * 0.004;
        const pulse = 1 + Math.sin(now * 0.18) * 0.14;
        starfield.scale.setScalar(pulse);
        let isLowPlutonium = false;
        if (S.isCarryingPlutonium > 0 && !S.isPaused) {
          const limit = S.activeLevel.plutoniumTimeLimit ?? 30.0;
          if (S.plutoniumTimer <= limit * 0.1) {
            isLowPlutonium = true;
          }
        }
        if (isLowPlutonium) {
          // Rapid flickering of uTime and randomized phase shifts to create a chaotic star flicker
          starUniforms.uTime.value = now * 25.0 + (Math.random() < 0.5 ? 5.0 : 0.0);
        } else {
          starUniforms.uTime.value = now;
        }
      }
    }
  }

  // Paused: freeze all game logic, only drive the free-orbit camera and render.
  if (S.isPaused && (!S.isEditMode || S.isPlaytesting)) {
    updatePauseOrbitCamera();
    renderer.render(scene, camera);
    return;
  }

  if (!S.isEditMode || S.isPlaytesting) {
    // Game time
    if (!S.isLevelComplete) { S.elapsedTime += dt; S.gameTimer += dt; }
    
    if (S.isCarryingPlutonium > 0 && !S.isLevelComplete && !S.isPaused) {
      S.plutoniumTimer -= dt;
      if (S.plutoniumTimer <= 0) {
        S.plutoniumTimer = 0;
        S.isCarryingPlutonium = 0;
        const phud = document.getElementById('plutonium-hud-bar');
        if (phud) phud.style.display = 'none';
        loseLife('plutonium exploded');
      } else {
        const limit = S.activeLevel.plutoniumTimeLimit ?? 30.0;
        if (S.plutoniumTimer <= limit * 0.1) {
          S.plutoniumWarningSoundTimer -= dt;
          if (S.plutoniumWarningSoundTimer <= 0) {
            audio.playPlutoniumWarning();
            S.plutoniumWarningSoundTimer = 0.25; // Play alarm beep every 250ms
          }
        } else {
          S.plutoniumWarningSoundTimer = 0.0;
        }

        const phudFill = document.getElementById('plutonium-hud-fill');
        const phudText = document.getElementById('plutonium-hud-text');
        if (phudFill && phudText) {
          const pct = Math.max(0, Math.min(100, (S.plutoniumTimer / limit) * 100));
          phudFill.style.width = pct + '%';
          phudText.textContent = `PLUTONIUM: ${S.plutoniumTimer.toFixed(1)}s`;
        }
      }
    }

    if (S.comboTimer > 0) { S.comboTimer -= dt; if (S.comboTimer <= 0) { S.comboCount = 0; updateComboUI(); } }

    // Edge Balancing update
    if (S.isBalancing) {
      if (!isLastMoveKeyHeld()) {
        S.isBalancing = false;
        S.isFalling = true;
        S.fallVelY = 0;
        S.playerCube.userData.fallTargetY = S.playerCube.userData.targetLandingY;
        audio.playBalanceStop();
        audio.playFall();
      } else {
        S.balanceTimer -= dt;
        if (S.balanceTimer <= 0) {
          S.isBalancing = false;
          S.isFalling = true;
          S.fallVelY = 0;
          S.playerCube.userData.fallTargetY = S.playerCube.userData.targetLandingY;
          audio.playBalanceStop();
          audio.playFall();
        }
      }
    }

    // Pressure plate real-time check
    updatePressurePlates();

    // Mini duration
    if (S.isMini && S.miniTimer > 0) {
      S.miniTimer -= dt;
      document.getElementById('mini-hud-fill').style.width = (S.miniTimer / 15 * 100) + '%';
      if (S.miniTimer <= 0) checkGrowBack();
    }

    // Held-direction auto-repeat: roll one cell every 300ms while a key is held.
    if (S.repeatMoveCode && S.keysPressed[S.repeatMoveCode] && !S.isLevelComplete) {
      S.moveRepeatTimer += dt * 1000;
      if (S.moveRepeatTimer >= MOVE_REPEAT_MS) {
        S.moveRepeatTimer -= MOVE_REPEAT_MS;
        handleMove(S.repeatMoveDir.x, S.repeatMoveDir.z);
      }
    } else {
      S.repeatMoveCode = null;
      S.moveRepeatTimer = 0;
    }

    // Platforms update
    S.movingPlatformsList.forEach(mp => mp.update(dt));

    // Player riding a mover — STICKY + RIGID: once aboard, the cube is locked
    // to the mover by a fixed cell offset (cube = mover.position + offset) every
    // frame, so it is transported with the block and never slides across it.
    const size = S.isMini ? CUBE_S * 0.5 : CUBE_S;
    if (S.isRolling || S.isFalling || S.isTeleporting) {
      S.ridingPlatform = null;
    } else {
      if (!S.ridingPlatform) {
        S.ridingPlatform = checkRidingPlatform(); // step aboard
        if (S.ridingPlatform) {
          // Lock onto the cell we boarded (snap horizontal offset to whole cells,
          // keep the standing height). Works for the driver tile and any
          // compound-object passenger cell.
          S.ridingOffset.set(
            Math.round(S.playerCube.position.x - S.ridingPlatform.position.x),
            0.5 + size / 2,
            Math.round(S.playerCube.position.z - S.ridingPlatform.position.z)
          );
        }
      }
      if (S.ridingPlatform && !S.ridingPlatform.active) S.ridingPlatform = null;
    }

    if (S.ridingPlatform) {
      const before = S.playerCube.position.clone();
      S.playerCube.position.copy(S.ridingPlatform.position).add(S.ridingOffset);
      S.cameraTarget.add(S.playerCube.position.clone().sub(before));
      S.playerGridPos.x = Math.round(S.playerCube.position.x);
      S.playerGridPos.y = Math.round(S.playerCube.position.y - 0.5 - size/2);
      S.playerGridPos.z = Math.round(S.playerCube.position.z);
    } else {
      // Otherwise, a mover advancing into the player's cell shoves them along.
      const mpPush = checkPushedByPlatform();
      if (mpPush) {
        const delta = mpPush.position.clone().sub(mpPush.prevPosition);
        S.playerCube.position.add(delta);
        S.cameraTarget.add(delta);
        S.playerGridPos.x = Math.round(S.playerCube.position.x);
        S.playerGridPos.y = Math.round(S.playerCube.position.y - 0.5 - size/2);
        S.playerGridPos.z = Math.round(S.playerCube.position.z);
        // Shoved over a ledge with nothing to stand on → fall.
        const col = getBlocksInColumn(S.playerGridPos.x, S.playerGridPos.z);
        if (!col.some(b => b.y === S.playerGridPos.y)) {
          const landing = col.find(b => b.y < S.playerGridPos.y);
          S.isFalling = true; S.fallVelY = 0;
          S.playerCube.userData.fallTargetY = landing ? landing.y : -10;
          audio.playFall();
        }
      }
    }

    // Rolling animation
    if (S.isRolling) {
      const elapsed = now - S.animStartTime;
      let dur = S.isMini ? ROLL_DUR_MINI : ROLL_DUR_NORMAL;
      if (S.boosterMovesActive > 0) dur *= 0.5;
      let t = Math.min(elapsed / dur, 1.0);
      t = 1 - Math.pow(1-t, 2.5); // Ease out

      const pos = new THREE.Vector3().lerpVectors(S.animStartPos, S.animEndPos, t);
      // Bounce Y curve
      pos.y += CUBE_S * 0.25 * Math.sin(Math.PI*t);
      // Carry the player with the platform for the duration of a platform roll.
      if (S.rollCarrier) pos.add(S.rollCarrier.position).sub(S.rollCarrierStart);
      S.playerCube.position.copy(pos);

      const quat = S.animStartQuat.clone();
      quat.slerp(new THREE.Quaternion().multiplyQuaternions(S.animDeltaQuat, S.animStartQuat), t);
      S.playerCube.quaternion.copy(quat);

      // spawn trail S.particles
      S.trailTimer += dt;
      if (S.trailTimer > 0.035) { S.trailTimer = 0; spawnTrailParticle(); }

      if (elapsed >= dur) {
        S.playerCube.position.copy(S.animEndPos);
        if (S.rollCarrier) {
          // Settle at the platform-carried landing and sync the grid cell to it
          // so the riding logic re-boards the correct cell next frame.
          S.playerCube.position.add(S.rollCarrier.position).sub(S.rollCarrierStart);
          S.playerGridPos.x = Math.round(S.playerCube.position.x);
          S.playerGridPos.z = Math.round(S.playerCube.position.z);
          S.rollCarrier = null;
        }
        S.playerCube.quaternion.copy(new THREE.Quaternion().multiplyQuaternions(S.animDeltaQuat, S.animStartQuat));
        S.isRolling = false;
        S.cameraTarget.copy(S.playerCube.position);
        onRollComplete();
      }
    }

    // Falling animation
    if (S.isFalling) {
      S.fallVelY += 14 * dt; // gravity
      S.playerCube.position.y -= S.fallVelY * dt;
      const size = S.isMini ? CUBE_S*0.5 : CUBE_S;

      // Re-scan the column beneath the player every frame and land on the
      // highest supporting block actually reached — including one the initial
      // fall target missed or that only arrived mid-fall (e.g. a moving
      // platform). Any solid element catches the player: a deeper fall onto a
      // load-bearing block is always a safe landing, never a death. Death is
      // reserved for the genuine void (no block anywhere below).
      const col = getBlocksInColumn(S.playerGridPos.x, S.playerGridPos.z);
      let landBlock = null;
      for (const b of col) {                  // sorted highest-first
        if (b.y >= S.playerGridPos.y) continue;  // ignore blocks at/above the launch level
        if (S.playerCube.position.y <= b.y + 0.5 + size/2) { landBlock = b; break; }
      }

      if (landBlock) {
        // Landed on a supporting element
        S.playerCube.position.y = landBlock.y + 0.5 + size/2;
        S.isFalling = false;
        S.playerGridPos.y = landBlock.y;
        audio.playLand();
        addShake(0.18);
        spawnLandingParticles(S.playerGridPos.x, S.playerGridPos.y, S.playerGridPos.z);
        // Run the landing cell's effects (switch / exit / hazard / ice …) but
        // NOT the fall branch of onRollComplete — the fall is over, so neutralise
        // the action first so the player is free to move again immediately
        // instead of being re-armed into another fall.
        S.playerCube.userData.rollAction = 'land';
        onRollComplete();
      } else if (S.playerCube.position.y < -8) {
        // Nothing beneath at all → the void
        respawnPlayer();
      }
    }

    // ─── ENEMIES ─────────────────────────────────────────────
    for (const en of S.enemies) {
      // Rainbow color cycle (enhanced 3X)
      en.hue = (en.hue + dt * 1.65) % 1.0;
      en.cube.material.color.setHSL(en.hue, 1.0, 0.52);
      en.cube.material.emissive.setHSL(en.hue, 1.0, 0.38);

      // Roll animation (same math as player)
      if (en.isRolling) {
        const eElapsed = now - en.animStartTime;
        const eDur = ROLL_DUR_NORMAL * 0.72;
        let et = Math.min(eElapsed / eDur, 1.0);
        et = 1 - Math.pow(1 - et, 2.5);

        const ePos = new THREE.Vector3().lerpVectors(en.animStartPos, en.animEndPos, et);
        ePos.y += CUBE_S * 0.25 * Math.sin(Math.PI * et);
        en.cube.position.copy(ePos);

        const eQuat = en.animStartQuat.clone();
        eQuat.slerp(new THREE.Quaternion().multiplyQuaternions(en.animDeltaQuat, en.animStartQuat), et);
        en.cube.quaternion.copy(eQuat);

        if (eElapsed >= eDur) {
          en.cube.position.copy(en.animEndPos);
          en.cube.quaternion.copy(new THREE.Quaternion().multiplyQuaternions(en.animDeltaQuat, en.animStartQuat));
          en.isRolling = false;
        }
      }

      // Pathfinding movement
      if (!en.isRolling && !S.isLevelComplete) {
        en.moveTimer -= dt;
        if (en.moveTimer <= 0) {
          en.moveTimer = ENEMY_MOVE_INTERVAL;
          const step = enemyBFS(en);
          if (step) startEnemyRoll(en, step.dx, step.dz);
        }
      }

      // Collision with player. loseLife() rebuilds the level (and the S.enemies
      // array), so stop iterating the now-stale list immediately.
      if (!S.playerInvincible && !S.isLevelComplete && S.playerCube) {
        const sameCell = S.playerGridPos.x === en.grid.x &&
                         S.playerGridPos.y === en.grid.y &&
                         S.playerGridPos.z === en.grid.z;
        const touching = S.playerCube.position.distanceTo(en.cube.position) < CUBE_S * 1.05;
        if (sameCell || touching) { loseLife(); break; }
      }
    }

    // Player invincibility blink
    if (S.playerInvincible && S.playerCube) {
      S.playerInvincibleTimer -= dt;
      S.playerCube.visible = Math.floor(S.playerInvincibleTimer * 9) % 2 === 0;
      if (S.playerInvincibleTimer <= 0) {
        S.playerInvincible = false;
        S.playerCube.visible = true;
      }
    }
    checkEnemiesTrappedWin();
    // ─── END ENEMY ───────────────────────────────────────────

    // Camera targets follow player
    if (!S.isRolling && !S.isFalling && S.playerCube) S.cameraTarget.lerp(S.playerCube.position, CAM_LERP);
    else if (S.playerCube) S.cameraTarget.lerp(S.playerCube.position, CAM_LERP*0.6);

    S.cameraLookAt.lerp(S.cameraTarget, CAM_LERP*1.2);

    // Camera shake
    if (S.shakeIntensity > 0.001) {
      S.cameraShake.set((Math.random()-0.5)*S.shakeIntensity, (Math.random()-0.5)*S.shakeIntensity*0.5, 0);
      S.shakeIntensity *= 0.85;
    } else { S.cameraShake.set(0,0,0); S.shakeIntensity = 0; }

    // Camera peek: while the left button is held the view is nudged by
    // S.peekYaw/S.peekPitch; once released it eases smoothly back to neutral.
    if (!S.peekActive) {
      S.peekYaw  += (0 - S.peekYaw)  * 0.12;
      S.peekPitch += (0 - S.peekPitch) * 0.12;
      if (Math.abs(S.peekYaw)  < 1e-3) S.peekYaw = 0;
      if (Math.abs(S.peekPitch) < 1e-3) S.peekPitch = 0;
    }
    const offset = new THREE.Vector3(7, 8.5, 8);
    if (S.peekYaw !== 0 || S.peekPitch !== 0) {
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), S.peekYaw); // orbit horizontally
      const horizAxis = new THREE.Vector3(-offset.z, 0, offset.x).normalize();
      offset.applyAxisAngle(horizAxis, S.peekPitch);               // tilt vertically
    }
    const desCam = S.cameraLookAt.clone().add(offset).add(S.cameraShake);
    camera.position.lerp(desCam, CAM_LERP*0.7);
    camera.lookAt(S.cameraLookAt.clone().add(S.cameraShake));

    if (S.playerCube) {
      underGlow.position.lerp(new THREE.Vector3(S.playerCube.position.x, S.playerCube.position.y-0.4, S.playerCube.position.z), 0.1);
    }

  } else {
    // Continuous camera pan/rotate while keys are held (frame-rate independent).
    const ae = document.activeElement;
    const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT');
    if (!typing) {
      const panSpeed = 14, rotSpeed = 2.2;
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
      const lft = new THREE.Vector3(-fwd.z, 0, fwd.x);
      if (S.keysPressed['KeyW'] || S.keysPressed['ArrowUp'])    S.editorCameraTarget.addScaledVector(fwd,  panSpeed * dt);
      if (S.keysPressed['KeyS'] || S.keysPressed['ArrowDown'])  S.editorCameraTarget.addScaledVector(fwd, -panSpeed * dt);
      if (S.keysPressed['KeyA'] || S.keysPressed['ArrowLeft'])  S.editorCameraTarget.addScaledVector(lft, -panSpeed * dt);
      if (S.keysPressed['KeyD'] || S.keysPressed['ArrowRight']) S.editorCameraTarget.addScaledVector(lft,  panSpeed * dt);
      if (S.keysPressed['KeyQ']) S.editorCameraYaw -= rotSpeed * dt;
      if (S.keysPressed['KeyE']) S.editorCameraYaw += rotSpeed * dt;
    }

    // Level Editor camera orbits
    const targetCamPos = new THREE.Vector3(
      S.editorCameraTarget.x + Math.sin(S.editorCameraYaw) * Math.cos(S.editorCameraPitch) * S.editorCameraZoom,
      S.editorCameraTarget.y + Math.sin(S.editorCameraPitch) * S.editorCameraZoom,
      S.editorCameraTarget.z + Math.cos(S.editorCameraYaw) * Math.cos(S.editorCameraPitch) * S.editorCameraZoom
    );
    camera.position.lerp(targetCamPos, 0.15);
    camera.lookAt(S.editorCameraTarget);
  }

  // Update S.particles
  for (let i=S.particles.length-1; i>=0; i--) {
    const p = S.particles[i]; p.userData.age += dt;
    if (p.userData.age >= p.userData.life) {
      effectsGroup.remove(p); if (p.geometry) p.geometry.dispose(); if (p.material) p.material.dispose();
      S.particles.splice(i,1); continue;
    }
    const prog = p.userData.age / p.userData.life;
    p.position.addScaledVector(p.userData.vel, dt);
    p.userData.vel.y -= 4 * dt; // gravity
    p.material.opacity = 1 - prog;
    p.scale.setScalar(1 - prog*0.7);
    if (p.userData.spin) {
      p.rotation.x += p.userData.spin.x * dt;
      p.rotation.y += p.userData.spin.y * dt;
      p.rotation.z += p.userData.spin.z * dt;
    }
  }

  // Update trails
  for (let i=S.trailParts.length-1; i>=0; i--) {
    const p = S.trailParts[i]; p.userData.age += dt;
    if (p.userData.age >= p.userData.life) {
      effectsGroup.remove(p); if (p.geometry) p.geometry.dispose(); if (p.material) p.material.dispose();
      S.trailParts.splice(i,1); continue;
    }
    p.material.opacity = 0.45 * (1 - p.userData.age/p.userData.life);
    p.scale.setScalar(0.6 + 0.4*(1 - p.userData.age/p.userData.life));
  }

  // Animate prisms. prismsGroup also holds static enemy markers (no baseY) —
  // skip those so we don't write NaN into their position and cull them.
  for (const child of prismsGroup.children) {
    if (child.userData && child.userData.baseY !== undefined) {
      if (child.userData.isPlutonium) {
        // Plutonium rotates only horizontally, at 3x normal speed (300%), and stays centered vertically
        child.position.y = child.userData.baseY;
        child.rotation.y += 0.075; // 0.025 * 3
        child.rotation.x = 0;
        child.rotation.z = 0;

        // Purple-black pulsation (scale between 0.32 and 0.48, color/emissive oscillates)
        const pulse = 0.32 + 0.16 * (Math.sin(now * 6.0) + 1.0) / 2.0;
        child.scale.set(pulse, pulse, pulse);

        const colorVal = (Math.sin(now * 6.0) + 1.0) / 2.0;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(m => {
          m.color.setRGB(colorVal * 0.5, 0, colorVal * 0.6);
          m.emissive.setRGB(colorVal * 0.85, 0, colorVal * 0.93);
          m.emissiveIntensity = 0.5 + colorVal * 2.0;
        });
      } else {
        child.position.y = child.userData.baseY + Math.sin(now*2.5 + child.position.x*1.3)*0.12;
        child.rotation.y += 0.025; child.rotation.x += 0.015;
      }
    }
  }

  // Animate exit ring
  if (S.exitRing) {
    const s = 1 + Math.sin(now*2.5)*0.08;
    S.exitRing.scale.lerp(new THREE.Vector3(s,s,s), 0.1);
    S.exitRing.rotation.z += 0.012;
    S.exitRing.position.y = S.exitPos.y + 0.5 + Math.sin(now*3)*0.04;
  }

  // Animate container blocks (purple/black blinking every 200ms, rotating, pulsating size)
  const containerBlink = (now % 0.4) < 0.2;
  for (const mesh of S.containerMeshes) {
    mesh.rotation.y += 0.015;
    mesh.rotation.x = 0;
    mesh.rotation.z = 0;

    const pulse = 0.72 + 0.16 * (Math.sin(now * 6.0) + 1.0) / 2.0;
    mesh.scale.set(pulse, pulse, pulse);

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach(m => {
      if (containerBlink) {
        m.color.setRGB(0.5, 0, 0.6);
        m.emissive.setRGB(0.85, 0, 0.93);
        m.emissiveIntensity = 2.0;
      } else {
        m.color.setRGB(0.02, 0, 0.02);
        m.emissive.setRGB(0, 0, 0);
        m.emissiveIntensity = 0.0;
      }
    });
  }

  updateTimerUI();
  renderer.render(scene, camera);
}

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
