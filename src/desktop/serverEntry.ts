// Läuft als eigener Prozess (Electron utilityProcess), getrennt vom Fenster und Tray.
// Stürzt der Server ab, bleibt die App offen und der Supervisor startet ihn neu.
import { join } from 'node:path';
import { startApp } from '../core/app.js';
import { lanAddresses } from '../core/net.js';
import type { ServerMessage, SupervisorMessage } from './protocol.js';
import { ensureToken } from './token.js';

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
  if (!process.env.BH_TOKEN) ensureToken(localConfigPath);
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
