/**
 * scene/postprocessing.js — Phase 9: Post-Processing Pipeline & Cinematic Optics
 *
 * Sorumluluklar:
 *   - THREE.EffectComposer boru hattı yönetimi
 *   - RenderPass: Temel sahne derinlik ve renk tamponunun oluşturulması
 *   - UnrealBloomPass: Anti-Nuclear Bloom optik zarafeti
 *       * Threshold (0.78): Yalnızca sokak lambası ampulleri (emissive: 2.5),
 *         araç farları (emissive: 2.8), stop lambaları (emissive: 3.0) ve
 *         şimşek anında fırlayan pencere emissive (2.0) ışıkları parlar.
 *         Bina gövdeleri, yol çizgileri ve normal zemin ASLA parlamaz.
 *       * Strength (0.52): Zarif, sinematik lens difüzyonu.
 *       * Radius (0.55): Doğal sodyum buharı ve yağmur sisi ışık saçılımı.
 *   - Cinematic Vignette (ShaderPass):
 *       * Kenarlarda hafif odaklanma kararması (offset: 1.05, darkness: 1.25).
 *   - OutputPass: ACESFilmicToneMapping ve sRGBColorSpace renk dönüşümü.
 *   - onResizePostprocessing: Çözünürlük senkronizasyonu.
 *   - Sıfır Bellek Tahsisi (Zero-Allocation): renderPostprocessing döngüsü
 *     içerisinde 0 byte/frame heap tahsisi.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';

// ─── Post-Processing Pipeline Durumu ─────────────────────────────────────────
let _composer     = null;
let _renderPass   = null;
let _bloomPass    = null;
let _vignettePass = null;
let _outputPass   = null;
let _active       = false;

// ─── Optik Ayar Parametreleri (Phase 9 Spesifikasyonu) ───────────────────────
export const POST_CONFIG = Object.freeze({
  bloom: {
    threshold: 0.78,   // 0.75 - 0.85 (Anti-Nuclear Bloom standardı)
    strength:  0.52,   // 0.45 - 0.60 (Zarif lens parlaması)
    radius:    0.55,   // 0.50 - 0.65 (Doğal sodyum/yağmur sisi difüzyonu)
  },
  vignette: {
    offset:    1.05,   // ≈ 1.0 (Merkez odak açıklığı)
    darkness:  1.25,   // 1.20 - 1.40 (Sinematik kenar kararması)
  },
});

/**
 * Post-processing boru hattını ilklendirir.
 *
 * @param {THREE.WebGLRenderer}     renderer
 * @param {THREE.Scene}             scene
 * @param {THREE.PerspectiveCamera} camera
 * @param {object}                  config
 * @returns {Promise<void>}
 */
export async function initPostprocessing(renderer, scene, camera, config = {}) {
  try {
    const width  = window.innerWidth  || 1920;
    const height = window.innerHeight || 1080;

    // 1. EffectComposer Kurulumu
    // WebGLRenderTarget float/half-float tamponu ile HDR aralığını korur
    _composer = new EffectComposer(renderer);
    _composer.setSize(width, height);

    // 2. RenderPass — Base Scene Pass
    _renderPass = new RenderPass(scene, camera);
    const origRender = _renderPass.render.bind(_renderPass);
    _renderPass.render = function (renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
      origRender(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
      if (typeof window !== 'undefined') {
        window.__sceneDrawCalls = renderer.info.render.calls;
        window.__sceneTriangles = renderer.info.render.triangles;
      }
    };
    _composer.addPass(_renderPass);

    // 3. UnrealBloomPass — Anti-Nuclear Bloom
    // Yalnızca eşik (threshold > 0.78) üzerindeki yüksek emissive elemanlar parlar
    const bloomRes = new THREE.Vector2(width, height);
    _bloomPass = new UnrealBloomPass(
      bloomRes,
      POST_CONFIG.bloom.strength,
      POST_CONFIG.bloom.radius,
      POST_CONFIG.bloom.threshold
    );
    _bloomPass.threshold = POST_CONFIG.bloom.threshold;
    _bloomPass.strength  = POST_CONFIG.bloom.strength;
    _bloomPass.radius    = POST_CONFIG.bloom.radius;
    _composer.addPass(_bloomPass);

    // 4. Subtle Cinematic Vignette — ShaderPass
    _vignettePass = new ShaderPass(VignetteShader);
    _vignettePass.uniforms['offset'].value   = POST_CONFIG.vignette.offset;
    _vignettePass.uniforms['darkness'].value = POST_CONFIG.vignette.darkness;
    _composer.addPass(_vignettePass);

    // 5. OutputPass — ACESFilmic Tone Mapping & sRGB Color Space
    // Three.js r165 standartlarında composer zincirinin sonundaki renk/ton haritalamayı uygular
    _outputPass = new OutputPass();
    _composer.addPass(_outputPass);

    _active = true;
  } catch (err) {
    console.warn('[PostProcessing] EffectComposer başlatılamadı, doğrudan WebGL fallback uygulanacak:', err);
    _active = false;
  }
}

// Geriye dönük uyumluluk alias'ı
export const initPostProcessing = initPostprocessing;

/**
 * Post-processing render döngüsü.
 *
 * KRİTİK: Sıfır Bellek Tahsisi (Zero-Allocation).
 * Döngü içinde kesinlikle hiçbir `new THREE.*` çağrısı veya geçici obje oluşturulmaz.
 * GC baskısı: 0 byte/frame.
 *
 * @param {number} [delta=0.016] Delta time
 * @returns {boolean} true → composer render etti, false → main.js fallback renderer.render() kullanmalı
 */
export function renderPostprocessing(delta = 0.016) {
  if (!_active || !_composer) return false;

  _composer.render(delta);
  return true;
}

// Geriye dönük uyumluluk alias'ı (argüman esnekliği ile)
export function renderPostProcessing(renderer, scene, camera, delta) {
  if (typeof renderer === 'number') {
    return renderPostprocessing(renderer);
  }
  return renderPostprocessing(delta || 0.016);
}

/**
 * Pencere boyutu değiştiğinde EffectComposer ve pass çözünürlüklerini günceller.
 *
 * @param {number} width
 * @param {number} height
 */
export function onResizePostprocessing(width, height) {
  if (!_composer) return;

  _composer.setSize(width, height);

  if (_bloomPass && _bloomPass.resolution) {
    _bloomPass.resolution.set(width, height);
  }
}

// Geriye dönük uyumluluk alias'ı
export const resizePostProcessing = onResizePostprocessing;

/**
 * Debug ve test kontrolleri için getter fonksiyonları.
 */
export function getComposer()     { return _composer;     }
export function getBloomPass()    { return _bloomPass;    }
export function getVignettePass() { return _vignettePass; }
export function isPostActive()    { return _active;       }
