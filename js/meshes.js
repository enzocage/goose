/* ═══════════════════════════════════════════════════════════
   MESH FACTORIES & MATERIAL UTILITIES
   Pure builders that turn block/prism/enemy data into THREE meshes (added to
   the scene groups), plus the opacity/disposal helpers. No game logic — they
   read scene materials/geometries and S, and are called by buildLevel3D and
   the editor place tools.
   ═══════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { S } from './state.js';
import {
  matTileBase, matTileFragile, matTileIce, matTileSwitch, matTileTp, matTileExit,
  matPrism, matMiniPrism, matBridge, matSwitchPillar, matCrate, matPressurePlate,
  matDanger, matShaker, matBooster, matPlutonium, matContainer,
  geoTile, geoThinTile, geoCube, geoPrism, geoPillar,
  worldGroup, tilesGroup, prismsGroup, getPlayerWorldPos
} from './scene.js';

export function setMeshOpacity(mesh, opacity, depthWrite, keepTopOpaque = false, baseOpacity = 1.0) {
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

export function disposeMaterial(mat) {
  if (!mat) return;
  if (Array.isArray(mat)) {
    mat.forEach(m => { if (m && typeof m.dispose === 'function') m.dispose(); });
  } else if (typeof mat.dispose === 'function') {
    mat.dispose();
  }
}

export function createBlockMesh(block, key) {
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

export function createPrismMesh(key, p) {
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
export function spawnEnemy(key) {
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
export function createEnemyMarker(key) {
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
