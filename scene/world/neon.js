/**
 * scene/world/neon.js - Neon Tabela Sistemi
 *
 * FAZ 5 Refactor: world.js [B] Sorumluluk Kumesi
 *
 * Sorumluluklar:
 *   - 12 Adet Film Noir Neon Tabela (Canvas texture + emissive mesh)
 *   - Z drift ve sonsuz dongu (wrap) mantigi
 *
 * Bagimliliklar: BUILDING_LINE_RIGHT/LEFT (ground.js)
 */

import * as THREE from 'three';
import { BUILDING_LINE_RIGHT, BUILDING_LINE_LEFT } from '../ground.js';

const NEON_SIGNS = [
  { text: 'HOTEL',     color: 0x00f5ff, isVert: true,  side: 'right', z:   8.0, y: 5.4 },
  { text: 'BAR',       color: 0xff0066, isVert: false, side: 'right', z:  28.0, y: 4.5 },
  { text: 'NOIR',      color: 0xbf00ff, isVert: true,  side: 'right', z:  58.0, y: 6.2 },
  { text: 'CINEMA',    color: 0xffaa00, isVert: false, side: 'right', z:  92.0, y: 5.0 },
  { text: 'DINER',     color: 0xff1133, isVert: false, side: 'right', z: 145.0, y: 4.4 },
  { text: 'MOTEL',     color: 0x00f5ff, isVert: true,  side: 'right', z: 220.0, y: 5.6 },
  { text: 'DINER',     color: 0xff9900, isVert: false, side: 'left',  z:  -2.0, y: 4.8 },
  { text: 'JAZZ CLUB', color: 0x00d4ff, isVert: false, side: 'left',  z:  24.0, y: 5.5 },
  { text: 'CAFE',      color: 0x00ff88, isVert: true,  side: 'left',  z:  52.0, y: 4.6 },
  { text: 'BAR',       color: 0xff0077, isVert: true,  side: 'left',  z:  82.0, y: 6.0 },
  { text: 'PHARMACY',  color: 0x00ff77, isVert: false, side: 'left',  z: 135.0, y: 4.5 },
  { text: 'HOTEL',     color: 0xff1133, isVert: true,  side: 'left',  z: 180.0, y: 5.8 },
];

let _signsGroup = null;

function _createNeonTexture(text, colorHex, isVert) {
  if (typeof document === 'undefined') return null;
  const w = isVert ? 64 : 256;
  const h = isVert ? 256 : 64;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(8, 10, 16, 0.92)';
  ctx.fillRect(2, 2, w - 4, h - 4);
  const hexStr = '#' + colorHex.toString(16).padStart(6, '0');
  ctx.strokeStyle = hexStr; ctx.lineWidth = 3;
  ctx.strokeRect(4, 4, w - 8, h - 8);
  ctx.fillStyle = hexStr;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = hexStr; ctx.shadowBlur = 12;
  if (isVert) {
    ctx.font = 'bold 26px "Courier New", monospace';
    const chars = text.split('');
    const step = (h - 24) / chars.length;
    chars.forEach((ch, idx) => { ctx.fillText(ch, w / 2, 22 + idx * step); });
  } else {
    ctx.font = 'bold 28px "Courier New", monospace';
    ctx.fillText(text, w / 2, h / 2 + 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export function buildNeonSigns(parentGroup) {
  _signsGroup = new THREE.Group();
  _signsGroup.name = 'city_neon_signs';

  NEON_SIGNS.forEach((sign, idx) => {
    const isVert = sign.isVert;
    const signW = isVert ? 0.75 : 3.2;
    const signH = isVert ? 3.0  : 0.85;
    const signD = 0.18;
    const geo = new THREE.BoxGeometry(signW, signH, signD);
    const tex = _createNeonTexture(sign.text, sign.color, isVert);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x111116,
      emissive: new THREE.Color(sign.color),
      emissiveMap: tex,
      emissiveIntensity: 3.2,
      roughness: 0.20,
      metalness: 0.70,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'neon_' + sign.text + '_' + idx;
    const posX = sign.side === 'right' ? (BUILDING_LINE_RIGHT + 0.35) : (BUILDING_LINE_LEFT - 0.35);
    mesh.position.set(posX, sign.y, sign.z);
    if (isVert) mesh.rotation.y = Math.PI / 2;
    _signsGroup.add(mesh);
  });

  parentGroup.add(_signsGroup);
}

export function updateNeonSigns(driftZ) {
  if (!_signsGroup || !_signsGroup.children) return;
  for (let i = 0; i < _signsGroup.children.length; i++) {
    const sign = _signsGroup.children[i];
    sign.position.z -= driftZ;
    if (sign.position.z < -20.0) {
      sign.position.z += 240.0;
    }
  }
}

export function getSignsGroup() {
  return _signsGroup;
}
