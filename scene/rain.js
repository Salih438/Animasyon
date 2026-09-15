/**
 * scene/rain.js — Phase 9 Revision: Cinematic Needle Rain System & Deflection
 *
 * Sorumluluklar:
 *   - 1200 ince, sinematik yağmur çizgisi (THREE.Points + BufferGeometry)
 *   - Dev mavi toplar tamamen kaldırıldı; yerine jilet inceliğinde yarı saydam (0xddeeff, size: 0.10)
 *     dikey iğne damlaları (streak) oluşturuldu.
 *   - Yüksek düşüş hızı (34 - 48 m/s) ile havada asılı kalma hissi yok edildi; hızlı gerçekçi fırtına.
 *   - Dinamik şemsiye konisi saptırma fiziği (Deflection Physics):
 *       * Damlalar şemsiyeye çarptığında radyal olarak dışarı sıçrar ve eteklerden kaskat süzülür.
 *   - ZERO ALLOCATION: updateRain içinde kesinlikle new THREE.* veya yeni dizi YOK.
 */

import * as THREE from 'three';
import { getUmbrellaCollider } from './walker.js';

// ══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION CONSTANTS
// ══════════════════════════════════════════════════════════════════════════════

export const RAIN_COUNT = 1200; // İnce parçacıklarla zengin ve akıcı gece yağmuru

// Bounding Box sınırları (Kamera Z=-4.8 ve Walker Z=0 etrafında odaklı)
const BOX_X_MIN = -16.0;
const BOX_X_MAX =  16.0;
const BOX_X_SPAN = BOX_X_MAX - BOX_X_MIN; // 32.0

const BOX_Y_MIN =   0.0;
const BOX_Y_MAX =  18.0;
const RESPAWN_Y_MIN = 16.0;
const RESPAWN_Y_MAX = 18.0;

const BOX_Z_MIN = -10.0;
const BOX_Z_MAX =  45.0;
const BOX_Z_SPAN = BOX_Z_MAX - BOX_Z_MIN; // 55.0

// Düşüş hızı parametreleri (unit/s — hızlı dikey akış)
const SPEED_Y_MIN = 34.0;
const SPEED_Y_MAX = 48.0;

// Rüzgar sürüklenmesi (Wind Drift — hafif doğal fırtına eğimi)
const WIND_X = -2.6;
const WIND_Z = -0.8;

// Kaldırım sınırı (ground.js kaldırım seviyesi)
const SIDEWALK_X_INNER = 2.4;
const SIDEWALK_Y_SURF  = 0.140;

// Şemsiye geometrik profil sabitleri
const UMB_CONE_HEIGHT = 0.220;

// ══════════════════════════════════════════════════════════════════════════════
// MODULE-LEVEL STATE & TYPED ARRAYS (Zero Allocation)
// ══════════════════════════════════════════════════════════════════════════════

let _pointsMesh  = null;
let _geometry    = null;
let _material    = null;

let _positions   = null; // Float32Array(RAIN_COUNT * 3)
let _speedY      = null; // Float32Array(RAIN_COUNT)
let _divertVx    = null; // Float32Array(RAIN_COUNT)
let _divertVy    = null; // Float32Array(RAIN_COUNT)
let _divertVz    = null; // Float32Array(RAIN_COUNT)
let _isDiverted  = null; // Uint8Array(RAIN_COUNT)

// ─── Zemin Sıçraması (Ground Splash InstancedMesh Havuzu) ───────────────────
export const SPLASH_POOL_SIZE = 64;
let _splashMesh     = null;
const _splashActive  = new Uint8Array(SPLASH_POOL_SIZE);
const _splashLife    = new Float32Array(SPLASH_POOL_SIZE);
const _splashMaxLife = new Float32Array(SPLASH_POOL_SIZE);
const _splashScale   = new Float32Array(SPLASH_POOL_SIZE);
const _splashX       = new Float32Array(SPLASH_POOL_SIZE);
const _splashY       = new Float32Array(SPLASH_POOL_SIZE);
const _splashZ       = new Float32Array(SPLASH_POOL_SIZE);
let   _splashPoolPtr = 0;

// Sıfır tahsisli yardımcı matematik nesneleri
const _splashMat4  = new THREE.Matrix4();
const _splashPos   = new THREE.Vector3();
const _splashScl   = new THREE.Vector3();
const _splashColor = new THREE.Color();
const _splashQuat  = new THREE.Quaternion(); // Identity (düz yere paralel)

/**
 * Donuk kare veya yuvarlak toplar yerine jilet gibi ince, yarı-saydam
 * dikey iğne çizgisi (streak) üreten CanvasTexture.
 */
function _createRainTexture() {
  if (typeof document === 'undefined') return null;

  const width  = 8;
  const height = 64; // 1:8 en-boy oranı — jilet gibi dikey iğne damlası

  const canvas  = document.createElement('canvas');
  canvas.width  = width;
  canvas.height = height;
  const ctx     = canvas.getContext('2d');

  ctx.clearRect(0, 0, width, height);

  // Dikey gradyan: merkezde saf beyaz, uçlarda yumuşak sönüm
  const grad = ctx.createLinearGradient(width / 2, 0, width / 2, height);
  grad.addColorStop(0.00, 'rgba(220, 235, 255, 0.00)');
  grad.addColorStop(0.20, 'rgba(225, 240, 255, 0.40)');
  grad.addColorStop(0.50, 'rgba(255, 255, 255, 0.95)');
  grad.addColorStop(0.80, 'rgba(225, 240, 255, 0.40)');
  grad.addColorStop(1.00, 'rgba(220, 235, 255, 0.00)');

  ctx.strokeStyle = grad;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(width / 2, 2);
  ctx.lineTo(width / 2, height - 2);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Su sıçraması için dairesel konsantrik halka ve sıçrama zerrecikleri üreten CanvasTexture.
 */
function _createSplashTexture() {
  if (typeof document === 'undefined') return null;

  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width  = size;
  canvas.height = size;
  const ctx     = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  const cx = size / 2;
  const cy = size / 2;

  // Dış ana sıçrama halkası (Impact ripple)
  ctx.beginPath();
  ctx.arc(cx, cy, 22, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(215, 235, 255, 0.85)';
  ctx.lineWidth = 3.0;
  ctx.stroke();

  // İç konsantrik dalga
  ctx.beginPath();
  ctx.arc(cx, cy, 12, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(230, 245, 255, 0.50)';
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // Merkez damla çarpma noktası
  ctx.beginPath();
  ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.fill();

  // 4 radyal mikro su zerresi
  const rad = 25;
  for (let a = 0; a < 4; a++) {
    const angle = (a * Math.PI / 2) + 0.38;
    const sx = cx + Math.cos(angle) * rad;
    const sy = cy + Math.sin(angle) * rad;
    ctx.beginPath();
    ctx.arc(sx, sy, 1.8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(210, 235, 255, 0.85)';
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

// ══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════════════════════════════════════

export async function initRain(scene, group, config) {
  const targetGroup = group || (scene && scene.getObjectByName && scene.getObjectByName('rain')) || scene;

  // Statik Bellek Havuzu (Zero Allocation Altyapısı)
  _positions  = new Float32Array(RAIN_COUNT * 3);
  _speedY     = new Float32Array(RAIN_COUNT);
  _divertVx   = new Float32Array(RAIN_COUNT);
  _divertVy   = new Float32Array(RAIN_COUNT);
  _divertVz   = new Float32Array(RAIN_COUNT);
  _isDiverted = new Uint8Array(RAIN_COUNT);

  // Damlaları Rain Box İçine Dağıt
  for (let i = 0; i < RAIN_COUNT; i++) {
    const idx = i * 3;
    _positions[idx]     = BOX_X_MIN + Math.random() * BOX_X_SPAN;
    _positions[idx + 1] = BOX_Y_MIN + Math.random() * BOX_Y_MAX;
    _positions[idx + 2] = BOX_Z_MIN + Math.random() * BOX_Z_SPAN;

    _speedY[i]     = SPEED_Y_MIN + Math.random() * (SPEED_Y_MAX - SPEED_Y_MIN);
    _divertVx[i]   = 0.0;
    _divertVy[i]   = 0.0;
    _divertVz[i]   = 0.0;
    _isDiverted[i] = 0;
  }

  _geometry = new THREE.BufferGeometry();
  _geometry.setAttribute('position', new THREE.BufferAttribute(_positions, 3));

  const rainTex = _createRainTexture();

  // İnce, yarı-saydam beyazımsı gri sinematik yağmur materyali
  _material = new THREE.PointsMaterial({
    size:            0.10,     // 0.08 - 0.15 spesifikasyonunda ince damlalar
    map:             rainTex,
    color:           0xddeeff, // İnce beyazımsı gri gece yağmuru
    opacity:         0.50,     // Yarı-saydam doğal geçirgenlik
    transparent:     true,
    depthWrite:      false,
    blending:        THREE.NormalBlending,
    sizeAttenuation: true,
  });

  _pointsMesh = new THREE.Points(_geometry, _material);
  _pointsMesh.name = 'rainParticles';
  _pointsMesh.frustumCulled = false;

  targetGroup.add(_pointsMesh);

  // ── Zemin Sıçramaları (Splash InstancedMesh) ──────────────────────────────
  const splashTex = _createSplashTexture();
  const splashGeo = new THREE.PlaneGeometry(0.36, 0.36);
  splashGeo.rotateX(-Math.PI / 2); // Yere yatay oturur

  const splashMat = new THREE.MeshBasicMaterial({
    map:         splashTex,
    color:       0xd0e6ff,
    transparent: true,
    opacity:     0.85,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false,
    side:        THREE.DoubleSide,
  });

  _splashMesh = new THREE.InstancedMesh(splashGeo, splashMat, SPLASH_POOL_SIZE);
  _splashMesh.name = 'rainSplashes';
  _splashMesh.frustumCulled = false;

  // Başlangıçta tüm instance'ları yerin altına sakla
  _splashPos.set(0, -999, 0);
  _splashScl.set(0, 0, 0);
  _splashMat4.compose(_splashPos, _splashQuat, _splashScl);
  for (let k = 0; k < SPLASH_POOL_SIZE; k++) {
    _splashMesh.setMatrixAt(k, _splashMat4);
    _splashActive[k] = 0;
  }
  _splashMesh.instanceMatrix.needsUpdate = true;
  _splashMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SPLASH_POOL_SIZE * 3), 3);

  targetGroup.add(_splashMesh);
}

/**
 * Zemine veya araç tekerleği arkasına tek bir su sıçraması fırlatır.
 * O(1) circular ring-buffer — sıfır tahsis.
 */
export function spawnSplash(x, y, z, scale = 1.0, life = 0.20) {
  const id = _splashPoolPtr;
  _splashPoolPtr = (_splashPoolPtr + 1) % SPLASH_POOL_SIZE;

  _splashActive[id]  = 1;
  _splashLife[id]    = life;
  _splashMaxLife[id] = life;
  _splashScale[id]   = scale;
  _splashX[id]       = x;
  _splashY[id]       = y;
  _splashZ[id]       = z;
}

/**
 * Her frame yağmur fiziğini ve zemin sıçramalarını günceller.
 * Zero-allocation kuralına kesinlikle uyar.
 */
export function updateRain(delta, cameraPos) {
  if (!_geometry || !_positions) return;

  const dt = Math.min(delta, 0.1);

  // Karakter şemsiye çarpışma verisi
  const collider = getUmbrellaCollider ? getUmbrellaCollider() : null;
  const hasCollider = collider && collider.center && collider.radius > 0;

  const uCenter = hasCollider ? collider.center : null;
  const uRadius = hasCollider ? collider.radius : 0.50;

  const uApexY = hasCollider ? (uCenter.y + UMB_CONE_HEIGHT * 0.40) : 0;
  const uRimY  = hasCollider ? (uCenter.y - UMB_CONE_HEIGHT * 0.60) : 0;
  const uRadiusSq = uRadius * uRadius;

  const pos       = _positions;
  const speedY    = _speedY;
  const divertVx  = _divertVx;
  const divertVy  = _divertVy;
  const divertVz  = _divertVz;
  const isDiverted = _isDiverted;

  for (let i = 0; i < RAIN_COUNT; i++) {
    const idx = i * 3;

    let px = pos[idx];
    let py = pos[idx + 1];
    let pz = pos[idx + 2];

    // 1. Hareket Entegrasyonu (Yerçekimi + Rüzgar + Saptırma Hızları)
    px += (WIND_X + divertVx[i]) * dt;
    py -= (speedY[i] - divertVy[i]) * dt;
    pz += (WIND_Z + divertVz[i]) * dt;

    // 2. Şemsiye Çarpışma ve Saptırma Mekaniği
    if (hasCollider) {
      const dx = px - uCenter.x;
      const dz = pz - uCenter.z;
      const distSq = dx * dx + dz * dz;

      if (distSq < uRadiusSq * 1.25) {
        const dist = Math.sqrt(distSq);
        const normR = Math.min(1.0, dist / uRadius);
        const surfaceY = uRimY + (1.0 - normR) * (uApexY - uRimY);

        if (py <= (surfaceY + 0.10) && py >= (uRimY - 0.14)) {
          const invDist = dist > 0.001 ? (1.0 / dist) : 0.0;
          const nx = dist > 0.001 ? (dx * invDist) : 1.0;
          const nz = dist > 0.001 ? (dz * invDist) : 0.0;

          // Damlayı şemsiyenin dış kenarına it
          px = uCenter.x + nx * (uRadius + 0.05);
          pz = uCenter.z + nz * (uRadius + 0.05);
          py = uRimY - 0.02;

          const scatterSpeed = 3.2 + (i % 5) * 0.5;
          divertVx[i] = nx * scatterSpeed;
          divertVz[i] = nz * scatterSpeed;
          divertVy[i] = 1.6 + (i % 3) * 0.6;
          isDiverted[i] = 1;
        }
      }
    }

    // 3. Sapan Damlaların Sönümlemesi
    if (isDiverted[i] === 1) {
      divertVx[i] *= 0.90;
      divertVz[i] *= 0.90;
      divertVy[i] -= 22.0 * dt;

      if (py < (uRimY - 0.55)) {
        isDiverted[i] = 0;
        divertVx[i]   = 0.0;
        divertVy[i]   = 0.0;
        divertVz[i]   = 0.0;
      }
    }

    // 4. Zemin / Kaldırım Çarpışması & Respawn
    const isSidewalk = (px < -2.2 || px > 6.8);
    const groundLimitY = isSidewalk ? 0.145 : 0.00;

    if (py <= groundLimitY) {
      // Sadece kameraya R <= 18m mesafedeki damlalar için sıçrama oluştur
      const camX = (cameraPos && typeof cameraPos.x === 'number') ? cameraPos.x : -4.50;
      const camZ = (cameraPos && typeof cameraPos.z === 'number') ? cameraPos.z : 0.0;
      const dxCam = px - camX;
      const dzCam = pz - camZ;
      if (dxCam * dxCam + dzCam * dzCam <= 324.0) {
        spawnSplash(px, groundLimitY + 0.006, pz, 0.75 + Math.random() * 0.40, 0.18 + Math.random() * 0.05);
      }

      py = RESPAWN_Y_MIN + Math.random() * (RESPAWN_Y_MAX - RESPAWN_Y_MIN);
      px = BOX_X_MIN + Math.random() * BOX_X_SPAN;
      pz = BOX_Z_MIN + Math.random() * BOX_Z_SPAN;

      isDiverted[i] = 0;
      divertVx[i]   = 0.0;
      divertVy[i]   = 0.0;
      divertVz[i]   = 0.0;
    }

    // 5. Kutu Taşma Sarması
    if (px < BOX_X_MIN) px += BOX_X_SPAN;
    else if (px > BOX_X_MAX) px -= BOX_X_SPAN;

    if (pz < BOX_Z_MIN) pz += BOX_Z_SPAN;
    else if (pz > BOX_Z_MAX) pz -= BOX_Z_SPAN;

    pos[idx]     = px;
    pos[idx + 1] = py;
    pos[idx + 2] = pz;
  }

  _geometry.attributes.position.needsUpdate = true;

  // ── 6. Aktif Zemin Sıçramalarının Yaşam Döngüsü ve Animasyonu ─────────────
  if (_splashMesh) {
    let needsSplashUpdate = false;
    for (let k = 0; k < SPLASH_POOL_SIZE; k++) {
      if (_splashActive[k] === 0) continue;

      _splashLife[k] -= dt;
      needsSplashUpdate = true;

      if (_splashLife[k] <= 0.0) {
        _splashActive[k] = 0;
        _splashPos.set(0, -999, 0);
        _splashScl.set(0, 0, 0);
        _splashMat4.compose(_splashPos, _splashQuat, _splashScl);
        _splashMesh.setMatrixAt(k, _splashMat4);
        continue;
      }

      const progress = 1.0 - (_splashLife[k] / _splashMaxLife[k]); // 0.0 -> 1.0
      const currentScale = _splashScale[k] * (0.22 + progress * 1.15);
      const alpha = Math.max(0.0, 1.0 - progress);

      _splashPos.set(_splashX[k], _splashY[k], _splashZ[k]);
      _splashScl.set(currentScale, 1.0, currentScale);
      _splashMat4.compose(_splashPos, _splashQuat, _splashScl);
      _splashMesh.setMatrixAt(k, _splashMat4);

      _splashColor.setRGB(0.70 * alpha, 0.85 * alpha, 1.0 * alpha);
      _splashMesh.setColorAt(k, _splashColor);
    }

    if (needsSplashUpdate) {
      _splashMesh.instanceMatrix.needsUpdate = true;
      if (_splashMesh.instanceColor) _splashMesh.instanceColor.needsUpdate = true;
    }
  }
}

/**
 * Şimşek çaktığında damlaların aydınlanmasını sağlar.
 */
export function setRainLightningFactor(factor) {
  if (_material) {
    _material.opacity = 0.50 + factor * 0.35; // 0.50 -> 0.85
  }
}

/**
 * Pencere boyutu değiştiğinde optik damla boyutunu dengeler.
 * Küçük ekranlarda iğne çizgilerinin devleşmesini, 4K ekranlarda ise kaybolmasını önler.
 *
 * @param {number} width  — Yeni viewport genişliği (px)
 * @param {number} height — Yeni viewport yüksekliği (px)
 */
export function onResizeRain(width, height) {
  if (!_material) return;
  const scale = Math.max(0.65, Math.min(1.45, height / 1080));
  _material.size = 0.10 * scale;
  _material.needsUpdate = true;
}

