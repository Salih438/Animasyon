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
import { ROAD_MIN_X, ROAD_MAX_X, SIDEWALK_THICK } from './ground.js';

// ══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION CONSTANTS
// ══════════════════════════════════════════════════════════════════════════════

export const RAIN_COUNT = 1600; // Yoğun, sinematik gece fırtınası
export const FG_RAIN_COUNT = 450; // Kameranın doğrudan ön görüş hacmine tahsis edilmiş ön plan damlaları

// Ön plan odaklı hacim (Kamera X=-4.50m, Z=0m tam önünde net akış)
const FG_X_MIN = -6.6;
const FG_X_MAX = -2.4;
const FG_X_SPAN = FG_X_MAX - FG_X_MIN; // 4.2m genişlik

const FG_Z_MIN = -1.2;
const FG_Z_MAX =  9.5;
const FG_Z_SPAN = FG_Z_MAX - FG_Z_MIN; // 10.7m derinlik

const FG_Y_MIN =  0.0;
const FG_Y_MAX = 14.0;
const FG_RESPAWN_Y_MIN = 12.0;
const FG_RESPAWN_Y_MAX = 14.0;

// Genel şehir ortamı Bounding Box sınırları
const BOX_X_MIN = -16.0;
const BOX_X_MAX =  16.0;
const BOX_X_SPAN = BOX_X_MAX - BOX_X_MIN; // 32.0

const BOX_Y_MIN =   0.0;
const BOX_Y_MAX =  18.0;
const RESPAWN_Y_MIN = 16.0;
const RESPAWN_Y_MAX = 18.0;

const BOX_Z_MIN = -10.0;
const BOX_Z_MAX =  48.0;
const BOX_Z_SPAN = BOX_Z_MAX - BOX_Z_MIN; // 58.0

// Düşüş hızı parametreleri (unit/s — hızlı dikey akış)
const SPEED_Y_MIN = 34.0;
const SPEED_Y_MAX = 48.0;

// Rüzgar sürüklenmesi (Wind Drift — hafif doğal fırtına eğimi)
const WIND_X = -2.6;
const WIND_Z = -0.8;

// Şemsiye geometrik profil sabitleri
const UMB_CONE_HEIGHT = 0.220;

// ══════════════════════════════════════════════════════════════════════════════
// MODULE-LEVEL STATE & TYPED ARRAYS (Zero Allocation)
// ══════════════════════════════════════════════════════════════════════════════

let _pointsMesh           = null;
let _geometry             = null;
let _material             = null;

let _positions            = null; // Float32Array(RAIN_COUNT * 3)
let _colors               = null; // Float32Array(RAIN_COUNT * 3) — dinamik speküler parlaklık
let _speedY               = null; // Float32Array(RAIN_COUNT)
let _divertVx             = null; // Float32Array(RAIN_COUNT)
let _divertVy             = null; // Float32Array(RAIN_COUNT)
let _divertVz             = null; // Float32Array(RAIN_COUNT)
let _isDiverted           = null; // Uint8Array(RAIN_COUNT)
let _rainLightningFactor  = 0.0;

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
 * Yüksek kontrastlı, parlak beyaz çekirdekli ve yumuşak mavi-gümüş haleli
 * sinematik dikey iğne damlası (streak) üreten CanvasTexture (16x128).
 */
function _createRainTexture() {
  if (typeof document === 'undefined') return null;

  const width  = 16;
  const height = 128; // 1:8 dikey en-boy oranı — keskin iğne damlası

  const canvas  = document.createElement('canvas');
  canvas.width  = width;
  canvas.height = height;
  const ctx     = canvas.getContext('2d');

  ctx.clearRect(0, 0, width, height);

  // Dikey gradyan: üstte yumuşak giriş, merkezde saf beyaz parlaklık, altta keskin su ucu
  const grad = ctx.createLinearGradient(width / 2, 0, width / 2, height);
  grad.addColorStop(0.00, 'rgba(180, 220, 255, 0.00)');
  grad.addColorStop(0.12, 'rgba(210, 235, 255, 0.50)');
  grad.addColorStop(0.50, 'rgba(255, 255, 255, 1.00)');
  grad.addColorStop(0.85, 'rgba(220, 240, 255, 0.70)');
  grad.addColorStop(1.00, 'rgba(180, 220, 255, 0.00)');

  // 1. Dış yumuşak parlama (Soft Refraction Glow)
  ctx.strokeStyle = 'rgba(160, 215, 255, 0.35)';
  ctx.lineWidth = 5.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(width / 2, 4);
  ctx.lineTo(width / 2, height - 4);
  ctx.stroke();

  // 2. İç jilet gibi saf beyaz çekirdek (Brilliant Core Streak)
  ctx.strokeStyle = grad;
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(width / 2, 2);
  ctx.lineTo(width / 2, height - 2);
  ctx.stroke();

  // 3. Damla ucu mikro su küreciği (Tip Bead)
  ctx.beginPath();
  ctx.arc(width / 2, height - 8, 2.0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.fill();

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
  _colors     = new Float32Array(RAIN_COUNT * 3);
  _speedY     = new Float32Array(RAIN_COUNT);
  _divertVx   = new Float32Array(RAIN_COUNT);
  _divertVy   = new Float32Array(RAIN_COUNT);
  _divertVz   = new Float32Array(RAIN_COUNT);
  _isDiverted = new Uint8Array(RAIN_COUNT);

  // Damlaları Rain Box İçine Dağıt (Ön plan odaklı hacim + genel çevre)
  for (let i = 0; i < RAIN_COUNT; i++) {
    const idx = i * 3;
    const isFg = (i < FG_RAIN_COUNT);

    if (isFg) {
      _positions[idx]     = FG_X_MIN + Math.random() * FG_X_SPAN;
      _positions[idx + 1] = FG_Y_MIN + Math.random() * FG_Y_MAX;
      _positions[idx + 2] = FG_Z_MIN + Math.random() * FG_Z_SPAN;
      _speedY[i]          = SPEED_Y_MIN * 1.05 + Math.random() * (SPEED_Y_MAX - SPEED_Y_MIN);
      _colors[idx]        = 0.95;
      _colors[idx + 1]    = 1.05;
      _colors[idx + 2]    = 1.25;
    } else {
      _positions[idx]     = BOX_X_MIN + Math.random() * BOX_X_SPAN;
      _positions[idx + 1] = BOX_Y_MIN + Math.random() * BOX_Y_MAX;
      _positions[idx + 2] = BOX_Z_MIN + Math.random() * BOX_Z_SPAN;
      _speedY[i]          = SPEED_Y_MIN + Math.random() * (SPEED_Y_MAX - SPEED_Y_MIN);
      _colors[idx]        = 0.60;
      _colors[idx + 1]    = 0.70;
      _colors[idx + 2]    = 0.85;
    }

    _divertVx[i]   = 0.0;
    _divertVy[i]   = 0.0;
    _divertVz[i]   = 0.0;
    _isDiverted[i] = 0;
  }

  _geometry = new THREE.BufferGeometry();
  _geometry.setAttribute('position', new THREE.BufferAttribute(_positions, 3));
  _geometry.setAttribute('color',    new THREE.BufferAttribute(_colors, 3));

  const rainTex = _createRainTexture();

  // İnce, canlı ve parlak sinematik iğne yağmur materyali (Additive speküler optik)
  _material = new THREE.PointsMaterial({
    size:            0.05,     // İnce dikey çizgi görünümü için küçültüldü (0.26 -> 0.05)
    map:             rainTex,
    vertexColors:    true,
    opacity:         0.40,     // Parlama patlamasını önlemek için düşürüldü (0.88 -> 0.40)
    transparent:     true,
    depthWrite:      false,
    blending:        THREE.AdditiveBlending, // Sokak lambaları ve farlardan ışık alarak parlar
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
  _splashMesh.renderOrder = 3;

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

  // Karakter şemsiye çarpışma verisi (görünmez ise hasCollider false döner)
  const collider = getUmbrellaCollider ? getUmbrellaCollider() : null;
  const hasCollider = collider && collider.enabled && collider.center && collider.radius > 0;

  const uCenter = hasCollider ? collider.center : null;
  const uRadius = hasCollider ? collider.radius : 0.50;

  const uApexY = hasCollider ? (uCenter.y + UMB_CONE_HEIGHT * 0.40) : 0;
  const uRimY  = hasCollider ? (uCenter.y - UMB_CONE_HEIGHT * 0.60) : 0;
  const uRadiusSq = uRadius * uRadius;

  const pos       = _positions;
  const col       = _colors;
  const speedY    = _speedY;
  const divertVx  = _divertVx;
  const divertVy  = _divertVy;
  const divertVz  = _divertVz;
  const isDiverted = _isDiverted;

  const lFactor = _rainLightningFactor * 1.8;

  for (let i = 0; i < RAIN_COUNT; i++) {
    const idx = i * 3;

    let px = pos[idx];
    let py = pos[idx + 1];
    let pz = pos[idx + 2];

    // 1. Doğru Vektör Entegrasyonu (Tekil dikey hız: saptıysa divertVy, normalde -speedY)
    const currentVy = (isDiverted[i] === 1) ? divertVy[i] : -speedY[i];

    px += (WIND_X + divertVx[i]) * dt;
    py += currentVy * dt;
    pz += (WIND_Z + divertVz[i]) * dt;

    // 2. Şemsiye Çarpışma ve Saptırma Mekaniği
    if (hasCollider) {
      const dx = px - uCenter.x;
      const dz = pz - uCenter.z;
      const distSq = dx * dx + dz * dz;

      if (distSq < uRadiusSq * 1.15) {
        const dist = Math.sqrt(distSq);
        const normR = Math.min(1.0, dist / uRadius);
        const surfaceY = uRimY + (1.0 - normR) * (uApexY - uRimY);

        if (py <= (surfaceY + 0.08) && py >= (uRimY - 0.12)) {
          const invDist = dist > 0.001 ? (1.0 / dist) : 0.0;
          const nx = dist > 0.001 ? (dx * invDist) : 1.0;
          const nz = dist > 0.001 ? (dz * invDist) : 0.0;

          // Damlayı şemsiye yüzeyinin dış sınırına ötele
          px = uCenter.x + nx * (uRadius + 0.04);
          pz = uCenter.z + nz * (uRadius + 0.04);
          py = surfaceY + 0.02;

          // Radyal saçılma ve pozitif yukarı sıçrama impulsu ver
          const scatterSpeed = 3.5 + (i % 5) * 0.4;
          divertVx[i] = nx * scatterSpeed;
          divertVz[i] = nz * scatterSpeed;
          divertVy[i] = 4.2 + (i % 3) * 0.8; // Güçlü pozitif yukarı zıplama
          isDiverted[i] = 1;
        }
      }
    }

    // 3. Sapan damlalara yerçekimi ivmesi ve aerodinamik sönümleme uygula
    if (isDiverted[i] === 1) {
      divertVx[i] *= 0.92;
      divertVz[i] *= 0.92;
      divertVy[i] -= 32.0 * dt; // Gerçekçi yerçekimi ivmesi (g = 32 m/s²)

      // Damla tekrar aşağı yönlü düşüşe geçtiğinde normal serbest düşüşe dön
      if (divertVy[i] < -speedY[i]) {
        isDiverted[i] = 0;
        divertVx[i]   = 0.0;
        divertVy[i]   = 0.0;
        divertVz[i]   = 0.0;
      }
    }

    // 4. Zemin / Kaldırım Çarpışması & Respawn (ground.js ile tam senkron)
    const isSidewalk = (px < ROAD_MIN_X || px > ROAD_MAX_X);
    const groundLimitY = isSidewalk ? SIDEWALK_THICK : 0.00;

    if (py <= groundLimitY) {
      // Sadece kameraya R <= 18m mesafedeki damlalar için sıçrama oluştur
      const camX = (cameraPos && typeof cameraPos.x === 'number') ? cameraPos.x : -4.50;
      const camZ = (cameraPos && typeof cameraPos.z === 'number') ? cameraPos.z : 0.0;
      const dxCam = px - camX;
      const dzCam = pz - camZ;
      if (dxCam * dxCam + dzCam * dzCam <= 324.0) {
        spawnSplash(px, groundLimitY + 0.006, pz, 0.75 + Math.random() * 0.40, 0.18 + Math.random() * 0.05);
      }

      if (i < FG_RAIN_COUNT) {
        py = FG_RESPAWN_Y_MIN + Math.random() * (FG_RESPAWN_Y_MAX - FG_RESPAWN_Y_MIN);
        px = FG_X_MIN + Math.random() * FG_X_SPAN;
        pz = FG_Z_MIN + Math.random() * FG_Z_SPAN;
      } else {
        py = RESPAWN_Y_MIN + Math.random() * (RESPAWN_Y_MAX - RESPAWN_Y_MIN);
        px = BOX_X_MIN + Math.random() * BOX_X_SPAN;
        pz = BOX_Z_MIN + Math.random() * BOX_Z_SPAN;
      }

      isDiverted[i] = 0;
      divertVx[i]   = 0.0;
      divertVy[i]   = 0.0;
      divertVz[i]   = 0.0;
    }

    // 5. Kutu Taşma Sarması
    if (i < FG_RAIN_COUNT) {
      if (px < FG_X_MIN) px += FG_X_SPAN;
      else if (px > FG_X_MAX) px -= FG_X_SPAN;

      if (pz < FG_Z_MIN) pz += FG_Z_SPAN;
      else if (pz > FG_Z_MAX) pz -= FG_Z_SPAN;
    } else {
      if (px < BOX_X_MIN) px += BOX_X_SPAN;
      else if (px > BOX_X_MAX) px -= BOX_X_SPAN;

      if (pz < BOX_Z_MIN) pz += BOX_Z_SPAN;
      else if (pz > BOX_Z_MAX) pz -= BOX_Z_SPAN;
    }

    pos[idx]     = px;
    pos[idx + 1] = py;
    pos[idx + 2] = pz;

    // 6. Kamera Önü Speküler Parlaklık Hesaplaması (Zero-allocation TypedArray write)
    const isCloseToCam = (pz >= -1.0 && pz <= 8.5 && px >= -6.8 && px <= -2.2);
    const boost = isCloseToCam ? 1.45 : 1.0;

    col[idx]     = Math.min(2.5, (isCloseToCam ? 0.90 : 0.55) * boost + lFactor);
    col[idx + 1] = Math.min(2.5, (isCloseToCam ? 1.02 : 0.65) * boost + lFactor);
    col[idx + 2] = Math.min(2.5, (isCloseToCam ? 1.25 : 0.80) * boost + lFactor * 1.2);
  }

  _geometry.attributes.position.needsUpdate = true;
  if (_geometry.attributes.color) {
    _geometry.attributes.color.needsUpdate = true;
  }

  // ── 7. Aktif Zemin Sıçramalarının Yaşam Döngüsü ve Animasyonu ─────────────
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
  _rainLightningFactor = factor;
  if (_material) {
    _material.opacity = Math.min(0.40, 0.25 + factor * 0.15); // Maksimum 0.40 ile patlamayı önle
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
  const scale = Math.max(0.75, Math.min(1.40, height / 1080));
  _material.size = 0.05 * scale;
  _material.needsUpdate = true;
}


