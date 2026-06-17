import * as THREE from 'three';
import { AudioEngine } from './audio.js';

/* ═══════════════════════════════════════════════════════════
   SHARED STATE
   Every piece of mutable game/editor state lives on the single `S` object so
   it can be read and written across modules (ES-module imports are read-only
   bindings, so plain `let` exports can't be reassigned by importers — a shared
   object sidesteps that). Read/write as `S.isRolling`, `S.activeLevel`, …
   True constants stay in constants.js / their owning modules, not here.
   ═══════════════════════════════════════════════════════════ */

// Audio is a process-wide singleton; modules import it directly.
export const audio = new AudioEngine();

export const S = {
  /* ═══ GAME & EDITOR STATE ═══ */
  currentLevelIdx: 0,
  premadeLevels: [],        // raw JSON strings fetched from /level (1.json, 2.json, …)
  customLevels: [],         // Array of Level3D loaded from LocalStorage
  activeLevel: null,        // Current playing Level3D
  levelSnapshot: null,      // Serialized pristine state, used for full reset on death/restart

  activeBlocks: new Map(),  // key -> block representation
  activePrisms: new Map(),  // key -> prism representation
  movingPlatformsList: [],
  ridingPlatform: null,     // mover the player is currently locked onto (sticky)
  ridingOffset: new THREE.Vector3(), // fixed cube offset from the mover while riding
  switchMap: new Map(),     // switchKey -> [targetKeys]
  teleporterMap: new Map(), // tpKey -> targetTpKey
  switchStates: new Map(),  // key -> activeState

  playerGridPos: { x:0, y:0, z:0 },
  playerCube: null,
  exitPos: { x:0, y:0, z:0 },
  exitRing: null,

  isRolling: false,
  isBalancing: false,
  isTeleporting: false,
  isFalling: false,
  isLevelComplete: false,
  isMini: false,
  isCustomLevel: false,
  isHelpOpen: false,
  // X-ray view (toggled with T): renders all blocks see-through.
  xrayMode: false,

  // Pause + free orbit (toggled with P).
  isPaused: false,
  pauseYaw: 0.72,
  pausePitch: 0.675,
  pauseZoom: 13.6,
  pausePointers: new Map(), // pointerId → {x,y} for drag + pinch
  pausePinchDist: null,

  balanceDir: null,
  balanceTimer: 0,
  lastMoveDir: { x:0, z:0 },
  keysPressed: {},
  // Held-direction auto-repeat while playing: roll one cell every 300ms.
  repeatMoveCode: null,     // the movement key currently held for repeat
  repeatMoveDir: { x:0, z:0 },
  moveRepeatTimer: 0,
  repeatStepCount: 0,
  rollStartGridPos: { x:0, y:0, z:0 },
  rollPreState: null,       // snapshot so a mid-step reverse can undo it
  boosterMovesActive: 0,
  moveCount: 0,
  placedBlocksCount: 0,
  gameTimer: 0,
  comboCount: 0,
  comboTimer: 0,
  elapsedTime: 0,
  miniTimer: 0,
  isCarryingPlutonium: 0,
  plutoniumTimer: 30.0,
  depositedPlutonium: 0,
  containerMeshes: [],
  hasCollectedPlutoniumThisRun: false,
  plutoniumWarningSoundTimer: 0.0,
  fallVelY: 0,

  cameraTarget: new THREE.Vector3(2, 0, 2),
  cameraLookAt: new THREE.Vector3(2, 0, 2),
  cameraShake: new THREE.Vector3(),
  shakeIntensity: 0,

  // Gameplay "peek": hold left mouse + drag to nudge the view; eases back on release.
  peekActive: false,
  peekLast: { x: 0, y: 0 },
  peekYaw: 0,   // horizontal nudge (radians), eased back to 0
  peekPitch: 0, // vertical nudge (radians), eased back to 0

  animStartTime: 0,
  animStartPos: new THREE.Vector3(),
  animEndPos: new THREE.Vector3(),
  animStartQuat: new THREE.Quaternion(),
  animDeltaQuat: new THREE.Quaternion(),
  animAxis: new THREE.Vector3(),
  animFromEdge: false,
  // When a roll begins while riding a moving platform, the roll is anchored to
  // that platform's frame: rollCarrier is the mover and rollCarrierStart its
  // position at roll start.
  rollCarrier: null,
  rollCarrierStart: new THREE.Vector3(),

  particles: [],
  trailParts: [],
  trailTimer: 0,
  completeAnimStartTime: 0,
  completeTimeoutId: null,

  /* ═══ ENEMY STATE ═══ */
  enemies: [],              // live chasers spawned during gameplay/playtest
  enemyMarkers: new Map(),  // key -> mesh, static markers shown in pure edit mode

  /* ═══ LIVES STATE ═══ */
  playerLives: 5,
  playerInvincible: false,
  playerInvincibleTimer: 0,

  /* ═══ LEVEL EDITOR STATE ═══ */
  isEditMode: false,
  selectedTool: 'normal',   // normal, fragile, ice, switch, bridge, teleporter, moving, …
  editY: 0,
  editorGridHelper: null,
  editorGridPlane: null,
  editorGhostBlock: null,
  editorWiresGroup: null,
  sliceModeActive: false,   // layer slicing off by default in the editor

  editorCameraTarget: new THREE.Vector3(0, 0, 0),
  editorCameraYaw: Math.PI/4,
  editorCameraPitch: 0.8,
  editorCameraZoom: 15,
  isDraggingCamera: false,
  dragStartMouse: { x:0, y:0 },
  isPainting: false,
  rightDragMoved: false,    // suppress erase-on-release after a camera drag

  isDrawingPlane: false,
  planeMode: false,
  planeStartPos: null,
  planeEndPos: null,
  editorPlanePreview: null,

  linkerSourceKey: null,    // Stored switch/tp for linking
  // Compound objects: while "O" is held, every block placed is tagged with the
  // same group id (block.properties.group).
  currentGroupId: null,     // active group id while O is held, else null

  // Editor undo history — serialized level snapshots, newest last (max 250).
  undoStack: [],

  // Batch editing state (suppresses slicing/wire draws/rebuilds during loops)
  batchEditing: false,
  batchRebuildNeeded: false,

  /* ═══ MISC / UI ═══ */
  typewriterInterval: null,
  libraryListToken: 0,      // guards async folder-level appends against stale refreshes
  isPlaytesting: false,
  savedEditorLevel: null,
  transparencyUpdateTimer: 0,
};
