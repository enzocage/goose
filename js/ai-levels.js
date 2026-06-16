/* ═══════════════════════════════════════════════════════════
   AI LEVEL GENERATORS
   Self-contained procedural level builders. Each entry point returns a
   fully-populated Level3D and touches no shared game state:
     • generateAILabyrinth()        — 800-block maze with shakers + prisms
     • generateArchitectLevel(d)     — legacy difficulty-driven wrapper
     • generateArchitectLevel2(opts) — knob-driven "Architect" builder
     • generateArchitectLevel3(opts) — latest "Architect" builder
   See docs/ai-generator-2-concept.md for the design.
   ═══════════════════════════════════════════════════════════ */
import { Level3D } from './level.js';

export function generateAILabyrinth() {
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

export function generateArchitectLevel(difficulty) {
  const P = architectParams(difficulty);
  const world = Math.min(4, Math.floor((difficulty - 1) / 2));
  return buildArchitect(P, `Architect · Lvl ${difficulty}`, world);
}

// AI Pro2 — toggle-driven Architect. The 10 criteria switch whole element
// families on/off; `size` (1..10) scales how much of each enabled family
// appears. The shared builder still guarantees a solvable level.
export function generateArchitectLevel2(opts) {
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
export function generateArchitectLevel3(opts) {
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
