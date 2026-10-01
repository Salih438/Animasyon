/**
 * scene/world/pedestrians.js -- Noir Karakter Sistemi
 *
 * FAZ 3 Refactor: world.js [G] Sorumluluk Kumesi
 *
 * Sorumluluklar:
 *   - 6 Noir Yaya Karakteri (Geometri Fabrikasi)
 *   - Biyomekanik Yuruyus Animasyonu (bacak/kol/bas kinematik)
 *   - Z drift ve sonsuz dongu (wrap) mantigi
 *   - getPedestrianData() -- shadows.js icin salt-okunur erisim
 *
 * ZERO ALLOCATION: updatePedestrians icinde 0 heap tahsisi.
 */

import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { LEFT_SW_X, RIGHT_SW_X } from '../ground.js';

// -- Modul State ---------------------------------------------------------------
const _pedestrianObjects = [];
let _pedestriansGroup = null;

// =============================================================================
// KARAKTER FABRIKASI
// =============================================================================

function _createNoirPedestrian(cfg) {
  const group = new THREE.Group();
  group.name = `pedestrian_${cfg.id}`;

  const coatColor = cfg.coatColor || 0x0d0f17;
  const umbColor  = cfg.umbColor  || 0x10141e;
  const scaleX    = cfg.scaleX    || 1.0;
  const scaleY    = cfg.scaleY    || 1.0;
  const hasUmb    = cfg.hasUmbrella !== false;
  const hasHood   = cfg.hasHood === true;

  const matCoat  = new THREE.MeshStandardMaterial({ color: coatColor, roughness: 0.35, metalness: 0.15 });
  const matPants = new THREE.MeshStandardMaterial({ color: 0x141820, roughness: 0.60, metalness: 0.08 });
  const matShoes = new THREE.MeshStandardMaterial({ color: 0x08090c, roughness: 0.22, metalness: 0.35 });
  const matSkin  = new THREE.MeshStandardMaterial({ color: 0xcca888, roughness: 0.70, metalness: 0.05 });
  const matHat   = new THREE.MeshStandardMaterial({ color: 0x0f1116, roughness: 0.45, metalness: 0.15 });
  const matBrass = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.25, metalness: 0.85 });
  const matUmb   = new THREE.MeshStandardMaterial({ color: umbColor,  roughness: 0.30, metalness: 0.20, side: THREE.DoubleSide });
  const matShaft = new THREE.MeshStandardMaterial({ color: 0x20242c, roughness: 0.25, metalness: 0.80 });

  const chestGeo = new THREE.BoxGeometry(0.38 * scaleX, 0.42 * scaleY, 0.22 * scaleX);
  chestGeo.translate(0, 1.04 * scaleY, 0);
  const skirtGeo = new THREE.CylinderGeometry(0.18 * scaleX, 0.22 * scaleX, 0.52 * scaleY, 10);
  skirtGeo.translate(0, 0.65 * scaleY, 0);
  const collarGeo = new THREE.BoxGeometry(0.24 * scaleX, 0.16 * scaleY, 0.08 * scaleX);
  collarGeo.translate(0, 1.22 * scaleY, 0.10 * scaleX);
  const beltGeo = new THREE.CylinderGeometry(0.19 * scaleX, 0.19 * scaleX, 0.06 * scaleY, 10);
  beltGeo.translate(0, 0.88 * scaleY, 0);
  const mergedBodyGeo = BufferGeometryUtils.mergeGeometries([chestGeo, skirtGeo, collarGeo, beltGeo], false);
  const bodyMesh = new THREE.Mesh(mergedBodyGeo, matCoat);
  bodyMesh.castShadow = true; bodyMesh.receiveShadow = true;
  group.add(bodyMesh);

  const buckleGeo = new THREE.BoxGeometry(0.06 * scaleX, 0.05 * scaleY, 0.02);
  const buckleMesh = new THREE.Mesh(buckleGeo, matBrass);
  buckleMesh.position.set(0, 0.88 * scaleY, 0.195 * scaleX);
  group.add(buckleMesh);

  const legLPivot = new THREE.Group();
  legLPivot.position.set(-0.09 * scaleX, 0.48 * scaleY, 0.0);
  const pantLGeo = new THREE.CylinderGeometry(0.042 * scaleX, 0.036 * scaleX, 0.40 * scaleY, 8);
  pantLGeo.translate(0, -0.20 * scaleY, 0);
  legLPivot.add(new THREE.Mesh(pantLGeo, matPants));
  const shoeLGeo = new THREE.BoxGeometry(0.075 * scaleX, 0.06 * scaleY, 0.19 * scaleY);
  shoeLGeo.translate(0, -0.38 * scaleY, 0.04 * scaleY);
  legLPivot.add(new THREE.Mesh(shoeLGeo, matShoes));
  group.add(legLPivot);

  const legRPivot = new THREE.Group();
  legRPivot.position.set(0.09 * scaleX, 0.48 * scaleY, 0.0);
  const pantRGeo = new THREE.CylinderGeometry(0.042 * scaleX, 0.036 * scaleX, 0.40 * scaleY, 8);
  pantRGeo.translate(0, -0.20 * scaleY, 0);
  legRPivot.add(new THREE.Mesh(pantRGeo, matPants));
  const shoeRGeo = new THREE.BoxGeometry(0.075 * scaleX, 0.06 * scaleY, 0.19 * scaleY);
  shoeRGeo.translate(0, -0.38 * scaleY, 0.04 * scaleY);
  legRPivot.add(new THREE.Mesh(shoeRGeo, matShoes));
  group.add(legRPivot);

  const armLPivot = new THREE.Group();
  armLPivot.position.set(-0.21 * scaleX, 1.20 * scaleY, 0.0);
  const armLGeo = new THREE.CylinderGeometry(0.036 * scaleX, 0.032 * scaleX, 0.28 * scaleY, 8);
  armLGeo.translate(0, -0.14 * scaleY, 0);
  armLPivot.add(new THREE.Mesh(armLGeo, matCoat));
  const handLGeo = new THREE.SphereGeometry(0.030 * scaleX, 8, 6);
  handLGeo.translate(0, -0.29 * scaleY, 0);
  armLPivot.add(new THREE.Mesh(handLGeo, matSkin));
  group.add(armLPivot);

  const armRPivot = new THREE.Group();
  armRPivot.position.set(0.21 * scaleX, 1.20 * scaleY, 0.0);
  if (hasUmb) {
    const armRGeo = new THREE.CylinderGeometry(0.036 * scaleX, 0.032 * scaleX, 0.26 * scaleY, 8);
    armRGeo.translate(0, -0.11 * scaleY, 0.04 * scaleY); armRGeo.rotateX(-0.35);
    armRPivot.add(new THREE.Mesh(armRGeo, matCoat));
    const handRGeo = new THREE.SphereGeometry(0.030 * scaleX, 8, 6);
    handRGeo.translate(0, -0.22 * scaleY, 0.10 * scaleY);
    armRPivot.add(new THREE.Mesh(handRGeo, matSkin));
    const umbGroup = new THREE.Group();
    umbGroup.position.set(0.21 * scaleX, 1.20 * scaleY + (-0.22 * scaleY), 0.10 * scaleY);
    const shaftLen = 0.85 * scaleY;
    const shaftGeo = new THREE.CylinderGeometry(0.007, 0.007, shaftLen, 8);
    shaftGeo.translate(0, shaftLen * 0.5, 0);
    umbGroup.add(new THREE.Mesh(shaftGeo, matShaft));
    const canopyGeo = new THREE.ConeGeometry(0.55 * scaleX, 0.18 * scaleY, 14, 1, true);
    canopyGeo.translate(0, shaftLen, 0);
    umbGroup.add(new THREE.Mesh(canopyGeo, matUmb));
    const tipGeo = new THREE.CylinderGeometry(0.009, 0.012, 0.06 * scaleY, 8);
    tipGeo.translate(0, shaftLen + 0.10 * scaleY, 0);
    umbGroup.add(new THREE.Mesh(tipGeo, matBrass));
    umbGroup.rotation.x = -0.12; umbGroup.rotation.z = 0.06;
    group.add(umbGroup);
  } else {
    const armRGeo = new THREE.CylinderGeometry(0.036 * scaleX, 0.032 * scaleX, 0.28 * scaleY, 8);
    armRGeo.translate(0, -0.14 * scaleY, 0);
    armRPivot.add(new THREE.Mesh(armRGeo, matCoat));
    const handRGeo = new THREE.SphereGeometry(0.030 * scaleX, 8, 6);
    handRGeo.translate(0, -0.29 * scaleY, 0);
    armRPivot.add(new THREE.Mesh(handRGeo, matSkin));
  }
  group.add(armRPivot);

  const headGroup = new THREE.Group();
  headGroup.position.set(0, 1.28 * scaleY, 0);
  const neckGeo = new THREE.CylinderGeometry(0.05 * scaleX, 0.06 * scaleX, 0.08 * scaleY, 8);
  neckGeo.translate(0, 0.04 * scaleY, 0);
  headGroup.add(new THREE.Mesh(neckGeo, matSkin));
  const headGeo = new THREE.SphereGeometry(0.10 * scaleX, 12, 10);
  headGeo.translate(0, 0.14 * scaleY, 0);
  headGroup.add(new THREE.Mesh(headGeo, matSkin));
  if (!hasHood) {
    const brimGeo = new THREE.CylinderGeometry(0.24 * scaleX, 0.24 * scaleX, 0.016, 14);
    brimGeo.translate(0, 0.20 * scaleY, 0);
    const crownGeo = new THREE.CylinderGeometry(0.11 * scaleX, 0.13 * scaleX, 0.12 * scaleY, 12);
    crownGeo.translate(0, 0.26 * scaleY, 0);
    const hatMesh = new THREE.Mesh(BufferGeometryUtils.mergeGeometries([brimGeo, crownGeo], false), matHat);
    hatMesh.rotation.x = -0.10;
    headGroup.add(hatMesh);
    const bandGeo = new THREE.CylinderGeometry(0.115 * scaleX, 0.125 * scaleX, 0.024 * scaleY, 12);
    bandGeo.translate(0, 0.22 * scaleY, 0);
    const bandMesh = new THREE.Mesh(bandGeo, matBrass);
    bandMesh.rotation.x = -0.10;
    headGroup.add(bandMesh);
  } else {
    const hoodGeo = new THREE.SphereGeometry(0.14 * scaleX, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.72);
    const hoodMesh = new THREE.Mesh(hoodGeo, matCoat);
    hoodMesh.rotation.x = -0.15;
    hoodMesh.position.set(0, 0.15 * scaleY, -0.02);
    headGroup.add(hoodMesh);
  }
  group.add(headGroup);

  group.userData.headRef = headGroup;
  group.userData.legLRef = legLPivot;
  group.userData.legRRef = legRPivot;
  group.userData.armLRef = armLPivot;
  group.userData.armRRef = armRPivot;
  return group;
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * 6 noir yayayi olusturur ve parentGroup'a ekler.
 * @param {THREE.Group} parentGroup
 */
export function buildPedestrians(parentGroup) {
  _pedestriansGroup = new THREE.Group();
  _pedestriansGroup.name = 'city_pedestrians';

  const configs = [
    { id: 1, x: LEFT_SW_X - 1.5,  z:  42.0, yaw: 0.0,       speed: -1.3, isWalking: true,  phase: 0.0,  scaleX: 1.02, scaleY: 1.08, coatColor: 0x0e172a, umbColor: 0x8a6218, hasUmbrella: true,  hasHood: false, headOffset: 0.0 },
    { id: 2, x: LEFT_SW_X - 1.0,  z:  86.0, yaw: Math.PI,   speed:  1.1, isWalking: true,  phase: 1.85, scaleX: 0.92, scaleY: 0.90, coatColor: 0x1a1c22, umbColor: 0x143428, hasUmbrella: true,  hasHood: false, headOffset: 1.2 },
    { id: 3, x: RIGHT_SW_X + 2.5, z:  28.0, yaw: 1.5,        speed:  0.0, isWalking: false, phase: 0.72, scaleX: 1.04, scaleY: 1.00, coatColor: 0x2d1218, umbColor: 0x000000, hasUmbrella: false, hasHood: true,  headOffset: 0.6 },
    { id: 4, x: RIGHT_SW_X + 2.0, z: 104.0, yaw: 1.4,        speed:  0.0, isWalking: false, phase: 2.40, scaleX: 0.98, scaleY: 0.98, coatColor: 0x16181f, umbColor: 0x4d181e, hasUmbrella: true,  hasHood: false, headOffset: 2.1 },
    { id: 5, x: LEFT_SW_X - 1.8,  z: 140.0, yaw: 0.0,        speed: -1.5, isWalking: true,  phase: 3.95, scaleX: 0.95, scaleY: 1.12, coatColor: 0x11141c, umbColor: 0x181a22, hasUmbrella: true,  hasHood: false, headOffset: 3.4 },
    { id: 6, x: RIGHT_SW_X + 1.85,z:  58.0, yaw: Math.PI,   speed:  0.8, isWalking: true,  phase: 5.10, scaleX: 1.00, scaleY: 0.96, coatColor: 0x1b2417, umbColor: 0x5c523e, hasUmbrella: true,  hasHood: false, headOffset: 4.5 },
  ];

  for (const cfg of configs) {
    const pMesh = _createNoirPedestrian(cfg);
    pMesh.position.set(cfg.x, 0.14, cfg.z);
    pMesh.rotation.y = cfg.yaw;
    _pedestriansGroup.add(pMesh);
    _pedestrianObjects.push({
      id: cfg.id, group: pMesh, x: cfg.x, z: cfg.z, baseZ: cfg.z,
      speed: cfg.speed, isWalking: cfg.isWalking, phase: cfg.phase,
      headRef: pMesh.userData.headRef, legLRef: pMesh.userData.legLRef,
      legRRef: pMesh.userData.legRRef, armLRef: pMesh.userData.armLRef,
      armRRef: pMesh.userData.armRRef, headOffset: cfg.headOffset,
      hasUmbrella: cfg.hasUmbrella,
    });
  }
  parentGroup.add(_pedestriansGroup);
}

/**
 * Yaya hareketi ve animasyonunu gunceller. ZERO ALLOCATION.
 * @param {number} delta  -- Frame suresi (saniye)
 * @param {number} driftZ -- Bu frame'de dunya Z kaymasi (WALK_SPEED * delta)
 */
export function updatePedestrians(delta, driftZ) {
  for (let i = 0; i < _pedestrianObjects.length; i++) {
    const ped = _pedestrianObjects[i];
    ped.z += (ped.speed * delta) - driftZ;
    if (ped.z < -25.0)  ped.z += 220.0;
    else if (ped.z > 210.0) ped.z -= 220.0;
    ped.group.position.z = ped.z;

    ped.phase += delta * (ped.isWalking ? 4.8 : 1.4);
    if (ped.isWalking) {
      ped.group.position.y = 0.14 + Math.abs(Math.sin(ped.phase)) * 0.038;
      ped.group.rotation.z = Math.sin(ped.phase) * 0.032;
      if (ped.legLRef) ped.legLRef.rotation.x =  Math.sin(ped.phase) * 0.38;
      if (ped.legRRef) ped.legRRef.rotation.x = -Math.sin(ped.phase) * 0.38;
      if (ped.armLRef) ped.armLRef.rotation.x = -Math.sin(ped.phase) * 0.32;
      if (ped.armRRef) ped.armRRef.rotation.x = ped.hasUmbrella
        ? Math.sin(ped.phase * 0.5) * 0.04
        : Math.sin(ped.phase) * 0.32;
    } else {
      ped.group.position.y = 0.14 + Math.sin(ped.phase) * 0.008;
      ped.group.rotation.z = Math.sin(ped.phase * 0.5) * 0.012;
      if (ped.legLRef) ped.legLRef.rotation.x = Math.sin(ped.phase * 0.4) * 0.04;
      if (ped.legRRef) ped.legRRef.rotation.x = Math.sin(ped.phase * 0.4 + 0.5) * 0.03;
      if (ped.armLRef) ped.armLRef.rotation.x = Math.sin(ped.phase * 0.4) * 0.02;
      if (ped.armRRef) ped.armRRef.rotation.x = Math.sin(ped.phase * 0.4) * 0.02;
    }
    if (ped.headRef) ped.headRef.rotation.y = Math.sin(ped.phase * 0.35 + ped.headOffset) * 0.17;
  }
}

/**
 * Salt-okunur yaya runtime durumlarini dondurur (shadows.js icin).
 * @returns {Array}
 */
export function getPedestrianData() {
  return _pedestrianObjects;
}
