// Läuft als eigener Prozess (Electron utilityProcess), getrennt vom Fenster und Tray.
// Stürzt der Server ab, bleibt die App offen und der Supervisor startet ihn neu.
import { join } from 'node:path';
import { startApp } from '../core/app.js';
import { lanAddresses } from '../core/net.js';
import { SCREEN_CAPTURE_SERVICE, UPDATE_SERVICE, type ScreenCaptureService, type UpdateService, type UpdateState } from '../core/types.js';
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
// Bildschirmaufnahme macht der Hauptprozess (Electron); der Server fragt per Nachricht danach.
const CAPTURE_TIMEOUT_MS = 10_000;
const captures = new Map<number, { resolve: (png: Buffer) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }>();
let nextCaptureId = 1;
const screenCapture: ScreenCaptureService = {
  capture: (region) =>
    new Promise((resolve, reject) => {
      const id = nextCaptureId++;
      const timer = setTimeout(() => {
        captures.delete(id);
        reject(new Error('Die Desktop-App hat keinen Screenshot geliefert'));
      }, CAPTURE_TIMEOUT_MS);
      captures.set(id, { resolve, reject, timer });
      send({ type: 'capture-request', id, ...(region ? { region } : {}) });
    }),
};

// Updates macht ebenfalls der Hauptprozess; der Server kennt den Stand und leitet Befehle weiter.
let updateState: UpdateState = { status: 'idle', current: '?' };
const updateListeners = new Set<(s: UpdateState) => void>();
const updateCalls = new Map<number, (s: UpdateState) => void>();
const setUpdateState = (s: UpdateState) => {
  updateState = s;
  for (const fn of updateListeners) fn(s);
};
const updateRequest = (action: 'check' | 'install') =>
  new Promise<UpdateState>((resolve) => {
    const id = nextCaptureId++;
    updateCalls.set(id, resolve);
    send({ type: 'update-request', id, action });
  });
const updates: UpdateService = {
  state: () => updateState,
  check: () => updateRequest('check'),
  install: () => updateRequest('install'),
  onChange(fn) {
    updateListeners.add(fn);
    return () => updateListeners.delete(fn);
  },
};

parent?.on('message', ({ data }) => {
  if (data?.type === 'update-state') return setUpdateState(data.state);
  if (data?.type === 'update-result') {
    setUpdateState(data.state);
    updateCalls.get(data.id)?.(data.state);
    updateCalls.delete(data.id);
    return;
  }
  if (data?.type === 'capture-result') {
    const pending = captures.get(data.id);
    if (!pending) return;
    captures.delete(data.id);
    clearTimeout(pending.timer);
    if (data.png) pending.resolve(Buffer.from(data.png.buffer, data.png.byteOffset, data.png.byteLength));
    else pending.reject(new Error(data.error ?? 'Bildschirmaufnahme fehlgeschlagen'));
    return;
  }
  if (data?.type !== 'stop' || stopRequested) return;
  stopRequested = true;
  if (app) void stop(); // sonst übernimmt das der Start-Code unten
});

try {
  const localConfigPath = join(userDir, 'config', 'local.json');
  if (!process.env.BH_TOKEN) ensureToken(localConfigPath);
  app = await startApp({
    localConfigPath,
    dataRoot: join(userDir, 'data'),
    services: parent ? { [SCREEN_CAPTURE_SERVICE]: screenCapture, [UPDATE_SERVICE]: updates } : {},
  });
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
