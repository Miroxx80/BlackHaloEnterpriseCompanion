import type { DriverFactory } from './driver.js';
import { runCombo } from './sequence.js';

/** Sendet nichts ans Spiel, sondern schreibt nur ins Log. Gut zum Entwickeln und Testen. */
export const createMockDriver: DriverFactory = (log, options) => ({
  name: 'mock',
  async press(combo, holdMs) {
    log.info(`[mock] Taste gedrückt: ${combo.spec}${holdMs ? ` (${holdMs} ms gehalten)` : ''}`);
    // Gleicher Ablauf wie beim echten Treiber, nur ohne Wirkung. So stimmen Zeiten und Reihenfolge.
    await runCombo(combo, holdMs, { down() {}, up() {}, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) }, options.timing);
  },
});
