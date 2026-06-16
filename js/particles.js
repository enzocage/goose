/* ═══════════════════════════════════════════════════════════
   PARTICLES & EFFECTS
   Spawners push short-lived meshes into effectsGroup / the S.particles &
   S.trailParts pools (advanced + culled each frame by the render loop), plus
   the screen-shake and fall-flash cues.
   ═══════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { S } from './state.js';
import { effectsGroup, geoTrail, getPlayerWorldPos } from './scene.js';

export function spawnEntranceParticles(gx, gy, gz) {
  const pos = getPlayerWorldPos(gx, gy, gz, false);
  for (let i=0;i<20;i++) {
    const mat = new THREE.MeshBasicMaterial({ color:'#ff8844', transparent:true, opacity:1 });
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.03,4,4), mat);
    p.position.copy(pos);
    p.position.x += (Math.random()-0.5)*0.6;
    p.position.z += (Math.random()-0.5)*0.6;
    p.userData = { vel:new THREE.Vector3((Math.random()-0.5)*2, Math.random()*3+1, (Math.random()-0.5)*2), life:0.6+Math.random()*0.5, age:0 };
    effectsGroup.add(p); S.particles.push(p);
  }
}

export function spawnCollectParticles(wPos) {
  for (let i=0;i<14;i++) {
    const mat = new THREE.MeshBasicMaterial({ color:'#ffdd44', transparent:true, opacity:1 });
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.04,4,4), mat);
    p.position.copy(wPos);
    p.userData = { vel:new THREE.Vector3((Math.random()-0.5)*3, Math.random()*4+1.5, (Math.random()-0.5)*3), life:0.5+Math.random()*0.4, age:0 };
    effectsGroup.add(p); S.particles.push(p);
  }
}

export function spawnBreakParticles(gx, gy, gz) {
  const pos = new THREE.Vector3(gx, gy, gz);
  for (let i=0;i<16;i++) {
    const mat = new THREE.MeshBasicMaterial({ color:'#884444', transparent:true, opacity:1 });
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.08+Math.random()*0.1, 0.06, 0.08+Math.random()*0.1), mat);
    p.position.copy(pos);
    p.position.x += (Math.random()-0.5)*0.5;
    p.position.z += (Math.random()-0.5)*0.5;
    p.userData = { vel:new THREE.Vector3((Math.random()-0.5)*2.5, Math.random()*2.5+0.5, (Math.random()-0.5)*2.5), life:0.5+Math.random()*0.6, age:0 };
    effectsGroup.add(p); S.particles.push(p);
  }
}

export function spawnLandingParticles(gx, gy, gz) {
  const pos = new THREE.Vector3(gx, gy + 0.5, gz);
  for (let i=0;i<12;i++) {
    const mat = new THREE.MeshBasicMaterial({ color:'#ffffff', transparent:true, opacity:0.8 });
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.03,4,4), mat);
    p.position.copy(pos);
    p.userData = { vel:new THREE.Vector3((Math.random()-0.5)*3, Math.random()*2+1, (Math.random()-0.5)*3), life:0.4+Math.random()*0.3, age:0 };
    effectsGroup.add(p); S.particles.push(p);
  }
}

export function spawnTeleportParticles(gx, gy, gz) {
  const pos = new THREE.Vector3(gx, gy + 0.5, gz);
  for (let i=0;i<20;i++) {
    const mat = new THREE.MeshBasicMaterial({ color:'#9966ff', transparent:true, opacity:1 });
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.04,4,4), mat);
    p.position.copy(pos);
    p.userData = { vel:new THREE.Vector3((Math.random()-0.5)*4, Math.random()*3+2, (Math.random()-0.5)*4), life:0.3+Math.random()*0.4, age:0 };
    effectsGroup.add(p); S.particles.push(p);
  }
}

export function spawnPlutoniumDepositParticles(gx, gy, gz) {
  const pos = new THREE.Vector3(gx, gy + 0.5, gz);
  const colors = ['#d946ef', '#a21caf', '#701a75', '#ffffff'];
  for (let i = 0; i < 35; i++) {
    const color = colors[Math.floor(Math.random() * colors.length)];
    const mat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 1.0 });
    const size = 0.03 + Math.random() * 0.05;
    const p = new THREE.Mesh(new THREE.SphereGeometry(size, 4, 4), mat);
    p.position.copy(pos);
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.5 + Math.random() * 4.5;
    const vel = new THREE.Vector3(
      Math.cos(angle) * speed,
      Math.random() * 6.0 + 3.0,
      Math.sin(angle) * speed
    );
    p.userData = { vel: vel, life: 0.6 + Math.random() * 0.6, age: 0 };
    effectsGroup.add(p);
    S.particles.push(p);
  }
}

export function spawnLevelCompleteExplosion() {
  const colors = ['#ff0055', '#00ffaa', '#ffaa00', '#00ccff', '#ff00ff', '#ffff00', '#ffffff'];
  const pos = new THREE.Vector3(S.exitPos.x, S.exitPos.y + 0.5, S.exitPos.z);
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
    S.particles.push(p);
  }
}

export function spawnTrailParticle() {
  if (!S.playerCube) return;
  const p = new THREE.Mesh(geoTrail, new THREE.MeshBasicMaterial({ color:'#ff8844', transparent:true, opacity:0.5 }));
  p.position.copy(S.playerCube.position);
  p.userData = { life:0.3, age:0 };
  effectsGroup.add(p); S.trailParts.push(p);
}

export function addShake(intensity) { S.shakeIntensity = Math.max(S.shakeIntensity, intensity); }
export function flashScreen(color) {
  const flash = document.getElementById('fall-flash');
  flash.style.background = `radial-gradient(circle, ${color} 0%, transparent 60%)`;
  flash.classList.add('active');
  setTimeout(() => flash.classList.remove('active'), 140);
}
