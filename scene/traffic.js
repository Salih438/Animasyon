
/**
 * scene/traffic.js — Phase 6: Traffic & Vehicle Dynamics
 *
 * Sorumluluklar:
 *   - 12 Araçlık Şehir Filosu (6 Karşı Şerit / Incoming, 6 Aynı Yön / Outgoing)
 *   - 3 Farklı Kasa Profili: Sedan, Hatchback/Compact, SUV/Crossover
 *   - Gece Renk Paleti: 12 farklı zengin metalik/parlak gece rengi
 *   - Göreli Hız & Sonsuz Trafik Motoru (Relative Speed Physics):
 *       * Incoming (sol şerit, X ≈ -5.2): V_rel = -(carSpeed + CAM_SPD_SEC)
 *       * Outgoing (sağ şerit, X ≈ +5.5): V_rel = max(1.5, carSpeed - CAM_SPD_SEC)
 *   - Farlar ve Stop Lambaları (IŞIK KAYNAĞI YOK — YALNIZCA YÜKSEK EMISSIVE):
 *       * Ön Farlar (Headlights): Parlak sıcak beyaz (0xfffaed, emissive 2.8)
 *       * Arka Stoplar (Taillights): Kor kırmızısı (0xff1122, emissive 3.0)
 *       * Yönelim: Incoming araçlar öne (kameraya) bakar (rotY = 0),
 *                  Outgoing araçlar arkaya bakar (rotY = PI, stop lambaları kameraya görünür).
 *   - Zemin Oturumu: Tekerlek altı Y = 0.0 asfalt seviyesine sıfıra sıfır oturur.
 *   - Walker Güvenliği: Araçlar yol koridorunda (|X| <= 7.0) kalır; kaldırıma (X >= 10) asla taşmaz.
 *   - ZERO ALLOCATION: updateTraffic döngüsünde tek bir new THREE.* tahsisi yapılmaz.
 */

import * as THREE from 'three';
import { spawnSplash } from './rain.js';
import { ROAD_MIN_X, ROAD_MAX_X } from './ground.js';

// ══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION CONSTANTS
// ══════════════════════════════════════════════════════════════════════════════

export const CAR_COUNT       = 12;
export const CARS_PER_LANE   = 6;

// İnsan yürüyüş referans hızı (m/s) — ground.js WALK_SPEED ile senkron
export const WALK_SPEED_SEC   = 2.8;

// Şerit merkezleri yola (ROAD_MIN_X ve ROAD_MAX_X) dinamik olarak bağlanır
const ROAD_WIDTH_SAFE        = ROAD_MAX_X - ROAD_MIN_X;
const LANE_X_OUTGOING        = ROAD_MIN_X + (ROAD_WIDTH_SAFE * 0.24); // Sağ şerit
const LANE_X_INCOMING        = ROAD_MAX_X - (ROAD_WIDTH_SAFE * 0.26); // Karşı sol şerit

// Respawn Z sınırları (Sürekli aktif ve yoğun şehir trafiği akışı)
const Z_INCOMING_RESPAWN_MIN = 220.0;
const Z_INCOMING_DESPAWN     = -25.0; // Kameranın arkasına geçme sınırı

const Z_OUTGOING_RESPAWN_MIN = -35.0;
const Z_OUTGOING_DESPAWN     = 320.0; // Uzakta ufka karışma sınırı

// ══════════════════════════════════════════════════════════════════════════════
// NIGHT COLOR PALETTE (12 Farklı Zengin Gece Rengi)
// ══════════════════════════════════════════════════════════════════════════════

const CAR_COLORS = Object.freeze([
  0x243859, // 0: Metalik Gece Mavisi (Sedan - Incoming)
  0x5a1a24, // 1: Bordo / Koyu Şarap (Hatchback - Incoming)
  0xe0aa26, // 2: Taksi Sarısı (SUV - Incoming)
  0x353a42, // 3: Füme / Antrasit (Sedan - Incoming)
  0xb4c0cc, // 4: Gümüş İnci Metalik (Hatchback - Incoming)
  0x224832, // 5: İngiliz Yarış Yeşili (SUV - Incoming)
  0x202634, // 6: Derin Gece Grafit (Sedan - Outgoing)
  0x25385c, // 7: Koyu Lacivert (Hatchback - Outgoing)
  0x9c2d20, // 8: Ateş Kırmızısı (SUV - Outgoing)
  0x525864, // 9: Titanyum Grisi (Sedan - Outgoing)
  0xdcb028, // 10: Şehir Taksi Sarısı (Hatchback - Outgoing)
  0x224276, // 11: Safir Mavisi (SUV - Outgoing)
]);

// ══════════════════════════════════════════════════════════════════════════════
// MODULE STATE
// ══════════════════════════════════════════════════════════════════════════════

// 12 aracın runtime durumları
const _carObjects = new Array(CAR_COUNT);

// Paylaşılan materyaller
let _matGlass         = null; // Karartılmış parlak otomotiv camı
let _matWheel         = null; // Mat kauçuk lastik & çelik jant
let _matHeadlight     = null; // Parlak beyaz emissive ön far
let _matTaillight     = null; // Parlak kırmızı emissive arka stop
let _headlightBeamMesh= null; // En yakın 2 karşı aracın çift farı (4 volumetrik ışık huzmesi)

// ─── Araç Tekerlek Su Spreyi Havuzu (Wheel Spray Particle Pool) ────────────
export const WHEEL_SPRAY_POOL_SIZE = 48;
let _sprayMesh = null;
const _sprayActive  = new Uint8Array(WHEEL_SPRAY_POOL_SIZE);
const _sprayLife    = new Float32Array(WHEEL_SPRAY_POOL_SIZE);
const _sprayMaxLife = new Float32Array(WHEEL_SPRAY_POOL_SIZE);
const _sprayScale   = new Float32Array(WHEEL_SPRAY_POOL_SIZE);
const _sprayX       = new Float32Array(WHEEL_SPRAY_POOL_SIZE);
const _sprayY       = new Float32Array(WHEEL_SPRAY_POOL_SIZE);
const _sprayZ       = new Float32Array(WHEEL_SPRAY_POOL_SIZE);
const _sprayVx      = new Float32Array(WHEEL_SPRAY_POOL_SIZE);
const _sprayVy      = new Float32Array(WHEEL_SPRAY_POOL_SIZE);
const _sprayVz      = new Float32Array(WHEEL_SPRAY_POOL_SIZE);
let _sprayPoolPtr   = 0;

const _sprayMat4  = new THREE.Matrix4();
const _sprayPos   = new THREE.Vector3();
const _sprayScl   = new THREE.Vector3();
const _sprayColor = new THREE.Color();
const _sprayQuat  = new THREE.Quaternion();

// Zero-allocation geçici matematik nesneleri
const _m4   = new THREE.Matrix4();
const _pos  = new THREE.Vector3();
const _scale= new THREE.Vector3(1, 1, 1);
const _quat = new THREE.Quaternion();

// Profil bazlı far ofsetleri (Yükseklik, Z ofseti, Yarı genişlik)
const PROFILE_HEADLIGHT_OFFSETS = {
  sedan:     { y: 0.32 + 0.35, z: -4.70 / 2 - 0.04, halfW: 1.95 / 2 - 0.28 / 2 - 0.12 },
  hatchback: { y: 0.30 + 0.34, z: -3.90 / 2 - 0.04, halfW: 1.84 / 2 - 0.26 / 2 - 0.12 },
  suv:       { y: 0.38 + 0.44, z: -4.90 / 2 - 0.04, halfW: 2.06 / 2 - 0.32 / 2 - 0.12 },
};

// ══════════════════════════════════════════════════════════════════════════════
// GEOMETRY HELPERS (Birleşik Geometri — Draw Call Tasarrufu)
// ══════════════════════════════════════════════════════════════════════════════

function _mergeGeos(geos) {
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

/**
 * 4 Tekerlek Geometrisini Tek BufferGeometry Olarak Birleştirir.
 * Tekerleklerin en alt noktası kesinlikle Y = 0.0'a oturur.
 */
function _buildWheelsGeometry(trackW, wheelBase, radius, width) {
  const halfTrack = trackW / 2;
  const halfBase  = wheelBase / 2;

  const wheels = [];
  const coords = [
    [-halfTrack, halfBase],  // Sol arka
    [ halfTrack, halfBase],  // Sağ arka
    [-halfTrack, -halfBase], // Sol ön
    [ halfTrack, -halfBase], // Sağ ön
  ];

  for (const [x, z] of coords) {
    const wGeo = new THREE.CylinderGeometry(radius, radius, width, 12, 1);
    // Tekerlek silindiri varsayılan Y eksenindedir; Z eksenine döndür
    wGeo.rotateZ(Math.PI / 2);
    // Merkez Y = radius -> alt nokta Y = 0.0 (Asfalt seviyesi)
    wGeo.translate(x, radius, z);
    wheels.push(wGeo);
  }

  return _mergeGeos(wheels);
}

/**
 * Çift Ön Far Geometrisi (İki kutu birleşik)
 */
function _buildHeadlightsGeometry(width, y, zOffset, lampW, lampH) {
  const halfW = width / 2 - lampW / 2 - 0.12;
  const left  = new THREE.BoxGeometry(lampW, lampH, 0.08);
  left.translate(-halfW, y, zOffset);
  const right = new THREE.BoxGeometry(lampW, lampH, 0.08);
  right.translate(halfW, y, zOffset);
  return _mergeGeos([left, right]);
}

/**
 * Çift Arka Stop Lambası Geometrisi (İki kutu birleşik)
 */
function _buildTaillightsGeometry(width, y, zOffset, lampW, lampH) {
  const halfW = width / 2 - lampW / 2 - 0.12;
  const left  = new THREE.BoxGeometry(lampW, lampH, 0.08);
  left.translate(-halfW, y, zOffset);
  const right = new THREE.BoxGeometry(lampW, lampH, 0.08);
  right.translate(halfW, y, zOffset);
  return _mergeGeos([left, right]);
}

// ══════════════════════════════════════════════════════════════════════════════
// CAR PROFILE BUILDERS (Sedan, Hatchback, SUV)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Profil Geometrilerini Bir Kez İnşa Eder ve Önbelleğe Alır.
 */
function _createProfileGeometries() {
  // ── 1. SEDAN PROFİLİ ─────────────────────────────────────────────────────
  // Boy: 4.70m, En: 1.95m, Yükseklik: 1.45m, Tekerlek: r=0.32m
  const sedanChassis = new THREE.BoxGeometry(1.95, 0.52, 4.70);
  sedanChassis.translate(0, 0.32 + 0.52 / 2, 0); // Alt taban Y=0.32 (aks üstü)

  const sedanCabin = new THREE.BoxGeometry(1.64, 0.62, 2.35);
  sedanCabin.translate(0, 0.32 + 0.52 + 0.62 / 2, 0.20); // Hafif arkaya ofsetli kabin

  const sedanWheels = _buildWheelsGeometry(1.88, 2.80, 0.32, 0.22);
  const sedanHeadlights = _buildHeadlightsGeometry(1.95, 0.32 + 0.35, -4.70 / 2 - 0.02, 0.28, 0.11);
  const sedanTaillights = _buildTaillightsGeometry(1.95, 0.32 + 0.38,  4.70 / 2 + 0.02, 0.30, 0.09);

  // ── 2. HATCHBACK / COMPACT PROFİLİ ───────────────────────────────────────
  // Boy: 3.90m, En: 1.84m, Yükseklik: 1.48m, Tekerlek: r=0.30m
  const hatchChassis = new THREE.BoxGeometry(1.84, 0.54, 3.90);
  hatchChassis.translate(0, 0.30 + 0.54 / 2, 0);

  const hatchCabin = new THREE.BoxGeometry(1.58, 0.66, 2.20);
  hatchCabin.translate(0, 0.30 + 0.54 + 0.66 / 2, 0.42); // Dik arka bagaj formu

  const hatchWheels = _buildWheelsGeometry(1.78, 2.45, 0.30, 0.20);
  const hatchHeadlights = _buildHeadlightsGeometry(1.84, 0.30 + 0.34, -3.90 / 2 - 0.02, 0.26, 0.11);
  const hatchTaillights = _buildTaillightsGeometry(1.84, 0.30 + 0.37,  3.90 / 2 + 0.02, 0.28, 0.10);

  // ── 3. SUV / CROSSOVER PROFİLİ ───────────────────────────────────────────
  // Boy: 4.90m, En: 2.06m, Yükseklik: 1.76m, Tekerlek: r=0.38m (Yüksek profil)
  const suvChassis = new THREE.BoxGeometry(2.06, 0.66, 4.90);
  suvChassis.translate(0, 0.38 + 0.66 / 2, 0);

  const suvCabin = new THREE.BoxGeometry(1.78, 0.76, 2.85);
  suvCabin.translate(0, 0.38 + 0.66 + 0.76 / 2, 0.15); // Geniş yüksek tavan

  const suvWheels = _buildWheelsGeometry(1.98, 3.05, 0.38, 0.26);
  const suvHeadlights = _buildHeadlightsGeometry(2.06, 0.38 + 0.44, -4.90 / 2 - 0.02, 0.32, 0.13);
  const suvTaillights = _buildTaillightsGeometry(2.06, 0.38 + 0.46,  4.90 / 2 + 0.02, 0.34, 0.11);

  return {
    sedan:     { chassis: sedanChassis, cabin: sedanCabin, wheels: sedanWheels, headlights: sedanHeadlights, taillights: sedanTaillights },
    hatchback: { chassis: hatchChassis, cabin: hatchCabin, wheels: hatchWheels, headlights: hatchHeadlights, taillights: hatchTaillights },
    suv:       { chassis: suvChassis,   cabin: suvCabin,   wheels: suvWheels,   headlights: suvHeadlights,   taillights: suvTaillights   },
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Şehir trafiğini oluşturur ve sahneye ekler.
 *
 * @param {THREE.Scene}      scene
 * @param {THREE.Group}     [group]  — Hedef grup (groups.world)
 * @param {object}          [config] — Central configuration
 */
export async function initTraffic(scene, group, config) {
  const targetGroup = group || (scene && scene.getObjectByName && scene.getObjectByName('world')) || scene;

  // ── Paylaşılan Materyaller ───────────────────────────────────────────────
  _matGlass = new THREE.MeshStandardMaterial({
    color:             0x141c2c,
    metalness:         0.88,
    roughness:         0.14,
    emissive:          new THREE.Color(0x0c121e),
    emissiveIntensity: 0.30,
  });

  _matWheel = new THREE.MeshStandardMaterial({
    color:     0x141417,
    metalness: 0.35,
    roughness: 0.75,
  });

  // Ön farlar: Parlak sıcak beyaz emissive
  _matHeadlight = new THREE.MeshStandardMaterial({
    color:             0xffffff,
    emissive:          new THREE.Color(0xfff5e0),
    emissiveIntensity: 3.4,
    roughness:         0.10,
    metalness:         0.20,
  });

  // Arka stoplar: Kor kırmızısı emissive
  _matTaillight = new THREE.MeshStandardMaterial({
    color:             0x330005,
    emissive:          new THREE.Color(0xff0818),
    emissiveIntensity: 3.8,
    roughness:         0.10,
    metalness:         0.20,
  });

  const geos = _createProfileGeometries();

  // ── 12 Aracın Kurulumu (6 Incoming / 6 Outgoing) ─────────────────────────
  for (let i = 0; i < CAR_COUNT; i++) {
    const isIncoming = i < CARS_PER_LANE;
    const laneIndex  = isIncoming ? i : (i - CARS_PER_LANE);

    // Kasa profili seçimi: 0=Sedan, 1=Hatchback, 2=SUV
    const profileKey = (laneIndex % 3 === 0) ? 'sedan' : (laneIndex % 3 === 1 ? 'hatchback' : 'suv');
    const profileGeo = geos[profileKey];

    // Göreli Hız Matematiği
    let vRel, startZ, posX, headingYaw;

    if (isIncoming) {
      // Karşı şerit: Kameraya doğru hızla yaklaşır
      posX = LANE_X_INCOMING;
      // İçsel araç hızı: 18 - 24 m/s (65 - 85 km/s)
      const intrinsicSpeed = 18.0 + (laneIndex % 3) * 3.0;
      vRel = -(intrinsicSpeed + WALK_SPEED_SEC); // örn. -(21 + 2.8) = -23.8 m/s
      // Z dağılımı: Kameranın hemen önünden başlayarak dengeli dağılım
      startZ = 25.0 + laneIndex * 45.0 + (laneIndex % 2) * 10.0;
      // Rotasyon: Ön farlar doğrudan kameraya (-Z) bakar
      headingYaw = 0.0;
    } else {
      // Aynı şerit: Kameradan yavaşça uzaklaşır / öne doğru uzar
      posX = LANE_X_OUTGOING;
      // İçsel araç hızı: 16 - 22 m/s (58 - 80 km/s)
      const intrinsicSpeed = 16.0 + (laneIndex % 3) * 3.0;
      vRel = intrinsicSpeed - WALK_SPEED_SEC; // örn. 19 - 2.8 = +16.2 m/s (önde uzaklaşır)
      // Z dağılımı: Kameranın yanından başlayarak öne doğru
      startZ = -10.0 + laneIndex * 48.0 + (laneIndex % 2) * 12.0;
      // Rotasyon: 180° çevrilir; stop lambaları kameraya görünür
      headingYaw = Math.PI;
    }

    // Gövde boya materyali (Zengin gece metalik tonu + yumuşak ortam emissive yanıtı)
    const carCol = new THREE.Color(CAR_COLORS[i]);
    const matPaint = new THREE.MeshStandardMaterial({
      color:             CAR_COLORS[i],
      metalness:         0.78,
      roughness:         0.28,
      emissive:          carCol.clone().multiplyScalar(0.22),
      emissiveIntensity: 0.55,
    });

    // Araç Hiyerarşisi
    const carRoot = new THREE.Group();
    carRoot.name = `car_${isIncoming ? 'incoming' : 'outgoing'}_${laneIndex}`;
    carRoot.position.set(posX, 0, startZ);
    carRoot.rotation.y = headingYaw;

    const chassisMesh = new THREE.Mesh(profileGeo.chassis, matPaint);
    chassisMesh.castShadow    = true;
    chassisMesh.receiveShadow = true;
    carRoot.add(chassisMesh);

    const cabinMesh = new THREE.Mesh(profileGeo.cabin, _matGlass);
    cabinMesh.castShadow    = true;
    cabinMesh.receiveShadow = true;
    carRoot.add(cabinMesh);

    const wheelsMesh = new THREE.Mesh(profileGeo.wheels, _matWheel);
    wheelsMesh.castShadow    = true;
    wheelsMesh.receiveShadow = true;
    carRoot.add(wheelsMesh);

    const headMesh = new THREE.Mesh(profileGeo.headlights, _matHeadlight);
    carRoot.add(headMesh);

    const tailMesh = new THREE.Mesh(profileGeo.taillights, _matTaillight);
    carRoot.add(tailMesh);

    targetGroup.add(carRoot);

    // Runtime durum havuzuna kaydet
    _carObjects[i] = {
      id:          i,
      isIncoming:  isIncoming,
      group:       carRoot,
      x:           posX,
      laneX:       posX, // C1 fix: splash/spray koordinatları için gerekli
      z:           startZ,
      vRel:        vRel,
      profile:     profileKey,
    };
  }

  // ── En Yakın 2 Karşı Araç İçin Volumetrik Far Huzmeleri ───────────────────
  _buildHeadlightBeams(targetGroup);

  // ── 12 Araç İçin Tekerlek Su Püskürme / Tozu Havuzu (Wheel Spray Pool) ─────
  _buildWheelSpray(targetGroup);
}

function _createWheelSprayTexture() {
  if (typeof document === 'undefined') return null;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width  = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0.00, 'rgba(235, 245, 255, 0.75)');
  grad.addColorStop(0.25, 'rgba(215, 235, 255, 0.40)');
  grad.addColorStop(0.60, 'rgba(195, 220, 250, 0.12)');
  grad.addColorStop(1.00, 'rgba(180, 210, 245, 0.00)');

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

function _buildWheelSpray(parentGroup) {
  const sprayGeo = new THREE.PlaneGeometry(0.55, 0.45);
  sprayGeo.rotateX(-0.25); // Hafif yukarı ve geriye açılı püskürme düzlemi

  const matSpray = new THREE.MeshBasicMaterial({
    map:         _createWheelSprayTexture(),
    color:       0xddeeff,
    transparent: true,
    opacity:     0.55,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false,
    side:        THREE.DoubleSide,
  });

  _sprayMesh = new THREE.InstancedMesh(sprayGeo, matSpray, WHEEL_SPRAY_POOL_SIZE);
  _sprayMesh.name = 'traffic_wheel_sprays';
  _sprayMesh.frustumCulled = false;
  _sprayMesh.renderOrder = 3;

  const zeroM4 = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let k = 0; k < WHEEL_SPRAY_POOL_SIZE; k++) {
    _sprayMesh.setMatrixAt(k, zeroM4);
    _sprayActive[k] = 0;
  }
  _sprayMesh.instanceMatrix.needsUpdate = true;
  _sprayMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(WHEEL_SPRAY_POOL_SIZE * 3), 3);

  parentGroup.add(_sprayMesh);
}

export function spawnWheelSpray(x, y, z, vx, vy, vz, scale = 0.50, life = 0.35) {
  const id = _sprayPoolPtr;
  _sprayPoolPtr = (_sprayPoolPtr + 1) % WHEEL_SPRAY_POOL_SIZE;

  _sprayActive[id]  = 1;
  _sprayLife[id]    = life;
  _sprayMaxLife[id] = life;
  _sprayScale[id]   = scale;
  _sprayX[id]       = x;
  _sprayY[id]       = y;
  _sprayZ[id]       = z;
  _sprayVx[id]      = vx;
  _sprayVy[id]      = vy;
  _sprayVz[id]      = vz;
}

/**
 * Yumuşak Volumetrik Far Huzmesi Gölgelendiricisi (VolumetricHeadlightShader)
 *
 * - 32 segmentli dairesel koni geometrisi (keskin poligon hatlarını yok eder)
 * - Eksenel pürüzsüz sönüm (far camından 15 metre ileriye doğru smoothstep falloff)
 * - Tepe yumuşatma (sert geometrik iğne ucunu önler)
 * - Bakış açısına duyarlı kenar tüyü (Fresnel / Rim feathering: abs(dot(norm, viewDir)))
 * - Additive Blending ve 0.15 opaklık ile sinematik gece yağmuru ışık huzmesi
 */
const VolumetricHeadlightShader = {
  name: 'VolumetricHeadlightShader',
  uniforms: {
    uLength:    { value: 15.0 },
    uColor:     { value: new THREE.Color(0xfff6e4) },
    uIntensity: { value: 0.15 },
  },
  vertexShader: `
    varying vec3 vViewPosition;
    varying vec3 vNormal;
    varying float vProgress;
    uniform float uLength;

    void main() {
      // position.z: apex'te 0.0, tabanda -uLength (-15.0)
      vProgress = clamp(-position.z / uLength, 0.0, 1.0);

      #ifdef USE_INSTANCING
        mat4 m = modelViewMatrix * instanceMatrix;
        vec4 mvPosition = m * vec4(position, 1.0);
        mat3 normMat = mat3(m);
        vNormal = normalize(normMat * normal);
      #else
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
      #endif

      vViewPosition = -mvPosition.xyz;
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    varying vec3 vViewPosition;
    varying vec3 vNormal;
    varying float vProgress;

    uniform vec3 uColor;
    uniform float uIntensity;

    void main() {
      // 1. Eksenel sönüm: Far camından uca doğru yumuşak gradyan
      float forwardFade = smoothstep(1.0, 0.04, vProgress);
      float apexSoft = smoothstep(0.0, 0.035, vProgress);
      float axialFalloff = forwardFade * apexSoft;

      // 2. Bakış açısına duyarlı kenar yumuşatma (Rim / Edge feathering)
      // Koni kenarlarının silüet çizgilerini yumuşatarak katı üçgen hatlarını yok eder
      vec3 viewDir = normalize(vViewPosition);
      vec3 norm = normalize(vNormal);
      float rim = abs(dot(norm, viewDir));
      float edgeFeather = smoothstep(0.0, 0.50, rim);

      float alpha = axialFalloff * edgeFeather * uIntensity;
      if (alpha < 0.001) discard;

      gl_FragColor = vec4(uColor * alpha, alpha);
    }
  `
};

function _buildHeadlightBeams(parentGroup) {
  // 15 metre ileri uzanan yatay koni (apex farda, taban -Z yönünde)
  // 32 radyal segment ile tamamen pürüzsüz ve dairesel kesit
  const beamLen = 15.0;
  const beamGeo = new THREE.ConeGeometry(1.5, beamLen, 32, 1, true);
  beamGeo.translate(0, -beamLen / 2, 0);
  beamGeo.rotateX(Math.PI / 2); // Apex (0,0,0)'da kalır, koni -Z yönünde uzar

  const matBeam = new THREE.ShaderMaterial({
    vertexShader:   VolumetricHeadlightShader.vertexShader,
    fragmentShader: VolumetricHeadlightShader.fragmentShader,
    uniforms: {
      uLength:    { value: beamLen },
      uColor:     { value: new THREE.Color(0xfff6e4) },
      uIntensity: { value: 0.15 },
    },
    transparent: true,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false,
    side:        THREE.DoubleSide,
  });

  // En yakın 2 karşı araç * 2 far = 4 huzme
  _headlightBeamMesh = new THREE.InstancedMesh(beamGeo, matBeam, 4);
  _headlightBeamMesh.name = 'traffic_headlight_beams';
  _headlightBeamMesh.frustumCulled = false;

  const zeroM4 = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let b = 0; b < 4; b++) {
    _headlightBeamMesh.setMatrixAt(b, zeroM4);
  }
  _headlightBeamMesh.instanceMatrix.needsUpdate = true;

  parentGroup.add(_headlightBeamMesh);
}

/**
 * Her frame araç konumlarını günceller (Sıfır Bellek Tahsisi).
 *
 * @param {number} delta — Frame süresi (saniye)
 */
export function updateTraffic(delta) {
  if (!_carObjects[0]) return;

  const dt = Math.min(delta, 0.1);

  for (let i = 0; i < CAR_COUNT; i++) {
    const c = _carObjects[i];

    c.z += c.vRel * dt;

    // ── Incoming (Karşıdan Gelenler) Respawn ─────────────────────────────────
    if (c.isIncoming) {
      if (c.z < Z_INCOMING_DESPAWN) {
        // Kameranın arkasına geçti -> İleride yeniden doğ
        c.z = Z_INCOMING_RESPAWN_MIN + (i % 4) * 30.0 + Math.random() * 20.0;
      }
    }
    // ── Outgoing (Aynı Yöne Gidenler) Respawn ────────────────────────────────
    else {
      if (c.z > Z_OUTGOING_DESPAWN) {
        // İleriye uzaklaştı -> Kameranın hemen arkasında yeniden doğ
        c.z = Z_OUTGOING_RESPAWN_MIN - (i % 3) * 15.0 - Math.random() * 10.0;
      }
    }

    // 0 tahsis: sadece ilkel float konumu atanır
    c.group.position.z = c.z;

    // ── Tekerlek Su Sıçratması & Sprey Dumanı (Wet Asphalt Tire Spray) ────────
    if (c.z > -15.0 && c.z < 65.0) {
      // 1. Zemin sıçrama halkası (asfalt dalgacığı)
      if (Math.random() < 0.20) {
        const rearZ = c.isIncoming ? (c.z + 1.8) : (c.z - 1.8);
        const tireX = (Math.random() < 0.5) ? (c.laneX - 0.72) : (c.laneX + 0.72);
        spawnSplash(tireX, 0.012, rearZ, 1.25, 0.16);
      }

      // 2. Havada asılı kalan tekerlek su spreyi (aerodinamik fırlatma)
      if (Math.random() < 0.35) {
        const rearZ = c.isIncoming ? (c.z + 1.9) : (c.z - 1.9);
        // Her iki arka tekerlekten arkaya ve yukarı doğru fırlayan su sisi
        const sprayVz = c.isIncoming ? (5.5 + Math.random() * 2.5) : (-5.0 - Math.random() * 2.0);
        const sprayVy = 1.2 + Math.random() * 0.8;
        const sprayVxL = -0.3 + (Math.random() - 0.5) * 0.4;
        const sprayVxR =  0.3 + (Math.random() - 0.5) * 0.4;
        spawnWheelSpray(c.laneX - 0.72, 0.15, rearZ, sprayVxL, sprayVy, sprayVz, 0.45 + Math.random() * 0.25, 0.38 + Math.random() * 0.15);
        spawnWheelSpray(c.laneX + 0.72, 0.15, rearZ, sprayVxR, sprayVy, sprayVz, 0.45 + Math.random() * 0.25, 0.38 + Math.random() * 0.15);
      }
    }
  }

  // ── Tekerlek Su Spreyi Parçacık Havuzunu Simüle Et ───────────────────────
  if (_sprayMesh) {
    let sprayNeedsUpdate = false;
    for (let k = 0; k < WHEEL_SPRAY_POOL_SIZE; k++) {
      if (_sprayActive[k] === 1) {
        _sprayLife[k] -= dt;
        if (_sprayLife[k] <= 0) {
          _sprayActive[k] = 0;
          _sprayScale[k] = 0;
          _sprayScl.set(0, 0, 0);
          _sprayPos.set(0, -100, 0);
          _sprayMat4.compose(_sprayPos, _sprayQuat, _sprayScl);
          _sprayMesh.setMatrixAt(k, _sprayMat4);
          sprayNeedsUpdate = true;
          continue;
        }

        // Fizik simülasyonu: aerodinamik hava direnci + hafif yerçekimi
        _sprayX[k] += _sprayVx[k] * dt;
        _sprayY[k] += _sprayVy[k] * dt;
        _sprayZ[k] += _sprayVz[k] * dt;
        _sprayVx[k] *= 0.94;
        _sprayVz[k] *= 0.94;
        _sprayVy[k] -= 2.5 * dt; // yerçekimi çöküşü

        const progress = 1.0 - (_sprayLife[k] / _sprayMaxLife[k]); // 0 -> 1
        // Genişleme: su sisi havaya dağılırken hacim kazanır
        const currentScale = _sprayScale[k] * (0.35 + progress * 1.8);
        _sprayPos.set(_sprayX[k], Math.max(0.05, _sprayY[k]), _sprayZ[k]);
        _sprayScl.set(currentScale, currentScale * 0.65, currentScale); // yatay elips şeklinde yayılır
        _sprayQuat.identity();
        _sprayMat4.compose(_sprayPos, _sprayQuat, _sprayScl);
        _sprayMesh.setMatrixAt(k, _sprayMat4);

        // Renk ve opaklık modülasyonu (üstel/yumuşak sönüm: exponential soft fade-out)
        const softAlpha = Math.exp(-progress * 3.2) * (1.0 - progress);
        _sprayColor.setRGB(softAlpha * 0.90, softAlpha * 0.93, softAlpha * 1.0);
        _sprayMesh.setColorAt(k, _sprayColor);

        sprayNeedsUpdate = true;
      }
    }
    if (sprayNeedsUpdate) {
      _sprayMesh.instanceMatrix.needsUpdate = true;
      if (_sprayMesh.instanceColor) _sprayMesh.instanceColor.needsUpdate = true;
    }
  }

  // ── Volumetrik Far Huzmelerini Güncelle (En yakın 2 karşı araç) ────────────
  if (_headlightBeamMesh) {
    let closest1 = null, closest2 = null;
    let dist1 = Infinity, dist2 = Infinity;

    for (let i = 0; i < CARS_PER_LANE; i++) {
      const c = _carObjects[i]; // incoming araçlar
      // Kameranın önünde ve görünür menzilde mi?
      if (c.z > -4.0 && c.z < 150.0) {
        if (c.z < dist1) {
          dist2 = dist1; closest2 = closest1;
          dist1 = c.z;   closest1 = c;
        } else if (c.z < dist2) {
          dist2 = c.z;   closest2 = c;
        }
      }
    }

    const tracked = [closest1, closest2];
    for (let t = 0; t < 2; t++) {
      const car = tracked[t];
      const idxL = t * 2;
      const idxR = t * 2 + 1;

      if (car) {
        const off = PROFILE_HEADLIGHT_OFFSETS[car.profile] || PROFILE_HEADLIGHT_OFFSETS.sedan;
        _scale.set(1, 1, 1);
        _quat.identity();

        // Sol ön far
        _pos.set(car.x - off.halfW, off.y, car.z + off.z);
        _m4.compose(_pos, _quat, _scale);
        _headlightBeamMesh.setMatrixAt(idxL, _m4);

        // Sağ ön far
        _pos.set(car.x + off.halfW, off.y, car.z + off.z);
        _m4.compose(_pos, _quat, _scale);
        _headlightBeamMesh.setMatrixAt(idxR, _m4);
      } else {
        _scale.set(0, 0, 0);
        _pos.set(0, -100, 0);
        _m4.compose(_pos, _quat, _scale);
        _headlightBeamMesh.setMatrixAt(idxL, _m4);
        _headlightBeamMesh.setMatrixAt(idxR, _m4);
      }
    }
    _headlightBeamMesh.instanceMatrix.needsUpdate = true;
  }
}

/**
 * Trafik filosu salt-okunur durumunu döndürür.
 *
 * @returns {Array<{id, isIncoming, group, x, z, vRel, profile}>}
 */
export function getTrafficData() {
  return _carObjects;
}
