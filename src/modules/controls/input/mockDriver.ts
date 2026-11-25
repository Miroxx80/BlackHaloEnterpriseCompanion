import type { DriverFactory } from './driver.js';

/** Sendet nichts ans Spiel, sondern schreibt nur ins Log. Gut zum Entwickeln und Testen. */
export const createMockDriver: DriverFactory = (log) => ({
  name: 'mock',
  async press(key) {
    log.info(`[mock] Taste gedrückt: ${key}`);
  },
});
