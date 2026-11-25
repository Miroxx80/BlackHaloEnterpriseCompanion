import type { DriverFactory } from './driver.js';
import { ensureForeground } from './foreground.js';
import { runCombo } from './sequence.js';
import { loadWin32 } from './win32.js';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Echte Tastendrücke per SendInput mit Scancodes (so erkennt Star Citizen sie).
 * Vor jedem Druck wird das Spiel in den Vordergrund geholt. Gelingt das nicht, wird nichts gesendet.
 */
export const createWindowsDriver: DriverFactory = async (log, options) => {
  const win = await loadWin32();
  const api = { ...win, sleep };
  log.info(`Windows-Treiber aktiv, Ziel: ${options.target.process}`);

  return {
    name: 'windows',
    async press(combo, holdMs) {
      await ensureForeground(api, options.target, options.foreground);
      await runCombo(
        combo,
        holdMs,
        { down: (k) => win.sendKey(k, false), up: (k) => win.sendKey(k, true), sleep },
        options.timing,
      );
    },
  };
};
