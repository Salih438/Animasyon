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
import { SIDEWALK_OUTER_X } from './ground.js';

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
let _meshLeft    = null;
let _meshRight   = null;
let _signsGroup  = null;

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

function _createWindowTexture(texSeed) {
  if (typeof document === 'undefined') return null;

  const TW = 256, TH = 512;
  const canvas = document.createElement('canvas');
  canvas.width  = TW;
  canvas.height = TH;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0a0d14';
  ctx.fillRect(0, 0, TW, TH);

  const COLS = 6;
  const ROWS = 10;
  const cellW = TW / COLS;
  const cellH = TH / ROWS;
  const ww = (cellW * 0.58) | 0;
  const wh = (cellH * 0.54) | 0;

  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const lit = _hash(texSeed * 10000 + c * 100 + r) < 0.45;
      const wx  = c * cellW + (cellW - ww) * 0.5;
      const wy  = r * cellH + (cellH - wh) * 0.5;

      if (lit) {
        // Sıcak sarı ve amber tonları
        const isWarm = _hash(c * 50 + r) > 0.3;
        ctx.fillStyle = isWarm ? 'rgba(255, 218, 130, 0.90)' : 'rgba(180, 220, 255, 0.85)';
        ctx.fillRect(wx, wy, ww, wh);

        ctx.fillStyle = 'rgba(255, 200, 80, 0.12)';
        ctx.fillRect(wx - 2, wy - 2, ww + 4, wh + 4);
      } else {
        ctx.fillStyle = 'rgba(6, 8, 14, 0.95)';
        ctx.fillRect(wx, wy, ww, wh);
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 1);
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

    // X pozisyonu: Kaldırım sınırının hemen üstünde, cepheden yola doğru bakar
    const posX = sign.side === 'right' ? 8.65 : -7.35;
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
// PUBLIC API
// ══════════════════════════════════════════════════════════════════════════════

export async function initWorld(scene, group, config) {
  const targetGroup = group || (scene && scene.getObjectByName && scene.getObjectByName('world')) || scene;

  const texLeft  = _createWindowTexture(42);
  const texRight = _createWindowTexture(137);

  const matLeft = new THREE.MeshStandardMaterial({
    color:             0x0a0c12,
    roughness:         0.75,
    metalness:         0.25,
    emissiveMap:       texLeft,
    emissive:          new THREE.Color(1.0, 0.87, 0.55),
    emissiveIntensity: 0.30,
  });

  const matRight = new THREE.MeshStandardMaterial({
    color:             0x0a0c12,
    roughness:         0.75,
    metalness:         0.25,
    emissiveMap:       texRight,
    emissive:          new THREE.Color(1.0, 0.87, 0.55),
    emissiveIntensity: 0.30,
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
}

function _buildSide(sideIndex, sideName, mesh) {
  const isRight = sideIndex === 1;

  for (let i = 0; i < BUILDINGS_PER_SIDE; i++) {
    const gi = sideIndex * BUILDINGS_PER_SIDE + i;

    // Boyut varyasyonları
    const w = W_MIN + _seed(gi, 1) * (W_MAX - W_MIN);
    const h = H_MIN + _seed(gi, 2) * (H_MAX - H_MIN);
    const d = D_MIN + _seed(gi, 3) * (D_MAX - D_MIN);

    // Z yerleşimi (Ara sokak kavşak boşlukları ile)
    let z = Z_START + i * Z_SPACING + (_seed(gi, 4) - 0.5) * 16.0;

    // Ara sokak kavşak boşlukları (Alley gaps)
    if (isRight) {
      if (z >= 36 && z <= 56)  z += 24; // Sağ ara sokak boşluğu
      if (z >= 190 && z <= 215) z += 26;
    } else {
      if (z >= 96 && z <= 120) z += 28; // Sol ara sokak boşluğu
    }

    // X merkezi (Kaldırım dış kenarından geriye doğru oturur)
    const baseOffset = isRight ? (SIDEWALK_OUTER_X + w / 2 + 1.2) : (-13.35 - w / 2 - 1.2);
    const jitterX = (_seed(gi, 5) - 0.5) * 3.5;
    const x = baseOffset + jitterX;
    const y = h / 2;

    _pos.set(x, y, z);
    _scale.set(w, h, d);
    _m4.compose(_pos, _quat, _scale);

    mesh.setMatrixAt(i, _m4);

    // Renk varyasyonu (Koyu antrasit, gri-mavi, koyu kahve)
    const colVariant = _seed(gi, 6);
    if (colVariant < 0.35)      _col.setHex(0x0e1118);
    else if (colVariant < 0.70) _col.setHex(0x13151c);
    else                        _col.setHex(0x18171f);

    mesh.setColorAt(i, _col);
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
}

export function updateWorld(delta) {
  // Binalar statiktir; sıfır bellek tahsisi
}

/**
 * Şimşek anında binaların pencerelerinin emissive parlaklığını günceller.
 */
export function setBuildingLightningFactor(factor) {
  const intensity = 0.30 + factor * 1.70; // 0.30 -> 2.00
  if (_meshLeft  && _meshLeft.material)  _meshLeft.material.emissiveIntensity = intensity;
  if (_meshRight && _meshRight.material) _meshRight.material.emissiveIntensity = intensity;
}
