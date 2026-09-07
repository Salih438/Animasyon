/**
 * scene/lighting.js — Phase 5 + Phase 7: City Lighting & Dynamic Lightning System
 *
 * Sorumluluklar:
 *   - 16 Sokak Lambası (8 sol kaldırım, 8 sağ kaldırım) InstancedMesh
 *   - Dinamik 4-PointLight Havuzlama Sistemi (Light Pooling — Forward Rendering dostu)
 *   - Sıfır-Tahsisli Mesafe Culling ve En Yakın 4 Lamba Takibi
 *   - Çift Darbeli Şimşek Motoru (Double-Pulse Timing Engine):
 *       * t = 0 ms    : Flaş anında tepe noktasına fırlar (Intensity = 1.0)
 *       * t = 40-60 ms: Hızlı birinci sönüm (%30 seviyesi)
 *       * t = 80-100ms: İkincil ark darbesi çakar (Intensity = 0.85)
 *       * t > 100 ms  : Üstel sönümleme (exp(-tau * 10)) ile 450 ms'de sıfırlanma
 *   - Global Atmosferik Senkronizasyon (Zero-Allocation):
 *       * Sky Background & Scene Fog: Birebir aynı renge (0x05050a -> 0x4a6a94) lerp edilir (ufuk çizgisi dikişsiz kalır)
 *       * AmbientLight: 0.40 -> 3.00 seviyesine fırlar
 *       * HemisphereLight: 0.40 -> 1.90 seviyesine fırlar + gökyüzü rengi açılır
 *       * DirectionalLight: 0.25 -> 3.50 keskin flaş darbesi
 *       * Building Windows: Pencerelerin emissiveIntensity değeri 0.30 -> 2.00 fırlar
 *       * Rain Particles: Yağmur parçacıklarının opaklığı ve parlaklığı parlar
 *   - Tetikleyiciler:
 *       * Stokastik (Rastgele): ~4.5 - 7.0 saniyede bir doğal fırtına çakması
 *       * Etkileşimli (Kullanıcı Tıklaması / Boşluk Tuşu): triggerLightning()
 */

import * as THREE from 'three';
import { setBuildingLightningFactor } from './world.js';
import { setRainLightningFactor }     from './rain.js';
import { RIGHT_CURB_X, LEFT_CURB_X }  from './ground.js';
import { playThunder }                from './audio.js';

// ══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION CONSTANTS
// ══════════════════════════════════════════════════════════════════════════════

export const LAMP_COUNT      = 16;
export const LAMPS_PER_SIDE  = 8;
export const LIGHT_POOL_SIZE = 4; // GPU forward rendering için sabit 4 PointLight

// Yerleşim koordinatları (Kaldırım bordür kenarlarına oturan gerçekçi 3D sokak lambaları)
const RIGHT_POLE_X    =  5.95; // Sağ bordür üzerinde
const LEFT_POLE_X     = -5.95; // Sol bordür üzerinde
const LAMP_ARM_LEN    =  1.50; // Üst kolun yola doğru yatay uzantısı (m)
const POLE_BASE_Y     =  0.00; // Asfalt/bordür taban kotu
const BULB_REL_Y      =  5.25; // Ampulün direk tabanına göre göreli yüksekliği
const BULB_WORLD_Y    = POLE_BASE_Y + BULB_REL_Y; // ~5.25 m

// PointLight fiziksel parametreleri
const LIGHT_COLOR     = 0xffaa44; // Sıcak amber / sodyum sarısı gece tonu
const TARGET_INTENSITY= 2.20;     // Canlı sinematik sokak ışığı
const LIGHT_DISTANCE  = 40.0;     // Işığın etki mesafesi (m)
const LIGHT_DECAY     = 2.0;      // Fiziksel sönümleme (inverse square law)

// ══════════════════════════════════════════════════════════════════════════════
// LAMP DATA DEFINITIONS (16 Lamba Veri Havuzu)
// ══════════════════════════════════════════════════════════════════════════════

const _lampData = new Array(LAMP_COUNT);

(function _initLampData() {
  // Düzenli aralıklarla sağ ve sol lamba çiftleri (Kameranın hemen önünden Z=2'den başlar!)
  const zPositions = [2, 16, 32, 50, 72, 100, 135, 180];
  for (let i = 0; i < LAMPS_PER_SIDE; i++) {
    const z = zPositions[i];
    // Sağ lamba (i = 0..7)
    _lampData[i] = Object.freeze({
      id: i,
      side: 'right',
      poleX: RIGHT_POLE_X,
      poleY: POLE_BASE_Y,
      z: z,
      bulbX: RIGHT_POLE_X - LAMP_ARM_LEN,
      bulbY: BULB_WORLD_Y,
      bulbZ: z,
    });

    // Sol lamba (i = 8..15)
    const id = LAMPS_PER_SIDE + i;
    _lampData[id] = Object.freeze({
      id: id,
      side: 'left',
      poleX: LEFT_POLE_X,
      poleY: POLE_BASE_Y,
      z: z,
      bulbX: LEFT_POLE_X + LAMP_ARM_LEN,
      bulbY: BULB_WORLD_Y,
      bulbZ: z,
    });
  }
})();

// ══════════════════════════════════════════════════════════════════════════════
// MODULE STATE & LIGHTNING ENGINE
// ══════════════════════════════════════════════════════════════════════════════

let _sceneRef      = null;
let _hemiLight     = null;
let _ambientLight  = null;
let _moonLight     = null;

let _lampPoleMesh  = null; // THREE.InstancedMesh (16 adet birleşik metalik gövde)
let _lampBulbMesh  = null; // THREE.InstancedMesh (16 adet emissive ampul)

// 4'lü PointLight havuzu
const _lightPool   = new Array(LIGHT_POOL_SIZE);

// Havuz takip durumları (Anti-popping ve lerp için)
const _poolTargetLamps      = new Int32Array(LIGHT_POOL_SIZE).fill(-1);
const _poolCurrentIntensity = new Float32Array(LIGHT_POOL_SIZE).fill(0.0);

// Sıfır tahsisli en yakın 4 lamba seçimi için statik diziler
const _closestIndices = new Int32Array(LIGHT_POOL_SIZE);
const _closestDists   = new Float32Array(LIGHT_POOL_SIZE);

// Şimşek durumu & Çift Darbeli Eğri Değişkenleri
let _lightningActive  = false;
let _lightningTime    = 0.0;
let _lightningFactor  = 0.0;
let _stochasticTimer  = 4.5 + Math.random() * 2.0; // İlk doğal şimşek ~5 saniyede çakar

// Zero-Allocation Renk Nesneleri (Her frame new Color() çağırmak KESİNLİKLE YASAKTIR)
const _colBgBase    = new THREE.Color(0x05050a); // Koyu gece arkaplanı
const _colBgFlash   = new THREE.Color(0x4a6a94); // Şimşek fırtına mavisi/beyazı
const _colCurrent   = new THREE.Color();

const _colSkyBase   = new THREE.Color(0x0a0a20);
const _colSkyFlash  = new THREE.Color(0x6a8ab4);

const _colMoonBase  = new THREE.Color(0x1a1a2e);
const _colMoonFlash = new THREE.Color(0xa0c0e8);

// Reusable math nesneleri (update loop'ta 0 allocation)
const _m4   = new THREE.Matrix4();
const _pos  = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale= new THREE.Vector3(1, 1, 1);
const _rotY = new THREE.Euler(0, 0, 0);

// ══════════════════════════════════════════════════════════════════════════════
// DOUBLE-PULSE LIGHTNING CURVE
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Çift darbeli şimşek eğrisini değerlendirir.
 *   0..50 ms : 1.0 -> 0.30 (İlk tepe flaş ve hızlı sönüm)
 *  50..90 ms : 0.30 -> 0.85 (İkincil geri dönüş darbesi)
 *  90..450 ms: 0.85 -> 0.00 (Üstel sönümleme)
 *
 * @param {number} t — Tetiklenmeden itibaren geçen süre (saniye)
 * @returns {number} — 0.0 ile 1.0 arası parlaklık çarpanı
 */
function _evalLightningCurve(t) {
  if (t < 0.0 || t >= 0.45) return 0.0;

  if (t < 0.05) {
    // 0 ila 50 ms: Hızlı ilk sönüm
    return 1.0 - 0.70 * (t / 0.05);
  } else if (t < 0.09) {
    // 50 ila 90 ms: İkincil darbe sıçraması
    return 0.30 + 0.55 * ((t - 0.05) / 0.04);
  } else {
    // 90 ila 450 ms: Üstel sönümleme ve pürüzsüz sıfırlanma
    const tau = t - 0.09;
    const decayDuration = 0.36; // 450 - 90 ms
    const cutoff = Math.max(0.0, 1.0 - tau / decayDuration);
    return 0.85 * Math.exp(-tau * 10.0) * cutoff;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GEOMETRY & MESH HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function _mergeGeometries(geos) {
  let totalVerts = 0;
  const nonIndexed = geos.map(g => {
    const ni = g.index ? g.toNonIndexed() : g;
    totalVerts += ni.attributes.position.count;
    return ni;
  });

  const posArray  = new Float32Array(totalVerts * 3);
  const normArray = new Float32Array(totalVerts * 3);

  let offset = 0;
  for (const g of nonIndexed) {
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    posArray.set(p, offset * 3);
    if (n) normArray.set(n, offset * 3);
    offset += g.attributes.position.count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
  merged.setAttribute('normal',   new THREE.BufferAttribute(normArray, 3));
  return merged;
}

function _createPoleGeometry() {
  const baseGeo = new THREE.CylinderGeometry(0.38, 0.48, 0.90, 12);
  baseGeo.translate(0, 0.45, 0);

  const shaftGeo = new THREE.CylinderGeometry(0.14, 0.20, 4.40, 12);
  shaftGeo.translate(0, 3.10, 0);

  const collarGeo = new THREE.CylinderGeometry(0.24, 0.16, 0.35, 12);
  collarGeo.translate(0, 5.30, 0);

  const armGeo = new THREE.BoxGeometry(LAMP_ARM_LEN, 0.12, 0.12);
  armGeo.translate(-LAMP_ARM_LEN / 2, 5.45, 0);

  const hoodGeo = new THREE.ConeGeometry(0.48, 0.32, 8);
  hoodGeo.translate(-LAMP_ARM_LEN, 5.50, 0);

  return _mergeGeometries([baseGeo, shaftGeo, collarGeo, armGeo, hoodGeo]);
}

function _buildLampposts(parentGroup) {
  const matPole = new THREE.MeshStandardMaterial({
    color:     0x343a4a, // Belirgin dökme demir metalik direk tonu
    metalness: 0.70,
    roughness: 0.30,
  });

  const matBulb = new THREE.MeshStandardMaterial({
    color:             0xffe088,
    emissive:          new THREE.Color(0xffaa22),
    emissiveIntensity: 3.8, // Parlak sıcak sarı ampul (Bloom parlaması)
    roughness:         0.15,
    metalness:         0.10,
  });

  const poleGeo = _createPoleGeometry();
  const bulbGeo = new THREE.SphereGeometry(0.28, 16, 12);
  bulbGeo.translate(-LAMP_ARM_LEN, BULB_REL_Y, 0);

  _lampPoleMesh = new THREE.InstancedMesh(poleGeo, matPole, LAMP_COUNT);
  _lampPoleMesh.name = 'lampposts_poles';
  _lampPoleMesh.castShadow = true;
  _lampPoleMesh.receiveShadow = true;

  _lampBulbMesh = new THREE.InstancedMesh(bulbGeo, matBulb, LAMP_COUNT);
  _lampBulbMesh.name = 'lampposts_bulbs';

  for (let i = 0; i < LAMP_COUNT; i++) {
    const l = _lampData[i];
    _pos.set(l.poleX, l.poleY, l.z);

    const yaw = (l.side === 'left') ? Math.PI : 0.0;
    _rotY.set(0, yaw, 0);
    _quat.setFromEuler(_rotY);

    _m4.compose(_pos, _quat, _scale);

    _lampPoleMesh.setMatrixAt(i, _m4);
    _lampBulbMesh.setMatrixAt(i, _m4);
  }

  _lampPoleMesh.instanceMatrix.needsUpdate = true;
  _lampBulbMesh.instanceMatrix.needsUpdate = true;

  _lampPoleMesh.computeBoundingSphere();
  _lampBulbMesh.computeBoundingSphere();

  parentGroup.add(_lampPoleMesh, _lampBulbMesh);
}

// ══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Sahne aydınlatmasını, sokak lambalarını ve şimşek altyapısını kurar.
 *
 * @param {THREE.Scene}      scene
 * @param {THREE.Group}     [group]  — lightsGroup
 * @param {object}          [config] — Central configuration
 */
export async function initLighting(scene, group, config) {
  _sceneRef = scene;

  const lightsGroup = group || (scene && scene.getObjectByName && scene.getObjectByName('lights')) || scene;
  const worldGroup  = (scene && scene.getObjectByName && scene.getObjectByName('world')) || lightsGroup;

  // ── 1. HemisphereLight ───────────────────────────────────────────────────
  _hemiLight = new THREE.HemisphereLight(
    0x0a0a20, // Soğuk gece gökyüzü
    0x050510, // Koyu zemin yansıması
    0.40
  );
  _hemiLight.name = 'hemisphereLight';
  lightsGroup.add(_hemiLight);

  // ── 2. AmbientLight ───────────────────────────────────────────────────────
  _ambientLight = new THREE.AmbientLight(
    0x141828, // Gece mavisi dolgu
    0.65
  );
  _ambientLight.name = 'ambientLight';
  lightsGroup.add(_ambientLight);

  // ── 2b. Walker Rim & Fill Light (Karakteri arkadan aydınlatan sinematik dolgu) ──
  const walkerFill = new THREE.DirectionalLight(0xaad0ff, 1.10);
  walkerFill.name = 'walkerFillLight';
  walkerFill.position.set(0.5, 4.5, -6.0);
  walkerFill.target.position.set(0.0, 1.2, 2.0);
  lightsGroup.add(walkerFill);
  lightsGroup.add(walkerFill.target);

  // ── 3. DirectionalLight (Ay Işığı & Şimşek Flaş Kaynağı) ─────────────────
  _moonLight = new THREE.DirectionalLight(0x1a1a2e, 0.25);
  _moonLight.name = 'moonLight';
  _moonLight.position.set(50, 100, 50);

  const shadowEnabled = config?.shadow?.enabled ?? true;
  _moonLight.castShadow = shadowEnabled;

  if (shadowEnabled) {
    _moonLight.shadow.mapSize.set(1024, 1024);
    _moonLight.shadow.camera.near   =  0.5;
    _moonLight.shadow.camera.far    =  500;
    _moonLight.shadow.camera.left   = -100;
    _moonLight.shadow.camera.right  =  100;
    _moonLight.shadow.camera.top    =  100;
    _moonLight.shadow.camera.bottom = -100;
    _moonLight.shadow.bias          = -0.001;
  }
  lightsGroup.add(_moonLight);

  // ── 4. 16 Sokak Lambasını İnşa Et ────────────────────────────────────────
  _buildLampposts(worldGroup);

  // ── 5. Dinamik 4-PointLight Havuzunu Başlat ──────────────────────────────
  for (let k = 0; k < LIGHT_POOL_SIZE; k++) {
    const pl = new THREE.PointLight(LIGHT_COLOR, 0.0, LIGHT_DISTANCE, LIGHT_DECAY);
    pl.name = `streetPointLight_${k}`;
    pl.castShadow = false;
    lightsGroup.add(pl);
    _lightPool[k] = pl;
  }

  // İlk frame için ışıkları en yakın lambalara bağla
  updateLighting(0.016, null);
}

/**
 * Anında yeni bir çift darbeli şimşek çakması tetikler.
 * Kullanıcı tıklaması, boşluk tuşu veya stokastik motor tarafından çağrılır.
 */
export function triggerLightning() {
  _lightningActive = true;
  _lightningTime   = 0.0;
  _lightningFactor = 1.0;

  // Derin gök gürültüsü ses patlaması
  try {
    playThunder();
  } catch (e) {
    // Ses sessiz modda olabilir
  }
}

/**
 * Anlık şimşek faktörünü döndürür (0.0 -> 1.0).
 */
export function getLightningFactor() {
  return _lightningFactor;
}

/**
 * Her frame dinamik ışık havuzunu ve şimşek atmosferini günceller.
 *
 * @param {number}         delta      — Frame süresi (saniye)
 * @param {THREE.Vector3} [cameraPos] — İsteğe bağlı kamera konumu
 */
export function updateLighting(delta, cameraPos) {
  if (!_lightPool[0]) return;

  const dt = Math.min(delta, 0.1);

  // ── 1. Şimşek Tetikleme Motoru & Çift Darbeli Eğri ─────────────────────────
  _stochasticTimer -= dt;
  if (_stochasticTimer <= 0.0) {
    triggerLightning();
    // Bir sonraki doğal çakma: 4.5 ila 7.0 saniye sonra
    _stochasticTimer = 4.5 + Math.random() * 2.5;
  }

  if (_lightningActive) {
    _lightningTime += dt;
    _lightningFactor = _evalLightningCurve(_lightningTime);

    if (_lightningTime >= 0.45) {
      _lightningActive = false;
      _lightningFactor = 0.0;
    }
  }

  // ── 2. Global Atmosferik Senkronizasyon (Zero-Allocation) ─────────────────
  // Sky Background & Scene Fog (Birebir aynı renge lerp edilir — ufuk dikişi oluşmaz)
  _colCurrent.copy(_colBgBase).lerp(_colBgFlash, _lightningFactor);
  if (_sceneRef) {
    if (_sceneRef.background) _sceneRef.background.copy(_colCurrent);
    if (_sceneRef.fog && _sceneRef.fog.color) _sceneRef.fog.color.copy(_colCurrent);
  }

  // AmbientLight: 0.40 -> 3.00
  if (_ambientLight) {
    _ambientLight.intensity = 0.40 + _lightningFactor * 2.60;
  }

  // HemisphereLight: 0.40 -> 1.90
  if (_hemiLight) {
    _hemiLight.intensity = 0.40 + _lightningFactor * 1.50;
    _hemiLight.color.copy(_colSkyBase).lerp(_colSkyFlash, _lightningFactor);
  }

  // DirectionalLight (Keskin flaş gölgeleri): 0.25 -> 3.50
  if (_moonLight) {
    _moonLight.intensity = 0.25 + _lightningFactor * 3.25;
    _moonLight.color.copy(_colMoonBase).lerp(_colMoonFlash, _lightningFactor);
  }

  // Bina Pencereleri Emissive Spike Senkronizasyonu
  setBuildingLightningFactor(_lightningFactor);

  // Yağmur Parçacıkları Parlaklık Senkronizasyonu
  setRainLightningFactor(_lightningFactor);

  // ── 3. Dinamik 4-PointLight Sokak Lambaları Havuzu ────────────────────────
  const focusX = 0.0;
  const focusZ = (cameraPos && typeof cameraPos.z === 'number') ? cameraPos.z : 18.0;

  _closestDists[0] = _closestDists[1] = _closestDists[2] = _closestDists[3] = Infinity;
  _closestIndices[0] = _closestIndices[1] = _closestIndices[2] = _closestIndices[3] = -1;

  for (let j = 0; j < LAMP_COUNT; j++) {
    const l = _lampData[j];
    const dx = l.bulbX - focusX;
    const dz = l.bulbZ - focusZ;
    const d  = dx * dx + dz * dz;

    if (d < _closestDists[3]) {
      if (d < _closestDists[0]) {
        _closestDists[3] = _closestDists[2]; _closestIndices[3] = _closestIndices[2];
        _closestDists[2] = _closestDists[1]; _closestIndices[2] = _closestIndices[1];
        _closestDists[1] = _closestDists[0]; _closestIndices[1] = _closestIndices[0];
        _closestDists[0] = d; _closestIndices[0] = j;
      } else if (d < _closestDists[1]) {
        _closestDists[3] = _closestDists[2]; _closestIndices[3] = _closestIndices[2];
        _closestDists[2] = _closestDists[1]; _closestIndices[2] = _closestIndices[1];
        _closestDists[1] = d; _closestIndices[1] = j;
      } else if (d < _closestDists[2]) {
        _closestDists[3] = _closestDists[2]; _closestIndices[3] = _closestIndices[2];
        _closestDists[2] = d; _closestIndices[2] = j;
      } else {
        _closestDists[3] = d; _closestIndices[3] = j;
      }
    }
  }

  for (let k = 0; k < LIGHT_POOL_SIZE; k++) {
    const lampId = _closestIndices[k];
    const pl     = _lightPool[k];

    if (lampId >= 0 && lampId < LAMP_COUNT) {
      const lamp = _lampData[lampId];

      if (_poolTargetLamps[k] !== lampId) {
        pl.position.set(lamp.bulbX, lamp.bulbY, lamp.bulbZ);
        _poolTargetLamps[k] = lampId;
      }

      const dist = Math.sqrt(_closestDists[k]);
      const rangeFactor = Math.max(0.0, Math.min(1.0, 1.0 - (dist - 15.0) / 75.0));
      const targetInt = TARGET_INTENSITY * rangeFactor;

      _poolCurrentIntensity[k] += (targetInt - _poolCurrentIntensity[k]) * Math.min(1.0, dt * 6.0);
      pl.intensity = _poolCurrentIntensity[k];
    } else {
      _poolCurrentIntensity[k] += (0.0 - _poolCurrentIntensity[k]) * Math.min(1.0, dt * 6.0);
      pl.intensity = _poolCurrentIntensity[k];
    }
  }
}

/**
 * 16 Sokak Lambasının salt-okunur konum verilerini döndürür.
 *
 * @returns {Array<{id, side, poleX, poleY, z, bulbX, bulbY, bulbZ}>}
 */
export function getLampData() {
  return _lampData;
}
