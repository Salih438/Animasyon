let W, H;
let VP_X, VP_Y;
const FOCAL   = 300;
const CAM_SPD = 6;

// Şemsiye alanı — her kare _drawWalker() içinde güncellenir,
// RainDrop.update() içinde çarpışma testi için kullanılır.
const umb = { cx: 0, cy: 0, rx: 57, ry: 24 };
 
let worldObjects = [];
let rainDrops    = [];
let lightning    = 0;
 
// ── Kurulum ────────────────────────────────────────
function setup() {
   W = windowWidth;
  H = windowHeight;

  VP_X = W / 2;
  VP_Y = H / 2 - 20;

  const cnv = createCanvas(W, H);
  cnv.parent('canvas-container');
 
  // Binalar — sol/sağ, 250 birim aralıklı
  for (let z = 100; z < 4000; z += 250) {
    worldObjects.push(new Building(-360, z));
    worldObjects.push(new Building( 360, z));
  }
 
  // Sokak lambaları — 500 birim aralıklı
  for (let z = 200; z < 4000; z += 500) {
    worldObjects.push(new StreetLamp(-230, z));
    worldObjects.push(new StreetLamp( 230, z));
  }
 
  // Yol orta çizgileri
  for (let z = 100; z < 4000; z += 300) {
    worldObjects.push(new RoadLine(z));
  }
 
  // Araçlar: 6 sol (bize doğru) + 6 sağ (uzaklaşan)
  for (let i = 0; i < 6; i++) {
    worldObjects.push(new Car(-85, random(400, 3800), 'incoming'));
    worldObjects.push(new Car( 85, random(400, 3800), 'outgoing'));
  }
 
  // Yağmur damlaları
  for (let i = 0; i < 420; i++) rainDrops.push(new RainDrop());
  
}
 
// ── Ana döngü ──────────────────────────────────────
function draw() {
  if (random(1) < 0.004) lightning = 255;
  const sky = map(lightning, 0, 255, 10, 140);
  background(sky, sky + 4, sky + 16);
  if (lightning > 0) lightning = max(0, lightning - 9);
 
  _drawGround();
 
  // Z-sıralama: uzak nesneler önce çizilir
  worldObjects.sort((a, b) => b.z - a.z);
  for (const obj of worldObjects) { obj.update(); obj.draw(); }
 
  // Adam şemsiye konumunu umb nesnesine yazar — yağmurdan önce çağrılmalı
  _drawWalker();
 
  // Yağmur — şemsiye verisini kullanır
  for (const drop of rainDrops) { drop.update(); drop.draw(); }
}
 
function mousePressed() { lightning = 255; }
 
// ── 3D İzdüşüm ─────────────────────────────────────
function project(x, y, z) {
  const pz    = max(z, 1);
  const scale = FOCAL / (FOCAL + pz);
  return { sx: VP_X + x * scale, sy: VP_Y + y * scale, s: scale };
}
 
// ── Z mesafesine göre alfa (fade in / fade out) ────
// z > 3400 → uzakta soluklaşır (yeni doğan nesne görünmez gelir)
// z < 100  → çok yakın, kamera önünde solar
function zAlpha(z) {
  if (z > 3400) return map(z, 3400, 3900, 1.0, 0.0);
  if (z <  100) return map(z,  100,   10, 1.0, 0.0);
  return 1.0;
}
 
// ── Zemin ──────────────────────────────────────────
function _drawGround() {
  noStroke();
 
  // Asfalt
  fill(18, 18, 22);
  triangle(VP_X, VP_Y, VP_X - 260, H, VP_X + 260, H);
 
  // Kaldırımlar
  fill(27, 27, 33);
  triangle(VP_X, VP_Y, -150, H, VP_X - 260, H);
  triangle(VP_X, VP_Y, W + 150, H, VP_X + 260, H);
 
  // Bordür çizgisi
  stroke(58, 58, 70); strokeWeight(1.5);
  line(VP_X, VP_Y, VP_X - 260, H);
  line(VP_X, VP_Y, VP_X + 260, H);
 
  // Islak asfalt gradyan yansıması
  const g = drawingContext.createLinearGradient(VP_X, VP_Y, VP_X, H);
  g.addColorStop(0, 'rgba(35,55,110,0)');
  g.addColorStop(1, 'rgba(35,55,110,0.13)');
  drawingContext.fillStyle = g;
  drawingContext.beginPath();
  drawingContext.moveTo(VP_X, VP_Y);
  drawingContext.lineTo(VP_X - 260, H);
  drawingContext.lineTo(VP_X + 260, H);
  drawingContext.closePath();
  drawingContext.fill();
}
 
// ════════════════════════════════════════════════════
//  SINIFLAR
// ════════════════════════════════════════════════════
 
// ── BİNA ───────────────────────────────────────────
class Building {
  constructor(x, z) {
    this.x = x;
    this.z = z;
    this._randomize();
  }
 
  _randomize() {
    this.w    = random(175, 270);
    this.h    = random(380, 700);
    // Bina gövde rengi: çok koyu, gece tonu
    this.baseR = random(12, 24);
    this.baseG = random(16, 28);
    this.baseB = random(22, 40);
    // Pencere ızgarası boyutu
    this.wCols = floor(random(3, 6));   // 3–5 sütun
    this.wRows = floor(random(5, 9));   // 5–8 satır
    // Her pencerenin yanık/sönük durumu
    this.wLit = Array.from(
      { length: this.wCols * this.wRows },
      () => random(1) < 0.40
    );
  }
 
  update() {
    this.z -= CAM_SPD;
    // Çok yakına gelince sıfırla — uzakta yeniden doğar (fade sayesinde görünmez)
    if (this.z < 5) { this.z = 3900; this._randomize(); }
  }
 
  draw() {
    const base = project(this.x, 150, this.z);
    const top  = project(this.x, 150 - this.h, this.z);
    if (base.s < 0.01) return;
 
    const alpha = zAlpha(this.z);
    drawingContext.globalAlpha = alpha;
 
    const dw = this.w * base.s;
    const dh = base.sy - top.sy;
    const bx = base.sx - dw / 2;  // binanın sol kenarı
 
    // Gövde
    noStroke();
    fill(this.baseR, this.baseG, this.baseB);
    rect(bx, top.sy, dw, dh);
 
    // Hafif kenar aydınlatması (yağmur yansıması)
    stroke(this.baseR + 8, this.baseG + 8, this.baseB + 14);
    strokeWeight(0.8);
    line(bx, top.sy, bx + dw, top.sy);     // çatı
    line(bx, top.sy, bx, base.sy);          // sol kenar
 
    // ── Pencereler ──
    // Pencere hücre boyutları binanın içine tam sığacak şekilde hesaplandı:
    // cols sütun için: bölgeler [0..dw], padding = dw/(cols*2+2)
    if (this.z < 2800) {
      noStroke();
      const cols = this.wCols;
      const rows = this.wRows;
 
      // Her hücrenin genişliği ve yüksekliği
      const cellW = dw / (cols + 1);
      const cellH = dh / (rows + 2);
      // Pencere boyutu: hücrenin %55'i
      const ww = cellW * 0.55;
      const wh = cellH * 0.52;
 
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          // Merkeze hizalı pencere koordinatı
          const px = bx + cellW * (c + 1) - ww / 2;
          const py = top.sy + cellH * (r + 1.2);
 
          const lit = this.wLit[c * rows + r];
 
          if (lightning > 100) {
            fill(185, 210, 255, 130);        // şimşek yansıması
          } else if (lit) {
            fill(255, 218, 125, 185);        // yanık, sıcak sarı
          } else {
            fill(7, 9, 16, 210);             // karanlık
          }
          rect(px, py, ww, wh, 1);
 
          // Yanık pencerede hafif hale
          if (lit && lightning <= 100) {
            fill(255, 218, 80, 18);
            rect(px - 2, py - 2, ww + 4, wh + 4, 2);
          }
        }
      }
    }
 
    drawingContext.globalAlpha = 1.0;
  }
}
 
// ── SOKAK LAMBASI ──────────────────────────────────
class StreetLamp {
  constructor(x, z) {
    this.x    = x;
    this.z    = z;
    this.side = x < 0 ? 1 : -1;   // kol yönü (yola doğru)
  }
 
  update() {
    this.z -= CAM_SPD;
    if (this.z < 5) this.z = 3900;
  }
 
  draw() {
    const base = project(this.x, 152, this.z);
    const tipP = project(this.x, 152 - 185, this.z);
    if (base.s < 0.01) return;
 
    const alpha = zAlpha(this.z);
    drawingContext.globalAlpha = alpha;
 
    // Direk
    stroke(14); strokeWeight(5 * base.s);
    line(base.sx, base.sy, tipP.sx, tipP.sy);
 
    // Yatay kol (yola doğru uzanır)
    const armX = this.x + this.side * 44;
    const armP = project(armX, 152 - 180, this.z);
    strokeWeight(3.5 * base.s);
    line(tipP.sx, tipP.sy, armP.sx, armP.sy);
 
    // Ampul
    noStroke();
    fill(255, 255, 185, 225);
    ellipse(armP.sx, armP.sy, 30 * base.s, 13 * base.s);
 
    // Yere konik ışık
    fill(255, 255, 130, 11);
    triangle(
      armP.sx, armP.sy,
      base.sx - 90 * base.s, base.sy + 16,
      base.sx + 90 * base.s, base.sy + 16
    );
 
    drawingContext.globalAlpha = 1.0;
  }
}
 
// ── YOL ORTA ÇİZGİSİ ──────────────────────────────
class RoadLine {
  constructor(z) { this.z = z; }
 
  update() {
    this.z -= CAM_SPD;
    if (this.z < 5) this.z = 3900;
  }
 
  draw() {
    const p1 = project(0, 148, this.z);
    const p2 = project(0, 148, this.z + 155);
    const alpha = zAlpha(this.z);
    drawingContext.globalAlpha = alpha * 0.75;
    stroke(255, 255, 255, 80);
    strokeWeight(4 * p1.s);
    line(p1.sx, p1.sy, p2.sx, p2.sy);
    drawingContext.globalAlpha = 1.0;
  }
}
 
// ── ARAÇ ───────────────────────────────────────────
// lane: 'incoming' = sol şerit, bize doğru gelir
//       'outgoing' = sağ şerit, uzaklaşır
//
// Fade bölgeleri sayesinde araç sıfırlanırken ekranda
// belirmez veya aniden yok olmaz.
const CAR_COLORS = [
  [195, 28,  28 ],  // kırmızı
  [28,  45,  190],  // lacivert
  [22,  22,  22 ],  // siyah
  [175, 165, 155],  // gümüş
  [18,  75,  28 ],  // koyu yeşil
  [95,  55,  18 ],  // bronz
  [120, 80,  140],  // mor
  [165, 140, 20 ],  // koyu sarı
];
 
class Car {
  constructor(x, z, lane) {
    this.x    = x;
    this.lane = lane;
    this.z    = z;
    this._randomize();
  }
 
  _randomize() {
    this.speed = random(11, 19);
    const c = CAR_COLORS[floor(random(CAR_COLORS.length))];
    this.cr = c[0]; this.cg = c[1]; this.cb = c[2];
  }
 
  update() {
    if (this.lane === 'incoming') {
      // Bize doğru: z azalır
      this.z -= this.speed;
      if (this.z < 5) {
        // Çok uzakta yeniden doğur — fade bölgesinde başlar, görünmez
        this.z = random(3500, 3900);
        this._randomize();
      }
    } else {
      // Uzaklaşan: kamera hızından hızlı değilse ileri gidemez
      this.z += max(0, this.speed - CAM_SPD);
      if (this.z > 3900) {
        // Yakından yeniden başlar — fade bölgesinde başlar
        this.z = random(80, 200);
        this._randomize();
      }
    }
  }
 
  // Car SINIFININ İÇİNDEKİ draw() FONKSİYONUNU ŞUNUNLA DEĞİŞTİR:
  draw() {
    const pt = project(this.x, 145, this.z);
    if (pt.s < 0.01) return;

    drawingContext.globalAlpha = zAlpha(this.z);

    const bodyH  = 28 * pt.s;
    const cabinH = 20 * pt.s;
    const w      = 85 * pt.s; // Genişlik daraltıldı (şeride tam sığar)
    const bx     = pt.sx - w / 2;
    const by     = pt.sy - bodyH;

    noStroke();

    // Zemin gölgesi
    fill(0, 0, 0, 80);
    ellipse(pt.sx, pt.sy + 3, w * 1.1, 7 * pt.s);

    // Gövde
    fill(this.cr, this.cg, this.cb);
    rect(bx, by, w, bodyH, 3 * pt.s);

    // Kabin
    fill(this.cr * 0.68, this.cg * 0.68, this.cb * 0.68);
    rect(bx + w * 0.10, by - cabinH, w * 0.80, cabinH, 3 * pt.s);

    // Cam
    fill(125, 160, 195, 105);
    rect(bx + w * 0.15, by - cabinH + 3 * pt.s, w * 0.70, cabinH * 0.52, 2 * pt.s);

    if (this.lane === 'incoming') {
      // Bize gelen farlar
      fill(255, 255, 218);
      ellipse(pt.sx - w * 0.31, by + bodyH * 0.36, 15 * pt.s, 8 * pt.s);
      ellipse(pt.sx + w * 0.31, by + bodyH * 0.36, 15 * pt.s, 8 * pt.s);
      // Işık konisi
      fill(255, 255, 200, 20);
      triangle(
        pt.sx - w * 0.31, by + bodyH * 0.36,
        pt.sx - w * 2.5,  pt.sy + 100 * pt.s,
        pt.sx,            pt.sy + 100 * pt.s
      );
      triangle(
        pt.sx + w * 0.31, by + bodyH * 0.36,
        pt.sx,            pt.sy + 100 * pt.s,
        pt.sx + w * 2.5,  pt.sy + 100 * pt.s
      );
    } else {
      // Uzaklaşan stoplar
      fill(255, 32, 32);
      ellipse(pt.sx - w * 0.31, by + bodyH * 0.36, 12 * pt.s, 6 * pt.s);
      ellipse(pt.sx + w * 0.31, by + bodyH * 0.36, 12 * pt.s, 6 * pt.s);
      // Yere kırmızı yansıma
      fill(255, 28, 28, 28);
      ellipse(pt.sx, pt.sy + 9 * pt.s, w * 1.4, 10 * pt.s);
    }

    drawingContext.globalAlpha = 1.0;
  }
}
 
// ── YAĞMUR DAMLASI ─────────────────────────────────
// Şemsiye çarpışması:
//   Şemsiye üst-yarım elips:  merkez = (umb.cx, umb.cy)
//   Yatay yarıçap = umb.rx,   dikey yarıçap = umb.ry
//   Yüzey denklemi: ySurf(x) = umb.cy - umb.ry * sqrt(1 - ((x-umb.cx)/umb.rx)^2)
//
//   Damla bu yüzeye çarptığında x koordinatına göre
//   sol veya sağ kenara yönlendirilerek "eteğinden akıyor" efekti yapılır.
class RainDrop {
  constructor() {
    this._reset(true);
    this.divertedX = null;  // şemsiyeden saptırılınca kayan X
  }
 
  _reset(initial) {
    this.x         = random(W + 80);
    this.y         = initial ? random(-H, H) : random(-65, -5);
    this.speed     = random(14, 25);
    this.len       = random(10, 26);
    this.alpha     = random(60, 128);
    this.divertedX = null;
  }
 
  update() {
    // Şemsiye saptırma durumunda: damla şemsiye kenarından
    // düşerek devam eder, artık çarpışma kontrolü yapılmaz.
    if (this.divertedX !== null) {
      this.x  = this.divertedX;
      this.y += this.speed;
      if (this.y > H) this._reset(false);
      return;
    }
 
    this.y += this.speed;
    this.x -= 1.2;
 
    // ── Şemsiye çarpışma testi ──
    const { cx, cy, rx, ry } = umb;
    const dx = this.x - cx;
 
    if (Math.abs(dx) <= rx && this.y <= cy && this.y >= cy - ry - this.speed) {
      // Damla şemsiye bandında — yüzey y'sini hesapla
      const norm    = dx / rx;                              // [-1, 1]
      const surfY   = cy - ry * Math.sqrt(1 - norm * norm);
 
      if (this.y >= surfY - this.speed * 0.5) {
        // Çarpıştı: sol kenara mı, sağ kenara mı saptır?
        if (dx <= 0) {
          this.divertedX = cx - rx;   // sol etekten ak
        } else {
          this.divertedX = cx + rx;   // sağ etekten ak
        }
        this.y     = cy;              // şemsiye kenar seviyesinden başla
        this.speed = random(8, 14);   // biraz yavaşla (etekten damlıyor)
        this.alpha = 90;
        return;
      }
    }
 
    if (this.y > H) this._reset(false);
  }
 
  draw() {
    stroke(140, 170, 255, this.alpha);
    strokeWeight(1.3);
    line(this.x, this.y, this.x - 1.4, this.y + this.len);
  }
}
 
// ════════════════════════════════════════════════════
//  YÜRÜYEN ADAM
//  Her kare umb.cx / umb.cy güncellenir.
// ════════════════════════════════════════════════════
function _drawWalker() {
  const t   = frameCount * 0.11;       // yürüyüş fazı
  const bob = sin(t * 2) * 2.0;        // dikey sallanma
 
  const ax = VP_X + 285;               // sağ kaldırım
  const ay = H - 120 + bob;
 
  // ── Şemsiye merkezi ── (umb güncelle, yağmurdan önce çağrılır)
  const armX = ax + 13;
  const armY = ay + 6;
  const umbCY = armY - 32;
  umb.cx = armX;
  umb.cy = umbCY;
  umb.rx = 57;
  umb.ry = 24;
 
  // Zemin gölgesi
  noStroke(); fill(0, 0, 0, 40);
  ellipse(ax + 4, H - 33, 50, 12);
 
  // ── Bacaklar ──
  const swing = sin(t) * 18;
  stroke(7, 7, 11); strokeWeight(7);
  // Sol bacak
  line(ax, ay + 38, ax - swing, ay + 78);
  line(ax - swing, ay + 78, ax - swing + 7, ay + 90);   // ayak
  // Sağ bacak
  line(ax, ay + 38, ax + swing, ay + 78);
  line(ax + swing, ay + 78, ax + swing + 7, ay + 90);   // ayak
 
  // ── Gövde / Palto ──
  noStroke(); fill(8, 8, 12);
  rect(ax - 19, ay - 2, 38, 50, 9);
 
  // Palto eteği — yürüyüşe göre sallanır
  fill(6, 6, 10);
  triangle(ax - 19, ay + 46, ax - 27, ay + 64 + sin(t) * 3, ax,      ay + 50);
  triangle(ax + 19, ay + 46, ax + 27, ay + 64 - sin(t) * 3, ax,      ay + 50);
 
  // ── Kafa ──
  fill(36, 24, 20); ellipse(ax, ay - 14, 30, 32);
 
  // Şapka ağzı ve tacı
  fill(5, 5, 9);
  rect(ax - 17, ay - 30, 34, 13, 2);  // ağız
  rect(ax - 12, ay - 43, 24, 15, 3);  // taç
 
  // ── Kol ──
  stroke(8, 8, 13); strokeWeight(6);
  line(ax + 8, ay + 14, armX, armY - 20);
 
  // Şemsiye sapı
  stroke(13, 13, 22); strokeWeight(4);
  line(armX, armY - 20, armX + 14, ay + 28);
 
  // ── Şemsiye kapağı (üst yarım elips) ──
  noStroke(); fill(10, 11, 21);
  arc(armX, umbCY, umb.rx * 2, umb.ry * 2, PI, TWO_PI);
 
  // İç dilimleri
  stroke(17, 19, 40); strokeWeight(1.3);
  for (let i = 0; i <= 7; i++) {
    const ang = PI + (i / 7) * PI;
    line(
      armX, umbCY,
      armX + cos(ang) * umb.rx,
      umbCY + sin(ang) * umb.ry   
    );
  }
 
  // Şemsiye dış kenar parlaması
  noFill();
  stroke(50, 60, 125, 85); strokeWeight(2);
  arc(armX, umbCY, umb.rx * 2, umb.ry * 2, PI, TWO_PI);
} 
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);

  W = windowWidth;
  H = windowHeight;

  VP_X = W / 2;
  VP_Y = H / 2 - 20;
}