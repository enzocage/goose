/* ═══════════════════════════════════════════════════════════
   MOBILE / TOUCH CONTROLS
   Three things, all driven from here:
     1. Invisible canvas gestures — for play (swipe / hold-drag to roll, with
        the same 300 ms auto-repeat as the keyboard) and for the editor
        (tap = place, one-finger drag = orbit, two-finger drag = pan, pinch =
        zoom, long-press = erase).
     2. Optional on-screen controls — a movement D-pad + action buttons for
        play, and a camera pad for the editor. Shown only in the "standard"
        UI preset so they can be toggled off entirely.
     3. A UI-preset cycle button that steps Standard → Gestures → Immersive →
        No-UI, tuned for different player types (and persisted).

   Self-contained: imports only leaf modules. bootstrap passes in handleMove
   and tryPlaceBlock through initMobileControls() so there is no import cycle.
   ═══════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { S, audio } from './state.js';
import { camera, renderer } from './scene.js';
import { respawnPlayer, executeRollBack } from './gameplay.js';
import {
  editorRaycast, handleEditorClick, editorEraseKey, pushUndoSnapshot,
  adjustEditHeight, drawEditorWires, commitPlaneDraw
} from './editor.js';
import { togglePause } from './main.js';
import { showMessage, setGroupingUI, refreshGroupingIndicator, groupMemberCount } from './ui.js';

// Touch-first device: the primary pointer is coarse (phones / tablets). This
// deliberately excludes touch-enabled laptops whose primary pointer is a mouse,
// matching the project's existing `@media (pointer:coarse)` assumption.
export const IS_TOUCH = (typeof window !== 'undefined') && (
  (!!window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
  (!window.matchMedia && ('ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0))
);

// Bootstrap-provided callbacks (wired in initMobileControls to avoid a cyclic import).
let cbMove = () => {};
let cbPlace = () => {};

const DIR = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

// Gesture tuning (CSS px).
const PLAY_DEAD = 22;   // swipe distance before a roll fires
const EDIT_DRAG = 8;    // movement before a tap becomes an orbit-drag
const LONG_MS   = 480;  // hold time for long-press erase

const clamp = (min, max, v) => Math.max(min, Math.min(max, v));

/* ─── shared movement helpers (reuse the keyboard auto-repeat path) ─── */
function gameMove(x, z) {
  // Balance recovery: pushing opposite the last roll while teetering rolls back.
  if (S.isBalancing &&
      ((S.lastMoveDir.x === 1 && x === -1) || (S.lastMoveDir.x === -1 && x === 1) ||
       (S.lastMoveDir.z === 1 && z === -1) || (S.lastMoveDir.z === -1 && z === 1))) {
    executeRollBack();
    return;
  }
  cbMove(x, z);
}
function startTouchRepeat(x, z) {
  gameMove(x, z);
  S.repeatMoveDir = { x, z };
  S.repeatMoveCode = 'Touch';
  S.keysPressed['Touch'] = true;   // the gameloop repeats while this stays true
  S.moveRepeatTimer = 0;
}
function stopTouchRepeat() {
  if (S.repeatMoveCode === 'Touch') S.repeatMoveCode = null;
  S.keysPressed['Touch'] = false;
}

function isPlayTouchMode() {
  return (!S.isEditMode || S.isPlaytesting) && !S.isPaused && !S.isLevelComplete && !S.isHelpOpen;
}
function isEditTouchMode() {
  return S.isEditMode && !S.isPlaytesting && !S.isHelpOpen;
}
function synthEvent(x, y) {
  return { clientX: x, clientY: y, button: 0, shiftKey: false, preventDefault() {} };
}
const touchDist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
const touchMid  = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });

/* ═══════════════════════════════════════════════════════════
   INVISIBLE CANVAS GESTURES (play + editor)
   ═══════════════════════════════════════════════════════════ */
let gMode = null;                                  // 'play' | 'edit' for the active gesture
let pActive = false, pDir = null, pX = 0, pY = 0;  // play swipe state
let eActive = false, eMoved = false, eDidLong = false, eTwo = false, ePlaneDraw = false;
let eX = 0, eY = 0, eLastX = 0, eLastY = 0, ePinch = 0, ePanLast = null, eLongTO = null;
let planeMode = false;                             // V-style rectangular plane drawing (touch toggle)

function wireCanvasGestures() {
  const canvas = renderer.domElement;
  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('touchmove',  onTouchMove,  { passive: false });
  canvas.addEventListener('touchend',   onTouchEnd,   { passive: false });
  canvas.addEventListener('touchcancel', onTouchEnd,  { passive: false });
  // Long-press / drag must never raise the native context menu on touch.
  canvas.addEventListener('contextmenu', (e) => { if (IS_TOUCH) e.preventDefault(); });
}

function onTouchStart(e) {
  audio.init();
  if (isPlayTouchMode()) {
    if (e.touches.length !== 1) return;            // a second finger starts no new roll
    e.preventDefault();
    gMode = 'play'; pActive = true; pDir = null;
    pX = e.touches[0].clientX; pY = e.touches[0].clientY;
  } else if (isEditTouchMode()) {
    e.preventDefault();
    gMode = 'edit';
    if (e.touches.length === 1) {
      const t = e.touches[0];
      eMoved = false; eDidLong = false; eTwo = false; ePlaneDraw = false;
      eX = eLastX = t.clientX; eY = eLastY = t.clientY;
      clearTimeout(eLongTO);
      if (planeMode && (BLOCK_TOOLS.includes(S.selectedTool) || S.selectedTool === 'eraser')) {
        // Plane mode: a drag draws a rectangle (mirrors hold-V + drag on desktop).
        const hit = editorRaycast(synthEvent(t.clientX, t.clientY));
        if (hit) {
          S.planeStartPos = { x: hit.x, y: S.editY, z: hit.z };
          S.planeEndPos   = { x: hit.x, y: S.editY, z: hit.z };
          S.isDrawingPlane = true;
          ePlaneDraw = true;
          eActive = false;
          updatePlanePreview();
        } else {
          eActive = false;
        }
      } else {
        eActive = true;
        eLongTO = setTimeout(() => { if (eActive && !eMoved && !eTwo) editErase(eX, eY); }, LONG_MS);
      }
    } else if (e.touches.length === 2) {
      eTwo = true; eActive = false; ePlaneDraw = false; clearTimeout(eLongTO);
      if (S.isDrawingPlane) { S.isDrawingPlane = false; if (S.editorPlanePreview) S.editorPlanePreview.visible = false; }
      ePinch = touchDist(e.touches); ePanLast = touchMid(e.touches);
    }
  }
}

function onTouchMove(e) {
  if (gMode === 'play' && pActive) {
    e.preventDefault();
    const t = e.touches[0]; if (!t) return;
    const dx = t.clientX - pX, dy = t.clientY - pY;
    if (Math.hypot(dx, dy) < PLAY_DEAD) return;
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    if (dir !== pDir) {
      pDir = dir;
      startTouchRepeat(DIR[dir][0], DIR[dir][1]);
      pX = t.clientX; pY = t.clientY;             // re-anchor so a held push keeps repeating
    }
  } else if (gMode === 'edit') {
    e.preventDefault();
    if (e.touches.length >= 2 || eTwo) {
      eTwo = true; eActive = false; ePlaneDraw = false; clearTimeout(eLongTO);
      if (e.touches.length < 2) return;
      const d = touchDist(e.touches), mid = touchMid(e.touches);
      if (ePinch > 0 && d > 0) S.editorCameraZoom = clamp(5, 45, S.editorCameraZoom * (ePinch / d));
      if (ePanLast) editorPan(mid.x - ePanLast.x, mid.y - ePanLast.y);
      ePinch = d; ePanLast = mid;
    } else if (ePlaneDraw) {
      const t = e.touches[0]; if (!t) return;
      const hit = editorRaycast(synthEvent(t.clientX, t.clientY));
      if (hit) { S.planeEndPos = { x: hit.x, y: S.editY, z: hit.z }; updatePlanePreview(); }
    } else if (eActive) {
      const t = e.touches[0]; if (!t) return;
      if (!eMoved && Math.hypot(t.clientX - eX, t.clientY - eY) > EDIT_DRAG) {
        eMoved = true; clearTimeout(eLongTO);
      }
      if (eMoved) {                                // one-finger drag = orbit (matches desktop right-drag)
        S.editorCameraYaw   -= (t.clientX - eLastX) * 0.005;
        S.editorCameraPitch  = clamp(0.1, Math.PI / 2 - 0.1, S.editorCameraPitch + (t.clientY - eLastY) * 0.005);
      }
      eLastX = t.clientX; eLastY = t.clientY;
    }
  }
}

function onTouchEnd(e) {
  if (gMode === 'play') {
    if (e.touches.length === 0) { stopTouchRepeat(); pActive = false; pDir = null; gMode = null; }
    return;
  }
  if (gMode === 'edit') {
    if (e.touches.length === 0) {
      clearTimeout(eLongTO);
      if (ePlaneDraw) commitPlaneDraw();                                // finish the rectangle
      else if (eActive && !eMoved && !eDidLong && !eTwo) editPlace(eX, eY);  // a clean tap → place / use tool
      eActive = false; eTwo = false; eMoved = false; ePlaneDraw = false; ePanLast = null; ePinch = 0; gMode = null;
    } else {
      // A finger lifted mid multi-touch — don't let the remainder register as a tap or draw.
      eActive = false; ePlaneDraw = false;
    }
  }
}

function editPlace(x, y) {
  const ev = synthEvent(x, y);
  const hit = editorRaycast(ev);
  if (!hit) return;
  // Mirror the desktop left-click: snapshot unless we're only picking a linker source.
  if (!(S.selectedTool === 'linker' && S.linkerSourceKey === null)) pushUndoSnapshot();
  handleEditorClick(ev);
}
function editErase(x, y) {
  eDidLong = true;
  const hit = editorRaycast(synthEvent(x, y));
  if (hit && hit.hitKey) {
    pushUndoSnapshot();
    if (editorEraseKey(hit.hitKey)) audio.playBreak();
  }
}
function updatePlanePreview() {
  if (!S.editorPlanePreview || !S.planeStartPos || !S.planeEndPos) return;
  const minX = Math.min(S.planeStartPos.x, S.planeEndPos.x), maxX = Math.max(S.planeStartPos.x, S.planeEndPos.x);
  const minZ = Math.min(S.planeStartPos.z, S.planeEndPos.z), maxZ = Math.max(S.planeStartPos.z, S.planeEndPos.z);
  S.editorPlanePreview.position.set((minX + maxX) / 2, S.editY, (minZ + maxZ) / 2);
  S.editorPlanePreview.scale.set((maxX - minX) + 1, 1.05, (maxZ - minZ) + 1);
  S.editorPlanePreview.material.color.setHex(S.selectedTool === 'eraser' ? 0xff3355 : 0x00ffaa);
  S.editorPlanePreview.visible = true;
  if (S.editorGhostBlock) S.editorGhostBlock.visible = false;
}

/* ── O / V edit-mode toggles (touch equivalents of holding O / V) ── */
function refreshEditModeButtons() {
  document.querySelector('[data-editmode=group]')?.classList.toggle('active', S.currentGroupId !== null);
  document.querySelector('[data-editmode=plane]')?.classList.toggle('active', planeMode);
}
function toggleGroup() {
  audio.init();
  if (S.currentGroupId === null) {
    let maxG = 0;
    S.activeLevel.blocks.forEach(b => {
      if (b.properties && typeof b.properties.group === 'number' && b.properties.group > maxG) maxG = b.properties.group;
    });
    S.currentGroupId = maxG + 1;
    audio.playGroupStart();
    setGroupingUI(true); refreshGroupingIndicator(); drawEditorWires();
  } else {
    const n = groupMemberCount(S.currentGroupId);
    S.currentGroupId = null;
    setGroupingUI(false); audio.playGroupEnd();
    if (n > 0) showMessage(`OBJECT GROUPED — ${n} BLOCK${n === 1 ? '' : 'S'}`, 1.5);
    drawEditorWires();
  }
  refreshEditModeButtons();
}
function togglePlane() {
  audio.init();
  planeMode = !planeMode;
  if (!planeMode && S.isDrawingPlane) commitPlaneDraw();
  showMessage(planeMode ? 'PLANE MODE — DRAG TO DRAW A RECTANGLE' : 'PLANE MODE OFF', 1.4);
  refreshEditModeButtons();
}

function editorPan(dxScreen, dyScreen) {
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd); fwd.y = 0;
  if (fwd.lengthSq() < 1e-6) return;
  fwd.normalize();
  const lft = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const k = S.editorCameraZoom * 0.0016;           // screen px → world units, scaled by zoom
  S.editorCameraTarget.addScaledVector(lft, dxScreen * k);   // drag right → view follows the fingers
  S.editorCameraTarget.addScaledVector(fwd, dyScreen * k);
}

/* ═══════════════════════════════════════════════════════════
   ON-SCREEN CONTROLS
   ═══════════════════════════════════════════════════════════ */
function holdRepeatKey(btn, code) {
  // Drives the editor camera by toggling the same keysPressed flags the loop reads.
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); S.keysPressed[code] = true; });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev =>
    btn.addEventListener(ev, () => { S.keysPressed[code] = false; }));
}

function wireOnscreenControls() {
  // Movement D-pad — immediate roll + hold-to-repeat via the shared 'Touch' path.
  document.querySelectorAll('#mobile-controls .ctrl-btn').forEach(btn => {
    const d = DIR[btn.dataset.dir]; if (!d) return;
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); audio.init(); startTouchRepeat(d[0], d[1]); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btn.addEventListener(ev, stopTouchRepeat));
  });

  // Action buttons — place / step-up place / restart / pause.
  const actions = {
    place:   () => cbPlace(false),
    placeup: () => cbPlace(true),
    restart: () => respawnPlayer(),
    pause:   () => togglePause(),
  };
  document.querySelectorAll('#mobile-actions .act-btn').forEach(btn => {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault(); audio.init();
      (actions[btn.dataset.act] || (() => {}))();
    });
  });

  // Editor camera pad — pan (WASD), rotate (QE), zoom (hold-repeat), height (tap).
  const camKey = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', rotL: 'KeyQ', rotR: 'KeyE' };
  document.querySelectorAll('#editor-touch-pad [data-ecam]').forEach(btn => {
    const act = btn.dataset.ecam;
    if (camKey[act]) {
      holdRepeatKey(btn, camKey[act]);
    } else if (act === 'zoomIn' || act === 'zoomOut') {
      const dz = act === 'zoomIn' ? -1.2 : 1.2;
      let timer = null;
      const step = () => { S.editorCameraZoom = clamp(5, 45, S.editorCameraZoom + dz); };
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); step(); timer = setInterval(step, 70); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev =>
        btn.addEventListener(ev, () => { if (timer) { clearInterval(timer); timer = null; } }));
    } else if (act === 'heightUp' || act === 'heightDown') {
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); adjustEditHeight(act === 'heightUp' ? 1 : -1); });
    }
  });

  // Edit-mode toggles: O = group blocks, V = draw a rectangular plane.
  document.querySelectorAll('[data-editmode]').forEach(btn => {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (btn.dataset.editmode === 'group') toggleGroup();
      else if (btn.dataset.editmode === 'plane') togglePlane();
    });
  });
}

/* ═══════════════════════════════════════════════════════════
   UI PRESET CYCLE
   ═══════════════════════════════════════════════════════════ */
const PRESETS = [
  { id: 'standard', label: 'STANDARD', hint: 'HUD · D-Pad · Aktionstasten' },
  { id: 'kompakt',  label: 'KOMPAKT',  hint: 'Wischen + Aktionstasten' },
  { id: 'immersiv', label: 'IMMERSIV', hint: 'Nur Gesten · HUD aus' },
  { id: 'none',     label: 'KEIN UI',  hint: 'Alles aus · pure Ansicht' },
];
const PRESET_CLASSES = PRESETS.map(p => 'ui-' + p.id);
let presetIdx = 0;

function applyPreset(toast) {
  const p = PRESETS[presetIdx];
  document.body.classList.remove(...PRESET_CLASSES);
  document.body.classList.add('ui-' + p.id);
  const lbl = document.getElementById('ui-cycle-label');
  if (lbl) lbl.textContent = p.label;
  if (toast) showPresetToast(`${p.label} · ${p.hint}`);
  try { localStorage.setItem('goose_ui_preset', String(presetIdx)); } catch (e) {}
}
function cyclePreset() {
  presetIdx = (presetIdx + 1) % PRESETS.length;
  applyPreset(true);
}
function showPresetToast(text) {
  const el = document.getElementById('ui-cycle-toast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 1500);
}
function wireFab() {
  document.getElementById('ui-cycle-btn')?.addEventListener('click', (e) => {
    e.preventDefault(); audio.init(); cyclePreset();
  });
}

/* ── keep body mode-class in sync so CSS shows the right control set ── */
let lastEditing = null;
function syncLoop() {
  const editing = S.isEditMode && !S.isPlaytesting;
  if (editing !== lastEditing) {
    document.body.classList.toggle('mode-edit', editing);
    document.body.classList.toggle('mode-play', !editing);
    lastEditing = editing;
    if (!editing) {
      // Leaving the editor drops the transient plane/group modes.
      planeMode = false;
      if (S.isDrawingPlane) { S.isDrawingPlane = false; if (S.editorPlanePreview) S.editorPlanePreview.visible = false; }
    }
    refreshEditModeButtons();
  }
  requestAnimationFrame(syncLoop);
}

/* ═══════════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════════ */
export function initMobileControls(api = {}) {
  if (api.handleMove) cbMove = api.handleMove;
  if (api.tryPlaceBlock) cbPlace = api.tryPlaceBlock;

  if (IS_TOUCH) document.body.classList.add('touch-device');
  document.body.classList.add('mode-play');

  try {
    const saved = parseInt(localStorage.getItem('goose_ui_preset') || '0', 10);
    if (saved >= 0 && saved < PRESETS.length) presetIdx = saved;
  } catch (e) {}

  wireCanvasGestures();
  wireOnscreenControls();
  wireFab();
  applyPreset(false);

  if (IS_TOUCH) requestAnimationFrame(syncLoop);
}
