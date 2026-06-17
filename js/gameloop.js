/* ═══════════════════════════════════════════════════════════
   RENDER LOOP
   The per-frame orchestrator: advances roll/balance/peek/camera animation,
   drives held-key auto-repeat and enemy AI ticks, updates particles/trails/
   stars/timers, applies dynamic transparency, and renders. Started once from
   main.js's bootstrap via requestAnimationFrame(animate).
   ═══════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { S, audio } from './state.js';
import { CAM_LERP, CUBE_S, ROLL_DUR_NORMAL, ROLL_DUR_MINI, MOVE_REPEAT_MS, ENEMY_MOVE_INTERVAL } from './constants.js';
import {
  renderer, scene, camera, underGlow, starfield, starUniforms,
  worldGroup, tilesGroup, prismsGroup, effectsGroup, bridgeGroup, getPlayerWorldPos
} from './scene.js';
import { setMeshOpacity } from './meshes.js';
import { addShake, spawnLandingParticles, spawnTrailParticle } from './particles.js';
import { updateComboUI, updateTimerUI } from './ui.js';
import { checkEnemiesTrappedWin, enemyBFS, loseLife, startEnemyRoll } from './enemies.js';
import {
  checkGrowBack, checkPushedByPlatform, checkRidingPlatform, getBlocksInColumn,
  isLastMoveKeyHeld, onRollComplete, respawnPlayer, updatePressurePlates
} from './gameplay.js';
import { updatePauseOrbitCamera } from './main.js';
import { handleMove } from './bootstrap.js';

export function updateDynamicTransparency() {
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

export function animate(timestamp) {
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

    // Held-direction auto-repeat: roll one cell every 300ms (or 150ms starting from the 2nd step) while a key is held.
    if (S.repeatMoveCode && S.keysPressed[S.repeatMoveCode] && !S.isLevelComplete) {
      S.moveRepeatTimer += dt * 1000;
      const currentRepeatMs = (S.repeatStepCount >= 2) ? (MOVE_REPEAT_MS * 0.5) : MOVE_REPEAT_MS;
      if (S.moveRepeatTimer >= currentRepeatMs) {
        S.moveRepeatTimer -= currentRepeatMs;
        S.repeatStepCount = (S.repeatStepCount || 0) + 1;
        handleMove(S.repeatMoveDir.x, S.repeatMoveDir.z);
      }
    } else {
      S.repeatMoveCode = null;
      S.moveRepeatTimer = 0;
      S.repeatStepCount = 0;
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
      if (S.repeatStepCount >= 2) dur *= 0.5;
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
