/**
 * scene/world/index.js - World Sistemi Orchestration ve Public API Katmanı
 *
 * FAZ 7 Refactor: Modüler Clean Architecture Giriş Noktası
 *
 * Sorumluluklar:
 *   - Tüm alt sistemlerin (buildings, city-details, neon, alleys, atmosphere, pedestrians)
 *     yaşam döngüsünü (init / update) koordine etmek.
 *   - Dış modüller (main.js, lighting.js, shadows.js) için kararlı, tip güvenli ve
 *     geriye dönük uyumlu Public API sunmak.
 *
 * Public API:
 *   - initWorld(scene, group, config, renderer)
 *   - updateWorld(delta)
 *   - setBuildingLightningFactor(factor)
 *   - getPedestrianData()
 *   - getBuildingData()
 */

import * as THREE from 'three';
import { WALK_SPEED } from '../ground.js';

import { buildBuildings, updateBuildings, setBuildingLightningFactor, getBuildingData } from './buildings.js';
import { buildCityDetails, updateCityDetails } from './city-details.js';
import { buildNeonSigns, updateNeonSigns } from './neon.js';
import { buildAlleys, updateAlleys } from './alleys.js';
import { buildAtmosphere, updateAtmosphere } from './atmosphere.js';
import { buildPedestrians, updatePedestrians, getPedestrianData } from './pedestrians.js';

// ── Modül Kök Grupları ───────────────────────────────────────────────────────
let _cityGroup = null;
let _buildingData = null;

/**
 * World sistemini başlatır, tüm alt sistemleri sıralı ve bağımlılıklarına göre kurar.
 */
export async function initWorld(scene, group, config, renderer) {
  const targetGroup = group || (scene && scene.getObjectByName && scene.getObjectByName('world')) || scene;

  // Ana şehir yapılar grubu
  _cityGroup = new THREE.Group();
  _cityGroup.name = 'city_structures_group';

  // 1. Ana Binalar (buildings.js)
  _buildingData = buildBuildings(_cityGroup, renderer);

  // 2. Neon Tabelalar (neon.js)
  buildNeonSigns(_cityGroup);

  // 3. Ara Sokaklar (alleys.js)
  buildAlleys(_cityGroup);

  // 4. Mimari ve Sokak Detayları (city-details.js) — buildingData parametre olarak aktarılır
  buildCityDetails(_cityGroup, _buildingData);

  // 5. Atmosfer Efektleri: Buhar ve Tente Damlaları (atmosphere.js)
  buildAtmosphere(_cityGroup);

  // Şehir grubunu sahneye ekle
  targetGroup.add(_cityGroup);

  // 6. Noir Yayalar (pedestrians.js) — Doğrudan targetGroup'a eklenir
  buildPedestrians(targetGroup);

  return _cityGroup;
}

/**
 * World simülasyonunu frame başına günceller (Zero-Allocation).
 * @param {number} delta - Frame süresi (saniye)
 */
export function updateWorld(delta) {
  const driftZ = WALK_SPEED * delta;

  // 1. Neon Tabelaların Z Akışı ve Wrap Mantığı (neon.js)
  updateNeonSigns(driftZ);

  // 2. Binaların Senkronize Z Akışı ve Wrap Mantığı (buildings.js)
  updateBuildings(driftZ);

  // 3. Mimari Detayların Senkronize Matris Güncellemeleri (city-details.js)
  updateCityDetails(_buildingData);

  // 4. Buhar ve Damla Parçacık Fiziği Güncellemesi (atmosphere.js)
  updateAtmosphere(delta, driftZ);

  // 5. Ara Sokakların Z Akışı (alleys.js)
  updateAlleys(driftZ);

  // 6. Noir Yayaların Yürüyüş Kinematiği (pedestrians.js)
  updatePedestrians(delta, driftZ);
}


// ── Public Re-Exports ────────────────────────────────────────────────────────
export { setBuildingLightningFactor, getBuildingData };
export { getPedestrianData };
