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
|                         [ FIRST-PERSON POV BOULEVARD — "ADAM BİZİZ" ]                   |
|                                                                                         |
|      * * * *  Sinematik Yağmurlu Gece: Three.js WebGL & Web Audio Deneyimi  * * * *      |
|                                                                                         |
|   [SAĞ KALDIRIMDA YÜRÜYÜŞ] Kullanıcı sağ kaldırımın ortasında yürür (baseX = -3.80 m,   |
|                            baseY = 1.78 m: 0.14 m kaldırım kotu + 1.64 m insan boyu).   |
|   [ETKİLEŞİMLİ KAFA DÖNÜŞÜ]← / A ile caddeye (+31.5°), → / D ile binalara (-31.5°)     |
|                            yumuşak bakış; tuş bırakıldığında sönümlü merkeze dönüş.     |
|   [FPS ŞEMSİYE VİEWMODEL]  Kameraya bağlı açık kumaş kubbe, çelik teller, baston şaftı |
|                            ve sağ altta J-kulp; kafa dönüşünde kol ataleti sergiler.    |
|   [HEAD-BOBBING DİNAMİĞİ]  Doğal adım dinamiği: sin(2t)*0.045 dikey yaylanma,           |
|                            sin(t)*0.025 yatay salınım ve rotateZ(sin(t)*0.01) adım roll.|
|   [YÜKSEK KONTRASTLI YOL]  Derin zift siyahı ıslak asfalt, 26 cm yüksek granit bordür,  |
|                            parlayan sarı kesik çizgiler ve reflektif yaya geçidi.       |
|   [YAŞAYAN ŞEHİR & YAYALAR]Sağda derin ara sokaklar, amber sokak fenerleri ve           |
|                            kaldırımlarda gizemli fötr şapkalı, şemsiyeli noir silüetler.|
|   [TRAFİK DİNAMİĞİ]        Solumuzda akan giden araçlar (kırmızı stoplar) ve karşıdan   |
|                            yaklaşan araçlar (parlak farlar) ile canlı 12 araçlık filo.  |
|   [İĞNE YAĞMUR SİSTEMİ]    1200 ince dikey iğne damla; analitik şemsiye saptırma fiziği.|
|   [PROSEDÜREL SES MOTORU]  Saf Web Audio API ile pembe gürültü yağmur, korna & şimşek.  |
|                                                                                         |
+-----------------------------------------------------------------------------------------+
```

### 🎮 Etkileşim Kontrolleri
* **Sol Yön Tuşu (`ArrowLeft` / `A`):** Başımızı sola, ana caddeye, yanımızdan geçen araçlara ve karşı kaldırıma çevirir (hedef yaw: $+31.5^\circ \approx +0.55\text{ rad}$).
* **Sağ Yön Tuşu (`ArrowRight` / `D`):** Başımızı sağa, binaların cephelerine, neon tabelalara ve ara sokaklara çevirir (hedef yaw: $-31.5^\circ \approx -0.55\text{ rad}$).
* **Tuş Bırakıldığında (Smooth Return):** Kamera exponential damping sönümlemesiyle ($1 - e^{-8.5\Delta t}$) yumuşakça ileriye ($0^\circ$) döner.
* **Fare Sol Tık (Mouse Click / Pointer Down):** Web Audio API ses motorunu başlatır ve anlık çift darbeli şimşek patlamasıyla birlikte derin gök gürültüsü sesini (`Thunder Rumble`) tetikler.
* **Boşluk Tuşu (Spacebar):** Gökyüzünde stokastik çift darbeli şimşek akımı ve gök gürültüsü deşarjı yaratır.
* **Pencere Boyutlandırma (Responsive Resize):** Reflector render target'ı, kamera projeksiyon matrisi ve post-processing composer katmanları tam senkronize güncellenir.

---

## 🏛️ Mimari ve Mühendislik Vurguları (Key Engineering Highlights)

### 1. First-Person POV ("ADAM BİZİZ") & Biyomekanik Head-Bobbing
* **Kamera Kompozisyonu:** Karakter yolun ortasından alınarak güvenle **sağ kaldırıma** yerleştirilmiştir. Kamera insan göz hizasında (`baseY = 1.78 m`) ve sağ kaldırım merkezinde (`baseX = -3.80 m`) konumlandırılmış; cadde kaçış noktasına (`lookAt: { x: -1.00, y: 1.55, z: 120.0 }`) odaklanmıştır.
* **Biyomekanik Adım Dinamiği (Camera Stride Oscillators):**
  $$\text{camera.position.y}(t) = 1.78 + \sin(2 \cdot \omega t) \cdot 0.045$$
  $$\text{camera.position.x}(t) = -3.80 + \sin(\omega t) \cdot 0.025$$
  $$\text{camera.position.z}(t) = 0.00$$
  $$\text{camera.rotateZ}(t) = \sin(\omega t) \cdot 0.01$$
  *(Adım frekansı $\omega = 3.8\text{ rad/s}$; Euler tekilliğini önlemek için yerel quaternion `rotateZ` kullanılmıştır).*
* **Etkileşimli Kafa Dönüşü (Interactive Head Turn):**
  $$\text{targetYaw} = \begin{cases} +0.55\text{ rad } (+31.5^\circ) & \text{ArrowLeft / A (Caddeye bakış)} \\ -0.55\text{ rad } (-31.5^\circ) & \text{ArrowRight / D (Binalara bakış)} \\ 0.00\text{ rad } (0^\circ) & \text{Serbest (İleriye bakış)} \end{cases}$$
  $$\text{headYaw} = \text{lerp}(\text{headYaw}, \text{targetYaw}, 1 - e^{-8.5 \cdot \Delta t})$$
* **FPS Viewmodel Şemsiye:** Kameraya doğrudan bağlı (`camera.add(_fpsGroup)`), 16 dilimli koni kubbe (`radius: 0.72 m, height: 0.22 m`), çelik iç teller, metalik baston şaftı ve sağ alt köşede ergonomik J-kulp. Kafa sağa veya sola döndüğünde şemsiye kolun doğal ataletini simüle eden karşı-salınımlı sönümleme sergiler:
  $$\text{fpsGroup.rotation.y} = \text{BASE\_ROT.y} - \text{headYaw} \times 0.22$$
  $$\text{fpsGroup.position.x} = \text{BASE\_POS.x} + \sin(\text{lagTime}) \cdot 0.010 - \text{headYaw} \times 0.035$$

### 2. İğne Yağmur Sistemi & Analitik Şemsiye Saptırma Fiziği
* **İnce Yağmur Çizgileri:** Donuk kare veya dev yuvarlak toplar yerine 1:8 en-boy oranlı ($8 \times 64\text{ px}$ CanvasTexture), jilet inceliğinde yarı saydam (`size: 0.10, color: 0xddeeff, opacity: 0.50`) **1200 damla** üretilmiştir.
* **Düşüş Dinamiği:** 34.0 - 48.0 m/s yüksek düşüş hızı ve rüzgar eğimi (`windX: -2.6, windZ: -0.8`) ile havada asılı kalma hissi tamamen ortadan kaldırılmıştır.
* **Raycaster Maliyetsiz Analitik Saptırma:** Şemsiye kubbesi analitik bir koni olarak modellenmiştir:
  $$\Delta X^2 + \Delta Z^2 \le R(y)^2 \quad \text{ve} \quad Y_{\text{rim}} \le y \le Y_{\text{apex}}$$
  Şemsiye yüzeyine çarpan damlalar radyal fışkırma vektörü ($V_{\text{scatter}} \approx 3.5\text{ m/s}$) ve yukarı sıçrama darbesi alarak eteklerden aşağı süzülür. Zemin kotuna ulaşan damlalar sıfır çöp (GC) ile anında gökyüzüne geri aktarılır.

### 3. Yüksek Kontrastlı Yol, Granit Bordürler ve Islak Asfalt Yansıtıcısı
* **Yol ve Kaldırım Sınırları:**
  * Ana Cadde: $X \in [-2.55\text{ m}, +6.20\text{ m}]$ ($8.75\text{ m}$ genişlik, $3000\text{ m}$ uzunluk).
  * Sağ Kaldırım (Yürüdüğümüz taraf): $X = -4.40\text{ m}$ merkezli ($3.20\text{ m}$ genişlik, $0.14\text{ m}$ yükseklik; kamera $X = -3.80\text{ m}$'de yürür).
  * Sağ Bordür Taşı: $X = -2.72\text{ m}$ merkezli ($0.35\text{ m}$ genişlik, $0.26\text{ m}$ yükseklik — asfalttan $26\text{ cm}$, kaldırımdan $12\text{ cm}$ yüksek, ıslak granit `0x3a3f50`).
  * Karşı Sol Bordür & Kaldırım: $X = 6.37\text{ m}$ ve $X = 8.05\text{ m}$.
* **Koyu Zift Asfaltı:** Derin siyah kontrast (`color: 0x090b10, roughness: 0.18, metalness: 0.28`).
* **Yol Çizgileri (Road Markings):**
  * **Sarı Kesik Orta Şerit:** Yolun tam ortasında ($X = +1.825\text{ m}$), $7.0\text{ m}$ periyotlu ($3.2\text{ m}$ boya + $3.8\text{ m}$ boşluk) 3D kabartma `InstancedMesh` (`color: 0xffcc00, emissive: 0xff9900, emissiveIntensity: 1.80`).
  * **Beyaz Kenar Şeritleri:** Sağ bordür dibi ($X = -2.37\text{ m}$) ve sol bordür dibi ($X = +6.02\text{ m}$) kesintisiz güvenlik çizgileri (`color: 0xffffff, emissiveIntensity: 1.10`).
  * **Yaya Geçidi (Zebra Crossing):** Başlangıçta hemen önümüzde ($Z = 14.0\text{ m}$) yer alan 8 bloklu reflektif yaya geçidi.
* **Planar Reflector & Su Birikintisi Optiği:** Yansıma düzlemi yalnızca asfalt koridorunda ($Y = 0.001\text{ m}$) çalışır. Tekerlek izi ve su birikintisi dokusu (`CanvasTexture`), geçen araçların ve sokak lambalarının yansımalarını dikey eksende zarifçe kırarak sinematik ışık şeritlerine dönüştürür (`uBlendFactor: 0.28`).

### 4. Yaşayan Şehir: Ara Sokaklar, Gizemli Yayalar ve 3D Neon Tabelalar
* **Kesintisiz Şehir Silüeti:** 48 bina (24 Sol + 24 Sağ), $Z = -30\text{ m}$'den $Z = 1600\text{ m}$'ye kadar uzanır. Prosedürel $256 \times 512$ pencere dokusu şimşek parlamasıyla senkronize parlar ($0.30 \to 2.00$).
* **Ara Sokak Geçişleri (Cross Alleys):** Sağ tarafımızda binalar belirli aralıklarla kesilerek içeriye doğru uzanan 3 derin ara sokak açılmıştır ($Z = 34.0\text{ m}, 104.0\text{ m}, 180.0\text{ m}$). Sokak ağızlarında tuğla yan duvarlar, zemin taşları ve sıcak amber köşe fenerleri (`0xff8822`, $1.4\text{ cd}$ PointLight) yer alır.
* **Gizemli Noir Yayalar (Pedestrians):** Şehrin terk edilmişlik hissini kıran 4 adet low-poly fötr şapkalı, uzun paltolu ve şemsiyeli noir silüet:
  * Karşı sol kaldırımda karşıdan gelen yaya ($X = 7.8\text{ m}, Z = 42.0\text{ m}$, yürüme hızı $-1.3\text{ m/s}$).
  * Karşı sol kaldırımda uzaklaşan yaya ($X = 8.3\text{ m}, Z = 86.0\text{ m}$, yürüme hızı $+1.1\text{ m/s}$).
  * Sağ 1. ara sokak köşesinde yağmurdan sığınan yaya ($X = -5.65\text{ m}, Z = 34.0\text{ m}$, duraklama nefes animasyonu).
  * Sağ 2. ara sokak ağzında bekleyen gizemli figür ($X = -6.40\text{ m}, Z = 104.0\text{ m}$).
* **12 Adet 3D Parlayan Neon Tabela:** "HOTEL", "BAR", "DINER", "NOIR", "CINEMA", "JAZZ CLUB", "CAFE", "PHARMACY", "MOTEL" tabelaları canlı camgöbeği, sıcak amber, kor kırmızısı, zümrüt yeşili ve elektrik moru emissive katsayılarıyla (`emissiveIntensity: 3.2`) binadan yola sarkar. UnrealBloomPass ile yumuşak lens parlamasına dönüşür.

### 5. Yoğun Şehir Trafiği & Göreli Hız Fiziği
* **Toplam 12 Araçlık Filo:** 3 kasa tipi (Sedan, Hatchback, SUV) ve 12 zengin gece metalik rengi.
* **Aynı Yön Şeridi (Outgoing):** $X = -0.45\text{ m}$ şeridinde kameranın $3.35\text{ m}$ solundan ileriye doğru uzaklaşan araçlar (içsel hız: $16 - 22\text{ m/s}$, bağıl hız: $V_{\text{rel}} \approx +13.2 \text{ ile } +19.2\text{ m/s}$). Kor kırmızısı stop lambaları (`emissiveIntensity: 3.8`).
* **Karşı Şerit (Incoming):** $X = 3.90\text{ m}$ karşı sol şeritte kameraya doğru hızla yaklaşan araçlar (içsel hız: $18 - 24\text{ m/s}$, bağıl hız: $V_{\text{rel}} \approx -20.8 \text{ ile } -26.8\text{ m/s}$). Sıcak beyaz ön farlar (`emissiveIntensity: 3.4`).
* **Sürekli Akış:** Araçlar kameranın arkasında ($Z = -35\text{ m}$) ve ufukta ($Z = 340\text{ m}$) sürekli döngüye sokulur.

### 6. Saf Web Audio API Prosedürel Ses Motoru (Zero External Files)
* **Sürekli Yağmur Sesi:** Pembe ve beyaz gürültü sentezleyicisi (Pink Noise) + Lowpass BiquadFilter (750 Hz) + LFO rüzgar esintisi modülasyonu (600 - 900 Hz).
* **Uzak Araba Kornaları:** Rastgele aralıklarla tetiklenen çift-tonlu osilatör çiftleri (392Hz + 440Hz / 415Hz + 466Hz) ve uzaklık filtrelemesi.
* **Derin Gök Gürültüsü (Thunder Rumble):** Şimşek anında senkron olarak devreye giren 45 Hz sub-bass sinüs vuruşu ve 110 Hz yuvarlanan gürültü patlaması (3.5s üstel sönüm).
* **Otomatik İzin Çözümü:** Kullanıcının sayfaya ilk tıklamasıyla `AudioContext.resume()` çağrılır ve ses motoru başlar.

### 7. Dinamik Işık Havuzu (Light Pooling) ve Sokak Lambaları
* **16 Sokak Lambası:** Sağ bordür ($X = -2.75\text{ m}$) ve sol bordür ($X = 6.35\text{ m}$) üzerinde, $Z = 2, 16, 32, 50, 72, 100, 135, 180\text{ m}$ pozisyonlarında yer alır. Üst kollar yola doğru uzanır; ampuller $Y = 5.25\text{ m}$ kotundadır (`emissiveIntensity: 3.8`).
* **Dinamik 4-PointLight Havuzu:** GPU forward rendering sınırlarını korumak için kameraya en yakın 4 aktif lamba sıfır heap tahsisiyle dinamik olarak seçilir (`intensity: 2.20, distance: 40.0 m, decay: 2.0, color: 0xffaa44`).
* **Çift-Darbeli Şimşek (Double-Pulse Lightning):** $t = 0\text{ ms} \to 10.0$, $t = 80\text{ ms} \to 1.8$, $t = 160\text{ ms} \to 12.0$ tepe noktaları ve $650\text{ ms}$ üstel sönüm eğrisi. Gökyüzü sisi, ortam ışığı ve bina pencereleriyle senkronizedir.

### 8. Sinematik Post-Processing (UnrealBloomPass, ACESFilmic, Vignette)
* **Anti-Nuclear Bloom Kuralı:** Eşik değeri `threshold: 0.78`, `strength: 0.52`, `radius: 0.55` olarak ayarlanmıştır. Yalnızca ampuller, araba farları/stopları, neon tabelalar ve şimşek parlar; bina duvarları veya zemin parlamaz.
* **ACESFilmic Tone Mapping:** Pozlama değeri `exposure: 1.12` ile derin gece kontrastı korunurken sıcak renkler zenginleştirilmiştir.
* **Cinematic Vignette:** Ekranın kenarlarında sinematik odak kararması (`offset: 1.05, darkness: 1.25`).

---

## 📊 Performans ve Kaynak Bütçesi

| Metrik | Eski 2D p5.js | Yeni 3D WebGL (Three.js r165) | Mühendislik Kazancı |
|---|---|---|---|
| **Render Motoru** | 2D CPU Canvas Context | Donanım Hızlandırmalı WebGL 2.0 | GPU Paralelleştirmesi |
| **FPS Kararlılığı** | 35 - 50 FPS (Dalgalı) | **60 FPS Kilitli (Locked)** | Akıcı ve Stabil Kare Zamanı |
| **Toplam Draw Call** | N/A (CPU çizim döngüsü) | **~24 - 30 Draw Calls** | Düşük CPU-GPU İletişim Yükü |
| **Binalar & Lambalar** | 32 Ayrı CPU Döngüsü | **4 Draw Calls** (`InstancedMesh`: 2 Binalar + 2 Lambalar) | %88 Azalma |
| **Yağmur Parçacıkları** | 420 Damla (CPU çizgi) | **1200 İğne Damla** (GPU Points + CPU Fiziği) | 3 Kat Yoğunluk, Sıfır Gecikme |
| **Ses Sistemi** | Ses Yok (Sessiz) | **Saf Prosedürel Web Audio API** | 0 KB Harici Dosya İndirme |
| **Bellek & GC Baskısı**| Yüksek (Geçici Obje Üretimi) | **0 Byte/Frame (Sıfır Bellek Tahsisi)** | GC Duruşları Yok (No Stutters) |

---

## 📂 Proje Dizin Yapısı

```
Animasyon_Ödevi/
│
├── index.html              # Giriş noktası (Three.js r165 ES Module + importmap + HUD)
├── main.js                 # Sahne yöneticisi (First-Person kamera, render loop, etkileşimli kafa dönüşü)
│
├── scene/
│   ├── audio.js            # Saf Web Audio API prosedürel ses motoru (yağmur, korna, gök gürültüsü)
│   ├── walker.js           # FPS Viewmodel şemsiye mimarisi, kol ataleti ve yağmur saptırma fiziği
│   ├── rain.js             # 1200 iğne yağmur sistemi, analitik koni şemsiye saptırma fiziği
│   ├── ground.js           # Yüksek kontrastlı asfalt, granit bordürler, sarı kesikler, Planar Reflector
│   ├── world.js            # 48 bina, ara sokak geçişleri, 4 gizemli yaya silüeti, 12 parlayan 3D neon
│   ├── traffic.js          # Yoğun şehir trafiği (12 araç), 3 kasa tipi, göreli hız fiziği, far/stoplar
│   ├── lighting.js         # 16 sokak lambası, dinamik 4-PointLight havuzu, çift-darbeli şimşek
│   └── postprocessing.js   # EffectComposer, UnrealBloomPass, VignetteShader, OutputPass
│
├── legacy/                 # Orijinal p5.js referans kodları
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
> **İpucu:** Sayfada `ArrowLeft` / `A` ve `ArrowRight` / `D` tuşlarıyla başınızı sağa ve sola çevirebilir, Boşluk tuşu veya tıklamayla gök gürültülü şimşeği tetikleyebilirsiniz.

---

## 📜 Lisans
Bu çalışma MIT lisansı kapsamında geliştirilmiştir.
