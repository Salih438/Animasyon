/**
 * scene/events.js — Minimal Lightning Domain Event Dispatcher
 *
 * Sorumluluklar:
 *   - lighting.js (producer) ile sky.js ve buildings.js (consumers) arasındaki
 *     doğrudan bağımlılığı ortadan kaldıran minimal lightning domain event sözleşmesi.
 *   - SIFIR ALLOCATION: Çalışma zamanında herhangi bir nesne tahsisi yapmaz,
 *     doğrudan numeric factor taşır.
 *   - Set veri yapısı ile otomatik duplicate listener koruması sağlar.
 */

const _lightningListeners = new Set();

/**
 * Şimşek faktörü değişimini dinlemek için listener kaydeder.
 * Set kullanımı sayesinde aynı fonksiyonun birden fazla kaydedilmesi (duplicate) engellenir.
 *
 * @param {(factor: number) => void} listener - Şimşek şiddetini [0.0, 1.0] alan geri çağırım fonksiyonu
 * @returns {() => void} Dinleyiciyi kaldıran unsubscribe fonksiyonu
 */
export function subscribeLightning(listener) {
  if (typeof listener === 'function') {
    _lightningListeners.add(listener);
  }
  return () => {
    _lightningListeners.delete(listener);
  };
}

/**
 * Kayıtlı bir şimşek dinleyicisini kaldırır.
 *
 * @param {(factor: number) => void} listener
 */
export function unsubscribeLightning(listener) {
  _lightningListeners.delete(listener);
}

/**
 * Şimşek faktörünü tüm kayıtlı dinleyicilere dağıtır (Zero-Allocation).
 *
 * @param {number} factor - [0.0, 1.0] aralığında anlık şimşek çarpanı
 */
export function emitLightning(factor) {
  for (const listener of _lightningListeners) {
    listener(factor);
  }
}

/**
 * Test ve mimari doğrulama için kayıtlı dinleyici sayısını döner.
 *
 * @returns {number}
 */
export function getLightningListenerCount() {
  return _lightningListeners.size;
}
