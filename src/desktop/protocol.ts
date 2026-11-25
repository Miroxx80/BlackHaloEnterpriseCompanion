/** Nachrichten zwischen Server-Prozess und Supervisor (Electron-Hauptprozess). */

export interface ServerInfo {
  port: number;
  token: string;
  addresses: string[];
  modules: { id: string; state: string }[];
}

export type ServerMessage = ({ type: 'ready' } & ServerInfo) | { type: 'fatal'; message: string };

export type SupervisorMessage = { type: 'stop' };
