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

// ══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION CONSTANTS
// ══════════════════════════════════════════════════════════════════════════════

export const CAR_COUNT       = 12;
export const CARS_PER_LANE   = 6;

// Sabit kamera & akan dünya referans hızı (m/s)
export const CAM_SPD_SEC     = 28.0;

// Şerit merkezleri (ground.js yol genişliği 11.6 m: X in [-5.8, +5.8])
const LANE_X_INCOMING        = -3.2; // Sol şerit (Karşıdan gelenler)
const LANE_X_OUTGOING        =  3.2; // Sağ şerit (Aynı yönde gidenler — Walker X=0'a 3.2 m güvenli mesafe)

// Respawn Z sınırları (Sürekli aktif ve yoğun şehir trafiği akışı)
const Z_INCOMING_RESPAWN_MIN = 240.0;
const Z_INCOMING_RESPAWN_MAX = 350.0;
const Z_INCOMING_DESPAWN     = -25.0; // Kameranın arkasına geçme sınırı

const Z_OUTGOING_RESPAWN_MIN = -35.0;
const Z_OUTGOING_RESPAWN_MAX = -15.0;
const Z_OUTGOING_DESPAWN     = 320.0; // Uzakta ufka karışma sınırı

// ══════════════════════════════════════════════════════════════════════════════
// NIGHT COLOR PALETTE (12 Farklı Zengin Gece Rengi)
// ══════════════════════════════════════════════════════════════════════════════

const CAR_COLORS = Object.freeze([
  0x1a2942, // 0: Metalik Gece Mavisi (Sedan - Incoming)
  0x4c141d, // 1: Bordo / Koyu Şarap (Hatchback - Incoming)
  0xd49b1a, // 2: Taksi Sarısı (SUV - Incoming)
  0x23262b, // 3: Füme / Antrasit (Sedan - Incoming)
  0xa6b2be, // 4: Gümüş İnci Metalik (Hatchback - Incoming)
  0x163322, // 5: İngiliz Yarış Yeşili (SUV - Incoming)
  0x111215, // 6: Gece Siyahı (Sedan - Outgoing)
  0x1b2845, // 7: Koyu Lacivert (Hatchback - Outgoing)
  0x8a2318, // 8: Ateş Kırmızısı (SUV - Outgoing)
  0x444952, // 9: Titanyum Grisi (Sedan - Outgoing)
  0xcca020, // 10: Şehir Taksi Sarısı (Hatchback - Outgoing)
  0x183059, // 11: Safir Mavisi (SUV - Outgoing)
]);

// ══════════════════════════════════════════════════════════════════════════════
// MODULE STATE
// ══════════════════════════════════════════════════════════════════════════════

// 12 aracın runtime durumları
const _carObjects = new Array(CAR_COUNT);

// Paylaşılan materyaller
let _matGlass     = null; // Karartılmış parlak otomotiv camı
let _matWheel     = null; // Mat kauçuk lastik & çelik jant
let _matHeadlight = null; // Parlak beyaz emissive ön far
let _matTaillight = null; // Parlak kırmızı emissive arka stop

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
    color:     0x07090e,
    metalness: 0.90,
    roughness: 0.12,
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
      // Karşı şerit: Kameraya doğru yaklaşır
      posX = LANE_X_INCOMING;
      // İçsel araç hızı: 16 - 22 m/s
      const intrinsicSpeed = 16.0 + (laneIndex % 3) * 3.0;
      vRel = -(intrinsicSpeed + CAM_SPD_SEC); // örn. -(19 + 28) = -47 m/s
      // Z dağılımı: Kameranın hemen önünden başlayarak dengeli dağılım
      startZ = 20.0 + laneIndex * 45.0 + (laneIndex % 2) * 10.0;
      // Rotasyon: Ön farlar doğrudan kameraya (-Z) bakar
      headingYaw = 0.0;
    } else {
      // Aynı şerit: Kameradan uzaklaşır
      posX = LANE_X_OUTGOING;
      // İçsel araç hızı: 38 - 46 m/s (kamerayı hızla sollar)
      const intrinsicSpeed = 38.0 + (laneIndex % 3) * 4.0;
      vRel = intrinsicSpeed - CAM_SPD_SEC; // örn. 42 - 28 = +14 m/s (uzaklaşır)
      // Z dağılımı: Walker ve kameranın yanından başlayarak öne doğru
      startZ = -12.0 + laneIndex * 48.0 + (laneIndex % 2) * 12.0;
      // Rotasyon: 180° çevrilir; stop lambaları kameraya görünür
      headingYaw = Math.PI;
    }

    // Gövde boya materyali (Her araç için zengin gece metalik tonu)
    const matPaint = new THREE.MeshStandardMaterial({
      color:     CAR_COLORS[i],
      metalness: 0.82,
      roughness: 0.28,
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
      z:           startZ,
      vRel:        vRel,
      profile:     profileKey,
    };
  }
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
