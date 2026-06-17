/* ═══════════════════════════════════════════════════════════
   LEVEL PREVIEW — 3D thumbnail renderer
   Creates an offscreen Three.js scene that renders a miniature
   top-down / isometric view of any serialised level.
   ═══════════════════════════════════════════════════════════ */
import * as THREE from 'three';

let renderer = null;
let scene = null;
let camera = null;
let previewGroup = null;
let animFrameId = null;

const PREVIEW_W = 800;
const PREVIEW_H = 800;

const BLOCK_COLORS = {
  normal:       '#5566aa',
  fragile:      '#cc5555',
  ice:          '#66bbdd',
  switch:       '#6677dd',
  bridge:       '#5588aa',
  teleporter:   '#7744dd',
  moving:       '#66cc77',
  pushable:     '#cc8844',
  pressureplate:'#4488ff',
  danger:       '#ff3344',
  shaker:       '#aa7777',
  booster:      '#ffdd44',
  container:    '#d946ef',
};

const PRISM_COLOR      = '#ffdd44';
const MINIPRISM_COLOR  = '#00ccff';
const START_COLOR      = '#ff6600';
const EXIT_COLOR       = '#00ffaa';

function ensureRenderer() {
  if (renderer) return;

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setSize(PREVIEW_W, PREVIEW_H);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.6;

  scene = new THREE.Scene();
  scene.background = new THREE.Color('#1a1a2e');

  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);

  // Bright lighting
  const ambient = new THREE.AmbientLight('#88aadd', 1.2);
  scene.add(ambient);
  const dirLight = new THREE.DirectionalLight('#ffffff', 3.0);
  dirLight.position.set(10, 20, 5);
  scene.add(dirLight);
  const fillLight = new THREE.DirectionalLight('#aaccff', 1.0);
  fillLight.position.set(-8, 12, -10);
  scene.add(fillLight);
  const backLight = new THREE.DirectionalLight('#ffccaa', 0.6);
  backLight.position.set(0, -5, -10);
  scene.add(backLight);

  previewGroup = new THREE.Group();
  scene.add(previewGroup);
}

export function renderLevelPreview(levelData, canvas) {
  ensureRenderer();

  // Stop any previous animation
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }

  // Clear previous preview meshes
  while (previewGroup.children.length) {
    const c = previewGroup.children[previewGroup.children.length - 1];
    disposeMesh(c);
    previewGroup.remove(c);
  }

  // Normalise block data: raw JSON uses arrays [x,y,z,type,props],
  // while Level3D uses objects {x,y,z,type,properties}.
  const rawBlocks = levelData.blocks || [];
  const rawPrisms = levelData.prisms || [];
  const start = levelData.start || { x: 0, y: 0, z: 0 };
  const exit  = levelData.exit  || { x: 1, y: 0, z: 1 };

  // Convert start/exit from array format if needed
  const s = Array.isArray(start) ? { x: start[0], y: start[1], z: start[2] || 0 } : start;
  const e = Array.isArray(exit)  ? { x: exit[0], y: exit[1], z: exit[2] || 0 } : exit;

  function normaliseBlock(b) {
    if (Array.isArray(b)) return { x: b[0], y: b[1], z: b[2], type: b[3], properties: b[4] || {} };
    return b;
  }
  function normalisePrism(p) {
    if (Array.isArray(p)) return { x: p[0], y: p[1], z: p[2], type: p[3] || 'prism' };
    return p;
  }

  const blocks = rawBlocks.map(normaliseBlock);
  const prisms = rawPrisms.map(normalisePrism);

  // Find bounds
  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  let maxY = 0;

  function extendBounds(x, y, z) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
    if (y > maxY) maxY = y;
  }

  blocks.forEach(b => extendBounds(b.x, b.y, b.z));
  extendBounds(s.x, s.y, s.z);
  extendBounds(e.x, e.y, e.z);

  if (!isFinite(minX)) { minX = 0; maxX = 1; minZ = 0; maxZ = 1; }

  const pad = 3;
  const sizeX = (maxX - minX) + pad * 2;
  const sizeZ = (maxZ - minZ) + pad * 2;
  const size = Math.max(sizeX, sizeZ, 8);

  const midX = (minX + maxX) / 2;
  const midZ = (minZ + maxZ) / 2;

  // Orthographic projection
  const aspect = PREVIEW_W / PREVIEW_H;
  let viewSize = size * 0.7;
  if (aspect > 1) {
    camera.left = -viewSize * aspect;
    camera.right = viewSize * aspect;
    camera.top = viewSize;
    camera.bottom = -viewSize;
  } else {
    camera.left = -viewSize;
    camera.right = viewSize;
    camera.top = viewSize / aspect;
    camera.bottom = -viewSize / aspect;
  }
  camera.near = 0.1;
  camera.far = 100;
  camera.updateProjectionMatrix();

  // Isometric angle
  const angleY = Math.PI / 4;
  const angleX = 0.55;

  const dist = size * 1.2;
  camera.position.set(
    midX + Math.sin(angleY) * Math.cos(angleX) * dist,
    Math.sin(angleX) * dist + 1,
    midZ + Math.cos(angleY) * Math.cos(angleX) * dist
  );
  camera.lookAt(midX, 0, midZ);

  // ── Build level meshes ──────────────────────────────────
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);

  blocks.forEach(b => {
    const color = BLOCK_COLORS[b.type] || '#2a2a38';
    let h = 1;
    let y = b.y;

    if (b.type === 'bridge') {
      h = 0.2;
      y += 0.4;
    }

    const mat = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.5,
      metalness: 0.12,
      emissive: color,
      emissiveIntensity: 0.06,
    });

    const mesh = new THREE.Mesh(
      b.type === 'bridge' ? new THREE.BoxGeometry(1, h, 1) : boxGeo,
      mat
    );
    mesh.position.set(b.x, y + h / 2, b.z);
    previewGroup.add(mesh);
  });

  // Start marker (flat cylinder)
  const startMat = new THREE.MeshStandardMaterial({
    color: START_COLOR,
    emissive: START_COLOR,
    emissiveIntensity: 0.5,
    roughness: 0.3,
  });
  const startMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 16), startMat);
  startMesh.position.set(s.x, 0.03, s.z);
  startMesh.rotation.x = -Math.PI / 2;
  previewGroup.add(startMesh);

  // Exit ring
  const exitMat = new THREE.MeshStandardMaterial({
    color: EXIT_COLOR,
    emissive: EXIT_COLOR,
    emissiveIntensity: 0.7,
    roughness: 0.2,
    metalness: 0.3,
  });
  const exitMesh = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.08, 12, 24), exitMat);
  exitMesh.position.set(e.x, 0.55, e.z);
  exitMesh.rotation.x = -Math.PI / 2;
  previewGroup.add(exitMesh);

  // Prisms
  prisms.forEach(p => {
    const isMini = p.type === 'miniprism';
    const color = isMini ? MINIPRISM_COLOR : PRISM_COLOR;
    const s = isMini ? 0.12 : 0.18;

    const mat = new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 0.8,
      roughness: 0.1,
      metalness: 0.3,
    });
    const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(s, 0), mat);
    const py = p.y !== undefined ? p.y : 0;
    mesh.position.set(
      p.x !== undefined ? p.x : 0,
      py + 0.55,
      p.z !== undefined ? p.z : 0
    );
    previewGroup.add(mesh);
  });

  // Render first frame immediately
  renderer.render(scene, camera);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(renderer.domElement, 0, 0, canvas.width, canvas.height);

  // Slow rotation
  let currentAngle = angleY;
  function animatePreview() {
    currentAngle += 0.008;
    camera.position.set(
      midX + Math.sin(currentAngle) * Math.cos(angleX) * dist,
      Math.sin(angleX) * dist + 1,
      midZ + Math.cos(currentAngle) * Math.cos(angleX) * dist
    );
    camera.lookAt(midX, 0, midZ);
    renderer.render(scene, camera);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(renderer.domElement, 0, 0, canvas.width, canvas.height);

    animFrameId = requestAnimationFrame(animatePreview);
  }
  animFrameId = requestAnimationFrame(animatePreview);
}

export function stopPreviewAnimation() {
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}

function disposeMesh(obj) {
  if (obj.geometry) obj.geometry.dispose();
  if (obj.material) obj.material.dispose();
  if (obj.children) obj.children.forEach(c => disposeMesh(c));
}