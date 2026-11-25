import type { BhModule, Logger } from '../../core/types.js';
import type { DriverFactory, DriverOptions, InputDriver } from './input/driver.js';
import { DEFAULT_FOREGROUND, TargetError } from './input/foreground.js';
import { parseCombo, type KeyCombo } from './input/keys.js';
import { createMockDriver } from './input/mockDriver.js';
import { DEFAULT_TIMING } from './input/sequence.js';
import { createWindowsDriver } from './input/windowsDriver.js';

interface Button {
  id: string;
  label: string;
  combo: KeyCombo;
  /** Taste so lange halten (ms). Ohne: kurzer Druck. */
  hold?: number;
}

/** Service "input" für andere Module (z. B. spätere Makros). */
export interface InputService {
  press(keys: string, holdMs?: number): Promise<void>;
}

/** Verfügbare Eingabe-Treiber. "auto" wählt unter Windows "windows", sonst "mock". */
const drivers: Record<string, DriverFactory> = {
  mock: createMockDriver,
  windows: createWindowsDriver,
};

/** Mehr wartende Drücke werden abgelehnt, statt sich aufzustauen (z. B. Dauerfeuer auf einen Button). */
const MAX_QUEUE = 5;

class BusyError extends Error {}

function num(raw: unknown, name: string, min: number, max: number, fallback?: number): number | undefined {
  if (raw === undefined) return fallback;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < min || raw > max) {
    throw new Error(`${name} muss eine Zahl zwischen ${min} und ${max} sein`);
  }
  return raw;
}

function parseButtons(raw: unknown): Button[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.map((b, i) => {
    const { id, label, key, hold } = (b ?? {}) as Record<string, unknown>;
    const where = `Button #${i + 1}${typeof id === 'string' ? ` ("${id}")` : ''}`;
    if (typeof id !== 'string' || typeof label !== 'string' || typeof key !== 'string') {
      throw new Error(`${where}: id, label und key müssen Strings sein`);
    }
    if (seen.has(id)) throw new Error(`Button-ID "${id}" kommt doppelt vor`);
    seen.add(id);
    try {
      return { id, label, combo: parseCombo(key), hold: num(hold, 'hold', 10, 10000) };
    } catch (err) {
      throw new Error(`${where}: ${(err as Error).message}`);
    }
  });
}

function parseOptions(cfg: Record<string, unknown>): DriverOptions {
  const target = (cfg.target ?? {}) as Record<string, unknown>;
  const process = target.process ?? 'StarCitizen.exe';
  if (typeof process !== 'string' || process.trim() === '') throw new Error('target.process muss ein Prozessname sein');
  return {
    target: { process },
    timing: {
      tapMs: num(cfg.tapMs, 'tapMs', 10, 1000, DEFAULT_TIMING.tapMs)!,
      comboGapMs: num(cfg.comboGapMs, 'comboGapMs', 0, 500, DEFAULT_TIMING.comboGapMs)!,
    },
    foreground: {
      ...DEFAULT_FOREGROUND,
      settleMs: num(cfg.focusSettleMs, 'focusSettleMs', 0, 2000, DEFAULT_FOREGROUND.settleMs)!,
    },
  };
}

async function createDriver(cfg: Record<string, unknown>, log: Logger, options: DriverOptions): Promise<InputDriver> {
  const wanted = String(cfg.driver ?? 'auto');
  const name = wanted === 'auto' ? (process.platform === 'win32' ? 'windows' : 'mock') : wanted;
  const factory = drivers[name];
  if (!factory) {
    throw new Error(`Unbekannter Treiber "${wanted}" (verfügbar: auto, ${Object.keys(drivers).join(', ')})`);
  }
  return factory(log, options);
}

/** Live-Interface mit Buttons (GameGlass-Prinzip). Nur auf dem Companion sinnvoll. */
const mod: BhModule = {
  manifest: {
    id: 'controls',
    name: 'Controls',
    version: '0.2.0',
    roles: ['companion'],
    nav: { label: 'Controls', icon: '🎛️' },
    ui: true,
  },

  async setup(ctx) {
    // Erst alles prüfen, dann den Treiber laden: Tippfehler in der Config fallen sofort auf
    const buttons = parseButtons(ctx.config.buttons);
    const options = parseOptions(ctx.config);
    const driver = await createDriver(ctx.config, ctx.log, options);

    // Warteschlange: Drücke laufen strikt nacheinander, sonst vermischen sich z. B. Alt und N zweier Buttons
    let chain: Promise<unknown> = Promise.resolve();
    let pending = 0;
    function enqueue(combo: KeyCombo, holdMs?: number): Promise<void> {
      if (pending >= MAX_QUEUE) return Promise.reject(new BusyError('Zu viele Eingaben auf einmal'));
      pending++;
      const run = chain.then(() => driver.press(combo, holdMs));
      chain = run.catch(() => {}).finally(() => pending--);
      return run;
    }

    ctx.services.provide<InputService>('input', {
      press: (keys, holdMs) => enqueue(parseCombo(keys), holdMs),
    });

    /** Führt einen Button aus. Gibt eine Fehlermeldung für den Nutzer zurück oder null bei Erfolg. */
    async function press(button: Button): Promise<{ status: number; message: string } | null> {
      try {
        await enqueue(button.combo, button.hold);
      } catch (err) {
        if (err instanceof TargetError) return { status: 409, message: err.message };
        if (err instanceof BusyError) return { status: 429, message: err.message };
        ctx.log.error(`Button "${button.id}" fehlgeschlagen:`, err);
        return { status: 500, message: `Tastendruck fehlgeschlagen: ${(err as Error).message}` };
      }
      ctx.events.emit('controls:pressed', { id: button.id });
      ctx.ws.broadcast('pressed', { id: button.id, label: button.label });
      return null;
    }

    ctx.http.get('/buttons', async () => ({
      driver: driver.name,
      target: options.target.process,
      buttons: buttons.map(({ id, label, combo, hold }) => ({ id, label, keys: combo.spec, hold })),
    }));

    ctx.http.post<{ Params: { id: string } }>('/press/:id', async (req, reply) => {
      const button = buttons.find((b) => b.id === req.params.id);
      if (!button) return reply.code(404).send({ error: 'Unbekannter Button' });
      const failed = await press(button);
      if (failed) return reply.code(failed.status).send({ error: failed.message });
      return { ok: true };
    });

    ctx.ws.on('press', async (payload, client) => {
      const id = (payload as { id?: unknown } | null)?.id;
      const button = typeof id === 'string' ? buttons.find((b) => b.id === id) : undefined;
      if (!button) return client.send('error', { message: 'Unbekannter Button' });
      const failed = await press(button);
      if (failed) client.send('error', { id: button.id, message: failed.message });
    });

    ctx.log.info(`${buttons.length} Buttons, Treiber: ${driver.name}`);
  },
};

export default mod;
