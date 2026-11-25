import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { createLogger } from './logger.js';
import type { WsHub } from './ws.js';
import type {
  AppConfig,
  BhModule,
  EventBus,
  Logger,
  ModuleContext,
  ModuleStatus,
  ServiceRegistry,
} from './types.js';

export interface LoadedModule {
  mod: BhModule;
  dir: string;
}

export interface LoadResult {
  statuses: ModuleStatus[];
  running: Map<string, LoadedModule>;
  stopAll(): Promise<void>;
}

interface LoaderOptions {
  app: FastifyInstance;
  config: AppConfig;
  modulesDir: string;
  dataRoot: string;
  ws: WsHub;
  events: EventBus;
  services: ServiceRegistry;
  log: Logger;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isModule(m: unknown, folder: string): m is BhModule {
  const mod = m as BhModule | undefined;
  return (
    !!mod &&
    typeof mod.setup === 'function' &&
    !!mod.manifest &&
    mod.manifest.id === folder &&
    typeof mod.manifest.name === 'string' &&
    typeof mod.manifest.version === 'string' &&
    Array.isArray(mod.manifest.roles)
  );
}

/**
 * Sucht alle Ordner in modulesDir mit einer index.js und lädt sie.
 * Ein kaputtes Modul wird als "failed" markiert, alle anderen laufen weiter.
 */
export async function loadModules(opts: LoaderOptions): Promise<LoadResult> {
  const { app, config, modulesDir, log } = opts;
  const statuses = new Map<string, ModuleStatus>();
  const found = new Map<string, LoadedModule>();

  // 1. Entdecken und importieren
  const folders = existsSync(modulesDir)
    ? readdirSync(modulesDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
    : [];

  for (const folder of folders) {
    const dir = join(modulesDir, folder);
    const entry = join(dir, 'index.js');
    if (!existsSync(entry)) continue;
    try {
      const imported = await import(pathToFileURL(entry).href);
      const mod = imported.default;
      if (!isModule(mod, folder)) {
        throw new Error('Ungültiges Modul: default-Export mit manifest.id (= Ordnername) und setup() erwartet');
      }
      found.set(folder, { mod, dir });
    } catch (err) {
      log.error(`Modul "${folder}" konnte nicht geladen werden: ${errMsg(err)}`);
      statuses.set(folder, {
        id: folder,
        name: folder,
        version: '?',
        state: 'failed',
        ui: false,
        error: errMsg(err),
      });
    }
  }

  // 2. Filtern nach Rolle und Config
  const candidates = new Set<string>();
  for (const [id, { mod }] of found) {
    const base = {
      id,
      name: mod.manifest.name,
      version: mod.manifest.version,
      nav: mod.manifest.nav,
      ui: !!mod.manifest.ui,
    };
    if (!mod.manifest.roles.includes(config.role)) {
      statuses.set(id, { ...base, state: 'skipped' });
    } else if (config.modules[id]?.enabled === false) {
      statuses.set(id, { ...base, state: 'disabled' });
    } else {
      candidates.add(id);
    }
  }

  // 3. Reihenfolge nach dependsOn
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const dep of found.get(id)!.mod.manifest.dependsOn ?? []) {
      if (candidates.has(dep)) visit(dep);
    }
    order.push(id);
  };
  for (const id of candidates) visit(id);

  // 4. Starten
  const running = new Map<string, LoadedModule>();
  const failedIds = new Set<string>();

  for (const id of order) {
    const loaded = found.get(id)!;
    const { mod, dir } = loaded;
    const base = {
      id,
      name: mod.manifest.name,
      version: mod.manifest.version,
      nav: mod.manifest.nav,
      ui: !!mod.manifest.ui,
    };

    const missing = (mod.manifest.dependsOn ?? []).filter((d) => statuses.get(d)?.state !== 'running');
    if (missing.length > 0) {
      const error = `Abhängigkeit(en) nicht verfügbar: ${missing.join(', ')}`;
      log.error(`Modul "${id}" übersprungen. ${error}`);
      statuses.set(id, { ...base, state: 'failed', error });
      continue;
    }

    let setupError: unknown;
    await app.register(
      async (scope) => {
        // Hook zuerst registrieren, damit er für alle Routen des Moduls gilt.
        scope.addHook('onRequest', async (_req, reply) => {
          if (failedIds.has(id)) return reply.code(503).send({ error: `Modul "${id}" ist ausgefallen` });
        });
        const ctx: ModuleContext = {
          manifest: mod.manifest,
          role: config.role,
          log: createLogger(id),
          config: config.modules[id] ?? {},
          events: opts.events,
          services: opts.services,
          http: scope,
          ws: opts.ws.forModule(id),
          dataDir: join(opts.dataRoot, id),
          dir,
        };
        try {
          await mod.setup(ctx);
        } catch (err) {
          setupError = err;
        }
      },
      { prefix: `/api/${id}` },
    );

    if (setupError) {
      failedIds.add(id);
      opts.ws.dropModule(id);
      log.error(`Modul "${id}" ist beim Start fehlgeschlagen: ${errMsg(setupError)}`);
      statuses.set(id, { ...base, state: 'failed', error: errMsg(setupError) });
    } else {
      running.set(id, loaded);
      statuses.set(id, { ...base, state: 'running' });
      log.info(`Modul "${id}" v${mod.manifest.version} läuft`);
    }
  }

  return {
    statuses: [...statuses.values()].sort((a, b) => a.id.localeCompare(b.id)),
    running,
    async stopAll() {
      for (const [id, { mod }] of [...running].reverse()) {
        try {
          await mod.stop?.();
        } catch (err) {
          log.error(`Modul "${id}" konnte nicht sauber beendet werden: ${errMsg(err)}`);
        }
      }
    },
  };
}
