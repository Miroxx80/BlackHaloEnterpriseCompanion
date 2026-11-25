import type { FastifyInstance } from 'fastify';

/** companion = läuft auf dem Gaming-PC jedes Nutzers; hub = zentraler Org-Server (später). */
export type Role = 'companion' | 'hub';

export interface Logger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

export interface ModuleManifest {
  /** Eindeutige ID. Muss dem Ordnernamen entsprechen. */
  id: string;
  name: string;
  version: string;
  /** In welchen Rollen das Modul geladen wird. */
  roles: Role[];
  /** Module, die vorher geladen sein müssen. */
  dependsOn?: string[];
  /** Eintrag in der Navigation. Ohne nav taucht das Modul dort nicht auf. */
  nav?: { label: string; icon?: string };
  /** true, wenn das Modul einen Ordner ui/ mit index.js mitbringt. */
  ui?: boolean;
}

/** Ein verbundenes Gerät (Browser auf Handy/Tablet/PC). */
export interface WsClient {
  id: string;
  send(name: string, payload?: unknown): void;
}

export interface WsApi {
  /** Reagiert auf Nachrichten "<modulId>:<name>" von Clients. */
  on(name: string, handler: (payload: unknown, client: WsClient) => void | Promise<void>): void;
  /** Sendet "<modulId>:<name>" an alle verbundenen Clients. */
  broadcast(name: string, payload?: unknown): void;
  clientCount(): number;
}

export interface EventBus {
  on(event: string, handler: (payload: unknown) => void): () => void;
  emit(event: string, payload?: unknown): void;
}

export interface ServiceRegistry {
  provide<T>(name: string, impl: T): void;
  get<T>(name: string): T | undefined;
  require<T>(name: string): T;
}

export interface ModuleContext {
  manifest: ModuleManifest;
  role: Role;
  log: Logger;
  /** Nur der eigene Config-Abschnitt "modules.<id>". */
  config: Record<string, unknown>;
  events: EventBus;
  services: ServiceRegistry;
  /** Fastify-Scope mit Prefix /api/<id>. */
  http: FastifyInstance;
  ws: WsApi;
  /** Eigener Datenordner des Moduls (wird bei Bedarf angelegt). */
  dataDir: string;
  /** Verzeichnis des Moduls (für eigene Assets). */
  dir: string;
}

export interface BhModule {
  manifest: ModuleManifest;
  setup(ctx: ModuleContext): void | Promise<void>;
  stop?(): void | Promise<void>;
}

export type ModuleState = 'running' | 'disabled' | 'skipped' | 'failed';

export interface ModuleStatus {
  id: string;
  name: string;
  version: string;
  state: ModuleState;
  nav?: { label: string; icon?: string };
  ui: boolean;
  error?: string;
}

export interface AppConfig {
  role: Role;
  server: { host: string; port: number };
  security: { token: string };
  modules: Record<string, Record<string, unknown> & { enabled?: boolean }>;
}
