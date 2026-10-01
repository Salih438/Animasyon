/**
 * scene/world/atmosphere.js - Atmosferik Efektler
 *
 * FAZ 4 Refactor: world.js [H] Sorumluluk Kumesi
 *
 * Sorumluluklar:
 *   - Buhar Bacalari (Steam Vents) - 32 parcacikli InstancedMesh sistemi
 *   - Sacak Su Akisi (Awning Runoff) - 48 damla Points sistemi
 *
 * ZERO ALLOCATION: updateAtmosphere icinde 0 heap tahsisi.
 */

import * as THREE from 'three';

const STEAM_PARTICLE_COUNT = 32;
const AWNING_DRIP_COUNT    = 48;

const VENT_0_X = -3.25;
const VENT_0_Z = 14.0;
const VENT_1_X =  6.80;
const VENT_1_Z = 45.0;

const _steamX         = new Float32Array(STEAM_PARTICLE_COUNT);
const _steamY         = new Float32Array(STEAM_PARTICLE_COUNT);
const _steamZ         = new Float32Array(STEAM_PARTICLE_COUNT);
const _steamVx        = new Float32Array(STEAM_PARTICLE_COUNT);
const _steamVy        = new Float32Array(STEAM_PARTICLE_COUNT);
const _steamVz        = new Float32Array(STEAM_PARTICLE_COUNT);
const _steamLife      = new Float32Array(STEAM_PARTICLE_COUNT);
const _steamMaxLife   = new Float32Array(STEAM_PARTICLE_COUNT);
const _steamBaseScale = new Float32Array(STEAM_PARTICLE_COUNT);
const _steamRot       = new Float32Array(STEAM_PARTICLE_COUNT);
const _steamRotSpd    = new Float32Array(STEAM_PARTICLE_COUNT);
const _steamVentId    = new Float32Array(STEAM_PARTICLE_COUNT);

let _dripPositions = null;
let _dripSpeedY    = null;

let _steamVentMesh   = null;
let _awningDripsMesh = null;

const _m4    = new THREE.Matrix4();
const _pos   = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _quat  = new THREE.Quaternion();
const _col   = new THREE.Color();
const Z_AXIS = new THREE.Vector3(0, 0, 1);

function _createSteamTexture() {
  if (typeof document === 'undefined') return null;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2, cy = size / 2;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cx);
  grad.addColorStop(0.00, 'rgba(255, 235, 205, 0.85)');
  grad.addColorStop(0.35, 'rgba(235, 215, 185, 0.40)');
  grad.addColorStop(0.70, 'rgba(180, 180, 195, 0.12)');
  grad.addColorStop(1.00, 'rgba(0, 0, 0, 0.00)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, cx, 0, Math.PI * 2);
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function _resetSteamParticle(i, delay = 0) {
  const ventId = (i % 2);
  _steamVentId[i] = ventId;
  const vx = ventId === 0 ? VENT_0_X : VENT_1_X;
  const vy = 0.16;
  const vz = ventId === 0 ? VENT_0_Z : VENT_1_Z;
  _steamLife[i]      = 1.8 + Math.random() * 1.4 + delay;
  _steamMaxLife[i]   = _steamLife[i];
  _steamBaseScale[i] = 0.40 + Math.random() * 0.25;
  _steamX[i]  = vx + (Math.random() - 0.5) * 0.35;
  _steamY[i]  = vy;
  _steamZ[i]  = vz + (Math.random() - 0.5) * 0.35;
  _steamVx[i]     = -0.22 + (Math.random() - 0.5) * 0.15;
  _steamVy[i]     =  0.85 + Math.random() * 0.65;
  _steamVz[i]     = -0.12 + (Math.random() - 0.5) * 0.10;
  _steamRot[i]    = Math.random() * Math.PI * 2;
  _steamRotSpd[i] = (Math.random() - 0.5) * 1.2;
}

function _buildSteamVents(parentGroup) {
  const grateGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.025, 16);
  const grateMat = new THREE.MeshStandardMaterial({ color: 0x12141a, roughness: 0.55, metalness: 0.70 });
  const grate1 = new THREE.Mesh(grateGeo, grateMat);
  grate1.position.set(VENT_0_X, 0.142, VENT_0_Z); grate1.receiveShadow = true;
  const grate2 = new THREE.Mesh(grateGeo, grateMat);
  grate2.position.set(VENT_1_X, 0.142, VENT_1_Z); grate2.receiveShadow = true;
  parentGroup.add(grate1, grate2);

  const steamTex = _createSteamTexture();
  const planeGeo = new THREE.PlaneGeometry(1, 1);
  const steamMat = new THREE.MeshBasicMaterial({
    map: steamTex, color: 0xffeedd, transparent: true, opacity: 0.32,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });

  _steamVentMesh = new THREE.InstancedMesh(planeGeo, steamMat, STEAM_PARTICLE_COUNT);
  _steamVentMesh.name = 'city_steam_vents';
  _steamVentMesh.frustumCulled = false;
  _steamVentMesh.renderOrder = 4;
  _steamVentMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(STEAM_PARTICLE_COUNT * 3), 3);

  for (let i = 0; i < STEAM_PARTICLE_COUNT; i++) {
    _resetSteamParticle(i, Math.random() * 2.5);
  }
  parentGroup.add(_steamVentMesh);
}

function _createDripTexture() {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 16; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(8, 0, 8, 64);
  grad.addColorStop(0.0, 'rgba(200, 230, 255, 0.0)');
  grad.addColorStop(0.3, 'rgba(215, 240, 255, 0.6)');
  grad.addColorStop(0.8, 'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(1.0, 'rgba(200, 230, 255, 0.0)');
  ctx.strokeStyle = grad; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(8, 2); ctx.lineTo(8, 62); ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function _buildAwningRunoff(parentGroup) {
  _dripPositions = new Float32Array(AWNING_DRIP_COUNT * 3);
  _dripSpeedY    = new Float32Array(AWNING_DRIP_COUNT);
  for (let i = 0; i < AWNING_DRIP_COUNT; i++) {
    const idx = i * 3;
    _dripPositions[idx]     = -4.75 + (Math.random() - 0.5) * 0.20;
    _dripPositions[idx + 1] =  0.20 + Math.random() * 2.8;
    _dripPositions[idx + 2] =  8.0  + Math.random() * 220.0;
    _dripSpeedY[i]          = 14.0  + Math.random() * 8.0;
  }
  const dripGeo = new THREE.BufferGeometry();
  dripGeo.setAttribute('position', new THREE.BufferAttribute(_dripPositions, 3));
  const dripTex = _createDripTexture();
  const dripMat = new THREE.PointsMaterial({
    size: 0.20, map: dripTex, color: 0xcceeff, transparent: true, opacity: 0.78,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  _awningDripsMesh = new THREE.Points(dripGeo, dripMat);
  _awningDripsMesh.name = 'city_awning_drips';
  _awningDripsMesh.frustumCulled = false;
  parentGroup.add(_awningDripsMesh);
}

export function buildAtmosphere(parentGroup) {
  _buildSteamVents(parentGroup);
  _buildAwningRunoff(parentGroup);
}

export function updateAtmosphere(delta, driftZ) {
  if (_steamVentMesh) {
    for (let i = 0; i < STEAM_PARTICLE_COUNT; i++) {
      _steamLife[i] -= delta;
      if (_steamLife[i] <= 0) { _resetSteamParticle(i); continue; }
      const progress = 1.0 - (_steamLife[i] / _steamMaxLife[i]);
      _steamX[i] += _steamVx[i] * delta;
      _steamY[i] += _steamVy[i] * delta;
      _steamZ[i] += _steamVz[i] * delta - driftZ;
      const ventZ = _steamVentId[i] === 0 ? VENT_0_Z : VENT_1_Z;
      if (_steamZ[i] < (ventZ - 2.5)) _steamZ[i] += 2.0;
      _steamRot[i] += _steamRotSpd[i] * delta;
      const currentScale = _steamBaseScale[i] * (0.45 + progress * 2.8);
      const alpha        = Math.sin(progress * Math.PI) * 0.32;
      _pos.set(_steamX[i], _steamY[i], _steamZ[i]);
      _quat.setFromAxisAngle(Z_AXIS, _steamRot[i]);
      _scale.set(currentScale, currentScale, 1);
      _m4.compose(_pos, _quat, _scale);
      _steamVentMesh.setMatrixAt(i, _m4);
      _col.setRGB(1.0 * alpha, 0.88 * alpha, 0.72 * alpha);
      _steamVentMesh.setColorAt(i, _col);
    }
    _steamVentMesh.instanceMatrix.needsUpdate = true;
    if (_steamVentMesh.instanceColor) _steamVentMesh.instanceColor.needsUpdate = true;
  }

  if (_awningDripsMesh && _dripPositions) {
    const pos = _dripPositions;
    for (let i = 0; i < AWNING_DRIP_COUNT; i++) {
      const idx = i * 3;
      pos[idx + 1] -= _dripSpeedY[i] * delta;
      pos[idx + 2] -= driftZ;
      if (pos[idx + 1] <= 0.14) {
        pos[idx + 1] = 3.02 + Math.random() * 0.05;
        pos[idx]     = -4.75 + (Math.random() - 0.5) * 0.20;
      }
      if (pos[idx + 2] < -10.0) pos[idx + 2] += 230.0;
    }
    _awningDripsMesh.geometry.attributes.position.needsUpdate = true;
  }
}
