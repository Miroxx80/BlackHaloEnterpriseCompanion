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
  | { type: 'capture-request'; id: number; region?: { x: number; y: number; width: number; height: number } };

export type SupervisorMessage =
  | { type: 'stop' }
  | { type: 'capture-result'; id: number; png?: Uint8Array; error?: string };
