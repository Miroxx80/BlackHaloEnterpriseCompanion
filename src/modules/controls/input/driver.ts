import type { Logger } from '../../../core/types.js';
import type { ForegroundOptions, Target } from './foreground.js';
import type { KeyCombo } from './keys.js';
import type { Timing } from './sequence.js';

/**
 * Abstraktion für das Auslösen von Tastendrücken im Spiel.
 * Neue Treiber werden nur in controls/index.ts registriert, der Rest des Moduls bleibt unverändert.
 */
export interface InputDriver {
  readonly name: string;
  /** Drückt eine Kombination. holdMs: so lange halten (sonst kurzer Tastendruck). */
  press(combo: KeyCombo, holdMs?: number): Promise<void>;
}

export interface DriverOptions {
  target: Target;
  timing: Timing;
  foreground: ForegroundOptions;
}

export type DriverFactory = (log: Logger, options: DriverOptions) => InputDriver | Promise<InputDriver>;
