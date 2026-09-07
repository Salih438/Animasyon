import * as THREE from 'three';

const camera = new THREE.PerspectiveCamera(54, 1280 / 720, 0.1, 4000);
camera.position.set(3.80, 1.78, 0.00);
camera.lookAt(3.80, 1.56, 120.0);
camera.updateMatrixWorld();

// Test point on the left: road center (-1.825, 0, 50)
const pRoad = new THREE.Vector3(-1.825, 0, 50).project(camera);
// Test point on the right: right building (10, 5, 50)
const pBuilding = new THREE.Vector3(10, 5, 50).project(camera);
// Test JAZZ CLUB (-5.90, 5.5, 24)
const pJazz = new THREE.Vector3(-5.90, 5.5, 24).project(camera);

console.log('pRoad NDC (expect x < 0 for left):', pRoad.x, pRoad.y);
console.log('pBuilding NDC (expect x > 0 for right):', pBuilding.x, pBuilding.y);
console.log('pJazz NDC:', pJazz.x, pJazz.y);
console.log('Camera up:', camera.up);
console.log('Camera rotation (Euler):', camera.rotation.x, camera.rotation.y, camera.rotation.z);
