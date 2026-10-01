/**
 * scene/shadows.js — Cinematic Contact Shadows (Unified InstancedMesh)
 *
 * Sorumluluklar:
 *   - Gerçek gölge haritalama yerine, zeminle temas noktalarında hafif ve yumuşak
 *     kenarlı kontak gölge blob'ları oluşturur (High Performance, Soft Radial Falloff).
 *   - Tüm Şehir Kontak Gölgeleri TEK BİR InstancedMesh İle Çizilir (+1 Draw Call Bütçesi):
 *       * 0..11 : 12 Şehir Aracı (Tekerlek/şasi altı geniş oval temas gölgesi, Y = 0.012)
 *       * 12..17: 6 Yaya Silüeti (Ayak altı hafif dairesel temas gölgesi, Y = 0.142 kaldırım)
 *       * 18    : Walker (Birinci şahıs karakterimizin kaldırımdaki ayak/şemsiye izdüşümü)
 *       * 19..23: Gelecek rezervasyon / kullanılmayan (Scale 0)
 *   - SIFIR BELLEK TAHSİSİ (Zero Heap Allocation in updateLoop):
 *       updateShadows içinde her frame new THREE.* tahsisi yapılmaz.
 */

import * as THREE from 'three';
import { getTrafficData } from './traffic.js';
import { getPedestrianData } from './world/index.js';

const TOTAL_SHADOW_INSTANCES = 24;

let _shadowMesh = null;

// Reusable zero-allocation math nesneleri
const _m4    = new THREE.Matrix4();
const _pos   = new THREE.Vector3();
const _scale = new THREE.Vector3(1, 1, 1);
const _quat  = new THREE.Quaternion();

/**
 * Yumuşak radyal gradyan temas gölgesi dokusu oluşturur (64x64 Canvas).
 */
function _createContactShadowTexture() {
  if (typeof document === 'undefined') return null;

  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width  = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, size, size);

  const center = size / 2;
  const radius = size / 2;
  const grad = ctx.createRadialGradient(center, center, 0, center, center, radius);
  grad.addColorStop(0.00, 'rgba(0, 0, 0, 0.88)');
  grad.addColorStop(0.40, 'rgba(0, 0, 0, 0.60)');
  grad.addColorStop(0.75, 'rgba(0, 0, 0, 0.20)');
  grad.addColorStop(1.00, 'rgba(0, 0, 0, 0.00)');

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

/**
 * Kontak gölgeleri InstancedMesh'ini başlatır ve sahneye ekler.
 *
 * @param {THREE.Scene} scene
 * @param {THREE.Group} [parentGroup]
 */
export async function initShadows(scene, parentGroup) {
  const targetGroup = parentGroup || scene;

  // X-Z düzleminde yatay düzlem (1x1 birim)
  const planeGeo = new THREE.PlaneGeometry(1, 1);
  planeGeo.rotateX(-Math.PI / 2); // Asfalta/kaldırıma paralel hale getir

  const shadowTex = _createContactShadowTexture();

  const shadowMat = new THREE.MeshBasicMaterial({
    map:         shadowTex,
    transparent: true,
    opacity:     0.85,
    depthWrite:  false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits:  -1,
  });

  _shadowMesh = new THREE.InstancedMesh(planeGeo, shadowMat, TOTAL_SHADOW_INSTANCES);
  _shadowMesh.name = 'city_contact_shadows';
  _shadowMesh.frustumCulled = false;
  _shadowMesh.renderOrder = 2; // Zemin ve kaldırımdan sonra, yarı saydam nesnelerden önce çizilir

  const zeroM4 = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < TOTAL_SHADOW_INSTANCES; i++) {
    _shadowMesh.setMatrixAt(i, zeroM4);
  }
  _shadowMesh.instanceMatrix.needsUpdate = true;

  targetGroup.add(_shadowMesh);
}

/**
 * Her frame araç, yaya ve Walker temas gölgelerini günceller (Sıfır Tahsis).
 *
 * @param {THREE.Vector3} cameraPos
 */
export function updateShadows(cameraPos) {
  if (!_shadowMesh) return;

  _quat.identity();

  // ── 1. 12 Araç İçin Zemin Temas Gölgeleri (0 .. 11) ────────────────────────
  const cars = getTrafficData();
  for (let i = 0; i < 12; i++) {
    const car = cars[i];
    if (car && car.group) {
      // Araç asfalt seviyesinde (Y = 0.012 m — Z-fighting önlenir)
      _pos.set(car.x, 0.012, car.z);

      // Kasa tipine göre gölge boyutu (Genişlik X, Uzunluk Z)
      if (car.profile === 'suv') {
        _scale.set(2.40, 1.0, 5.20);
      } else if (car.profile === 'hatchback') {
        _scale.set(2.10, 1.0, 4.20);
      } else {
        // sedan
        _scale.set(2.20, 1.0, 4.95);
      }

      _m4.compose(_pos, _quat, _scale);
      _shadowMesh.setMatrixAt(i, _m4);
    } else {
      _scale.set(0, 0, 0);
      _pos.set(0, -100, 0);
      _m4.compose(_pos, _quat, _scale);
      _shadowMesh.setMatrixAt(i, _m4);
    }
  }

  // ── 2. 6 Yaya Silüeti İçin Zemin Temas Gölgeleri (12 .. 17) ─────────────────
  const pedestrians = getPedestrianData();
  const pedCount = pedestrians ? pedestrians.length : 0;
  for (let p = 0; p < 6; p++) {
    const instIdx = 12 + p;
    if (p < pedCount) {
      const ped = pedestrians[p];
      // Kaldırım üstü temas kotu (Y = 0.142 m) veya asfalt temas kotu (Y = 0.015 m)
      const isSidewalk = (ped.x < -2.55 || ped.x > 6.20);
      const contactY = isSidewalk ? 0.142 : 0.015;
      _pos.set(ped.x, contactY, ped.z);
      // Dairesel yumuşak temas gölgesi (0.95m x 0.95m)
      _scale.set(0.95, 1.0, 0.95);
      _m4.compose(_pos, _quat, _scale);
      _shadowMesh.setMatrixAt(instIdx, _m4);
    } else {
      _scale.set(0, 0, 0);
      _pos.set(0, -100, 0);
      _m4.compose(_pos, _quat, _scale);
      _shadowMesh.setMatrixAt(instIdx, _m4);
    }
  }

  // ── 3. Walker (Bizim) Zemin Temas Gölgesi (18) ──────────────────────────────
  const walkerX = (cameraPos && typeof cameraPos.x === 'number') ? cameraPos.x : -3.80;
  _pos.set(walkerX, 0.142, 0.0);
  _scale.set(0.85, 1.0, 0.85);
  _m4.compose(_pos, _quat, _scale);
  _shadowMesh.setMatrixAt(18, _m4);

  // ── 4. Kalan Boş Örnekler (19 .. 23) ────────────────────────────────────────
  for (let u = 19; u < TOTAL_SHADOW_INSTANCES; u++) {
    _scale.set(0, 0, 0);
    _pos.set(0, -100, 0);
    _m4.compose(_pos, _quat, _scale);
    _shadowMesh.setMatrixAt(u, _m4);
  }

  _shadowMesh.instanceMatrix.needsUpdate = true;
}
