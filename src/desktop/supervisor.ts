import { EventEmitter } from 'node:events';
import { utilityProcess, type UtilityProcess } from 'electron';
import type { LogFile } from './log.js';
import type { ServerInfo, ServerMessage, SupervisorMessage } from './protocol.js';
import type { UpdateState } from '../core/types.js';

export type ServerState = 'starting' | 'running' | 'restarting' | 'failed' | 'stopped';

const BACKOFF_MS = [1000, 2000, 5000, 10000];
/** So viele Abstürze innerhalb von CRASH_WINDOW_MS, dann wird aufgegeben (statt endlos neu zu starten). */
const MAX_CRASHES = 5;
const CRASH_WINDOW_MS = 60_000;
const STOP_TIMEOUT_MS = 5000;

/**
 * Startet den Server als eigenen Prozess und startet ihn nach einem Absturz neu.
 * Events: "state" (ServerState), "ready" (ServerInfo).
 */
export class ServerSupervisor extends EventEmitter {
  state: ServerState = 'stopped';
  info: ServerInfo | null = null;
  lastError = '';
  /** Liefert einen Screenshot, wenn der Server danach fragt (gesetzt von main.ts). */
  captureHandler: ((region?: { x: number; y: number; width: number; height: number }) => Promise<Buffer>) | null = null;
  /** Updates (gesetzt von main.ts): Stand und Befehle für den Server. */
  updateHandler: { state(): UpdateState; check(): Promise<UpdateState>; install(): Promise<UpdateState> } | null = null;

  /** Neuen Update-Stand an den Server schicken (für Oberfläche und Handy). */
  pushUpdateState(state: UpdateState) {
    this.child?.postMessage({ type: 'update-state', state } satisfies SupervisorMessage);
  }

  private child: UtilityProcess | null = null;
  private crashes: number[] = [];
  private restartTimer: NodeJS.Timeout | null = null;
  private stopping = false;

  constructor(
    private readonly entry: string,
    private readonly userDir: string,
    private readonly log: LogFile,
  ) {
    super();
  }

  start() {
    this.stopping = false;
    this.crashes = [];
    this.spawn();
  }

  /** Neustart auf Wunsch (Tray). Setzt auch den Zustand "failed" zurück. */
  async restart() {
    await this.stop();
    this.start();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const child = this.child;
    if (!child) return this.setState('stopped');

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.log.line('WARN', 'Server reagiert nicht auf Stopp, wird beendet');
        child.kill();
      }, STOP_TIMEOUT_MS);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      child.postMessage({ type: 'stop' } satisfies SupervisorMessage);
    });
  }

  private setState(state: ServerState) {
    if (this.state === state) return;
    this.state = state;
    this.safeEmit('state', state);
  }

  /** Ein fehlerhafter Listener (z. B. Tray-Update) darf Stopp und Neustart nie blockieren. */
  private safeEmit(event: string, payload: unknown) {
    try {
      this.emit(event, payload);
    } catch (err) {
      this.log.line('ERROR', `Fehler im Listener für "${event}": ${(err as Error).message}`);
    }
  }

  private spawn() {
    this.setState(this.crashes.length ? 'restarting' : 'starting');
    const child = utilityProcess.fork(this.entry, ['--user-dir', this.userDir], {
      serviceName: 'Black Halo Server',
      stdio: 'pipe',
    });
    this.child = child;
    child.stdout?.on('data', (d) => this.log.raw(d));
    child.stderr?.on('data', (d) => this.log.raw(d));

    child.on('message', (msg: ServerMessage) => {
      if (msg?.type === 'ready') {
        const { type: _t, ...info } = msg;
        this.info = info;
        this.lastError = '';
        this.setState('running');
        this.safeEmit('ready', info);
        if (this.updateHandler) this.pushUpdateState(this.updateHandler.state());
        this.log.line('INFO', `Server läuft auf Port ${info.port}`);
      } else if (msg?.type === 'fatal') {
        this.lastError = msg.message;
      } else if (msg?.type === 'capture-request') {
        void this.answerCapture(child, msg.id, msg.region);
      } else if (msg?.type === 'update-request') {
        void this.answerUpdate(child, msg.id, msg.action);
      }
    });

    child.on('exit', (code) => {
      if (this.child === child) this.child = null;
      if (this.stopping) {
        this.log.line('INFO', 'Server beendet');
        return this.setState('stopped');
      }
      this.onCrash(code);
    });
  }

  private async answerCapture(child: UtilityProcess, id: number, region?: { x: number; y: number; width: number; height: number }) {
    let reply: SupervisorMessage;
    try {
      if (!this.captureHandler) throw new Error('Bildschirmaufnahme nicht verfügbar');
      reply = { type: 'capture-result', id, png: new Uint8Array(await this.captureHandler(region)) };
    } catch (err) {
      reply = { type: 'capture-result', id, error: (err as Error).message };
    }
    if (this.child === child) child.postMessage(reply);
  }

  private async answerUpdate(child: UtilityProcess, id: number, action: 'check' | 'install') {
    const h = this.updateHandler;
    const state: UpdateState = h
      ? await (action === 'install' ? h.install() : h.check()).catch((err: Error) => ({ ...h.state(), status: 'error' as const, error: err.message }))
      : { status: 'unsupported', current: '?' };
    if (this.child === child) child.postMessage({ type: 'update-result', id, state } satisfies SupervisorMessage);
  }

  private onCrash(code: number) {
    const now = Date.now();
    this.crashes = [...this.crashes.filter((t) => now - t < CRASH_WINDOW_MS), now];
    if (!this.lastError) this.lastError = `Server-Prozess unerwartet beendet (Code ${code})`;
    this.log.line('ERROR', `${this.lastError}`);

    if (this.crashes.length >= MAX_CRASHES) {
      this.log.line('ERROR', `Server ${MAX_CRASHES}x in kurzer Zeit abgestürzt, kein weiterer Neustart`);
      return this.setState('failed');
    }
    const delay = BACKOFF_MS[Math.min(this.crashes.length - 1, BACKOFF_MS.length - 1)];
    this.log.line('INFO', `Neustart in ${delay / 1000}s`);
    this.setState('restarting');
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.spawn();
    }, delay);
  }
}
