// Läuft als eigener Prozess (Electron utilityProcess), getrennt vom Fenster und Tray.
// Stürzt der Server ab, bleibt die App offen und der Supervisor startet ihn neu.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { startApp } from '../core/app.js';
import { lanAddresses } from '../core/net.js';
import type { ServerMessage, SupervisorMessage } from './protocol.js';

interface ParentPortLike {
  postMessage(msg: ServerMessage): void;
  on(event: 'message', cb: (e: { data: SupervisorMessage }) => void): void;
}
const parent = (process as unknown as { parentPort?: ParentPortLike }).parentPort;
const send = (msg: ServerMessage) => parent?.postMessage(msg);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * Die Desktop-App läuft immer mit Zugangsschlüssel. Fehlt einer, wird er einmalig erzeugt und
 * in der lokalen Config gespeichert. Das Tablet bekommt ihn über den QR-Code.
 */
function ensureToken(localConfigPath: string) {
  if (process.env.BH_TOKEN) return;
  let cfg: Record<string, unknown> = {};
  if (existsSync(localConfigPath)) {
    try {
      cfg = JSON.parse(readFileSync(localConfigPath, 'utf8'));
    } catch {
      return; // kaputte Datei nicht überschreiben; loadConfig meldet den Fehler verständlich
    }
  }
  const security = (cfg.security ?? {}) as Record<string, unknown>;
  if (typeof security.token === 'string' && security.token !== '') return;
  cfg.security = { ...security, token: randomBytes(18).toString('base64url') };
  mkdirSync(dirname(localConfigPath), { recursive: true });
  writeFileSync(localConfigPath, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`Neuer Zugangsschlüssel in ${localConfigPath} gespeichert`);
}

const userDir = arg('--user-dir');
if (!userDir) {
  send({ type: 'fatal', message: 'Parameter --user-dir fehlt' });
  process.exit(1);
}

// Den Stopp-Befehl schon vor dem Start annehmen: Kommt er während des Starts, wird danach sauber beendet.
let app: Awaited<ReturnType<typeof startApp>> | null = null;
let stopRequested = false;
async function stop() {
  try {
    await app?.stop();
  } finally {
    process.exit(0);
  }
}
parent?.on('message', ({ data }) => {
  if (data?.type !== 'stop' || stopRequested) return;
  stopRequested = true;
  if (app) void stop(); // sonst übernimmt das der Start-Code unten
});

try {
  const localConfigPath = join(userDir, 'config', 'local.json');
  ensureToken(localConfigPath);
  app = await startApp({ localConfigPath, dataRoot: join(userDir, 'data') });
  if (stopRequested) {
    await stop();
  } else {
    send({
      type: 'ready',
      port: app.port,
      token: app.config.security.token,
      addresses: lanAddresses(),
      modules: app.modules.map((m) => ({ id: m.id, state: m.state })),
    });
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error('Server-Start fehlgeschlagen:', err);
  send({ type: 'fatal', message });
  process.exit(1);
}
