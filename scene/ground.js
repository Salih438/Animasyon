/**
 * scene/ground.js — Urban Wet Asphalt, Crisp Road Lines & Raised Sidewalks
 *
 * Sorumluluklar:
 *   - Koyu, ıslak zift renginde ana asfalt (color: 0x111115, roughness: 0.22)
 *   - Yolun ortasında belirgin, parlak SARI KESİK ÇİZGİLER (BoxGeometry, emissive sarı)
 *   - Beyaz emniyet kenar çizgileri ve Walker'ın önünde yaya geçidi (Zebra Crossing)
 *   - Sağ ve solda net yükseltilmiş taş BORDÜRLER ve KALDIRIMLAR
 *   - Asfaltı beyaz sisle boğmayan kontrollü Planar Reflector
 *   - ZERO ALLOCATION: updateGround içinde 0 heap tahsisi.
 */

import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

// ── Layout Boyutları (Metre Cinsinden) ───────────────────────────────────────
// Kamera baseX = -3.80 m ile sağ kaldırımda yürür; cadde solumuzda (X >= -2.55 m) uzanır
export const ROAD_MIN_X      = -2.55; // Yolun sağ sınırı (sağ bordür iç kenarı, kameranın hemen solu)
export const ROAD_MAX_X      =  6.20; // Yolun sol sınırı (karşı sol bordür)
export const ROAD_WIDTH      = ROAD_MAX_X - ROAD_MIN_X; // 8.75 m genişlik
export const ROAD_CENTER_X   = (ROAD_MIN_X + ROAD_MAX_X) / 2; // +1.825 m (Sarı orta çizgi)
export const ROAD_LENGTH     = 3000;  // Z yönünde uzunluk (-50 .. 2950 m)

export const CURB_WIDTH      = 0.35;  // Bordür taşı genişliği
export const CURB_HEIGHT     = 0.26;  // Asfalttan 26 cm, kaldırımdan 12 cm yukarı taşan taş bordür
export const SIDEWALK_THICK  = 0.14;  // Kaldırım kalınlığı (Y = 0.14m yüzey)
export const SIDEWALK_WIDTH  = 10.0;  // Binaların ve ara sokakların altına kadar uzanan kesintisiz ferah kaldırım

// Sağ Kaldırım (Yürüdüğümüz taraf: -4.50 m): Bordür -2.72m, kaldırım -2.80 ile -12.80m arası (bina hattının 5m altına uzanır)
export const RIGHT_CURB_X    = -2.72; // Sağ bordür merkezi
export const RIGHT_SW_X      = -7.80; // Sağ kaldırım merkezi (Kamera baseX = -4.50 ferah şekilde yürür)
// Sol Kaldırım (Karşı taraf): Bordür +6.37m, kaldırım +6.45 ile +16.45m arası
export const LEFT_CURB_X     =  6.37; // Karşı sol bordür merkezi
export const LEFT_SW_X       = 11.45; // Karşı sol kaldırım merkezi
export const SIDEWALK_OUTER_X=  7.50; // Geriye dönük uyumluluk

// Bina ön cephe hatları (Kaldırımın dış kenarından ferah pay bırakılarak):
export const BUILDING_LINE_RIGHT = -7.80; // Sağ bina cephe hattı
export const BUILDING_LINE_LEFT  = 11.40; // Sol bina cephe hattı

const Z_CENTER               = 1450;  // Geometri merkezi

export const WALK_SPEED    = 2.8;   // m/s (İnsan yürüyüş hızı — caddenin akışı)
export const STRIPE_PERIOD  = 7.0;   // m (Sarı kesik şerit periyodu: 3.2m boya + 3.8m boşluk)

// ── Modül Durumu ────────────────────────────────────────────────────────────
let _group       = null;
let _sceneRef    = null;
let _reflector   = null;
let _puddleTex   = null;
let _sidewalkTex = null;
let _dashMesh    = null;
let _zebraGroup  = null;
let _zebraZ      = 14.0;
let _walkDist    = 0.0;

let _matAsphalt  = null;
let _matSidewalk = null;
let _matCurb     = null;
let _matYellowLine = null;
let _matWhiteLine  = null;

// ══════════════════════════════════════════════════════════════════════════════
// SU BİRİKİNTİSİ & TEKERLEK İZİ DOKUSU
// ══════════════════════════════════════════════════════════════════════════════

function _createPuddleTexture() {
  if (typeof document === 'undefined') return null;

  const width  = 256;
  const height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height= height;
  const ctx    = canvas.getContext('2d');

  const imgData = ctx.createImageData(width, height);
  const data    = imgData.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;

      const u = x / width;
      const v = y / height;

      // İki ana şerit tekerlek izi
      const dTrack1 = Math.abs(u - 0.26);
      const dTrack2 = Math.abs(u - 0.74);
      const trackWet = (dTrack1 < 0.08 ? (1.0 - dTrack1 / 0.08) : 0.0) +
                       (dTrack2 < 0.08 ? (1.0 - dTrack2 / 0.08) : 0.0);

      const puddleNoise = Math.sin(u * 14.0) * Math.cos(v * 26.0) * 0.5 + 0.5;
      const isPuddle    = puddleNoise > 0.62 ? (puddleNoise - 0.62) / 0.38 : 0.0;

      const wet = Math.min(1.0, 0.25 + trackWet * 0.45 + isPuddle * 0.40);

      const dX = Math.cos(u * 40.0 + v * 20.0) * 0.5 + 0.5;
      const dY = Math.sin(u * 20.0 + v * 50.0) * 0.5 + 0.5;

      data[idx]     = Math.floor(wet * 255);
      data[idx + 1] = Math.floor(dX * 255);
      data[idx + 2] = Math.floor(dY * 255);
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 40);
  texture.needsUpdate = true;
  return texture;
}

// ══════════════════════════════════════════════════════════════════════════════
// ISLAK GRANİT KALDIRIM TAŞ DÖŞEMESİ DOKUSU (Wet Granite Flagstone Pavers)
// ══════════════════════════════════════════════════════════════════════════════

function _createSidewalkTexture(maxAniso = 16) {
  if (typeof document === 'undefined') return null;

  const width  = 512;
  const height = 1024;
  const canvas = document.createElement('canvas');
  canvas.width  = width;
  canvas.height = height;
  const ctx     = canvas.getContext('2d');

  // Baz zemin derz rengi (koyu antrasit harç)
  ctx.fillStyle = '#141822';
  ctx.fillRect(0, 0, width, height);

  // Şaşırtmalı granit kaldırım taşları (Staggered running bond flagstones)
  const cols = 4;
  const rows = 16;
  const slabW = width / cols;
  const slabH = height / rows;

  for (let r = 0; r < rows; r++) {
    const xOffset = (r % 2 === 1) ? (slabW * 0.5) : 0.0;
    for (let c = -1; c <= cols; c++) {
      const sx = c * slabW + xOffset;
      const sy = r * slabH;

      // Taş tonu mikro varyasyonları (koyu arduvaz, ıslak granit, çelik mavisi)
      const n = Math.sin(r * 11.7 + c * 37.3) * 0.5 + 0.5;
      let stoneColor;
      if (n < 0.25)      stoneColor = '#323a4b';
      else if (n < 0.50) stoneColor = '#2b3242';
      else if (n < 0.75) stoneColor = '#3a4456';
      else               stoneColor = '#363f50';

      ctx.fillStyle = stoneColor;
      // 3px derz boşluğu bırakarak döşeme taşını çiz
      ctx.fillRect(sx + 3, sy + 3, slabW - 6, slabH - 6);

      // Taş pahı ve ışık kırılımı (üst & sol kenar aydınlık, alt & sağ gölge)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.fillRect(sx + 3, sy + 3, slabW - 6, 2);
      ctx.fillRect(sx + 3, sy + 3, 2, slabH - 6);

      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillRect(sx + 3, sy + slabH - 5, slabW - 6, 2);
      ctx.fillRect(sx + slabW - 5, sy + 3, 2, slabH - 6);

      // Islak su birikintisi cilası (Puddle sheen)
      const puddleN = Math.cos(r * 9.1 + c * 15.3) * 0.5 + 0.5;
      if (puddleN > 0.55) {
        ctx.fillStyle = 'rgba(205, 230, 255, 0.18)';
        ctx.fillRect(sx + 6, sy + 6, slabW - 12, slabH - 12);
      }
    }
  }

  // Yatay ana derz çizgileri
  ctx.fillStyle = '#0e1118';
  for (let r = 0; r <= rows; r++) {
    ctx.fillRect(0, r * slabH - 1, width, 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // 10m genişlik x 3000m uzunluk caddede gerçekçi oranlı taş döşemesi
  texture.repeat.set(4, 300);
  texture.anisotropy = maxAniso;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

// ══════════════════════════════════════════════════════════════════════════════
// CUSTOM REFLECTOR SHADER
// ══════════════════════════════════════════════════════════════════════════════

const WetAsphaltReflectorShader = {
  name: 'WetAsphaltReflectorShader',
  uniforms: {
    color:         { value: new THREE.Color(0x090b10) }, // Koyu ıslak zift
    tDiffuse:      { value: null },
    textureMatrix: { value: new THREE.Matrix4() },
    tPuddle:       { value: null },
    uBlendFactor:  { value: 0.28 },                      // Aşırı beyazlamayı önleyen derin yansıma
    fogColor:      { value: new THREE.Color(0x050510) },
    fogDensity:    { value: 0.00045 },
  },
  vertexShader: `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec2 vWorldUv;

    void main() {
      vUv = textureMatrix * vec4( position, 1.0 );
      vWorldUv = uv * vec2( 1.0, 60.0 );
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,
  fragmentShader: `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform sampler2D tPuddle;
    uniform float uBlendFactor;
    uniform vec3 fogColor;
    uniform float fogDensity;

    varying vec4 vUv;
    varying vec2 vWorldUv;

    void main() {
      vec4 puddle = texture2D( tPuddle, vWorldUv );

      // Dikey uzayan lens ışık izi distorsiyonu
      vec2 distortion = (puddle.gb - 0.5) * 0.018;
      vec4 projUv = vUv;
      projUv.xy += distortion * projUv.w;

      vec4 reflection = vec4( color, 1.0 );
      if ( projUv.w > 0.0001 ) {
        vec2 projCoord = projUv.xy / projUv.w;
        // Ekran koordinatları sınırlarında güvenli örnekleme (kenar sızmalarını ve çarpık taşmaları önler)
        if ( projCoord.x >= 0.0 && projCoord.x <= 1.0 && projCoord.y >= 0.0 && projCoord.y <= 1.0 ) {
          reflection = texture2D( tDiffuse, projCoord );
        }
      }

      // Koyu asfalt ile hafif specular yansıma
      float wetness = uBlendFactor * (0.30 + 0.70 * puddle.r);
      vec3 finalColor = mix( color, reflection.rgb, wetness );

      // Sahne sisi ile senkronizasyon
      float depth = gl_FragCoord.z / gl_FragCoord.w;
      float fogFactor = 1.0 - exp( - fogDensity * fogDensity * depth * depth );
      finalColor = mix( finalColor, fogColor, clamp( fogFactor, 0.0, 1.0 ) );

      gl_FragColor = vec4( finalColor, 1.0 );
    }
  `,
};

// ══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════════════════════════════════════

export async function initGround(scene, group, config, renderer) {
  _group    = group;
  _sceneRef = scene;

  const maxAniso = (renderer && renderer.capabilities && typeof renderer.capabilities.getMaxAnisotropy === 'function')
    ? Math.min(16, renderer.capabilities.getMaxAnisotropy())
    : 16;

  _initMaterials(maxAniso);
  _buildRoad();
  _buildRoadMarkings();
  _buildSidewalks();
  _buildCurbs();
}

export function updateGround(delta) {
  _walkDist += delta * WALK_SPEED;

  // 1. Sarı Kesik Şeritlerin Sonsuz Akışı (Zero Allocation Infinite Seamless Scroll)
  if (_dashMesh) {
    _dashMesh.position.z = -(_walkDist % STRIPE_PERIOD);
  }

  // 2. Islak Asfalt Su Birikintisi & Tekerlek İzi Yansıma Dokusunun Akışı
  if (_puddleTex) {
    _puddleTex.offset.y = -(_walkDist / 75.0);
  }

  // 3. Yaya Geçidinin Yaklaşması ve Periyodik Döngüsü
  if (_zebraGroup) {
    _zebraZ -= delta * WALK_SPEED;
    if (_zebraZ < -15.0) {
      _zebraZ = 160.0;
    }
    _zebraGroup.position.z = _zebraZ;
  }

  if (!_reflector || !_sceneRef) return;

  if (_sceneRef.fog && _reflector.material && _reflector.material.uniforms) {
    const u = _reflector.material.uniforms;
    if (u.fogColor && u.fogColor.value) {
      u.fogColor.value.copy(_sceneRef.fog.color);
    }
    if (u.fogDensity) {
      u.fogDensity.value = _sceneRef.fog.density;
    }
  }
}

/**
 * Reflector Render Target Çözünürlüğü Hesaplayıcı.
 * Kamera en/boy oranıyla (aspect ratio) kusursuz senkronize kalır,
 * 4K ve yüksek DPI (Retina) ekranlarda VRAM aşımını önlemek için
 * maksimum 1536px güvenli üst tavan uygular.
 */
function _calcReflectorDimensions(width, height) {
  const aspect = (width > 0 && height > 0) ? (width / height) : (16 / 9);
  const maxDim = 1536;

  let targetW = width * 0.5;
  let targetH = height * 0.5;

  if (targetW > maxDim || targetH > maxDim) {
    if (aspect >= 1.0) {
      targetW = maxDim;
      targetH = targetW / aspect;
    } else {
      targetH = maxDim;
      targetW = targetH * aspect;
    }
  }

  const rw = Math.max(256, Math.round(targetW));
  const rh = Math.max(128, Math.round(targetH));
  return { rw, rh };
}

export function onResizeGround(width, height) {
  if (_reflector && typeof _reflector.getRenderTarget === 'function') {
    const { rw, rh } = _calcReflectorDimensions(width, height);
    _reflector.getRenderTarget().setSize(rw, rh);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PRIVATE BUILDERS
// ══════════════════════════════════════════════════════════════════════════════

function _initMaterials(maxAniso = 16) {
  _puddleTex   = _createPuddleTexture();
  _sidewalkTex = _createSidewalkTexture(maxAniso);

  // Koyu ıslak zift asfaltı — derin siyah kontrast
  _matAsphalt = new THREE.MeshStandardMaterial({
    color:     0x090b10,
    roughness: 0.18,
    metalness: 0.28,
  });

  // Kaldırımlar: Dokulu ıslak granit taş döşeme (Pavers) — 0xffffff ile map dokusu tam zenginliğiyle yansır
  _matSidewalk = new THREE.MeshStandardMaterial({
    color:     0xffffff,
    map:       _sidewalkTex,
    roughness: 0.32,
    metalness: 0.14,
  });

  // Bordürler: Yükseltilmiş ıslak granit taş — asfalttan ve kaldırımdan net ayrılan kontrast
  _matCurb = new THREE.MeshStandardMaterial({
    color:     0x68748c,
    roughness: 0.25,
    metalness: 0.20,
  });

  // Parlak sarı kesik orta şerit — suyun altından jilet gibi parıldasın
  _matYellowLine = new THREE.MeshStandardMaterial({
    color:             0xffcc00,
    emissive:          new THREE.Color(0xff9900),
    emissiveIntensity: 1.80,     // Gece caddesinde parıldayan sarı çizgiler
    roughness:         0.20,
    metalness:         0.08,
  });

  // Beyaz kenar şeritleri
  _matWhiteLine = new THREE.MeshStandardMaterial({
    color:             0xffffff,
    emissive:          new THREE.Color(0xaaaaaa),
    emissiveIntensity: 1.10,
    roughness:         0.22,
    metalness:         0.08,
  });
}

function _buildRoad() {
  const geo = new THREE.PlaneGeometry(ROAD_WIDTH, ROAD_LENGTH);

  // 1. Taban Koyu Asfalt Düzlemi (Y = 0)
  const baseMesh = new THREE.Mesh(geo, _matAsphalt);
  baseMesh.name = 'road_base';
  baseMesh.rotation.x = -Math.PI / 2;
  baseMesh.position.set(ROAD_CENTER_X, 0, Z_CENTER);
  baseMesh.receiveShadow = true;
  _group.add(baseMesh);

  // 2. Islak Asfalt Planar Reflector (Y = 0.001 m)
  if (typeof window !== 'undefined') {
    const { rw, rh } = _calcReflectorDimensions(window.innerWidth, window.innerHeight);

    WetAsphaltReflectorShader.uniforms.tPuddle.value = _puddleTex;

    _reflector = new Reflector(geo, {
      clipBias:      0.003,
      textureWidth:  rw,
      textureHeight: rh,
      color:         0x111115,
      multisample:   0,
      shader:        WetAsphaltReflectorShader,
    });

    _reflector.name = 'road_wet_reflector';
    _reflector.rotation.x = -Math.PI / 2;
    _reflector.position.set(ROAD_CENTER_X, 0.001, Z_CENTER);

    // Birinci şahıs şemsiye görünüm modelinin asfalta ters yansımasını/çakışmasını önleyen filtre
    const origOnBeforeRender = _reflector.onBeforeRender;
    _reflector.onBeforeRender = function (renderer, scene, camera) {
      const fpsUmb = camera.getObjectByName('fpsUmbrellaRoot');
      const prevVis = fpsUmb ? fpsUmb.visible : true;
      if (fpsUmb) fpsUmb.visible = false;

      origOnBeforeRender.call(_reflector, renderer, scene, camera);

      if (fpsUmb) fpsUmb.visible = prevVis;
    };

    _group.add(_reflector);
  }
}

/**
 * Belirgin sarı kesik şeritler, beyaz kenar çizgileri ve yaya geçidi.
 */
function _buildRoadMarkings() {
  // 1. SARI KESİK ORTA ŞERİT (BoxGeometry — Reflector üstünde Y = 0.015 m)
  const stripeLength = 3.2;
  const stripeGap    = 3.8;
  const stripePeriod = stripeLength + stripeGap; // 7.0 m
  const stripeWidth  = 0.22;
  const stripeHeight = 0.025; // Belirgin 3D boya kabartması
  const stripeCount  = Math.floor(ROAD_LENGTH / stripePeriod);

  // Yolun tam ortasında (ROAD_CENTER_X = -1.825 m) kesik sarı çizgiler
  const dashGeo = new THREE.BoxGeometry(stripeWidth, stripeHeight, stripeLength);
  _dashMesh = new THREE.InstancedMesh(dashGeo, _matYellowLine, stripeCount);
  _dashMesh.name = 'road_center_dashes';
  _dashMesh.receiveShadow = true;

  const m4 = new THREE.Matrix4();
  for (let i = 0; i < stripeCount; i++) {
    const z = -50 + i * stripePeriod + stripeLength / 2;
    m4.setPosition(ROAD_CENTER_X, stripeHeight / 2 + 0.005, z);
    _dashMesh.setMatrixAt(i, m4);
  }
  _dashMesh.instanceMatrix.needsUpdate = true;
  _group.add(_dashMesh);

  // 2. Beyaz Kenar Şeritleri (Solid Shoulder Lines)
  const shoulderGeo = new THREE.BoxGeometry(0.18, 0.025, ROAD_LENGTH);

  // Sağ kenar şeridi (sağ bordür dibi, kameranın hemen solunda)
  const lineRight = new THREE.Mesh(shoulderGeo, _matWhiteLine);
  lineRight.name = 'road_shoulder_right';
  lineRight.position.set(ROAD_MIN_X + 0.18, 0.015, Z_CENTER);
  _group.add(lineRight);

  // Karşı sol kenar şeridi (karşı sol bordür dibi)
  const lineLeft = new THREE.Mesh(shoulderGeo, _matWhiteLine);
  lineLeft.name = 'road_shoulder_left';
  lineLeft.position.set(ROAD_MAX_X - 0.18, 0.015, Z_CENTER);
  _group.add(lineLeft);

  // 3. Yaya Geçidi (Zebra Crossing) — Başlangıçta hemen önümüzde (Z = 14.0 m)
  const crossZ = 14.0;
  const zebraBarCount = 8;
  const zebraWidth = 0.55;
  const zebraLength = 3.6;
  const zebraSpacing = (ROAD_WIDTH - 0.8) / (zebraBarCount - 1);

  _zebraGroup = new THREE.Group();
  _zebraGroup.name = 'zebra_crossing_group';
  _zebraZ = crossZ;
  _zebraGroup.position.set(0, 0, crossZ);

  const zebraGeo = new THREE.BoxGeometry(zebraWidth, 0.025, zebraLength);

  for (let b = 0; b < zebraBarCount; b++) {
    const bar = new THREE.Mesh(zebraGeo, _matWhiteLine);
    bar.name = `zebra_bar_${b}`;
    const x = (ROAD_MIN_X + 0.40) + b * zebraSpacing;
    bar.position.set(x, 0.016, 0);
    _zebraGroup.add(bar);
  }
  _group.add(_zebraGroup);
}

function _buildSidewalks() {
  const geo = new THREE.BoxGeometry(SIDEWALK_WIDTH, SIDEWALK_THICK, ROAD_LENGTH);

  const left  = new THREE.Mesh(geo, _matSidewalk);
  const right = new THREE.Mesh(geo, _matSidewalk);

  left.name  = 'sidewalk_left';
  right.name = 'sidewalk_right';

  // Kaldırımlar zemin üstünde belirgin yükseltilmiş
  left.position.set( LEFT_SW_X, SIDEWALK_THICK / 2, Z_CENTER);
  right.position.set( RIGHT_SW_X, SIDEWALK_THICK / 2, Z_CENTER);

  left.receiveShadow  = true;
  right.receiveShadow = true;

  _group.add(left);
  _group.add(right);
}

function _buildCurbs() {
  const geo = new THREE.BoxGeometry(CURB_WIDTH, CURB_HEIGHT, ROAD_LENGTH);

  const left  = new THREE.Mesh(geo, _matCurb);
  const right = new THREE.Mesh(geo, _matCurb);

  left.name  = 'curb_left';
  right.name = 'curb_right';

  // Bordür taşları yoldan 15 cm, kaldırımdan 7 cm yukarı çıkarak yolu belirginleştirir
  left.position.set( LEFT_CURB_X, CURB_HEIGHT / 2, Z_CENTER);
  right.position.set( RIGHT_CURB_X, CURB_HEIGHT / 2, Z_CENTER);

  left.receiveShadow  = true;
  right.receiveShadow = true;

  _group.add(left);
  _group.add(right);
}
