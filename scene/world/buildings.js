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

  // ── ROW 0: ZEMİN KAT VİTRİNLERİ (STOREFRONTS) ──────────────────────────
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

    dctx.fillStyle = '#10141e';
    dctx.fillRect(x0 + 12, kickY, w - 24, kickH);
    dctx.fillStyle = '#1c2230';
    dctx.fillRect(x0 + 20, kickY + 8, w - 40, kickH - 16);

    let warmColorStart, warmColorEnd;
    if (c === 0) {
      warmColorStart = '#ffe292'; warmColorEnd = '#b46418';
    } else if (c === 1) {
      warmColorStart = '#ffcb64'; warmColorEnd = '#c25812';
    } else if (c === 2) {
      warmColorStart = '#ffdda0'; warmColorEnd = '#9a5010';
    } else {
      warmColorStart = '#ffd688'; warmColorEnd = '#9c5a1a';
    }

    const grad = dctx.createLinearGradient(x0, glassY, x0, glassY + glassH);
    grad.addColorStop(0.0, warmColorStart);
    grad.addColorStop(0.55, warmColorEnd);
    grad.addColorStop(1.0, '#281406');

    dctx.fillStyle = grad;
    dctx.fillRect(x0 + 16, glassY, w - 32, glassH);

    const egrad = ectx.createLinearGradient(x0, glassY, x0, glassY + glassH);
    egrad.addColorStop(0.0, warmColorStart);
    egrad.addColorStop(0.65, warmColorEnd);
    egrad.addColorStop(1.0, '#180802');
    ectx.fillStyle = egrad;
    ectx.fillRect(x0 + 16, glassY, w - 32, glassH);

    const tgrad = dctx.createLinearGradient(x0, transomY, x0, transomY + transomH);
    tgrad.addColorStop(0.0, warmColorStart);
    tgrad.addColorStop(1.0, warmColorEnd);
    dctx.fillStyle = tgrad;
    dctx.fillRect(x0 + 16, transomY, w - 32, transomH);
    ectx.fillStyle = tgrad;
    ectx.fillRect(x0 + 16, transomY, w - 32, transomH);

    dctx.fillStyle = '#06080e';
    ectx.fillStyle = '#000000';
    const transomDivs = 4;
    for (let d = 1; d < transomDivs; d++) {
      const tx = x0 + 16 + (d * (w - 32) / transomDivs);
      dctx.fillRect(tx - 3, transomY, 6, transomH);
      ectx.fillRect(tx - 3, transomY, 6, transomH);
    }

    if (c === 0 || c === 3) {
      const doorW = (w - 32) * 0.46;
      const doorX = x0 + (w - doorW) * 0.5;
      dctx.fillStyle = '#080a10';
      ectx.fillStyle = '#000000';
      dctx.fillRect(doorX, glassY, doorW, glassH);
      ectx.fillRect(doorX, glassY, doorW, glassH);

      const dInGrad = dctx.createLinearGradient(doorX, glassY + 20, doorX, glassY + glassH - 40);
      dInGrad.addColorStop(0.0, 'rgba(255, 230, 160, 0.88)');
      dInGrad.addColorStop(1.0, 'rgba(120, 60, 20, 0.82)');
      dctx.fillStyle = dInGrad;
      dctx.fillRect(doorX + 12, glassY + 24, doorW - 24, glassH - 48);
      ectx.fillStyle = dInGrad;
      ectx.fillRect(doorX + 12, glassY + 24, doorW - 24, glassH - 48);

      dctx.fillStyle = '#08090e';
      ectx.fillStyle = '#000000';
      dctx.fillRect(doorX + doorW * 0.5 - 2, glassY + 20, 4, glassH - 40);
      ectx.fillRect(doorX + doorW * 0.5 - 2, glassY + 20, 4, glassH - 40);

      dctx.fillStyle = '#e6be44';
      dctx.fillRect(doorX + doorW * 0.5 - 8, glassY + glassH * 0.52, 4, 32);
      dctx.fillRect(doorX + doorW * 0.5 + 4, glassY + glassH * 0.52, 4, 32);
    } else {
      const midX = x0 + w * 0.5;
      dctx.fillStyle = '#080a10';
      ectx.fillStyle = '#000000';
      dctx.fillRect(midX - 3, glassY, 6, glassH);
      ectx.fillRect(midX - 3, glassY, 6, glassH);

      dctx.fillStyle = '#100a06';
      ectx.fillStyle = '#000000';
      dctx.fillRect(x0 + 30, glassY + glassH - 72, (w - 32) * 0.40, 72);
      dctx.fillRect(x0 + w * 0.5 + 20, glassY + glassH - 88, (w - 32) * 0.38, 88);
      ectx.fillRect(x0 + 30, glassY + glassH - 72, (w - 32) * 0.40, 72);
      ectx.fillRect(x0 + w * 0.5 + 20, glassY + glassH - 88, (w - 32) * 0.38, 88);
    }

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
        if (c === 0) {
          darkGrad.addColorStop(0.0, '#0f1422');
          darkGrad.addColorStop(1.0, '#06080e');
        } else if (c === 1) {
          darkGrad.addColorStop(0.0, '#0c1018');
          darkGrad.addColorStop(1.0, '#04060a');
        } else {
          darkGrad.addColorStop(0.0, '#0a0d14');
          darkGrad.addColorStop(1.0, '#05070c');
        }

        dctx.fillStyle = darkGrad;
        dctx.fillRect(gx, gy, gw, gh);

        ectx.fillStyle = '#000000';
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
    color:             0x181c26,
    map:               wallTexLeft,
    roughness:         0.75,
    metalness:         0.15,
  });

  const matRight = new THREE.MeshStandardMaterial({
    color:             0x181c26,
    map:               wallTexRight,
    roughness:         0.75,
    metalness:         0.15,
  });

  const matGlass = new THREE.MeshStandardMaterial({
    color:             0xffffff,
    map:               winDiffuseTex,
    emissiveMap:       winEmissiveTex,
    emissive:          new THREE.Color(1.0, 1.0, 1.0),
    emissiveIntensity: 0.65,
    roughness:         0.12,
    metalness:         0.80,
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
  globalThis._buildingData = _buildingData;

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
  const intensity = 0.28 + factor * 1.32; // 0.28 -> 1.60
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
