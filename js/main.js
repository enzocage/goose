import * as THREE from 'three';
import { TILE_SIZE, CUBE_S, ROLL_DUR_NORMAL, ROLL_DUR_MINI, CAM_LERP, BALANCE_WINDOW, COMBO_TIMEOUT } from './constants.js';
import { WORLDS, LEVELS, DEMO_LEVEL } from './levels-data.js';
import { AudioEngine } from './audio.js';
import {
  renderer, scene, camera, underGlow,
  matTileBase, matTileFragile, matTileIce, matTileSwitch, matTileTp, matTileExit,
  matCube, matPrism, matMiniPrism, matPrismGlow, matBridge, matSwitchPillar,
  matCrate, matPressurePlate, matDanger, matShaker, matBooster,
  geoTile, geoThinTile, geoCube, geoPrism, geoRing, geoPillar, geoTrail,
  worldGroup, tilesGroup, prismsGroup, effectsGroup, bridgeGroup
} from './scene.js';
import { Level3D, MovingPlatform, convertTo3D, serializeLevel, deserializeLevel } from './level.js';

const audio = new AudioEngine();

/* ═══ GAME & EDITOR STATE ═══ */
let currentLevelIdx = 0;
let customLevels = []; // Array of Level3D loaded from LocalStorage
let activeLevel = null; // Current playing Level3D
let levelSnapshot = null; // Serialized pristine state, used for full reset on death/restart

let activeBlocks = new Map(); // key -> block representation
let activePrisms = new Map(); // key -> prism representation
let movingPlatformsList = [];
let ridingPlatform = null; // mover the player is currently locked onto (sticky)
let ridingOffset = new THREE.Vector3(); // fixed cube offset from the mover while riding
let switchMap = new Map(); // switchKey -> [targetKeys]
let teleporterMap = new Map(); // tpKey -> targetTpKey
let switchStates = new Map(); // key -> activeState

let playerGridPos = { x:0, y:0, z:0 };
let playerCube = null;
let exitPos = { x:0, y:0, z:0 };
let exitRing = null;

let isRolling = false;
let isBalancing = false;
let isTeleporting = false;
let isFalling = false;
let isLevelComplete = false;
let isMini = false;
let isCustomLevel = false;
let isHelpOpen = false;
// X-ray view (toggled with T): renders all blocks see-through so the player can
// reveal level structure hidden behind nearer geometry from the fixed camera.
let xrayMode = false;
const XRAY_OPACITY = 0.3;

// Pause + free orbit (toggled with P): freezes the game and lets the player
// orbit the camera 360° around the (centred) cube — drag to rotate, wheel or
// pinch to zoom. Works with mouse and touch.
let isPaused = false;
let pauseYaw = 0.72, pausePitch = 0.675, pauseZoom = 13.6;
const pausePointers = new Map(); // pointerId → {x,y} for drag + pinch
let pausePinchDist = null;

let balanceDir = null;
let balanceTimer = 0;
let lastMoveDir = { x:0, z:0 };
const keysPressed = {};
// Held-direction auto-repeat while playing: roll one cell every 300ms.
let repeatMoveCode = null;            // the movement key currently held for repeat
let repeatMoveDir = { x:0, z:0 };
let moveRepeatTimer = 0;
const MOVE_REPEAT_MS = 300;
let rollStartGridPos = { x:0, y:0, z:0 };
let boosterMovesActive = 0;
let moveCount = 0;
let gameTimer = 0;
let comboCount = 0;
let comboTimer = 0;
let elapsedTime = 0;
let miniTimer = 0;
let fallVelY = 0;

let cameraTarget = new THREE.Vector3(2, 0, 2);
let cameraLookAt = new THREE.Vector3(2, 0, 2);
let cameraShake = new THREE.Vector3();
let shakeIntensity = 0;

let animStartTime = 0;
let animStartPos = new THREE.Vector3();
let animEndPos = new THREE.Vector3();
let animStartQuat = new THREE.Quaternion();
let animDeltaQuat = new THREE.Quaternion();
let animAxis = new THREE.Vector3();
let animFromEdge = false;
// When a roll begins while riding a moving platform, the roll is anchored to
// that platform's frame: rollCarrier is the mover and rollCarrierStart its
// position at roll start, so the platform's motion during the roll is added on
// top of the (straight, platform-relative) roll.
let rollCarrier = null;
let rollCarrierStart = new THREE.Vector3();

const particles = [];
const trailParts = [];
let trailTimer = 0;

/* ═══ ENEMY STATE ═══ */
// Enemies are placed in the editor (Level3D.enemies) and may appear multiple
// times. Each live enemy is its own object so several can chase at once.
let enemies = [];              // live chasers spawned during gameplay/playtest
let enemyMarkers = new Map();  // key -> mesh, static markers shown in pure edit mode
const ENEMY_MOVE_INTERVAL = 0.38;

/* ═══ LIVES STATE ═══ */
let playerLives = 3;
const MAX_LIVES = 3;
let playerInvincible = false;
let playerInvincibleTimer = 0;
const PLAYER_INVINCIBLE_DURATION = 2.2;

/* ═══════════════════════════════════════════════════════════
   LEVEL EDITOR STATE
   ═══════════════════════════════════════════════════════════ */
let isEditMode = false;
let selectedTool = 'normal'; // normal, fragile, ice, switch, bridge, teleporter, moving, start, exit, prism, miniprism, linker, eraser
let editY = 0;
let editorGridHelper = null;
let editorGridPlane = null;
let editorGhostBlock = null;
let editorWiresGroup = null;
let sliceModeActive = true;
const rulerMinY = -3, rulerMaxY = 10;

let editorCameraTarget = new THREE.Vector3(0, 0, 0);
let editorCameraYaw = Math.PI/4;
let editorCameraPitch = 0.8; 
let editorCameraZoom = 15;
let isDraggingCamera = false;
let dragStartMouse = { x:0, y:0 };
let isPainting = false;
let rightDragMoved = false; // suppress erase-on-release after a camera drag

let linkerSourceKey = null; // Stored switch/tp for linking

// Compound objects: while "O" is held, every block placed is tagged with the
// same group id (stored in block.properties.group). Linking a switch/plate to
// any grouped block expands the trigger to all triggerable members.
let currentGroupId = null; // active group id while O is held, else null

// Editor undo history — serialized level snapshots, newest last (max 250).
let undoStack = [];
const UNDO_LIMIT = 250;

/* ═══════════════════════════════════════════════════════════
   CLEAR / BUILD LEVEL
   ═══════════════════════════════════════════════════════════ */
function clearLevel() {
  [tilesGroup, prismsGroup, effectsGroup, bridgeGroup].forEach(g => {
    while (g.children.length) {
      const c = g.children[g.children.length-1];
      if (c.material) c.material.dispose();
      c.children.forEach(ch => { if (ch.material) ch.material.dispose(); });
      g.remove(c);
    }
  });
  if (playerCube) { worldGroup.remove(playerCube); playerCube = null; }
  if (exitRing) { worldGroup.remove(exitRing); exitRing = null; }
  enemies.forEach(en => { worldGroup.remove(en.cube); if (en.cube.material) en.cube.material.dispose(); });
  enemies = [];
  enemyMarkers.clear(); // marker meshes live in prismsGroup, disposed by the group loop above
  particles.length = 0; trailParts.length = 0;

  movingPlatformsList.forEach(mp => mp.dispose());
  movingPlatformsList = [];
  ridingPlatform = null;
  rollCarrier = null;
  activeBlocks.clear();
  activePrisms.clear();
  switchMap.clear();
  teleporterMap.clear();
  switchStates.clear();
  linkerSourceKey = null;
  currentGroupId = null;
  // A rebuild (level change / restart) clears any active pause.
  if (isPaused) { isPaused = false; document.getElementById('pause-overlay')?.classList.remove('show'); }
  pausePointers.clear(); pausePinchDist = null;
}

function getPlayerWorldPos(gx, gy, gz, miniState) {
  const size = miniState ? CUBE_S * 0.5 : CUBE_S;
  return new THREE.Vector3(gx, gy + 0.5 + size/2, gz);
}

function buildLevel3D(level3D) {
  clearLevel();
  activeLevel = level3D;
  levelSnapshot = serializeLevel(level3D);
  const world = WORLDS[level3D.world];

  scene.background = new THREE.Color(world.bg);
  // No fog while editing — zooming out shouldn't darken the level. Fog is kept
  // for normal play and playtesting.
  scene.fog = (isEditMode && !isPlaytesting) ? null : new THREE.Fog(world.bg, 12, 38);
  audio.startAmbient(level3D.world);

  // Parse Level Configs (everything starts active; link targets are switched off below)
  level3D.blocks.forEach((b, k) => {
    activeBlocks.set(k, { ...b, broken: false, active: true });
  });
  level3D.prisms.forEach((p, k) => {
    activePrisms.set(k, { ...p, collected: false });
  });

  level3D.links.forEach(l => {
    if (l.type === 'switch-trigger') {
      if (!switchMap.has(l.from)) switchMap.set(l.from, []);
      switchMap.get(l.from).push(l.to);
      const target = activeBlocks.get(l.to);
      // Triggered bridges/platforms start off until their switch activates them
      if (target && (target.type === 'bridge' || target.type === 'moving')) target.active = false;
    } else if (l.type === 'teleporter-link') {
      teleporterMap.set(l.k1, l.k2);
      teleporterMap.set(l.k2, l.k1);
    }
  });

  // Render Blocks
  activeBlocks.forEach((block, key) => {
    if (block.type === 'moving') {
      const mp = new MovingPlatform(
        key, block.x, block.y, block.z,
        block.properties.targetX ?? block.x, block.properties.targetY ?? block.y, block.properties.targetZ ?? block.z,
        block.properties.speed ?? 1.5, block.active !== false
      );
      movingPlatformsList.push(mp);
      block.platformInstance = mp;
      return;
    }
    createBlockMesh(block, key);
  });

  // Compound objects: a moving block tagged with a group id drives the whole
  // object. Every other member of that group rides along as a passenger so the
  // entire structure translates together — not just the single moving tile.
  const groupMembers = new Map();
  activeBlocks.forEach(b => {
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
  activePrisms.forEach((p, key) => createPrismMesh(key, p));

  // Goal exit
  exitPos = { ...level3D.exit };
  exitRing = new THREE.Mesh(geoRing, new THREE.MeshStandardMaterial({
    color:'#00ffaa', roughness:0.15, metalness:0.4, emissive:'#00ff88', emissiveIntensity:1.2,
  }));
  exitRing.rotation.x = -Math.PI/2;
  exitRing.position.set(exitPos.x, exitPos.y + 0.5, exitPos.z);
  exitRing.scale.set(0.01, 0.01, 0.01);
  worldGroup.add(exitRing);

  // Player cube
  playerGridPos = { ...level3D.start };
  isMini = false; miniTimer = 0;
  playerCube = new THREE.Mesh(geoCube, matCube.clone());
  playerCube.position.copy(getPlayerWorldPos(playerGridPos.x, playerGridPos.y, playerGridPos.z, false));
  playerCube.castShadow = true; playerCube.receiveShadow = true;
  worldGroup.add(playerCube);

  // Enemies – placed in the editor. During gameplay/playtest each spawn point
  // becomes a live chaser; in pure edit mode we show a static marker instead.
  if (!isEditMode || isPlaytesting) {
    if (level3D.enemies.size > 0) {
      level3D.enemies.forEach((e, key) => spawnEnemy(key));
    } else if (!isCustomLevel && !isEditMode) {
      // Built-in campaign levels predate enemy placement — keep their original
      // single auto-spawned chaser at the most distant reachable cell.
      spawnEnemy(findEnemySpawnKey());
    }
  } else {
    level3D.enemies.forEach((e, key) => createEnemyMarker(key));
  }
  playerInvincible = false;
  playerInvincibleTimer = 0;

  cameraTarget.copy(playerCube.position);
  cameraLookAt.copy(playerCube.position);

  moveCount = 0; elapsedTime = 0; gameTimer = 0; comboCount = 0; comboTimer = 0;
  isRolling = false; isBalancing = false; isTeleporting = false; isFalling = false; isLevelComplete = false;

  document.getElementById('world-name').textContent = world.name.toUpperCase();
  document.getElementById('level-name').textContent = level3D.name;
  document.getElementById('level-number').textContent = isEditMode ? 'E' : (isCustomLevel ? 'C' : currentLevelIdx + 1);
  updatePrismUI(); updateMoveUI(); updateTimerUI();
  document.getElementById('mini-hud-bar').style.display = 'none';

  spawnEntranceParticles(playerGridPos.x, playerGridPos.y, playerGridPos.z);
  updatePressurePlates();
  updateLivesUI();
  updateEditorSlicing();
}

function createBlockMesh(block, key) {
  const { x, y, z, type, active } = block;
  const isInactiveBridge = type === 'bridge' && !active;
  // Inactive bridges are hidden in play, but shown as ghosts in the editor
  // so they can be selected and linked.
  if (isInactiveBridge && (!isEditMode || isPlaytesting)) return;

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

  const isExit = (x === exitPos.x && y === exitPos.y && z === exitPos.z);
  if (isExit) mat = matTileExit;

  // Thin bridge visual
  const geo = type === 'bridge' ? geoThinTile : geoTile;
  const mesh = new THREE.Mesh(geo, mat.clone());
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

  const line = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color:eColor, transparent:true, opacity:0.35 }));
  mesh.add(line);
  if (isInactiveBridge) {
    mesh.material.transparent = true;
    mesh.material.opacity = 0.18;
  }
  tilesGroup.add(mesh);
  block.mesh = mesh;

  // Switch pillar
  if (type === 'switch') {
    const pillar = new THREE.Mesh(geoPillar, matSwitchPillar.clone());
    pillar.position.set(0, 0.5 + 0.17, 0);
    pillar.castShadow = true;
    mesh.add(pillar);
    block.pillar = pillar;
  }

  // Pressure plate button visual
  if (type === 'pressureplate') {
    const plateGeo = new THREE.BoxGeometry(0.8, 0.05, 0.8);
    const plate = new THREE.Mesh(plateGeo, new THREE.MeshStandardMaterial({ color:'#3366ff', roughness:0.2, metalness:0.3, emissive:'#3366ff', emissiveIntensity:0.5 }));
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
        const spike = new THREE.Mesh(spikeGeo, new THREE.MeshStandardMaterial({ color:'#ff3355', roughness:0.5, metalness:0.1, emissive:'#ff3355', emissiveIntensity:1.0 }));
        spike.position.set(i*0.25, 0.5 + 0.14, j*0.25);
        spike.castShadow = true;
        mesh.add(spike);
      }
    }
  }

  // Booster arrow visual
  if (type === 'booster') {
    const arrowGeo = new THREE.ConeGeometry(0.25, 0.5, 4);
    const arrow = new THREE.Mesh(arrowGeo, new THREE.MeshStandardMaterial({ color:'#ffcc00', roughness:0.1, metalness:0.1, emissive:'#ffcc00', emissiveIntensity:1.5 }));
    arrow.rotation.x = Math.PI/2;
    arrow.position.set(0, 0.5 + 0.05, 0);
    mesh.add(arrow);
  }
}

function createPrismMesh(key, p) {
  const [px, py, pz] = key.split(',').map(Number);
  const isMiniPrism = p.type === 'miniprism';
  const mesh = new THREE.Mesh(geoPrism, isMiniPrism ? matMiniPrism.clone() : matPrism.clone());
  if (isMiniPrism) mesh.scale.set(0.6, 0.6, 0.6);
  mesh.position.set(px, py + 0.55, pz);
  mesh.castShadow = true;
  mesh.userData = { key, type: isMiniPrism ? 'miniprism' : 'prism', isMiniPrism, baseY: py + 0.55 };
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
  enemies.push({
    cube,
    grid: { x, y, z },
    isRolling: false,
    animStartTime: 0,
    animStartPos: new THREE.Vector3(),
    animEndPos: new THREE.Vector3(),
    animStartQuat: new THREE.Quaternion(),
    animDeltaQuat: new THREE.Quaternion(),
    moveTimer: 1.5,                 // brief head start before the chase begins
    hue: Math.random()             // desync the rainbow cycle between enemies
  });
}

// A static editor marker so the designer can see/erase placed enemies. Kept
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
  enemyMarkers.set(key, mesh);
}

/* ═══════════════════════════════════════════════════════════
   PARTICLES & EFFECTS
   ═══════════════════════════════════════════════════════════ */
function spawnEntranceParticles(gx, gy, gz) {
  const pos = getPlayerWorldPos(gx, gy, gz, false);
  for (let i=0;i<20;i++) {
    const mat = new THREE.MeshBasicMaterial({ color:'#ff8844', transparent:true, opacity:1 });
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.03,4,4), mat);
    p.position.copy(pos);
    p.position.x += (Math.random()-0.5)*0.6;
    p.position.z += (Math.random()-0.5)*0.6;
    p.userData = { vel:new THREE.Vector3((Math.random()-0.5)*2, Math.random()*3+1, (Math.random()-0.5)*2), life:0.6+Math.random()*0.5, age:0 };
    effectsGroup.add(p); particles.push(p);
  }
}

function spawnCollectParticles(wPos) {
  for (let i=0;i<14;i++) {
    const mat = new THREE.MeshBasicMaterial({ color:'#ffdd44', transparent:true, opacity:1 });
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.04,4,4), mat);
    p.position.copy(wPos);
    p.userData = { vel:new THREE.Vector3((Math.random()-0.5)*3, Math.random()*4+1.5, (Math.random()-0.5)*3), life:0.5+Math.random()*0.4, age:0 };
    effectsGroup.add(p); particles.push(p);
  }
}

function spawnBreakParticles(gx, gy, gz) {
  const pos = new THREE.Vector3(gx, gy, gz);
  for (let i=0;i<16;i++) {
    const mat = new THREE.MeshBasicMaterial({ color:'#884444', transparent:true, opacity:1 });
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.08+Math.random()*0.1, 0.06, 0.08+Math.random()*0.1), mat);
    p.position.copy(pos);
    p.position.x += (Math.random()-0.5)*0.5;
    p.position.z += (Math.random()-0.5)*0.5;
    p.userData = { vel:new THREE.Vector3((Math.random()-0.5)*2.5, Math.random()*2.5+0.5, (Math.random()-0.5)*2.5), life:0.5+Math.random()*0.6, age:0 };
    effectsGroup.add(p); particles.push(p);
  }
}

function spawnLandingParticles(gx, gy, gz) {
  const pos = new THREE.Vector3(gx, gy + 0.5, gz);
  for (let i=0;i<12;i++) {
    const mat = new THREE.MeshBasicMaterial({ color:'#ffffff', transparent:true, opacity:0.8 });
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.03,4,4), mat);
    p.position.copy(pos);
    p.userData = { vel:new THREE.Vector3((Math.random()-0.5)*3, Math.random()*2+1, (Math.random()-0.5)*3), life:0.4+Math.random()*0.3, age:0 };
    effectsGroup.add(p); particles.push(p);
  }
}

function spawnTeleportParticles(gx, gy, gz) {
  const pos = new THREE.Vector3(gx, gy + 0.5, gz);
  for (let i=0;i<20;i++) {
    const mat = new THREE.MeshBasicMaterial({ color:'#9966ff', transparent:true, opacity:1 });
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.04,4,4), mat);
    p.position.copy(pos);
    p.userData = { vel:new THREE.Vector3((Math.random()-0.5)*4, Math.random()*3+2, (Math.random()-0.5)*4), life:0.3+Math.random()*0.4, age:0 };
    effectsGroup.add(p); particles.push(p);
  }
}

function spawnTrailParticle() {
  if (!playerCube) return;
  const p = new THREE.Mesh(geoTrail, new THREE.MeshBasicMaterial({ color:'#ff8844', transparent:true, opacity:0.5 }));
  p.position.copy(playerCube.position);
  p.userData = { life:0.3, age:0 };
  effectsGroup.add(p); trailParts.push(p);
}

function addShake(intensity) { shakeIntensity = Math.max(shakeIntensity, intensity); }
function flashScreen(color) {
  const flash = document.getElementById('fall-flash');
  flash.style.background = `radial-gradient(circle, ${color} 0%, transparent 60%)`;
  flash.classList.add('active');
  setTimeout(() => flash.classList.remove('active'), 140);
}

/* ═══════════════════════════════════════════════════════════
   UI CONTROLS
   ═══════════════════════════════════════════════════════════ */
function updatePrismUI() {
  let collect = 0; let total = 0;
  activePrisms.forEach(p => {
    if (p.type !== 'miniprism') {
      total++; if (p.collected) collect++;
    }
  });
  document.getElementById('prism-count').textContent = `${collect}/${total}`;
}
function updateMoveUI() { document.getElementById('move-counter').textContent = `${moveCount} move${moveCount!==1?'s':''}`; }
function updateTimerUI() {
  const mins = Math.floor(elapsedTime / 60);
  const secs = Math.floor(elapsedTime % 60);
  document.getElementById('timer-display').textContent = `${mins}:${String(secs).padStart(2,'0')}`;
}
function updateComboUI() {
  const el = document.getElementById('combo-count');
  const lbl = document.getElementById('combo-label');
  if (comboCount >= 3) {
    el.textContent = `x${comboCount}`;
    el.classList.add('active'); lbl.classList.add('active');
  } else {
    el.classList.remove('active'); lbl.classList.remove('active');
  }
}
function showMessage(text, dur=2) {
  const el = document.getElementById('message');
  el.textContent = text; el.classList.add('visible');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('visible'), dur*1000);
}

/* ═══════════════════════════════════════════════════════════
   GRID COLUMNS & PHYSICS
   ═══════════════════════════════════════════════════════════ */
function getBlocksInColumn(gx, gz) {
  const list = [];
  activeBlocks.forEach((block, key) => {
    // Moving drivers and compound-object passengers have dynamic positions —
    // they are reported from the platform loop below, not their static cell.
    if (block.type === 'moving' || block.isPassenger) return;
    if (block.x === gx && block.z === gz && block.active && !block.broken) {
      list.push(block);
    }
  });
  // Check moving platforms (driver tile + any carried passengers)
  movingPlatformsList.forEach(mp => {
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
  if (isRolling || isFalling || isTeleporting) return null;
  // If player stands exactly on a moving platform — its driver tile or any
  // passenger cell of a compound object.
  for (const mp of movingPlatformsList) {
    if (mp.isPassenger) continue;
    const mpgx = Math.round(mp.position.x);
    const mpgy = Math.round(mp.position.y);
    const mpgz = Math.round(mp.position.z);
    if (playerGridPos.x === mpgx && playerGridPos.z === mpgz && playerGridPos.y === mpgy) {
      return mp;
    }
    for (const m of mp.members) {
      const cx = Math.round(mp.position.x + m.gridOffset.x);
      const cy = Math.round(mp.position.y + m.gridOffset.y);
      const cz = Math.round(mp.position.z + m.gridOffset.z);
      if (playerGridPos.x === cx && playerGridPos.z === cz && playerGridPos.y === cy) {
        return mp;
      }
    }
  }
  return null;
}

// If a moving block is advancing into the player's cell (same level, player not
// riding it), the block shoves the player along its travel direction.
function checkPushedByPlatform() {
  if (isRolling || isFalling || isTeleporting || isBalancing) return null;
  for (const mp of movingPlatformsList) {
    if (mp.isPassenger || !mp.active) continue;
    if (mp.moveDir.x === 0 && mp.moveDir.y === 0 && mp.moveDir.z === 0) continue;
    const tc = mp.targetCell;
    if (playerGridPos.x === Math.round(tc.x) &&
        playerGridPos.y === Math.round(tc.y) &&
        playerGridPos.z === Math.round(tc.z)) {
      return mp;
    }
  }
  return null;
}

function enterBalancing() {
  isBalancing = true;
  balanceTimer = 1.5;
  audio.playBalanceStart();
  showMessage('GOOSE HANGING! HOLD KEY OR ROLL BACK', 1.2);

  // Position at midpoint of the roll
  const midPos = new THREE.Vector3().addVectors(animStartPos, animEndPos).multiplyScalar(0.5);
  midPos.y += CUBE_S * 0.15; // sit on the edge
  playerCube.position.copy(midPos);

  const midQuat = animStartQuat.clone();
  midQuat.slerp(new THREE.Quaternion().multiplyQuaternions(animDeltaQuat, animStartQuat), 0.5);
  playerCube.quaternion.copy(midQuat);
}

function executePush(block, toX, toY, toZ, dirX, dirZ) {
  const oldKey = `${block.x},${block.y},${block.z}`;
  
  // Find landing height
  const colBlocks = getBlocksInColumn(toX, toZ);
  const landing = colBlocks.find(b => b.y < toY);
  const finalY = landing ? landing.y + 1 : -10;

  activeBlocks.delete(oldKey);
  activeLevel.blocks.delete(oldKey);
  const newKey = `${toX},${finalY},${toZ}`;
  
  block.x = toX;
  block.y = finalY;
  block.z = toZ;
  
  if (finalY > -5) {
    activeBlocks.set(newKey, block);
    activeLevel.blocks.set(newKey, { x: toX, y: finalY, z: toZ, type: 'pushable', properties: block.properties || {} });
  }

  const mesh = block.mesh;
  if (mesh) {
    mesh.userData.key = newKey; // Update mesh key!
    const startPos = mesh.position.clone();
    const endPos = new THREE.Vector3(toX, toY, toZ);
    const finalPos = new THREE.Vector3(toX, finalY, toZ);
    
    const slideDur = 0.15;
    const startTime = performance.now()/1000;
    audio.playIce();
    
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
                audio.playLand();
                spawnLandingParticles(toX, finalY, toZ);
                updatePressurePlates();
              } else {
                tilesGroup.remove(mesh);
                if (mesh.material) mesh.material.dispose();
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
  activeBlocks.forEach((block, key) => {
    if (block.type === 'pressureplate') {
      const playerOnIt = (playerGridPos.x === block.x && playerGridPos.y === block.y && playerGridPos.z === block.z && !isRolling && !isFalling && !isTeleporting);
      let blockOnIt = false;
      activeBlocks.forEach(b => {
        // A crate resting ON the plate sits one cell above it
        if (b.type === 'pushable' && b.x === block.x && b.y === block.y + 1 && b.z === block.z) {
          blockOnIt = true;
        }
      });

      const shouldBeActive = playerOnIt || blockOnIt;
      const isCurrentlyActive = switchStates.get(key) || false;

      if (shouldBeActive !== isCurrentlyActive) {
        switchStates.set(key, shouldBeActive);
        audio.playSwitch();
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
  const targets = switchMap.get(key);
  if (!targets) return;

  targets.forEach(tk => {
    const block = activeBlocks.get(tk);
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
              if (mesh.material) mesh.material.dispose();
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
  isBalancing = false;
  audio.playBalanceStop();
  audio.playRoll();

  playerGridPos = { ...rollStartGridPos };
  isRolling = true;
  animStartTime = performance.now()/1000;
  animStartPos.copy(playerCube.position);
  animEndPos.copy(getPlayerWorldPos(playerGridPos.x, playerGridPos.y, playerGridPos.z, isMini));
  animStartQuat.copy(playerCube.quaternion);
  
  animAxis.negate();
  animDeltaQuat.setFromAxisAngle(animAxis, Math.PI/4); // 45 degrees back
  playerCube.userData.rollAction = 'roll-back';
}

function triggerShakerCrumble(block, key) {
  const originalPos = block.mesh.position.clone();
  audio.playIce(); // shaking crack sound
  
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
      if (playerGridPos.x === block.x && playerGridPos.y === block.y && playerGridPos.z === block.z) {
        const landing = getBlocksInColumn(block.x, block.z).find(b => b.y < playerGridPos.y);
        isFalling = true;
        fallVelY = 0;
        playerCube.userData.fallTargetY = landing ? landing.y : -10;
      }
    }
  }, 600);
}

/* ═══════════════════════════════════════════════════════════
   ROLLING PHYSICS
   ═══════════════════════════════════════════════════════════ */
function isLastMoveKeyHeld() {
  if (lastMoveDir.x === 1) return keysPressed['ArrowRight'] || keysPressed['KeyD'];
  if (lastMoveDir.x === -1) return keysPressed['ArrowLeft'] || keysPressed['KeyA'];
  if (lastMoveDir.z === 1) return keysPressed['ArrowDown'] || keysPressed['KeyS'];
  if (lastMoveDir.z === -1) return keysPressed['ArrowUp'] || keysPressed['KeyW'];
  return false;
}

function startRoll(dirX, dirZ) {
  if (isRolling || isTeleporting || isLevelComplete || isFalling || isBalancing) return;
  if (!audio.ready) audio.init();

  const toGX = playerGridPos.x + dirX;
  const toGZ = playerGridPos.z + dirZ;
  const colBlocks = getBlocksInColumn(toGX, toGZ);

  // Crate occupying the cell the player would roll into (resting one above
  // the player's support level, like the player itself does)
  const crate = colBlocks.find(b => b.y === playerGridPos.y + 1 && b.type === 'pushable' && !b.broken);
  if (crate) {
    const pushToX = toGX + dirX;
    const pushToZ = toGZ + dirZ;
    const pushCol = getBlocksInColumn(pushToX, pushToZ);
    const pushObstructed = pushCol.some(b => b.y >= crate.y);
    const floorUnderCrate = colBlocks.find(b => b.y === playerGridPos.y);
    if (!pushObstructed && floorUnderCrate) {
      executePush(crate, pushToX, crate.y, pushToZ, dirX, dirZ);
      executeRoll(toGX, playerGridPos.y, toGZ, dirX, dirZ, 'roll');
      return;
    }
    // Blocked push: the crate acts like a wall/step (handled below)
  }

  // Ceilings directly above player
  const ceilingCurrent = getBlocksInColumn(playerGridPos.x, playerGridPos.z).find(b => b.y === playerGridPos.y + 1);

  // Find blocks at same height, up one, down one
  const sameLevel = colBlocks.find(b => b.y === playerGridPos.y);
  const stepUp = colBlocks.find(b => b.y === playerGridPos.y + 1);
  const stepDown = colBlocks.find(b => b.y === playerGridPos.y - 1);

  let targetY = playerGridPos.y;
  let action = 'roll'; // roll, climb, descend, fall, void, blocked

  if (isMini && stepUp && stepUp.type !== 'bridge') {
    // Mini-cube vertical wall climb: only when a normal climb is impossible
    // (the wall continues at least two cells high) — climbs the face one
    // cell per move while staying in place.
    const aboveTwo = colBlocks.find(b => b.y === playerGridPos.y + 2);
    if (aboveTwo && !ceilingCurrent) {
      action = 'wall-climb';
      targetY = playerGridPos.y + 1;
    }
  }

  if (action !== 'wall-climb') {
    if (isMini && sameLevel && stepUp && stepUp.type === 'bridge') {
      // Mini cube squeezes under bridges instead of climbing onto them
      targetY = playerGridPos.y; action = 'roll';
    } else if (stepUp) {
      const stepUpCeiling = colBlocks.find(b => b.y === playerGridPos.y + 2);
      if (!stepUpCeiling && !ceilingCurrent) {
        targetY = playerGridPos.y + 1; action = 'climb';
      } else {
        action = 'blocked';
      }
    } else if (sameLevel) {
      const ceilingTarget = colBlocks.find(b => b.y === playerGridPos.y + 1);
      if (!ceilingTarget) {
        targetY = playerGridPos.y; action = 'roll';
      } else if (isMini && ceilingTarget.type === 'bridge') {
        targetY = playerGridPos.y; action = 'roll'; // Squeeze under bridge
      } else {
        action = 'blocked';
      }
    } else if (stepDown) {
      const stepDownCeiling = colBlocks.find(b => b.y === playerGridPos.y);
      if (!stepDownCeiling) {
        targetY = playerGridPos.y - 1; action = 'descend';
      } else {
        action = 'blocked';
      }
    } else {
      // Empty target column
      const landing = colBlocks.find(b => b.y < playerGridPos.y);
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
  isRolling = true;
  rollStartGridPos = { ...playerGridPos };
  animStartTime = performance.now()/1000;
  animStartPos.copy(playerCube.position);

  const isWall = action === 'wall-climb';
  const visualTargetY = isWall ? playerGridPos.y + 1 : (action === 'fall' || action === 'void' ? playerGridPos.y : targetY);

  animEndPos.copy(getPlayerWorldPos(isWall ? playerGridPos.x : toGX, visualTargetY, isWall ? playerGridPos.z : toGZ, isMini));
  animStartQuat.copy(playerCube.quaternion);

  const axis = new THREE.Vector3(dirZ, 0, -dirX).normalize();
  animAxis.copy(axis);
  animDeltaQuat.setFromAxisAngle(axis, Math.PI/2);
  animFromEdge = false;

  // Platform-relative roll: when the player rides a mover (and isn't leaving it
  // downward), anchor the roll to the platform's frame. The player sits at a
  // possibly fractional world position mid-step, so snapping the target to an
  // integer cell would bend the path diagonally. Instead the target is exactly
  // one cell from the start, and the platform's own motion is added during the
  // animation — so a forward press always rolls straight relative to the deck.
  rollCarrier = (ridingPlatform && !isWall && action !== 'fall' && action !== 'void') ? ridingPlatform : null;
  if (rollCarrier) {
    rollCarrierStart.copy(rollCarrier.position);
    animEndPos.x = animStartPos.x + dirX;
    animEndPos.z = animStartPos.z + dirZ;
  }

  const prevKey = `${playerGridPos.x},${playerGridPos.y},${playerGridPos.z}`;
  playerGridPos.x = isWall ? playerGridPos.x : toGX;
  playerGridPos.y = visualTargetY;
  playerGridPos.z = isWall ? playerGridPos.z : toGZ;

  moveCount++; updateMoveUI();

  // Combo
  const sameDir = (dirX === lastMoveDir.x && dirZ === lastMoveDir.z);
  if (sameDir && comboTimer > 0) comboCount++; else comboCount = 1;
  comboTimer = COMBO_TIMEOUT;
  lastMoveDir = { x:dirX, z:dirZ };
  updateComboUI();

  // Audio
  const currKey = `${playerGridPos.x},${playerGridPos.y},${playerGridPos.z}`;
  const block = activeBlocks.get(currKey);
  if (block && block.type === 'ice') audio.playIce(); else audio.playRoll();

  // Break fragile block
  const prevBlock = activeBlocks.get(prevKey);
  if (prevBlock && prevBlock.type === 'fragile') {
    breakFragileBlock(prevKey);
  }

  // Next steps on complete
  playerCube.userData.rollAction = action;
  playerCube.userData.targetLandingY = targetY;
}

function onRollComplete() {
  const action = playerCube.userData.rollAction;
  const targetY = playerCube.userData.targetLandingY;

  const key = `${playerGridPos.x},${playerGridPos.y},${playerGridPos.z}`;

  if (action === 'roll-back') {
    playerCube.quaternion.identity();
    isRolling = false;
    return;
  }

  if (action === 'fall' || action === 'void') {
    // Initiate falling animation or check edge balancing!
    if (isLastMoveKeyHeld()) {
      enterBalancing();
      return;
    }
    isFalling = true;
    fallVelY = 0;
    playerCube.userData.fallTargetY = targetY;
    return;
  }

  if (boosterMovesActive > 0) {
    boosterMovesActive--;
    if (boosterMovesActive === 0) {
      showMessage('SPEED BOOST EXPIRED', 1.0);
    }
  }

  // Switched/Collected checks
  checkPrismCollection(playerGridPos.x, playerGridPos.y, playerGridPos.z);

  const block = activeBlocks.get(key);
  if (block) {
    if (block.type === 'switch') triggerSwitch(key);
    if (block.type === 'teleporter') triggerTeleport(key);
    
    // Danger block death
    if (block.type === 'danger') {
      audio.playFall();
      respawnPlayer();
      return;
    }
    
    // Booster speed activation
    if (block.type === 'booster') {
      boosterMovesActive = 4;
      showMessage('SPEED BOOST ACTIVE (4 MOVES)!', 1.5);
      audio.playCollect();
    }
    
    // Shaker block crumble trigger
    if (block.type === 'shaker' && !block.broken) {
      triggerShakerCrumble(block, key);
    }
  }

  if (playerGridPos.x === exitPos.x && playerGridPos.y === exitPos.y && playerGridPos.z === exitPos.z) {
    checkLevelComplete();
  }

  // Ice sliding
  if (block && block.type === 'ice' && !isLevelComplete) {
    setTimeout(() => {
      if (!isRolling && !isFalling && !isLevelComplete) {
        startRoll(lastMoveDir.x, lastMoveDir.z);
      }
    }, 60);
  }
}

/* ═══════════════════════════════════════════════════════════
   SPECIAL BLOCKS LOGIC
   ═══════════════════════════════════════════════════════════ */
function breakFragileBlock(key) {
  const block = activeBlocks.get(key);
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
        if (mesh.material) mesh.material.dispose();
      }
    };
    shrink();
  }
}

function triggerSwitch(key) {
  const targets = switchMap.get(key);
  if (!targets) return;

  const activeState = !(switchStates.get(key) || false);
  switchStates.set(key, activeState);
  audio.playSwitch();
  addShake(0.12);

  const sw = activeBlocks.get(key);
  if (sw && sw.pillar) {
    sw.pillar.material.emissive.set(activeState ? '#00ff88' : '#4466cc');
  }

  targets.forEach(tk => {
    const block = activeBlocks.get(tk);
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
              if (mesh.material) mesh.material.dispose();
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
  const destKey = teleporterMap.get(key);
  if (!destKey) return;
  const destBlock = activeBlocks.get(destKey);
  if (!destBlock || !destBlock.active) return;

  const [dx, dy, dz] = destKey.split(',').map(Number);
  isTeleporting = true;
  audio.playTeleport();
  spawnTeleportParticles(playerGridPos.x, playerGridPos.y, playerGridPos.z);

  const fadeOut = () => {
    playerCube.scale.multiplyScalar(0.7);
    if (playerCube.scale.x > 0.05) requestAnimationFrame(fadeOut);
    else {
      playerGridPos.x = dx; playerGridPos.y = dy; playerGridPos.z = dz;
      playerCube.position.copy(getPlayerWorldPos(dx, dy, dz, isMini));
      playerCube.quaternion.identity();
      spawnTeleportParticles(dx, dy, dz);

      const fadeIn = () => {
        playerCube.scale.lerp(new THREE.Vector3(1,1,1), 0.3);
        if (playerCube.scale.x < 0.95) requestAnimationFrame(fadeIn);
        else {
          playerCube.scale.set(1,1,1); isTeleporting = false;
          checkPrismCollection(dx, dy, dz);
          if (dx === exitPos.x && dy === exitPos.y && dz === exitPos.z) checkLevelComplete();
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
  const prism = activePrisms.get(key);
  if (prism && !prism.collected) {
    prism.collected = true;
    audio.playCollect();
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

function activateMiniCube() {
  if (isMini) {
    miniTimer = 15; audio.playShrink(); return;
  }
  isMini = true; miniTimer = 15;
  audio.playShrink();
  showMessage('MINI CUBE! SPEED + CLIMBING', 2);
  document.getElementById('mini-hud-bar').style.display = 'block';

  const shrink = () => {
    if (!isMini) return;
    playerCube.scale.lerp(new THREE.Vector3(0.5,0.5,0.5), 0.25);
    if (playerCube.scale.x > 0.51) requestAnimationFrame(shrink);
    else playerCube.scale.set(0.5,0.5,0.5);
  };
  shrink();
}

function checkGrowBack() {
  // Check ceiling above
  const ceiling = getBlocksInColumn(playerGridPos.x, playerGridPos.z).find(b => b.y === playerGridPos.y + 1);
  if (ceiling) {
    miniTimer = 0.5; // check again in 0.5s
    showMessage('TIGHT SPACE - CANNOT GROW!', 1);
    return;
  }
  isMini = false;
  audio.playGrow();
  showMessage('RESTORED SIZE', 1.5);
  document.getElementById('mini-hud-bar').style.display = 'none';

  const grow = () => {
    if (isMini) return;
    playerCube.scale.lerp(new THREE.Vector3(1,1,1), 0.25);
    if (playerCube.scale.x < 0.99) requestAnimationFrame(grow);
    else playerCube.scale.set(1,1,1);
  };
  grow();
}

/* ═══════════════════════════════════════════════════════════
   LEVEL END & COMPLETION
   ═══════════════════════════════════════════════════════════ */
function checkLevelComplete() {
  let remaining = 0;
  activePrisms.forEach(p => {
    if (p.type !== 'miniprism' && !p.collected) remaining++;
  });
  if (remaining === 0) {
    completeLevel();
  }
}

function completeLevel() {
  isLevelComplete = true;
  audio.playComplete();

  const stars = moveCount <= activeLevel.par ? 3 : (moveCount <= activeLevel.par * 1.5 ? 2 : 1);
  document.getElementById('complete-overlay').classList.add('show');
  document.getElementById('complete-text').textContent = isEditMode ? 'PLAYTEST COMPLETE' : `LEVEL ${currentLevelIdx+1} CLEAR`;
  document.getElementById('star1').classList.toggle('earned', stars >= 1);
  document.getElementById('star2').classList.toggle('earned', stars >= 2);
  document.getElementById('star3').classList.toggle('earned', stars >= 3);

  setTimeout(() => {
    document.getElementById('complete-overlay').classList.remove('show');
    if (isEditMode) {
      exitPlaytestMode();
    } else {
      currentLevelIdx = (currentLevelIdx + 1) % LEVELS.length;
      loadPreMadeLevel(currentLevelIdx);
    }
  }, 2500);
}

function respawnPlayer() {
  audio.playRespawn();
  addShake(0.3);
  flashScreen('#ff3355');

  // Full level reset from the pristine snapshot — restores broken fragile/
  // shaker blocks, pushed crates, switch states and prisms (no softlocks).
  if (levelSnapshot) {
    activeLevel = deserializeLevel(levelSnapshot);
    buildLevel3D(activeLevel);
  }
  showMessage('LEVEL RESTART', 1.2);
}

function generateAILabyrinth() {
  const width = 41;
  const depth = 41;
  const targetBlocksCount = 800;
  
  const lvl = new Level3D();
  lvl.name = "Goose Labyrinth";
  lvl.world = Math.floor(Math.random() * 5);
  
  const maze = [];
  for (let x = 0; x < width; x++) {
    maze[x] = [];
    for (let z = 0; z < depth; z++) {
      maze[x][z] = { visited: false, active: false };
    }
  }
  
  const stack = [];
  const startX = 1, startZ = 1;
  maze[startX][startZ].visited = true;
  maze[startX][startZ].active = true;
  stack.push({ x: startX, z: startZ });
  
  const cells = [{ x: startX, z: startZ }];
  const allPathBlocks = new Set();
  allPathBlocks.add(`${startX},${startZ}`);
  
  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const neighbors = [];
    
    const dirs = [
      { dx: 2, dz: 0 },
      { dx: -2, dz: 0 },
      { dx: 0, dz: 2 },
      { dx: 0, dz: -2 }
    ];
    
    dirs.forEach(d => {
      const nx = current.x + d.dx;
      const nz = current.z + d.dz;
      if (nx > 0 && nx < width - 1 && nz > 0 && nz < depth - 1) {
        if (!maze[nx][nz].visited) {
          neighbors.push({ x: nx, z: nz });
        }
      }
    });
    
    if (neighbors.length > 0) {
      const next = neighbors[Math.floor(Math.random() * neighbors.length)];
      
      maze[next.x][next.z].visited = true;
      maze[next.x][next.z].active = true;
      cells.push({ x: next.x, z: next.z });
      allPathBlocks.add(`${next.x},${next.z}`);
      
      const cx = (current.x + next.x) / 2;
      const cz = (current.z + next.z) / 2;
      maze[cx][cz].visited = true;
      maze[cx][cz].active = true;
      cells.push({ x: cx, z: cz });
      allPathBlocks.add(`${cx},${cz}`);
      
      stack.push(next);
    } else {
      stack.pop();
    }
  }
  
  // Ensure exactly 800 blocks
  let currentBlocks = Array.from(allPathBlocks).map(s => {
    const [x, z] = s.split(',').map(Number);
    return { x, z };
  });
  
  while (currentBlocks.length < targetBlocksCount) {
    const base = currentBlocks[Math.floor(Math.random() * currentBlocks.length)];
    const dirs = [{dx:1,dz:0},{dx:-1,dz:0},{dx:0,dz:1},{dx:0,dz:-1}];
    const d = dirs[Math.floor(Math.random() * dirs.length)];
    const nx = base.x + d.dx;
    const nz = base.z + d.dz;
    if (nx > 0 && nx < width - 1 && nz > 0 && nz < depth - 1) {
      const key = `${nx},${nz}`;
      if (!allPathBlocks.has(key)) {
        allPathBlocks.add(key);
        maze[nx][nz].active = true;
        currentBlocks.push({ x: nx, z: nz });
      }
    }
  }
  
  let exitCell = cells[0];
  let maxDist = 0;
  cells.forEach(c => {
    const dist = Math.abs(c.x - startX) + Math.abs(c.z - startZ);
    if (dist > maxDist) {
      maxDist = dist;
      exitCell = c;
    }
  });
  
  lvl.start = { x: startX, y: 0, z: startZ };
  lvl.exit = { x: exitCell.x, y: 0, z: exitCell.z };
  lvl.par = Math.round(currentBlocks.length * 0.5);
  
  currentBlocks.forEach(b => {
    const key = `${b.x},0,${b.z}`;
    const isStart = (b.x === startX && b.z === startZ);
    const isExit = (b.x === exitCell.x && b.z === exitCell.z);
    
    let type = 'normal';
    if (!isStart && !isExit && Math.random() < 0.22) {
      type = 'shaker';
    }
    
    lvl.blocks.set(key, { x: b.x, y: 0, z: b.z, type, properties: {} });
  });
  
  const deadEnds = [];
  for (let x = 1; x < width - 1; x += 2) {
    for (let z = 1; z < depth - 1; z += 2) {
      if (maze[x][z].active) {
        let conns = 0;
        const dirs = [{dx:1,dz:0},{dx:-1,dz:0},{dx:0,dz:1},{dx:0,dz:-1}];
        dirs.forEach(d => {
          if (x + d.dx > 0 && x + d.dx < width && z + d.dz > 0 && z + d.dz < depth) {
            if (maze[x + d.dx][z + d.dz].active) conns++;
          }
        });
        if (conns === 1) {
          const isStart = (x === startX && z === startZ);
          const isExit = (x === exitCell.x && z === exitCell.z);
          if (!isStart && !isExit) {
            deadEnds.push({ x, z });
          }
        }
      }
    }
  }
  
  let prismsToPlace = Math.min(deadEnds.length, 8);
  if (prismsToPlace < 3) {
    prismsToPlace = 6;
    const shuffled = currentBlocks.filter(b => !(b.x === startX && b.z === startZ) && !(b.x === exitCell.x && b.z === exitCell.z)).sort(() => 0.5 - Math.random());
    for (let i = 0; i < prismsToPlace; i++) {
      if (shuffled[i]) {
        lvl.prisms.set(`${shuffled[i].x},0,${shuffled[i].z}`, { type: 'prism' });
      }
    }
  } else {
    const shuffled = deadEnds.sort(() => 0.5 - Math.random());
    for (let i = 0; i < prismsToPlace; i++) {
      lvl.prisms.set(`${shuffled[i].x},0,${shuffled[i].z}`, { type: 'prism' });
    }
  }
  
  return lvl;
}

/* ═══════════════════════════════════════════════════════════
   AI LEVEL GENERATOR 2 — "ARCHITECT" (difficulty-driven)
   Builds a guaranteed-solvable level scaled to a 1..10 difficulty, using all
   gameplay elements. See docs/ai-generator-2-concept.md for the design.
   ═══════════════════════════════════════════════════════════ */

// Difficulty 1..10 → all the knobs that scale together.
function architectParams(d) {
  const t = (Math.max(1, Math.min(10, d)) - 1) / 9; // 0..1
  const li = (a, b) => Math.round(a + (b - a) * t);
  const lf = (a, b) => a + (b - a) * t;
  return {
    halfSize: li(5, 17),          // grid extends ±halfSize → up to ~34 wide
    backboneLength: li(14, 150),
    maxFloors: li(0, 5),
    floorChance: lf(0.05, 0.40),
    branches: li(1, 16),
    branchLen: li(2, 6),
    switchGates: li(0, 3),
    teleporters: li(0, 3),
    movers: li(0, 4),
    enemies: li(0, 5),
    prisms: li(3, 14),
    miniprisms: li(0, 8),
    fragileChance: lf(0.0, 0.30),
    iceChance: lf(0.02, 0.22),
    shakerChance: lf(0.0, 0.22),
    dangerChance: lf(0.0, 0.20),
    boosterChance: lf(0.0, 0.08),
    parFactor: lf(1.3, 0.65),
  };
}

// Column index "x,z" → Map(y → type), for fast reachability queries.
function archColIndex(blocks) {
  const idx = new Map();
  blocks.forEach(b => {
    const ck = `${b.x},${b.z}`;
    if (!idx.has(ck)) idx.set(ck, new Map());
    idx.get(ck).set(b.y, b.type);
  });
  return idx;
}

// One orthogonal player step (mirrors getEnemyMoveTargetY): returns the landing
// Y when moving from (fromX,fromY,fromZ) into column (toX,toZ), else null.
// `danger` tiles are treated as lethal walls (never standable).
function archStepY(idx, fromX, fromY, fromZ, toX, toZ) {
  const toCol = idx.get(`${toX},${toZ}`);
  const fromCol = idx.get(`${fromX},${fromZ}`);
  if (!toCol) return null;
  const okType = y => toCol.get(y) !== 'danger';
  if (toCol.has(fromY + 1)) { // step up
    if (okType(fromY + 1) && !toCol.has(fromY + 2) && !(fromCol && fromCol.has(fromY + 1))) return fromY + 1;
    return null;
  }
  if (toCol.has(fromY)) {     // same level
    if (okType(fromY) && !toCol.has(fromY + 1)) return fromY;
    return null;
  }
  if (toCol.has(fromY - 1)) { // step down
    if (okType(fromY - 1) && !toCol.has(fromY)) return fromY - 1;
    return null;
  }
  return null;
}

// Flood-fill of all cells reachable from `start` under player movement rules.
function archReachable(blocks, start) {
  const idx = archColIndex(blocks);
  const seen = new Set([`${start.x},${start.y},${start.z}`]);
  const q = [{ x: start.x, y: start.y, z: start.z }];
  const dirs = [{dx:1,dz:0},{dx:-1,dz:0},{dx:0,dz:1},{dx:0,dz:-1}];
  let guard = 0;
  while (q.length && guard++ < 200000) {
    const c = q.shift();
    for (const { dx, dz } of dirs) {
      const nx = c.x + dx, nz = c.z + dz;
      const ny = archStepY(idx, c.x, c.y, c.z, nx, nz);
      if (ny === null) continue;
      const key = `${nx},${ny},${nz}`;
      if (!seen.has(key)) { seen.add(key); q.push({ x: nx, y: ny, z: nz }); }
    }
  }
  return seen;
}

function generateArchitectLevel(difficulty) {
  const P = architectParams(difficulty);
  const lvl = new Level3D();
  lvl.name = `Architect · Lvl ${difficulty}`;
  lvl.world = Math.min(4, Math.floor((difficulty - 1) / 2));

  const dirs = [{dx:1,dz:0},{dx:-1,dz:0},{dx:0,dz:1},{dx:0,dz:-1}];
  const occ = new Map(); // "x,z" → y (one height per column keeps the path ceiling-free)
  const setBlock = (c, type, props = {}) =>
    lvl.blocks.set(`${c.x},${c.y},${c.z}`, { x: c.x, y: c.y, z: c.z, type, properties: props });
  const inBounds = (x, z) => Math.abs(x) <= P.halfSize && Math.abs(z) <= P.halfSize;

  // ── 1) Backbone: a winding, guaranteed-walkable network from start outward.
  // Backtracking keeps the walk from stalling in an early dead end, so high
  // difficulties reliably reach their target size. Every cell stays connected,
  // at most one height per column → the whole structure is always walkable.
  const path = [{ x: 0, y: 0, z: 0 }];
  occ.set('0,0', 0);
  let cx = 0, cy = 0, cz = 0, heading = dirs[0];
  let stepsLeft = P.backboneLength;
  const roomAt = (x, z) => dirs.some(d => inBounds(x + d.dx, z + d.dz) && !occ.has(`${x + d.dx},${z + d.dz}`));
  while (stepsLeft > 0) {
    const options = dirs.filter(d => inBounds(cx + d.dx, cz + d.dz) && !occ.has(`${cx + d.dx},${cz + d.dz}`));
    if (!options.length) {
      // Dead end — hop back to an earlier cell that still has open neighbours.
      let jumped = false;
      for (let bi = path.length - 1; bi >= 0; bi--) {
        if (roomAt(path[bi].x, path[bi].z)) { cx = path[bi].x; cy = path[bi].y; cz = path[bi].z; heading = dirs[Math.floor(Math.random() * 4)]; jumped = true; break; }
      }
      if (!jumped) break; // grid genuinely full
      continue;
    }
    const straight = options.find(d => d.dx === heading.dx && d.dz === heading.dz);
    heading = (straight && Math.random() < 0.55) ? straight : options[Math.floor(Math.random() * options.length)];
    const nx = cx + heading.dx, nz = cz + heading.dz;
    let ny = cy;
    if (P.maxFloors > 0 && Math.random() < P.floorChance) {
      const cand = cy + (Math.random() < 0.5 ? 1 : -1);
      if (cand >= 0 && cand <= P.maxFloors) ny = cand;
    }
    occ.set(`${nx},${nz}`, ny);
    path.push({ x: nx, y: ny, z: nz });
    cx = nx; cy = ny; cz = nz; stepsLeft--;
  }
  path.forEach(c => setBlock(c, 'normal'));
  lvl.start = { ...path[0] };
  // Exit = farthest reachable backbone cell (height weighted), for a long route.
  let exitCell = path[0], maxD = 0;
  path.forEach(c => { const d = Math.abs(c.x) + Math.abs(c.z) + c.y * 2; if (d > maxD) { maxD = d; exitCell = c; } });
  lvl.exit = { ...exitCell };
  const startKey = `${path[0].x},${path[0].y},${path[0].z}`;
  const exitKey = `${lvl.exit.x},${lvl.exit.y},${lvl.exit.z}`;

  // ── 2) Branches & rooms (off-path, for bonus content and hazards) ──
  const branchCells = [];
  for (let b = 0; b < P.branches; b++) {
    const anchor = path[1 + Math.floor(Math.random() * Math.max(1, path.length - 2))];
    let bx = anchor.x, by = anchor.y, bz = anchor.z;
    let bdir = dirs[Math.floor(Math.random() * 4)];
    const len = 1 + Math.floor(Math.random() * P.branchLen);
    for (let s = 0; s < len; s++) {
      if (Math.random() < 0.3) bdir = dirs[Math.floor(Math.random() * 4)];
      const nx = bx + bdir.dx, nz = bz + bdir.dz;
      if (!inBounds(nx, nz) || occ.has(`${nx},${nz}`)) break;
      let ny = by;
      if (P.maxFloors > 0 && Math.random() < P.floorChance * 0.6) {
        const cand = by + (Math.random() < 0.5 ? 1 : -1);
        if (cand >= 0 && cand <= P.maxFloors) ny = cand;
      }
      occ.set(`${nx},${nz}`, ny);
      const cell = { x: nx, y: ny, z: nz };
      setBlock(cell, 'normal');
      branchCells.push(cell);
      bx = nx; by = ny; bz = nz;
    }
  }

  // ── 3) Switch-gated bridges on the backbone (switch placed before the gate) ──
  for (let g = 0; g < P.switchGates && path.length > 9; g++) {
    const i = 5 + Math.floor(Math.random() * (path.length - 7));
    const k = 1 + Math.floor(Math.random() * 2);
    const bridgeKeys = [];
    for (let j = i; j < Math.min(i + k, path.length - 1); j++) {
      const c = path[j], ck = `${c.x},${c.y},${c.z}`;
      if (lvl.blocks.get(ck).type !== 'normal') continue;
      setBlock(c, 'bridge');
      bridgeKeys.push(ck);
    }
    if (!bridgeKeys.length) continue;
    const sc = path[Math.max(1, i - 1 - Math.floor(Math.random() * 2))];
    const sk = `${sc.x},${sc.y},${sc.z}`;
    if (lvl.blocks.get(sk).type === 'normal') {
      setBlock(sc, 'switch');
      bridgeKeys.forEach(bk => lvl.links.push({ type: 'switch-trigger', from: sk, to: bk }));
    }
    // else: leave bridge always-on (still solvable)
  }

  // ── 4) Teleporter shortcuts between distant backbone cells ──
  for (let t = 0; t < P.teleporters; t++) {
    const a = path[Math.floor(Math.random() * path.length)];
    const b = path[Math.floor(Math.random() * path.length)];
    const ak = `${a.x},${a.y},${a.z}`, bk = `${b.x},${b.y},${b.z}`;
    if (ak === bk || ak === startKey || bk === startKey || ak === exitKey || bk === exitKey) continue;
    const ba = lvl.blocks.get(ak), bb = lvl.blocks.get(bk);
    if (!ba || !bb || ba.type !== 'normal' || bb.type !== 'normal') continue;
    ba.type = 'teleporter'; bb.type = 'teleporter';
    lvl.links.push({ type: 'teleporter-link', k1: ak, k2: bk });
  }

  // ── 5) Moving platforms: optional bonus routes over a gap to a mini-prism ──
  for (let m = 0; m < P.movers; m++) {
    const anchor = path[2 + Math.floor(Math.random() * Math.max(1, path.length - 3))];
    const d = dirs[Math.floor(Math.random() * 4)];
    const g1 = { x: anchor.x + d.dx, y: anchor.y, z: anchor.z + d.dz };
    const g2 = { x: anchor.x + 2 * d.dx, y: anchor.y, z: anchor.z + 2 * d.dz };
    const plat = { x: anchor.x + 3 * d.dx, y: anchor.y, z: anchor.z + 3 * d.dz };
    const free = c => inBounds(c.x, c.z) && !occ.has(`${c.x},${c.z}`);
    if (!(free(g1) && free(g2) && free(plat))) continue;
    occ.set(`${g1.x},${g1.z}`, g1.y);
    occ.set(`${plat.x},${plat.z}`, plat.y);
    setBlock(g1, 'moving', { targetX: g2.x, targetY: g2.y, targetZ: g2.z, speed: 1.2 });
    setBlock(plat, 'normal');
    lvl.prisms.set(`${plat.x},${plat.y},${plat.z}`, { type: 'miniprism' });
  }

  // ── 6) Mandatory prisms on backbone cells (always reachable) ──
  const prismPool = path.filter(c => {
    const k = `${c.x},${c.y},${c.z}`;
    return k !== startKey && k !== exitKey && lvl.blocks.get(k).type === 'normal';
  }).sort(() => 0.5 - Math.random());
  const prismCount = Math.min(P.prisms, prismPool.length);
  for (let i = 0; i < prismCount; i++) {
    const c = prismPool[i];
    lvl.prisms.set(`${c.x},${c.y},${c.z}`, { type: 'prism' });
  }

  // ── 7) Hazard styling — risk only on optional cells ──
  // Backbone (non-critical, no prism): occasional ice / booster only.
  path.forEach(c => {
    const k = `${c.x},${c.y},${c.z}`;
    if (k === startKey || k === exitKey || lvl.prisms.has(k)) return;
    const b = lvl.blocks.get(k);
    if (b.type !== 'normal') return;
    if (Math.random() < P.iceChance * 0.5) b.type = 'ice';
    else if (Math.random() < P.boosterChance) b.type = 'booster';
  });
  // Branch cells: fragile / shaker / danger / ice (optional routes only).
  branchCells.forEach(c => {
    const k = `${c.x},${c.y},${c.z}`;
    if (lvl.prisms.has(k)) return;
    const b = lvl.blocks.get(k);
    if (!b || b.type !== 'normal') return;
    const r = Math.random();
    if (r < P.fragileChance) b.type = 'fragile';
    else if (r < P.fragileChance + P.shakerChance) b.type = 'shaker';
    else if (r < P.fragileChance + P.shakerChance + P.dangerChance) b.type = 'danger';
    else if (r < P.fragileChance + P.shakerChance + P.dangerChance + P.iceChance) b.type = 'ice';
  });

  // ── 8) Bonus mini-prisms on branch ends (risky reward) ──
  const safeBranches = branchCells.filter(c => {
    const b = lvl.blocks.get(`${c.x},${c.y},${c.z}`);
    return b && b.type !== 'danger';
  }).sort(() => 0.5 - Math.random());
  for (let i = 0; i < Math.min(P.miniprisms, safeBranches.length); i++) {
    const c = safeBranches[i];
    const k = `${c.x},${c.y},${c.z}`;
    if (!lvl.prisms.has(k)) lvl.prisms.set(k, { type: 'miniprism' });
  }

  // ── 9) Enemies on far backbone cells ──
  const farCells = path.slice(Math.floor(path.length * 0.55)).filter(c => {
    const k = `${c.x},${c.y},${c.z}`;
    return k !== exitKey && lvl.blocks.get(k).type === 'normal';
  }).sort(() => 0.5 - Math.random());
  for (let i = 0; i < Math.min(P.enemies, farCells.length); i++) {
    const c = farCells[i];
    lvl.enemies.set(`${c.x},${c.y},${c.z}`, {});
  }

  // ── 10) Validate solvability; repair as a safety net ──
  // Switch-gate softlock guard: a triggered bridge is only fair if its switch
  // can be reached WITHOUT crossing any (still-closed) triggered bridge. If not,
  // drop the trigger so the bridge is permanently open — never a softlock.
  const trigBridges = new Map(); // bridgeKey → switchKey
  lvl.links.forEach(l => { if (l.type === 'switch-trigger') trigBridges.set(l.to, l.from); });
  if (trigBridges.size) {
    const noBridge = new Map();
    lvl.blocks.forEach((b, k) => { if (!trigBridges.has(k)) noBridge.set(k, b); });
    const reachNoBridge = archReachable(noBridge, lvl.start);
    trigBridges.forEach((sk, bk) => {
      if (!reachNoBridge.has(sk)) lvl.links = lvl.links.filter(l => !(l.type === 'switch-trigger' && l.to === bk));
    });
  }

  let reach = archReachable(lvl.blocks, lvl.start);
  // Drop any mandatory prism that somehow ended up unreachable.
  [...lvl.prisms.entries()].forEach(([k, p]) => {
    if (p.type === 'prism' && !reach.has(k)) lvl.prisms.delete(k);
  });
  // If the exit is blocked (shouldn't happen with a clean backbone), peel back
  // danger tiles until it opens up.
  let safety = 0;
  while (!reach.has(exitKey) && safety++ < 40) {
    let changed = false;
    lvl.blocks.forEach(b => {
      if (!changed && b.type === 'danger') { b.type = 'normal'; changed = true; }
    });
    if (!changed) break;
    reach = archReachable(lvl.blocks, lvl.start);
  }

  lvl.par = Math.max(6, Math.round(path.length * P.parFactor + prismCount * 2));
  return lvl;
}

/* ═══════════════════════════════════════════════════════════
   LEVEL EDITOR IMPLEMENTATION
   ═══════════════════════════════════════════════════════════ */
// Snapshot the current level onto the undo history before a mutating edit.
function pushUndoSnapshot() {
  if (!activeLevel) return;
  undoStack.push(serializeLevel(activeLevel));
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  updateUndoButton();
}

function editorUndo() {
  if (!isEditMode || isPlaytesting) return;
  if (!undoStack.length) { showMessage('NOTHING TO UNDO', 1); return; }
  const snap = undoStack.pop();
  const lvl = deserializeLevel(snap);
  document.getElementById('level-name-input').value = lvl.name;
  document.getElementById('world-select').value = lvl.world;
  buildLevel3D(lvl); // sets activeLevel and rebuilds meshes
  drawEditorWires();
  updateEditorSlicing();
  renderVerticalRuler();
  updateUndoButton();
  showMessage(`UNDO — ${undoStack.length} STEP${undoStack.length === 1 ? '' : 'S'} LEFT`, 1);
}

function updateUndoButton() {
  const btn = document.getElementById('btn-undo');
  if (btn) btn.disabled = undoStack.length === 0;
}

function enterEditMode() {
  if (isEditMode) return;
  isEditMode = true;
  undoStack = [];
  updateUndoButton();
  document.getElementById('editor-ui').style.display = 'block';
  document.getElementById('hud').style.display = 'none';
  document.getElementById('controls-hint').style.display = 'none';

  // Spawn Editor Camera values
  editorCameraTarget.copy(playerCube ? playerCube.position : new THREE.Vector3(0,0,0));
  editorCameraZoom = 15;

  // Add Grid Helper
  editorGridHelper = new THREE.GridHelper(50, 50, 0x00ccff, 0x223344);
  editorGridHelper.position.set(0.5, editY - 0.49, 0.5);
  scene.add(editorGridHelper);

  // Add Transparent Grid Plane
  const planeGeo = new THREE.PlaneGeometry(50, 50);
  const planeMat = new THREE.MeshBasicMaterial({ color: 0x00ccff, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false });
  editorGridPlane = new THREE.Mesh(planeGeo, planeMat);
  editorGridPlane.rotation.x = -Math.PI/2;
  editorGridPlane.position.set(0.5, editY - 0.49, 0.5);
  scene.add(editorGridPlane);

  // Add Ghost Block
  editorGhostBlock = new THREE.Mesh(geoTile, new THREE.MeshBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.4 }));
  scene.add(editorGhostBlock);

  editorWiresGroup = new THREE.Group();
  scene.add(editorWiresGroup);

  // Build temporary level if none exists
  if (!activeLevel) {
    activeLevel = new Level3D();
    lvlInsertDefaultBlocks(activeLevel);
  }
  buildLevel3D(activeLevel);
  drawEditorWires();
  updateLibraryList();

  // Usability updates
  document.getElementById('btn-toggle-slice').textContent = sliceModeActive ? 'Slice: ON' : 'Slice: OFF';
  document.getElementById('btn-toggle-slice').className = `editor-btn ${sliceModeActive ? 'success' : 'danger'}`;
  renderVerticalRuler();
  updateEditorSlicing();
}

function exitEditMode() {
  if (!isEditMode) return;
  isEditMode = false;
  isPainting = false;
  document.getElementById('editor-ui').style.display = 'none';
  document.getElementById('hud').style.display = 'flex';
  document.getElementById('editor-tooltip').style.display = 'none';

  if (editorGridHelper) { scene.remove(editorGridHelper); editorGridHelper = null; }
  if (editorGridPlane) { scene.remove(editorGridPlane); editorGridPlane = null; }
  if (editorGhostBlock) { scene.remove(editorGhostBlock); editorGhostBlock = null; }
  if (editorWiresGroup) { scene.remove(editorWiresGroup); editorWiresGroup = null; }

  // Reset slicing opacities / visibilities
  updateEditorSlicing();

  loadPreMadeLevel(currentLevelIdx);
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
    btn.className = `ruler-level-btn ${y === editY ? 'active' : ''}`;
    btn.textContent = y;
    btn.addEventListener('click', () => {
      adjustEditHeight(y - editY);
    });
    container.appendChild(btn);
  }
}

function updateEditorSlicing() {
  if (!isEditMode || isPlaytesting) {
    activeBlocks.forEach(b => {
      if (b.mesh) {
        b.mesh.visible = true;
        b.mesh.material.transparent = b.type === 'bridge';
        b.mesh.material.opacity = b.type === 'bridge' ? 0.4 : 1.0;
      }
      if (b.pillar) b.pillar.visible = true;
    });
    activePrisms.forEach(p => {
      if (p.mesh) p.mesh.visible = true;
    });
    movingPlatformsList.forEach(mp => {
      mp.mesh.visible = true;
    });
    applyXrayOverride();
    return;
  }
  activeBlocks.forEach(b => {
    if (!b.mesh) return;
    if (sliceModeActive && b.y > editY) {
      b.mesh.visible = false;
      if (b.pillar) b.pillar.visible = false;
    } else {
      b.mesh.visible = true;
      if (b.pillar) b.pillar.visible = true;
      const baseOpacity = b.type === 'bridge' ? (b.active === false ? 0.18 : 0.4) : 1.0;
      if (b.y < editY) {
        b.mesh.material.transparent = true;
        b.mesh.material.opacity = Math.min(0.4, baseOpacity);
      } else {
        b.mesh.material.transparent = b.type === 'bridge';
        b.mesh.material.opacity = baseOpacity;
      }
    }
  });
  activePrisms.forEach((p, k) => {
    if (!p.mesh) return;
    const py = k.split(',').map(Number)[1]; // key is "x,y,z" → y is the height
    if (sliceModeActive && py > editY) {
      p.mesh.visible = false;
    } else {
      p.mesh.visible = true;
      if (py < editY) {
        p.mesh.material.transparent = true;
        p.mesh.material.opacity = 0.4;
      } else {
        p.mesh.material.transparent = false;
        p.mesh.material.opacity = 1.0;
      }
    }
  });
  enemyMarkers.forEach((m, k) => {
    const ey = k.split(',').map(Number)[1];
    if (sliceModeActive && ey > editY) {
      m.visible = false;
    } else {
      m.visible = true;
      const below = ey < editY;
      m.material.transparent = below;
      m.material.opacity = below ? 0.35 : 1.0;
    }
  });
  movingPlatformsList.forEach(mp => {
    const mpy = Math.round(mp.position.y);
    if (sliceModeActive && mpy > editY) {
      mp.mesh.visible = false;
    } else {
      mp.mesh.visible = true;
      if (mpy < editY) {
        mp.mesh.material.transparent = true;
        mp.mesh.material.opacity = 0.4;
      } else {
        mp.mesh.material.transparent = false;
        mp.mesh.material.opacity = 1.0;
      }
    }
  });
  applyXrayOverride();
}

// X-ray view: force every currently-visible block / platform see-through so the
// whole 3D structure reads through nearer geometry. Runs as the last step of
// updateEditorSlicing so it survives slicing, edits and rebuilds. Prisms, enemy
// markers and edge outlines stay opaque to remain readable.
function applyXrayOverride() {
  if (!xrayMode) return;
  activeBlocks.forEach(b => {
    if (b.mesh && b.mesh.visible) {
      b.mesh.material.transparent = true;
      b.mesh.material.opacity = XRAY_OPACITY;
    }
  });
  movingPlatformsList.forEach(mp => {
    if (mp.mesh && mp.mesh.visible) {
      mp.mesh.material.transparent = true;
      mp.mesh.material.opacity = XRAY_OPACITY;
    }
  });
}

function toggleXray() {
  xrayMode = !xrayMode;
  audio.playSwitch();
  updateEditorSlicing(); // applies the override, or restores normal opacity when off
  showMessage(xrayMode ? 'X-RAY VIEW ON' : 'X-RAY VIEW OFF', 1.2);
}

// Orbit the camera around the (frozen) player while paused. Player stays centred.
function updatePauseOrbitCamera() {
  if (!playerCube) return;
  const t = playerCube.position;
  camera.position.set(
    t.x + Math.sin(pauseYaw) * Math.cos(pausePitch) * pauseZoom,
    t.y + Math.sin(pausePitch) * pauseZoom,
    t.z + Math.cos(pauseYaw) * Math.cos(pausePitch) * pauseZoom
  );
  camera.lookAt(t);
}

function togglePause() {
  if (isEditMode && !isPlaytesting) return; // pause only applies to play / playtest
  isPaused = !isPaused;
  audio.playSwitch();
  const ov = document.getElementById('pause-overlay');
  if (isPaused) {
    // Seed the orbit from the current camera so there's no jump on pause.
    if (playerCube) {
      const rel = camera.position.clone().sub(playerCube.position);
      pauseZoom = Math.max(3, rel.length());
      pausePitch = Math.asin(THREE.MathUtils.clamp(rel.y / pauseZoom, -1, 1));
      pauseYaw = Math.atan2(rel.x, rel.z);
    }
    pausePointers.clear(); pausePinchDist = null;
    ov && ov.classList.add('show');
  } else {
    ov && ov.classList.remove('show');
  }
}

function loadDemoLevel() {
  isCustomLevel = true;
  playerLives = MAX_LIVES;
  activeLevel = deserializeLevel(JSON.stringify(DEMO_LEVEL));
  document.getElementById('level-name-input').value = activeLevel.name;
  document.getElementById('world-select').value = activeLevel.world;
  buildLevel3D(activeLevel);
  if (isEditMode && !isPlaytesting) drawEditorWires();
  showMessage('DEMO LEVEL LOADED');
}

let libraryListToken = 0; // guards async folder-level appends against stale refreshes

function updateLibraryList() {
  const list = document.getElementById('custom-levels-list');
  const token = ++libraryListToken;
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
      isCustomLevel = true;
      activeLevel = deserializeLevel(store[name]);
      document.getElementById('level-name-input').value = activeLevel.name;
      document.getElementById('world-select').value = activeLevel.world;
      buildLevel3D(activeLevel);
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
    if (token !== libraryListToken) return; // a newer refresh superseded us
    let jsonStr;
    try {
      const r = await fetch(`level/${file}`, { cache: 'no-store' });
      if (!r.ok) continue;
      jsonStr = await r.text();
    } catch (e) { continue; }
    let data;
    try { data = JSON.parse(jsonStr); } catch (e) { continue; }
    if (token !== libraryListToken) return;
    const div = document.createElement('div');
    div.className = 'library-item';
    div.innerHTML = `<span style="color:var(--accent2);">📁 ${data.name || file}</span>`;
    div.querySelector('span').addEventListener('click', () => {
      isCustomLevel = true;
      activeLevel = deserializeLevel(jsonStr);
      document.getElementById('level-name-input').value = activeLevel.name;
      document.getElementById('world-select').value = activeLevel.world;
      buildLevel3D(activeLevel);
      drawEditorWires();
      showMessage('LEVEL LOADED');
      document.getElementById('editor-library-panel').style.display = 'none';
    });
    list.appendChild(div);
  }
}

function drawEditorWires() {
  if (!editorWiresGroup) return;
  // Clear old
  while (editorWiresGroup.children.length) {
    const c = editorWiresGroup.children[0];
    if (c.material) c.material.dispose();
    editorWiresGroup.remove(c);
  }

  // Draw wire paths for links
  activeLevel.links.forEach(l => {
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
      editorWiresGroup.add(line);
    }
  });

  // Draw faint links between members of each compound object so groupings
  // are visible in the editor.
  const groups = new Map(); // groupId -> [block,...]
  activeLevel.blocks.forEach(b => {
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
      const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: 0xffaa00, dashSize: 0.18, gapSize: 0.12, opacity: 0.7, transparent: true }));
      line.computeLineDistances();
      editorWiresGroup.add(line);
    });
  });

  // Draw paths for moving platforms
  activeLevel.blocks.forEach((b, k) => {
    if (b.type === 'moving' && b.properties.targetX !== undefined) {
      const start = new THREE.Vector3(b.x, b.y + 0.5, b.z);
      const end = new THREE.Vector3(b.properties.targetX, b.properties.targetY + 0.5, b.properties.targetZ);
      const geo = new THREE.BufferGeometry().setFromPoints([start, end]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x44aa55 }));
      editorWiresGroup.add(line);
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
    if (BLOCK_TOOLS.includes(selectedTool)) {
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
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(editY - 0.5));
  const intersectPoint = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(plane, intersectPoint)) {
    return {
      x: Math.round(intersectPoint.x),
      y: Math.round(editY),
      z: Math.round(intersectPoint.z),
      hitKey: null,
      hitType: null
    };
  }
  return null;
}

const BLOCK_TOOLS = ['normal', 'fragile', 'ice', 'switch', 'bridge', 'teleporter', 'moving', 'pushable', 'pressureplate', 'danger', 'shaker', 'booster'];

function snapItemCell(hit) {
  // Items (start/exit/prisms) must sit on a block cell to be reachable.
  // When clicking a block, use that cell; on empty grid cells, snap down
  // to the top block of the column.
  if (hit.hitKey && hit.hitType !== 'prism' && hit.hitType !== 'miniprism' && hit.hitType !== 'enemy') {
    return { x: hit.x, y: hit.y, z: hit.z };
  }
  let topY = null;
  activeLevel.blocks.forEach(b => {
    if (b.x === hit.x && b.z === hit.z && b.y <= hit.y && (topY === null || b.y > topY)) topY = b.y;
  });
  return { x: hit.x, y: topY !== null ? topY : hit.y, z: hit.z };
}

// Incremental editing — avoids a full level rebuild (and audio restart) on
// every placed/erased voxel, which made painting large levels laggy.
function editorEraseKey(key, kinds = ['block', 'prism', 'enemy']) {
  let removed = false;
  if (kinds.includes('enemy') && activeLevel.enemies.has(key)) {
    activeLevel.enemies.delete(key);
    const m = enemyMarkers.get(key);
    if (m) {
      prismsGroup.remove(m);
      if (m.material) m.material.dispose();
      m.children.forEach(ch => { if (ch.geometry) ch.geometry.dispose(); if (ch.material) ch.material.dispose(); });
    }
    enemyMarkers.delete(key);
    removed = true;
  }
  if (kinds.includes('prism') && activeLevel.prisms.has(key)) {
    activeLevel.prisms.delete(key);
    const p = activePrisms.get(key);
    if (p && p.mesh) { prismsGroup.remove(p.mesh); if (p.mesh.material) p.mesh.material.dispose(); }
    activePrisms.delete(key);
    removed = true;
  }
  if (kinds.includes('block') && activeLevel.blocks.has(key)) {
    const hasLinks = activeLevel.links.some(l => l.from === key || l.to === key || l.k1 === key || l.k2 === key);
    activeLevel.blocks.delete(key);
    if (hasLinks) {
      // Removing a linked block changes trigger wiring — full rebuild
      activeLevel.links = activeLevel.links.filter(l => l.from !== key && l.to !== key && l.k1 !== key && l.k2 !== key);
      buildLevel3D(activeLevel);
      drawEditorWires();
      return true;
    }
    const b = activeBlocks.get(key);
    if (b) {
      if (b.platformInstance) {
        const i = movingPlatformsList.indexOf(b.platformInstance);
        if (i >= 0) movingPlatformsList.splice(i, 1);
        b.platformInstance.dispose();
      }
      if (b.mesh) {
        tilesGroup.remove(b.mesh);
        if (b.mesh.material) b.mesh.material.dispose();
        b.mesh.children.forEach(ch => { if (ch.material) ch.material.dispose(); });
      }
      activeBlocks.delete(key);
    }
    removed = true;
    drawEditorWires();
  }
  return removed;
}

function editorPlaceBlock(x, y, z, type) {
  const key = `${x},${y},${z}`;
  const existing = activeLevel.blocks.get(key);
  if (existing && existing.type === type) return false;
  if (existing) editorEraseKey(key, ['block']);
  const b = { x, y, z, type, properties: {} };
  if (currentGroupId !== null) b.properties.group = currentGroupId;
  activeLevel.blocks.set(key, b);
  const rb = { ...b, broken: false, active: true };
  activeBlocks.set(key, rb);
  if (type === 'moving') {
    const mp = new MovingPlatform(key, x, y, z, x, y, z, 1.5, true);
    movingPlatformsList.push(mp);
    rb.platformInstance = mp;
  } else {
    createBlockMesh(rb, key);
  }
  updateEditorSlicing();
  return true;
}

function editorPlacePrism(x, y, z, type) {
  const key = `${x},${y},${z}`;
  const existing = activeLevel.prisms.get(key);
  if (existing && existing.type === type) return false;
  if (existing) editorEraseKey(key, ['prism']);
  activeLevel.prisms.set(key, { type });
  const p = { type, collected: false };
  activePrisms.set(key, p);
  createPrismMesh(key, p);
  updateEditorSlicing();
  return true;
}

function editorPlaceEnemy(x, y, z) {
  const key = `${x},${y},${z}`;
  if (activeLevel.enemies.has(key)) return false;
  activeLevel.enemies.set(key, {});
  createEnemyMarker(key);
  updateEditorSlicing();
  return true;
}

function editorSetStart(c) {
  activeLevel.start = { x: c.x, y: c.y, z: c.z };
  playerGridPos = { ...activeLevel.start };
  if (playerCube) {
    playerCube.position.copy(getPlayerWorldPos(c.x, c.y, c.z, false));
    playerCube.quaternion.identity();
  }
  audio.playRespawn();
}

function handleEditorClick(e) {
  const hit = editorRaycast(e);
  if (!hit) return;

  if (selectedTool === 'eraser') {
    if (hit.hitKey) {
      let kinds = ['block'];
      if (hit.hitType === 'prism' || hit.hitType === 'miniprism') kinds = ['prism'];
      else if (hit.hitType === 'enemy') kinds = ['enemy'];
      if (editorEraseKey(hit.hitKey, kinds)) audio.playBreak();
    }
    return;
  }

  if (selectedTool === 'linker') {
    if (linkerSourceKey === null) {
      // Set Source
      if (!hit.hitKey) return;
      const block = activeLevel.blocks.get(hit.hitKey);
      if (block && (block.type === 'switch' || block.type === 'pressureplate' || block.type === 'teleporter' || block.type === 'moving')) {
        linkerSourceKey = hit.hitKey;
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
    const source = activeLevel.blocks.get(linkerSourceKey);
    const target = hit.hitKey ? activeLevel.blocks.get(hit.hitKey) : null;
    let linked = false;
    if (source && source.type === 'moving' && linkerSourceKey !== hit.hitKey) {
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
        activeLevel.blocks.forEach((b, k) => {
          if (b.properties && b.properties.group === g && b.type === 'moving' && k !== linkerSourceKey) {
            b.properties.targetX = b.x + dispX;
            b.properties.targetY = b.y + dispY;
            b.properties.targetZ = b.z + dispZ;
            moverCount++;
          }
        });
      }
      showMessage(moverCount > 1 ? `OBJECT DESTINATION SET (${moverCount} MOVERS)` : 'PLATFORM DESTINATION SET');
      linked = true;
    } else if (source && target && linkerSourceKey !== hit.hitKey) {
      if (source.type === 'switch' || source.type === 'pressureplate') {
        // Accept any block as target — if it belongs to a compound group,
        // find all triggerable (bridge / moving) members of that group.
        // This lets the user click on ANY element of a grouped object.
        const groupId = target.properties && target.properties.group;
        let members = [];
        if (target.type === 'bridge' || target.type === 'moving') members = [target];
        if (groupId !== undefined && groupId !== null) {
          const groupLinkable = [...activeLevel.blocks.values()].filter(b =>
            b.properties && b.properties.group === groupId &&
            (b.type === 'bridge' || b.type === 'moving'));
          if (groupLinkable.length > 0) members = groupLinkable;
        }
        if (members.length > 0) {
          members.forEach(m => {
            const tk = `${m.x},${m.y},${m.z}`;
            if (!activeLevel.links.some(l => l.type === 'switch-trigger' && l.from === linkerSourceKey && l.to === tk)) {
              activeLevel.links.push({ type: 'switch-trigger', from: linkerSourceKey, to: tk });
            }
          });
          showMessage(members.length > 1 ? `OBJECT TRIGGER LINKED (${members.length} ELEMENTS)` : 'TRIGGER LINKED');
          linked = true;
        } else {
          showMessage('INVALID LINK TARGET — CLICK A BRIDGE, MOVER OR GROUPED OBJECT', 1.6);
        }
      } else if (source.type === 'teleporter' && target.type === 'teleporter') {
        activeLevel.links.push({ type: 'teleporter-link', k1: linkerSourceKey, k2: hit.hitKey });
        showMessage('PORTALS LINKED');
        linked = true;
      } else {
        showMessage('INVALID LINK TARGET', 1.4);
      }
    }
    linkerSourceKey = null;
    if (linked) {
      buildLevel3D(activeLevel);
      drawEditorWires();
    }
    return;
  }

  // Placement tools — blocks go only onto the selected level (raise the height
  // ruler to build higher); drag-painting already snaps to that plane.
  if (BLOCK_TOOLS.includes(selectedTool)) {
    if (hit.y === editY && editorPlaceBlock(hit.x, hit.y, hit.z, selectedTool)) audio.playRoll();
  } else if (selectedTool === 'prism' || selectedTool === 'miniprism') {
    const c = snapItemCell(hit);
    if (editorPlacePrism(c.x, c.y, c.z, selectedTool)) audio.playCollect();
  } else if (selectedTool === 'enemy') {
    const c = snapItemCell(hit);
    if (editorPlaceEnemy(c.x, c.y, c.z)) audio.playRoll();
  } else if (selectedTool === 'start') {
    editorSetStart(snapItemCell(hit));
  } else if (selectedTool === 'exit') {
    const c = snapItemCell(hit);
    activeLevel.exit = { x: c.x, y: c.y, z: c.z };
    buildLevel3D(activeLevel);
    audio.playComplete();
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

  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(editY - 0.5));
  const intersectPoint = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(plane, intersectPoint)) {
    const gx = Math.round(intersectPoint.x);
    const gy = Math.round(editY);
    const gz = Math.round(intersectPoint.z);
    const key = `${gx},${gy},${gz}`;

    if (selectedTool === 'eraser') {
      if (editorEraseKey(key)) audio.playBreak();
    } else if (BLOCK_TOOLS.includes(selectedTool)) {
      if (editorPlaceBlock(gx, gy, gz, selectedTool)) audio.playRoll();
    } else if (selectedTool === 'prism' || selectedTool === 'miniprism') {
      const c = snapItemCell({ x: gx, y: gy, z: gz, hitKey: null });
      if (editorPlacePrism(c.x, c.y, c.z, selectedTool)) audio.playCollect();
    } else if (selectedTool === 'enemy') {
      const c = snapItemCell({ x: gx, y: gy, z: gz, hitKey: null });
      if (editorPlaceEnemy(c.x, c.y, c.z)) audio.playRoll();
    } else if (selectedTool === 'start') {
      const c = snapItemCell({ x: gx, y: gy, z: gz, hitKey: null });
      if (activeLevel.start.x !== c.x || activeLevel.start.y !== c.y || activeLevel.start.z !== c.z) {
        editorSetStart(c);
      }
    } else if (selectedTool === 'exit') {
      const c = snapItemCell({ x: gx, y: gy, z: gz, hitKey: null });
      if (activeLevel.exit.x !== c.x || activeLevel.exit.y !== c.y || activeLevel.exit.z !== c.z) {
        activeLevel.exit = { x: c.x, y: c.y, z: c.z };
        buildLevel3D(activeLevel);
        drawEditorWires();
        audio.playComplete();
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════════
   PLAYTEST MODE
   ═══════════════════════════════════════════════════════════ */
let isPlaytesting = false;
let savedEditorLevel = null;

function enterPlaytestMode() {
  isPlaytesting = true;
  isPainting = false;
  playerLives = MAX_LIVES;
  savedEditorLevel = serializeLevel(activeLevel); // Save design snapshot

  document.getElementById('editor-toolbox').style.display = 'none';
  document.getElementById('editor-top-bar').style.display = 'none';
  document.getElementById('editor-bottom-bar').innerHTML = `
    <span style="letter-spacing:0.1em; color:var(--green)">PLAYTESTING CUSTOM LEVEL</span>
    <button id="btn-playtest-stop" class="editor-btn danger">STOP PLAYTEST</button>
  `;
  document.getElementById('editor-instructions').style.display = 'none';
  document.getElementById('editor-height-ruler').style.display = 'none';

  if (editorGridHelper) editorGridHelper.visible = false;
  if (editorGhostBlock) editorGhostBlock.visible = false;
  if (editorWiresGroup) editorWiresGroup.visible = false;

  // Build play level
  buildLevel3D(activeLevel);
  // Focus playing controls
  document.getElementById('btn-playtest-stop').addEventListener('click', exitPlaytestMode);
}

function exitPlaytestMode() {
  isPlaytesting = false;
  activeLevel = deserializeLevel(savedEditorLevel);

  document.getElementById('editor-toolbox').style.display = 'flex';
  document.getElementById('editor-top-bar').style.display = 'flex';
  document.getElementById('editor-bottom-bar').innerHTML = `
    <div style="display:flex; align-items:center; gap:12px;">
      <span>EDITING HEIGHT (Y):</span>
      <button id="btn-height-down" class="height-btn">▼</button>
      <span id="height-display" style="font-size:16px; font-weight:bold; color:var(--accent2); width:20px; text-align:center;">${editY}</span>
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

  if (editorGridHelper) editorGridHelper.visible = true;
  if (editorGhostBlock) editorGhostBlock.visible = true;
  if (editorWiresGroup) editorWiresGroup.visible = true;

  // Bind new element buttons
  document.getElementById('btn-height-down').addEventListener('click', () => adjustEditHeight(-1));
  document.getElementById('btn-height-up').addEventListener('click', () => adjustEditHeight(1));
  document.getElementById('btn-playtest').addEventListener('click', enterPlaytestMode);
  document.getElementById('btn-editor-exit').addEventListener('click', exitEditMode);

  buildLevel3D(activeLevel);
  drawEditorWires();
}

function adjustEditHeight(val) {
  editY = Math.max(rulerMinY, Math.min(rulerMaxY, editY + val));
  document.getElementById('height-display').textContent = editY;
  if (editorGridHelper) editorGridHelper.position.set(0.5, editY - 0.49, 0.5);
  if (editorGridPlane) editorGridPlane.position.set(0.5, editY - 0.49, 0.5);
  renderVerticalRuler();
  updateEditorSlicing();
}

/* ═══════════════════════════════════════════════════════════
   PRE-MADE LEVEL LOADER
   ═══════════════════════════════════════════════════════════ */
function loadPreMadeLevel(idx) {
  isCustomLevel = false;
  playerLives = MAX_LIVES;
  const flatLvl = LEVELS[idx];
  const lvl3D = convertTo3D(flatLvl);
  buildLevel3D(lvl3D);
}

/* ═══════════════════════════════════════════════════════════
   INPUT CONTROLS
   ═══════════════════════════════════════════════════════════ */
function handleMove(dirX, dirZ) {
  if (isLevelComplete || isEditMode && !isPlaytesting) return;
  startRoll(dirX, dirZ);
}

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  audio.init();
  keysPressed[e.code] = true;

  // Never hijack keys while typing in inputs (level name, import JSON, …)
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) return;

  // Help overlay toggles with H from anywhere; while open it swallows other keys.
  if (e.code === 'KeyH') { setHelpOpen(!isHelpOpen); return; }
  if (isHelpOpen) { if (e.code === 'Escape') setHelpOpen(false); return; }

  // X-ray view toggle — works in play and editor alike.
  if (e.code === 'KeyT') { e.preventDefault(); toggleXray(); return; }

  // Pause + free-orbit camera toggle (play / playtest only).
  if (e.code === 'KeyP') { e.preventDefault(); togglePause(); return; }
  // While paused, swallow every other key so the frozen game can't be driven.
  if (isPaused) return;

  if (isBalancing) {
    let rollBack = false;
    if (lastMoveDir.x === 1 && (e.code === 'ArrowLeft' || e.code === 'KeyA')) rollBack = true;
    if (lastMoveDir.x === -1 && (e.code === 'ArrowRight' || e.code === 'KeyD')) rollBack = true;
    if (lastMoveDir.z === 1 && (e.code === 'ArrowUp' || e.code === 'KeyW')) rollBack = true;
    if (lastMoveDir.z === -1 && (e.code === 'ArrowDown' || e.code === 'KeyS')) rollBack = true;
    if (rollBack) {
      executeRollBack();
      return;
    }
  }

  if (isEditMode && !isPlaytesting) {
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); editorUndo(); return; }
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
      // Start a new compound object: every block placed while O is held shares
      // this id. Pick max existing group + 1 so it stays unique after load.
      let maxG = 0;
      activeLevel.blocks.forEach(b => {
        if (b.properties && typeof b.properties.group === 'number' && b.properties.group > maxG) maxG = b.properties.group;
      });
      currentGroupId = maxG + 1;
      showMessage('GROUPING — PLACE BLOCKS, RELEASE O TO FINISH');
      return;
    }
    if (e.code === 'Escape') {
      if (linkerSourceKey) { linkerSourceKey = null; showMessage('LINK CANCELLED', 1); }
      return;
    }
    // Camera pan (WASD/arrows) and rotate (Q/E) are applied continuously in the
    // render loop from keysPressed, so holding a key keeps moving smoothly.
    if (e.code === 'KeyR') { e.preventDefault(); adjustEditHeight(1); }
    if (e.code === 'KeyF') { e.preventDefault(); adjustEditHeight(-1); }
    return;
  }

  // Normal gameplay keys
  // Arm held-key auto-repeat for the pressed direction (loop repeats every 300ms).
  const moveMap = { ArrowUp:[0,-1], KeyW:[0,-1], ArrowDown:[0,1], KeyS:[0,1], ArrowLeft:[-1,0], KeyA:[-1,0], ArrowRight:[1,0], KeyD:[1,0] };
  if (moveMap[e.code]) { repeatMoveCode = e.code; repeatMoveDir = { x: moveMap[e.code][0], z: moveMap[e.code][1] }; moveRepeatTimer = 0; }
  switch (e.code) {
    case 'ArrowUp': case 'KeyW': e.preventDefault(); handleMove(0, -1); break;
    case 'ArrowDown': case 'KeyS': e.preventDefault(); handleMove(0, 1); break;
    case 'ArrowLeft': case 'KeyA': e.preventDefault(); handleMove(-1, 0); break;
    case 'ArrowRight': case 'KeyD': e.preventDefault(); handleMove(1, 0); break;
    case 'KeyR': e.preventDefault(); respawnPlayer(); break;
    case 'Space': e.preventDefault();
      if (isLevelComplete) {
        if (!isEditMode) {
          currentLevelIdx = (currentLevelIdx+1)%LEVELS.length; loadPreMadeLevel(currentLevelIdx);
        }
      }
      break;
  }
});

window.addEventListener('keyup', (e) => {
  keysPressed[e.code] = false;
  if (e.code === 'KeyO' && currentGroupId !== null) {
    currentGroupId = null;
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
  if (!isEditMode || isPlaytesting) return;
  if (e.button === 0) {
    // Snapshot once per click / paint-stroke (skip pure linker source-select).
    if (!(selectedTool === 'linker' && linkerSourceKey === null)) pushUndoSnapshot();
    // Left click edit block
    if (selectedTool !== 'linker') {
      isPainting = true;
    }
    handleEditorClick(e);
  } else {
    // Right click rotate camera / erase
    isDraggingCamera = true;
    rightDragMoved = false;
    dragStartMouse = { x: e.clientX, y: e.clientY };
  }
});

renderer.domElement.addEventListener('mousemove', (e) => {
  if (!isEditMode || isPlaytesting) return;

  if (isDraggingCamera) {
    const dx = e.clientX - dragStartMouse.x;
    const dy = e.clientY - dragStartMouse.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) rightDragMoved = true;
    editorCameraYaw -= dx * 0.005;
    editorCameraPitch = Math.max(0.1, Math.min(Math.PI/2 - 0.1, editorCameraPitch + dy * 0.005));
    dragStartMouse = { x: e.clientX, y: e.clientY };
  } else {
    // Update Ghost Block Position
    const hit = editorRaycast(e);
    const tooltip = document.getElementById('editor-tooltip');
    if (hit && editorGhostBlock) {
      // Block-placement preview is only shown on the currently selected level.
      let ghostVisible = !(BLOCK_TOOLS.includes(selectedTool) && hit.y !== editY);
      // Set ghost block color, geometry and position dynamically based on tool
      if (selectedTool === 'eraser') {
        editorGhostBlock.material.color.setHex(0xff3355);
        if (hit.hitType === 'bridge') {
          editorGhostBlock.geometry = geoThinTile;
          editorGhostBlock.position.set(hit.x, hit.y + 0.4, hit.z);
        } else if (hit.hitType === 'prism' || hit.hitType === 'miniprism') {
          editorGhostBlock.geometry = geoPrism;
          editorGhostBlock.position.set(hit.x, hit.y + 0.55, hit.z);
        } else if (hit.hitType === 'enemy') {
          editorGhostBlock.geometry = geoCube;
          editorGhostBlock.position.set(hit.x, hit.y + 1, hit.z);
        } else {
          editorGhostBlock.geometry = geoTile;
          editorGhostBlock.position.set(hit.x, hit.y, hit.z);
        }
      } else if (selectedTool === 'linker') {
        editorGhostBlock.material.color.setHex(0xffaa00);
        if (hit.hitType === 'bridge') {
          editorGhostBlock.geometry = geoThinTile;
          editorGhostBlock.position.set(hit.x, hit.y + 0.4, hit.z);
        } else if (hit.hitType === 'prism' || hit.hitType === 'miniprism') {
          editorGhostBlock.geometry = geoPrism;
          editorGhostBlock.position.set(hit.x, hit.y + 0.55, hit.z);
        } else {
          editorGhostBlock.geometry = geoTile;
          editorGhostBlock.position.set(hit.x, hit.y, hit.z);
        }
      } else {
        let ghostColor = 0x00ffcc;
        if (selectedTool === 'pushable') ghostColor = 0x8b5a2b;
        else if (selectedTool === 'pressureplate') ghostColor = 0x3366ff;
        else if (selectedTool === 'danger') ghostColor = 0xff3333;
        else if (selectedTool === 'shaker') ghostColor = 0x554444;
        else if (selectedTool === 'booster') ghostColor = 0xffcc00;
        else if (selectedTool === 'start') ghostColor = 0xff6600;
        else if (selectedTool === 'exit') ghostColor = 0x00ffaa;
        else if (selectedTool === 'enemy') ghostColor = 0xff0066;

        editorGhostBlock.material.color.setHex(ghostColor);
        let targetY = hit.y;
        if (selectedTool === 'bridge') {
          editorGhostBlock.geometry = geoThinTile;
          targetY = hit.y + 0.4;
        } else if (selectedTool === 'prism' || selectedTool === 'miniprism') {
          editorGhostBlock.geometry = geoPrism;
          targetY = hit.y + 0.55;
        } else if (selectedTool === 'start' || selectedTool === 'exit' || selectedTool === 'enemy') {
          // Marker preview floats where the player cube / exit ring appears
          editorGhostBlock.geometry = geoCube;
          targetY = hit.y + 1;
        } else {
          editorGhostBlock.geometry = geoTile;
        }
        editorGhostBlock.position.set(hit.x, targetY, hit.z);
      }
      editorGhostBlock.visible = ghostVisible;

      // Update Tooltip
      if (tooltip && ghostVisible) {
        let text = `${selectedTool.toUpperCase()}`;
        text += ` <span class="tooltip-coord">(${hit.x}, ${hit.y}, ${hit.z})</span>`;
        if (hit.hitKey && BLOCK_TOOLS.includes(selectedTool)) {
          text += ` <span class="tooltip-stacking">Stacking</span>`;
        }
        tooltip.innerHTML = text;
        tooltip.style.left = (e.clientX + 15) + 'px';
        tooltip.style.top = (e.clientY + 15) + 'px';
        tooltip.style.display = 'block';
      } else if (tooltip) {
        tooltip.style.display = 'none';
      }
    } else if (editorGhostBlock) {
      editorGhostBlock.visible = false;
      if (tooltip) tooltip.style.display = 'none';
    }

    if (isPainting) {
      handleEditorDragClick(e);
    }
  }
});

window.addEventListener('mouseup', (e) => {
  isDraggingCamera = false;
  if (e.button === 0) {
    isPainting = false;
  }
});

renderer.domElement.addEventListener('contextmenu', (e) => {
  if (!isEditMode) return;
  e.preventDefault();
  // Erase voxel on right-click TAP only — not after rotating the camera
  if (isPlaytesting || rightDragMoved) return;
  const hit = editorRaycast(e);
  if (hit && hit.hitKey) {
    if (editorEraseKey(hit.hitKey)) audio.playBreak();
  }
});

window.addEventListener('wheel', (e) => {
  if (!isEditMode || isPlaytesting) return;
  if (e.shiftKey) {
    // Adjust edit height
    adjustEditHeight(e.deltaY < 0 ? 1 : -1);
  } else {
    // Zoom camera
    editorCameraZoom = Math.max(5, Math.min(45, editorCameraZoom + (e.deltaY * 0.01)));
  }
});

/* ═══ PAUSE FREE-ORBIT INPUT (mouse + touch): drag to rotate, wheel/pinch to zoom ═══ */
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!isPaused) return;
  pausePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!isPaused || !pausePointers.has(e.pointerId)) return;
  const prev = pausePointers.get(e.pointerId);
  pausePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pausePointers.size >= 2) {
    // Two-finger pinch → zoom
    const pts = [...pausePointers.values()];
    const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    if (pausePinchDist != null && d > 0) pauseZoom = Math.max(3, Math.min(45, pauseZoom * (pausePinchDist / d)));
    pausePinchDist = d;
  } else {
    // Single pointer → orbit (full 360° yaw, clamped pitch)
    pauseYaw -= (e.clientX - prev.x) * 0.008;
    pausePitch = Math.max(0.05, Math.min(1.5, pausePitch + (e.clientY - prev.y) * 0.008));
  }
});
window.addEventListener('pointerup', (e) => {
  pausePointers.delete(e.pointerId);
  if (pausePointers.size < 2) pausePinchDist = null;
});
window.addEventListener('pointercancel', (e) => {
  pausePointers.delete(e.pointerId);
  if (pausePointers.size < 2) pausePinchDist = null;
});
window.addEventListener('wheel', (e) => {
  if (!isPaused) return;
  e.preventDefault();
  pauseZoom = Math.max(3, Math.min(45, pauseZoom * (e.deltaY > 0 ? 1.08 : 0.92)));
}, { passive: false });

/* ═══════════════════════════════════════════════════════════
   LEVEL EDITOR BUTTON EVENTS
   ═══════════════════════════════════════════════════════════ */
document.getElementById('btn-play-load').addEventListener('click', () => {
  audio.init();
  updateLibraryList();
  document.getElementById('editor-library-panel').style.display = 'block';
});

document.getElementById('btn-editor-toggle').addEventListener('click', () => {
  audio.init();
  if (isEditMode) exitEditMode(); else enterEditMode();
});

// Toolbox items select
const toolButtons = Array.from(document.querySelectorAll('.tool-btn'));
function selectToolByName(name) {
  toolButtons.forEach(b => b.classList.toggle('active', b.dataset.tool === name));
  selectedTool = name;
  linkerSourceKey = null;
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
  sliceModeActive = !sliceModeActive;
  audio.playSwitch();
  document.getElementById('btn-toggle-slice').textContent = sliceModeActive ? 'Slice: ON' : 'Slice: OFF';
  document.getElementById('btn-toggle-slice').className = `editor-btn ${sliceModeActive ? 'success' : 'danger'}`;
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
    adjustEditHeight(-editY); // reset editing height to 0
  }
});

document.getElementById('btn-ai-generate').addEventListener('click', () => {
  audio.init();
  if (confirm("Generate a complex 3D AI Labyrinth? This will overwrite your current design.")) {
    pushUndoSnapshot();
    const lvl = generateAILabyrinth();
    activeLevel = lvl;
    document.getElementById('level-name-input').value = lvl.name;
    document.getElementById('world-select').value = lvl.world;
    adjustEditHeight(-editY); // Reset edit height to 0
    buildLevel3D(lvl);
    drawEditorWires();
    showMessage('AI LABYRINTH GENERATED');
  }
});

document.getElementById('btn-ai-architect').addEventListener('click', () => {
  audio.init();
  const difficulty = parseInt(document.getElementById('architect-difficulty').value, 10) || 5;
  if (confirm(`Generate a difficulty-${difficulty} Architect level? This will overwrite your current design.`)) {
    pushUndoSnapshot();
    const lvl = generateArchitectLevel(difficulty);
    activeLevel = lvl;
    document.getElementById('level-name-input').value = lvl.name;
    document.getElementById('world-select').value = lvl.world;
    adjustEditHeight(-editY); // Reset edit height to 0
    buildLevel3D(lvl);
    drawEditorWires();
    showMessage(`ARCHITECT LEVEL — DIFFICULTY ${difficulty}`);
  }
});

document.getElementById('btn-clear-grid').addEventListener('click', () => {
  if (confirm("Clear all blocks in this level?")) {
    pushUndoSnapshot();
    activeLevel.blocks.clear();
    activeLevel.prisms.clear();
    activeLevel.links = [];
    lvlInsertDefaultBlocks(activeLevel);
    buildLevel3D(activeLevel);
    drawEditorWires();
  }
});

document.getElementById('btn-save-local').addEventListener('click', () => {
  const name = document.getElementById('level-name-input').value.trim();
  if (!name) return alert("Please specify level name.");
  activeLevel.name = name;
  activeLevel.world = parseInt(document.getElementById('world-select').value);

  let store = {};
  try { store = JSON.parse(localStorage.getItem('goose_levels') || '{}'); } catch(e){}
  store[name] = serializeLevel(activeLevel);
  localStorage.setItem('goose_levels', JSON.stringify(store));
  showMessage('LEVEL SAVED SUCCESSFULLY');
});

document.getElementById('btn-load-local').addEventListener('click', () => {
  updateLibraryList();
  document.getElementById('editor-library-panel').style.display = 'block';
});
document.getElementById('btn-library-upload').addEventListener('click', () => {
  document.getElementById('import-file-input').click();
});
document.getElementById('btn-close-library').addEventListener('click', () => {
  document.getElementById('editor-library-panel').style.display = 'none';
});

// Export Level
document.getElementById('btn-export-level').addEventListener('click', () => {
  const data = serializeLevel(activeLevel);
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
  document.getElementById('export-import-modal').style.display = 'none';
});
document.getElementById('btn-modal-copy').addEventListener('click', () => {
  const area = document.getElementById('modal-textarea');
  area.select(); document.execCommand('copy');
  showMessage('Copied to clipboard');
});
document.getElementById('btn-modal-download').addEventListener('click', () => {
  const data = document.getElementById('modal-textarea').value;
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${activeLevel.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showMessage('File downloaded');
});
document.getElementById('btn-modal-upload').addEventListener('click', () => {
  document.getElementById('import-file-input').click();
});
document.getElementById('import-file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      isCustomLevel = true;
      const lvl = deserializeLevel(evt.target.result);
      activeLevel = lvl;
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
    if (isEditMode && !isPlaytesting) pushUndoSnapshot();
    activeLevel = lvl;
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

/* ═══════════════════════════════════════════════════════════
   ENEMY AI & LIVES
   ═══════════════════════════════════════════════════════════ */
function getEnemyMoveTargetY(fromX, fromY, fromZ, toX, toZ) {
  const colBlocks = getBlocksInColumn(toX, toZ);
  const currentCeiling = getBlocksInColumn(fromX, fromZ).find(b => b.y === fromY + 1);
  const stepUp   = colBlocks.find(b => b.y === fromY + 1);
  const sameLevel = colBlocks.find(b => b.y === fromY);
  const stepDown  = colBlocks.find(b => b.y === fromY - 1);

  if (stepUp) {
    if (!colBlocks.find(b => b.y === fromY + 2) && !currentCeiling) return fromY + 1;
    return null;
  }
  if (sameLevel) {
    if (!colBlocks.find(b => b.y === fromY + 1)) return fromY;
    return null;
  }
  if (stepDown) {
    if (!colBlocks.find(b => b.y === fromY)) return fromY - 1;
    return null;
  }
  return null; // void – enemy doesn't fall
}

function enemyBFS(enemy) {
  const fromX = enemy.grid.x, fromY = enemy.grid.y, fromZ = enemy.grid.z;
  const toX = playerGridPos.x, toZ = playerGridPos.z;
  if (fromX === toX && fromZ === toZ) return null;

  const visited = new Set();
  visited.add(`${fromX},${fromY},${fromZ}`);
  const dirs = [{dx:1,dz:0},{dx:-1,dz:0},{dx:0,dz:1},{dx:0,dz:-1}];
  const queue = [];

  for (const {dx, dz} of dirs) {
    const nx = fromX + dx, nz = fromZ + dz;
    const ny = getEnemyMoveTargetY(fromX, fromY, fromZ, nx, nz);
    if (ny === null) continue;
    const key = `${nx},${ny},${nz}`;
    if (!visited.has(key)) { visited.add(key); queue.push({ x: nx, y: ny, z: nz, first: {dx, dz} }); }
  }

  let guard = 0;
  while (queue.length > 0 && guard++ < 3000) {
    const { x, y, z, first } = queue.shift();
    if (x === toX && z === toZ) return first;
    for (const {dx, dz} of dirs) {
      const nx = x + dx, nz = z + dz;
      const ny = getEnemyMoveTargetY(x, y, z, nx, nz);
      if (ny === null) continue;
      const key = `${nx},${ny},${nz}`;
      if (!visited.has(key)) { visited.add(key); queue.push({ x: nx, y: ny, z: nz, first }); }
    }
  }
  return null;
}

// Most distant reachable cell from the player start (excluding start/exit) —
// used only as the legacy auto-spawn point for built-in campaign levels.
function findEnemySpawnKey() {
  const sx = playerGridPos.x, sy = playerGridPos.y, sz = playerGridPos.z;
  const visited = new Set();
  visited.add(`${sx},${sy},${sz}`);
  const queue = [{ x: sx, y: sy, z: sz, dist: 0 }];
  const dirs = [{dx:1,dz:0},{dx:-1,dz:0},{dx:0,dz:1},{dx:0,dz:-1}];
  let best = { x: exitPos.x, y: exitPos.y, z: exitPos.z, dist: 0 };

  while (queue.length > 0) {
    const { x, y, z, dist } = queue.shift();
    const isSpecial = (x === exitPos.x && z === exitPos.z) || (x === sx && z === sz);
    if (!isSpecial && dist > best.dist) best = { x, y, z, dist };
    for (const {dx, dz} of dirs) {
      const nx = x + dx, nz = z + dz;
      const ny = getEnemyMoveTargetY(x, y, z, nx, nz);
      if (ny === null) continue;
      const key = `${nx},${ny},${nz}`;
      if (!visited.has(key)) { visited.add(key); queue.push({ x: nx, y: ny, z: nz, dist: dist + 1 }); }
    }
  }
  return `${best.x},${best.y},${best.z}`;
}

function startEnemyRoll(enemy, dx, dz) {
  const toGX = enemy.grid.x + dx, toGZ = enemy.grid.z + dz;
  const ny = getEnemyMoveTargetY(enemy.grid.x, enemy.grid.y, enemy.grid.z, toGX, toGZ);
  if (ny === null) return;

  enemy.isRolling = true;
  enemy.animStartTime = performance.now() / 1000;
  enemy.animStartPos.copy(enemy.cube.position);
  enemy.animEndPos.copy(getPlayerWorldPos(toGX, ny, toGZ, false));
  enemy.animStartQuat.copy(enemy.cube.quaternion);

  const axis = new THREE.Vector3(dz, 0, -dx).normalize();
  enemy.animDeltaQuat.setFromAxisAngle(axis, Math.PI / 2);

  enemy.grid.x = toGX;
  enemy.grid.y = ny;
  enemy.grid.z = toGZ;
}

function loseLife() {
  if (playerInvincible) return;
  playerLives--;
  const isGameOver = playerLives <= 0;
  if (isGameOver) playerLives = MAX_LIVES;
  updateLivesUI();
  respawnPlayer(); // resets level + shows LEVEL RESTART
  // Override message and set invincibility AFTER respawn
  playerInvincible = true;
  playerInvincibleTimer = PLAYER_INVINCIBLE_DURATION;
  showMessage(isGameOver ? 'GAME OVER!' : `LIFE LOST — ${playerLives} LEFT`, isGameOver ? 2.2 : 1.5);
}

function updateLivesUI() {
  const el = document.getElementById('lives-display');
  if (!el) return;
  let html = '';
  for (let i = 0; i < MAX_LIVES; i++) {
    html += `<span class="life-heart${i < playerLives ? ' active' : ''}">♥</span>`;
  }
  el.innerHTML = html;
}

/* ═══════════════════════════════════════════════════════════
   ANIMATION & RENDER LOOP
   ═══════════════════════════════════════════════════════════ */
const clock = new THREE.Clock();

function animate(timestamp) {
  requestAnimationFrame(animate);
  const now = timestamp/1000;
  const dt = Math.min(clock.getDelta(), 0.1);

  // Paused: freeze all game logic, only drive the free-orbit camera and render.
  if (isPaused && (!isEditMode || isPlaytesting)) {
    updatePauseOrbitCamera();
    renderer.render(scene, camera);
    return;
  }

  if (!isEditMode || isPlaytesting) {
    // Game time
    if (!isLevelComplete) { elapsedTime += dt; gameTimer += dt; }
    if (comboTimer > 0) { comboTimer -= dt; if (comboTimer <= 0) { comboCount = 0; updateComboUI(); } }

    // Edge Balancing update
    if (isBalancing) {
      if (!isLastMoveKeyHeld()) {
        isBalancing = false;
        isFalling = true;
        fallVelY = 0;
        playerCube.userData.fallTargetY = playerCube.userData.targetLandingY;
        audio.playBalanceStop();
        audio.playFall();
      } else {
        balanceTimer -= dt;
        if (balanceTimer <= 0) {
          isBalancing = false;
          isFalling = true;
          fallVelY = 0;
          playerCube.userData.fallTargetY = playerCube.userData.targetLandingY;
          audio.playBalanceStop();
          audio.playFall();
        }
      }
    }

    // Pressure plate real-time check
    updatePressurePlates();

    // Mini duration
    if (isMini && miniTimer > 0) {
      miniTimer -= dt;
      document.getElementById('mini-hud-fill').style.width = (miniTimer / 15 * 100) + '%';
      if (miniTimer <= 0) checkGrowBack();
    }

    // Held-direction auto-repeat: roll one cell every 300ms while a key is held.
    if (repeatMoveCode && keysPressed[repeatMoveCode] && !isLevelComplete) {
      moveRepeatTimer += dt * 1000;
      if (moveRepeatTimer >= MOVE_REPEAT_MS) {
        moveRepeatTimer -= MOVE_REPEAT_MS;
        handleMove(repeatMoveDir.x, repeatMoveDir.z);
      }
    } else {
      repeatMoveCode = null;
      moveRepeatTimer = 0;
    }

    // Platforms update
    movingPlatformsList.forEach(mp => mp.update(dt));

    // Player riding a mover — STICKY + RIGID: once aboard, the cube is locked
    // to the mover by a fixed cell offset (cube = mover.position + offset) every
    // frame, so it is transported with the block and never slides across it.
    const size = isMini ? CUBE_S * 0.5 : CUBE_S;
    if (isRolling || isFalling || isTeleporting) {
      ridingPlatform = null;
    } else {
      if (!ridingPlatform) {
        ridingPlatform = checkRidingPlatform(); // step aboard
        if (ridingPlatform) {
          // Lock onto the cell we boarded (snap horizontal offset to whole cells,
          // keep the standing height). Works for the driver tile and any
          // compound-object passenger cell.
          ridingOffset.set(
            Math.round(playerCube.position.x - ridingPlatform.position.x),
            0.5 + size / 2,
            Math.round(playerCube.position.z - ridingPlatform.position.z)
          );
        }
      }
      if (ridingPlatform && !ridingPlatform.active) ridingPlatform = null;
    }

    if (ridingPlatform) {
      const before = playerCube.position.clone();
      playerCube.position.copy(ridingPlatform.position).add(ridingOffset);
      cameraTarget.add(playerCube.position.clone().sub(before));
      playerGridPos.x = Math.round(playerCube.position.x);
      playerGridPos.y = Math.round(playerCube.position.y - 0.5 - size/2);
      playerGridPos.z = Math.round(playerCube.position.z);
    } else {
      // Otherwise, a mover advancing into the player's cell shoves them along.
      const mpPush = checkPushedByPlatform();
      if (mpPush) {
        const delta = mpPush.position.clone().sub(mpPush.prevPosition);
        playerCube.position.add(delta);
        cameraTarget.add(delta);
        playerGridPos.x = Math.round(playerCube.position.x);
        playerGridPos.y = Math.round(playerCube.position.y - 0.5 - size/2);
        playerGridPos.z = Math.round(playerCube.position.z);
        // Shoved over a ledge with nothing to stand on → fall.
        const col = getBlocksInColumn(playerGridPos.x, playerGridPos.z);
        if (!col.some(b => b.y === playerGridPos.y)) {
          const landing = col.find(b => b.y < playerGridPos.y);
          isFalling = true; fallVelY = 0;
          playerCube.userData.fallTargetY = landing ? landing.y : -10;
          audio.playFall();
        }
      }
    }

    // Rolling animation
    if (isRolling) {
      const elapsed = now - animStartTime;
      let dur = isMini ? ROLL_DUR_MINI : ROLL_DUR_NORMAL;
      if (boosterMovesActive > 0) dur *= 0.5;
      let t = Math.min(elapsed / dur, 1.0);
      t = 1 - Math.pow(1-t, 2.5); // Ease out

      const pos = new THREE.Vector3().lerpVectors(animStartPos, animEndPos, t);
      // Bounce Y curve
      pos.y += CUBE_S * 0.25 * Math.sin(Math.PI*t);
      // Carry the player with the platform for the duration of a platform roll.
      if (rollCarrier) pos.add(rollCarrier.position).sub(rollCarrierStart);
      playerCube.position.copy(pos);

      const quat = animStartQuat.clone();
      quat.slerp(new THREE.Quaternion().multiplyQuaternions(animDeltaQuat, animStartQuat), t);
      playerCube.quaternion.copy(quat);

      // spawn trail particles
      trailTimer += dt;
      if (trailTimer > 0.035) { trailTimer = 0; spawnTrailParticle(); }

      if (elapsed >= dur) {
        playerCube.position.copy(animEndPos);
        if (rollCarrier) {
          // Settle at the platform-carried landing and sync the grid cell to it
          // so the riding logic re-boards the correct cell next frame.
          playerCube.position.add(rollCarrier.position).sub(rollCarrierStart);
          playerGridPos.x = Math.round(playerCube.position.x);
          playerGridPos.z = Math.round(playerCube.position.z);
          rollCarrier = null;
        }
        playerCube.quaternion.copy(new THREE.Quaternion().multiplyQuaternions(animDeltaQuat, animStartQuat));
        isRolling = false;
        cameraTarget.copy(playerCube.position);
        onRollComplete();
      }
    }

    // Falling animation
    if (isFalling) {
      fallVelY += 14 * dt; // gravity
      playerCube.position.y -= fallVelY * dt;
      const size = isMini ? CUBE_S*0.5 : CUBE_S;

      // Re-scan the column beneath the player every frame and land on the
      // highest supporting block actually reached — including one the initial
      // fall target missed or that only arrived mid-fall (e.g. a moving
      // platform). Any solid element catches the player: a deeper fall onto a
      // load-bearing block is always a safe landing, never a death. Death is
      // reserved for the genuine void (no block anywhere below).
      const col = getBlocksInColumn(playerGridPos.x, playerGridPos.z);
      let landBlock = null;
      for (const b of col) {                  // sorted highest-first
        if (b.y >= playerGridPos.y) continue;  // ignore blocks at/above the launch level
        if (playerCube.position.y <= b.y + 0.5 + size/2) { landBlock = b; break; }
      }

      if (landBlock) {
        // Landed on a supporting element
        playerCube.position.y = landBlock.y + 0.5 + size/2;
        isFalling = false;
        playerGridPos.y = landBlock.y;
        audio.playLand();
        addShake(0.18);
        spawnLandingParticles(playerGridPos.x, playerGridPos.y, playerGridPos.z);
        // Run the landing cell's effects (switch / exit / hazard / ice …) but
        // NOT the fall branch of onRollComplete — the fall is over, so neutralise
        // the action first so the player is free to move again immediately
        // instead of being re-armed into another fall.
        playerCube.userData.rollAction = 'land';
        onRollComplete();
      } else if (playerCube.position.y < -8) {
        // Nothing beneath at all → the void
        respawnPlayer();
      }
    }

    // ─── ENEMIES ─────────────────────────────────────────────
    for (const en of enemies) {
      // Rainbow color cycle
      en.hue = (en.hue + dt * 0.55) % 1.0;
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
      if (!en.isRolling && !isLevelComplete) {
        en.moveTimer -= dt;
        if (en.moveTimer <= 0) {
          en.moveTimer = ENEMY_MOVE_INTERVAL;
          const step = enemyBFS(en);
          if (step) startEnemyRoll(en, step.dx, step.dz);
        }
      }

      // Collision with player. loseLife() rebuilds the level (and the enemies
      // array), so stop iterating the now-stale list immediately.
      if (!playerInvincible && !isLevelComplete && playerCube) {
        const sameCell = playerGridPos.x === en.grid.x &&
                         playerGridPos.y === en.grid.y &&
                         playerGridPos.z === en.grid.z;
        const touching = playerCube.position.distanceTo(en.cube.position) < CUBE_S * 1.05;
        if (sameCell || touching) { loseLife(); break; }
      }
    }

    // Player invincibility blink
    if (playerInvincible && playerCube) {
      playerInvincibleTimer -= dt;
      playerCube.visible = Math.floor(playerInvincibleTimer * 9) % 2 === 0;
      if (playerInvincibleTimer <= 0) {
        playerInvincible = false;
        playerCube.visible = true;
      }
    }
    // ─── END ENEMY ───────────────────────────────────────────

    // Camera targets follow player
    if (!isRolling && !isFalling && playerCube) cameraTarget.lerp(playerCube.position, CAM_LERP);
    else if (playerCube) cameraTarget.lerp(playerCube.position, CAM_LERP*0.6);

    cameraLookAt.lerp(cameraTarget, CAM_LERP*1.2);

    // Camera shake
    if (shakeIntensity > 0.001) {
      cameraShake.set((Math.random()-0.5)*shakeIntensity, (Math.random()-0.5)*shakeIntensity*0.5, 0);
      shakeIntensity *= 0.85;
    } else { cameraShake.set(0,0,0); shakeIntensity = 0; }

    const offset = new THREE.Vector3(7, 8.5, 8);
    const desCam = cameraLookAt.clone().add(offset).add(cameraShake);
    camera.position.lerp(desCam, CAM_LERP*0.7);
    camera.lookAt(cameraLookAt.clone().add(cameraShake));

    if (playerCube) {
      underGlow.position.lerp(new THREE.Vector3(playerCube.position.x, playerCube.position.y-0.4, playerCube.position.z), 0.1);
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
      if (keysPressed['KeyW'] || keysPressed['ArrowUp'])    editorCameraTarget.addScaledVector(fwd,  panSpeed * dt);
      if (keysPressed['KeyS'] || keysPressed['ArrowDown'])  editorCameraTarget.addScaledVector(fwd, -panSpeed * dt);
      if (keysPressed['KeyA'] || keysPressed['ArrowLeft'])  editorCameraTarget.addScaledVector(lft, -panSpeed * dt);
      if (keysPressed['KeyD'] || keysPressed['ArrowRight']) editorCameraTarget.addScaledVector(lft,  panSpeed * dt);
      if (keysPressed['KeyQ']) editorCameraYaw -= rotSpeed * dt;
      if (keysPressed['KeyE']) editorCameraYaw += rotSpeed * dt;
    }

    // Level Editor camera orbits
    const targetCamPos = new THREE.Vector3(
      editorCameraTarget.x + Math.sin(editorCameraYaw) * Math.cos(editorCameraPitch) * editorCameraZoom,
      editorCameraTarget.y + Math.sin(editorCameraPitch) * editorCameraZoom,
      editorCameraTarget.z + Math.cos(editorCameraYaw) * Math.cos(editorCameraPitch) * editorCameraZoom
    );
    camera.position.lerp(targetCamPos, 0.15);
    camera.lookAt(editorCameraTarget);
  }

  // Update particles
  for (let i=particles.length-1; i>=0; i--) {
    const p = particles[i]; p.userData.age += dt;
    if (p.userData.age >= p.userData.life) {
      effectsGroup.remove(p); if (p.geometry) p.geometry.dispose(); if (p.material) p.material.dispose();
      particles.splice(i,1); continue;
    }
    const prog = p.userData.age / p.userData.life;
    p.position.addScaledVector(p.userData.vel, dt);
    p.userData.vel.y -= 4 * dt; // gravity
    p.material.opacity = 1 - prog; p.scale.setScalar(1 - prog*0.7);
  }

  // Update trails
  for (let i=trailParts.length-1; i>=0; i--) {
    const p = trailParts[i]; p.userData.age += dt;
    if (p.userData.age >= p.userData.life) {
      effectsGroup.remove(p); if (p.geometry) p.geometry.dispose(); if (p.material) p.material.dispose();
      trailParts.splice(i,1); continue;
    }
    p.material.opacity = 0.45 * (1 - p.userData.age/p.userData.life);
    p.scale.setScalar(0.6 + 0.4*(1 - p.userData.age/p.userData.life));
  }

  // Animate prisms. prismsGroup also holds static enemy markers (no baseY) —
  // skip those so we don't write NaN into their position and cull them.
  for (const child of prismsGroup.children) {
    if (child.userData && child.userData.baseY !== undefined) {
      child.position.y = child.userData.baseY + Math.sin(now*2.5 + child.position.x*1.3)*0.12;
      child.rotation.y += 0.025; child.rotation.x += 0.015;
    }
  }

  // Animate exit ring
  if (exitRing) {
    const s = 1 + Math.sin(now*2.5)*0.08;
    exitRing.scale.lerp(new THREE.Vector3(s,s,s), 0.1);
    exitRing.rotation.z += 0.012;
    exitRing.position.y = exitPos.y + 0.5 + Math.sin(now*3)*0.04;
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

  // Title card: show for ~2 seconds, then fade out.
  const title = document.getElementById('title-splash');
  if (title) {
    setTimeout(() => title.classList.add('hide'), 2000);
    setTimeout(() => { title.style.display = 'none'; }, 2700);
  }

  // Briefly fade the credits splash in, then out.
  const splash = document.getElementById('intro-splash');
  if (splash) {
    requestAnimationFrame(() => splash.classList.add('show'));
    setTimeout(() => splash.classList.remove('show'), 5200);
    setTimeout(() => { splash.style.display = 'none'; }, 6100);
  }
})();

function setHelpOpen(open) {
  isHelpOpen = open;
  document.getElementById('help-overlay')?.classList.toggle('open', open);
}

// START
loadPreMadeLevel(0);
requestAnimationFrame(animate);

console.log('%c🟧 GOOSE — 3D & Level Editor Ready', 'color:#ff6600;font-size:18px;');
