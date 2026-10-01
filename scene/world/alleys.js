/**
 * scene/world/alleys.js - Ara Sokaklar Sistemi
 *
 * FAZ 5 Refactor: world.js [C] Sorumluluk Kümesi
 *
 * Sorumluluklar:
 *   - 3 Ara Sokak (Alleyway): zemin döşemesi, yan tuğla duvarlar, köşe feneri ve nokta ışığı
 *   - Z drift ve wrap mekanizması
 *
 * Bağımlılıklar: BUILDING_LINE_RIGHT (ground.js)
 */

import * as THREE from 'three';
import { BUILDING_LINE_RIGHT } from '../ground.js';

let _alleysGroup = null;
const _alleyObjects = [];

export function buildAlleys(parentGroup) {
  _alleysGroup = new THREE.Group();
  _alleysGroup.name = 'city_alleys';
  _alleyObjects.length = 0;

  const alleyZPositions = [42.0, 118.0, 205.0];

  const matPavement = new THREE.MeshStandardMaterial({
    color:     0x14161f,
    roughness: 0.55,
    metalness: 0.12,
  });

  const matLamp = new THREE.MeshStandardMaterial({
    color:             0xffaa44,
    emissive:          new THREE.Color(0xff8822),
    emissiveIntensity: 3.5,
    roughness:         0.20,
    metalness:         0.70,
  });

  const matWall = new THREE.MeshStandardMaterial({
    color:     0x0f1118,
    roughness: 0.85,
    metalness: 0.10,
  });

  alleyZPositions.forEach((zPos, idx) => {
    const alleyRoot = new THREE.Group();
    alleyRoot.name = `alley_${idx}`;
    alleyRoot.position.set(0, 0, zPos);

    // 1. Ara Sokak Zemin Taşları (Sağ bina hattından sağa doğru derinlemesine uzanır)
    const floorGeo = new THREE.PlaneGeometry(16.0, 9.0);
    const floorMesh = new THREE.Mesh(floorGeo, matPavement);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.set(BUILDING_LINE_RIGHT - 8.0, 0.138, 0);
    floorMesh.receiveShadow = true;
    alleyRoot.add(floorMesh);

    // 2. Ara Sokak Yan Duvarları (Sokağın derin koridor hissi - bina hattının arkasında)
    const wallGeo = new THREE.BoxGeometry(16.0, 12.0, 1.0);
    const wallNear = new THREE.Mesh(wallGeo, matWall);
    wallNear.position.set(BUILDING_LINE_RIGHT - 8.0, 6.0, -4.5);
    const wallFar = new THREE.Mesh(wallGeo, matWall);
    wallFar.position.set(BUILDING_LINE_RIGHT - 8.0, 6.0, 4.5);
    alleyRoot.add(wallNear, wallFar);

    // 3. Ara Sokak Köşe Feneri (Sıcak amber ışık saçar)
    const lampGeo = new THREE.BoxGeometry(0.26, 0.40, 0.26);
    const lampMesh = new THREE.Mesh(lampGeo, matLamp);
    lampMesh.position.set(BUILDING_LINE_RIGHT - 0.20, 3.4, -4.2);
    alleyRoot.add(lampMesh);

    // Yerel nokta ışığı (sokağın ağzını aydınlatır)
    const pLight = new THREE.PointLight(0xff8822, 1.4, 18.0, 2.0);
    pLight.position.set(BUILDING_LINE_RIGHT - 0.60, 3.4, -4.2);
    alleyRoot.add(pLight);

    _alleysGroup.add(alleyRoot);
    _alleyObjects.push({ group: alleyRoot, z: zPos });
  });

  parentGroup.add(_alleysGroup);
}

export function updateAlleys(driftZ) {
  for (let i = 0; i < _alleyObjects.length; i++) {
    const alley = _alleyObjects[i];
    alley.z -= driftZ;
    if (alley.z < -30.0) {
      alley.z += 220.0;
    }
    alley.group.position.z = alley.z;
  }
}

export function getAlleysGroup() {
  return _alleysGroup;
}
