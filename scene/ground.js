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
export const ROAD_WIDTH      = 11.6;  // Yol genişliği (X: -5.8 .. +5.8)
export const ROAD_CENTER_X   =  0.0;  // Yol merkezi tam X = 0
export const ROAD_LENGTH     = 3000;  // Z yönünde uzunluk (-50 .. 2950 m)

export const CURB_WIDTH      = 0.40;  // Bordür taşı genişliği
export const CURB_HEIGHT     = 0.25;  // Yoldan 15 cm yukarı taşan taş bordür
export const SIDEWALK_THICK  = 0.18;  // Kaldırım kalınlığı
export const SIDEWALK_WIDTH  = 6.6;   // Kaldırım genişliği

// Sağ ve Sol Sınırlar (Sokak lambaları ve binalar için)
export const RIGHT_CURB_X    = 5.80;  // Sağ bordür merkezi
export const RIGHT_SW_X      = 9.30;  // Sağ kaldırım merkezi
export const SIDEWALK_OUTER_X= 12.60; // Binaların başladığı sınır

export const LEFT_CURB_X     = -5.80; // Sol bordür merkezi
export const LEFT_SW_X       = -9.30; // Sol kaldırım merkezi

const Z_CENTER               = 1450;  // Geometri merkezi

// ── Modül Durumu ────────────────────────────────────────────────────────────
let _group       = null;
let _sceneRef    = null;
let _reflector   = null;
let _puddleTex   = null;

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
// CUSTOM REFLECTOR SHADER
// ══════════════════════════════════════════════════════════════════════════════

const WetAsphaltReflectorShader = {
  name: 'WetAsphaltReflectorShader',
  uniforms: {
    color:         { value: new THREE.Color(0x111115) }, // Koyu ıslak zift
    tDiffuse:      { value: null },
    textureMatrix: { value: new THREE.Matrix4() },
    tPuddle:       { value: null },
    uBlendFactor:  { value: 0.24 },                      // Aşırı beyazlamayı önleyen zarif yansıma
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

      vec4 reflection = texture2DProj( tDiffuse, projUv );

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

export async function initGround(scene, group, config) {
  _group    = group;
  _sceneRef = scene;

  _initMaterials();
  _buildRoad();
  _buildRoadMarkings();
  _buildSidewalks();
  _buildCurbs();
}

export function updateGround(delta) {
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

export function onResizeGround(width, height) {
  if (_reflector && typeof _reflector.getRenderTarget === 'function') {
    const w = Math.min(1024, Math.floor(width * 0.5));
    const h = Math.min(512,  Math.floor(height * 0.5));
    _reflector.getRenderTarget().setSize(w, h);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PRIVATE BUILDERS
// ══════════════════════════════════════════════════════════════════════════════

function _initMaterials() {
  _puddleTex = _createPuddleTexture();

  // Koyu ıslak zift asfaltı
  _matAsphalt = new THREE.MeshStandardMaterial({
    color:     0x111115,
    roughness: 0.22,
    metalness: 0.20,
  });

  // Kaldırımlar: Belirgin koyu mat taş
  _matSidewalk = new THREE.MeshStandardMaterial({
    color:     0x1e2028,
    roughness: 0.72,
    metalness: 0.05,
  });

  // Bordürler: Yükseltilmiş granit taş
  _matCurb = new THREE.MeshStandardMaterial({
    color:     0x2f323d,
    roughness: 0.55,
    metalness: 0.10,
  });

  // Parlak sarı kesik orta şerit
  _matYellowLine = new THREE.MeshStandardMaterial({
    color:             0xffcc00,
    emissive:          new THREE.Color(0xff9900),
    emissiveIntensity: 1.40,     // Gece caddesinde jilet gibi parlayan sarı çizgiler
    roughness:         0.28,
    metalness:         0.05,
  });

  // Beyaz kenar şeritleri
  _matWhiteLine = new THREE.MeshStandardMaterial({
    color:             0xffffff,
    emissive:          new THREE.Color(0x999999),
    emissiveIntensity: 0.75,
    roughness:         0.30,
    metalness:         0.05,
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
    const rw = Math.min(1024, Math.floor(window.innerWidth * 0.5));
    const rh = Math.min(512,  Math.floor(window.innerHeight * 0.5));

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

  // Walker X=0'da yürüdüğü için sarı kesik şerit tam solunda (X = -0.65 m) yer alır
  const dashGeo = new THREE.BoxGeometry(stripeWidth, stripeHeight, stripeLength);
  const dashMesh = new THREE.InstancedMesh(dashGeo, _matYellowLine, stripeCount);
  dashMesh.name = 'road_center_dashes';
  dashMesh.receiveShadow = true;

  const m4 = new THREE.Matrix4();
  for (let i = 0; i < stripeCount; i++) {
    const z = -50 + i * stripePeriod + stripeLength / 2;
    m4.setPosition(-0.65, stripeHeight / 2 + 0.005, z);
    dashMesh.setMatrixAt(i, m4);
  }
  dashMesh.instanceMatrix.needsUpdate = true;
  _group.add(dashMesh);

  // 2. Beyaz Kenar Şeritleri (Solid Shoulder Lines)
  const shoulderGeo = new THREE.BoxGeometry(0.18, 0.025, ROAD_LENGTH);

  // Sol kenar şeridi (X = -5.40 m)
  const lineLeft = new THREE.Mesh(shoulderGeo, _matWhiteLine);
  lineLeft.name = 'road_shoulder_left';
  lineLeft.position.set(-5.40, 0.015, Z_CENTER);
  _group.add(lineLeft);

  // Sağ kenar şeridi (X = +5.40 m)
  const lineRight = new THREE.Mesh(shoulderGeo, _matWhiteLine);
  lineRight.name = 'road_shoulder_right';
  lineRight.position.set(5.40, 0.015, Z_CENTER);
  _group.add(lineRight);

  // 3. Yaya Geçidi (Zebra Crossing) — Walker'ın hemen önünde (Z = 12.0 m)
  const crossZ = 12.0;
  const zebraBarCount = 10;
  const zebraWidth = 0.60;
  const zebraLength = 3.6;
  const zebraSpacing = 1.05;

  const zebraGeo = new THREE.BoxGeometry(zebraWidth, 0.025, zebraLength);

  for (let b = 0; b < zebraBarCount; b++) {
    const bar = new THREE.Mesh(zebraGeo, _matWhiteLine);
    bar.name = `zebra_bar_${b}`;
    const x = -4.75 + b * zebraSpacing;
    bar.position.set(x, 0.016, crossZ);
    _group.add(bar);
  }
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
