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
let _rainLensPass = null;
let _vignettePass = null;
let _outputPass   = null;
let _active       = false;

// ─── Optik Ayar Parametreleri ────────────────────────────────────────────────
export const POST_CONFIG = Object.freeze({
  bloom: {
    threshold: 0.78,   // 0.75 - 0.85 (Anti-Nuclear Bloom standardı)
    strength:  0.52,   // 0.45 - 0.60 (Zarif lens parlaması)
    radius:    0.55,   // 0.50 - 0.65 (Doğal sodyum/yağmur sisi difüzyonu)
  },
  vignette: {
    offset:    1.08,   // Odak açıklığı
    darkness:  0.75,   // Gerçek optik düşüş (siyahları gri yapmaz, kenarları derinleştirir)
  },
  lensRain: {
    enabled:   true,
    intensity: 0.35,   // 0.0 (kapalı) .. 1.0 (yoğun fırtına); 0.35 zarif ve sinematik
    speed:     0.25,
  },
});

/**
 * Kamera Lensi Yağmur Damlası Gölgelendiricisi (RainLensShader)
 *
 * POV perspektifte lens yüzeyine düşen seyrek su damlacıklarını ve
 * arka plandaki şehir ışıklarını optik olarak kıran (refraction) zarif efekti üretir.
 */
const RainLensShader = {
  name: 'RainLensShader',
  uniforms: {
    'tDiffuse':   { value: null },
    'uTime':      { value: 0.0 },
    'uIntensity': { value: 0.35 },
    'uAspect':    { value: 16.0 / 9.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uIntensity;
    uniform float uAspect;
    varying vec2 vUv;

    // Deterministik 2D hash
    vec2 hash22(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.xx + p3.yz) * p3.zy);
    }

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      if (uIntensity <= 0.001) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }

      vec2 uv = vUv;
      vec2 totalOffset = vec2(0.0);
      float totalSpecular = 0.0;

      // 8x5 Izgara hücrelerinde seyrek, doğal lens damlacıkları
      vec2 grid = vec2(8.0, 5.0);
      vec2 cellId = floor(uv * grid);
      vec2 cellUv = fract(uv * grid);

      // 3x3 komşu hücreleri kontrol et (damlacıklar hücre sınırını taşabilir)
      for (float y = -1.0; y <= 1.0; y += 1.0) {
        for (float x = -1.0; x <= 1.0; x += 1.0) {
          vec2 neighbor = vec2(x, y);
          vec2 cId = cellId + neighbor;
          vec2 rnd = hash22(cId);

          // Hücrelerin yaklaşık %42'sinde damlacık belirir
          if (rnd.x > 0.42) continue;

          // Damlacık ömrü ve periyodu
          float lifeSpeed = 0.12 + rnd.y * 0.16;
          float cycle = fract(uTime * lifeSpeed + rnd.x * 6.28);
          float fadeInOut = smoothstep(0.0, 0.20, cycle) * (1.0 - smoothstep(0.70, 1.0, cycle));

          if (fadeInOut <= 0.01) continue;

          // Damlacık konumu: yavaşça hafifçe aşağı doğru kayma (gravity trickle)
          vec2 dropCenter = rnd * 0.70 + 0.15;
          dropCenter.y -= cycle * 0.08;

          // Hücre içi göreli koordinat
          vec2 delta = (cellUv - neighbor - dropCenter);
          delta.x *= uAspect;

          float dist = length(delta);
          float radius = 0.045 + rnd.y * 0.035;

          if (dist < radius) {
            float normDist = dist / radius;
            float shape = 1.0 - normDist;
            vec2 norm = delta / (dist + 0.0001);

            // Refraksiyon optik sapması (lens distortion)
            float refrStrength = shape * shape * 0.024 * uIntensity * fadeInOut;
            totalOffset += norm * refrStrength;

            // Damla üst kenarı ışık parıltısı (specular highlight)
            vec2 lightDir = normalize(vec2(-0.6, 0.8));
            float spec = max(0.0, dot(norm, lightDir));
            totalSpecular += pow(spec, 4.0) * shape * 0.35 * uIntensity * fadeInOut;
          }
        }
      }

      // Kırılmış sahne görüntüsünü örnekle
      vec2 refractedUv = clamp(uv - totalOffset, 0.001, 0.999);
      vec4 sceneCol = texture2D(tDiffuse, refractedUv);

      // Specular su parlaklığını ekle
      sceneCol.rgb += vec3(totalSpecular * 0.9, totalSpecular * 0.95, totalSpecular * 1.10);

      gl_FragColor = sceneCol;
    }
  `,
};

// Gerçek optik düşüşlü, siyahları koruyan temiz Vignette
const CleanVignetteShader = {
  name: 'CleanVignetteShader',
  uniforms: {
    'tDiffuse': { value: null },
    'offset':   { value: 1.08 },
    'darkness': { value: 0.75 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,
  fragmentShader: `
    uniform float offset;
    uniform float darkness;
    uniform sampler2D tDiffuse;
    varying vec2 vUv;

    void main() {
      vec4 texel = texture2D( tDiffuse, vUv );
      vec2 uv = ( vUv - vec2( 0.5 ) ) * vec2( offset );
      float factor = clamp( dot( uv, uv ), 0.0, 1.0 );
      // Gerçek optik karartma: Siyahlar tam siyah (0.0) kalır, kenarlar sinematik derinleşir
      float vig = clamp( 1.0 - factor * darkness, 0.0, 1.0 );
      gl_FragColor = vec4( texel.rgb * vig, texel.a );
    }
  `,
};

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

    // 1. EffectComposer Kurulumu — Renderer Pixel Ratio ile Tam Senkron
    _composer = new EffectComposer(renderer);
    _composer.setPixelRatio(renderer.getPixelRatio());
    _composer.setSize(width, height);

    // 2. RenderPass — Base Scene Pass (Güvenli Clear Color ve Alpha)
    const bgCol = (config.atmosphere && config.atmosphere.backgroundColor) ? config.atmosphere.backgroundColor : 0x030306;
    _renderPass = new RenderPass(scene, camera, null, new THREE.Color(bgCol), 1.0);
    _renderPass.clear = true;
    _renderPass.clearDepth = true;

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

    // 4. RainLensPass — Kamera Lensi Yağmur Damlası ve Kırılma Shader'ı
    _rainLensPass = new ShaderPass(RainLensShader);
    _rainLensPass.uniforms['uIntensity'].value = POST_CONFIG.lensRain.intensity;
    _rainLensPass.uniforms['uAspect'].value    = width / height;
    _composer.addPass(_rainLensPass);

    // 5. Subtle Cinematic Vignette — Gerçek Optik Karartma
    _vignettePass = new ShaderPass(CleanVignetteShader);
    _vignettePass.uniforms['offset'].value   = POST_CONFIG.vignette.offset;
    _vignettePass.uniforms['darkness'].value = POST_CONFIG.vignette.darkness;
    _composer.addPass(_vignettePass);

    // 6. OutputPass — ACESFilmic Tone Mapping & sRGB Color Space
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

  if (_rainLensPass && _rainLensPass.uniforms['uTime']) {
    _rainLensPass.uniforms['uTime'].value += delta;
  }

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

  if (typeof _composer.getRenderer === 'function' && _composer.getRenderer()) {
    _composer.setPixelRatio(_composer.getRenderer().getPixelRatio());
  }
  _composer.setSize(width, height);

  if (_bloomPass && _bloomPass.resolution) {
    _bloomPass.resolution.set(width, height);
  }

  if (_rainLensPass && _rainLensPass.uniforms['uAspect']) {
    _rainLensPass.uniforms['uAspect'].value = width / height;
  }
}

// Geriye dönük uyumluluk alias'ı
export const resizePostProcessing = onResizePostprocessing;

/**
 * Lens yağmuru yoğunluğunu ayarlar (0.0 .. 1.0)
 */
export function setLensRainIntensity(val) {
  if (_rainLensPass && _rainLensPass.uniforms['uIntensity']) {
    _rainLensPass.uniforms['uIntensity'].value = Math.max(0.0, Math.min(1.0, val));
  }
}

/**
 * Debug ve test kontrolleri için getter fonksiyonları.
 */
export function getComposer()     { return _composer;     }
export function getBloomPass()    { return _bloomPass;    }
export function getRainLensPass() { return _rainLensPass; }
export function getVignettePass() { return _vignettePass; }
export function isPostActive()    { return _active;       }
