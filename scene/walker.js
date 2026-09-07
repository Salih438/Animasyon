/**
 * scene/walker.js — Phase 3: Procedural Walker Character & Cinematic Walk Cycle
 *
 * Mimari: Hiyerarşik Pivot / Group Architecture (SkinnedMesh YOK)
 * Her eklem bir THREE.Group; geometriler üst pivot'a ofsetlenerek bağlanır.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * CHARACTER HIERARCHY (Bone / Pivot Tree)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *  walkerRoot (Group, World: X=12.0, Y=0, Z=18.0)
 *  └─ hips (Group, Y=HIP_BASE = 0.994)  ← Gövde Bobbing Pivot: sin(2*t)*BOB_AMOUNT
 *     ├─ pelvisMesh (BoxGeometry, Y=+HIP_H/2)
 *     ├─ torso (Group, Y=+HIP_H)
 *     │   ├─ coatMesh (Trapezoidal Frustum: omuzdan aşağı genişleyen hacim + arka flare)
 *     │   ├─ skirtL (Group, sol arka etek)
 *     │   │   └─ skirtLMesh (BoxGeometry, bacak salınımıyla ters fazlı kumaş dalgalanması)
 *     │   ├─ skirtR (Group, sağ arka etek)
 *     │   │   └─ skirtRMesh (BoxGeometry)
 *     │   ├─ shoulderL (Group, X=-SHLDR_X, Y=COAT_H)  ← Serbest kol pivotu
 *     │   │   └─ upperArmL (Mesh, CylinderGeometry, pivot üst uçta)
 *     │   │       └─ elbowL (Group, Y=-UARM_H)
 *     │   │           └─ forearmL (Mesh, CylinderGeometry, pivot üst uçta)
 *     │   ├─ shoulderR (Group, X=+SHLDR_X, Y=COAT_H)  ← Şemsiye tutan kol pivotu
 *     │   │   └─ upperArmR (Mesh, CylinderGeometry, pivot üst uçta)
 *     │   │       └─ elbowR (Group, Y=-UARM_H, bükülü pozisyon rot.x=0.78)
 *     │   │           └─ forearmR (Mesh, CylinderGeometry, pivot üst uçta)
 *     │   │               └─ wristR (Group, Y=-FARM_H)
 *     │   │                   └─ umbrellaRoot (Group)  ← Mikro-sallanım / damping
 *     │   │                       ├─ shaft (Mesh, CylinderGeometry)
 *     │   │                       ├─ canopy (Mesh, ConeGeometry, açık kubbe) ← Collider ref
 *     │   │                       ├─ tip (Mesh, SphereGeometry, kubbe tepe ucu)
 *     │   │                       └─ handle (Mesh, TorusGeometry, kıvrımlı J-kulp)
 *     │   └─ neck (Group, Y=COAT_H+NECK_Y)
 *     │       ├─ headMesh (Mesh, SphereGeometry)
 *     │       └─ hat (Group, fötr şapka, hafif öne eğik noir silüeti)
 *     │           ├─ brim (Mesh, CylinderGeometry, geniş siperlik diski)
 *     │           └─ crown (Mesh, CylinderGeometry, dedektif taç silindiri)
 *     ├─ hipL (Group, X=-LEG_X)  ← Sol kalça eklemi, bacak salınımı
 *     │   └─ thighL (Mesh, CylinderGeometry, pivot Y=0, uzanır Y=-THIGH_H)
 *     │       └─ kneeL (Group, Y=-THIGH_H)  ← Sol diz eklemi, geriye fleksiyon
 *     │           └─ shinL (Mesh, CylinderGeometry, pivot Y=0, uzanır Y=-SHIN_H)
 *     │               └─ ankleL (Group, Y=-SHIN_H)
 *     │                   └─ shoeL (Mesh, BoxGeometry, mat deri ayakkabı)
 *     └─ hipR (Group, X=+LEG_X)  ← Sağ kalça eklemi (karşı faz salınım)
 *         └─ thighR (Mesh, CylinderGeometry)
 *             └─ kneeR (Group, Y=-THIGH_H)
 *                 └─ shinR (Mesh, CylinderGeometry)
 *                     └─ ankleR (Group, Y=-SHIN_H)
 *                         └─ shoeR (Mesh, BoxGeometry)
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ZEMİN VE KALDIRIM HİZALAMASI (Foot / Ground Alignment Math)
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   Kaldırım yüzeyi Y: FLOOR_Y = 0.140  (ground.js SIDEWALK_THICK = 0.14)
 *   Düz bacak uzunluğu: LEG_LEN = SHOE_H (0.060) + SHIN_H (0.360) + THIGH_H (0.400) = 0.820 m
 *   Gövde bobbing genliği: BOB_AMOUNT = 0.034 m
 *   Hips baz konumu: HIP_BASE = FLOOR_Y + LEG_LEN + BOB_AMOUNT = 0.140 + 0.820 + 0.034 = 0.994 m
 *
 *   Hips Y hareketi: hips.position.y = HIP_BASE + sin(2 * walkTime) * BOB_AMOUNT
 *   - Minimum hips Y (bob en alt nokta): 0.994 - 0.034 = 0.960 m
 *   - Bu anda ayakkabı tabanı Y: 0.960 - 0.820 = 0.140 m === FLOOR_Y (kaldırıma tam temas!)
 *   - Maksimum hips Y: 0.994 + 0.034 = 1.028 m (ayak tabanı Y=0.208 m, adım havada süzülür)
 *   - Ayaklar asla kaldırımın içine BATMAZ (min Y = 0.140) ve havada ASILI KALMAZ.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * SCOPE SINIRLARI (Strict Phase 3 Compliance)
 * ══════════════════════════════════════════════════════════════════════════════
 *   ✓ Yağmur parçacıkları veya şemsiye çarpma fiziği YOK (Phase 4'e ayrıldı)
 *   ✓ Sokak lambası, araba veya şimşek kodlarına girilmedi
 *   ✓ updateWalker içinde 0 ALLOCATION (new THREE.* yasak, modül statik nesneleri)
 *   ✓ Post-processing / Bloom eklenmedi
 */

import * as THREE from 'three';

// ══════════════════════════════════════════════════════════════════════════════
// WORLD POSITION & CALIBRATION
// ══════════════════════════════════════════════════════════════════════════════

export const WALKER_X = 0.0;   // Tam caddenin ortasında, kameranın doğrudan önünde
export const WALKER_Z = 2.0;   // Z = 2; kamera Z = -3'ten tam arkasından bakar
export const FLOOR_Y  = 0.0;   // Asfalt seviyesi Y = 0


// ══════════════════════════════════════════════════════════════════════════════
// WALK CYCLE PARAMETERS (FPS Bağımsız Delta ile Sürülür)
// ══════════════════════════════════════════════════════════════════════════════

const STRIDE_FREQ   = 3.8;   // rad/s — Yürüyüş frekansı (1 adım ≈ 1.65 saniye)
const BOB_AMOUNT    = 0.034; // Gövde bobbing dikey genliği (m)
const LEG_SWING     = 0.50;  // Kalça açısal salınım büyüklüğü (rad ≈ 28.6°)
const KNEE_BEND     = 0.62;  // Dinamik diz fleksiyonu (rad ≈ 35.5°)
const KNEE_PASSIVE  = 0.06;  // Doğal duruş için minimal pasif diz eğimi (rad)
const ARM_SWING     = 0.32;  // Serbest sol kol sarkaç salınımı (rad)
const SKIRT_SWING   = 0.12;  // Palto etek dalgalanma büyüklüğü (rad)
const UMB_WOBBLE_Z  = 0.022; // Şemsiye Z ekseni mikro-sallanım genliği (rad)
const UMB_WOBBLE_X  = 0.014; // Şemsiye X ekseni mikro-sallanım genliği (rad)

// ══════════════════════════════════════════════════════════════════════════════
// ANATOMICAL & GEOMETRIC DIMENSIONS (1 world unit ≈ 1 metre)
// ══════════════════════════════════════════════════════════════════════════════

const D = Object.freeze({
  // Ayakkabı (Shoe) — adım hissi için belirgin kutu
  SHOE_W:  0.100,  SHOE_H: 0.060,  SHOE_D: 0.240,

  // Alt bacak (Shin)
  SHIN_R:  0.040,  SHIN_H: 0.360,

  // Üst bacak (Thigh)
  THIGH_R: 0.058,  THIGH_H: 0.400,

  // Bacak lateral açıklığı (kalça soketinin X ofseti)
  LEG_X:   0.095,

  // Pelvis kutusu
  HIP_W:   0.240,  HIP_H: 0.100,   HIP_D: 0.120,

  // Palto gövdesi (Trapezoidal Frustum — omuzdan aşağı hafif genişleyen hacim)
  COAT_WT: 0.380,  // Omuz genişliği (Top Width)
  COAT_WB: 0.480,  // Etek/Bel genişliği (Bottom Width — omuzdan aşağı genişler!)
  COAT_DT: 0.160,  // Omuz derinliği (Top Depth)
  COAT_DB: 0.220,  // Etek/Bel derinliği (Bottom Depth)
  COAT_H:  0.560,  // Palto gövde yüksekliği
  COAT_FLARE: 0.035, // Arka etek geriye açılandırma ofseti (+Z)

  // Palto etek panelleri (arka kumaş flapleri)
  SKIRT_W: 0.200,  SKIRT_H: 0.320, SKIRT_D: 0.035,

  // Üst kol (Upper Arm)
  UARM_R:  0.042,  UARM_H: 0.250,

  // Ön kol (Forearm)
  FARM_R:  0.036,  FARM_H: 0.210,

  // Omuz eklemi X ofseti
  SHLDR_X: 0.210,

  // Kafa küresi
  HEAD_R:  0.150,

  // Fötr Şapka (Fedora Hat)
  CROWN_R: 0.130,  CROWN_H: 0.180, // Taç silindiri
  BRIM_R:  0.220,  BRIM_H: 0.022, // Geniş siperlik diski
  NECK_Y:  0.050,                 // Boyun boşluğu

  // Şemsiye mimarisi (Umbrella Architecture)
  UMB_CR:  0.500,  UMB_CH: 0.220, // Kubbe konisi (Canopy: radius, height)
  UMB_SR:  0.007,  UMB_SH: 0.800, // Gövde silindiri (Shaft: radius, height)
  UMB_TR:  0.016,                 // Tepe uç küresi (Tip: radius)
  UMB_HR:  0.032,  UMB_HT: 0.009, // Kıvrımlı kulp (Handle Torus: radius, tube)
});

// ══════════════════════════════════════════════════════════════════════════════
// DERIVED Y-HEIGHTS (walkerRoot yerel uzayı, walkerRoot.y = 0)
// ══════════════════════════════════════════════════════════════════════════════

const Y = (function () {
  const FLOOR    = FLOOR_Y;                                        // 0.140
  const LEG_LEN  = D.SHOE_H + D.SHIN_H + D.THIGH_H;                // 0.820
  const HIP_BASE = FLOOR + LEG_LEN + BOB_AMOUNT;                   // 0.994 (Hips Group baz Y)
  const WAIST    = D.HIP_H;                                        // Torso Group ofseti
  const SHOULDER = D.COAT_H;                                       // Omuz eklem ofseti
  const HEAD     = D.COAT_H + D.NECK_Y + D.HEAD_R;                 // Kafa merkezi ofseti
  return { FLOOR, LEG_LEN, HIP_BASE, WAIST, SHOULDER, HEAD };
}());

// ══════════════════════════════════════════════════════════════════════════════
// MODULE STATE — Hiyerarşik pivot referansları
// ══════════════════════════════════════════════════════════════════════════════

let _hips      = null;   // Kök bobbing pivotu
let _hipL      = null;   // Sol kalça eklemi
let _hipR      = null;   // Sağ kalça eklemi
let _kneeL     = null;   // Sol diz
let _kneeR     = null;   // Sağ diz
let _shoulderL = null;   // Sol serbest omuz
let _shoulderR = null;   // Sağ şemsiye omuzu
let _skirtL    = null;   // Sol arka palto eteği
let _skirtR    = null;   // Sağ arka palto eteği
let _umbGroup  = null;   // Şemsiye mikro-sallanım kökü
let _umbCanopy = null;   // Şemsiye kubbe mesh referansı (dünya pozisyonu için)

let _walkTime  = 0;      // Sürekli artan normalize yürüyüş fazı

// ══════════════════════════════════════════════════════════════════════════════
// REUSABLE STATIC OBJECTS (0 Heap Allocation in updateLoop)
// ══════════════════════════════════════════════════════════════════════════════

const _umbCenter = new THREE.Vector3();   // Şemsiye merkez dünya koordinatı

// Phase 4 rain.js entegrasyonu için sabit nesne referansı
const _umbCollider = Object.freeze({
  center: _umbCenter,         // THREE.Vector3 (her frame yerinde güncellenir)
  radius: D.UMB_CR,           // 0.50 m (şemsiye kubbe yarıçapı)
});

// ══════════════════════════════════════════════════════════════════════════════
// MATERIALS (Koyu Dedektif / Noir Paleti — MeshStandardMaterial)
// ══════════════════════════════════════════════════════════════════════════════

function _createMaterials() {
  return {
    // Palto: Zengin koyu antrasit-lacivert kumaş (ışıkta net silüet verir)
    coat:  new THREE.MeshStandardMaterial({
      color:     0x222638,
      roughness: 0.55,
      metalness: 0.15,
    }),
    // Şapka: Fötr kumaş
    hat:   new THREE.MeshStandardMaterial({
      color:     0x1a1e2a,
      roughness: 0.50,
      metalness: 0.10,
    }),
    // Ten: Gece tonu
    skin:  new THREE.MeshStandardMaterial({
      color:     0x443026,
      roughness: 0.65,
      metalness: 0.00,
    }),
    // Ayakkabı: Islak parlak deri
    shoe:  new THREE.MeshStandardMaterial({
      color:     0x241d1a,
      roughness: 0.45,
      metalness: 0.25,
    }),
    // Şemsiye kubbesi: Islak kumaş parıltısı (sokak lambalarını yansıtır)
    umb:   new THREE.MeshStandardMaterial({
      color:     0x162032,
      roughness: 0.35,
      metalness: 0.25,
      side:      THREE.DoubleSide,
    }),
    // Şemsiye gövdesi ve sapı
    shaft: new THREE.MeshStandardMaterial({
      color:     0x2e2e38,
      roughness: 0.40,
      metalness: 0.50,
    }),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// GEOMETRY HELPERS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Üst-pivotlu silindir geometri üretir.
 * Geometri merkezden Y = -h/2 ötelenerek tepe noktası Y = 0 (eklem pivotu) yapılır.
 * Böylece eklem döndürüldüğünde uzuv doğrudan mafsal noktasından rotasyon alır.
 */
function _pivotLimb(rTop, rBot, h, mat) {
  const geo = new THREE.CylinderGeometry(rTop, rBot, h, 10, 1);
  geo.translate(0, -h / 2, 0);
  return new THREE.Mesh(geo, mat);
}

/**
 * Palto gövdesi — Trapezoidal Frustum BufferGeometry.
 * Omuzdan (Top) aşağıya (Bottom) hafifçe genişler ("omuzdan aşağı hafif genişleyen trapezoidal hacim").
 * Arka etek yüzeyi hafifçe geriye (+Z) açılandırılmıştır.
 *
 * Vertex haritası:
 *  V0(-tW, H, -tD)  V1(+tW, H, -tD)  V2(+tW, H, +tD)  V3(-tW, H, +tD)  ← Omuz (Top)
 *  V4(-bW, 0, -bD)  V5(+bW, 0, -bD)  V6(+bW, 0, +bDf) V7(-bW, 0, +bDf) ← Etek/Bel (Bottom)
 */
function _coatGeometry() {
  const bW  = D.COAT_WB / 2, tW  = D.COAT_WT / 2;
  const tD  = D.COAT_DT / 2, bD  = D.COAT_DB / 2;
  const bDf = bD + D.COAT_FLARE; // Arka etek geriye flare (+Z)
  const H   = D.COAT_H;

  // 8 tepe noktası
  const pos = new Float32Array([
    -tW, H, -tD,   tW, H, -tD,   tW, H, tD,   -tW, H, tD,  // V0-V3 (Omuz)
    -bW, 0, -bD,   bW, 0, -bD,   bW, 0, bDf,  -bW, 0, bDf  // V4-V7 (Etek/Bel)
  ]);

  // Dışa bakan CCW üçgen indeksleri
  const idx = new Uint16Array([
    0, 1, 5,   0, 5, 4,   // Ön yüz (−Z)
    2, 3, 7,   2, 7, 6,   // Arka yüz (+Z)
    3, 0, 4,   3, 4, 7,   // Sol yüz (−X)
    1, 2, 6,   1, 6, 5,   // Sağ yüz (+X)
    0, 3, 2,   0, 2, 1,   // Üst kapak (+Y)
    4, 5, 6,   4, 6, 7,   // Alt kapak (−Y)
  ]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  return geo;
}

// ══════════════════════════════════════════════════════════════════════════════
// CHARACTER BUILDERS (Hiyerarşik Montaj)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Bacak zinciri: hips → hipJoint → thigh → knee → shin → ankle → shoe
 */
function _buildLegs(hips, mat) {
  for (const [name, xSign] of [['L', -1], ['R', 1]]) {
    // ── Kalça eklem pivotu ──────────────────────────────────────────────────
    const hipJoint = new THREE.Group();
    hipJoint.name  = `hip${name}`;
    hipJoint.position.set(xSign * D.LEG_X, 0, 0);
    hips.add(hipJoint);

    // ── Üst bacak (Thigh) — pivot Y=0'da, aşağı uzanır ─────────────────────
    const thigh = _pivotLimb(D.THIGH_R * 0.88, D.THIGH_R, D.THIGH_H, mat.coat);
    thigh.name = `thigh${name}`;
    thigh.castShadow = true;
    hipJoint.add(thigh);

    // ── Diz eklemi (Knee) — üst bacağın alt ucunda ──────────────────────────
    const knee = new THREE.Group();
    knee.name  = `knee${name}`;
    knee.position.set(0, -D.THIGH_H, 0);
    thigh.add(knee);

    // ── Alt bacak (Shin) — pivot Y=0'da, aşağı uzanır ──────────────────────
    const shin = _pivotLimb(D.SHIN_R * 0.90, D.SHIN_R, D.SHIN_H, mat.coat);
    shin.name  = `shin${name}`;
    shin.castShadow = true;
    knee.add(shin);

    // ── Ayak bileği eklemi (Ankle) ──────────────────────────────────────────
    const ankle = new THREE.Group();
    ankle.name  = `ankle${name}`;
    ankle.position.set(0, -D.SHIN_H, 0);
    shin.add(ankle);

    // ── Ayakkabı (Shoe) — burun kameraya doğru (-Z yönü) ────────────────────
    const shoeGeo = new THREE.BoxGeometry(D.SHOE_W, D.SHOE_H, D.SHOE_D);
    const shoe    = new THREE.Mesh(shoeGeo, mat.shoe);
    shoe.name = `shoe${name}`;
    // Tabanı bileğin alt seviyesine (-SHOE_H) ve burun öne uzanacak şekilde ofsetlenir
    shoe.position.set(0, -D.SHOE_H / 2, -D.SHOE_D * 0.15);
    shoe.castShadow = true;
    ankle.add(shoe);

    if (name === 'L') { _hipL = hipJoint; _kneeL = knee; }
    else              { _hipR = hipJoint; _kneeR = knee; }
  }
}

/**
 * Gövde zinciri: pelvis + palto/torso + etekler + kollar + kafa
 */
function _buildTorso(hips, mat) {
  // ── Pelvis kutusu ────────────────────────────────────────────────────────
  const pelvis = new THREE.Mesh(
    new THREE.BoxGeometry(D.HIP_W, D.HIP_H, D.HIP_D),
    mat.coat
  );
  pelvis.name = 'pelvis';
  pelvis.position.set(0, D.HIP_H / 2, 0);
  pelvis.castShadow = true;
  hips.add(pelvis);

  // ── Torso grubu — bel seviyesinden yükselir ──────────────────────────────
  const torso = new THREE.Group();
  torso.name  = 'torso';
  torso.position.set(0, Y.WAIST, 0);
  hips.add(torso);

  // ── Palto ana gövdesi (Trapezoidal Frustum) ──────────────────────────────
  const coat = new THREE.Mesh(_coatGeometry(), mat.coat);
  coat.name = 'coat';
  coat.castShadow = true;
  torso.add(coat);

  // ── Palto arka etek panelleri (bacak salınımına duyarlı flapler) ──────────
  for (const [side, xSign] of [['L', -1], ['R', 1]]) {
    const sg = new THREE.Group();
    sg.name  = `skirt${side}`;
    sg.position.set(xSign * (D.SKIRT_W * 0.52), 0, D.COAT_DB / 2);
    sg.rotation.x = 0.18; // Geriye doğal açı
    torso.add(sg);

    const sm = new THREE.Mesh(
      new THREE.BoxGeometry(D.SKIRT_W, D.SKIRT_H, D.SKIRT_D),
      mat.coat
    );
    sm.name = `skirt${side}Mesh`;
    sm.position.set(0, -D.SKIRT_H / 2, 0);
    sm.castShadow = true;
    sg.add(sm);

    if (side === 'L') _skirtL = sg;
    else              _skirtR = sg;
  }

  _buildArms(torso, mat);
  _buildHead(torso, mat);
}

/**
 * Kollar: Omuz -> Kol -> Ön kol hiyerarşisi
 * Sol kol serbest sarkaç salınımı yapar.
 * Sağ kol şemsiyeyi tutar pozisyonda bükülüdür.
 */
function _buildArms(torso, mat) {
  // ── Sol Kol (Serbest Salınım) ────────────────────────────────────────────
  const shldrL = new THREE.Group();
  shldrL.name  = 'shoulderL';
  shldrL.position.set(-D.SHLDR_X, Y.SHOULDER, 0);
  torso.add(shldrL);
  _shoulderL = shldrL;

  const uArmL = _pivotLimb(D.UARM_R * 0.90, D.UARM_R, D.UARM_H, mat.coat);
  uArmL.name  = 'upperArmL';
  uArmL.castShadow = true;
  shldrL.add(uArmL);

  const elbowL = new THREE.Group();
  elbowL.name  = 'elbowL';
  elbowL.position.set(0, -D.UARM_H, 0);
  elbowL.rotation.x = 0.15; // Doğal hafif kıvrım
  uArmL.add(elbowL);

  const fArmL = _pivotLimb(D.FARM_R * 0.90, D.FARM_R, D.FARM_H, mat.coat);
  fArmL.name  = 'forearmL';
  fArmL.castShadow = true;
  elbowL.add(fArmL);

  // ── Sağ Kol (Şemsiye Taşıyıcı Pozisyon) ──────────────────────────────────
  const shldrR = new THREE.Group();
  shldrR.name  = 'shoulderR';
  shldrR.position.set(D.SHLDR_X, Y.SHOULDER, 0);
  shldrR.rotation.x = -0.55; // Kol ileri kaldırılmış
  shldrR.rotation.z =  0.12; // Hafif içe dönük
  torso.add(shldrR);
  _shoulderR = shldrR;

  const uArmR = _pivotLimb(D.UARM_R * 0.90, D.UARM_R, D.UARM_H, mat.coat);
  uArmR.name  = 'upperArmR';
  uArmR.castShadow = true;
  shldrR.add(uArmR);

  const elbowR = new THREE.Group();
  elbowR.name  = 'elbowR';
  elbowR.position.set(0, -D.UARM_H, 0);
  elbowR.rotation.x = 0.78; // Dirsek bükülü — şemsiye dik tutulur
  uArmR.add(elbowR);

  const fArmR = _pivotLimb(D.FARM_R * 0.90, D.FARM_R, D.FARM_H, mat.coat);
  fArmR.name  = 'forearmR';
  fArmR.castShadow = true;
  elbowR.add(fArmR);

  // ── Sağ Bilek ve Şemsiye Bağlantısı ──────────────────────────────────────
  const wristR = new THREE.Group();
  wristR.name  = 'wristR';
  wristR.position.set(0, -D.FARM_H, 0);
  fArmR.add(wristR);

  _buildUmbrella(wristR, mat);
}

/**
 * Şemsiye Mimarisi:
 * Gövde (Shaft) + Kubbe (Canopy cone) + Tepe ucu (Tip) + Kıvrımlı kulp (Handle Torus)
 */
function _buildUmbrella(wrist, mat) {
  const umbRoot = new THREE.Group();
  umbRoot.name  = 'umbrellaRoot';
  // Bilekten kavrama noktası: elin içi
  umbRoot.position.set(0.03, 0.02, -0.04);
  wrist.add(umbRoot);
  _umbGroup = umbRoot;

  // ── Gövde (Shaft silindiri) ──────────────────────────────────────────────
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(D.UMB_SR * 0.8, D.UMB_SR * 1.2, D.UMB_SH, 8),
    mat.shaft
  );
  shaft.name = 'umbShaft';
  shaft.position.set(0, D.UMB_SH / 2, 0);
  shaft.castShadow = true;
  umbRoot.add(shaft);

  // ── Kubbe (Canopy konisi) ────────────────────────────────────────────────
  // Açık tabanlı koni; apex şaft tepesinde (+Y), geniş etek aşağıda (-Y)
  const canopy = new THREE.Mesh(
    new THREE.ConeGeometry(D.UMB_CR, D.UMB_CH, 20, 1, true),
    mat.umb
  );
  canopy.name = 'umbCanopy';
  canopy.position.set(0, D.UMB_SH - D.UMB_CH / 2, 0);
  canopy.castShadow = true;
  umbRoot.add(canopy);
  _umbCanopy = canopy; // Collider dünya konumu takibi için referans

  // ── Tepe ucu (Tip küresi) ────────────────────────────────────────────────
  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(D.UMB_TR, 8, 8),
    mat.shaft
  );
  tip.name = 'umbTip';
  tip.position.set(0, D.UMB_SH, 0);
  tip.castShadow = true;
  umbRoot.add(tip);

  // ── Kıvrımlı Kulp (J-Hook Handle — TorusGeometry yarım halka) ───────────
  const handleGeo = new THREE.TorusGeometry(D.UMB_HR, D.UMB_HT, 8, 16, Math.PI);
  const handle    = new THREE.Mesh(handleGeo, mat.shaft);
  handle.name = 'umbHandle';
  // Şaftın alt ucundan aşağıya ve geriye kıvrılan J formu
  handle.rotation.z = Math.PI / 2;
  handle.rotation.y = Math.PI;
  handle.position.set(0, -D.UMB_HR, 0);
  handle.castShadow = true;
  umbRoot.add(handle);
}

/**
 * Kafa ve Fötr Şapka:
 * Baş küresi + Fötr şapka (Crown silindiri + Brim siperlik diski)
 */
function _buildHead(torso, mat) {
  const neck = new THREE.Group();
  neck.name  = 'neck';
  neck.position.set(0, Y.SHOULDER + D.NECK_Y, 0);
  torso.add(neck);

  // ── Baş küresi ───────────────────────────────────────────────────────────
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(D.HEAD_R, 16, 12),
    mat.skin
  );
  head.name = 'head';
  head.position.set(0, D.HEAD_R, 0);
  head.castShadow = true;
  neck.add(head);

  // ── Fötr Şapka Grubu (hafif öne eğik noir dedektif duruşu) ────────────────
  const hat = new THREE.Group();
  hat.name  = 'hat';
  hat.position.set(0, D.HEAD_R * 1.55, 0);
  hat.rotation.x = -0.08; // Gözleri gölgeleyen sinematik açı
  neck.add(hat);

  // ── Siperlik (Brim diski) ────────────────────────────────────────────────
  const brim = new THREE.Mesh(
    new THREE.CylinderGeometry(D.BRIM_R, D.BRIM_R * 1.02, D.BRIM_H, 24),
    mat.hat
  );
  brim.name = 'hatBrim';
  brim.position.set(0, D.BRIM_H / 2, 0);
  brim.castShadow = true;
  hat.add(brim);

  // ── Taç (Crown silindiri — hafif yukarı daralan fötr formu) ──────────────
  const crown = new THREE.Mesh(
    new THREE.CylinderGeometry(D.CROWN_R * 0.94, D.CROWN_R * 1.02, D.CROWN_H, 16),
    mat.hat
  );
  crown.name = 'hatCrown';
  crown.position.set(0, D.BRIM_H + D.CROWN_H / 2, 0);
  crown.castShadow = true;
  hat.add(crown);
}

// ══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Karakteri oluşturur ve sahne hiyerarşisine ekler.
 * Hem `initWalker(scene)` hem de `initWalker(scene, group, config)` çağrılarını destekler.
 *
 * @param {THREE.Scene}      scene
 * @param {THREE.Group}     [group]  — Hedef grup (yoksa scene.getObjectByName('walker') veya scene)
 * @param {object}          [config] — Central configuration
 */
export async function initWalker(scene, group, config) {
  const targetGroup = group || (scene && scene.getObjectByName && scene.getObjectByName('walker')) || scene;
  const mat = _createMaterials();

  // ── Dünya Kökü (WalkerRoot) ───────────────────────────────────────────────
  // Y = 0; Zemin kaldırım yüzeyi FLOOR_Y = 0.140 m seviyesindedir.
  const walkerRoot = new THREE.Group();
  walkerRoot.name  = 'walkerRoot';
  walkerRoot.position.set(WALKER_X, FLOOR_Y, WALKER_Z);
  walkerRoot.scale.set(1.45, 1.45, 1.45); // Kadrajda heybetli ~1.8m insan boyutu
  walkerRoot.rotation.y = Math.PI; // İleriye (+Z, cadde boyunca ufka doğru) yürür
  targetGroup.add(walkerRoot);

  // ── Hips Pivotu (Gövde Bobbing Kökü) ─────────────────────────────────────
  _hips = new THREE.Group();
  _hips.name = 'hips';
  _hips.position.set(0, Y.HIP_BASE, 0); // 0.994 m
  walkerRoot.add(_hips);

  // ── Karakter Bileşenlerini İnşa Et ───────────────────────────────────────
  _buildLegs(_hips, mat);
  _buildTorso(_hips, mat);
}

/**
 * Her frame yürüyüş animasyonunu günceller.
 *
 * Rig & Animasyon Mekaniği (Trigonometrik Formüller):
 *   walkTime   += delta × STRIDE_FREQ
 *   s           = sin(walkTime)               [Primer adım salınımı]
 *   s2          = sin(2 × walkTime)           [Çift frekans dikey bobbing]
 *   swing       = s × LEG_SWING               [±0.50 rad bacak rotasyonu]
 *
 *   Hips Bob    : HIP_BASE + s2 × BOB_AMOUNT  [Dikey eksen ağırlık transferi]
 *   HipL rot.x  : -swing                      [Sol bacak ileri-geri rotasyonu]
 *   HipR rot.x  : +swing                      [Sağ bacak karşıt fazlı salınım]
 *   KneeL rot.x : max(0, +swing) × KNEE_BEND + KNEE_PASSIVE  [Geri giderken diz bükme]
 *   KneeR rot.x : max(0, -swing) × KNEE_BEND + KNEE_PASSIVE
 *   ShoulderL   : swing × ARM_SWING           [Sol kol zıt sarkaç salınımı]
 *   ShoulderR   : -0.55 + swing × 0.05        [Sağ kol şemsiye stabil tutuş]
 *   Skirt L/R   : 0.18 ± swing × SKIRT_SWING  [Palto eteği dinamik dalgalanma]
 *   UmbGroup    : sin(t×0.65)×WZ, sin(t×1.2)×WX [Şemsiye mikro-damping yaylanması]
 *
 * PERFORMANS: Bu döngüde TEK BİR 'new' TAHSİSİ YAPILMAZ (0 Heap Allocation).
 *
 * @param {number} delta — Frame delta süresi (saniye)
 */
export function updateWalker(delta) {
  if (!_hips) return;

  _walkTime += delta * STRIDE_FREQ;

  // ── Harmonik Osilatörler ─────────────────────────────────────────────────
  const s  = Math.sin(_walkTime);       // Adım fazı
  const s2 = Math.sin(_walkTime * 2);   // Çift frekans (ağırlık transferi)

  // ── Gövde Bobbing (Dikey Salınım) ────────────────────────────────────────
  _hips.position.y = Y.HIP_BASE + s2 * BOB_AMOUNT;

  // ── Bacak Salınımı (Karşıt Fazlı X Rotasyonu) ────────────────────────────
  const swing = s * LEG_SWING;
  _hipL.rotation.x = -swing; // Pozitif swing = sol bacak öne (kamera yönü)
  _hipR.rotation.x =  swing; // Sağ bacak zıt faz

  // ── Diz Fleksiyonu (Geriye Giden / Kaldırılan Bacakta Diz Kırılma) ───────
  _kneeL.rotation.x = Math.max(0,  swing) * KNEE_BEND + KNEE_PASSIVE;
  _kneeR.rotation.x = Math.max(0, -swing) * KNEE_BEND + KNEE_PASSIVE;

  // ── Sol Kol Zıt Sarkaç Salınımı (Sağ Bacakla Aynı Faz) ───────────────────
  _shoulderL.rotation.x = swing * ARM_SWING;

  // ── Sağ Kol Şemsiye Tutuşu (Minimal Sempati Hareketi) ────────────────────
  _shoulderR.rotation.x = -0.55 + swing * 0.05;

  // ── Palto Eteği Kumaş Hareketi ───────────────────────────────────────────
  _skirtL.rotation.x = 0.18 + swing * SKIRT_SWING;
  _skirtR.rotation.x = 0.18 - swing * SKIRT_SWING;

  // ── Şemsiye Dinamiği (Bağımsız Mikro-Yaylanma & Damping) ────────────────
  _umbGroup.rotation.z = Math.sin(_walkTime * 0.65) * UMB_WOBBLE_Z;
  _umbGroup.rotation.x = Math.sin(_walkTime * 1.20) * UMB_WOBBLE_X;

  // ── Şemsiye Collider Dünya Koordinatını Güncelle (Zero Alloc) ────────────
  if (_umbCanopy) {
    _umbCanopy.getWorldPosition(_umbCenter);
    // Koni merkez ofseti: kubbenin etek-tepe arası hacimsel merkezi
    _umbCenter.y += D.UMB_CH * 0.20;
  }
}

/**
 * Şemsiye çarpışma verisini döndürür — Phase 4 rain.js için hafif veri yapısı.
 *
 * @returns {{ center: THREE.Vector3, radius: number }}
 *   center: Şemsiye kubbesinin dünya uzayı koordinatı (Vector3)
 *   radius: Kubbe yarıçapı (0.50 m)
 */
export function getUmbrellaCollider() {
  return _umbCollider;
}
