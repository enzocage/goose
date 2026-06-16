import * as THREE from 'three';
import { TILE_SIZE, CUBE_S } from './constants.js';



/* ═══ THREE.JS SETUP: renderer, scene, camera, lights, materials, geometries, groups ═══ */
const container = document.getElementById('canvas-container');
const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0a0a14');
scene.fog = new THREE.Fog('#0a0a14', 12, 38);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth/window.innerHeight, 0.5, 75);
camera.position.set(8, 10, 10);

const ambient = new THREE.AmbientLight('#334466', 1.2);
scene.add(ambient);
const sun = new THREE.DirectionalLight('#ffe8d0', 3.5);
sun.position.set(12, 22, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.near = 0.5; sun.shadow.camera.far = 60;
sun.shadow.camera.left = -20; sun.shadow.camera.right = 20;
sun.shadow.camera.top = 20; sun.shadow.camera.bottom = -20;
sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.02;
scene.add(sun);
const rim = new THREE.DirectionalLight('#88aaff', 1.2);
rim.position.set(-5, 3, -4); scene.add(rim);
const underGlow = new THREE.PointLight('#ff5500', 18, 8, 1.5);
underGlow.position.set(0, -0.5, 0); scene.add(underGlow);

/* Shared materials */
const matTileBase   = new THREE.MeshStandardMaterial({ color:'#2a2a38', roughness:0.55, metalness:0.15 });
const matTileFragile= new THREE.MeshStandardMaterial({ color:'#442222', roughness:0.35, metalness:0.1, emissive:'#331111', emissiveIntensity:0.3 });
const matTileIce    = new THREE.MeshStandardMaterial({ color:'#335566', roughness:0.2, metalness:0.3, emissive:'#4488aa', emissiveIntensity:0.4 });
const matTileSwitch = new THREE.MeshStandardMaterial({ color:'#333344', roughness:0.3, metalness:0.2, emissive:'#4466aa', emissiveIntensity:0.5 });
const matTileTp     = new THREE.MeshStandardMaterial({ color:'#2a2244', roughness:0.25, metalness:0.3, emissive:'#6633cc', emissiveIntensity:0.5 });
const matTileExit   = new THREE.MeshStandardMaterial({ color:'#115544', roughness:0.3, metalness:0.1, emissive:'#00ffaa', emissiveIntensity:0.55 });
const matCube       = new THREE.MeshStandardMaterial({ color:'#ff6600', roughness:0.22, metalness:0.05, emissive:'#ff4400', emissiveIntensity:0.35 });
const matPrism      = new THREE.MeshStandardMaterial({ color:'#ffdd44', roughness:0.12, metalness:0.3, emissive:'#ffaa00', emissiveIntensity:0.9 });
const matMiniPrism  = new THREE.MeshStandardMaterial({ color:'#00ccff', roughness:0.12, metalness:0.3, emissive:'#0099ff', emissiveIntensity:0.9 });
const matPrismGlow  = new THREE.MeshStandardMaterial({ color:'#ffffff', roughness:0.1, metalness:0.1, emissive:'#ffffff', emissiveIntensity:1.5 });
const matBridge     = new THREE.MeshStandardMaterial({ color:'#334455', roughness:0.3, metalness:0.2, emissive:'#335577', emissiveIntensity:0.4 });
const matSwitchPillar = new THREE.MeshStandardMaterial({ color:'#5566aa', roughness:0.25, metalness:0.4, emissive:'#4466cc', emissiveIntensity:0.6 });

const matCrate      = new THREE.MeshStandardMaterial({ color:'#8b5a2b', roughness:0.8, metalness:0.0, emissive:'#3a200a', emissiveIntensity:0.25 });
const matPressurePlate = new THREE.MeshStandardMaterial({ color:'#2244aa', roughness:0.2, metalness:0.3, emissive:'#3366ff', emissiveIntensity:0.5 });
const matDanger     = new THREE.MeshStandardMaterial({ color:'#221111', roughness:0.4, metalness:0.1, emissive:'#ff2233', emissiveIntensity:0.8 });
const matShaker     = new THREE.MeshStandardMaterial({ color:'#554444', roughness:0.9, metalness:0.0, emissive:'#221111', emissiveIntensity:0.15 });
const matBooster    = new THREE.MeshStandardMaterial({ color:'#223322', roughness:0.3, metalness:0.2, emissive:'#ffcc00', emissiveIntensity:0.95 });
const matPlutonium  = new THREE.MeshStandardMaterial({ color:'#110011', roughness:0.25, metalness:0.3, emissive:'#a21caf', emissiveIntensity:1.0 });
const matPlutoniumGlow = new THREE.MeshStandardMaterial({ color:'#ffffff', roughness:0.1, metalness:0.1, emissive:'#d946ef', emissiveIntensity:2.0 });
const matContainer = new THREE.MeshStandardMaterial({
  roughness: 0.4,
  metalness: 0.2
});

matContainer.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader.replace(
    '#include <varying_pars_vertex>',
    `#include <varying_pars_vertex>
     varying vec3 vLocalPosition;`
  );
  shader.vertexShader = shader.vertexShader.replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
     vLocalPosition = position;`
  );
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <varying_pars_fragment>',
    `#include <varying_pars_fragment>
     varying vec3 vLocalPosition;`
  );
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <color_fragment>',
    `#include <color_fragment>
     float coord = vLocalPosition.x + vLocalPosition.y + vLocalPosition.z;
     float pattern = sin(coord * 15.70796327); // 5.0 * PI
     float stripe = smoothstep(-0.015, 0.015, pattern);
     vec3 stripeColor = mix(vec3(0.07, 0.07, 0.07), vec3(1.0, 0.8, 0.0), stripe);
     diffuseColor.rgb = stripeColor;`
  );
};


/* Shared geometries */
const geoTile       = new THREE.BoxGeometry(TILE_SIZE, TILE_SIZE, TILE_SIZE);
const geoThinTile   = new THREE.BoxGeometry(TILE_SIZE, 0.2, TILE_SIZE);
const geoCube       = new THREE.BoxGeometry(CUBE_S, CUBE_S, CUBE_S, 2, 2, 2);
const geoPrism      = new THREE.OctahedronGeometry(0.18, 0);
const geoRing       = new THREE.TorusGeometry(0.32, 0.07, 16, 24);
const geoPillar     = new THREE.CylinderGeometry(0.12, 0.14, 0.35, 8);
const geoTrail      = new THREE.SphereGeometry(0.05, 4, 4);

/* Scene groups */
const worldGroup   = new THREE.Group();
const tilesGroup   = new THREE.Group();
const prismsGroup  = new THREE.Group();
const effectsGroup = new THREE.Group();
const bridgeGroup  = new THREE.Group();
worldGroup.add(tilesGroup); worldGroup.add(prismsGroup);
worldGroup.add(effectsGroup); worldGroup.add(bridgeGroup);
scene.add(worldGroup);

/* ═══ SPATIAL 3D STARFIELD ═══
   A dense dome of solid round stars surrounding the camera for background depth
   while playing. A custom shader draws perfectly circular, full-bodied discs
   with a bright sparkle core and per-star twinkle (driven by uTime). Recentred
   on the camera each frame and given a slow rotation + breathing "zoom" pulse
   (see main.js) for a mystical drifting-through-space feel. Stars ignore scene
   fog and sit inside the camera far plane, so they never clip or fade out. */
const STAR_COLORS = [
  '#ffffff', '#ffffff', '#cfe6ff', '#9fd0ff', '#ffe9c9',
  '#ffd36e', '#ff7ad9', '#7afcff', '#9b8bff', '#7dff9e', '#ff6f91',
];
const starUniforms = {
  uTime: { value: 0 },
  uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
};
const STAR_VERT = `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aPhase;
  uniform float uTime;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vTw;
  void main() {
    float tw = 0.45 + 0.55 * sin(uTime * 2.0 + aPhase); // per-star twinkle
    vTw = tw;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float size = aSize * uPixelRatio * (220.0 / -mv.z) * (0.7 + 0.6 * tw);
    gl_PointSize = clamp(size, 1.0, 56.0);
    gl_Position = projectionMatrix * mv;
  }`;
const STAR_FRAG = `
  varying vec3 vColor;
  varying float vTw;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;                  // perfectly round
    float disc = smoothstep(0.5, 0.44, d); // solid, full-bodied fill (thin AA edge)
    float core = smoothstep(0.34, 0.0, d); // bright sparkle centre
    vec3 col = vColor * (0.8 + 1.1 * core);
    gl_FragColor = vec4(col * (0.45 + 0.75 * vTw), disc);
  }`;
function buildStarfield(count, rMin, rMax) {
  const palette = STAR_COLORS.map(c => new THREE.Color(c));
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = rMin + Math.random() * (rMax - rMin);
    positions[i*3]   = r * Math.sin(phi) * Math.cos(theta);
    positions[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i*3+2] = r * Math.cos(phi);
    const col = palette[(Math.random() * palette.length) | 0];
    const b = 0.75 + Math.random() * 0.35;
    colors[i*3] = col.r * b; colors[i*3+1] = col.g * b; colors[i*3+2] = col.b * b;
    // Mostly fine dust, some mid stars, a few big bright sparkles.
    const t = Math.random();
    sizes[i] = t > 0.97 ? 3.2 + Math.random() * 1.8
             : t > 0.82 ? 1.6 + Math.random() * 1.2
             : 0.7 + Math.random() * 0.9;
    phases[i] = Math.random() * Math.PI * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: starUniforms, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geo, mat);
}
const starfield = new THREE.Group();
starfield.add(buildStarfield(3600, 24, 62)); // dense, colourful, sparkly dome
starfield.renderOrder = -1;
scene.add(starfield);

export {
  renderer, scene, camera, underGlow, starfield, starUniforms,
  matTileBase, matTileFragile, matTileIce, matTileSwitch, matTileTp, matTileExit,
  matCube, matPrism, matMiniPrism, matPrismGlow, matBridge, matSwitchPillar,
  matCrate, matPressurePlate, matDanger, matShaker, matBooster,
  matPlutonium, matPlutoniumGlow, matContainer,
  geoTile, geoThinTile, geoCube, geoPrism, geoRing, geoPillar, geoTrail,
  worldGroup, tilesGroup, prismsGroup, effectsGroup, bridgeGroup
};
