/**
 * scene/world/city-details.js - Mimari ve Sokak Detayları Sistemi
 *
 * FAZ 6 Refactor: world.js [F] Sorumluluk Kümesi
 *
 * Sorumluluklar:
 *   - 1. Bina Saçağı Kornişleri (Cornices) - 3 katmanlı taş silme profili
 *   - 2. Yağmur İniş Boruları (Downspouts) - Huni, boru, kelepçeler ve tahliye dirseği
 *   - 3. 3D Mağaza Giriş Portalları ve Kumaş Tenteler (Storefront Portals & Awnings)
 *   - 4. Çatı Detayları (Roof Details) - Su tankı, klima ünitesi, çatı anteni
 *   - 5. Sokak Mobilyaları (Street Furniture) - Çöp kutusu, yangın musluğu, bank
 *
 * Performans:
 *   - Tamamı InstancedMesh ile tek GPU draw call'a indirgenmiştir
 *   - Zero-Allocation scratch objeleri ile 60 FPS çöp üretimsiz (GC-free) çalışma
 */

import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

// ── Scratch Nesneleri (Zero-Allocation) ───────────────────────────────────────
const _m4             = new THREE.Matrix4();
const _pos            = new THREE.Vector3();
const _scale          = new THREE.Vector3();
const _scaleCornice   = new THREE.Vector3(1, 1, 1);
const _scaleDownspout = new THREE.Vector3(1, 1, 1);
const _scalePortal    = new THREE.Vector3(1, 1, 1);

// ── Modül Mesh Durumları ─────────────────────────────────────────────────────
let _cornicesMesh          = null;
let _downspoutsMesh        = null;
let _storefrontPortalsMesh = null;
let _roofDetailsMesh       = null;
let _furnitureMesh         = null;

/** Integer → [0, 1) deterministik pseudo-random hash */
function _hash(n) {
  n = (Math.imul(n ^ (n >>> 16), 0x45d9f3b)) | 0;
  n = (Math.imul(n ^ (n >>> 16), 0x45d9f3b)) | 0;
  return ((n ^ (n >>> 16)) >>> 0) / 0xffffffff;
}

// ── 1. Korniş Geometrisi ve Oluşturulması ─────────────────────────────────────
function _createCorniceGeometry() {
  const lowerGeo = new THREE.BoxGeometry(1.0, 0.30, 0.28);
  lowerGeo.translate(0, -0.42, 0.14);
  const midGeo = new THREE.BoxGeometry(1.02, 0.34, 0.42);
  midGeo.translate(0, -0.16, 0.21);
  const topGeo = new THREE.BoxGeometry(1.05, 0.20, 0.54);
  topGeo.translate(0, 0.10, 0.27);
  return BufferGeometryUtils.mergeGeometries([lowerGeo, midGeo, topGeo], false);
}

function _buildCornices(parentGroup, buildingData) {
  const corniceGeo = _createCorniceGeometry();
  const corniceMat = new THREE.MeshStandardMaterial({
    color:     0x202430,
    roughness: 0.45,
    metalness: 0.30,
  });

  _cornicesMesh = new THREE.InstancedMesh(corniceGeo, corniceMat, buildingData.length);
  _cornicesMesh.name = 'city_cornices';
  _cornicesMesh.castShadow = true;
  _cornicesMesh.receiveShadow = true;

  for (let bi = 0; bi < buildingData.length; bi++) {
    const b = buildingData[bi];
    b.corniceIdx = bi;

    _pos.set(b.facadeLine, b.h, b.z);
    _scaleCornice.set(b.d, 1, 1);
    _m4.compose(_pos, b.quat, _scaleCornice);
    _cornicesMesh.setMatrixAt(bi, _m4);
  }

  _cornicesMesh.count = buildingData.length;
  _cornicesMesh.instanceMatrix.needsUpdate = true;
  _cornicesMesh.computeBoundingSphere();
  parentGroup.add(_cornicesMesh);
}

// ── 2. İniş Borusu Geometrisi ve Oluşturulması ─────────────────────────────────
function _createDownspoutGeometry() {
  const funnelGeo = new THREE.BoxGeometry(0.24, 0.32, 0.22);
  funnelGeo.translate(0, 33.8, 0.11);

  const pipeGeo = new THREE.CylinderGeometry(0.045, 0.045, 33.6, 8);
  pipeGeo.translate(0, 16.9, 0.09);

  const b1 = new THREE.BoxGeometry(0.14, 0.04, 0.16); b1.translate(0, 3.2, 0.08);
  const b2 = new THREE.BoxGeometry(0.14, 0.04, 0.16); b2.translate(0, 9.5, 0.08);
  const b3 = new THREE.BoxGeometry(0.14, 0.04, 0.16); b3.translate(0, 16.5, 0.08);
  const b4 = new THREE.BoxGeometry(0.14, 0.04, 0.16); b4.translate(0, 23.5, 0.08);
  const b5 = new THREE.BoxGeometry(0.14, 0.04, 0.16); b5.translate(0, 30.5, 0.08);

  const shoeGeo = new THREE.CylinderGeometry(0.048, 0.048, 0.38, 8);
  shoeGeo.rotateX(0.70);
  shoeGeo.translate(0, 0.14, 0.20);

  return BufferGeometryUtils.mergeGeometries([funnelGeo, pipeGeo, b1, b2, b3, b4, b5, shoeGeo], false);
}

function _buildDownspouts(parentGroup, buildingData) {
  const downspoutGeo = _createDownspoutGeometry();
  const downspoutMat = new THREE.MeshStandardMaterial({
    color:     0x151820,
    roughness: 0.30,
    metalness: 0.80,
  });

  _downspoutsMesh = new THREE.InstancedMesh(downspoutGeo, downspoutMat, buildingData.length);
  _downspoutsMesh.name = 'city_downspouts';
  _downspoutsMesh.castShadow = false;
  _downspoutsMesh.receiveShadow = true;

  for (let bi = 0; bi < buildingData.length; bi++) {
    const b = buildingData[bi];
    b.downspoutIdx = bi;

    _pos.set(b.facadeLine, 0.0, b.z + (b.d * 0.5) - 0.40);
    _scaleDownspout.set(1, b.downspoutScaleY, 1);
    _m4.compose(_pos, b.quat, _scaleDownspout);
    _downspoutsMesh.setMatrixAt(bi, _m4);
  }

  _downspoutsMesh.count = buildingData.length;
  _downspoutsMesh.instanceMatrix.needsUpdate = true;
  _downspoutsMesh.computeBoundingSphere();
  parentGroup.add(_downspoutsMesh);
}

// ── 3. Giriş Portalları & Tente Geometrisi ve Oluşturulması ────────────────────
function _createPortalGeometry() {
  const lintelGeo = new THREE.BoxGeometry(1.0, 0.38, 0.35);
  lintelGeo.translate(0, 4.10, 0.175);

  const awningGeo = new THREE.BoxGeometry(0.96, 0.06, 1.60);
  awningGeo.rotateX(0.24);
  awningGeo.translate(0, 3.45, 0.85);

  const valanceGeo = new THREE.BoxGeometry(0.96, 0.22, 0.04);
  valanceGeo.translate(0, 3.15, 1.62);

  const strutL = new THREE.CylinderGeometry(0.02, 0.02, 1.40, 6);
  strutL.rotateX(0.70);
  strutL.translate(-0.47, 2.75, 0.70);

  const strutR = new THREE.CylinderGeometry(0.02, 0.02, 1.40, 6);
  strutR.rotateX(0.70);
  strutR.translate(0.47, 2.75, 0.70);

  const colL = new THREE.BoxGeometry(0.05, 4.0, 0.28);
  colL.translate(-0.48, 2.0, 0.14);

  const colR = new THREE.BoxGeometry(0.05, 4.0, 0.28);
  colR.translate(0.48, 2.0, 0.14);

  return BufferGeometryUtils.mergeGeometries([lintelGeo, awningGeo, valanceGeo, strutL, strutR, colL, colR], false);
}

function _buildStorefrontPortals(parentGroup, buildingData) {
  const portalGeo = _createPortalGeometry();
  const portalMat = new THREE.MeshStandardMaterial({
    color:     0x181c24,
    roughness: 0.58,
    metalness: 0.30,
  });

  _storefrontPortalsMesh = new THREE.InstancedMesh(portalGeo, portalMat, buildingData.length);
  _storefrontPortalsMesh.name = 'city_storefront_portals';
  _storefrontPortalsMesh.castShadow = true;
  _storefrontPortalsMesh.receiveShadow = true;

  for (let bi = 0; bi < buildingData.length; bi++) {
    const b = buildingData[bi];
    b.portalIdx = bi;

    _pos.set(b.facadeLine, 0.0, b.z);
    _scalePortal.set(b.d, 1, 1);
    _m4.compose(_pos, b.quat, _scalePortal);
    _storefrontPortalsMesh.setMatrixAt(bi, _m4);
  }

  _storefrontPortalsMesh.count = buildingData.length;
  _storefrontPortalsMesh.instanceMatrix.needsUpdate = true;
  _storefrontPortalsMesh.computeBoundingSphere();
  parentGroup.add(_storefrontPortalsMesh);
}

// ── 4. Çatı Detayları (Su tankı, klima, anten) ────────────────────────────────
function _buildRoofDetails(parentGroup, buildingData) {
  const tankGeo = new THREE.CylinderGeometry(0.8, 0.8, 1.8, 8);
  tankGeo.translate(2.0, 0.9, 0.0);
  const acGeo = new THREE.BoxGeometry(1.2, 0.8, 1.2);
  acGeo.translate(-1.5, 0.4, 2.0);
  const antennaGeo = new THREE.CylinderGeometry(0.04, 0.04, 3.5, 4);
  antennaGeo.translate(0, 1.75, -2.0);
  
  const roofDetailsGeo = BufferGeometryUtils.mergeGeometries([tankGeo, acGeo, antennaGeo], false);
  const matRoof = new THREE.MeshStandardMaterial({
    color:     0x0f1115,
    roughness: 0.85,
    metalness: 0.20
  });
  
  const maxRoofs = Math.floor(buildingData.length * 0.4);
  _roofDetailsMesh = new THREE.InstancedMesh(roofDetailsGeo, matRoof, maxRoofs);
  _roofDetailsMesh.name = 'roof_details';
  _roofDetailsMesh.castShadow = true;
  _roofDetailsMesh.receiveShadow = true;
  
  let roofIdx = 0;
  for (let i = 0; i < buildingData.length; i++) {
    const b = buildingData[i];
    if (_hash(b.gi * 7 + 13) > 0.60 && roofIdx < maxRoofs) {
      b.roofIdx = roofIdx;
      _pos.set(b.x, b.h + 0.2, b.z);
      _scale.set(1, 1, 1);
      _m4.compose(_pos, b.quat, _scale);
      _roofDetailsMesh.setMatrixAt(roofIdx, _m4);
      roofIdx++;
    } else {
      b.roofIdx = -1;
    }
  }
  
  _roofDetailsMesh.count = roofIdx;
  _roofDetailsMesh.instanceMatrix.needsUpdate = true;
  parentGroup.add(_roofDetailsMesh);
}

// ── 5. Sokak Mobilyaları (Bank, Hidrant, Çöp) ─────────────────────────────────
function _buildStreetFurniture(parentGroup, buildingData) {
  const trashGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.8, 8);
  trashGeo.translate(0, 0.4, 0);
  
  const hydrantGeo1 = new THREE.CylinderGeometry(0.12, 0.15, 0.6, 8);
  hydrantGeo1.translate(2.0, 0.3, 0);
  const hydrantGeo2 = new THREE.SphereGeometry(0.12, 8, 8);
  hydrantGeo2.translate(2.0, 0.6, 0);
  
  const benchGeo = new THREE.BoxGeometry(1.4, 0.45, 0.4);
  benchGeo.translate(-2.0, 0.225, 0);
  
  const furnGeo = BufferGeometryUtils.mergeGeometries([trashGeo, hydrantGeo1, hydrantGeo2, benchGeo], false);
  const matFurn = new THREE.MeshStandardMaterial({
    color:     0x22262a,
    roughness: 0.7,
    metalness: 0.3
  });
  
  const maxFurn = Math.floor(buildingData.length * 0.5);
  _furnitureMesh = new THREE.InstancedMesh(furnGeo, matFurn, maxFurn);
  _furnitureMesh.name = 'street_furniture';
  _furnitureMesh.castShadow = true;
  _furnitureMesh.receiveShadow = true;
  
  let fIdx = 0;
  for (let i = 0; i < buildingData.length; i++) {
    const b = buildingData[i];
    if (_hash(b.gi * 11 + 29) > 0.50 && fIdx < maxFurn) {
      b.furnIdx = fIdx;
      const curX = b.isRight ? (b.facadeLine + 1.5) : (b.facadeLine - 1.5);
      b.furnX = curX;
      _pos.set(curX, 0.14, b.z);
      _scale.set(1, 1, 1);
      _m4.compose(_pos, b.quat, _scale);
      _furnitureMesh.setMatrixAt(fIdx, _m4);
      fIdx++;
    } else {
      b.furnIdx = -1;
    }
  }
  _furnitureMesh.count = fIdx;
  _furnitureMesh.instanceMatrix.needsUpdate = true;
  parentGroup.add(_furnitureMesh);
}

// ── Public API ───────────────────────────────────────────────────────────────
export function buildCityDetails(parentGroup, buildingData) {
  _buildCornices(parentGroup, buildingData);
  _buildDownspouts(parentGroup, buildingData);
  _buildStorefrontPortals(parentGroup, buildingData);
  _buildRoofDetails(parentGroup, buildingData);
  _buildStreetFurniture(parentGroup, buildingData);
}

export function updateCityDetails(buildingData) {
  if (!buildingData || buildingData.length === 0) return;

  let needsRoofUpdate = false;
  let needsFurnUpdate = false;

  for (let bi = 0; bi < buildingData.length; bi++) {
    const b = buildingData[bi];

    // Korniş
    if (_cornicesMesh && b.corniceIdx >= 0) {
      _pos.set(b.facadeLine, b.h, b.z);
      _scaleCornice.set(b.d, 1, 1);
      _m4.compose(_pos, b.quat, _scaleCornice);
      _cornicesMesh.setMatrixAt(b.corniceIdx, _m4);
    }

    // İniş Borusu (Downspout)
    if (_downspoutsMesh && b.downspoutIdx >= 0) {
      _pos.set(b.facadeLine, 0.0, b.z + (b.d * 0.5) - 0.40);
      _scaleDownspout.set(1, b.downspoutScaleY, 1);
      _m4.compose(_pos, b.quat, _scaleDownspout);
      _downspoutsMesh.setMatrixAt(b.downspoutIdx, _m4);
    }

    // 3D Giriş Portalı ve Kaldırım Tentesi
    if (_storefrontPortalsMesh && b.portalIdx >= 0) {
      _pos.set(b.facadeLine, 0.0, b.z);
      _scalePortal.set(b.d, 1, 1);
      _m4.compose(_pos, b.quat, _scalePortal);
      _storefrontPortalsMesh.setMatrixAt(b.portalIdx, _m4);
    }

    // Çatı Detayı (Klima/Su Tankı)
    if (_roofDetailsMesh && b.roofIdx >= 0) {
      _pos.set(b.x, b.h + 0.2, b.z);
      _scale.set(1, 1, 1);
      _m4.compose(_pos, b.quat, _scale);
      _roofDetailsMesh.setMatrixAt(b.roofIdx, _m4);
      needsRoofUpdate = true;
    }

    // Sokak Mobilyası (Bank/Çöp)
    if (_furnitureMesh && b.furnIdx >= 0) {
      const curX = b.furnX || (b.isRight ? (b.facadeLine + 1.5) : (b.facadeLine - 1.5));
      _pos.set(curX, 0.14, b.z);
      _scale.set(1, 1, 1);
      _m4.compose(_pos, b.quat, _scale);
      _furnitureMesh.setMatrixAt(b.furnIdx, _m4);
      needsFurnUpdate = true;
    }
  }

  if (_cornicesMesh) _cornicesMesh.instanceMatrix.needsUpdate = true;
  if (_downspoutsMesh) _downspoutsMesh.instanceMatrix.needsUpdate = true;
  if (_storefrontPortalsMesh) _storefrontPortalsMesh.instanceMatrix.needsUpdate = true;
  if (needsRoofUpdate && _roofDetailsMesh) _roofDetailsMesh.instanceMatrix.needsUpdate = true;
  if (needsFurnUpdate && _furnitureMesh) _furnitureMesh.instanceMatrix.needsUpdate = true;
}

export function getCornicesMesh() { return _cornicesMesh; }
export function getDownspoutsMesh() { return _downspoutsMesh; }
export function getStorefrontPortalsMesh() { return _storefrontPortalsMesh; }
export function getRoofDetailsMesh() { return _roofDetailsMesh; }
export function getFurnitureMesh() { return _furnitureMesh; }
