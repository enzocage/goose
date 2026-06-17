/* ═══════════════════════════════════════════════════════════
   GAMEPLAY SIMULATION
   The rolling/physics core (column queries, riding/pushed movers, balancing,
   crate pushing, roll start/execute/complete/reverse) and the block mechanics
   it drives on each step (switches, teleporters, prisms, fragile/shaker,
   pressure plates, mini-cube, level completion, respawn). Tightly mutually
   recursive, so kept in one module.
   ═══════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { S, audio } from './state.js';
import { CUBE_S, COMBO_TIMEOUT } from './constants.js';
import { getPlayerWorldPos, matPrismGlow, matPlutoniumGlow, prismsGroup, tilesGroup } from './scene.js';
import { deserializeLevel } from './level.js';
import { createBlockMesh, disposeMaterial } from './meshes.js';
import {
  addShake, flashScreen, spawnBreakParticles, spawnCollectParticles, spawnLandingParticles,
  spawnLevelCompleteExplosion, spawnPlutoniumDepositParticles, spawnTeleportParticles
} from './particles.js';
import { showMessage, updateComboUI, updateMoveUI, updatePlutoniumUI, updatePrismUI } from './ui.js';
import { buildLevel3D, loadPreMadeLevel, exitPlaytestMode } from './main.js';

export function getBlocksInColumn(gx, gz) {
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

export function checkRidingPlatform() {
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
export function checkPushedByPlatform() {
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

export function enterBalancing() {
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

export function executePush(block, toX, toY, toZ, dirX, dirZ) {
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

export function updatePressurePlates() {
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

export function triggerSwitchTargets(key, activeState) {
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

export function executeRollBack() {
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
export function canReverseRoll() {
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
export function reverseCurrentRoll() {
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

export function triggerShakerCrumble(block, key) {
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
export function isLastMoveKeyHeld() {
  if (S.lastMoveDir.x === 1) return S.keysPressed['ArrowRight'] || S.keysPressed['KeyD'];
  if (S.lastMoveDir.x === -1) return S.keysPressed['ArrowLeft'] || S.keysPressed['KeyA'];
  if (S.lastMoveDir.z === 1) return S.keysPressed['ArrowDown'] || S.keysPressed['KeyS'];
  if (S.lastMoveDir.z === -1) return S.keysPressed['ArrowUp'] || S.keysPressed['KeyW'];
  return false;
}

export function startRoll(dirX, dirZ) {
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

export function executeRoll(toGX, targetY, toGZ, dirX, dirZ, action) {
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

export function onRollComplete() {
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
export function breakFragileBlock(key) {
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

export function triggerSwitch(key) {
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

export function triggerTeleport(key) {
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
export function checkPrismCollection(gx, gy, gz) {
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

export function activateMiniCube() {
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

export function checkGrowBack() {
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
export function checkLevelComplete() {
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

export function advanceCompletedLevel() {
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

export function completeLevel() {
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

export function respawnPlayer() {
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
