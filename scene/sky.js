/**
 * scene/sky.js — SkyDome & Atmospheric Sky Shader Module
 *
 * Sorumluluklar:
 *   - Ters çevrilmiş gökyüzü küresi (SkyDome) geometrisi ve shader materyali
 *   - Gradient gece gökyüzü renk geçişi (colorTop / colorBottom)
 *   - Şimşek çakışlarında gökyüzü aydınlanma katsayısı (lightningFactor)
 *   - SIFIR ALLOCATION: Runtime güncellemesinde 0 heap tahsisi
 */

import * as THREE from 'three';
import { subscribeLightning } from './events.js';

// ══════════════════════════════════════════════════════════════════════════════
// MODULE STATE
// ══════════════════════════════════════════════════════════════════════════════

let _skyMesh = null;
let _skyMat  = null;
let _skyGeo  = null;

// ══════════════════════════════════════════════════════════════════════════════
// SHADERS
// ══════════════════════════════════════════════════════════════════════════════

const SKY_VERTEX_SHADER = `
  varying vec3 vWorldPosition;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT_SHADER = `
  uniform vec3 colorTop;
  uniform vec3 colorBottom;
  uniform float lightningFactor;
  varying vec3 vWorldPosition;
  void main() {
    vec3 d = normalize(vWorldPosition);
    float h = clamp(d.y + 0.1, 0.0, 1.0);
    vec3 color = mix(colorBottom, colorTop, h);
    vec3 flashColor = mix(vec3(0.35, 0.45, 0.60), vec3(0.85, 0.90, 1.0), h);
    color = mix(color, flashColor, lightningFactor * 0.7);
    gl_FragColor = vec4(color, 1.0);
  }
`;

// ══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════════════════════════════════════

/**
 * SkyDome nesnesini oluşturur ve sahneye ekler.
 *
 * @param {THREE.Scene} scene - Hedef Three.js sahnesi
 * @returns {THREE.Mesh} Oluşturulan SkyDome mesh referansı
 */
export function initSky(scene) {
  _skyGeo = new THREE.SphereGeometry(300, 32, 16);
  _skyMat = new THREE.ShaderMaterial({
    uniforms: {
      colorTop:        { value: new THREE.Color(0x020205) },
      colorBottom:     { value: new THREE.Color(0x0c0b0a) },
      lightningFactor: { value: 0.0 }
    },
    vertexShader:   SKY_VERTEX_SHADER,
    fragmentShader: SKY_FRAGMENT_SHADER,
    side:           THREE.BackSide,
    depthWrite:     false
  });

  _skyMesh = new THREE.Mesh(_skyGeo, _skyMat);
  _skyMesh.name = 'skyDome';

  if (scene) {
    scene.add(_skyMesh);
  }

  // Faz 9: Lightning Event Subscription
  subscribeLightning(setSkyLightningFactor);

  return _skyMesh;
}

/**
 * Şimşek çaktığında gökyüzü kubbesinin aydınlanma katsayısını günceller.
 * O(1) doğrudan uniform erişimi (DOM / tree traversal yapmaz).
 *
 * @param {number} factor - Aydınlanma katsayısı [0.0, 1.0]
 */
export function setSkyLightningFactor(factor) {
  if (_skyMat && _skyMat.uniforms.lightningFactor) {
    _skyMat.uniforms.lightningFactor.value = factor;
  }
}

/**
 * SkyDome mesh nesnesini döner.
 *
 * @returns {THREE.Mesh|null}
 */
export function getSkyMesh() {
  return _skyMesh;
}

/**
 * Frame başı güncelleme (Gerektiğinde genişletilebilir, zero allocation).
 *
 * @param {number} delta
 */
export function updateSky(delta) {
  // Static background shader; dynamic updates driven by setSkyLightningFactor.
}
