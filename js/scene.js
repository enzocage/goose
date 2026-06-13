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

export {
  renderer, scene, camera, underGlow,
  matTileBase, matTileFragile, matTileIce, matTileSwitch, matTileTp, matTileExit,
  matCube, matPrism, matMiniPrism, matPrismGlow, matBridge, matSwitchPillar,
  matCrate, matPressurePlate, matDanger, matShaker, matBooster,
  geoTile, geoThinTile, geoCube, geoPrism, geoRing, geoPillar, geoTrail,
  worldGroup, tilesGroup, prismsGroup, effectsGroup, bridgeGroup
};
