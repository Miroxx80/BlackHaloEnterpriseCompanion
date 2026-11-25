import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppConfig } from './types.js';

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge(base: Json, over: Json): Json {
  const out: Json = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = isObject(v) && isObject(out[k]) ? deepMerge(out[k] as Json, v) : v;
  }
  return out;
}

function readJson(path: string): Json {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Json;
  } catch (err) {
    throw new Error(`Config-Datei ${path} ist kein gültiges JSON: ${(err as Error).message}`);
  }
}

/**
 * Reihenfolge (spätere gewinnen):
 * config/default.json -> lokale Config (nicht im Git) -> Umgebungsvariablen -> overrides
 *
 * Die lokale Config liegt standardmäßig unter config/local.json. Die Desktop-App legt sie
 * unter %APPDATA%\BlackHalo\config\local.json ab, weil der Installationsordner nicht beschreibbar ist.
 */
export function loadConfig(
  rootDir: string,
  overrides: Json = {},
  localConfigPath = join(rootDir, 'config', 'local.json'),
): AppConfig {
  let cfg = readJson(join(rootDir, 'config', 'default.json'));
  cfg = deepMerge(cfg, readJson(localConfigPath));

  const env: Json = {};
  if (process.env.BH_ROLE) env.role = process.env.BH_ROLE;
  if (process.env.BH_PORT) env.server = { port: Number(process.env.BH_PORT) };
  if (process.env.BH_TOKEN) env.security = { token: process.env.BH_TOKEN };
  cfg = deepMerge(cfg, env);
  cfg = deepMerge(cfg, overrides);

  const role = cfg.role;
  if (role !== 'companion' && role !== 'hub') {
    throw new Error(`Ungültige role "${String(role)}" (erlaubt: companion, hub)`);
  }
  const server = cfg.server as Json | undefined;
  const port = server?.port;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Ungültiger server.port "${String(port)}" (erlaubt: 0 bis 65535)`);
  }
  if (typeof server?.host !== 'string' || server.host === '') {
    throw new Error('server.host fehlt');
  }
  const security = cfg.security as Json | undefined;
  if (security?.token !== undefined && typeof security.token !== 'string') {
    throw new Error('security.token muss ein String sein');
  }
  if (!isObject(cfg.security)) cfg.security = { token: '' };
  if (!isObject(cfg.modules)) cfg.modules = {};
  return cfg as unknown as AppConfig;
}
