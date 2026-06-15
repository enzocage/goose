import * as THREE from 'three';
import { geoTile, bridgeGroup } from './scene.js';

/* ═══ LEVEL DATA STRUCTURE ═══ */
export class Level3D {
  constructor() {
    this.name = "New Level";
    this.world = 0;
    this.par = 10;
    this.start = { x:0, y:0, z:0 };
    this.exit = { x:3, y:0, z:3 };
    this.blocks = new Map(); // key "x,y,z" -> {x, y, z, type, properties}
    this.prisms = new Map(); // key "x,y,z" -> {type}
    this.enemies = new Map(); // key "x,y,z" -> {} (rainbow chaser spawn points)
    this.links = []; // Trigger links: {type, from, to} / {type, k1, k2}
  }
}

/* ═══ MOVING PLATFORM (compound-object driver) ═══ */
export class MovingPlatform {
  constructor(id, startX, startY, startZ, endX, endY, endZ, speed = 1.5, active = true) {
    this.id = id;
    this.start = new THREE.Vector3(startX, startY, startZ);
    this.end = new THREE.Vector3(endX, endY, endZ);
    this.speed = speed;
    this.active = active;
    this.position = this.start.clone();
    this.prevPosition = this.start.clone();
    this.members = [];        // compound-object passengers carried rigidly with this driver
    this.isPassenger = false; // true if this platform is itself carried by another driver

    // Edge-style discrete stepping: the block moves one whole cell at a time
    // (eased), always resting on / cleanly transiting integer cells. This keeps
    // standing solid — you are either fully on the block's cell or not at all.
    this.path = MovingPlatform.buildPath(this.start, this.end);
    this.seg = 0;                          // index of the cell we move FROM
    this.dir = this.path.length > 1 ? 1 : 0; // travel direction along the path
    this.stepT = 0;                        // 0..1 progress within the current 1-cell step
    this.moveDir = new THREE.Vector3();    // integer step direction this frame (0 = idle)
    this.targetCell = this.start.clone();  // integer cell currently being entered

    this.mesh = new THREE.Mesh(geoTile, new THREE.MeshStandardMaterial({
      color: 0x44aa55, roughness: 0.3, metalness: 0.2, emissive: 0x114411, emissiveIntensity: 0.5
    }));
    this.mesh.position.copy(this.position);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.userData = { key: id, type: 'moving' };

    // outline
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geoTile), new THREE.LineBasicMaterial({ color: 0x88ffaa, transparent: true, opacity: 0.6 }));
    this.mesh.add(edge);
    bridgeGroup.add(this.mesh);
  }

  // Attach a grouped block so it rides rigidly with this platform.
  // gridOffset is the member's cell offset from the driver start (used for
  // collision); baseMeshPos preserves the mesh's own render offset (e.g. the
  // +0.4 Y of bridge tiles).
  attachMember(block, mesh) {
    this.members.push({
      block, mesh,
      baseMeshPos: mesh.position.clone(),
      gridOffset: new THREE.Vector3(block.x - this.start.x, block.y - this.start.y, block.z - this.start.z)
    });
    block.isPassenger = true;
  }

  // Integer waypoints from a→b, one cell per step (Chebyshev).
  static buildPath(a, b) {
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), Math.abs(b.z - a.z));
    if (steps === 0) return [a.clone()];
    const path = [];
    for (let i = 0; i <= steps; i++) {
      path.push(new THREE.Vector3(
        Math.round(a.x + (b.x - a.x) * i / steps),
        Math.round(a.y + (b.y - a.y) * i / steps),
        Math.round(a.z + (b.z - a.z) * i / steps)
      ));
    }
    return path;
  }

  update(dt) {
    if (!this.active) return;
    this.prevPosition.copy(this.position);
    if (this.path.length < 2 || this.dir === 0) { this.moveDir.set(0, 0, 0); return; }

    const from = this.path[this.seg];
    const to = this.path[this.seg + this.dir];
    this.targetCell.copy(to);
    this.moveDir.copy(to).sub(from);

    // speed is cells per second; ease in/out for a weighty, solid feel
    this.stepT += this.speed * dt;
    const tt = Math.min(this.stepT, 1);
    const e = tt < 0.5 ? 2 * tt * tt : 1 - Math.pow(-2 * tt + 2, 2) / 2;
    this.position.lerpVectors(from, to, e);

    if (this.stepT >= 1) {
      this.stepT = 0;
      this.seg += this.dir;
      this.position.copy(this.path[this.seg]); // snap to clean integer cell
      if (this.seg >= this.path.length - 1) this.dir = -1;
      else if (this.seg <= 0) this.dir = 1;
    }
    this.mesh.position.copy(this.position);

    // Carry passengers by the same displacement
    if (this.members.length) {
      const disp = this.position.clone().sub(this.start);
      for (const m of this.members) m.mesh.position.copy(m.baseMeshPos).add(disp);
    }
  }

  dispose() {
    bridgeGroup.remove(this.mesh);
    if (this.mesh.material) this.mesh.material.dispose();
  }
}

/* ═══ LEGACY LEVEL CONVERTER ═══ */
export function convertTo3D(level) {
  if (level.is3D) return level;
  const lvl = new Level3D();
  lvl.name = level.name;
  lvl.world = level.world;
  lvl.par = level.par;
  lvl.start = { x: level.start[0], y: 0, z: level.start[1] };
  lvl.exit = { x: level.exit[0], y: 0, z: level.exit[1] };

  // Convert tiles
  for (const [x, z] of level.tiles) {
    const key = `${x},0,${z}`;
    let type = 'normal';
    if (level.fragile && level.fragile.some(([fx,fz])=>fx===x && fz===z)) type = 'fragile';
    else if (level.ice && level.ice.some(([ix,iz])=>ix===x && iz===z)) type = 'ice';
    else if (level.switches && Object.values(level.switches).some(([sx,sz])=>sx===x && sz===z)) type = 'switch';
    else if (level.teleporters && Object.values(level.teleporters).some(p=>p.some(([tx,tz])=>tx===x && tz===z))) type = 'teleporter';

    lvl.blocks.set(key, { x, y:0, z, type, properties: {} });
  }

  // Convert prisms
  for (const [px, pz] of level.prisms) {
    lvl.prisms.set(`${px},0,${pz}`, { type:'normal' });
  }

  // Convert switch links
  if (level.switches && level.bridges) {
    Object.entries(level.switches).forEach(([bid, [sx,sz]]) => {
      const bTiles = level.bridges[bid] || [];
      bTiles.forEach(([bx,bz]) => {
        // Place bridge tile
        lvl.blocks.set(`${bx},0,${bz}`, { x:bx, y:0, z:bz, type:'bridge', properties:{} });
        lvl.links.push({ type:'switch-trigger', from:`${sx},0,${sz}`, to:`${bx},0,${bz}` });
      });
    });
  }

  // Convert teleporters
  if (level.teleporters) {
    Object.values(level.teleporters).forEach(pair => {
      if (pair.length === 2) {
        lvl.links.push({ type:'teleporter-link', k1:`${pair[0][0]},0,${pair[0][1]}`, k2:`${pair[1][0]},0,${pair[1][1]}` });
      }
    });
  }

  lvl.is3D = true;
  return lvl;
}

/* ═══ SERIALIZE / DESERIALIZE ═══ */
export function serializeLevel(level3D) {
  const blocks = [];
  level3D.blocks.forEach((b, k) => {
    blocks.push([b.x, b.y, b.z, b.type, b.properties]);
  });
  const prisms = [];
  level3D.prisms.forEach((p, k) => {
    const [px,py,pz] = k.split(',').map(Number);
    prisms.push([px,py,pz,p.type]);
  });
  const enemies = [];
  (level3D.enemies || new Map()).forEach((e, k) => {
    const [ex,ey,ez] = k.split(',').map(Number);
    enemies.push([ex,ey,ez]);
  });
  return JSON.stringify({
    name: level3D.name, world: level3D.world, par: level3D.par,
    start: [level3D.start.x, level3D.start.y, level3D.start.z],
    exit: [level3D.exit.x, level3D.exit.y, level3D.exit.z],
    blocks, prisms, enemies, links: level3D.links
  });
}


export function deserializeLevel(jsonStr) {
  const data = JSON.parse(jsonStr);
  const lvl = new Level3D();
  lvl.name = data.name || "Custom Level";
  lvl.world = data.world ?? 0;
  lvl.par = data.par ?? 10;
  lvl.start = { x:data.start[0], y:data.start[1], z:data.start[2] };
  lvl.exit = { x:data.exit[0], y:data.exit[1], z:data.exit[2] };
  data.blocks.forEach(arr => {
    lvl.blocks.set(`${arr[0]},${arr[1]},${arr[2]}`, { x:arr[0], y:arr[1], z:arr[2], type:arr[3], properties:arr[4] || {} });
  });
  data.prisms.forEach(arr => {
    lvl.prisms.set(`${arr[0]},${arr[1]},${arr[2]}`, { type:arr[3] || 'normal' });
  });
  (data.enemies || []).forEach(arr => {
    lvl.enemies.set(`${arr[0]},${arr[1]},${arr[2]}`, {});
  });
  lvl.links = data.links || [];
  return lvl;
}
