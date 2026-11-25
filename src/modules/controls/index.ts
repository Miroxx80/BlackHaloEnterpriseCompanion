import type { BhModule } from '../../core/types.js';
import type { DriverFactory, InputDriver } from './input/driver.js';
import { createMockDriver } from './input/mockDriver.js';

interface Button {
  id: string;
  label: string;
  key: string;
}

/** Verfügbare Eingabe-Treiber. Der Windows-Treiber (SendInput) kommt als nächster Schritt. */
const drivers: Record<string, DriverFactory> = {
  mock: createMockDriver,
};

function parseButtons(raw: unknown): Button[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.map((b, i) => {
    const { id, label, key } = (b ?? {}) as Record<string, unknown>;
    if (typeof id !== 'string' || typeof label !== 'string' || typeof key !== 'string') {
      throw new Error(`Button #${i + 1}: id, label und key müssen Strings sein`);
    }
    if (seen.has(id)) throw new Error(`Button-ID "${id}" kommt doppelt vor`);
    seen.add(id);
    return { id, label, key };
  });
}

/** Live-Interface mit Buttons (GameGlass-Prinzip). Nur auf dem Companion sinnvoll. */
const mod: BhModule = {
  manifest: {
    id: 'controls',
    name: 'Controls',
    version: '0.1.0',
    roles: ['companion'],
    nav: { label: 'Controls', icon: '🎛️' },
    ui: true,
    noFocus: true, // Buttons senden Tasten ans Spiel, das Fenster darf den Fokus nicht nehmen
  },

  setup(ctx) {
    const driverName = String(ctx.config.driver ?? 'mock');
    const factory = drivers[driverName];
    if (!factory) {
      throw new Error(`Unbekannter Treiber "${driverName}" (verfügbar: ${Object.keys(drivers).join(', ')})`);
    }
    const driver: InputDriver = factory(ctx.log);
    const buttons = parseButtons(ctx.config.buttons);
    ctx.services.provide('input', driver);

    async function press(id: string) {
      const button = buttons.find((b) => b.id === id);
      if (!button) return null;
      await driver.press(button.key);
      ctx.events.emit('controls:pressed', { id: button.id });
      ctx.ws.broadcast('pressed', { id: button.id, label: button.label });
      return button;
    }

    ctx.http.get('/buttons', async () => ({
      driver: driver.name,
      buttons: buttons.map(({ id, label }) => ({ id, label })),
    }));

    ctx.http.post<{ Params: { id: string } }>('/press/:id', async (req, reply) => {
      const b = await press(req.params.id);
      if (!b) return reply.code(404).send({ error: 'Unbekannter Button' });
      return { ok: true };
    });

    ctx.ws.on('press', async (payload, client) => {
      const id = (payload as { id?: unknown } | null)?.id;
      if (typeof id !== 'string' || !(await press(id))) {
        client.send('error', { message: 'Unbekannter Button' });
      }
    });

    ctx.log.info(`${buttons.length} Buttons, Treiber: ${driver.name}`);
  },
};

export default mod;
