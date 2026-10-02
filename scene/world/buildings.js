/**
 * scene/world/buildings.js - Prosedürel Bina ve Doku Sistemi
 *
 * FAZ 7 Refactor: world.js [A] + [D] + [E] Sorumluluk Kümeleri
 *
 * Sorumluluklar:
 *   - [A] Texture Factory: _createWallTexture, _createWindowAtlas (4x4 PBR vitrin ve pencere atlası)
 *   - [D] Geometry Utilities: _scaleUVs, _remapUVs, _createStorefrontSlice, _createWindowSlice
 *   - [E] Building Archetype: _buildArchetype (Neo-Klasik, Modern, Geleneksel)
 *   - [E] Building Placement: _placeBuildings (48 binanın sağ/sol kaldırım Z yerleşimi)
 *   - Runtime State: _buildingData dizisi, InstancedMesh matrisleri, Z-drift ve Z-wrap mantığı
 *   - Lightning: setBuildingLightningFactor (pencerelerin şimşek anında parlaması)
 *
 * Performans:
 *   - InstancedMesh ile 48 bina sadece 3 draw call'a indirgenir
 *   - Zero-Allocation scratch objeleri ile 60 FPS çöp üretimsiz (GC-free) çalışma
 */

import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { BUILDING_LINE_RIGHT, BUILDING_LINE_LEFT } from '../ground.js';
import { subscribeLightning } from '../events.js';

// ── Sabitler ─────────────────────────────────────────────────────────────────
const BUILDINGS_PER_SIDE = 24;

// ── Modül Durumu ─────────────────────────────────────────────────────────────
let _meshLeft  = null;
let _meshRight = null;
let _meshC     = null;
const _buildingData = [];

// Reusable math objects (Zero-Allocation — update döngüsünde new THREE.* yasaktır)
const _m4    = new THREE.Matrix4();
const _pos   = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _quat  = new THREE.Quaternion();
const _col   = new THREE.Color();
const _euler = new THREE.Euler();

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
// [A] TEXTURE FACTORY — Prosedürel Duvar ve Pencere Dokuları
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Gerçekçi Film Noir Taş Cephe Duvar Dokusu (Ashlar Stone Masonry)
 * 3.0 m x 4.0 m cephe modülüne denk gelen, insan ölçeğinde taş bloklar.
 */
function _createWallTexture(texSeed, maxAniso = 16) {
  if (typeof document === 'undefined') return null;

  const W = 1024, H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Koyu granit ve taş taban
  ctx.fillStyle = '#141720';
  ctx.fillRect(0, 0, W, H);

  const COLS = 4;
  const ROWS = 8;
  const bw = W / COLS;
  const bh = H / ROWS;

  for (let r = 0; r < ROWS; r++) {
    const isStaggered = (r % 2 === 1);
    const xShift = isStaggered ? (bw * 0.5) : 0;

    for (let c = -1; c <= COLS; c++) {
      const bx = c * bw + xShift;
      const by = r * bh;

      const val = _hash(texSeed * 7919 + r * 101 + c * 37);
      const shade = 18 + ((val * 10) | 0); // 18..28 RGB
      ctx.fillStyle = `rgb(${shade}, ${shade + 3}, ${shade + 8})`;
      ctx.fillRect(bx + 1, by + 1, bw - 2, bh - 2);

      // İnce doğal taş mineral benekleri
      for (let s = 0; s < 10; s++) {
        const sx = bx + _hash(r * 50 + c * 20 + s * 3) * (bw - 6) + 3;
        const sy = by + _hash(r * 30 + c * 40 + s * 7) * (bh - 6) + 3;
        const spk = 12 + ((_hash(s * 19) * 20) | 0);
        ctx.fillStyle = `rgba(${spk}, ${spk + 2}, ${spk + 6}, 0.30)`;
        ctx.fillRect(sx, sy, 3, 2);
      }

      // Taş pahı / Üst ve sol kenar kabartma aydınlatması
      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.fillRect(bx + 1, by + 1, bw - 2, 1);
      ctx.fillRect(bx + 1, by + 1, 1, bh - 2);

      // Taş alt ve sağ derinlik gölgesi
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(bx + 1, by + bh - 2, bw - 2, 1);
      ctx.fillRect(bx + bw - 2, by + 1, 1, bh - 2);
    }

    // Derz çizgisi (Mortar joints)
    ctx.fillStyle = '#090b10';
    ctx.fillRect(0, r * bh, W, 2);
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

/**
 * 4x4 PENCERE VE VİTRİN ATLASI (Window & Storefront Atlas)
 * 2048 x 2048 piksel, 16 adet 512x512 yüksek çözünürlüklü bağımsız vitrin ve pencere hücresi.
 */
function _createWindowAtlas(maxAniso = 16) {
  if (typeof document === 'undefined') return { diffuseTex: null, emissiveTex: null };

  const SIZE = 2048;
  const GRID = 4;
  const CELL = SIZE / GRID;

  const diffCanvas = document.createElement('canvas');
  diffCanvas.width  = SIZE;
  diffCanvas.height = SIZE;
  const dctx = diffCanvas.getContext('2d');

  const emCanvas = document.createElement('canvas');
  emCanvas.width  = SIZE;
  emCanvas.height = SIZE;
  const ectx = emCanvas.getContext('2d');

  dctx.fillStyle = '#080a10';
  dctx.fillRect(0, 0, SIZE, SIZE);

  ectx.fillStyle = '#000000';
  ectx.fillRect(0, 0, SIZE, SIZE);

  // ── ROW 0: ZEMİN KAT VİTRİNLERİ (STOREFRONTS — 4 FARKLI TİP & RENK) ────
  for (let c = 0; c < 4; c++) {
    const x0 = c * CELL;
    const y0 = 0;
    const w = CELL;
    const h = CELL;

    dctx.fillStyle = '#080a10';
    dctx.fillRect(x0, y0, w, h);

    const transomY = y0 + 16;
    const transomH = 88;

    const glassY = y0 + 114;
    const glassH = 306;

    const kickY = y0 + 426;
    const kickH = 78;

    // Vitrin alt lambri paneli (Kickplate)
    let kickCol1 = '#10141e', kickCol2 = '#1c2230';
    if (c === 0)      { kickCol1 = '#1a1410'; kickCol2 = '#281e18'; } // Sıcak koyu ahşap
    else if (c === 1) { kickCol1 = '#0e1620'; kickCol2 = '#162232'; } // Modern çelik grafit
    else if (c === 2) { kickCol1 = '#180e14'; kickCol2 = '#261420'; } // Bordo-maun bistro
    else              { kickCol1 = '#0e1814'; kickCol2 = '#16241e'; } // Koyu avcı yeşili

    dctx.fillStyle = kickCol1;
    dctx.fillRect(x0 + 12, kickY, w - 24, kickH);
    dctx.fillStyle = kickCol2;
    dctx.fillRect(x0 + 20, kickY + 8, w - 40, kickH - 16);

    // 4 Farklı Sinematik Vitrin Teması:
    // c=0: Sıcak Fırın & Kafe (Golden Warm Honey Amber)
    // c=1: Modern Butik & Tasarım Stüdyosu (Steel Cyan / Aqua)
    // c=2: Noir Kokteyl Bar & Lounge (Deep Ruby / Crimson Neon)
    // c=3: Vintage Kitabevi & Botanik Eczane (Emerald / Sage Green)
    let colorTop, colorMid, colorBot, emColorTop, emColorMid;
    if (c === 0) {
      colorTop = '#fed488'; colorMid = '#b86618'; colorBot = '#200c02';
      emColorTop = '#f8c26c'; emColorMid = '#9e4e10';
    } else if (c === 1) {
      colorTop = '#5ad4ea'; colorMid = '#166292'; colorBot = '#041624';
      emColorTop = '#46b8d4'; emColorMid = '#124870';
    } else if (c === 2) {
      colorTop = '#e26090'; colorMid = '#8e163e'; colorBot = '#22040c';
      emColorTop = '#c84a78'; emColorMid = '#6e0e2e';
    } else {
      colorTop = '#6cd8a4'; colorMid = '#18683e'; colorBot = '#041a0e';
      emColorTop = '#56be8c'; emColorMid = '#12502e';
    }

    // Ana vitrin camı iç mekan renk gradyanı
    const grad = dctx.createLinearGradient(x0, glassY, x0, glassY + glassH);
    grad.addColorStop(0.0, colorTop);
    grad.addColorStop(0.55, colorMid);
    grad.addColorStop(1.0, colorBot);
    dctx.fillStyle = grad;
    dctx.fillRect(x0 + 16, glassY, w - 32, glassH);

    const egrad = ectx.createLinearGradient(x0, glassY, x0, glassY + glassH);
    egrad.addColorStop(0.0, emColorTop);
    egrad.addColorStop(0.65, emColorMid);
    egrad.addColorStop(1.0, '#000000');
    ectx.fillStyle = egrad;
    ectx.fillRect(x0 + 16, glassY, w - 32, glassH);

    // Üst tepe penceresi (Transom)
    const tgrad = dctx.createLinearGradient(x0, transomY, x0, transomY + transomH);
    tgrad.addColorStop(0.0, colorTop);
    tgrad.addColorStop(1.0, colorMid);
    dctx.fillStyle = tgrad;
    dctx.fillRect(x0 + 16, transomY, w - 32, transomH);
    ectx.fillStyle = tgrad;
    ectx.fillRect(x0 + 16, transomY, w - 32, transomH);

    // Transom bölme çubukları
    dctx.fillStyle = '#06080e';
    ectx.fillStyle = '#000000';
    const transomDivs = (c === 1) ? 6 : (c === 2 ? 3 : 4);
    for (let d = 1; d < transomDivs; d++) {
      const tx = x0 + 16 + (d * (w - 32) / transomDivs);
      dctx.fillRect(tx - 3, transomY, 6, transomH);
      ectx.fillRect(tx - 3, transomY, 6, transomH);
    }

    // ── İÇ MEKAN SİLÜETLERİ (BUĞULU CAM & FLÛ DERİNLİK EFEKTİ) ─────────────
    dctx.filter = 'blur(4px)';
    ectx.filter = 'blur(4px)';

    if (c === 0) {
      // 🥐 C=0: FIRIN & KAFE — Pasta/Ekmek Teşhir Tezgâhı + Sıcak Sarkıt Lambalar
      const counterW = (w - 32) * 0.48;
      dctx.fillStyle = 'rgba(22, 14, 8, 0.85)';
      ectx.fillStyle = '#000000';
      dctx.fillRect(x0 + 24, glassY + glassH - 85, counterW, 85);
      ectx.fillRect(x0 + 24, glassY + glassH - 85, counterW, 85);

      // Raflar ve cam vitrin çizgisi
      dctx.fillStyle = '#3a2212';
      dctx.fillRect(x0 + 24, glassY + glassH - 87, counterW, 4);
      dctx.fillRect(x0 + 28, glassY + glassH - 52, counterW - 8, 3);
      ectx.fillRect(x0 + 24, glassY + glassH - 87, counterW, 4);

      // Raf üstü fırın ürünleri / sepet silüetleri
      dctx.fillStyle = 'rgba(18, 10, 4, 0.82)';
      ectx.fillStyle = '#000000';
      dctx.fillRect(x0 + 36, glassY + glassH - 74, 28, 20);
      dctx.fillRect(x0 + 72, glassY + glassH - 76, 32, 22);
      dctx.fillRect(x0 + 112, glassY + glassH - 72, 26, 18);
      dctx.fillRect(x0 + 146, glassY + glassH - 75, 30, 21);
      ectx.fillRect(x0 + 36, glassY + glassH - 74, 28, 20);
      ectx.fillRect(x0 + 72, glassY + glassH - 76, 32, 22);
      ectx.fillRect(x0 + 112, glassY + glassH - 72, 26, 18);
      ectx.fillRect(x0 + 146, glassY + glassH - 75, 30, 21);

      // Tavandan sarkan sıcak küre sarkıt lambalar
      for (let p = 0; p < 3; p++) {
        const lx = x0 + 45 + p * 60;
        const ly = glassY + 48;
        dctx.fillStyle = '#0a0604';
        dctx.fillRect(lx - 1, glassY, 2, 48);
        dctx.fillStyle = '#fff4c2';
        ectx.fillStyle = '#fff4c2';
        dctx.beginPath(); dctx.arc(lx, ly, 7, 0, Math.PI * 2); dctx.fill();
        ectx.beginPath(); ectx.arc(lx, ly, 7, 0, Math.PI * 2); ectx.fill();
      }

    } else if (c === 1) {
      // 💎 C=1: MODERN CAMGÖBEĞİ BUTİK — Podyum Teşhirleri + Dikey Neon Şeritler
      dctx.fillStyle = 'rgba(8, 18, 26, 0.82)';
      ectx.fillStyle = '#000000';
      dctx.fillRect(x0 + 40, glassY + glassH - 65, 75, 65);
      dctx.fillRect(x0 + w - 125, glassY + glassH - 85, 85, 85);
      ectx.fillRect(x0 + 40, glassY + glassH - 65, 75, 65);
      ectx.fillRect(x0 + w - 125, glassY + glassH - 85, 85, 85);

      // Kaideler üzerindeki heykelsi / butik ürün silüetleri
      dctx.fillStyle = 'rgba(4, 10, 16, 0.88)';
      ectx.fillStyle = '#000000';
      dctx.fillRect(x0 + 60, glassY + glassH - 120, 35, 55);
      dctx.fillRect(x0 + w - 105, glassY + glassH - 148, 45, 63);
      ectx.fillRect(x0 + 60, glassY + glassH - 120, 35, 55);
      ectx.fillRect(x0 + w - 105, glassY + glassH - 148, 45, 63);

      // Tavandan dikey asılı neon tüpler
      for (let n = 0; n < 4; n++) {
        const nx = x0 + 130 + n * 45;
        dctx.fillStyle = '#8ce8f4';
        ectx.fillStyle = '#8ce8f4';
        dctx.fillRect(nx, glassY + 12, 3, 95);
        ectx.fillRect(nx, glassY + 12, 3, 95);
      }

    } else if (c === 2) {
      // 🍸 C=2: NOIR BİSTRO & BAR — İçki Şişesi Rafları + Bar Tezgâhı & Tabureler
      const shelfY0 = glassY + 35;
      for (let s = 0; s < 3; s++) {
        const sy = shelfY0 + s * 45;
        dctx.fillStyle = '#1c0810';
        dctx.fillRect(x0 + 25, sy + 22, (w - 32) * 0.52, 4);
        ectx.fillRect(x0 + 25, sy + 22, (w - 32) * 0.52, 4);

        for (let b = 0; b < 7; b++) {
          const bx = x0 + 32 + b * 24;
          const bh = 14 + (b % 3) * 5;
          dctx.fillStyle = 'rgba(18, 4, 8, 0.88)';
          ectx.fillStyle = '#000000';
          dctx.fillRect(bx, sy + 22 - bh, 9, bh);
          ectx.fillRect(bx, sy + 22 - bh, 9, bh);
        }
      }

      // Masif bar tezgâhı (silüet)
      dctx.fillStyle = 'rgba(24, 6, 12, 0.86)';
      ectx.fillStyle = '#000000';
      dctx.fillRect(x0 + 20, glassY + glassH - 72, (w - 32) * 0.55, 72);
      ectx.fillRect(x0 + 20, glassY + glassH - 72, (w - 32) * 0.55, 72);

      // Yüksek bar tabureleri
      for (let st = 0; st < 3; st++) {
        const stX = x0 + 40 + st * 55;
        const stY = glassY + glassH - 58;
        dctx.fillStyle = 'rgba(14, 3, 6, 0.88)';
        ectx.fillStyle = '#000000';
        dctx.fillRect(stX - 11, stY, 22, 6);
        dctx.fillRect(stX - 2, stY + 6, 4, 52);
        ectx.fillRect(stX - 11, stY, 22, 6);
        ectx.fillRect(stX - 2, stY + 6, 4, 52);
      }

    } else {
      // 📚 C=3: VİNTAGE KİTABEVİ & BOTANİK — Yüksek Kitap Rafları + Sıcak Vitrin Masası
      const bookW = (w - 32) * 0.44;
      for (let kr = 0; kr < 4; kr++) {
        const ry = glassY + 30 + kr * 46;
        dctx.fillStyle = '#101a14';
        dctx.fillRect(x0 + 24, ry + 24, bookW, 4);
        ectx.fillRect(x0 + 24, ry + 24, bookW, 4);

        for (let bk = 0; bk < 8; bk++) {
          const bx = x0 + 28 + bk * 18;
          const bh = 18 + (bk % 4) * 3;
          dctx.fillStyle = 'rgba(6, 14, 10, 0.88)';
          ectx.fillStyle = '#000000';
          dctx.fillRect(bx, ry + 24 - bh, 14, bh);
          ectx.fillRect(bx, ry + 24 - bh, 14, bh);
        }
      }

      // Ön vitrin ahşap kitap masası / teşhir
      dctx.fillStyle = 'rgba(14, 24, 18, 0.86)';
      ectx.fillStyle = '#000000';
      dctx.fillRect(x0 + 20, glassY + glassH - 60, bookW + 10, 60);
      ectx.fillRect(x0 + 20, glassY + glassH - 60, bookW + 10, 60);

      // Tavandan sarkan antika lamba
      const alx = x0 + 80;
      const aly = glassY + 55;
      dctx.fillStyle = '#060c08';
      dctx.fillRect(alx - 1, glassY, 2, 55);
      dctx.fillStyle = '#a4f8d4';
      ectx.fillStyle = '#a4f8d4';
      dctx.beginPath(); dctx.arc(alx, aly, 8, 0, Math.PI * 2); dctx.fill();
      ectx.beginPath(); ectx.arc(alx, aly, 8, 0, Math.PI * 2); ectx.fill();
    }

    // Flû efekti sıfırla (Cam üstü doğrama ve yansımalar keskin çizilir)
    dctx.filter = 'none';
    ectx.filter = 'none';

    // ── CAM ÜSTÜ DETAYLAR: TENTE GÖLGESİ, CAM PARLAMALARI VE PENCERE DOĞRAMALARI ──
    // 1. Üst tente / saçak derinlik gölgesi
    const topShadow = dctx.createLinearGradient(x0, glassY, x0, glassY + 80);
    topShadow.addColorStop(0.0, 'rgba(4, 6, 12, 0.78)');
    topShadow.addColorStop(0.45, 'rgba(4, 6, 12, 0.35)');
    topShadow.addColorStop(1.0, 'rgba(4, 6, 12, 0.00)');
    dctx.fillStyle = topShadow;
    dctx.fillRect(x0 + 16, glassY, w - 32, 80);

    // 2. Vitrin camı yüzey yansıması (diyagonal ıslak gece sokak parlaması)
    const reflGrad = dctx.createLinearGradient(x0 + 16, glassY, x0 + w - 16, glassY + glassH);
    reflGrad.addColorStop(0.00, 'rgba(255, 255, 255, 0.00)');
    reflGrad.addColorStop(0.28, 'rgba(215, 235, 255, 0.00)');
    reflGrad.addColorStop(0.36, 'rgba(215, 235, 255, 0.14)');
    reflGrad.addColorStop(0.42, 'rgba(215, 235, 255, 0.02)');
    reflGrad.addColorStop(0.58, 'rgba(225, 240, 255, 0.00)');
    reflGrad.addColorStop(0.66, 'rgba(225, 240, 255, 0.11)');
    reflGrad.addColorStop(0.72, 'rgba(225, 240, 255, 0.00)');
    reflGrad.addColorStop(1.00, 'rgba(255, 255, 255, 0.00)');
    dctx.fillStyle = reflGrad;
    dctx.fillRect(x0 + 16, glassY, w - 32, glassH);

    // 3. Giriş kapıları (sağ taraf)
    if (c === 0) {
      const doorW = (w - 32) * 0.40;
      const doorX = x0 + w - 24 - doorW;
      dctx.fillStyle = '#140c06';
      ectx.fillStyle = '#000000';
      dctx.fillRect(doorX, glassY, doorW, glassH);
      ectx.fillRect(doorX, glassY, doorW, glassH);

      const dGrad = dctx.createLinearGradient(doorX, glassY + 16, doorX, glassY + glassH - 32);
      dGrad.addColorStop(0.0, 'rgba(255, 228, 160, 0.88)');
      dGrad.addColorStop(1.0, 'rgba(130, 65, 16, 0.82)');
      dctx.fillStyle = dGrad;
      dctx.fillRect(doorX + 10, glassY + 20, doorW - 20, glassH - 40);
      ectx.fillStyle = dGrad;
      ectx.fillRect(doorX + 10, glassY + 20, doorW - 20, glassH - 40);

      dctx.fillStyle = '#f0cc50';
      dctx.fillRect(doorX + 16, glassY + glassH * 0.48, 4, 34);
    } else if (c === 1) {
      const midX = x0 + w * 0.5;
      dctx.fillStyle = '#061018';
      ectx.fillStyle = '#000000';
      dctx.fillRect(midX - 3, glassY, 6, glassH);
      ectx.fillRect(midX - 3, glassY, 6, glassH);

      dctx.fillStyle = '#d0f0ff';
      dctx.fillRect(midX - 9, glassY + glassH * 0.44, 3, 50);
    } else if (c === 2) {
      const doorW = (w - 32) * 0.38;
      const doorX = x0 + w - 20 - doorW;
      dctx.fillStyle = '#14040a';
      ectx.fillStyle = '#000000';
      dctx.fillRect(doorX, glassY, doorW, glassH);
      ectx.fillRect(doorX, glassY, doorW, glassH);

      const dGrad2 = dctx.createLinearGradient(doorX, glassY + 20, doorX, glassY + glassH - 30);
      dGrad2.addColorStop(0.0, 'rgba(235, 120, 160, 0.85)');
      dGrad2.addColorStop(1.0, 'rgba(100, 16, 42, 0.80)');
      dctx.fillStyle = dGrad2;
      dctx.fillRect(doorX + 8, glassY + 24, doorW - 16, glassH - 48);
      ectx.fillStyle = dGrad2;
      ectx.fillRect(doorX + 8, glassY + 24, doorW - 16, glassH - 48);

      dctx.fillStyle = '#0a0205';
      ectx.fillStyle = '#000000';
      dctx.fillRect(doorX + doorW * 0.5 - 2, glassY, 4, glassH);
      ectx.fillRect(doorX + doorW * 0.5 - 2, glassY, 4, glassH);
    } else {
      const doorW = (w - 32) * 0.42;
      const doorX = x0 + w - 22 - doorW;
      dctx.fillStyle = '#0c1610';
      ectx.fillStyle = '#000000';
      dctx.fillRect(doorX, glassY, doorW, glassH);
      ectx.fillRect(doorX, glassY, doorW, glassH);

      const dGrad3 = dctx.createLinearGradient(doorX, glassY + 20, doorX, glassY + glassH - 30);
      dGrad3.addColorStop(0.0, 'rgba(160, 240, 200, 0.88)');
      dGrad3.addColorStop(1.0, 'rgba(24, 95, 60, 0.82)');
      dctx.fillStyle = dGrad3;
      dctx.fillRect(doorX + 10, glassY + 24, doorW - 20, glassH - 48);
      ectx.fillStyle = dGrad3;
      ectx.fillRect(doorX + 10, glassY + 24, doorW - 20, glassH - 48);

      dctx.fillStyle = '#d4aa50';
      dctx.fillRect(doorX + 16, glassY + glassH * 0.50, 5, 26);
    }

    // 4. İnce Vitrin Doğramaları (Muntins / Mullions) — Fiziksel Cam Bölme Çizgileri
    const midY = glassY + glassH * 0.44;
    dctx.fillStyle = '#080a10';
    dctx.fillRect(x0 + 16, midY - 3, w - 32, 6);
    dctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    dctx.fillRect(x0 + 16, midY - 3, w - 32, 1);
    dctx.fillStyle = 'rgba(0, 0, 0, 0.70)';
    dctx.fillRect(x0 + 16, midY + 3, w - 32, 1);

    const vMullion1 = x0 + 16 + (w - 32) * 0.35;
    const vMullion2 = x0 + 16 + (w - 32) * 0.65;
    for (const vx of [vMullion1, vMullion2]) {
      dctx.fillStyle = '#080a10';
      dctx.fillRect(vx - 2, glassY, 4, glassH);
      dctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
      dctx.fillRect(vx - 2, glassY, 1, glassH);
      dctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
      dctx.fillRect(vx + 2, glassY, 1, glassH);
    }

    // Vitrin dış ahşap / metal çerçeve kenarları
    dctx.fillStyle = '#06080c';
    dctx.fillRect(x0, y0, w, 8);
    dctx.fillRect(x0, y0 + h - 8, w, 8);
    dctx.fillRect(x0, y0, 8, h);
    dctx.fillRect(x0 + w - 8, y0, 8, h);
    dctx.fillRect(x0, glassY - 4, w, 8);
  }

  // ── ROW 1, 2, 3: ÜST KAT PENCERELERİ (UPPER WINDOWS) ───────────────────
  for (let r = 1; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const x0 = c * CELL;
      const y0 = r * CELL;
      const w = CELL;
      const h = CELL;

      dctx.fillStyle = '#090c12';
      dctx.fillRect(x0, y0, w, h);

      const padX = 28;
      const padY = 24;
      const gw = w - padX * 2;
      const gh = h - padY * 2;
      const gx = x0 + padX;
      const gy = y0 + padY;

      const isWarmLit = (r === 1);
      const isCoolLit = (r === 2);

      if (isWarmLit || isCoolLit) {
        let colTop, colBot;
        if (isWarmLit) {
          if (c === 0)      { colTop = '#ffe498'; colBot = '#d4882c'; }
          else if (c === 1) { colTop = '#ffcf7c'; colBot = '#c87622'; }
          else if (c === 2) { colTop = '#ffdca2'; colBot = '#ba7224'; }
          else              { colTop = '#ffb858'; colBot = '#a85012'; }
        } else {
          if (c === 0)      { colTop = '#e0f0ff'; colBot = '#9ec4e0'; }
          else if (c === 1) { colTop = '#f8e8b8'; colBot = '#90703c'; }
          else if (c === 2) { colTop = '#ffd884'; colBot = '#b4681c'; }
          else              { colTop = '#d0e4f2'; colBot = '#789cb4'; }
        }

        const pGrad = dctx.createLinearGradient(gx, gy, gx, gy + gh);
        pGrad.addColorStop(0.0, colTop);
        pGrad.addColorStop(0.65, colBot);
        pGrad.addColorStop(1.0, '#2e1a0a');
        dctx.fillStyle = pGrad;
        dctx.fillRect(gx, gy, gw, gh);

        const epGrad = ectx.createLinearGradient(gx, gy, gx, gy + gh);
        epGrad.addColorStop(0.0, colTop);
        epGrad.addColorStop(0.70, colBot);
        epGrad.addColorStop(1.0, '#1a0e04');
        ectx.fillStyle = epGrad;
        ectx.fillRect(gx, gy, gw, gh);

        if ((isWarmLit && c === 1) || (isCoolLit && c === 2)) {
          const blindLimit = (c === 1) ? (gh * 0.58) : gh;
          dctx.fillStyle = 'rgba(20, 16, 12, 0.72)';
          ectx.fillStyle = 'rgba(0, 0, 0, 0.78)';
          for (let by = gy + 8; by < gy + blindLimit; by += 14) {
            dctx.fillRect(gx, by, gw, 6);
            ectx.fillRect(gx, by, gw, 6);
          }
        } else if (isWarmLit && c === 2) {
          const curtainW = gw * 0.24;
          dctx.fillStyle = '#1c0f14';
          ectx.fillStyle = '#000000';
          dctx.beginPath();
          dctx.moveTo(gx, gy);
          dctx.quadraticCurveTo(gx + curtainW * 1.3, gy + gh * 0.5, gx + curtainW * 0.5, gy + gh);
          dctx.lineTo(gx, gy + gh);
          dctx.closePath();
          dctx.fill();
          ectx.fill();

          dctx.beginPath();
          dctx.moveTo(gx + gw, gy);
          dctx.quadraticCurveTo(gx + gw - curtainW * 1.3, gy + gh * 0.5, gx + gw - curtainW * 0.5, gy + gh);
          dctx.lineTo(gx + gw, gy + gh);
          dctx.closePath();
          dctx.fill();
          ectx.fill();
        } else if (isWarmLit && c === 3) {
          dctx.fillStyle = '#16100a';
          ectx.fillStyle = '#000000';
          dctx.beginPath();
          dctx.arc(gx + gw * 0.72, gy + gh * 0.65, 28, 0, Math.PI * 2);
          dctx.fill();
          dctx.fillRect(gx + gw * 0.70, gy + gh * 0.65, 12, gh * 0.35);
          ectx.beginPath();
          ectx.arc(gx + gw * 0.72, gy + gh * 0.65, 28, 0, Math.PI * 2);
          ectx.fill();
          ectx.fillRect(gx + gw * 0.70, gy + gh * 0.65, 12, gh * 0.35);
        }

        const isSixPane = (c === 2);
        dctx.fillStyle = '#0a0d14';
        ectx.fillStyle = '#000000';

        const barH = 12;
        dctx.fillRect(gx, gy + gh * 0.44 - barH * 0.5, gw, barH);
        ectx.fillRect(gx, gy + gh * 0.44 - barH * 0.5, gw, barH);

        const barW = 10;
        if (!isSixPane) {
          dctx.fillRect(gx + gw * 0.5 - barW * 0.5, gy, barW, gh);
          ectx.fillRect(gx + gw * 0.5 - barW * 0.5, gy, barW, gh);
        } else {
          dctx.fillRect(gx + gw * 0.33 - barW * 0.5, gy, barW, gh);
          dctx.fillRect(gx + gw * 0.67 - barW * 0.5, gy, barW, gh);
          ectx.fillRect(gx + gw * 0.33 - barW * 0.5, gy, barW, gh);
          ectx.fillRect(gx + gw * 0.67 - barW * 0.5, gy, barW, gh);
        }
      } else {
        const darkGrad = dctx.createLinearGradient(gx, gy, gx, gy + gh);
        let roomEmissive = '#000000';
        if (c === 0) {
          // Loş gece mavisi iç mekan ışığı (TV / gece lambası)
          darkGrad.addColorStop(0.0, '#1c283e');
          darkGrad.addColorStop(1.0, '#0a101c');
          roomEmissive = '#141e2e';
        } else if (c === 1) {
          // Tamamen kapalı panjurlu oda
          darkGrad.addColorStop(0.0, '#10141e');
          darkGrad.addColorStop(1.0, '#06080e');
          roomEmissive = '#000000';
        } else if (c === 2) {
          // Loş amber / gece abajuru
          darkGrad.addColorStop(0.0, '#2e2014');
          darkGrad.addColorStop(1.0, '#0e0804');
          roomEmissive = '#22140a';
        } else {
          // Derin gece / uyuyan oda
          darkGrad.addColorStop(0.0, '#0e121a');
          darkGrad.addColorStop(1.0, '#05070c');
          roomEmissive = '#06090e';
        }

        dctx.fillStyle = darkGrad;
        dctx.fillRect(gx, gy, gw, gh);

        ectx.fillStyle = roomEmissive;
        ectx.fillRect(gx, gy, gw, gh);

        dctx.fillStyle = '#06080c';
        dctx.fillRect(gx, gy + gh * 0.44 - 4, gw, 8);
        dctx.fillRect(gx + gw * 0.5 - 4, gy, 8, gh);

        if (c === 1) {
          dctx.fillStyle = 'rgba(4, 6, 10, 0.65)';
          for (let by = gy + 8; by < gy + gh; by += 16) {
            dctx.fillRect(gx, by, gw, 6);
          }
        }
      }

      dctx.fillStyle = '#06080c';
      dctx.fillRect(x0, y0, w, 8);
      dctx.fillRect(x0, y0 + h - 8, w, 8);
      dctx.fillRect(x0, y0, 8, h);
      dctx.fillRect(x0 + w - 8, y0, 8, h);
    }
  }

  const diffuseTex = new THREE.CanvasTexture(diffCanvas);
  diffuseTex.anisotropy = maxAniso;
  diffuseTex.generateMipmaps = true;
  diffuseTex.minFilter = THREE.LinearMipmapLinearFilter;
  diffuseTex.magFilter = THREE.LinearFilter;
  diffuseTex.needsUpdate = true;

  const emissiveTex = new THREE.CanvasTexture(emCanvas);
  emissiveTex.anisotropy = maxAniso;
  emissiveTex.generateMipmaps = true;
  emissiveTex.minFilter = THREE.LinearMipmapLinearFilter;
  emissiveTex.magFilter = THREE.LinearFilter;
  emissiveTex.needsUpdate = true;

  return { diffuseTex, emissiveTex };
}

// ══════════════════════════════════════════════════════════════════════════════
// [D] GEOMETRY UTILITIES — UV Manipülasyon ve Prosedürel Bina Dilimleri
// ══════════════════════════════════════════════════════════════════════════════

function _scaleUVs(geom, scaleX, scaleY) {
  const uvs = geom.attributes.uv;
  if (!uvs) return;
  for (let i = 0; i < uvs.count; i++) {
    uvs.setXY(i, uvs.getX(i) * scaleX, uvs.getY(i) * scaleY);
  }
  uvs.needsUpdate = true;
}

function _remapUVs(geom, u0, v0, u1, v1) {
  const uvs = geom.attributes.uv;
  if (!uvs) return;
  const du = u1 - u0;
  const dv = v1 - v0;
  for (let i = 0; i < uvs.count; i++) {
    const u = uvs.getX(i);
    const v = uvs.getY(i);
    uvs.setXY(i, u0 + u * du, v0 + v * dv);
  }
  uvs.needsUpdate = true;
}

function _createStorefrontSlice() {
  const wallGeos = [];
  const glassGeos = [];

  const colL = new THREE.BoxGeometry(0.3, 4.0, 0.4); colL.translate(-1.35, 2.0, 0.2); _scaleUVs(colL, 0.3 / 3.0, 4.0 / 4.0); wallGeos.push(colL);
  const colR = new THREE.BoxGeometry(0.3, 4.0, 0.4); colR.translate( 1.35, 2.0, 0.2); _scaleUVs(colR, 0.3 / 3.0, 4.0 / 4.0); wallGeos.push(colR);
  const lintel = new THREE.BoxGeometry(3.0, 0.4, 0.45); lintel.translate(0, 3.8, 0.22); _scaleUVs(lintel, 3.0 / 3.0, 0.4 / 4.0); wallGeos.push(lintel);
  const plinth = new THREE.BoxGeometry(3.0, 0.3, 0.35); plinth.translate(0, 0.15, 0.17); _scaleUVs(plinth, 3.0 / 3.0, 0.3 / 4.0); wallGeos.push(plinth);

  const transomBar = new THREE.BoxGeometry(2.4, 0.10, 0.25); transomBar.translate(0, 3.0, 0.12); _scaleUVs(transomBar, 2.4 / 3.0, 0.10 / 4.0); wallGeos.push(transomBar);

  const glass = new THREE.PlaneGeometry(2.4, 3.3);
  glass.translate(0, 1.95, 0.20);
  glassGeos.push(glass);

  return { wallGeos, glassGeos };
}

function _createWindowSlice() {
  const wallGeos = [];
  const glassGeos = [];

  const colL = new THREE.BoxGeometry(0.65, 4.0, 0.35); colL.translate(-1.175, 2.0, 0.175); _scaleUVs(colL, 0.65 / 3.0, 4.0 / 4.0); wallGeos.push(colL);
  const colR = new THREE.BoxGeometry(0.65, 4.0, 0.35); colR.translate( 1.175, 2.0, 0.175); _scaleUVs(colR, 0.65 / 3.0, 4.0 / 4.0); wallGeos.push(colR);
  const lintel = new THREE.BoxGeometry(3.0, 0.75, 0.40); lintel.translate(0, 3.625, 0.20); _scaleUVs(lintel, 3.0 / 3.0, 0.75 / 4.0); wallGeos.push(lintel);
  const sill = new THREE.BoxGeometry(1.85, 0.16, 0.46); sill.translate(0, 0.92, 0.23); _scaleUVs(sill, 1.85 / 3.0, 0.16 / 4.0); wallGeos.push(sill);
  const spandrel = new THREE.BoxGeometry(3.0, 0.92, 0.35); spandrel.translate(0, 0.46, 0.175); _scaleUVs(spandrel, 3.0 / 3.0, 0.92 / 4.0); wallGeos.push(spandrel);

  const glass = new THREE.PlaneGeometry(1.7, 2.5);
  glass.translate(0, 2.25, 0.16);
  glassGeos.push(glass);

  return { wallGeos, glassGeos };
}

// ══════════════════════════════════════════════════════════════════════════════
// [E] BUILDING ARCHETYPES — Modüler Cephe Dilimleri ve 48 Bina Yerleşimi
// ══════════════════════════════════════════════════════════════════════════════

function _buildArchetype(slicesWide, floors) {
  const allWall = [];
  const allGlass = [];
  const w = slicesWide * 3.0;
  const h = floors * 4.0;
  const d = 16.0;

  for (let x = 0; x < slicesWide; x++) {
    const xOffset = (x - slicesWide / 2 + 0.5) * 3.0;
    for (let y = 0; y < floors; y++) {
      const yOffset = y * 4.0;
      const sliceObj = (y === 0) ? _createStorefrontSlice() : _createWindowSlice();

      const glassGeo = sliceObj.glassGeos[0];
      if (y === 0) {
        const c = x % 4;
        const r = 0;
        _remapUVs(glassGeo, c / 4.0, (3 - r) / 4.0, (c + 1) / 4.0, (4 - r) / 4.0);
      } else {
        const rand = _hash(x * 7919 + y * 6271 + slicesWide * 997 + floors * 131);
        let r, c;
        if (rand < 0.48) {
          r = 1;
          c = ((rand / 0.48) * 4) | 0;
        } else if (rand < 0.65) {
          r = 2;
          c = (((rand - 0.48) / 0.17) * 4) | 0;
        } else {
          r = 3;
          c = (((rand - 0.65) / 0.35) * 4) | 0;
        }
        c = Math.max(0, Math.min(3, c));
        _remapUVs(glassGeo, c / 4.0, (3 - r) / 4.0, (c + 1) / 4.0, (4 - r) / 4.0);
      }

      sliceObj.wallGeos.forEach(g => { 
        const c = g.clone(); c.translate(xOffset, yOffset, d / 2); allWall.push(c); 
      });
      sliceObj.glassGeos.forEach(g => { 
        const c = g.clone(); c.translate(xOffset, yOffset, d / 2); allGlass.push(c); 
      });
    }
  }

  const backWall = new THREE.BoxGeometry(w, h, 0.4); backWall.translate(0, h/2, -d/2);
  const leftSide = new THREE.BoxGeometry(0.4, h, d); leftSide.translate(-w/2, h/2, 0);
  const rightSide = new THREE.BoxGeometry(0.4, h, d); rightSide.translate(w/2, h/2, 0);
  const roof = new THREE.BoxGeometry(w, 0.4, d); roof.translate(0, h, 0);
  
  _scaleUVs(backWall, w / 3.0, h / 4.0);
  _scaleUVs(leftSide, d / 3.0, h / 4.0);
  _scaleUVs(rightSide, d / 3.0, h / 4.0);
  _scaleUVs(roof, w / 3.0, d / 3.0);
  
  allWall.push(backWall, leftSide, rightSide, roof);

  try {
    const mergedWall = allWall.length > 0 ? BufferGeometryUtils.mergeGeometries(allWall, false) : new THREE.BufferGeometry();
    const mergedGlass = allGlass.length > 0 ? BufferGeometryUtils.mergeGeometries(allGlass, false) : new THREE.BufferGeometry();
    
    if (!mergedWall || !mergedGlass) throw new Error("mergeGeometries returned null");
    
    return BufferGeometryUtils.mergeGeometries([mergedWall, mergedGlass], true);
  } catch (err) {
    console.error("Building Archetype Geometry Generation Error:", err);
    const fallbackWall = new THREE.BoxGeometry(w, h, d);
    const fallbackGlass = new THREE.BoxGeometry(w*0.9, h*0.9, d*1.05);
    return BufferGeometryUtils.mergeGeometries([fallbackWall, fallbackGlass], true);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════════════════════════════════════

export function buildBuildings(parentGroup, renderer) {
  const maxAniso = (renderer && renderer.capabilities && typeof renderer.capabilities.getMaxAnisotropy === 'function')
    ? Math.min(16, renderer.capabilities.getMaxAnisotropy())
    : 16;

  const wallTexLeft  = _createWallTexture(42, maxAniso);
  const wallTexRight = _createWallTexture(137, maxAniso);
  const { diffuseTex: winDiffuseTex, emissiveTex: winEmissiveTex } = _createWindowAtlas(maxAniso);

  const matLeft = new THREE.MeshStandardMaterial({
    color:             0x222838,
    map:               wallTexLeft,
    roughness:         0.68,
    metalness:         0.20,
    emissive:          new THREE.Color(0x0d1320),
    emissiveIntensity: 0.25,
  });

  const matRight = new THREE.MeshStandardMaterial({
    color:             0x222838,
    map:               wallTexRight,
    roughness:         0.68,
    metalness:         0.20,
    emissive:          new THREE.Color(0x0d1320),
    emissiveIntensity: 0.25,
  });

  const matGlass = new THREE.MeshStandardMaterial({
    color:             0xffffff,
    map:               winDiffuseTex,
    emissiveMap:       winEmissiveTex,
    emissive:          new THREE.Color(1.0, 1.0, 1.0),
    emissiveIntensity: 0.72,
    roughness:         0.10,
    metalness:         0.85,
  });

  let geoA, geoB, geoC;
  try {
    geoA = _buildArchetype(6, 4); // 18m, 16m (Neo-Klasik)
    geoB = _buildArchetype(8, 6); // 24m, 24m (Modern)
    geoC = _buildArchetype(10, 8); // 30m, 32m (Geleneksel)
  } catch (err) {
    console.error("Failed to build one or more archetypes:", err);
    const fb = new THREE.BoxGeometry(10, 10, 10);
    geoA = geoA || fb; geoB = geoB || fb; geoC = geoC || fb;
  }

  _meshLeft  = new THREE.InstancedMesh(geoA, [matLeft, matGlass], BUILDINGS_PER_SIDE * 2);
  _meshRight = new THREE.InstancedMesh(geoB, [matRight, matGlass], BUILDINGS_PER_SIDE * 2);
  _meshC     = new THREE.InstancedMesh(geoC, [matLeft, matGlass], BUILDINGS_PER_SIDE * 2);

  _meshLeft.name  = 'buildings_typeA';
  _meshRight.name = 'buildings_typeB';
  _meshC.name     = 'buildings_typeC';
  
  _meshLeft.castShadow = true; _meshRight.castShadow = true; _meshC.castShadow = true;
  _meshLeft.receiveShadow = true; _meshRight.receiveShadow = true; _meshC.receiveShadow = true;

  parentGroup.add(_meshLeft, _meshRight, _meshC);
  
  _buildingData.length = 0;

  let idxA = 0, idxB = 0, idxC = 0;
  let totalLengthLeft = 0;
  let totalLengthRight = 0;

  function _placeBuildings(sideIndex) {
    const isRight = sideIndex === 1;
    const facadeLine = isRight ? BUILDING_LINE_RIGHT : BUILDING_LINE_LEFT;
    let currentZ = -45.0;

    for (let i = 0; i < BUILDINGS_PER_SIDE; i++) {
      const gi = sideIndex * BUILDINGS_PER_SIDE + i;
      const isAlley = (i === 2 || i === 7 || i === 14);
      if (isAlley) currentZ += 9.0;

      const r = _seed(gi, 1);
      let slicesWide = 6, floors = 4, mesh, idx;
      if (r > 0.66) { slicesWide = 10; floors = 8; mesh = _meshC; idx = idxC++; }
      else if (r > 0.33) { slicesWide = 8; floors = 6; mesh = _meshRight; idx = idxB++; }
      else { slicesWide = 6; floors = 4; mesh = _meshLeft; idx = idxA++; }

      const streetFrontage = slicesWide * 3.0;
      const depthIntoCity = 16.0;
      const h = floors * 4.0;

      const z = currentZ + streetFrontage / 2;
      currentZ += streetFrontage + 1.2;

      const x = isRight ? (facadeLine - depthIntoCity / 2) : (facadeLine + depthIntoCity / 2);
      const yaw = isRight ? (Math.PI / 2) : (-Math.PI / 2);

      _euler.set(0, yaw, 0);
      _quat.setFromEuler(_euler);
      _scale.set(1, 1, 1);
      _pos.set(x, 0, z);

      _m4.compose(_pos, _quat, _scale);
      mesh.setMatrixAt(idx, _m4);

      const colVariant = _seed(gi, 6);
      if (colVariant < 0.35) _col.setHex(0x0c0f16);
      else if (colVariant < 0.70) _col.setHex(0x12141c);
      else _col.setHex(0x16171f);
      mesh.setColorAt(idx, _col);

      _buildingData.push({
        sideIndex, isRight, facadeLine,
        w: depthIntoCity, h, d: streetFrontage,
        x, y: h / 2, z, gi, isAlley,
        mesh, meshIdx: idx, yaw,
        quat: _quat.clone(),
        downspoutScaleY: Math.min(1.2, Math.max(0.75, h / 34.0)),
        corniceIdx: -1,
        downspoutIdx: -1,
        portalIdx: -1,
        roofIdx: -1,
        furnIdx: -1,
        wrapLength: 0,
      });
    }

    if (isRight) {
      totalLengthRight = currentZ - (-45.0);
    } else {
      totalLengthLeft = currentZ - (-45.0);
    }
  }

  _placeBuildings(0);
  _placeBuildings(1);

  for (let bi = 0; bi < _buildingData.length; bi++) {
    const b = _buildingData[bi];
    b.wrapLength = b.isRight ? totalLengthRight : totalLengthLeft;
  }

  _meshLeft.count = idxA;
  _meshRight.count = idxB;
  _meshC.count = idxC;

  _meshLeft.instanceMatrix.needsUpdate = true;  if (_meshLeft.instanceColor)  _meshLeft.instanceColor.needsUpdate = true;
  _meshRight.instanceMatrix.needsUpdate = true; if (_meshRight.instanceColor) _meshRight.instanceColor.needsUpdate = true;
  _meshC.instanceMatrix.needsUpdate = true;     if (_meshC.instanceColor)     _meshC.instanceColor.needsUpdate = true;
  
  _meshLeft.computeBoundingSphere();
  _meshRight.computeBoundingSphere();
  _meshC.computeBoundingSphere();

  // Faz 9: Lightning Event Subscription
  subscribeLightning(setBuildingLightningFactor);

  return _buildingData;
}

export function updateBuildings(driftZ) {
  let needsLeftUpdate = false;
  let needsRightUpdate = false;
  let needsCUpdate = false;

  for (let bi = 0; bi < _buildingData.length; bi++) {
    const b = _buildingData[bi];
    b.z -= driftZ;
    if (b.z < -45.0) {
      b.z += b.wrapLength;
    }

    // Bina Gövdesi
    _pos.set(b.x, 0, b.z);
    _scale.set(1, 1, 1);
    _m4.compose(_pos, b.quat, _scale);
    b.mesh.setMatrixAt(b.meshIdx, _m4);
    if (b.mesh === _meshLeft) needsLeftUpdate = true;
    else if (b.mesh === _meshRight) needsRightUpdate = true;
    else if (b.mesh === _meshC) needsCUpdate = true;
  }

  if (needsLeftUpdate && _meshLeft) _meshLeft.instanceMatrix.needsUpdate = true;
  if (needsRightUpdate && _meshRight) _meshRight.instanceMatrix.needsUpdate = true;
  if (needsCUpdate && _meshC) _meshC.instanceMatrix.needsUpdate = true;
}

export function setBuildingLightningFactor(factor) {
  const intensity = 0.72 + factor * 1.10; // 0.72 -> 1.82 (doğal şimşek parlaması)
  const setIntensity = (mesh) => {
    if (mesh && mesh.material) {
      if (Array.isArray(mesh.material)) {
        mesh.material[1].emissiveIntensity = intensity; // 1 is glass
      } else {
        mesh.material.emissiveIntensity = intensity;
      }
    }
  };
  setIntensity(_meshLeft);
  setIntensity(_meshRight);
  setIntensity(_meshC);
}

export function getBuildingData() {
  return _buildingData;
}

export function getBuildingMeshes() {
  return { meshLeft: _meshLeft, meshRight: _meshRight, meshC: _meshC };
}
