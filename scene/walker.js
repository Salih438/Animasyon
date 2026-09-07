/**
 * scene/walker.js — First-Person POV (FPS Viewmodel Umbrella)
 *
 * KONSEPT: "ADAM BİZİZ" (We are the Walker).
 * Üçüncü şahıs arkadan görünen yapay karakter gövdesi tamamen kaldırıldı.
 * Kullanıcı yağmurlu gecede elinde şemsiyeyle caddede kendisi yürüyor.
 *
 * MİMARİ:
 *   - FPS Viewmodel Şemsiye: Kameraya doğrudan bağlı (camera.add), ekranın üst ve sağ
 *     kısmını çevreleyen açık kumaş kubbe, metalik teller (ribs), baston gövdesi ve J-kulp.
 *   - Doğal Yaylanma ve Damping (Viewmodel Inertia):
 *       Kullanıcı adım attıkça şemsiye kollarımızın doğal yaylanmasıyla hafif gecikmeli
 *       (damped harmonic lag) olarak salınır.
 *   - Yağmur Saptırma Entegrasyonu (Rain Deflection):
 *       `getUmbrellaCollider()` şemsiyenin kubbe dünya koordinatını her frame günceller;
 *       başımızın üstüne yağan damlalar şemsiyeden sekip ekranın kenarlarından aşağı süzülür.
 *   - SIFIR BELLEK TAHSİSİ (Zero Heap Allocation in updateLoop):
 *       updateWalker içinde new THREE.* tahsisi yapılmaz.
 */

import * as THREE from 'three';

// ══════════════════════════════════════════════════════════════════════════════
// VIEWMODEL DEFAULT TRANSFORMS (Camera-Local Space)
// ══════════════════════════════════════════════════════════════════════════════

// Şemsiye kök grubunun kamera yerel koordinatlarındaki baz konumu ve rotasyonu
// Ekranın üst-sağ kısmını zarifçe saracak ve yolun önünü (orta ve alt %70) tamamen açık bırakacak şekilde kalibre edilmiştir.
const BASE_POS = Object.freeze({
  x:  0.22,
  y:  0.20,
  z: -0.62,
});

const BASE_ROT = Object.freeze({
  x:  0.18,
  y: -0.28,
  z:  0.10,
});

// Yürüyüş frekansı ve salınım genlikleri
const STRIDE_FREQ   = 3.8;   // rad/s (main.js ile senkronize adım frekansı)
const SWAY_POS_X    = 0.014; // Yatay salınım genliği (m)
const SWAY_POS_Y    = 0.020; // Dikey salınım genliği (m)
const SWAY_ROT_Z    = 0.022; // Z ekseni yatma genliği (rad)
const SWAY_ROT_X    = 0.016; // X ekseni öne-arkaya yaylanma (rad)
const LAG_PHASE     = 0.28;  // Kol ağırlığı hissi için adım gecikmesi (rad)

// Şemsiye geometrik boyutları
const CANOPY_RADIUS = 0.85;  // Kubbe yarıçapı
const CANOPY_HEIGHT = 0.26;  // Kubbe derinliği
const CANOPY_SEGS   = 16;    // Kubbe dilim sayısı (teller için 16 segment)
const SHAFT_RADIUS  = 0.007; // Baston gövde yarıçapı
const SHAFT_LENGTH  = 0.98;  // Baston uzunluğu
const HANDLE_RADIUS = 0.038; // J-kulp kıvrım yarıçapı
const HANDLE_TUBE   = 0.011; // J-kulp boru kalınlığı

// ══════════════════════════════════════════════════════════════════════════════
// MODULE STATE
// ══════════════════════════════════════════════════════════════════════════════

let _fpsGroup    = null; // Kameraya eklenen görünüm modeli kök grubu
let _canopyMesh  = null; // Kubbe mesh referansı (dünya pozisyonu hesaplama için)
let _walkTime    = 0;    // Yürüyüş zamanı (saniye)

// Zero-allocation dünya pozisyonu vektörü
const _umbCenter = new THREE.Vector3();

// Phase 4 rain.js için çarpışma nesnesi
const _umbCollider = Object.freeze({
  center: _umbCenter,
  radius: CANOPY_RADIUS,
});

// ══════════════════════════════════════════════════════════════════════════════
// MATERIALS
// ══════════════════════════════════════════════════════════════════════════════

function _createMaterials() {
  return {
    // Kumaş: Koyu antrasit-lacivert su geçirmez şemsiye kumaşı (çift taraflı)
    canopy: new THREE.MeshStandardMaterial({
      color:     0x121622,
      roughness: 0.35,
      metalness: 0.15,
      side:      THREE.DoubleSide,
    }),
    // Metalik teller ve tepe ucu: Koyu çelik
    ribs: new THREE.MeshStandardMaterial({
      color:     0x3a3d48,
      roughness: 0.30,
      metalness: 0.80,
    }),
    // Baston sapı gövdesi: Mat siyah alüminyum/karbon çubuk
    shaft: new THREE.MeshStandardMaterial({
      color:     0x18181c,
      roughness: 0.30,
      metalness: 0.60,
    }),
    // Baston kulpu (J-Handle): Cilalı koyu maun ahşap / deri tutuş
    handle: new THREE.MeshStandardMaterial({
      color:     0x241812,
      roughness: 0.45,
      metalness: 0.10,
    }),
    // Metalik halka / manşet: Parlak pirinç vurgu
    brass: new THREE.MeshStandardMaterial({
      color:     0xd4af37,
      roughness: 0.25,
      metalness: 0.85,
    }),
    // Damla damlayan uçlar
    drips: new THREE.MeshStandardMaterial({
      color:       0xccddff,
      roughness:   0.10,
      metalness:   0.10,
      transparent: true,
      opacity:     0.75,
    }),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// GEOMETRY BUILDERS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * FPS Şemsiye görünüm modelini (Viewmodel) inşa eder.
 * Model yerel olarak başımızın üstünde durup sağ elimize uzanacak biçimde tasarlanmıştır.
 */
function _buildFpsUmbrella(mat) {
  const root = new THREE.Group();
  root.name = 'fpsUmbrellaRoot';

  // ── 1. Şemsiye Kubbesi (Canopy) ──────────────────────────────────────────
  // Açık koni kabuğu (openEnded: true). Kubbenin içi ve dışı görünür.
  const canopyGeo = new THREE.ConeGeometry(
    CANOPY_RADIUS,
    CANOPY_HEIGHT,
    CANOPY_SEGS,
    2,
    true
  );

  // Koni tepe noktası yerel Y=+CANOPY_HEIGHT/2; taban rim Y=-CANOPY_HEIGHT/2
  _canopyMesh = new THREE.Mesh(canopyGeo, mat.canopy);
  _canopyMesh.name = 'umbrellaCanopy';
  _canopyMesh.castShadow = true;

  // Kubbenin başımızın üstüne yerleşimi (kök gruba göre)
  // Tepe ucu biraz ileride ve yukarıda; etekler aşağı doğru açılır
  _canopyMesh.position.set(-0.04, 0.24, -0.15);
  _canopyMesh.rotation.x = -0.12;
  _canopyMesh.rotation.z =  0.08;
  root.add(_canopyMesh);

  // ── 2. Kubbe Tepe Ferrule Ucu (Top Apex Tip) ─────────────────────────────
  const tipGeo = new THREE.CylinderGeometry(0.012, 0.016, 0.06, 12);
  const tipMesh = new THREE.Mesh(tipGeo, mat.brass);
  tipMesh.position.set(0, CANOPY_HEIGHT / 2 + 0.03, 0);
  _canopyMesh.add(tipMesh);

  const finialGeo = new THREE.SphereGeometry(0.014, 12, 8);
  const finialMesh = new THREE.Mesh(finialGeo, mat.brass);
  finialMesh.position.set(0, 0.03, 0);
  tipMesh.add(finialMesh);

  // ── 3. Şemsiye Telleri (Canopy Ribs / Spoke Framework) ───────────────────
  // 16 dilimin her birinin iç yüzeyine oturan ince metalik teller
  const ribGeo = new THREE.CylinderGeometry(0.0025, 0.0025, 1.0, 6);
  const ribMat = mat.ribs;

  const apexY = CANOPY_HEIGHT / 2;
  const rimY  = -CANOPY_HEIGHT / 2;

  for (let i = 0; i < CANOPY_SEGS; i++) {
    const angle = (i / CANOPY_SEGS) * Math.PI * 2;
    const rimX  = Math.cos(angle) * CANOPY_RADIUS;
    const rimZ  = Math.sin(angle) * CANOPY_RADIUS;

    // Apex'ten rim noktasına vektör
    const start = new THREE.Vector3(0, apexY, 0);
    const end   = new THREE.Vector3(rimX, rimY, rimZ);
    const length = start.distanceTo(end);

    const ribMesh = new THREE.Mesh(ribGeo, ribMat);
    ribMesh.scale.set(1, length, 1);

    // Konum: iki ucun ortası
    ribMesh.position.copy(start).add(end).multiplyScalar(0.5);

    // Yönlendirme: start'tan end'e baksın
    ribMesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      end.clone().sub(start).normalize()
    );

    _canopyMesh.add(ribMesh);

    // Tel ucundaki küçük parlak koruma damlası
    const capGeo = new THREE.SphereGeometry(0.006, 8, 6);
    const capMesh = new THREE.Mesh(capGeo, mat.brass);
    capMesh.position.set(rimX, rimY, rimZ);
    _canopyMesh.add(capMesh);
  }

  // ── 4. Baston Gövdesi (Central Shaft) ────────────────────────────────────
  // Kubbe tepesinden sağ elimize uzanan ana metalik boru
  const shaftGeo = new THREE.CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, SHAFT_LENGTH, 12);
  const shaftMesh = new THREE.Mesh(shaftGeo, mat.shaft);
  shaftMesh.name = 'umbrellaShaft';

  // Apex noktasından aşağı sağa doğru eğimli uzanır
  shaftMesh.position.set(0.05, -0.16, 0.08);
  shaftMesh.rotation.x = -0.22;
  shaftMesh.rotation.z = -0.26;
  root.add(shaftMesh);

  // ── 5. Alt Runner Halka ve Gergi Kolları (Stretcher Ring) ────────────────
  const runnerGeo = new THREE.CylinderGeometry(SHAFT_RADIUS * 1.5, SHAFT_RADIUS * 1.5, 0.035, 12);
  const runnerMesh = new THREE.Mesh(runnerGeo, mat.brass);
  runnerMesh.position.set(0, 0.16, 0);
  shaftMesh.add(runnerMesh);

  // ── 6. Baston Kulpu (Curved J-Handle) ─────────────────────────────────────
  // Sağ alt köşede kullanıcının tutuşunu hissettiren klasik kıvrık baston kulpu
  const handleGroup = new THREE.Group();
  handleGroup.name = 'umbrellaHandle';
  handleGroup.position.set(0, -SHAFT_LENGTH / 2, 0);
  shaftMesh.add(handleGroup);

  // Pirinç geçiş boğazı
  const collarGeo = new THREE.CylinderGeometry(SHAFT_RADIUS * 1.6, SHAFT_RADIUS * 1.3, 0.04, 12);
  const collarMesh = new THREE.Mesh(collarGeo, mat.brass);
  collarMesh.position.set(0, -0.02, 0);
  handleGroup.add(collarMesh);

  // Düz ahşap kavrama kısmı
  const gripGeo = new THREE.CylinderGeometry(HANDLE_TUBE * 1.1, HANDLE_TUBE * 1.1, 0.11, 12);
  const gripMesh = new THREE.Mesh(gripGeo, mat.handle);
  gripMesh.position.set(0, -0.09, 0);
  handleGroup.add(gripMesh);

  // Yarım daire Torus kıvrımı (J-Hook)
  const hookGeo = new THREE.TorusGeometry(
    HANDLE_RADIUS,
    HANDLE_TUBE,
    10,
    20,
    Math.PI * 0.92
  );
  const hookMesh = new THREE.Mesh(hookGeo, mat.handle);
  hookMesh.position.set(-HANDLE_RADIUS, -0.14, 0);
  hookMesh.rotation.z = Math.PI / 2;
  handleGroup.add(hookMesh);

  // Kulp ucu pirinç kapak
  const endCapGeo = new THREE.SphereGeometry(HANDLE_TUBE * 1.15, 10, 8);
  const endCapMesh = new THREE.Mesh(endCapGeo, mat.brass);
  endCapMesh.position.set(-HANDLE_RADIUS * 2, -0.14, 0);
  handleGroup.add(endCapMesh);

  return root;
}

// ══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════════════════════════════════════

/**
 * First-Person Şemsiyeyi başlatır ve kameraya ekler.
 *
 * @param {THREE.Scene}             scene
 * @param {THREE.Group}            [group]
 * @param {object}                 [config]
 * @param {THREE.PerspectiveCamera}[camera]
 */
export async function initWalker(scene, group, config, camera) {
  const mat = _createMaterials();

  // FPS Viewmodel şemsiyesini oluştur
  _fpsGroup = _buildFpsUmbrella(mat);

  // Baz transformlarını ayarla
  _fpsGroup.position.set(BASE_POS.x, BASE_POS.y, BASE_POS.z);
  _fpsGroup.rotation.set(BASE_ROT.x, BASE_ROT.y, BASE_ROT.z);

  // Kameraya bağla (camera-local space)
  if (camera) {
    camera.add(_fpsGroup);
    if (!camera.parent) {
      scene.add(camera);
    }
  } else {
    // Fallback: doğrudan sahneye veya hedef gruba ekle
    const target = group || scene;
    target.add(_fpsGroup);
  }

  // İlk dünya koordinatını hesapla
  if (_canopyMesh) {
    _canopyMesh.getWorldPosition(_umbCenter);
  }
}

/**
 * Yürüyüş döngüsü senkronizasyonu ve şemsiyenin gecikmeli (damped) yaylanması.
 *
 * Matematik:
 *   lagTime = walkTime - LAG_PHASE
 *   pos.x = BASE.x + sin(lagTime) * SWAY_POS_X
 *   pos.y = BASE.y + sin(lagTime * 2) * SWAY_POS_Y
 *   rot.z = BASE.z + sin(lagTime) * SWAY_ROT_Z
 *   rot.x = BASE.x + sin(lagTime * 2) * SWAY_ROT_X
 *
 * SIFIR ALLOCATION: Her frame 0 heap tahsisi.
 *
 * @param {number} delta — Frame delta süresi (saniye)
 */
export function updateWalker(delta) {
  if (!_fpsGroup) return;

  _walkTime += delta * STRIDE_FREQ;

  // Gecikmeli harmonik osilatörler (İnsan kolunun ataleti)
  const lagTime  = _walkTime - LAG_PHASE;
  const sLag     = Math.sin(lagTime);
  const sLag2    = Math.sin(lagTime * 2);

  // 1. Damped Viewmodel Sway
  _fpsGroup.position.x = BASE_POS.x + sLag  * SWAY_POS_X;
  _fpsGroup.position.y = BASE_POS.y + sLag2 * SWAY_POS_Y;

  _fpsGroup.rotation.z = BASE_ROT.z + sLag  * SWAY_ROT_Z;
  _fpsGroup.rotation.x = BASE_ROT.x + sLag2 * SWAY_ROT_X;

  // 2. Yağmur Çarpışma Collider Koordinatını Güncelle (Zero Alloc)
  if (_canopyMesh) {
    _canopyMesh.getWorldPosition(_umbCenter);
    // Kubbe merkez ofseti
    _umbCenter.y += CANOPY_HEIGHT * 0.15;
  }
}

/**
 * Şemsiye çarpışma verisini döndürür (Phase 4 rain.js entegrasyonu).
 *
 * @returns {{ center: THREE.Vector3, radius: number }}
 */
export function getUmbrellaCollider() {
  return _umbCollider;
}
