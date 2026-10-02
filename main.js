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
 *   FOCAL  = 300  → PerspectiveCamera fov=54 (sinematik geniş açı & dengeli derinlik)
 *   CAM_SPD = 6   → world.js'de nesne hız sabiti (unit/frame → unit/s × delta)
 */

import * as THREE from 'three';


// ─── Scene modules ──────────────────────────────────────────────────────────
import { initSky, updateSky } from './scene/sky.js';
import { initWorld,   updateWorld   } from './scene/world/index.js';
import { initGround,  updateGround, onResizeGround  } from './scene/ground.js';
import { initWalker,  updateWalker, getUmbrellaInertiaData, setUmbrellaVisible, triggerUmbrellaShake, setWalkerTurnInput, getWalkerData } from './scene/walker.js';
import { initRain,    updateRain, onResizeRain } from './scene/rain.js';
import { initLighting, updateLighting, triggerLightning } from './scene/lighting.js';
import { initTraffic,  updateTraffic  } from './scene/traffic.js';
import { initPostprocessing, renderPostprocessing, onResizePostprocessing } from './scene/postprocessing.js';
import { initAudio, startAudio, playUmbrellaShakeSound, getAudioContext } from './scene/audio.js';
import { initShadows, updateShadows } from './scene/shadows.js';
import { RIGHT_SW_X, SIDEWALK_WIDTH, ROAD_CENTER_X } from './scene/ground.js';

// ─── Central Configuration ──────────────────────────────────────────────────
export const CONFIG = Object.freeze({

  /** Kamera — First-Person POV (Ferah Sağ Kaldırım Yürüyüşü) */
  camera: {
    fov:      54,       // Sinematik geniş açı
    near:     0.1,
    far:      4000,
    // Sağ kaldırım üzerinde, binalar ve cadde arasında dengeli yürüyüş hattı
    baseX:   RIGHT_SW_X + (SIDEWALK_WIDTH * 0.24),
    baseY:    1.78,
    baseZ:    0.00,
    lookAt:   { x: ROAD_CENTER_X - 1.2, y: 1.55, z: 120.0 }, // Cadde perspektifine doğal bakış
  },

  /** Karakter & Viewmodel */
  walker: {
    showUmbrella: true, // Şemsiye onarıldı, varsayılan olarak görünür
  },

  /** Renderer */
  renderer: {
    maxPixelRatio: 2,
    powerPreference: 'high-performance',
  },

  /** Atmosfer (Derin Gece Mavisi / Sinematik Ufuk) */
  atmosphere: {
    backgroundColor: 0x0d1526,
    fogColor:        0x142036,
    fogDensity:      0.00030,
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
  world:       null,   // binalar, sokak lambaları, yol çizgileri
  ground:      null,   // asfalt, kaldırım, ıslak yüzey
  walker:      null,   // karakter + şemsiye
  traffic:     null,   // şehir trafiği (12 araç, farlar, stoplar)
  shadows:     null,   // zemin temas gölgeleri (araçlar, yayalar, walker)
  rain:        null,   // yağmur parçacık sistemi
  lights:      null,   // tüm Three.js Light nesneleri
};

// ─── Re-usable temporaries (loop içinde allocation önleme) ──────────────────
// Her modül kendi scratch objelerini lokal olarak tanımlıyor.

// ════════════════════════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════════════════════════

function initRenderer() {
  if (typeof window !== 'undefined' && !window.WebGLRenderingContext) {
    throw new Error('Tarayıcınız WebGL / Donanım Hızlandırmasını desteklemiyor.');
  }

  renderer = new THREE.WebGLRenderer({
    antialias:       true,
    alpha:           false,
    powerPreference: CONFIG.renderer.powerPreference,
  });

  if (!renderer.getContext()) {
    throw new Error('WebGL 2.0 grafik bağlamı (context) oluşturulamadı. Lütfen donanım hızlandırmasını kontrol edin.');
  }

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

  // Clear color (arka plan sızmalarını önleyen tam opak derin gece rengi)
  renderer.setClearColor(CONFIG.atmosphere.backgroundColor, 1.0);

  if (DEBUG) {
    window.__renderer = renderer;
  }

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
  
  // Faz 8: SkyDome (scene/sky.js)
  initSky(scene);

  if (DEBUG) {
    window.__scene = scene;
  }
}

function initCamera() {
  const { fov, near, far, baseX, baseY, baseZ, lookAt } = CONFIG.camera;

  camera = new THREE.PerspectiveCamera(
    fov,
    window.innerWidth / window.innerHeight,
    near,
    far
  );

  camera.position.set(baseX, baseY, baseZ);
  camera.lookAt(lookAt.x, lookAt.y, lookAt.z);

  // FPS Viewmodel şemsiyesini desteklemek için kamera sahneye eklenmelidir
  scene.add(camera);

  if (DEBUG) {
    window.__camera = camera;
  }
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

  const pr = Math.min(window.devicePixelRatio || 1, CONFIG.renderer.maxPixelRatio);
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h);

  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  // Reflector render target boyutunu da güncelle (Phase 8)
  onResizeGround(w, h);

  // Post-processing composer & pass çözünürlüklerini güncelle (Phase 9)
  onResizePostprocessing(w, h);

  // Yağmur parçacık optik boyutunu viewport yüksekliğine göre dengele
  onResizeRain(w, h);
}

// ════════════════════════════════════════════════════════════════════════════
//  UPDATE — Delta-time tabanlı modül orkestrasyonu
// ════════════════════════════════════════════════════════════════════════════

function update(delta) {
  // ── Modül Güncellemeleri ───────────────────────────────────────────────────
  updateSky(delta);
  updateWorld(delta);
  updateGround(delta);
  updateWalker(delta, camera);
  updateRain(delta, camera?.position);
  updateLighting(delta, camera?.position);
  updateTraffic(delta);
  updateShadows(camera?.position);
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

  const delta = Math.min(clock.getDelta(), 0.1);

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
  await initGround(scene, groups.ground, CONFIG, renderer);
  await initWorld(scene, groups.world, CONFIG, renderer);
  await initWalker(scene, groups.walker, CONFIG, camera);
  await initRain(scene, groups.rain, CONFIG);
  await initTraffic(scene, groups.traffic, CONFIG);
  await initShadows(scene, groups.shadows);
  await initPostprocessing(renderer, scene, camera, CONFIG);

  // 3. Web Audio API Başlatma Hazırlığı
  initAudio();

  // 4. Debug araçları + test objeleri
  initDebugHelpers();
  initTestObjects();

  if (DEBUG) {
    window.__camera    = camera;
    window.__renderer  = renderer;
    window.__scene     = scene;
    window.__triggerLightning = triggerLightning;
    window.__getUmbrellaInertiaData = getUmbrellaInertiaData;
    window.__setUmbrellaVisible = setUmbrellaVisible;
    window.__triggerUmbrellaShake = triggerUmbrellaShake;
    window.__getWalkerData = getWalkerData;
  }

  // 5. Pencere boyutlandırma dinleyicisi (Resize)
  window.addEventListener('resize', onResize);

  // 6. Şimşek Etkileşimi, Sağa/Sola Bakış & Ses Motoru Dinleyicileri
  let _audioStarted = false;
  let _keyTurnLeft = false;
  let _keyTurnRight = false;
  const overlayEl = document.getElementById('overlay');

  function syncKeyTurn() {
    setWalkerTurnInput(_keyTurnLeft, _keyTurnRight);
  }

  function triggerAudioStart() {
    if (!_audioStarted) {
      startAudio();
      _audioStarted = true;
      if (overlayEl) {
        overlayEl.textContent = '← / A: CADDEYE BAK | → / D: BİNALARA BAK | BOŞLUK: ŞİMŞEK | R: ŞEMSİYE';
      }
    }
  }

  // Tıklama yalnızca ses motorunu başlatır; istem dışı kör edici şimşek patlamalarını önler
  window.addEventListener('pointerdown', () => {
    triggerAudioStart();
  });

  window.addEventListener('keydown', (e) => {
    triggerAudioStart();
    if (e.code === 'ArrowLeft'  || e.code === 'KeyA') { _keyTurnLeft  = true; syncKeyTurn(); }
    if (e.code === 'ArrowRight' || e.code === 'KeyD') { _keyTurnRight = true; syncKeyTurn(); }
    if (e.code === 'Space') {
      e.preventDefault();
      triggerLightning();
    }
    if (e.code === 'KeyR') {
      triggerUmbrellaShake();
      playUmbrellaShakeSound();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'ArrowLeft'  || e.code === 'KeyA') { _keyTurnLeft  = false; syncKeyTurn(); }
    if (e.code === 'ArrowRight' || e.code === 'KeyD') { _keyTurnRight = false; syncKeyTurn(); }
  });

  // Ekran görüntüsü alınırken veya sekme değişirken tuşların takılı kalmasını önler
  window.addEventListener('blur', () => {
    _keyTurnLeft  = false;
    _keyTurnRight = false;
    syncKeyTurn();
  });

  window.addEventListener('contextmenu', () => {
    _keyTurnLeft  = false;
    _keyTurnRight = false;
    syncKeyTurn();
  });

  document.addEventListener('visibilitychange', () => {
    const ctx = getAudioContext();
    if (document.hidden) {
      _keyTurnLeft  = false;
      _keyTurnRight = false;
      syncKeyTurn();
      if (ctx && ctx.state === 'running') ctx.suspend();
    } else {
      if (ctx && ctx.state === 'suspended') ctx.resume();
    }
  });

  // 7. Loading ekranını gizle
  const loadingEl = document.getElementById('loading');
  if (loadingEl) {
    loadingEl.classList.add('hidden');
    setTimeout(() => loadingEl.remove(), 700);
  }

  // 8. İlk boyut senkronizasyonunu zorla (Tüm modüllerin tek seferde hizalanması)
  onResize();

  // 9. Loop başlat
  animate();

  if (DEBUG) {
    console.log('[main] Scene initialized. Groups:', scene.children.map(c => c.name));
    console.log('[main] Renderer info:', renderer.info);
  }
}

function showErrorOverlay(err) {
  const loadingEl = document.getElementById('loading');
  if (loadingEl) loadingEl.remove();

  const errorEl = document.getElementById('error-overlay');
  const detailsEl = document.getElementById('error-details');
  if (errorEl) {
    errorEl.classList.add('visible');
    if (detailsEl) {
      detailsEl.textContent = err?.stack || err?.message || String(err);
    }
  } else {
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;inset:0;background:#080910;color:#ff5566;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:monospace;padding:24px;z-index:9999;text-align:center;';
    div.innerHTML = `<h2 style="margin-bottom:12px;color:#ff3344;letter-spacing:2px;">BAŞLATMA HATASI / INITIALIZATION ERROR</h2><p style="color:#ffd0d5;margin-bottom:12px;">${err?.message || err}</p><pre style="text-align:left;background:rgba(255,50,50,0.1);border:1px solid rgba(255,50,50,0.3);padding:10px;font-size:11px;max-width:90vw;overflow:auto;">${err?.stack || ''}</pre>`;
    document.body.appendChild(div);
  }
}

main().catch(err => {
  console.error('[main] Initialization failed:', err);
  showErrorOverlay(err);
});
