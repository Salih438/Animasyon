# Rainy Night in 3D: A Cinematic WebGL & Three.js Engineering Case Study

[![Three.js](https://img.shields.io/badge/Three.js-r165-black?style=flat-square&logo=three.js)](https://threejs.org/)
[![WebGL](https://img.shields.io/badge/WebGL-2.0-red?style=flat-square&logo=webgl)](https://www.khronos.org/webgl/)
[![Web Audio API](https://img.shields.io/badge/Web_Audio-Procedural_Sound-purple?style=flat-square)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
[![Performance](https://img.shields.io/badge/Target_FPS-60_Locked-success?style=flat-square)](https://github.com/)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

> **"From 2D Canvas Projection to an Atmospheric, Living, Production-Grade 3D WebGL Boulevard."**  
> Bu çalışma; p5.js ile yazılmış 2D matematiksel izdüşümlü bir yağmurlu gece sahnesinin, sıfırdan modern WebGL (Three.js r165) grafik boru hattına dönüştürülmesini, fiziksel ve optik doğruluğunu, prosedürel Web Audio API ses sentezini ve sıfır-tahsisli (zero-allocation) 60 FPS kilitli gerçek zamanlı mühendislik mimarisini belgeleyen üst düzey bir teknik vaka analizidir (Case Study).

---

## 🎬 Görsel Önizleme & Canlı Etkileşim

```
+-----------------------------------------------------------------------------------------+
|                                                                                         |
|                         [ CINEMATIC OVER-THE-SHOULDER BOULEVARD ]                       |
|                                                                                         |
|      * * * *  Sinematik Yağmurlu Gece: Three.js WebGL & Web Audio Deneyimi  * * * *      |
|                                                                                         |
|   [OMUZ ÜSTÜ KAMERA]  Karakterin (Walker) hemen arkasında (Z = -4.8 m), fötr şapkası,   |
|                       sallanan palto etekleri ve şemsiyesi sahnenin odak noktasında.    |
|   [CANLI CADDE KAOSU] Hızla geçen arabaların sıcak beyaz farları ve kor kırmızısı       |
|                       stopları ıslak asfalta derin dikey ışık şeritleri bırakıyor.      |
|   [ŞEHİR & NEONLAR]   Z = -30 m'den başlayan 48 bina, açılan ara sokak boşlukları ve    |
|                       parlayan 12 adet 3D neon tabela ("HOTEL", "BAR", "DINER", ...).   |
|   [İĞNE YAĞMUR]       1200 adet ince, yarı-saydam beyazımsı gri (0xddeeff) dikey çizgi; |
|                       şemsiye kubbesinden radyal olarak seken damla fiziği.             |
|   [PROSEDÜREL SES]    Web Audio API ile sürekli pembe gürültülü yağmur sesi, uzaktan    |
|                       gelen çift-tonlu araba kornaları ve derin gök gürültüsü.          |
|                                                                                         |
+-----------------------------------------------------------------------------------------+
```

### 🎮 Etkileşim Kontrolleri
* **Fare Sol Tık (Mouse Click / Pointer Down):** Web Audio API ses motorunu başlatır ve anlık çift darbeli şimşek patlamasıyla birlikte derin gök gürültüsü sesini (`Thunder Rumble`) tetikler.
* **Boşluk Tuşu (Spacebar):** Gökyüzünde stokastik şimşek akımı ve gök gürültüsü deşarjı yaratır.
* **Pencere Boyutlandırma (Responsive Resize):** Reflector render target'ı, kamera projeksiyon matrisi ve post-processing composer katmanları tam senkronize güncellenir.

---

## 🏛️ Mimari ve Mühendislik Vurguları (Key Engineering Highlights)

### 1. Over-The-Shoulder (Üçüncü Şahıs) Kamera ve Biyomekanik Karakter (The Walker)
* **Kamera Kompozisyonu:** Kamera, yürüyen karakterin (The Walker) arkasında ve sol omuz hizasında (`X = 2.1, Y = 2.35, Z = -4.8`) konumlandırılmış; ileriye doğru ufka (`X = 0.8, Y = 1.55, Z = 60.0`) bakmaktadır. Karakter ekranın sağ üçte birlik sinematik altın oranında yer alırken, sol tarafta caddenin trafiği, yol çizgileri ve neon yansımaları engelsiz görünür.
* **Hiyerarşik Rig Kinematiği:** Harici GLTF/FBX model kullanılmadan saf matematiksel pivot ağacıyla modellenmiştir. Taban ayak düzlemi kesin olarak $Y = 0.14\text{ m}$ kaldırım seviyesine sıfırlanmıştır.
  $$\theta_{\text{hip}}(t) = A \cdot \sin(2\pi f t), \quad \theta_{\text{knee}}(t) = \max(0, A_k \cdot \sin(2\pi f t - \phi))$$
  Gövde dikey salınımı (bobbing), zıt fazlı kol sallanması, rüzgarda dalgalanan palto eteği ve şemsiye mikro-yaylanmasıyla kusursuz bir film noir silüeti elde edilmiştir.

### 2. İğne Yağmur Sistemi & Analitik Şemsiye Saptırma Fiziği
* **İnce Yağmur Çizgileri:** Donuk kare veya dev yuvarlak toplar yerine 1:8 en-boy oranlı, jilet inceliğinde yarı saydam (boyut: 0.10, renk: `0xddeeff`, opaklık: %50) 1200 damla üretilmiştir.
* **Düşüş Dinamiği:** 34 - 48 m/s yüksek düşüş hızı ve rüzgar eğimi ile havada asılı kalma hissi tamamen ortadan kaldırılmıştır.
* **Raycaster Maliyetsiz Analitik Saptırma:** Şemsiye kubbesi analitik bir koni olarak modellenmiştir:
  $$\Delta X^2 + \Delta Z^2 \le R(y)^2 \quad \text{ve} \quad Y_{\text{rim}} \le y \le Y_{\text{apex}}$$
  Şemsiye yüzeyine çarpan damlalar radyal fışkırma vektörü ($V_{\text{scatter}} \approx 3.5\text{ m/s}$) ve yukarı sıçrama darbesi alarak eteklerden aşağı süzülür. Zemin kotuna ulaşan damlalar sıfır çöp (GC) ile anında gökyüzüne geri aktarılır.

### 3. Gerçekçi Cadde, Yol Çizgileri ve Islak Asfalt Yansıtıcısı
* **2 Şeritli Şehir Caddesi:** Yol koridoru $X: [-7.0, 2.5]$ (genişlik 9.5 m) olarak ölçeklenmiştir.
* **Yol Çizgileri (Road Markings):**
  * **Sarı Kesik Orta Şerit:** $X = -2.25\text{ m}$ ekseninde tek bir `InstancedMesh` ile çizilen kesik sarı çizgiler (`0xf5b025`, emissive 0.25).
  * **Beyaz Kenar Şeritleri:** Yol sınırlarını belirleyen sürekli beyaz güvenlik çizgileri ($X = -6.7\text{ m}$ ve $X = 2.2\text{ m}$).
  * **Yaya Geçidi (Zebra Crossing):** Walker'ın hemen önünde ($Z = 16\text{ m}$) yer alan 8 şeritli reflektif yaya geçidi.
* **Planar Reflector & Su Birikintisi Optiği:** Yansıma düzlemi yalnızca asfalt koridorunda ($|X| \le 10\text{ m}$, $Y = 0.001\text{ m}$) çalışır. Tekerlek izi ve su birikintisi dokusu (`CanvasTexture`), geçen araçların ve sokak lambalarının yansımalarını dikey eksende zarifçe kırarak sinematik ışık şeritlerine dönüştürür.

### 4. Şehir Mimarisi, Ara Sokak Boşlukları ve 3D Neon Tabelalar
* **Kesintisiz Şehir Silüeti:** Binalar kameranın hemen arkasından ($Z = -30\text{ m}$) başlayarak $Z = 1600\text{ m}$ boyunca caddeyi sarar.
* **Sokak Dönüşleri & Kavşak Hissi (Alley Gaps):** Yolun dümdüz bir tünel olmasını önlemek için $Z \approx 36 - 56\text{ m}$ (sağ) ve $Z \approx 96 - 120\text{ m}$ (sol) aralıklarında ara sokak boşlukları bırakılmıştır.
* **12 Adet 3D Parlayan Neon Tabela:** "HOTEL", "BAR", "DINER", "NOIR", "CINEMA", "JAZZ CLUB", "CAFE", "PHARMACY" tabelaları canlı camgöbeği, sıcak amber, kor kırmızısı, zümrüt yeşili ve elektrik moru emissive katsayılarıyla (`emissiveIntensity: 3.2`) binadan yola sarkar. UnrealBloomPass ile yumuşak bir lens parlamasına dönüşür.

### 5. Yoğun Şehir Trafiği & Göreli Hız Fiziği
* **Karşı Şerit (Incoming):** $X = -4.5\text{ m}$ şeridinde kameraya doğru hızla yaklaşan ($V_{\text{rel}} \approx -47\text{ m/s}$) araçlar. Sıcak beyaz ön farlar (`emissive: 3.4`).
* **Aynı Şerit (Outgoing):** $X = -0.5\text{ m}$ şeridinde walker'ın hemen solundan ileriye doğru hızla uzaklaşan ($V_{\text{rel}} \approx +14\text{ m/s}$) araçlar. Kor kırmızısı stop lambaları (`emissive: 3.8`).
* **Sürekli Akış:** Araçlar kameranın hemen önünden ($Z = 18\text{ m}$, $Z = -12\text{ m}$) başlayarak sürekli aktif tutulur; cadde hiçbir an boş kalmaz.

### 6. Saf Web Audio API Prosedürel Ses Motoru (Zero External Files)
* **Sürekli Yağmur Sesi:** Pembe ve beyaz gürültü sentezleyicisi (Pink Noise) + Lowpass BiquadFilter (750 Hz) + LFO rüzgar esintisi modülasyonu.
* **Uzak Araba Kornaları:** Rastgele aralıklarla tetiklenen çift-tonlu osilatör çiftleri (392Hz + 440Hz / 415Hz + 466Hz) ve uzaklık filtrelemesi.
* **Derin Gök Gürültüsü (Thunder Rumble):** Şimşek anında senkron olarak devreye giren 45 Hz sub-bass sinüs vuruşu ve 110 Hz yuvarlanan gürültü patlaması.
* **Otomatik İzin Çözümü:** Kullanıcının sayfaya ilk tıklamasıyla `AudioContext.resume()` çağrılır ve ses kusursuz başlar.

### 7. Dinamik Işık Havuzu (Light Pooling) ve Sokak Lambaları
* **16 Sokak Lambası:** Sağ kaldırım ($X = 2.65\text{ m}$) ve sol kaldırım ($X = -7.18\text{ m}$) bordürlerine yerleştirilmiştir. İlk lamba $Z = 0\text{ m}$'de tam Walker'ın üzerinde yer alarak şemsiyesini ve omzunu sıcak altın sarısı ışıkla aydınlatır.
* **4-PointLight Havuzu:** Kameraya ve karaktere en yakın 4 aktif lamba sıfır heap tahsisiyle dinamik olarak seçilir; GPU gölgelendirici kilitlenmesi önlenir.

### 8. Sinematik Post-Processing (UnrealBloomPass, ACESFilmic, Vignette)
* **Anti-Nuclear Bloom Kuralı:** Eşik değeri $0.78$ olarak ayarlanmıştır. Yalnızca ampuller, araba farları/stopları, neon tabelalar ve şimşek parlar; bina duvarları veya yol çizgileri parlamaz.
* **ACESFilmic Tone Mapping:** Pozlama değeri $1.12$ ile derin gece kontrastı korunurken sıcak renkler zenginleştirilmiştir.
* **Cinematic Vignette:** Ekranın kenarlarında sinematik odak kararması (`offset: 1.05, darkness: 1.25`).

---

## 📊 Performans ve Kaynak Bütçesi

| Metrik | Eski 2D p5.js | Yeni 3D WebGL (Three.js r165) | Mühendislik Kazancı |
|---|---|---|---|
| **Render Motoru** | 2D CPU Canvas Context | Donanım Hızlandırmalı WebGL 2.0 | GPU Paralelleştirmesi |
| **FPS Kararlılığı** | 35 - 50 FPS (Dalgalı) | **60 FPS Kilitli (Locked)** | Akıcı ve Stabil Kare Zamanı |
| **Toplam Draw Call** | N/A (CPU çizim döngüsü) | **~22 - 28 Draw Calls** | Düşük CPU-GPU İletişim Yükü |
| **Binalar & Neonlar** | 32 Ayrı Döngü | **2 Draw Calls** (`InstancedMesh`) + Neonlar | %90 Azalma |
| **Yağmur Parçacıkları** | 420 Damla (CPU çizgi) | **1200 İğne Damla** (GPU Points + CPU Fiziği) | 3 Kat Yoğunluk, Sıfır Gecikme |
| **Ses Sistemi** | Ses Yok (Sessiz) | **Saf Prosedürel Web Audio API** | 0 KB Harici Dosya İndirme |
| **Bellek & GC Baskısı**| Yüksek (Geçici Obje Üretimi) | **0 Byte/Frame (Sıfır Bellek Tahsisi)** | GC Duruşları Yok (No Stutters) |

---

## 📂 Proje Dizin Yapısı

```
Animasyon_Ödevi/
│
├── index.html              # Giriş noktası (Three.js r165 ES Module + importmap + UI)
├── main.js                 # Sahne yöneticisi (Over-the-shoulder kamera, render loop, audio unlock)
│
├── scene/
│   ├── audio.js            # Saf Web Audio API prosedürel ses motoru (yağmur, korna, gök gürültüsü)
│   ├── walker.js           # The Walker (Hiyerarşik insan rig'i, yürüyüş kinematiği, şemsiye)
│   ├── rain.js             # İnce iğne yağmur sistemi, analitik koni şemsiye saptırma fiziği
│   ├── ground.js           # 2 şeritli cadde, Planar Reflector, sarı kesik şeritler, bordürler, yaya geçidi
│   ├── world.js            # 48 bina, ara sokak kavşak boşlukları, 12 parlayan 3D neon tabela
│   ├── traffic.js          # Yoğun şehir trafiği (12 araç), göreli hız fiziği, emissive far/stoplar
│   ├── lighting.js         # 16 sokak lambası, dinamik 4-PointLight havuzu, çift-darbeli şimşek
│   └── postprocessing.js   # EffectComposer, UnrealBloomPass, VignetteShader, OutputPass
│
├── legacy/                 # Orijinal referans kodları
│   ├── Animasyon_ödevi.html
│   └── Animasyon_ödevi.js
│
└── README.md               # Portföy ve mühendislik dokümantasyonu
```

---

## 🚀 Kurulum ve Yerel Çalıştırma

Proje saf ES Modülleri kullandığından dolayı yerel bir HTTP sunucusu üzerinden çalıştırılmalıdır:

```bash
# Seçenek 1: Node.js (npx) ile
npx serve .

# Seçenek 2: Python 3 ile
python -m http.server 8080

# Seçenek 3: VS Code Live Server Eklentisi ile
# index.html üzerinde "Open with Live Server" seçin.
```

Tarayıcınızda açın:
```
http://localhost:8080
```
> **İpucu:** Sayfaya tıkladığınızda veya Boşluk tuşuna bastığınızda atmosferik yağmur sesi, kornalar ve derin gök gürültüsü aktifleşecektir.

---

## 📜 Lisans
Bu çalışma MIT lisansı kapsamında geliştirilmiştir.
