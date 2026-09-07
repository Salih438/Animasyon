/**
 * main.js — Phase 1: Three.js Scene Foundation
 *
 * Sorumluluklar:
 *   - Renderer, Scene, Camera, Clock
 *   - Scene hierarchy (root groups)
 *   - Animation loop (delta-time based)
 *   - Resize handling
 *   - Debug mode toggle
 *   - Module orchestration (Phase 2+ bağlantı noktaları)
 *
 * Koordinat sistemi (global sözleşme):
 *   Y = UP  |  Y=0 zemin  |  +Z kameradan uzağa
 *   Kamera sabit, dünya -Z yönünde akar (nesneler +Z→0 hareket eder)
 *
 * Mevcut p5.js parametrelerinin Three.js karşılıkları:
 *   FOCAL  = 300  → PerspectiveCamera fov=55 (eşdeğer perspektif hissi)
 *   CAM_SPD = 6   → world.js'de nesne hız sabiti (unit/frame → unit/s × delta)
 */

import * as THREE from 'three';

// ─── Scene modules (Phase 2+ doldurulacak) ──────────────────────────────────
import { initWorld,   updateWorld   } from './scene/world.js';
import { initGround,  updateGround, onResizeGround  } from './scene/ground.js';
import { initWalker,  updateWalker  } from './scene/walker.js';
import { initRain,    updateRain    } from './scene/rain.js';
import { initLighting, updateLighting, triggerLightning } from './scene/lighting.js';
import { initTraffic,  updateTraffic  } from './scene/traffic.js';
import { initPostprocessing, renderPostprocessing, onResizePostprocessing } from './scene/postprocessing.js';
import { initAudio, startAudio } from './scene/audio.js';

// ─── Central Configuration ──────────────────────────────────────────────────
export const CONFIG = Object.freeze({

  /** Kamera */
  camera: {
    fov:      52,       // Sinematik insan bakış açısı
    near:     0.1,
    far:      4000,
    // Walker (X=0, Y=0, Z=2) tam kameranın önünde ve merkezinde
    position: { x: 0.0, y: 1.80, z: -3.0 },
    lookAt:   { x: 0.0, y: 1.35, z: 40.0 },
  },

  /** Renderer */
  renderer: {
    maxPixelRatio: 2,
    powerPreference: 'high-performance',
  },

  /** Atmosfer */
  atmosphere: {
    backgroundColor: 0x05050a,
    fogColor:        0x050510,
    fogDensity:      0.00045,
  },

  /** Dünya hareketi — p5.js CAM_SPD=6 birim/frame → saniyeye normalize */
  world: {
    camSpeed:  6,           // birim/frame (60fps → unit/s = 360)
    zFar:      4000,        // spawn bandı uzak sınırı
    zNear:     5,           // respawn tetikleme eşiği
  },

  /** Gölge */
  shadow: {
    enabled: true,
    type:    'PCFSoft',     // THREE.PCFSoftShadowMap
  },

  /** Tone mapping */
  tonemap: {
    type:     'ACESFilmic', // THREE.ACESFilmicToneMapping
    exposure:  1.12,        // 1.08 - 1.15 aralığında dengelendi (gece derinliği + sıcak amber tonları)
  },
});

// ─── Debug flag ─────────────────────────────────────────────────────────────
export const DEBUG = false;

// ─── Core Three.js nesneleri ────────────────────────────────────────────────
export let scene, camera, renderer, clock;

// ─── Scene hierarchy — root groups ──────────────────────────────────────────
export const groups = {
  world:       null,   // binalar, sokak lambaları, yol çizgileri, arabalar
  ground:      null,   // asfalt, kaldırım, ıslak yüzey
  walker:      null,   // karakter + şemsiye
  rain:        null,   // yağmur parçacık sistemi
  lights:      null,   // tüm Three.js Light nesneleri
  environment: null,   // arka plan / gökyüzü
};

// ─── Re-usable temporaries (loop içinde allocation önleme) ──────────────────
// (Phase 2+ eklenecek: const _v3 = new THREE.Vector3() vb.)

// ════════════════════════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════════════════════════

function initRenderer() {
  renderer = new THREE.WebGLRenderer({
    antialias:       true,
    alpha:           false,
    powerPreference: CONFIG.renderer.powerPreference,
  });

  renderer.setPixelRatio(
    Math.min(window.devicePixelRatio, CONFIG.renderer.maxPixelRatio)
  );
  renderer.setSize(window.innerWidth, window.innerHeight);

  // Color management
  renderer.outputColorSpace  = THREE.SRGBColorSpace;
  renderer.toneMapping       = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = CONFIG.tonemap.exposure;

  // Shadow map
  renderer.shadowMap.enabled = CONFIG.shadow.enabled;
  renderer.shadowMap.type    = THREE.PCFSoftShadowMap;

  document.body.appendChild(renderer.domElement);
}

function initScene() {
  scene = new THREE.Scene();

  // Background + Fog
  scene.background = new THREE.Color(CONFIG.atmosphere.backgroundColor);
  scene.fog        = new THREE.FogExp2(
    CONFIG.atmosphere.fogColor,
    CONFIG.atmosphere.fogDensity
  );
}

function initCamera() {
  const { fov, near, far, position, lookAt } = CONFIG.camera;

  camera = new THREE.PerspectiveCamera(
    fov,
    window.innerWidth / window.innerHeight,
    near,
    far
  );

  camera.position.set(position.x, position.y, position.z);
  camera.lookAt(lookAt.x, lookAt.y, lookAt.z);

  // Kamera sabit kalır — her frame güncellenmez
}

function initClock() {
  clock = new THREE.Clock();
}

function initGroups() {
  const keys = Object.keys(groups);
  for (const key of keys) {
    groups[key] = new THREE.Group();
    groups[key].name = key;
    scene.add(groups[key]);
  }
}

function initDebugHelpers() {
  if (!DEBUG) return;

  // Axes: X=red, Y=green, Z=blue
  const axes = new THREE.AxesHelper(50);
  scene.add(axes);

  // Grid (XZ plane — zemin referansı)
  const grid = new THREE.GridHelper(500, 50, 0x222244, 0x111122);
  scene.add(grid);

  console.log('[DEBUG] Scene groups:', Object.keys(groups));
  console.log('[DEBUG] Camera:', camera.position, '→', CONFIG.camera.lookAt);
  console.log('[DEBUG] Renderer:', renderer.getContext().getParameter(
    renderer.getContext().VERSION
  ));
}

function initTestObjects() {
  // ─── Yalnızca DEBUG modunda görünür test geometrisi ─────────────────
  // Bu objeler production sahnesine ait değil.
  // Kamera, perspektif, fog ve renderer'ın çalıştığını doğrular.
  if (!DEBUG) return;

  const geo = new THREE.BoxGeometry(2, 2, 2);
  const mat = new THREE.MeshStandardMaterial({
    color:     0x223366,
    roughness: 0.7,
    metalness: 0.3,
    emissive:  0x111133,
  });

  // Merkez referans küpü
  const cube = new THREE.Mesh(geo, mat);
  cube.name = '__debug_cube__';
  cube.position.set(0, 1, 50);
  cube.castShadow    = true;
  cube.receiveShadow = true;
  scene.add(cube);

  // Uzakta fog testi için ikinci küp
  const cube2 = cube.clone();
  cube2.position.set(0, 1, 500);
  scene.add(cube2);

  // Çok uzakta — fog tarafından yutulmalı
  const cube3 = cube.clone();
  cube3.position.set(0, 1, 2000);
  scene.add(cube3);
}

// ════════════════════════════════════════════════════════════════════════════
//  RESIZE
// ════════════════════════════════════════════════════════════════════════════

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;

  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  renderer.setSize(w, h);

  // Reflector render target boyutunu da güncelle (Phase 8)
  onResizeGround(w, h);

  // Post-processing composer & pass çözünürlüklerini güncelle (Phase 9)
  onResizePostprocessing(w, h);
}

// ════════════════════════════════════════════════════════════════════════════
//  UPDATE — Delta-time tabanlı, frame-rate bağımsız
// ════════════════════════════════════════════════════════════════════════════

function update(delta) {
  // Phase 2+: her modülün update'i buradan çağrılacak
  updateWorld(delta);
  updateGround(delta);
  updateWalker(delta);
  updateRain(delta);
  updateLighting(delta, camera?.position);
  updateTraffic(delta);
}

// ════════════════════════════════════════════════════════════════════════════
//  RENDER
// ════════════════════════════════════════════════════════════════════════════

function render(delta) {
  // Post-processing aktifse composer üzerinden, yoksa doğrudan renderer render
  if (!renderPostprocessing(delta)) {
    renderer.render(scene, camera);
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  ANIMATION LOOP
// ════════════════════════════════════════════════════════════════════════════

function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();

  update(delta);
  render(delta);
}

// ════════════════════════════════════════════════════════════════════════════
//  ENTRY POINT
// ════════════════════════════════════════════════════════════════════════════

async function main() {
  // 1. Core Three.js
  initRenderer();
  initScene();
  initCamera();
  initClock();
  initGroups();

  // 2. Modüller (Phase 1'de stub, Phase 2+ gerçek içerik)
  await initLighting(scene, groups.lights, CONFIG);
  await initGround(scene, groups.ground, CONFIG);
  await initWorld(scene, groups.world, CONFIG);
  await initWalker(scene, groups.walker, CONFIG);
  await initRain(scene, groups.rain, CONFIG);
  await initTraffic(scene, groups.world, CONFIG);
  await initPostprocessing(renderer, scene, camera, CONFIG);

  // 3. Web Audio API Başlatma Hazırlığı
  initAudio();

  // 4. Debug araçları + test objeleri
  initDebugHelpers();
  initTestObjects();

  // 5. Event listeners
  window.addEventListener('resize', onResize);

  // 6. Şimşek Etkileşimi & Ses Motoru (İlk tıklama / tuş ile Web Audio API aktifleşir)
  window.addEventListener('pointerdown', () => {
    startAudio();
    triggerLightning();
  });
  window.addEventListener('keydown', (e) => {
    startAudio();
    if (e.code === 'Space') {
      e.preventDefault();
      triggerLightning();
    }
  });

  // 6. Loading ekranını gizle
  const loadingEl = document.getElementById('loading');
  if (loadingEl) {
    loadingEl.classList.add('hidden');
    setTimeout(() => loadingEl.remove(), 700);
  }

  // 7. Loop başlat
  animate();

  if (DEBUG) {
    console.log('[main] Scene initialized. Groups:', scene.children.map(c => c.name));
    console.log('[main] Renderer info:', renderer.info);
  }
}

main().catch(err => {
  console.error('[main] Initialization failed:', err);
});
