import * as THREE from 'three';
import { TILE_SIZE, CUBE_S, ROLL_DUR_NORMAL, ROLL_DUR_MINI, CAM_LERP, BALANCE_WINDOW, COMBO_TIMEOUT } from './constants.js';
import { WORLDS, DEMO_LEVEL } from './levels-data.js';
import { AudioEngine } from './audio.js';
import {
  renderer, scene, camera, underGlow, starfield, starUniforms,
  matTileBase, matTileFragile, matTileIce, matTileSwitch, matTileTp, matTileExit,
  matCube, matPrism, matMiniPrism, matPrismGlow, matBridge, matSwitchPillar,
  matCrate, matPressurePlate, matDanger, matShaker, matBooster,
  matPlutonium, matPlutoniumGlow, matContainer,
  geoTile, geoThinTile, geoCube, geoPrism, geoRing, geoPillar, geoTrail,
  worldGroup, tilesGroup, prismsGroup, effectsGroup, bridgeGroup
} from './scene.js';
import { Level3D, MovingPlatform, serializeLevel, deserializeLevel } from './level.js';

const audio = new AudioEngine();

/* ═══ GAME & EDITOR STATE ═══ */
let currentLevelIdx = 0;
let premadeLevels = []; // raw JSON strings fetched from /level (1.json, 2.json, …)
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
let rollPreState = null; // snapshot of move/combo bookkeeping so a mid-step reverse can undo it
let boosterMovesActive = 0;
let moveCount = 0;
let placedBlocksCount = 0;
let gameTimer = 0;
let comboCount = 0;
let comboTimer = 0;
let elapsedTime = 0;
let miniTimer = 0;
let isCarryingPlutonium = false;
let plutoniumTimer = 30.0;
let depositedPlutonium = 0;
let containerMeshes = [];
let hasCollectedPlutoniumThisRun = false;
let fallVelY = 0;

let cameraTarget = new THREE.Vector3(2, 0, 2);
let cameraLookAt = new THREE.Vector3(2, 0, 2);
let cameraShake = new THREE.Vector3();
let shakeIntensity = 0;

// Gameplay "peek": hold left mouse and drag to nudge the view a little; the
// offsets ease back to the default angle the moment the button is released.
let peekActive = false;
let peekLast = { x: 0, y: 0 };
let peekYaw = 0;    // horizontal nudge (radians), eased back to 0
let peekPitch = 0;  // vertical nudge (radians), eased back to 0

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
let completeAnimStartTime = 0;
let completeTimeoutId = null;

/* ═══ ENEMY STATE ═══ */
// Enemies are placed in the editor (Level3D.enemies) and may appear multiple
// times. Each live enemy is its own object so several can chase at once.
let enemies = [];              // live chasers spawned during gameplay/playtest
let enemyMarkers = new Map();  // key -> mesh, static markers shown in pure edit mode
const ENEMY_MOVE_INTERVAL = 0.38;

/* ═══ LIVES STATE ═══ */
let playerLives = 5;
const MAX_LIVES = 5;
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
let sliceModeActive = false; // layer slicing off by default in the editor
const rulerMinY = -3, rulerMaxY = 10;

let editorCameraTarget = new THREE.Vector3(0, 0, 0);
let editorCameraYaw = Math.PI/4;
let editorCameraPitch = 0.8; 
let editorCameraZoom = 15;
let isDraggingCamera = false;
let dragStartMouse = { x:0, y:0 };
let isPainting = false;
let rightDragMoved = false; // suppress erase-on-release after a camera drag

let isDrawingPlane = false;
let planeStartPos = null;
let planeEndPos = null;
let editorPlanePreview = null;

let linkerSourceKey = null; // Stored switch/tp for linking

// Compound objects: while "O" is held, every block placed is tagged with the
// same group id (stored in block.properties.group). Linking a switch/plate to
// any grouped block expands the trigger to all triggerable members.
let currentGroupId = null; // active group id while O is held, else null

// Editor undo history — serialized level snapshots, newest last (max 250).
let undoStack = [];
const UNDO_LIMIT = 250;

// Batch editing state (suppresses expensive slicing/wire draws/rebuilds during loops)
let batchEditing = false;
let batchRebuildNeeded = false;


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
  if (playerCube) { worldGroup.remove(playerCube); playerCube = null; }
  if (exitRing) { worldGroup.remove(exitRing); exitRing = null; }
  enemies.forEach(en => { worldGroup.remove(en.cube); disposeMaterial(en.cube.material); });
  enemies = [];
  enemyMarkers.clear(); // marker meshes live in prismsGroup, disposed by the group loop above
  particles.length = 0; trailParts.length = 0;

  movingPlatformsList.forEach(mp => mp.dispose());
  movingPlatformsList = [];
  ridingPlatform = null;
  rollCarrier = null;
  activeBlocks.clear();
  activePrisms.clear();
  containerMeshes = [];
  switchMap.clear();
  teleporterMap.clear();
  switchStates.clear();
  linkerSourceKey = null;
  currentGroupId = null;
  completeAnimStartTime = 0;
  if (typeof starfield !== 'undefined' && starfield) {
    starfield.scale.setScalar(1.0);
    starfield.rotation.set(0, 0, 0);
  }
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
  isCarryingPlutonium = false;
  plutoniumTimer = level3D.plutoniumTimeLimit ?? 30.0;
  depositedPlutonium = 0;
  hasCollectedPlutoniumThisRun = false;
  const phud = document.getElementById('plutonium-hud-bar');
  if (phud) phud.style.display = 'none';

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
  playTypewriterTitle(document.getElementById('level-name'), level3D.name);
  document.getElementById('level-number').textContent = isEditMode ? 'E' : (isCustomLevel ? 'C' : currentLevelIdx + 1);
  placedBlocksCount = 0;
  updatePrismUI(); updatePlutoniumUI(); updateMoveUI(); updateTimerUI(); updateBuildUI();
  if (document.getElementById('level-build-limit-input')) {
    document.getElementById('level-build-limit-input').value = level3D.buildBlocksLimit ?? 10;
  }
  document.getElementById('mini-hud-bar').style.display = 'none';

  spawnEntranceParticles(playerGridPos.x, playerGridPos.y, playerGridPos.z);
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
  transparencyUpdateTimer = 0;
  updateDynamicTransparency();
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
  else if (type === 'container') mat = matContainer;

  const isExit = (x === exitPos.x && y === exitPos.y && z === exitPos.z);
  if (isExit) mat = matTileExit;

  // Thin bridge visual
  const geo = type === 'bridge' ? geoThinTile : geoTile;
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
  else if (type === 'container') eColor = '#ffcc00';

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
    containerMeshes.push(mesh);
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
  mesh.position.set(px, py + 0.55, pz);
  mesh.castShadow = true;
  mesh.userData = { key, type: p.type, isMiniPrism, isPlutonium, baseY: py + 0.55 };
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

function spawnLevelCompleteExplosion() {
  const colors = ['#ff0055', '#00ffaa', '#ffaa00', '#00ccff', '#ff00ff', '#ffff00', '#ffffff'];
  const pos = new THREE.Vector3(exitPos.x, exitPos.y + 0.5, exitPos.z);
  for (let i = 0; i < 120; i++) {
    const color = colors[Math.floor(Math.random() * colors.length)];
    const mat = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending
    });
    const geo = new THREE.OctahedronGeometry(0.08 + Math.random() * 0.08, 0);
    const p = new THREE.Mesh(geo, mat);
    p.position.copy(pos);
    
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const speed = 4 + Math.random() * 7;
    const vel = new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta) * speed,
      Math.sin(phi) * Math.sin(theta) * speed + 2,
      Math.cos(phi) * speed
    );
    
    p.userData = {
      vel: vel,
      life: 1.5 + Math.random() * 1.0,
      age: 0,
      spin: new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10)
    };
    effectsGroup.add(p);
    particles.push(p);
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
    if (p.type !== 'miniprism' && p.type !== 'plutonium') {
      total++; if (p.collected) collect++;
    }
  });
  document.getElementById('prism-count').textContent = `${collect}/${total}`;
}
function updatePlutoniumUI() {
  let totalPlutonium = 0;
  activePrisms.forEach(p => {
    if (p.type === 'plutonium') totalPlutonium++;
  });
  const display = document.getElementById('plutonium-display');
  if (display) {
    if (totalPlutonium > 0) {
      display.style.display = 'flex';
      document.getElementById('plutonium-count').textContent = `${depositedPlutonium}/${totalPlutonium}`;
    } else {
      display.style.display = 'none';
    }
  }
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

let typewriterInterval = null;
function playTypewriterTitle(el, text) {
  if (typewriterInterval) clearInterval(typewriterInterval);
  el.textContent = '';
  let i = 0;
  typewriterInterval = setInterval(() => {
    if (i < text.length) {
      el.textContent += text[i];
      audio.playTypewriterTick();
      i++;
    } else {
      clearInterval(typewriterInterval);
      typewriterInterval = null;
    }
  }, 45);
}

// ── Compound-object grouping indicator (active while O is held) ──
function groupMemberCount(gid) {
  if (gid === null || gid === undefined || !activeLevel) return 0;
  let n = 0;
  activeLevel.blocks.forEach(b => { if (b.properties && b.properties.group === gid) n++; });
  return n;
}
function refreshGroupingIndicator() {
  const el = document.getElementById('group-count');
  if (!el) return;
  const n = groupMemberCount(currentGroupId);
  el.textContent = `${n} block${n === 1 ? '' : 's'}`;
}
function setGroupingUI(active) {
  document.getElementById('grouping-indicator').classList.toggle('active', active);
  document.getElementById('grouping-vignette').classList.toggle('active', active);
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
  const targets = switchMap.get(key);
  if (!targets) return;

  if (activeState) {
    audio.playBridgeExtend();
  } else {
    audio.playBridgeRetract();
  }

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

// Whether the in-progress step can be aborted and rolled back to its origin
// cell. Limited to plain ground moves on static terrain so reversing is always
// safe (no half-pushed crates, no broken fragile origin, no platform drift).
function canReverseRoll() {
  if (!isRolling || !playerCube) return false;
  const action = playerCube.userData.rollAction;
  if (action !== 'roll' && action !== 'climb' && action !== 'descend') return false;
  if (rollCarrier) return false;                       // platform-relative rolls
  if (playerCube.userData.rollPushedCrate) return false;
  const origin = activeBlocks.get(`${rollStartGridPos.x},${rollStartGridPos.y},${rollStartGridPos.z}`);
  if (!origin || origin.broken || origin.type === 'fragile') return false; // origin must still hold us
  return true;
}

// Abort the current step and roll the cube back to the cell it left, so the
// player can change their mind while a move is still animating.
function reverseCurrentRoll() {
  const origStartQuat = animStartQuat.clone();          // orientation at step start
  const backWorld = getPlayerWorldPos(rollStartGridPos.x, rollStartGridPos.y, rollStartGridPos.z, isMini);

  animStartTime = performance.now()/1000;
  animStartPos.copy(playerCube.position);               // from the current mid-roll pose …
  animEndPos.copy(backWorld);                           // … back to the origin cell
  const curQuat = playerCube.quaternion.clone();
  animStartQuat.copy(curQuat);
  // delta * cur === origStart, so the cube settles at its exact pre-step orientation.
  animDeltaQuat.copy(origStartQuat).multiply(curQuat.clone().invert());
  animFromEdge = false;
  rollCarrier = null;

  // Return to the origin cell and roll back the step's bookkeeping.
  playerGridPos = { ...rollStartGridPos };
  if (rollPreState) {
    moveCount = rollPreState.moveCount;
    comboCount = rollPreState.comboCount;
    comboTimer = rollPreState.comboTimer;
    lastMoveDir = { ...rollPreState.lastMoveDir };
    updateMoveUI(); updateComboUI();
  }
  audio.playRoll();
  playerCube.userData.rollAction = 'reverse';
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
      playerCube.userData.rollPushedCrate = true; // can't reverse: the crate already moved
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
  // Snapshot bookkeeping so a mid-step reversal can cleanly undo this step.
  rollPreState = { moveCount, comboCount, comboTimer, lastMoveDir: { ...lastMoveDir } };
  playerCube.userData.rollPushedCrate = false;
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

  // Combo (visual scoring only — the extra arpeggio cue was removed)
  const sameDir = (dirX === lastMoveDir.x && dirZ === lastMoveDir.z);
  if (sameDir && comboTimer > 0) {
    comboCount++;
  } else {
    comboCount = 1;
  }
  comboTimer = COMBO_TIMEOUT;
  lastMoveDir = { x:dirX, z:dirZ };
  updateComboUI();

  // Movement sound on every step.
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

  if (action === 'reverse') {
    // Back on the origin cell with the pre-step orientation already restored by
    // the animation's end-snap — nothing further to resolve.
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
    if (action === 'fall') {
      audio.playLeap();
    } else {
      audio.playFall();
    }
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
    
    if (block.type === 'container' && isCarryingPlutonium) {
      isCarryingPlutonium = false;
      depositedPlutonium++;
      const phud = document.getElementById('plutonium-hud-bar');
      if (phud) phud.style.display = 'none';
      audio.playCollect();
      flashScreen('#00ffaa');
      showMessage('PLUTONIUM DEPOSITED IN CONTAINER!', 2.5);

      updatePlutoniumUI();

      // New level win condition: immediately win if all plutonium elements are deposited
      let totalPlutonium = 0;
      activePrisms.forEach(p => {
        if (p.type === 'plutonium') totalPlutonium++;
      });
      let totalContainers = 0;
      activeBlocks.forEach(b => {
        if (b.type === 'container') totalContainers++;
      });
      if (totalPlutonium > 0 && totalContainers > 0 && depositedPlutonium >= totalPlutonium) {
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
      boosterMovesActive = 4;
      showMessage('SPEED BOOST ACTIVE (4 MOVES)!', 1.5);
      audio.playBooster();
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
    if (prism.type === 'plutonium') {
      flashScreen('#d946ef');
      if (prism.mesh) {
        spawnCollectParticles(prism.mesh.position);
        const mesh = prism.mesh;
        prism.mesh.material = matPlutoniumGlow.clone();
        setTimeout(() => prismsGroup.remove(mesh), 200);
      }
      isCarryingPlutonium = true;
      plutoniumTimer = activeLevel.plutoniumTimeLimit ?? 30.0;
      if (!hasCollectedPlutoniumThisRun) {
        hasCollectedPlutoniumThisRun = true;
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
  let totalPlutonium = 0;
  activePrisms.forEach(p => {
    if (p.type === 'plutonium') totalPlutonium++;
    else if (p.type !== 'miniprism' && !p.collected) remaining++;
  });
  if (remaining === 0) {
    let totalContainers = 0;
    activeBlocks.forEach(b => {
      if (b.type === 'container') totalContainers++;
    });
    if (totalPlutonium > 0 && totalContainers > 0 && depositedPlutonium < totalPlutonium) {
      showMessage(`DEPOSIT ALL PLUTONIUM FIRST! (${depositedPlutonium}/${totalPlutonium})`, 2.0);
      return;
    }
    completeLevel();
  }
}

function advanceCompletedLevel() {
  if (completeTimeoutId) {
    clearTimeout(completeTimeoutId);
    completeTimeoutId = null;
  }
  document.getElementById('complete-overlay').classList.remove('show');
  if (isEditMode) {
    exitPlaytestMode();
  } else {
    currentLevelIdx = (currentLevelIdx + 1) % premadeLevels.length;
    loadPreMadeLevel(currentLevelIdx);
  }
}

function completeLevel() {
  isLevelComplete = true;
  audio.playComplete();
  spawnLevelCompleteExplosion();
  completeAnimStartTime = performance.now() / 1000;

  const stars = moveCount <= activeLevel.par ? 3 : (moveCount <= activeLevel.par * 1.5 ? 2 : 1);
  document.getElementById('complete-overlay').classList.add('show');
  document.getElementById('complete-text').textContent = isEditMode ? 'PLAYTEST COMPLETE' : `LEVEL ${currentLevelIdx+1} CLEAR`;
  
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

  if (completeTimeoutId) clearTimeout(completeTimeoutId);
  completeTimeoutId = setTimeout(() => {
    advanceCompletedLevel();
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
  const world = Math.min(4, Math.floor((difficulty - 1) / 2));
  return buildArchitect(P, `Architect · Lvl ${difficulty}`, world);
}

// AI Pro2 — toggle-driven Architect. The 10 criteria switch whole element
// families on/off; `size` (1..10) scales how much of each enabled family
// appears. The shared builder still guarantees a solvable level.
function generateArchitectLevel2(opts) {
  const size = Math.max(1, Math.min(10, opts.size || 5));
  const P = architectParams(size);
  if (!opts.verticality) { P.maxFloors = 0; P.floorChance = 0; }
  if (!opts.teleporters) { P.teleporters = 0; }
  if (!opts.switchGates) { P.switchGates = 0; }
  if (!opts.movers)      { P.movers = 0; }
  if (!opts.ice)         { P.iceChance = 0; }
  if (!opts.enemies)     { P.enemies = 0; }
  if (!opts.collapse)    { P.fragileChance = 0; P.shakerChance = 0; }
  if (!opts.danger)      { P.dangerChance = 0; }
  // Hazards (collapse/danger) and bonus mini-prisms live only on optional
  // branch cells. If the player wants those families but turned exploration
  // branches off, keep a few short spurs to host them; otherwise honour a
  // fully linear layout.
  if (!opts.branching) {
    const needHosts = opts.collapse || opts.danger;
    P.branches = needHosts ? Math.max(2, Math.round(size / 3)) : 0;
    P.branchLen = Math.min(P.branchLen, 3);
    P.miniprisms = needHosts ? Math.min(P.miniprisms, 3) : 0;
  }
  // Crate puzzles are a new module not covered by architectParams.
  P.crates = opts.crates ? Math.max(1, Math.round(size / 3)) : 0;
  const world = Math.min(4, Math.floor((size - 1) / 2));
  return buildArchitect(P, `Architect2 · Lvl ${size}`, world);
}

// AI Pro3 — quantified Architect. Each criterion carries an exact quantity, so
// the user dials in precise amounts (e.g. "exactly 4 crate puzzles"). Unchecked
// element families switch off; unchecked tuning knobs fall back to the size
// preset. The shared builder still guarantees a solvable level.
function generateArchitectLevel3(opts) {
  const clamp = (v, lo, hi) => isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : lo;
  const size = clamp(opts.size || 5, 1, 10);
  const P = architectParams(size);

  // ── Tuning knobs: use the supplied value, else keep the size-based default ──
  if (opts.pathLength   != null) P.backboneLength = clamp(opts.pathLength, 20, 250);
  if (opts.arenaSize    != null) P.halfSize       = clamp(opts.arenaSize, 5, 20);
  if (opts.branchLen    != null) P.branchLen      = clamp(opts.branchLen, 2, 10);
  if (opts.parTightness != null) P.parFactor      = 1.4 - (clamp(opts.parTightness, 1, 10) - 1) / 9 * 0.8; // 1.4 → 0.6
  P.moverSpeed = (opts.moverSpeed != null)
    ? 0.6 + (clamp(opts.moverSpeed, 1, 10) - 1) / 9 * 1.8 // 0.6 → 2.4
    : 1.2;

  // ── Verticality: floor count, or flat when off ──
  if (opts.verticality) { P.maxFloors = clamp(opts.floors, 1, 8); P.floorChance = Math.max(P.floorChance, 0.22); }
  else { P.maxFloors = 0; P.floorChance = 0; }

  // ── Element families: exact counts, or 0 when the family is off ──
  P.branches    = opts.branching   ? clamp(opts.branches, 1, 30)    : 0;
  P.teleporters = opts.teleporters ? clamp(opts.teleporters, 1, 10) : 0;
  P.switchGates = opts.switchGates ? clamp(opts.switchGates, 1, 10) : 0;
  P.movers      = opts.movers      ? clamp(opts.movers, 1, 12)      : 0;
  P.crates      = opts.crates      ? clamp(opts.crates, 1, 12)      : 0;
  P.enemies     = opts.enemies     ? clamp(opts.enemies, 1, 15)     : 0;
  P.prisms      = opts.prisms      ? clamp(opts.prisms, 1, 30)      : 0;
  P.miniprisms  = opts.miniprisms  ? clamp(opts.miniprisms, 1, 20)  : 0;

  // ── Hazards & boosters: drive the builder via EXACT counts, not chances ──
  P.iceChance = 0; P.boosterChance = 0; P.fragileChance = 0; P.shakerChance = 0; P.dangerChance = 0;
  P.collapseCount = opts.collapse ? clamp(opts.collapseTiles, 1, 30) : 0;
  P.iceCount      = opts.ice      ? clamp(opts.iceTiles, 1, 30)      : 0;
  P.dangerCount   = opts.danger   ? clamp(opts.dangerTiles, 1, 30)   : 0;
  P.boosterCount  = opts.boosters ? clamp(opts.boosters, 1, 15)      : 0;

  // ── New AI Pro3 sections ──
  P.secretRooms  = opts.secretRooms  ? clamp(opts.secretRooms, 1, 8)  : 0;
  P.iceCorridors = opts.iceCorridors ? clamp(opts.iceCorridors, 1, 8) : 0;
  P.plutonium    = opts.plutonium    ? clamp(opts.plutonium, 1, 10)   : 0;
  P.plutoniumTime = opts.plutoniumTime ? clamp(opts.plutoniumTime, 5, 180) : 30;

  // Collapse/danger tiles live only on optional branch cells. If those are
  // requested but branching is off, carve a few short host spurs for them.
  if (!P.branches && (P.collapseCount || P.dangerCount)) {
    P.branches = Math.max(2, Math.round((P.collapseCount + P.dangerCount) / 3));
    P.branchLen = Math.min(P.branchLen, 4);
  }

  const world = clamp(Math.floor((size - 1) / 2), 0, 4);
  const lvl = buildArchitect(P, `Architect3 · Lvl ${size}`, world);
  lvl.buildBlocksLimit = opts.buildLimit !== undefined ? opts.buildLimit : 10;
  lvl.plutoniumTimeLimit = P.plutoniumTime;
  return lvl;
}

// Shared Architect builder: turns a fully-resolved parameter set into a
// guaranteed-solvable level. Used by both AI Pro (difficulty preset) and
// AI Pro2 (per-criterion toggles).
function buildArchitect(P, name, world) {
  const lvl = new Level3D();
  lvl.name = name;
  lvl.world = world;

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
    setBlock(g1, 'moving', { targetX: g2.x, targetY: g2.y, targetZ: g2.z, speed: P.moverSpeed || 1.2 });
    setBlock(plat, 'normal');
    lvl.prisms.set(`${plat.x},${plat.y},${plat.z}`, { type: 'miniprism' });
  }

  // ── 5b) Crate & pressure-plate puzzles ──
  // Push the crate one cell onto the plate to open a plate-gated bridge that
  // leads to a bonus mini-prism. Built entirely on fresh off-path cells (flat,
  // at the anchor's height), so the critical route is never affected and the
  // reward is always optional — no softlock risk.
  const perpOf = d => ({ dx: d.dz, dz: d.dx });
  const colFree = c => inBounds(c.x, c.z) && !occ.has(`${c.x},${c.z}`);
  let cratesPlaced = 0;
  for (let a = 0; cratesPlaced < (P.crates || 0) && a < (P.crates || 0) * 40 + 40; a++) {
    const anchor = path[2 + Math.floor(Math.random() * Math.max(1, path.length - 3))];
    const anchorKey = `${anchor.x},${anchor.y},${anchor.z}`;
    if (anchorKey === startKey || anchorKey === exitKey) continue;
    const d = dirs[Math.floor(Math.random() * 4)];
    const pp = perpOf(d);
    const p = Math.random() < 0.5 ? pp : { dx: -pp.dx, dz: -pp.dz };
    const y = anchor.y;
    const C0 = { x: anchor.x + d.dx,     y, z: anchor.z + d.dz };     // floor + crate (sits at y+1)
    const C1 = { x: anchor.x + 2 * d.dx, y, z: anchor.z + 2 * d.dz }; // pressure plate (push target)
    const B0 = { x: anchor.x + p.dx,     y, z: anchor.z + p.dz };     // plate-gated bonus bridge
    const R  = { x: anchor.x + 2 * p.dx, y, z: anchor.z + 2 * p.dz }; // reward: floor + mini-prism
    if (![C0, C1, B0, R].every(colFree)) continue;
    [C0, C1, B0, R].forEach(c => occ.set(`${c.x},${c.z}`, c.y));
    setBlock(C0, 'normal');
    setBlock({ x: C0.x, y: y + 1, z: C0.z }, 'pushable'); // the crate, resting on C0's floor
    setBlock(C1, 'pressureplate');
    setBlock(B0, 'bridge');
    setBlock(R, 'normal');
    lvl.links.push({ type: 'switch-trigger', from: `${C1.x},${C1.y},${C1.z}`, to: `${B0.x},${B0.y},${B0.z}` });
    lvl.prisms.set(`${R.x},${R.y},${R.z}`, { type: 'miniprism' });
    cratesPlaced++;
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

  // ── 8b) Geheim-Kammern (AI Pro3): enclosed bonus pockets off the backbone ──
  // A 1-cell entrance opening into a 2-cell nook with a mini-prism, built on
  // fresh off-path cells at the anchor's height — always optional, never blocks
  // the critical route (mirrors the crate/mover placement contract).
  let roomsPlaced = 0;
  for (let a = 0; roomsPlaced < (P.secretRooms || 0) && a < (P.secretRooms || 0) * 40 + 40; a++) {
    const anchor = path[2 + Math.floor(Math.random() * Math.max(1, path.length - 3))];
    const anchorKey = `${anchor.x},${anchor.y},${anchor.z}`;
    if (anchorKey === startKey || anchorKey === exitKey) continue;
    const d = dirs[Math.floor(Math.random() * 4)];
    const pp = perpOf(d);
    const p = Math.random() < 0.5 ? pp : { dx: -pp.dx, dz: -pp.dz };
    const y = anchor.y;
    const E  = { x: anchor.x + d.dx,            y, z: anchor.z + d.dz };            // entrance
    const R1 = { x: anchor.x + 2 * d.dx,        y, z: anchor.z + 2 * d.dz };        // reward cell
    const R2 = { x: anchor.x + 2 * d.dx + p.dx, y, z: anchor.z + 2 * d.dz + p.dz }; // side nook
    if (![E, R1, R2].every(colFree)) continue;
    [E, R1, R2].forEach(c => occ.set(`${c.x},${c.z}`, c.y));
    setBlock(E, 'normal'); setBlock(R1, 'normal'); setBlock(R2, 'normal');
    lvl.prisms.set(`${R1.x},${R1.y},${R1.z}`, { type: 'miniprism' });
    roomsPlaced++;
  }

  // ── 8c) Exact-count hazard placement (AI Pro3) ──
  // When explicit counts are supplied, place precisely that many tiles instead
  // of the chance-based styling above. Lethal/collapsing tiles go only on
  // optional branch cells; ice/booster only on non-critical backbone cells.
  const optBackbone = () => path.filter(c => {
    const k = `${c.x},${c.y},${c.z}`;
    return k !== startKey && k !== exitKey && !lvl.prisms.has(k) && lvl.blocks.get(k) && lvl.blocks.get(k).type === 'normal';
  });
  const optBranch = () => branchCells.filter(c => {
    const k = `${c.x},${c.y},${c.z}`;
    return !lvl.prisms.has(k) && lvl.blocks.get(k) && lvl.blocks.get(k).type === 'normal';
  });
  const placeExact = (pool, count, assign) => {
    const shuffled = pool.sort(() => 0.5 - Math.random());
    let placed = 0;
    for (const c of shuffled) {
      if (placed >= count) break;
      const k = `${c.x},${c.y},${c.z}`;
      const b = lvl.blocks.get(k);
      if (!b || b.type !== 'normal' || lvl.prisms.has(k)) continue;
      assign(b, c, k);
      placed++;
    }
  };
  // Collapse = fragile + shaker, split roughly in half (branch cells only).
  if (typeof P.collapseCount === 'number' && P.collapseCount > 0) {
    let n = 0;
    placeExact(optBranch(), P.collapseCount, b => { b.type = (n++ % 2 === 0) ? 'fragile' : 'shaker'; });
  }
  if (typeof P.dangerCount === 'number' && P.dangerCount > 0) {
    placeExact(optBranch(), P.dangerCount, b => { b.type = 'danger'; });
  }
  if (typeof P.iceCount === 'number' && P.iceCount > 0) {
    // Prefer backbone, spill onto branches if the path runs short.
    placeExact(optBackbone().concat(optBranch()), P.iceCount, b => { b.type = 'ice'; });
  }
  if (typeof P.boosterCount === 'number' && P.boosterCount > 0) {
    placeExact(optBackbone(), P.boosterCount, b => { b.type = 'booster'; });
  }

  // ── 8d) Eis-Korridore (AI Pro3): long straight slides along the backbone ──
  // Convert short collinear, same-height runs of non-critical backbone cells to
  // ice, for sustained sliding (distinct from the scattered ice above).
  if (P.iceCorridors > 0) {
    const corrLen = 3;
    const starts = [];
    for (let i = 1; i + corrLen <= path.length; i++) starts.push(i);
    starts.sort(() => 0.5 - Math.random());
    const used = new Set();
    let corrPlaced = 0;
    for (const i of starts) {
      if (corrPlaced >= P.iceCorridors) break;
      const run = path.slice(i, i + corrLen);
      const stepX = run[1].x - run[0].x, stepZ = run[1].z - run[0].z;
      let ok = true;
      for (let j = 0; j < run.length; j++) {
        const c = run[j], k = `${c.x},${c.y},${c.z}`;
        const collinear = j === 0 || (c.x - run[j - 1].x === stepX && c.z - run[j - 1].z === stepZ && c.y === run[0].y);
        const b = lvl.blocks.get(k);
        if (used.has(k) || k === startKey || k === exitKey || lvl.prisms.has(k) || !b || b.type !== 'normal' || !collinear) { ok = false; break; }
      }
      if (!ok) continue;
      run.forEach(c => { const k = `${c.x},${c.y},${c.z}`; lvl.blocks.get(k).type = 'ice'; used.add(k); });
      corrPlaced++;
    }
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

  // ── 9.5) Plutonium & Container placement (AI Pro3) ──
  if (P.plutonium && P.plutonium > 0) {
    const possiblePlutoniumCells = path.filter(c => {
      const k = `${c.x},${c.y},${c.z}`;
      return k !== startKey && k !== exitKey && lvl.blocks.get(k).type === 'normal' && !lvl.prisms.has(k);
    }).sort(() => 0.5 - Math.random());

    const numPlutonium = Math.min(P.plutonium, possiblePlutoniumCells.length);
    for (let i = 0; i < numPlutonium; i++) {
      const c = possiblePlutoniumCells[i];
      lvl.prisms.set(`${c.x},${c.y},${c.z}`, { type: 'plutonium' });
    }

    const possibleContainerCells = path.filter(c => {
      const k = `${c.x},${c.y},${c.z}`;
      return k !== startKey && k !== exitKey && lvl.blocks.get(k).type === 'normal' && !lvl.prisms.has(k);
    }).sort(() => 0.5 - Math.random());

    if (possibleContainerCells.length > 0) {
      const c = possibleContainerCells[0];
      setBlock(c, 'container');
    }
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
  audio.playUndo();
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

  // Add Transparent Grid Plane (disabled at user request to avoid transparency)
  const planeGeo = new THREE.PlaneGeometry(50, 50);
  const planeMat = new THREE.MeshBasicMaterial({ visible: false });
  editorGridPlane = new THREE.Mesh(planeGeo, planeMat);
  editorGridPlane.rotation.x = -Math.PI/2;
  editorGridPlane.position.set(0.5, editY - 0.49, 0.5);
  scene.add(editorGridPlane);

  // Add Ghost Block (wireframe representation to avoid transparency)
  editorGhostBlock = new THREE.Mesh(geoTile, new THREE.MeshBasicMaterial({ color: 0x00ffcc, wireframe: true }));
  scene.add(editorGhostBlock);

  // Add Plane Preview (wireframe box helper shown while drawing a rectangular area with V held)
  editorPlanePreview = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x00ffaa, wireframe: true, depthTest: false })
  );
  editorPlanePreview.visible = false;
  scene.add(editorPlanePreview);

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
  currentGroupId = null;
  setGroupingUI(false);
  document.getElementById('editor-ui').style.display = 'none';
  document.getElementById('hud').style.display = 'flex';
  document.getElementById('editor-tooltip').style.display = 'none';

  if (editorGridHelper) { scene.remove(editorGridHelper); editorGridHelper = null; }
  if (editorGridPlane) { scene.remove(editorGridPlane); editorGridPlane = null; }
  if (editorGhostBlock) { scene.remove(editorGhostBlock); editorGhostBlock = null; }
  if (editorWiresGroup) { scene.remove(editorWiresGroup); editorWiresGroup = null; }
  if (editorPlanePreview) {
    scene.remove(editorPlanePreview);
    editorPlanePreview.geometry.dispose();
    editorPlanePreview.material.dispose();
    editorPlanePreview = null;
  }

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
        setMeshOpacity(b.mesh, 1.0, true);
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
      const isBelow = (sliceModeActive && b.y < editY);
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
  activePrisms.forEach((p, k) => {
    if (!p.mesh) return;
    const py = k.split(',').map(Number)[1]; // key is "x,y,z" → y is the height
    if (sliceModeActive && py > editY) {
      p.mesh.visible = false;
    } else {
      p.mesh.visible = true;
      p.mesh.material.transparent = false;
      p.mesh.material.opacity = 1.0;
    }
  });
  enemyMarkers.forEach((m, k) => {
    const ey = k.split(',').map(Number)[1];
    if (sliceModeActive && ey > editY) {
      m.visible = false;
    } else {
      m.visible = true;
      m.material.transparent = false;
      m.material.opacity = 1.0;
    }
  });
  movingPlatformsList.forEach(mp => {
    const mpy = Math.round(mp.position.y);
    if (sliceModeActive && mpy > editY) {
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
  xrayMode = !xrayMode;
  audio.playXrayToggle(xrayMode);
  updateEditorSlicing();        // editor: applies / restores slicing opacity
  updateDynamicTransparency();  // play: apply (or clear) the see-through pass at once
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
  audio.playPauseToggle(isPaused);
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
    disposeMaterial(c.material);
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
      const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: 0xffaa00, dashSize: 0.18, gapSize: 0.12, opacity: 1.0, transparent: false }));
      line.computeLineDistances();
      editorWiresGroup.add(line);
    });
  });

  // While grouping (O held), wrap every member of the active group in a bright
  // orange wireframe box so it's obvious which blocks are being combined.
  if (currentGroupId !== null) {
    const boxGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.12, 1.12, 1.12));
    activeLevel.blocks.forEach(b => {
      if (!b.properties || b.properties.group !== currentGroupId) return;
      const yOff = (b.type === 'bridge') ? 0.4 : 0;
      const box = new THREE.LineSegments(boxGeo, new THREE.LineBasicMaterial({ color: 0xffbb33 }));
      box.position.set(b.x, b.y + yOff, b.z);
      editorWiresGroup.add(box);
    });
  }

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

const BLOCK_TOOLS = ['normal', 'fragile', 'ice', 'switch', 'bridge', 'teleporter', 'moving', 'pushable', 'pressureplate', 'danger', 'shaker', 'booster', 'container'];

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
      disposeMaterial(m.material);
      m.children.forEach(ch => { if (ch.geometry) ch.geometry.dispose(); disposeMaterial(ch.material); });
    }
    enemyMarkers.delete(key);
    removed = true;
  }
  if (kinds.includes('prism') && activeLevel.prisms.has(key)) {
    activeLevel.prisms.delete(key);
    const p = activePrisms.get(key);
    if (p && p.mesh) { prismsGroup.remove(p.mesh); disposeMaterial(p.mesh.material); }
    activePrisms.delete(key);
    removed = true;
  }
  if (kinds.includes('block') && activeLevel.blocks.has(key)) {
    const hasLinks = activeLevel.links.some(l => l.from === key || l.to === key || l.k1 === key || l.k2 === key);
    activeLevel.blocks.delete(key);
    if (hasLinks) {
      // Removing a linked block changes trigger wiring — full rebuild
      activeLevel.links = activeLevel.links.filter(l => l.from !== key && l.to !== key && l.k1 !== key && l.k2 !== key);
      if (!batchEditing) {
        buildLevel3D(activeLevel);
        drawEditorWires();
      } else {
        batchRebuildNeeded = true;
      }
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
        disposeMaterial(b.mesh.material);
        b.mesh.children.forEach(ch => { disposeMaterial(ch.material); });
      }
      activeBlocks.delete(key);
    }
    removed = true;
    if (!batchEditing) {
      drawEditorWires();
    }
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
  if (!batchEditing) {
    updateEditorSlicing();
    // While grouping (O held), give live audio + visual feedback per added block.
    if (currentGroupId !== null) {
      audio.playGroupAdd(groupMemberCount(currentGroupId));
      refreshGroupingIndicator();
      drawEditorWires();
    }
  }
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
  audio.playPlace('start');
}

function editorFillPlane(y, type) {
  batchEditing = true;
  batchRebuildNeeded = false;
  let placedAny = false;

  for (let x = -25; x <= 25; x++) {
    for (let z = -25; z <= 25; z++) {
      if (editorPlaceBlock(x, y, z, type)) {
        placedAny = true;
      }
    }
  }

  batchEditing = false;
  if (batchRebuildNeeded) {
    buildLevel3D(activeLevel);
  } else if (placedAny) {
    updateEditorSlicing();
  }
  drawEditorWires();
}

function editorClearPlane(y) {
  batchEditing = true;
  batchRebuildNeeded = false;
  let erasedAny = false;

  const keysToErase = [];
  activeLevel.blocks.forEach((b, k) => {
    if (b.y === y) keysToErase.push({ key: k, kinds: ['block'] });
  });
  activeLevel.prisms.forEach((p, k) => {
    const py = k.split(',').map(Number)[1];
    if (py === y) keysToErase.push({ key: k, kinds: ['prism'] });
  });
  activeLevel.enemies.forEach((e, k) => {
    const ey = k.split(',').map(Number)[1];
    if (ey === y) keysToErase.push({ key: k, kinds: ['enemy'] });
  });

  keysToErase.forEach(item => {
    if (editorEraseKey(item.key, item.kinds)) {
      erasedAny = true;
    }
  });

  batchEditing = false;
  if (batchRebuildNeeded) {
    buildLevel3D(activeLevel);
  } else if (erasedAny) {
    updateEditorSlicing();
  }
  drawEditorWires();
}

function commitPlaneDraw() {
  if (!isDrawingPlane || !planeStartPos || !planeEndPos) return;
  isDrawingPlane = false;
  if (editorPlanePreview) editorPlanePreview.visible = false;

  const minX = Math.min(planeStartPos.x, planeEndPos.x);
  const maxX = Math.max(planeStartPos.x, planeEndPos.x);
  const minZ = Math.min(planeStartPos.z, planeEndPos.z);
  const maxZ = Math.max(planeStartPos.z, planeEndPos.z);

  pushUndoSnapshot();

  batchEditing = true;
  batchRebuildNeeded = false;
  let changedAny = false;

  if (BLOCK_TOOLS.includes(selectedTool)) {
    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        if (editorPlaceBlock(x, editY, z, selectedTool)) {
          changedAny = true;
        }
      }
    }
    if (changedAny) audio.playPlace(selectedTool);
  } else if (selectedTool === 'eraser') {
    const keysToErase = [];
    activeLevel.blocks.forEach((b, k) => {
      if (b.y === editY && b.x >= minX && b.x <= maxX && b.z >= minZ && b.z <= maxZ) {
        keysToErase.push({ key: k, kinds: ['block'] });
      }
    });
    activeLevel.prisms.forEach((p, k) => {
      const [px, py, pz] = k.split(',').map(Number);
      if (py === editY && px >= minX && px <= maxX && pz >= minZ && pz <= maxZ) {
        keysToErase.push({ key: k, kinds: ['prism'] });
      }
    });
    activeLevel.enemies.forEach((e, k) => {
      const [ex, ey, ez] = k.split(',').map(Number);
      if (ey === editY && ex >= minX && ex <= maxX && ez >= minZ && ez <= maxZ) {
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

  batchEditing = false;
  if (batchRebuildNeeded) {
    buildLevel3D(activeLevel);
  } else if (changedAny) {
    updateEditorSlicing();
  }
  drawEditorWires();

  planeStartPos = null;
  planeEndPos = null;
}

function handleEditorClick(e) {
  const hit = editorRaycast(e);
  if (!hit) return;

  if (keysPressed['KeyV']) {
    if (BLOCK_TOOLS.includes(selectedTool)) {
      editorFillPlane(editY, selectedTool);
      audio.playPlace(selectedTool);
      return;
    } else if (selectedTool === 'eraser') {
      editorClearPlane(editY);
      audio.playBreak();
      return;
    }
  }

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
      audio.playLinkSuccess();
      buildLevel3D(activeLevel);
      drawEditorWires();
    } else {
      audio.playLinkCancel();
    }
    return;
  }

  // Placement tools — blocks go only onto the selected level (raise the height
  // ruler to build higher); drag-painting already snaps to that plane.
  if (BLOCK_TOOLS.includes(selectedTool)) {
    if (hit.y === editY && editorPlaceBlock(hit.x, hit.y, hit.z, selectedTool)) audio.playPlace(selectedTool);
  } else if (selectedTool === 'prism' || selectedTool === 'miniprism' || selectedTool === 'plutonium') {
    const c = snapItemCell(hit);
    if (editorPlacePrism(c.x, c.y, c.z, selectedTool)) audio.playPlace(selectedTool);
  } else if (selectedTool === 'enemy') {
    const c = snapItemCell(hit);
    if (editorPlaceEnemy(c.x, c.y, c.z)) audio.playPlace('enemy');
  } else if (selectedTool === 'start') {
    editorSetStart(snapItemCell(hit));
  } else if (selectedTool === 'exit') {
    const c = snapItemCell(hit);
    activeLevel.exit = { x: c.x, y: c.y, z: c.z };
    buildLevel3D(activeLevel);
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
      if (editorPlaceBlock(gx, gy, gz, selectedTool)) audio.playPlace(selectedTool);
    } else if (selectedTool === 'prism' || selectedTool === 'miniprism' || selectedTool === 'plutonium') {
      const c = snapItemCell({ x: gx, y: gy, z: gz, hitKey: null });
      if (editorPlacePrism(c.x, c.y, c.z, selectedTool)) audio.playPlace(selectedTool);
    } else if (selectedTool === 'enemy') {
      const c = snapItemCell({ x: gx, y: gy, z: gz, hitKey: null });
      if (editorPlaceEnemy(c.x, c.y, c.z)) audio.playPlace('enemy');
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
        audio.playPlace('exit');
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
  currentGroupId = null;
  setGroupingUI(false);
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
  audio.playPlaytestEnter();
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
  audio.playPlaytestExit();
}

function adjustEditHeight(val) {
  const oldY = editY;
  editY = Math.max(rulerMinY, Math.min(rulerMaxY, editY + val));
  if (editY !== oldY) {
    audio.playHeightChange(val > 0);
  }
  document.getElementById('height-display').textContent = editY;
  if (editorGridHelper) editorGridHelper.position.set(0.5, editY - 0.49, 0.5);
  if (editorGridPlane) editorGridPlane.position.set(0.5, editY - 0.49, 0.5);
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
  isCustomLevel = false;
  playerLives = MAX_LIVES;
  if (!premadeLevels.length) return; // manifest not ready (or no level files)
  const n = premadeLevels.length;
  const i = ((idx % n) + n) % n;
  const lvl3D = deserializeLevel(premadeLevels[i]);
  buildLevel3D(lvl3D);
}

/* ═══════════════════════════════════════════════════════════
   INPUT CONTROLS
   ═══════════════════════════════════════════════════════════ */
function handleMove(dirX, dirZ) {
  if (isLevelComplete || isEditMode && !isPlaytesting) return;
  // Re-decide mid-step: pressing the direction opposite to the current roll
  // aborts it and rolls back to the origin cell.
  if (isRolling && canReverseRoll() && dirX === -lastMoveDir.x && dirZ === -lastMoveDir.z) {
    reverseCurrentRoll();
    return;
  }
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

  // X-ray view toggle via KeyT removed at user request to restrict transparency effects to middle click.

  // Pause + free-orbit camera toggle (play / playtest only).
  if (e.code === 'KeyP') { e.preventDefault(); togglePause(); return; }
  // While paused, swallow every other key so the frozen game can't be driven.
  if (isPaused) return;

  // Place block in front of player at same level (E) or one level up (Q)
  if (e.code === 'KeyE' || e.code === 'KeyQ') {
    if (!isEditMode || isPlaytesting) {
      e.preventDefault();
      tryPlaceBlock(e.code === 'KeyQ');
    }
    return;
  }

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
      activeLevel.blocks.forEach(b => {
        if (b.properties && typeof b.properties.group === 'number' && b.properties.group > maxG) maxG = b.properties.group;
      });
      currentGroupId = maxG + 1;
      audio.init();
      audio.playGroupStart();
      setGroupingUI(true);
      refreshGroupingIndicator();
      drawEditorWires(); // highlight current-group members (orange boxes)
      return;
    }
    if (e.code === 'Escape') {
      if (linkerSourceKey) {
        linkerSourceKey = null;
        showMessage('LINK CANCELLED', 1);
        audio.playLinkCancel();
      }
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
        advanceCompletedLevel();
      }
      break;
  }
});

window.addEventListener('keyup', (e) => {
  keysPressed[e.code] = false;
  if (e.code === 'KeyV' && isDrawingPlane) {
    commitPlaneDraw();
  }
  if (e.code === 'KeyO' && currentGroupId !== null) {
    const n = groupMemberCount(currentGroupId);
    currentGroupId = null;
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
  if (!isEditMode || isPlaytesting) return;
  if (e.button === 0) {
    if (keysPressed['KeyV'] && (BLOCK_TOOLS.includes(selectedTool) || selectedTool === 'eraser')) {
      const hit = editorRaycast(e);
      if (hit) {
        planeStartPos = { x: hit.x, y: editY, z: hit.z };
        planeEndPos = { x: hit.x, y: editY, z: hit.z };
        isDrawingPlane = true;
      }
      return;
    }

    // Snapshot once per click / paint-stroke (skip pure linker source-select).
    if (!(selectedTool === 'linker' && linkerSourceKey === null)) pushUndoSnapshot();
    // Left click edit block
    if (selectedTool !== 'linker' && !keysPressed['KeyV']) {
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
    
    if (isDrawingPlane) {
      if (editorGhostBlock) editorGhostBlock.visible = false;
      if (tooltip) tooltip.style.display = 'none';

      if (hit) {
        planeEndPos = { x: hit.x, y: editY, z: hit.z };
        const minX = Math.min(planeStartPos.x, planeEndPos.x);
        const maxX = Math.max(planeStartPos.x, planeEndPos.x);
        const minZ = Math.min(planeStartPos.z, planeEndPos.z);
        const maxZ = Math.max(planeStartPos.z, planeEndPos.z);
        
        const width = (maxX - minX) + 1;
        const length = (maxZ - minZ) + 1;
        const centerX = (minX + maxX) / 2;
        const centerZ = (minZ + maxZ) / 2;
        
        if (editorPlanePreview) {
          editorPlanePreview.position.set(centerX, editY, centerZ);
          editorPlanePreview.scale.set(width, 1.05, length);
          editorPlanePreview.material.color.setHex(selectedTool === 'eraser' ? 0xff3355 : 0x00ffaa);
          editorPlanePreview.visible = true;
        }
      }
    } else {
      if (editorPlanePreview) editorPlanePreview.visible = false;
      if (hit && editorGhostBlock) {
        // Block-placement preview is only shown on the currently selected level.
        let ghostVisible = !(BLOCK_TOOLS.includes(selectedTool) && hit.y !== editY);
        // Set ghost block color, geometry and position dynamically based on tool
        if (selectedTool === 'eraser') {
          editorGhostBlock.material.color.setHex(0xff3355);
          editorGhostBlock.scale.set(1, 1, 1);
          if (hit.hitType === 'bridge') {
            editorGhostBlock.geometry = geoThinTile;
            editorGhostBlock.position.set(hit.x, hit.y + 0.4, hit.z);
          } else if (hit.hitType === 'plutonium') {
            editorGhostBlock.geometry = geoCube;
            editorGhostBlock.scale.set(0.4, 0.4, 0.4);
            editorGhostBlock.position.set(hit.x, hit.y + 0.55, hit.z);
          } else if (hit.hitType === 'prism' || hit.hitType === 'miniprism') {
            editorGhostBlock.geometry = geoPrism;
            if (hit.hitType === 'miniprism') editorGhostBlock.scale.set(0.6, 0.6, 0.6);
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
          editorGhostBlock.scale.set(1, 1, 1);
          if (hit.hitType === 'bridge') {
            editorGhostBlock.geometry = geoThinTile;
            editorGhostBlock.position.set(hit.x, hit.y + 0.4, hit.z);
          } else if (hit.hitType === 'plutonium') {
            editorGhostBlock.geometry = geoCube;
            editorGhostBlock.scale.set(0.4, 0.4, 0.4);
            editorGhostBlock.position.set(hit.x, hit.y + 0.55, hit.z);
          } else if (hit.hitType === 'prism' || hit.hitType === 'miniprism') {
            editorGhostBlock.geometry = geoPrism;
            if (hit.hitType === 'miniprism') editorGhostBlock.scale.set(0.6, 0.6, 0.6);
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
          else if (selectedTool === 'container') ghostColor = 0xffaa00;
          else if (selectedTool === 'start') ghostColor = 0xff6600;
          else if (selectedTool === 'exit') ghostColor = 0x00ffaa;
          else if (selectedTool === 'enemy') ghostColor = 0xff0066;
          else if (selectedTool === 'plutonium') ghostColor = 0xd946ef;
          // While grouping (O held), tint the placement preview orange to signal
          // that the next block will join the current compound object.
          if (currentGroupId !== null && BLOCK_TOOLS.includes(selectedTool)) ghostColor = 0xffbb33;

          editorGhostBlock.material.color.setHex(ghostColor);
          editorGhostBlock.scale.set(1, 1, 1);
          let targetY = hit.y;
          if (selectedTool === 'bridge') {
            editorGhostBlock.geometry = geoThinTile;
            targetY = hit.y + 0.4;
          } else if (selectedTool === 'plutonium') {
            editorGhostBlock.geometry = geoCube;
            editorGhostBlock.scale.set(0.4, 0.4, 0.4);
            targetY = hit.y + 0.55;
          } else if (selectedTool === 'prism' || selectedTool === 'miniprism') {
            editorGhostBlock.geometry = geoPrism;
            if (selectedTool === 'miniprism') editorGhostBlock.scale.set(0.6, 0.6, 0.6);
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
  }
});

window.addEventListener('mouseup', (e) => {
  isDraggingCamera = false;
  if (e.button === 0) {
    isPainting = false;
    if (isDrawingPlane) {
      commitPlaneDraw();
    }
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

/* ═══ GAMEPLAY MOUSE: middle-click X-ray · left-drag camera peek ═══
   Active during play and playtest (not pure editing, not while paused — the
   editor and the pause orbit own the mouse in those modes). */
function isGameplayMouseMode() {
  return (!isEditMode || isPlaytesting) && !isPaused;
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
    peekActive = true;
    peekLast = { x: e.clientX, y: e.clientY };
  }
});
window.addEventListener('mousemove', (e) => {
  if (!peekActive) return;
  const dx = e.clientX - peekLast.x;
  const dy = e.clientY - peekLast.y;
  peekLast = { x: e.clientX, y: e.clientY };
  peekYaw = THREE.MathUtils.clamp(peekYaw - dx * 0.005, -0.6, 0.6);
  peekPitch = THREE.MathUtils.clamp(peekPitch + dy * 0.004, -0.30, 0.45);
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) peekActive = false; // release → ease back to default angle
});
// Suppress the middle-click autoscroll puck during play.
renderer.domElement.addEventListener('auxclick', (e) => {
  if (e.button === 1 && isGameplayMouseMode()) e.preventDefault();
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
  audio.playClick();
  updateLibraryList();
  document.getElementById('editor-library-panel').style.display = 'flex';
});

document.getElementById('btn-editor-toggle').addEventListener('click', () => {
  audio.init();
  audio.playClick();
  if (isEditMode) exitEditMode(); else enterEditMode();
});

// Toolbox items select
const toolButtons = Array.from(document.querySelectorAll('.tool-btn'));
function selectToolByName(name) {
  toolButtons.forEach(b => b.classList.toggle('active', b.dataset.tool === name));
  selectedTool = name;
  linkerSourceKey = null;
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
    activeLevel = lvl;
    document.getElementById('level-name-input').value = lvl.name;
    document.getElementById('world-select').value = lvl.world;
    adjustEditHeight(-editY); // Reset edit height to 0
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
    activeLevel = lvl;
    document.getElementById('level-name-input').value = lvl.name;
    document.getElementById('world-select').value = lvl.world;
    adjustEditHeight(-editY); // Reset edit height to 0
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
  activeLevel = lvl;
  document.getElementById('level-name-input').value = lvl.name;
  document.getElementById('world-select').value = lvl.world;
  adjustEditHeight(-editY); // reset edit height to 0
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
  activeLevel = lvl;
  document.getElementById('level-name-input').value = lvl.name;
  document.getElementById('world-select').value = lvl.world;
  if (document.getElementById('level-build-limit-input')) {
    document.getElementById('level-build-limit-input').value = lvl.buildBlocksLimit ?? 10;
  }
  adjustEditHeight(-editY); // reset edit height to 0
  buildLevel3D(lvl);
  drawEditorWires();
  document.getElementById('ai-pro3-modal').style.display = 'none';
  showMessage(`AI PRO3 — ${lvl.name}`);
  audio.playAIGenerate();
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
    audio.playClear();
  }
});

document.getElementById('btn-save-local').addEventListener('click', () => {
  audio.playClick();
  const name = document.getElementById('level-name-input').value.trim();
  if (!name) return alert("Please specify level name.");
  activeLevel.name = name;
  activeLevel.world = parseInt(document.getElementById('world-select').value);
  if (document.getElementById('level-build-limit-input')) {
    activeLevel.buildBlocksLimit = parseInt(document.getElementById('level-build-limit-input').value, 10) || 10;
  }

  let store = {};
  try { store = JSON.parse(localStorage.getItem('goose_levels') || '{}'); } catch(e){}
  store[name] = serializeLevel(activeLevel);
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
  if (typedName) activeLevel.name = typedName;
  activeLevel.world = parseInt(document.getElementById('world-select').value, 10) || 0;
  if (document.getElementById('level-build-limit-input')) {
    activeLevel.buildBlocksLimit = parseInt(document.getElementById('level-build-limit-input').value, 10) || 10;
  }
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
  a.download = `${activeLevel.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
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

document.getElementById('complete-overlay').addEventListener('click', () => {
  if (isLevelComplete) {
    advanceCompletedLevel();
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

  if (stepUp && stepUp.type !== 'pushable') {
    if (!colBlocks.find(b => b.y === fromY + 2) && !currentCeiling) return fromY + 1;
    return null;
  }
  if (sameLevel && sameLevel.type !== 'pushable') {
    if (!colBlocks.find(b => b.y === fromY + 1)) return fromY;
    return null;
  }
  if (stepDown && stepDown.type !== 'pushable') {
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

function checkEnemiesTrappedWin() {
  if (isLevelComplete) return;
  // ONLY evaluate if there are active enemies in the level
  if (enemies.length === 0) return;

  let allTrapped = true;
  for (const enemy of enemies) {
    const ex = enemy.grid.x;
    const ey = enemy.grid.y;
    const ez = enemy.grid.z;

    // Check neighbors at ey + 1 (since block coordinates are at y+1 relative to the standing level):
    const neighbors = [
      { x: ex + 1, y: ey + 1, z: ez },
      { x: ex - 1, y: ey + 1, z: ez },
      { x: ex, y: ey + 1, z: ez + 1 },
      { x: ex, y: ey + 1, z: ez - 1 }
    ];

    let trappedCount = 0;
    for (const n of neighbors) {
      // Find if there is a block at neighbor position and Y level, and it is a crate ('pushable')
      const block = activeBlocks.get(`${n.x},${n.y},${n.z}`);
      if (block && block.type === 'pushable') {
        trappedCount++;
      }
    }

    if (trappedCount < 4) {
      allTrapped = false;
      break;
    }
  }

  if (allTrapped) {
    completeLevel();
  }
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

  audio.playEnemyRoll();
}

function loseLife(cause) {
  if (playerInvincible) return;
  playerLives--;
  const isGameOver = playerLives <= 0;
  if (isGameOver) {
    playerLives = MAX_LIVES;
    audio.playGameOver();
  } else {
    audio.playDamage();
  }
  updateLivesUI();
  respawnPlayer(); // resets level + shows LEVEL RESTART
  // Override message and set invincibility AFTER respawn
  playerInvincible = true;
  playerInvincibleTimer = PLAYER_INVINCIBLE_DURATION;
  
  const msg = cause
    ? (isGameOver ? `${cause.toUpperCase()}! GAME OVER!` : `${cause.toUpperCase()}! LIFE LOST — ${playerLives} LEFT`)
    : (isGameOver ? 'GAME OVER!' : `LIFE LOST — ${playerLives} LEFT`);
  showMessage(msg, isGameOver ? 2.2 : 1.5);
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

let transparencyUpdateTimer = 0;

function updateDynamicTransparency() {
  if (isEditMode && !isPlaytesting) {
    // Reset all opacities in editor mode (rely entirely on slice mode transparency)
    activeBlocks.forEach(block => {
      if (block.mesh && !block.playerPlaced) {
        const isInactiveBridge = (block.type === 'bridge' && block.active === false);
        const isBelow = (sliceModeActive && block.y < editY);
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
    movingPlatformsList.forEach(mp => {
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

  if (!playerCube) return;

  // X-ray view (toggled with a middle-mouse click): force every block and
  // platform see-through so the whole structure reads at once. Edge outlines,
  // prisms and enemy markers stay opaque, so the level is still legible.
  if (xrayMode) {
    activeBlocks.forEach(block => {
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
    movingPlatformsList.forEach(mp => {
      if (!mp.mesh) return;
      const mpMat = mp.mesh.material;
      mp.mesh.visible = true;
      if (!mpMat.transparent) mpMat.needsUpdate = true;
      mpMat.transparent = true; mpMat.opacity = 0.5; mpMat.depthWrite = false;
    });
    return;
  }

  // If xrayMode is false, make everything solid / opaque.
  activeBlocks.forEach(block => {
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
  movingPlatformsList.forEach(mp => {
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
  transparencyUpdateTimer++;
  if (transparencyUpdateTimer % 6 === 0) {
    updateDynamicTransparency();
  }

  // Spatial starfield: a star dome around the camera, only while playing (not in
  // the editor). Recentre on the camera so it never clips, and drift it slowly
  // so orbiting the level sweeps the stars across the view for depth.
  if (starfield) {
    const playing = !(isEditMode && !isPlaytesting);
    starfield.visible = playing;
    if (playing) {
      starfield.position.copy(camera.position);
      if (isLevelComplete && completeAnimStartTime > 0) {
        const elapsed = now - completeAnimStartTime;
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
        starUniforms.uTime.value = now;
      }
    }
  }

  // Paused: freeze all game logic, only drive the free-orbit camera and render.
  if (isPaused && (!isEditMode || isPlaytesting)) {
    updatePauseOrbitCamera();
    renderer.render(scene, camera);
    return;
  }

  if (!isEditMode || isPlaytesting) {
    // Game time
    if (!isLevelComplete) { elapsedTime += dt; gameTimer += dt; }
    
    if (isCarryingPlutonium && !isLevelComplete && !isPaused) {
      plutoniumTimer -= dt;
      if (plutoniumTimer <= 0) {
        plutoniumTimer = 0;
        isCarryingPlutonium = false;
        const phud = document.getElementById('plutonium-hud-bar');
        if (phud) phud.style.display = 'none';
        loseLife('plutonium exploded');
      } else {
        const phudFill = document.getElementById('plutonium-hud-fill');
        const phudText = document.getElementById('plutonium-hud-text');
        if (phudFill && phudText) {
          const limit = activeLevel.plutoniumTimeLimit ?? 30.0;
          const pct = Math.max(0, Math.min(100, (plutoniumTimer / limit) * 100));
          phudFill.style.width = pct + '%';
          phudText.textContent = `PLUTONIUM: ${plutoniumTimer.toFixed(1)}s`;
        }
      }
    }

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
    checkEnemiesTrappedWin();
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

    // Camera peek: while the left button is held the view is nudged by
    // peekYaw/peekPitch; once released it eases smoothly back to neutral.
    if (!peekActive) {
      peekYaw  += (0 - peekYaw)  * 0.12;
      peekPitch += (0 - peekPitch) * 0.12;
      if (Math.abs(peekYaw)  < 1e-3) peekYaw = 0;
      if (Math.abs(peekPitch) < 1e-3) peekPitch = 0;
    }
    const offset = new THREE.Vector3(7, 8.5, 8);
    if (peekYaw !== 0 || peekPitch !== 0) {
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), peekYaw); // orbit horizontally
      const horizAxis = new THREE.Vector3(-offset.z, 0, offset.x).normalize();
      offset.applyAxisAngle(horizAxis, peekPitch);               // tilt vertically
    }
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
    p.material.opacity = 1 - prog;
    p.scale.setScalar(1 - prog*0.7);
    if (p.userData.spin) {
      p.rotation.x += p.userData.spin.x * dt;
      p.rotation.y += p.userData.spin.y * dt;
      p.rotation.z += p.userData.spin.z * dt;
    }
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

      if (child.userData.isPlutonium) {
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
      }
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
  { name:'Plutonium',      swatch:'background:#a21caf;box-shadow:0 0 8px #a21caf;border:1px solid #d946ef;border-radius:4px;transform:scale(0.8);', desc:'Purple-black pulsating small cube. Starts a countdown timer once collected.' },
  { name:'Container',      swatch:'background:repeating-linear-gradient(45deg,#ff1111,#ff1111 4px,#ffcc00 4px,#ffcc00 8px);border:1px solid #ff1111;', desc:'Red/yellow striped container block. Step on it to deposit your Plutonium before the timer runs out.' },
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
  isHelpOpen = open;
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
  const limit = activeLevel.buildBlocksLimit ?? 10;
  const remaining = Math.max(0, limit - placedBlocksCount);
  el.textContent = `${remaining} block${remaining !== 1 ? 's' : ''}`;
  el.style.color = remaining === 0 ? '#ff3355' : '#aaa';
}

function tryPlaceBlock(stepUp) {
  if (isRolling || isFalling || isTeleporting || isLevelComplete) return;

  const limit = activeLevel.buildBlocksLimit ?? 10;
  if (placedBlocksCount >= limit) {
    audio.playLinkCancel();
    showMessage('BLOCK LIMIT REACHED!', 1.2);
    return;
  }

  const dx = lastMoveDir.x !== 0 || lastMoveDir.z !== 0 ? lastMoveDir.x : 0;
  const dz = lastMoveDir.x !== 0 || lastMoveDir.z !== 0 ? lastMoveDir.z : -1;

  const targetX = playerGridPos.x + dx;
  const targetY = playerGridPos.y + (stepUp ? 1 : 0);
  const targetZ = playerGridPos.z + dz;

  const key = `${targetX},${targetY},${targetZ}`;

  if (activeBlocks.has(key)) {
    audio.playLinkCancel();
    showMessage('BLOCKED!', 1.0);
    return;
  }

  const block = { x: targetX, y: targetY, z: targetZ, type: 'normal', properties: {}, active: true, broken: false, playerPlaced: true };
  activeBlocks.set(key, block);
  createBlockMesh(block, key);

  spawnEntranceParticles(targetX, targetY, targetZ);

  placedBlocksCount++;
  updateBuildUI();

  audio.playSwitch();

  const remaining = limit - placedBlocksCount;
  showMessage(`BLOCK PLACED! (${remaining} LEFT)`, 1.0);
}

// Duplicate setMeshOpacity and disposeMaterial declarations removed

// START — fetch the level manifest, load level 1, then begin the render loop.
(async () => {
  premadeLevels = await loadLevelManifest();
  if (!premadeLevels.length) console.warn('No /level/*.json files found — start the game from a web server.');
  loadPreMadeLevel(0);
  requestAnimationFrame(animate);
  console.log(`%c🟧 GOOSE — 3D & Level Editor Ready (${premadeLevels.length} levels)`, 'color:#ff6600;font-size:18px;');
})();
