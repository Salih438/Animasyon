/**
 * scene/audio.js — Atmospheric Web Audio API Procedural Sound Engine
 *
 * Sorumluluklar:
 *   - Harici ses dosyası (mp3/wav) gerektirmeyen, %100 saf Web Audio API sentezleyici.
 *   - Sürekli Yağmur Sesi (Continuous Rain):
 *       * Pembe/beyaz gürültü tamponu (Pink/White Noise) + BiquadFilter (Lowpass ~750Hz)
 *       * Rüzgar hissi için yavaş salınımlı LFO (Filter cutoff modülasyonu: 600 - 900 Hz).
 *   - Uzak Şehir & Trafik Kornaları (Distant Car Horns):
 *       * Periyodik / rastgele çift tonlu osilatör (392Hz + 440Hz / 415Hz + 466Hz).
 *       * Uzaklık hissi veren band-pass/low-pass filtreleme ve yankı zarfı (envelope).
 *   - Gök Gürültüsü (Thunder Rumble):
 *       * Şimşek çakışıyla (`triggerLightning`) senkron derin bas gürültü patlaması.
 *       * 40-50Hz sub-bass sinüs + 110Hz lowpass gürültü patlaması + 3.5s üstel sönüm.
 *   - Tarayıcı Oynatma İzni (AudioContext Unlock):
 *       * Sayfaya ilk kullanıcı etkileşiminde (pointerdown / keydown) otomatik resume().
 */

let _audioCtx     = null;
let _isStarted    = false;
let _isMuted      = false;

// Düğüm referansları
let _masterGain   = null;
let _rainGain     = null;
let _rainFilter   = null;
let _rainSource   = null;
let _lfoOsc       = null;

// Korna zamanlayıcısı
let _hornTimer    = null;

/**
 * AudioContext ve ses boru hattını hazırlar.
 */
export function initAudio() {
  if (typeof window === 'undefined') return;

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      console.warn('[Audio] Web Audio API tarayıcıda desteklenmiyor.');
      return;
    }

    _audioCtx = new AudioContextClass();

    _masterGain = _audioCtx.createGain();
    _masterGain.gain.value = 0.75;
    _masterGain.connect(_audioCtx.destination);
  } catch (err) {
    console.warn('[Audio] AudioContext ilklendirme hatası:', err);
  }
}

/**
 * Kullanıcı etkileşimiyle ses motorunu başlatır.
 */
export function startAudio() {
  if (!_audioCtx) initAudio();
  if (!_audioCtx) return;

  if (_audioCtx.state === 'suspended') {
    _audioCtx.resume();
  }

  if (!_isStarted) {
    _startRainNoise();
    _scheduleNextHorn();
    _isStarted = true;
  }
}

/**
 * Sürekli çiseleyen/yağan yağmur sesini prosedürel gürültü ile üretir.
 */
function _startRainNoise() {
  if (!_audioCtx || !_masterGain) return;

  const sampleRate = _audioCtx.sampleRate;
  const bufferDuration = 4.0; // 4 saniyelik dikişsiz gürültü tamponu
  const frameCount = sampleRate * bufferDuration;
  const noiseBuffer = _audioCtx.createBuffer(2, frameCount, sampleRate);

  // Sol ve sağ kanal için stereo pembe/beyaz gürültü sentezi
  for (let channel = 0; channel < 2; channel++) {
    const channelData = noiseBuffer.getChannelData(channel);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;

    for (let i = 0; i < frameCount; i++) {
      const white = Math.random() * 2 - 1;

      // Paul Kellet pembe gürültü filtresi
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      b6 = white * 0.115926;

      channelData[i] = pink * 0.11;
    }
  }

  // Döngüsel kaynak
  _rainSource = _audioCtx.createBufferSource();
  _rainSource.buffer = noiseBuffer;
  _rainSource.loop = true;

  // Yağmur frekans profili: Lowpass filtre (~750Hz) yağmurun tok su sesini verir
  _rainFilter = _audioCtx.createBiquadFilter();
  _rainFilter.type = 'lowpass';
  _rainFilter.frequency.value = 750;
  _rainFilter.Q.value = 1.2;

  // Hafif rüzgar esintisi hissi veren yavaş LFO modülasyonu
  _lfoOsc = _audioCtx.createOscillator();
  _lfoOsc.frequency.value = 0.18; // 0.18 Hz yavaş dalga
  const lfoGain = _audioCtx.createGain();
  lfoGain.gain.value = 160; // Cutoff frekansını 600 - 900 Hz arası gezdirir
  _lfoOsc.connect(lfoGain);
  lfoGain.connect(_rainFilter.frequency);
  _lfoOsc.start();

  _rainGain = _audioCtx.createGain();
  _rainGain.gain.value = 0.42;

  _rainSource.connect(_rainFilter);
  _rainFilter.connect(_rainGain);
  _rainGain.connect(_masterGain);

  _rainSource.start();
}

/**
 * Uzaktan gelen araba kornası simülasyonu (rastgele aralıklarla).
 */
function _scheduleNextHorn() {
  if (!_audioCtx || _isMuted) return;

  const delayMs = 9000 + Math.random() * 14000; // 9 - 23 saniye aralık
  _hornTimer = setTimeout(() => {
    _playCarHorn();
    _scheduleNextHorn();
  }, delayMs);
}

function _playCarHorn() {
  if (!_audioCtx || _audioCtx.state !== 'running' || _isMuted) return;

  const now = _audioCtx.currentTime;
  const duration = 0.45 + Math.random() * 0.35; // 0.45 - 0.8 saniye

  // İki akortlu frekans kombinasyonu (ör: F ve A-flat veya G ve B-flat)
  const baseFreqs = [
    [392, 440], // G4, A4
    [415, 466], // G#4, A#4
    [349, 415], // F4, G#4
  ];
  const pair = baseFreqs[Math.floor(Math.random() * baseFreqs.length)];

  const hornGain = _audioCtx.createGain();
  hornGain.gain.setValueAtTime(0.0001, now);
  hornGain.gain.exponentialRampToValueAtTime(0.065, now + 0.05); // Uzak mesafe hacmi
  hornGain.gain.setValueAtTime(0.065, now + duration - 0.08);
  hornGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  // Uzaklık filtresi (yüksek frekansları emer)
  const filter = _audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1200 + Math.random() * 400;

  pair.forEach(freq => {
    const osc = _audioCtx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    osc.connect(hornGain);
    osc.start(now);
    osc.stop(now + duration);
  });

  hornGain.connect(filter);
  filter.connect(_masterGain);
}

/**
 * Şimşek çakışıyla senkron derin gök gürültüsü patlaması.
 */
export function playThunder() {
  if (!_audioCtx) return;
  if (_audioCtx.state === 'suspended') {
    _audioCtx.resume();
  }

  const now = _audioCtx.currentTime;
  const duration = 3.6;

  // 1. Düşük Frekanslı Gürültü Patlaması (Rolling Rumble)
  const sampleRate = _audioCtx.sampleRate;
  const frameCount = Math.floor(sampleRate * duration);
  const noiseBuffer = _audioCtx.createBuffer(1, frameCount, sampleRate);
  const data = noiseBuffer.getChannelData(0);

  let lastOut = 0.0;
  for (let i = 0; i < frameCount; i++) {
    const white = Math.random() * 2 - 1;
    // Derin brownian/red noise filtresi
    lastOut = (lastOut + (0.02 * white)) / 1.02;
    data[i] = lastOut * 3.5;
  }

  const noiseSource = _audioCtx.createBufferSource();
  noiseSource.buffer = noiseBuffer;

  const noiseFilter = _audioCtx.createBiquadFilter();
  noiseFilter.type = 'lowpass';
  noiseFilter.frequency.setValueAtTime(220, now);
  noiseFilter.frequency.exponentialRampToValueAtTime(80, now + duration);

  const noiseGain = _audioCtx.createGain();
  // Ani ilk patlama (crack) ve ardından yuvarlanan derin bas yankılanması
  noiseGain.gain.setValueAtTime(0.001, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.65, now + 0.06);
  noiseGain.gain.exponentialRampToValueAtTime(0.35, now + 0.45);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  noiseSource.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(_masterGain);

  noiseSource.start(now);
  noiseSource.stop(now + duration);

  // 2. Sub-Bass Sinüs Vuruşu (42Hz - 28Hz)
  const subOsc = _audioCtx.createOscillator();
  subOsc.type = 'sine';
  subOsc.frequency.setValueAtTime(52, now);
  subOsc.frequency.exponentialRampToValueAtTime(28, now + 2.0);

  const subGain = _audioCtx.createGain();
  subGain.gain.setValueAtTime(0.001, now);
  subGain.gain.exponentialRampToValueAtTime(0.48, now + 0.04);
  subGain.gain.exponentialRampToValueAtTime(0.0001, now + 2.2);

  subOsc.connect(subGain);
  subGain.connect(_masterGain);

  subOsc.start(now);
  subOsc.stop(now + 2.2);
}

/**
 * Ses motorunu sustur veya aç.
 */
export function toggleMute() {
  if (!_masterGain) return false;
  _isMuted = !_isMuted;
  _masterGain.gain.value = _isMuted ? 0.0 : 0.75;
  return _isMuted;
}

/**
 * Islak zeminde yürüme sesi (Prosedürel Web Audio API — Harici dosya yok).
 * Yürüyüş fazına senkronize olarak sol ve sağ adımlarda tetiklenir.
 *
 * @param {boolean} [isLeft=false] — Sol veya sağ ayak ayrımı
 */
export function playFootstep(isLeft = false) {
  if (!_audioCtx) return;
  if (_audioCtx.state === 'suspended') {
    _audioCtx.resume();
  }
  if (_audioCtx.state !== 'running' || _isMuted) return;

  const now = _audioCtx.currentTime;
  const duration = 0.055; // 55 ms kısa, tok sıçrama ve temas

  // 1. Islak Su Sıçraması (Wet Squelch / Splash — Filtered Noise Burst)
  const sampleRate = _audioCtx.sampleRate;
  const frameCount = Math.floor(sampleRate * duration);
  const noiseBuffer = _audioCtx.createBuffer(1, frameCount, sampleRate);
  const data = noiseBuffer.getChannelData(0);

  for (let i = 0; i < frameCount; i++) {
    // Hızlı üstel sönümlü gürültü darbesi
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (frameCount * 0.28));
  }

  const noiseSrc = _audioCtx.createBufferSource();
  noiseSrc.buffer = noiseBuffer;

  const filter = _audioCtx.createBiquadFilter();
  filter.type = 'bandpass';
  // Sol ve sağ adım için doğal formant/frekans farkı (robotik tekrarı önler)
  const centerFreq = isLeft ? 1460 : 1320;
  filter.frequency.setValueAtTime(centerFreq, now);
  filter.Q.value = 2.4;

  const gain = _audioCtx.createGain();
  gain.gain.setValueAtTime(0.001, now);
  gain.gain.linearRampToValueAtTime(0.085, now + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  // Stereo derinlik (Sol adım hafif sola, sağ adım hafif sağa)
  let panner = null;
  if (typeof _audioCtx.createStereoPanner === 'function') {
    panner = _audioCtx.createStereoPanner();
    panner.pan.setValueAtTime(isLeft ? -0.16 : 0.16, now);
  }

  noiseSrc.connect(filter);
  filter.connect(gain);
  if (panner) {
    gain.connect(panner);
    panner.connect(_masterGain);
  } else {
    gain.connect(_masterGain);
  }

  noiseSrc.start(now);
  noiseSrc.stop(now + duration);

  // 2. Ayakkabı Tabanı Zemin Temas Darbesi (Shoe Impact Thud)
  const thudOsc = _audioCtx.createOscillator();
  thudOsc.type = 'sine';
  const startFreq = isLeft ? 84 : 76;
  const endFreq   = isLeft ? 42 : 38;
  thudOsc.frequency.setValueAtTime(startFreq, now);
  thudOsc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.035);

  const thudGain = _audioCtx.createGain();
  thudGain.gain.setValueAtTime(0.001, now);
  thudGain.gain.linearRampToValueAtTime(0.065, now + 0.004);
  thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.040);

  thudOsc.connect(thudGain);
  thudGain.connect(_masterGain);

  thudOsc.start(now);
  thudOsc.stop(now + 0.040);
}

