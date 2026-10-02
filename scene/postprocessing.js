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

// ─── Post-Processing Pipeline Durumu ─────────────────────────────────────────
let _composer     = null;
let _renderPass   = null;
let _bloomPass    = null;
let _rainLensPass = null;
let _outputPass   = null;
let _active       = false;

// ─── Optik Ayar Parametreleri ────────────────────────────────────────────────
export const POST_CONFIG = Object.freeze({
  bloom: {
    threshold: 0.68,   // Neonlar, araba farları/stopları, sokak lambaları ve pencereler tatlı bir ışıltı yayar
    strength:  0.52,   // Sinematik buğulu yağmur gecesi ışıltısı (görsel netliği korur)
    radius:    0.50,   // Kontrollü difüzyon
  },
  vignette: {
    offset:    1.15,   // Geniş odak açıklığı
    darkness:  0.42,   // ACESFilmic tone-mapping altında köşeleri kömürleştirmeyen doğal optik düşüş
  },
  lensRain: {
    enabled:   true,
    intensity: 0.32,   // Zarif ve sinematik lens yağmuru
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
    'uVignetteOffset':   { value: 1.08 },
    'uVignetteDarkness': { value: 0.75 },
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
    uniform float uVignetteOffset;
    uniform float uVignetteDarkness;
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

      // UV sınır denetimi (0.0 ile 1.0 arası kesin kenetleme)
      vec2 uv = clamp(vUv, 0.0, 1.0);
      vec2 totalOffset = vec2(0.0);
      float totalSpecular = 0.0;

      // 8x5 Izgara hücrelerinde seyrek, doğal lens damlacıkları
      vec2 grid = vec2(8.0, 5.0);
      vec2 cellId = floor(uv * grid);
      vec2 cellUv = fract(uv * grid);

      // 2x2 komşu hücreleri kontrol et (Optimizasyon: Sadece en yakın 4 hücre)
      vec2 offsetDir = sign(cellUv - 0.5); // Bulunduğumuz çeyreğe göre yön
      for (float y = 0.0; y <= 1.0; y += 1.0) {
        for (float x = 0.0; x <= 1.0; x += 1.0) {
          vec2 neighbor = vec2(x * offsetDir.x, y * offsetDir.y);
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

      // Kırılmış sahne görüntüsünü UV sınır korumalı ve negatif değer filtresiyle örnekle
      vec2 refractedUv = clamp(uv - totalOffset, 0.0, 1.0);
      vec4 sceneCol = texture2D(tDiffuse, refractedUv);
      sceneCol = max(vec4(0.0), sceneCol);

      // Specular su parlaklığını güvenli şekilde ekle
      sceneCol.rgb += max(vec3(0.0), vec3(totalSpecular * 0.9, totalSpecular * 0.95, totalSpecular * 1.10));

      // Vignette Optimizasyonu (Tek pass içinde birleştirildi)
      vec2 vigUv = (vUv - vec2(0.5)) * vec2(uVignetteOffset);
      float factor = clamp(dot(vigUv, vigUv), 0.0, 1.0);
      float vig = clamp(1.0 - factor * uVignetteDarkness, 0.0, 1.0);
      sceneCol.rgb *= vig;

      gl_FragColor = sceneCol;
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

    // 1. EffectComposer Kurulumu — 16-Bit HalfFloatType HDR Render Target
    // 8-bit renk basamaklanmasını (color banding) tamamen yok eder,
    // Bloom ve ACESFilmic tone-mapping geçişlerine pürüzsüz HDR hassasiyeti kazandırır.
    const renderTarget = new THREE.WebGLRenderTarget(width, height, {
      type:          THREE.HalfFloatType,
      format:        THREE.RGBAFormat,
      minFilter:     THREE.LinearFilter,
      magFilter:     THREE.LinearFilter,
      stencilBuffer: false,
    });

    _composer = new EffectComposer(renderer, renderTarget);
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

    // 3. UnrealBloomPass — Anti-Nuclear Bloom (Downscaled for performance)
    const bloomRes = new THREE.Vector2(width / 2, height / 2);
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
    _rainLensPass.uniforms['uVignetteOffset'].value = POST_CONFIG.vignette.offset;
    _rainLensPass.uniforms['uVignetteDarkness'].value = POST_CONFIG.vignette.darkness;
    _composer.addPass(_rainLensPass);

    // 5. OutputPass — ACESFilmic Tone Mapping & sRGB Color Space
    _outputPass = new OutputPass();
    _composer.addPass(_outputPass);

    // GLSL Hatalarını Yakalamak İçin Dummy Render Testi
    // Shader derlemesi asenkron veya ilk render anında tetiklendiği için 
    // burada sahte bir kare çizdirerek olası syntax hatalarını yakalıyoruz.
    _composer.render(0.016);
    
    // Three.js bazı shader derleme hatalarında exception fırlatmaz, sadece loglar.
    // Bu yüzden programları manuel kontrol edip bozuk shader varsa biz fırlatıyoruz.
    if (renderer.info.programs) {
      for (const program of renderer.info.programs) {
        if (program.diagnostics && !program.diagnostics.runnable) {
          throw new Error('Shader compilation failed in post-processing: ' + program.name);
        }
      }
    }

    _active = true;
  } catch (err) {
    console.error('[PostProcessing] KRİTİK HATA: Shader derleme veya başlatma başarısız oldu.', err);
    console.warn('[PostProcessing] Güvenlik için Post-Processing devre dışı bırakıldı. Düz WebGL render (Fallback) uygulanacak.');
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
    _bloomPass.resolution.set(width / 2, height / 2);
  }

  if (_rainLensPass && _rainLensPass.uniforms['uAspect']) {
    _rainLensPass.uniforms['uAspect'].value = width / height;
  }
}

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
export function isPostActive()    { return _active;       }
