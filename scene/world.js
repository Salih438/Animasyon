/**
 * scene/world.js — Phase 9 Revision: Living City Architecture, Alleys & Glowing Neon Signs
 *
 * Sorumluluklar:
 *   - 48 Bina (24 Sol + 24 Sağ), Z = -30 m'den başlayarak kameranın arkasını, yanını
 *     ve tüm cadde ufkunu kesintisiz dolduran gerçekçi şehir silüeti.
 *   - Sokak Dönüşleri ve Kavşak Boşlukları (Cross-Street / Alley Gaps):
 *       * Z ≈ 36 - 56 m (Sağ ara sokak kavşağı)
 *       * Z ≈ 96 - 120 m (Sol ara sokak kavşağı)
 *       * Z ≈ 190 - 215 m (Sağ ara sokak)
 *       Tünel etkisini tamamen kırar, derinlik ve şehir dokusu kazandırır.
 *   - Canlı Neon Tabelalar (12 Adet 3D Glowing Neon Signs):
 *       * "HOTEL", "BAR", "DINER", "NOIR", "CINEMA", "JAZZ CLUB", "CAFE", "PHARMACY", "MOTEL"
 *       * Canlı neon renkleri (Cyan, Hot Pink, Amber, Ruby Red, Emerald Green, Electric Purple)
 *       * Yüksek emissive parlaklık (3.0 - 3.8) -> UnrealBloomPass ile zengin optik parlama
 *       * Islak asfalta rengarenk sinematik dikey yansımalar bırakır.
 *   - Prosedürel Pencere Izgaraları (CanvasTexture baked) + Şimşek emissive senkronizasyonu.
 *   - ZERO ALLOCATION: updateWorld içinde 0 heap tahsisi.
 */

import * as THREE from 'three';
import { BUILDING_LINE_RIGHT, BUILDING_LINE_LEFT, WALK_SPEED } from './ground.js';

// ── Sabitler ─────────────────────────────────────────────────────────────────
const BUILDING_COUNT     = 48;
const BUILDINGS_PER_SIDE = 24;

// Z yerleşim aralığı: Kameranın hemen arkasından (-30 m) ufka (1600 m)
const Z_START   = -30;
const Z_SPACING = 68; // Ortalama 68 m aralıkla 24 bina ≈ 1600 m

// Bina boyut varyasyonları
const W_MIN = 16,  W_MAX = 30;  // genişlik (X)
const H_MIN = 26,  H_MAX = 80;  // yükseklik (Y)
const D_MIN = 18,  D_MAX = 34;  // derinlik (Z)

// ── Modül Durumu ─────────────────────────────────────────────────────────────
let _meshLeft         = null;
let _meshRight        = null;
let _signsGroup       = null;
let _alleysGroup      = null;
let _pedestriansGroup = null;

const _pedestrianObjects = [];
const _alleyObjects      = [];
let _worldAnimTime       = 0;

// Reusable math objects
const _m4    = new THREE.Matrix4();
const _pos   = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _quat  = new THREE.Quaternion();
const _col   = new THREE.Color();

/** Integer → [0, 1) deterministik pseudo-random */
function _hash(n) {
  n = (Math.imul(n ^ (n >>> 16), 0x45d9f3b)) | 0;
  n = (Math.imul(n ^ (n >>> 16), 0x45d9f3b)) | 0;
  return ((n ^ (n >>> 16)) >>> 0) / 0xffffffff;
}

function _seed(gi, s) {
  return _hash(gi * 19 + s * 37 + 8191);
}

// ══════════════════════════════════════════════════════════════════════════════
// PENCERE DOKUSU (CanvasTexture)
// ══════════════════════════════════════════════════════════════════════════════

function _createWindowTexture(texSeed, maxAniso = 16) {
  if (typeof document === 'undefined') return null;

  const TW = 1024, TH = 2048;
  const canvas = document.createElement('canvas');
  canvas.width  = TW;
  canvas.height = TH;
  const ctx = canvas.getContext('2d');

  // Koyu granit ve tuğla cephe tabanı
  ctx.fillStyle = '#0a0d14';
  ctx.fillRect(0, 0, TW, TH);

  // İnce tuğla / taş derz çizgileri (Micro horizontal courses)
  ctx.fillStyle = '#06080e';
  for (let y = 0; y < TH; y += 12) {
    ctx.fillRect(0, y, TW, 1);
  }

  const COLS = 24;
  const ROWS = 36;
  const cellW = TW / COLS;
  const cellH = TH / ROWS;
  const ww = (cellW * 0.65) | 0;
  const wh = (cellH * 0.62) | 0;

  for (let r = 0; r < ROWS; r++) {
    const isGroundFloor = r >= ROWS - 2; // Alt 2 kat: Zemin kat vitrin ve dükkanlar

    // Kat arası kabartma taş silme (Architectural Cornice)
    ctx.fillStyle = '#141824';
    ctx.fillRect(0, r * cellH - 1, TW, 4);
    ctx.fillStyle = '#1c2233';
    ctx.fillRect(0, r * cellH, TW, 1);

    for (let c = 0; c < COLS; c++) {
      const wx = c * cellW + (cellW - ww) * 0.5;
      const wy = r * cellH + (cellH - wh) * 0.5;

      if (isGroundFloor) {
        // Zemin kat: Detaylı butik / kafe / otel vitrinleri
        const isDoor = (c % 4 === 0);

        // Koyu döküm demir dış vitrin çerçevesi
        ctx.fillStyle = '#06080c';
        ctx.fillRect(wx - 2, wy - 3, ww + 4, wh + 6);

        if (!isDoor) {
          // Vitrin camı iç mekan derinliği
          const grad = ctx.createLinearGradient(wx, wy, wx, wy + wh);
          grad.addColorStop(0.0, 'rgba(255, 220, 140, 0.95)');
          grad.addColorStop(0.65, 'rgba(235, 185, 95, 0.88)');
          grad.addColorStop(1.0, 'rgba(80, 50, 20, 0.92)');
          ctx.fillStyle = grad;
          ctx.fillRect(wx, wy, ww, wh);

          // Vitrin alt ahşap/mermer koruma paneli (Kickplate)
          ctx.fillStyle = '#121622';
          ctx.fillRect(wx, wy + wh * 0.72, ww, wh * 0.28);

          // İnce döküm demir cam bölmeleri (Transom & mullions)
          ctx.fillStyle = '#080a10';
          ctx.fillRect(wx + ww * 0.5 - 1, wy, 2, wh * 0.72);
          ctx.fillRect(wx, wy + wh * 0.28, ww, 2);

          // Vitrin üst tabela bandı
          ctx.fillStyle = '#181e2e';
          ctx.fillRect(wx - 1, wy - 3, ww + 2, 4);
        } else {
          // Çift kanatlı camlı giriş kapısı
          ctx.fillStyle = '#10131d';
          ctx.fillRect(wx, wy, ww, wh);

          // Kapı üst camı (Transom light)
          ctx.fillStyle = 'rgba(255, 200, 110, 0.75)';
          ctx.fillRect(wx + 2, wy + 2, ww - 4, wh * 0.35);

          // Kapı kanat bölmesi
          ctx.fillStyle = '#08090e';
          ctx.fillRect(wx + ww * 0.5 - 1, wy, 2, wh);

          // Pirinç kapı kolları
          ctx.fillStyle = '#d4af37';
          ctx.fillRect(wx + ww * 0.5 - 3, wy + wh * 0.55, 2, 6);
          ctx.fillRect(wx + ww * 0.5 + 2, wy + wh * 0.55, 2, 6);
        }
      } else {
        // Üst katlar: Detaylı pencereler, taş söveler ve denizlikler
        const lit = _hash(texSeed * 10000 + c * 100 + r) < 0.46;

        // Taş pencere denizliği (Sill)
        ctx.fillStyle = '#161a28';
        ctx.fillRect(wx - 3, wy + wh, ww + 6, 3);
        // Üst taş lento (Lintel)
        ctx.fillRect(wx - 2, wy - 3, ww + 4, 3);

        if (lit) {
          const isWarm = _hash(c * 50 + r) > 0.25;
          ctx.fillStyle = isWarm ? 'rgba(255, 218, 140, 0.90)' : 'rgba(175, 215, 255, 0.82)';
          ctx.fillRect(wx, wy, ww, wh);

          // 4'lü pencere ahşap bölmesi (Mullion cross)
          ctx.fillStyle = '#0a0d14';
          ctx.fillRect(wx + (ww / 2) - 1, wy, 2, wh);
          ctx.fillRect(wx, wy + (wh / 2) - 1, ww, 2);

          // İç mekan perde/gölge silüeti (Bazı pencerelerde yarım çekili perde)
          if (_hash(c * 17 + r * 13) > 0.60) {
            ctx.fillStyle = 'rgba(20, 15, 10, 0.45)';
            ctx.fillRect(wx, wy, ww, wh * 0.40);
          }
        } else {
          // Karanlık oda penceresi (gece cam yansıması)
          ctx.fillStyle = 'rgba(10, 13, 20, 0.96)';
          ctx.fillRect(wx, wy, ww, wh);
          ctx.fillStyle = '#05070c';
          ctx.fillRect(wx + 1, wy + 1, ww - 2, wh - 2);

          // Koyu çerçeve
          ctx.fillStyle = '#080a10';
          ctx.fillRect(wx + (ww / 2) - 1, wy, 2, wh);
          ctx.fillRect(wx, wy + (wh / 2) - 1, ww, 2);
        }
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 1);
  texture.anisotropy = maxAniso;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

// ══════════════════════════════════════════════════════════════════════════════
// NEON TABELA SİSTEMİ (Glowing Film Noir Neon Signs)
// ══════════════════════════════════════════════════════════════════════════════

const NEON_SIGNS = [
  // Sağ Taraf Tabelaları (Walker'ın yanından ufka doğru)
  { text: 'HOTEL',     color: 0x00f5ff, isVert: true,  side: 'right', z:   8.0, y: 5.4 },
  { text: 'BAR',       color: 0xff0066, isVert: false, side: 'right', z:  28.0, y: 4.5 },
  { text: 'NOIR',      color: 0xbf00ff, isVert: true,  side: 'right', z:  58.0, y: 6.2 }, // Ara sokak köşesi
  { text: 'CINEMA',    color: 0xffaa00, isVert: false, side: 'right', z:  92.0, y: 5.0 },
  { text: 'DINER',     color: 0xff1133, isVert: false, side: 'right', z: 145.0, y: 4.4 },
  { text: 'MOTEL',     color: 0x00f5ff, isVert: true,  side: 'right', z: 220.0, y: 5.6 },

  // Sol Taraf Tabelaları (Kameranın doğrudan gördüğü karşı cephe)
  { text: 'DINER',     color: 0xff9900, isVert: false, side: 'left',  z:  -2.0, y: 4.8 },
  { text: 'JAZZ CLUB', color: 0x00d4ff, isVert: false, side: 'left',  z:  24.0, y: 5.5 },
  { text: 'CAFE',      color: 0x00ff88, isVert: true,  side: 'left',  z:  52.0, y: 4.6 },
  { text: 'BAR',       color: 0xff0077, isVert: true,  side: 'left',  z:  82.0, y: 6.0 },
  { text: 'PHARMACY',  color: 0x00ff77, isVert: false, side: 'left',  z: 135.0, y: 4.5 },
  { text: 'HOTEL',     color: 0xff1133, isVert: true,  side: 'left',  z: 180.0, y: 5.8 },
];

function _createNeonTexture(text, colorHex, isVert) {
  if (typeof document === 'undefined') return null;

  const w = isVert ? 64 : 256;
  const h = isVert ? 256 : 64;

  const canvas = document.createElement('canvas');
  canvas.width  = w;
  canvas.height = h;
  const ctx     = canvas.getContext('2d');

  // Saydam arka plan
  ctx.clearRect(0, 0, w, h);

  // Koyu akrilik tabela panosu
  ctx.fillStyle = 'rgba(8, 10, 16, 0.92)';
  ctx.fillRect(2, 2, w - 4, h - 4);

  const hexStr = '#' + colorHex.toString(16).padStart(6, '0');

  // Çerçeve neon çizgisi
  ctx.strokeStyle = hexStr;
  ctx.lineWidth = 3;
  ctx.strokeRect(4, 4, w - 8, h - 8);

  // Parlayan neon yazı
  ctx.fillStyle = hexStr;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = hexStr;
  ctx.shadowBlur = 12;

  if (isVert) {
    ctx.font = 'bold 26px "Courier New", monospace';
    const chars = text.split('');
    const step = (h - 24) / chars.length;
    chars.forEach((ch, idx) => {
      ctx.fillText(ch, w / 2, 22 + idx * step);
    });
  } else {
    ctx.font = 'bold 28px "Courier New", monospace';
    ctx.fillText(text, w / 2, h / 2 + 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function _buildNeonSigns(parentGroup) {
  _signsGroup = new THREE.Group();
  _signsGroup.name = 'city_neon_signs';

  NEON_SIGNS.forEach((sign, idx) => {
    const isVert = sign.isVert;
    const signW = isVert ? 0.75 : 3.2;
    const signH = isVert ? 3.0  : 0.85;
    const signD = 0.18;

    const geo = new THREE.BoxGeometry(signW, signH, signD);
    const tex = _createNeonTexture(sign.text, sign.color, isVert);

    const mat = new THREE.MeshStandardMaterial({
      color:             0x111116,
      emissive:          new THREE.Color(sign.color),
      emissiveMap:       tex,
      emissiveIntensity: 3.2, // Yüksek parlaklık -> UnrealBloomPass lens parlaması
      roughness:         0.20,
      metalness:         0.70,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `neon_${sign.text}_${idx}`;

    // X pozisyonu: Bina cephesinin hemen önünde, kaldırım üstünde yola doğru sarkar
    const posX = sign.side === 'right' ? (BUILDING_LINE_RIGHT + 0.35) : (BUILDING_LINE_LEFT - 0.35);
    mesh.position.set(posX, sign.y, sign.z);

    // Yola dik bakan blade sign açıları
    if (isVert) {
      mesh.rotation.y = Math.PI / 2; // Yoldan gelen ve giden araçlara net görünür
    }

    _signsGroup.add(mesh);
  });

  parentGroup.add(_signsGroup);
}

// ══════════════════════════════════════════════════════════════════════════════
// ARA SOKAKLAR (Alleys) & GİZEMLİ NOIR YAYALAR (Pedestrians)
// ══════════════════════════════════════════════════════════════════════════════

function _buildAlleys(parentGroup) {
  _alleysGroup = new THREE.Group();
  _alleysGroup.name = 'city_alleys';

  const alleyZPositions = [42.0, 118.0, 205.0];

  const matPavement = new THREE.MeshStandardMaterial({
    color:     0x14161f,
    roughness: 0.55,
    metalness: 0.12,
  });

  const matLamp = new THREE.MeshStandardMaterial({
    color:             0xffaa44,
    emissive:          new THREE.Color(0xff8822),
    emissiveIntensity: 3.5,
    roughness:         0.20,
    metalness:         0.70,
  });

  const matWall = new THREE.MeshStandardMaterial({
    color:     0x0f1118,
    roughness: 0.85,
    metalness: 0.10,
  });

  alleyZPositions.forEach((zPos, idx) => {
    const alleyRoot = new THREE.Group();
    alleyRoot.name = `alley_${idx}`;
    alleyRoot.position.set(0, 0, zPos);

    // 1. Ara Sokak Zemin Taşları (Sağ bina hattından sağa doğru derinlemesine uzanır)
    const floorGeo = new THREE.PlaneGeometry(16.0, 9.0);
    const floorMesh = new THREE.Mesh(floorGeo, matPavement);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.set(BUILDING_LINE_RIGHT - 8.0, 0.138, 0);
    floorMesh.receiveShadow = true;
    alleyRoot.add(floorMesh);

    // 2. Ara Sokak Yan Duvarları (Sokağın derin koridor hissi - bina hattının arkasında)
    const wallGeo = new THREE.BoxGeometry(16.0, 12.0, 1.0);
    const wallNear = new THREE.Mesh(wallGeo, matWall);
    wallNear.position.set(BUILDING_LINE_RIGHT - 8.0, 6.0, -4.5);
    const wallFar = new THREE.Mesh(wallGeo, matWall);
    wallFar.position.set(BUILDING_LINE_RIGHT - 8.0, 6.0, 4.5);
    alleyRoot.add(wallNear, wallFar);

    // 3. Ara Sokak Köşe Feneri (Sıcak amber ışık saçar)
    const lampGeo = new THREE.BoxGeometry(0.26, 0.40, 0.26);
    const lampMesh = new THREE.Mesh(lampGeo, matLamp);
    lampMesh.position.set(BUILDING_LINE_RIGHT - 0.20, 3.4, -4.2);
    alleyRoot.add(lampMesh);

    // Yerel nokta ışığı (sokağın ağzını aydınlatır)
    const pLight = new THREE.PointLight(0xff8822, 1.4, 18.0, 2.0);
    pLight.position.set(BUILDING_LINE_RIGHT - 0.60, 3.4, -4.2);
    alleyRoot.add(pLight);

    _alleysGroup.add(alleyRoot);
    _alleyObjects.push({ group: alleyRoot, z: zPos });
  });

  parentGroup.add(_alleysGroup);
}

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

function _createNoirPedestrian(cfg) {
  const group = new THREE.Group();
  group.name = `pedestrian_${cfg.id}`;

  const coatColor = cfg.coatColor || 0x0d0f17;
  const umbColor  = cfg.umbColor  || 0x10141e;
  const scaleX    = cfg.scaleX    || 1.0;
  const scaleY    = cfg.scaleY    || 1.0;
  const hasUmb    = cfg.hasUmbrella !== false;
  const hasHood   = cfg.hasHood === true;

  const matCoat = new THREE.MeshStandardMaterial({
    color:     coatColor,
    roughness: 0.70,
    metalness: 0.05,
  });

  const matHat = new THREE.MeshStandardMaterial({
    color:     0x0a0c12,
    roughness: 0.60,
    metalness: 0.10,
  });

  const matUmb = new THREE.MeshStandardMaterial({
    color:     umbColor,
    roughness: 0.40,
    metalness: 0.15,
    side:      THREE.DoubleSide,
  });

  // 1. Gövde ve Bacaklar (Tek Merged BufferGeometry — Draw Call Tasarrufu)
  const legLGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.45 * scaleY, 8);
  legLGeo.translate(-0.10 * scaleX, 0.22 * scaleY, 0.0);

  const legRGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.45 * scaleY, 8);
  legRGeo.translate(0.10 * scaleX, 0.22 * scaleY, 0.0);

  const coatGeo = new THREE.CylinderGeometry(0.18 * scaleX, 0.30 * scaleX, 0.95 * scaleY, 10);
  coatGeo.translate(0, 0.85 * scaleY, 0);

  const bodyParts = [legLGeo, legRGeo, coatGeo];

  // Eğer kapüşonluysa, yakası kalkık mont boyunluğu
  if (hasHood) {
    const collarGeo = new THREE.CylinderGeometry(0.16 * scaleX, 0.22 * scaleX, 0.24 * scaleY, 10, 1, true);
    collarGeo.translate(0, 1.34 * scaleY, 0);
    bodyParts.push(collarGeo);
  }

  const mergedBodyGeo = _mergeGeos(bodyParts);
  const bodyMesh = new THREE.Mesh(mergedBodyGeo, matCoat);
  bodyMesh.castShadow    = true;
  bodyMesh.receiveShadow = true;
  group.add(bodyMesh);

  // 2. Baş (Etrafa bakınma salınımı için bağımsız pivot)
  const headGeo = new THREE.SphereGeometry(0.11 * scaleX, 10, 8);
  const headMesh = new THREE.Mesh(headGeo, matCoat);
  headMesh.position.set(0, 1.42 * scaleY, 0);
  group.add(headMesh);

  // Baş Aksesuarı (Şapka veya Kapüşon)
  if (!hasHood) {
    // Klasik Film Noir Fötr Şapka
    const brimGeo = new THREE.CylinderGeometry(0.24 * scaleX, 0.24 * scaleX, 0.02, 12);
    brimGeo.translate(0, 0.06 * scaleY, 0);
    const crownGeo = new THREE.CylinderGeometry(0.11 * scaleX, 0.13 * scaleX, 0.12 * scaleY, 10);
    crownGeo.translate(0, 0.12 * scaleY, 0);
    const hatGeo = _mergeGeos([brimGeo, crownGeo]);
    const hatMesh = new THREE.Mesh(hatGeo, matHat);
    hatMesh.rotation.x = -0.10;
    headMesh.add(hatMesh);
  } else {
    // Yağmurdan koruyan kumaş kapüşon (başın arkasını ve üstünü örten yarım kubbe)
    const hoodGeo = new THREE.SphereGeometry(0.14 * scaleX, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.70);
    const hoodMesh = new THREE.Mesh(hoodGeo, matCoat);
    hoodMesh.rotation.x = -0.15;
    hoodMesh.position.set(0, 0.03 * scaleY, -0.02);
    headMesh.add(hoodMesh);
  }

  // 3. Şemsiye (Varsa)
  if (hasUmb) {
    const canopyGeo = new THREE.ConeGeometry(0.55 * scaleX, 0.20 * scaleY, 12, 1, true);
    canopyGeo.translate(0, 0.24 * scaleY, 0);
    canopyGeo.rotateX(-0.10);

    const shaftGeo = new THREE.CylinderGeometry(0.007, 0.007, 0.72 * scaleY, 8);
    shaftGeo.translate(0, 0.0, 0);

    const umbGeo = _mergeGeos([canopyGeo, shaftGeo]);
    const umbMesh = new THREE.Mesh(umbGeo, matUmb);
    umbMesh.position.set(0.12 * scaleX, 1.45 * scaleY, 0.04);
    umbMesh.castShadow = true;
    group.add(umbMesh);
  }

  group.userData.headRef = headMesh;
  return group;
}

function _buildPedestrians(parentGroup) {
  _pedestriansGroup = new THREE.Group();
  _pedestriansGroup.name = 'city_pedestrians';

  const configs = [
    // 1. Karşı sol kaldırımda bize doğru yürüyen uzun boylu figür (Incoming - Uzun, Lacivert & Hardal)
    {
      id: 1, x: 7.8, z: 42.0, yaw: 0.0, speed: -1.3, isWalking: true, phase: 0.0,
      scaleX: 1.02, scaleY: 1.08,
      coatColor: 0x0e172a, // Gece mavisi
      umbColor:  0x8a6218, // Hardal amber
      hasUmbrella: true, hasHood: false, headOffset: 0.0
    },
    // 2. Karşı sol kaldırımda uzaklaşan minyon figür (Outgoing - Minyon, Antrasit & Petrol)
    {
      id: 2, x: 8.3, z: 86.0, yaw: Math.PI, speed: 1.1, isWalking: true, phase: 1.85,
      scaleX: 0.92, scaleY: 0.90,
      coatColor: 0x1a1c22, // Koyu antrasit
      umbColor:  0x143428, // Koyu petrol yeşili
      hasUmbrella: true, hasHood: false, headOffset: 1.2
    },
    // 3. Sağ ara sokak ağzında fenerin altında sığınan ŞEMSİYESİZ KAPÜŞONLU silüet (1st Alley)
    {
      id: 3, x: -5.30, z: 28.0, yaw: 1.5, speed: 0.0, isWalking: false, phase: 0.72,
      scaleX: 1.04, scaleY: 1.00,
      coatColor: 0x2d1218, // Koyu bordo kaban
      umbColor:  0x000000,
      hasUmbrella: false, hasHood: true, headOffset: 0.6 // Şemsiyesiz, kapüşonlu!
    },
    // 4. İkinci sağ ara sokak ağzında bekleyen gizemli yaya (2nd Alley - Standart boy, Kiremit)
    {
      id: 4, x: -5.80, z: 104.0, yaw: 1.4, speed: 0.0, isWalking: false, phase: 2.40,
      scaleX: 0.98, scaleY: 0.98,
      coatColor: 0x16181f, // Titanyum füme
      umbColor:  0x4d181e, // Kiremit bordo
      hasUmbrella: true, hasHood: false, headOffset: 2.1
    },
    // 5. Karşı sol kaldırımda ileride hızlı adımlarla yürüyen uzun silüet (Hızlı yürüyüş)
    {
      id: 5, x: 8.0, z: 140.0, yaw: 0.0, speed: -1.5, isWalking: true, phase: 3.95,
      scaleX: 0.95, scaleY: 1.12, // İnce uzun
      coatColor: 0x11141c, // Derin gece
      umbColor:  0x181a22, // Koyu çelik
      hasUmbrella: true, hasHood: false, headOffset: 3.4
    },
    // 6. Sağ kaldırımda önümüzde uzakta yürüyen yaya (Kaldırım arkadaşı - Önümüzde Z=58m, Haki & Krem)
    {
      id: 6, x: -4.30, z: 58.0, yaw: Math.PI, speed: 0.8, isWalking: true, phase: 5.10,
      scaleX: 1.00, scaleY: 0.96,
      coatColor: 0x1b2417, // Haki zeytin
      umbColor:  0x5c523e, // Bej krem
      hasUmbrella: true, hasHood: false, headOffset: 4.5
    },
  ];

  for (const cfg of configs) {
    const pMesh = _createNoirPedestrian(cfg);
    pMesh.position.set(cfg.x, 0.14, cfg.z);
    pMesh.rotation.y = cfg.yaw;
    _pedestriansGroup.add(pMesh);

    _pedestrianObjects.push({
      id:         cfg.id,
      group:      pMesh,
      x:          cfg.x,
      z:          cfg.z,
      baseZ:      cfg.z,
      speed:      cfg.speed,
      isWalking:  cfg.isWalking,
      phase:      cfg.phase,
      headRef:    pMesh.userData.headRef,
      headOffset: cfg.headOffset,
    });
  }

  parentGroup.add(_pedestriansGroup);
}

// ══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════════════════════════════════════

export async function initWorld(scene, group, config, renderer) {
  const targetGroup = group || (scene && scene.getObjectByName && scene.getObjectByName('world')) || scene;

  // Max Anisotropy (Donanım üst sınırı ile 16 arasında güvenli seçim)
  const maxAniso = (renderer && renderer.capabilities && typeof renderer.capabilities.getMaxAnisotropy === 'function')
    ? Math.min(16, renderer.capabilities.getMaxAnisotropy())
    : 16;

  const texLeft  = _createWindowTexture(42, maxAniso);
  const texRight = _createWindowTexture(137, maxAniso);

  const matLeft = new THREE.MeshStandardMaterial({
    color:             0x181c26,
    map:               texLeft,
    roughness:         0.70,
    metalness:         0.20,
    emissiveMap:       texLeft,
    emissive:          new THREE.Color(1.0, 0.88, 0.60),
    emissiveIntensity: 0.28,
  });

  const matRight = new THREE.MeshStandardMaterial({
    color:             0x181c26,
    map:               texRight,
    roughness:         0.70,
    metalness:         0.20,
    emissiveMap:       texRight,
    emissive:          new THREE.Color(1.0, 0.88, 0.60),
    emissiveIntensity: 0.28,
  });

  const unitGeo = new THREE.BoxGeometry(1, 1, 1);

  _meshLeft  = new THREE.InstancedMesh(unitGeo, matLeft,  BUILDINGS_PER_SIDE);
  _meshRight = new THREE.InstancedMesh(unitGeo, matRight, BUILDINGS_PER_SIDE);

  _meshLeft.name  = 'buildings_left';
  _meshRight.name = 'buildings_right';
  _meshLeft.castShadow = true;
  _meshRight.castShadow= true;

  _buildSide(0, 'left',  _meshLeft);
  _buildSide(1, 'right', _meshRight);

  targetGroup.add(_meshLeft);
  targetGroup.add(_meshRight);

  // Canlı neon tabelaları ekle
  _buildNeonSigns(targetGroup);

  // Ara sokakları (Alleys) ekle
  _buildAlleys(targetGroup);

  // Gizemli noir yayaları (Pedestrians) ekle
  _buildPedestrians(targetGroup);
}

function _buildSide(sideIndex, sideName, mesh) {
  const isRight = sideIndex === 1;
  const facadeLine = isRight ? BUILDING_LINE_RIGHT : BUILDING_LINE_LEFT;

  // Kameranın hemen arkasından (-45 m) başlayarak kesintisiz bitişik nizam bina dizisi
  let currentZ = -45.0;

  for (let i = 0; i < BUILDINGS_PER_SIDE; i++) {
    const gi = sideIndex * BUILDINGS_PER_SIDE + i;

    // Boyut varyasyonları
    const w = 18.0 + _seed(gi, 1) * 12.0; // 18m - 30m genişlik
    const h = 34.0 + _seed(gi, 2) * 50.0; // 34m - 84m yükseklik (görkemli silüet)
    const d = 28.0 + _seed(gi, 3) * 10.0; // 28m - 38m derinlik

    // Ara sokak kavşak koridorları (i = 2, 7, 14'te 9 metrelik temiz ara sokak açıklığı)
    const isAlley = (i === 2 || i === 7 || i === 14);
    if (isAlley) {
      currentZ += 9.0;
    }

    const z = currentZ + d / 2;
    currentZ += d + 1.2; // Bitişik nizam, sıfır boşluk

    // X merkezi: Ön cephesi tam olarak facadeLine hattına hizalanır
    const x = isRight ? (facadeLine - w / 2) : (facadeLine + w / 2);
    const y = h / 2;

    _pos.set(x, y, z);
    _scale.set(w, h, d);
    _m4.compose(_pos, _quat, _scale);

    mesh.setMatrixAt(i, _m4);

    // Renk varyasyonu (Koyu antrasit, gri-mavi, koyu granit)
    const colVariant = _seed(gi, 6);
    if (colVariant < 0.35)      _col.setHex(0x0c0f16);
    else if (colVariant < 0.70) _col.setHex(0x12141c);
    else                        _col.setHex(0x16171f);

    mesh.setColorAt(i, _col);
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
}

export function updateWorld(delta) {
  const driftZ = 2.8 * delta;

  // 1. Neon Tabelaların Z Akışı ve Sonsuz Döngüsü
  if (_signsGroup && _signsGroup.children) {
    for (let i = 0; i < _signsGroup.children.length; i++) {
      const sign = _signsGroup.children[i];
      sign.position.z -= driftZ;
      if (sign.position.z < -20.0) {
        sign.position.z += 240.0;
      }
    }
  }

  // 2. Binaların Z Akışı (Caddenin geriye doğru kesintisiz akışı)
  if (_meshLeft) {
    _meshLeft.position.z -= driftZ;
    if (_meshLeft.position.z < -36.0) {
      _meshLeft.position.z += 36.0;
    }
  }
  if (_meshRight) {
    _meshRight.position.z -= driftZ;
    if (_meshRight.position.z < -36.0) {
      _meshRight.position.z += 36.0;
    }
  }

  // 3. Ara Sokakların Z Akışı (Alleys drift & wrap)
  for (let i = 0; i < _alleyObjects.length; i++) {
    const alley = _alleyObjects[i];
    alley.z -= driftZ;
    if (alley.z < -30.0) {
      alley.z += 220.0;
    }
    alley.group.position.z = alley.z;
  }

  // 4. Gizemli Noir Yayaların Hareketi ve Animasyonu (Pedestrians)
  for (let i = 0; i < _pedestrianObjects.length; i++) {
    const ped = _pedestrianObjects[i];
    // Yürüme hızı + dünyanın bağıl geri akışı (driftZ)
    ped.z += (ped.speed * delta) - driftZ;
    if (ped.z < -25.0) {
      ped.z += 220.0;
    } else if (ped.z > 210.0) {
      ped.z -= 220.0;
    }
    ped.group.position.z = ped.z;

    // Yürüme yaylanması veya dururken nefes alma animasyonu
    ped.phase += delta * (ped.isWalking ? 4.8 : 1.4);
    if (ped.isWalking) {
      ped.group.position.y = 0.14 + Math.abs(Math.sin(ped.phase)) * 0.038;
      ped.group.rotation.z = Math.sin(ped.phase) * 0.032;
    } else {
      ped.group.position.y = 0.14 + Math.sin(ped.phase) * 0.008;
      ped.group.rotation.z = Math.sin(ped.phase * 0.5) * 0.012;
    }

    // Karakterlerin baş bölgesine çok hafif Y-ekseni etrafa bakınma salınımı (±10° ≈ ±0.17 rad)
    if (ped.headRef) {
      ped.headRef.rotation.y = Math.sin(ped.phase * 0.35 + ped.headOffset) * 0.17;
    }
  }
}

/**
 * Şimşek anında binaların pencerelerinin emissive parlaklığını günceller.
 * 0.28 -> 1.60: Bloom eşiğini (0.78) aşarak canlı optik parlama verir,
 * ancak pencerelerin beyazlaşıp "yanmasını" (blowout) önler.
 */
export function setBuildingLightningFactor(factor) {
  const intensity = 0.28 + factor * 1.32; // 0.28 -> 1.60
  if (_meshLeft  && _meshLeft.material)  _meshLeft.material.emissiveIntensity = intensity;
  if (_meshRight && _meshRight.material) _meshRight.material.emissiveIntensity = intensity;
}

/**
 * Yayaların salt-okunur durumlarını döndürür (Temas gölgeleri için).
 */
export function getPedestrianData() {
  return _pedestrianObjects;
}
