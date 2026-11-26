import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { loadConfig } from './config.js';
import { createEventBus, createServiceRegistry } from './events.js';
import { createLogger } from './logger.js';
import { loadModules } from './moduleLoader.js';
import { createWsHub, type RawSocket } from './ws.js';
import type { AppConfig, ModuleStatus } from './types.js';

export interface BhApp {
  config: AppConfig;
  /** Tatsächlich genutzter Port (wichtig bei port: 0). */
  port: number;
  modules: ModuleStatus[];
  stop(): Promise<void>;
}

export interface CreateAppOptions {
  /** Überschreibt Teile der Config (z. B. in Tests). */
  overrides?: Record<string, unknown>;
  /** Eigener Modul-Ordner (Standard: dist/modules). */
  modulesDir?: string;
  /** Eigener Datenordner (Standard: <projekt>/data). */
  dataRoot?: string;
  /** Pfad der lokalen Config (Standard: <projekt>/config/local.json). */
  localConfigPath?: string;
}

/** Zeitkonstanter Vergleich. Über den Hash haben beide Seiten gleiche Länge. */
function tokenMatches(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const h = (v: string) => createHash('sha256').update(v).digest();
  return timingSafeEqual(h(given), h(expected));
}

/**
 * Braucht diese Anfrage das Token? Geprüft wird die Route, die der Router tatsächlich gewählt hat, und
 * zusätzlich der dekodierte Pfad. Nur die rohe URL zu prüfen reicht nicht: "/%61pi/..." würde als "/api/..."
 * geroutet, aber die Prüfung umgehen. Im Zweifel (nicht dekodierbar) wird geschützt.
 */
export function needsToken(routeUrl: string | undefined, rawUrl: string): boolean {
  const isProtected = (p: string) => p === '/ws' || p === '/api' || p.startsWith('/api/');
  if (routeUrl && isProtected(routeUrl)) return true;
  let path: string;
  try {
    path = decodeURIComponent(rawUrl.split('?')[0]);
  } catch {
    return true;
  }
  // Mehrfache Schrägstriche und "." zusammenfassen, wie ein Router es tun könnte
  const normalized = ('/' + path.split('/').filter((s) => s !== '' && s !== '.').join('/')).toLowerCase();
  return isProtected(normalized) || normalized.startsWith('/api');
}

export async function startApp(options: CreateAppOptions = {}): Promise<BhApp> {
  const coreDir = dirname(fileURLToPath(import.meta.url)); // dist/core
  const distDir = join(coreDir, '..');
  const rootDir = join(distDir, '..');

  const log = createLogger('core');
  const config = loadConfig(rootDir, options.overrides, options.localConfigPath);
  const events = createEventBus(log);
  const services = createServiceRegistry();
  const ws = createWsHub(log);

  const app = Fastify({ logger: false });
  await app.register(fastifyWebsocket, { options: { maxPayload: 64 * 1024 } });

  // Optionaler Zugriffsschutz: Token als Header "x-bh-token" oder Query "?token=".
  // Gilt für /api und /ws. Die statische Shell bleibt frei erreichbar und übergibt das Token dann selbst.
  const token = config.security.token;
  if (token) {
    app.addHook('onRequest', async (req, reply) => {
      if (!needsToken(req.routeOptions?.url, req.url)) return;
      const given = req.headers['x-bh-token'] ?? (req.query as Record<string, unknown> | undefined)?.token;
      if (!tokenMatches(given, token)) return reply.code(401).send({ error: 'Token fehlt oder ist falsch' });
    });
  }

  // Module laden (Fehler einzelner Module werden isoliert)
  const result = await loadModules({
    app,
    config,
    modulesDir: options.modulesDir ?? join(distDir, 'modules'),
    dataRoot: options.dataRoot ?? join(rootDir, 'data'),
    ws,
    events,
    services,
    log,
  });

  app.get('/api/modules', async () => ({ role: config.role, modules: result.statuses }));

  app.get('/ws', { websocket: true }, (socket) => {
    ws.attach(socket as unknown as RawSocket, () => ({ role: config.role, modules: result.statuses }));
  });

  // UI-Dateien der Module unter /modules/<id>/
  for (const [id, { mod, dir }] of result.running) {
    const uiDir = join(dir, 'ui');
    if (mod.manifest.ui && existsSync(uiDir)) {
      await app.register(fastifyStatic, {
        root: uiDir,
        prefix: `/modules/${id}/`,
        decorateReply: false,
      });
    } else if (mod.manifest.ui) {
      log.warn(`Modul "${id}" meldet ui: true, aber ${uiDir} existiert nicht`);
    }
  }

  // Die Shell (index.html, shell.js, ...)
  await app.register(fastifyStatic, { root: join(rootDir, 'web'), prefix: '/', decorateReply: false });

  await app.listen({ host: config.server.host, port: config.server.port });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : config.server.port;

  return {
    config,
    port,
    modules: result.statuses,
    async stop() {
      await result.stopAll();
      await app.close();
    },
  };
}
