import type { Logger } from '../../../core/types.js';

/**
 * Abstraktion für das Auslösen von Tastendrücken im Spiel.
 * Neue Treiber (z. B. "windows" mit SendInput und Scancodes) werden nur hier registriert,
 * der Rest des Moduls bleibt unverändert.
 */
export interface InputDriver {
  readonly name: string;
  press(key: string): Promise<void>;
}

export type DriverFactory = (log: Logger) => InputDriver;
