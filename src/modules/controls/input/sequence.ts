import type { Key, KeyCombo } from './keys.js';

export interface KeyIo {
  down(key: Key): void;
  up(key: Key): void;
  sleep(ms: number): Promise<void>;
}

export interface Timing {
  /** Wie lange die letzte Taste bei einem normalen Druck gehalten wird. Spiele fragen pro Frame ab, zu kurz geht verloren. */
  tapMs: number;
  /** Pause zwischen den Tasten einer Kombination (z. B. Alt runter, kurz warten, dann N). */
  comboGapMs: number;
}

export const DEFAULT_TIMING: Timing = { tapMs: 50, comboGapMs: 20 };

/**
 * Drückt eine Kombination: Tasten der Reihe nach runter, halten, rückwärts loslassen.
 * Was gedrückt wurde, wird in jedem Fall wieder losgelassen, auch bei einem Fehler mittendrin.
 * Sonst bliebe im Spiel z. B. Alt "hängen".
 */
export async function runCombo(combo: KeyCombo, holdMs: number | undefined, io: KeyIo, timing: Timing): Promise<void> {
  const pressed: Key[] = [];
  try {
    for (const [i, key] of combo.keys.entries()) {
      if (i > 0) await io.sleep(timing.comboGapMs);
      io.down(key);
      pressed.push(key);
    }
    await io.sleep(holdMs ?? timing.tapMs);
  } finally {
    let first: unknown;
    for (const key of pressed.reverse()) {
      try {
        io.up(key);
      } catch (err) {
        first ??= err; // trotzdem die restlichen Tasten loslassen
      }
      await io.sleep(timing.comboGapMs);
    }
    if (first) throw first;
  }
}
