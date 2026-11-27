import type { UpdateState } from '../core/types.js';
/** Nachrichten zwischen Server-Prozess und Supervisor (Electron-Hauptprozess). */

export interface ServerInfo {
  port: number;
  token: string;
  addresses: string[];
  modules: { id: string; state: string }[];
}

export type ServerMessage =
  | ({ type: 'ready' } & ServerInfo)
  | { type: 'fatal'; message: string }
  /** Server bittet um einen Screenshot des Hauptbildschirms (z. B. Knopf "Am PC einlesen" am Handy). */
  | { type: 'capture-request'; id: number; region?: { x: number; y: number; width: number; height: number } }
  /** Server leitet "Nach Updates suchen" / "Installieren" an die Desktop-App weiter. */
  | { type: 'update-request'; id: number; action: 'check' | 'install' };

export type SupervisorMessage =
  | { type: 'stop' }
  | { type: 'capture-result'; id: number; png?: Uint8Array; error?: string }
  | { type: 'update-result'; id: number; state: UpdateState }
  /** Neuer Update-Stand (z. B. Fortschritt), ungefragt an den Server. */
  | { type: 'update-state'; state: UpdateState };
