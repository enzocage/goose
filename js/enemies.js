/* ═══════════════════════════════════════════════════════════
   ENEMY AI & LIVES
   BFS pathfinding for chasers, spawn-point selection, the trapped-win check,
   per-enemy roll kickoff, and the player life/invincibility bookkeeping.
   getEnemyMoveTargetY is a private helper; the rest are driven by the loop.
   ═══════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { S, audio } from './state.js';
import { MAX_LIVES, PLAYER_INVINCIBLE_DURATION } from './constants.js';
import { getPlayerWorldPos } from './scene.js';
import { showMessage } from './ui.js';
import { getBlocksInColumn, respawnPlayer, completeLevel } from './gameplay.js';

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

export function enemyBFS(enemy) {
  const fromX = enemy.grid.x, fromY = enemy.grid.y, fromZ = enemy.grid.z;
  const toX = S.playerGridPos.x, toZ = S.playerGridPos.z;
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
export function findEnemySpawnKey() {
  const sx = S.playerGridPos.x, sy = S.playerGridPos.y, sz = S.playerGridPos.z;
  const visited = new Set();
  visited.add(`${sx},${sy},${sz}`);
  const queue = [{ x: sx, y: sy, z: sz, dist: 0 }];
  const dirs = [{dx:1,dz:0},{dx:-1,dz:0},{dx:0,dz:1},{dx:0,dz:-1}];
  let best = { x: S.exitPos.x, y: S.exitPos.y, z: S.exitPos.z, dist: 0 };

  while (queue.length > 0) {
    const { x, y, z, dist } = queue.shift();
    const isSpecial = (x === S.exitPos.x && z === S.exitPos.z) || (x === sx && z === sz);
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

export function checkEnemiesTrappedWin() {
  if (S.isLevelComplete) return;
  // ONLY evaluate if there are active S.enemies in the level
  if (S.enemies.length === 0) return;

  let allTrapped = true;
  for (const enemy of S.enemies) {
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
      const block = S.activeBlocks.get(`${n.x},${n.y},${n.z}`);
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

export function startEnemyRoll(enemy, dx, dz) {
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

export function loseLife(cause) {
  if (S.playerInvincible) return;
  S.playerLives--;
  const isGameOver = S.playerLives <= 0;
  if (isGameOver) {
    S.playerLives = MAX_LIVES;
    audio.playGameOver();
  } else {
    audio.playDamage();
  }
  updateLivesUI();
  respawnPlayer(); // resets level + shows LEVEL RESTART
  // Override message and set invincibility AFTER respawn
  S.playerInvincible = true;
  S.playerInvincibleTimer = PLAYER_INVINCIBLE_DURATION;
  
  const msg = cause
    ? (isGameOver ? `${cause.toUpperCase()}! GAME OVER!` : `${cause.toUpperCase()}! LIFE LOST — ${S.playerLives} LEFT`)
    : (isGameOver ? 'GAME OVER!' : `LIFE LOST — ${S.playerLives} LEFT`);
  showMessage(msg, isGameOver ? 2.2 : 1.5);
}

export function updateLivesUI() {
  const el = document.getElementById('lives-display');
  if (!el) return;
  let html = '';
  for (let i = 0; i < MAX_LIVES; i++) {
    html += `<span class="life-heart${i < S.playerLives ? ' active' : ''}">♥</span>`;
  }
  el.innerHTML = html;
}
