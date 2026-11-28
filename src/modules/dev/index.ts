import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEV_DEFAULTS,
  DEV_SETTINGS_SERVICE,
  SAMPLE_STORES_SERVICE,
  type BhModule,
  type DevSettings,
  type DevSettingsService,
  type SampleStore,
} from '../../core/types.js';

const KEYS = Object.keys(DEV_DEFAULTS) as (keyof DevSettings)[];

/** Nur bekannte Schalter mit echten true/false übernehmen, alles andere ignorieren. */
function pick(src: unknown): Partial<DevSettings> {
  const out: Partial<DevSettings> = {};
  if (typeof src !== 'object' || src === null) return out;
  for (const k of KEYS) {
    const v = (src as Record<string, unknown>)[k];
    if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

/**
 * Menü "Dev": Schalter für die Entwicklung des Tools, z. B. ob OCR-Scans als Bild gespeichert werden
 * (Trainingsdaten). Für normale Nutzung ist alles aus, damit nichts unbemerkt Speicher belegt.
 * Stand in data/dev/settings.json; Startwerte können über die Config (modules.dev.<schalter>) gesetzt werden.
 */
const mod: BhModule = {
  manifest: {
    id: 'dev',
    name: 'Dev',
    version: '0.1.0',
    roles: ['companion', 'hub'],
    nav: { label: 'Dev', icon: 'wrench', description: 'Entwickler-Einstellungen', order: 100 },
    ui: true,
  },

  setup(ctx) {
    const file = join(ctx.dataDir, 'settings.json');
    const base: DevSettings = { ...DEV_DEFAULTS, ...pick(ctx.config) };
    let saved: Partial<DevSettings> = {};
    if (existsSync(file)) {
      try {
        saved = pick(JSON.parse(readFileSync(file, 'utf8')));
      } catch (err) {
        ctx.log.warn(`${file} ist kein gültiges JSON, Dev-Schalter auf Standard: ${(err as Error).message}`);
      }
    }
    let settings: DevSettings = { ...base, ...saved };
    const listeners = new Set<(s: DevSettings) => void>();

    const service: DevSettingsService = {
      get: () => ({ ...settings }),
      onChange(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    };
    ctx.services.provide<DevSettingsService>(DEV_SETTINGS_SERVICE, service);

    const stores = () => ctx.services.get<SampleStore[]>(SAMPLE_STORES_SERVICE) ?? [];
    const storeInfo = () =>
      stores().map((s) => {
        try {
          return { id: s.id, label: s.label, path: s.path, ...s.stats() };
        } catch (err) {
          return { id: s.id, label: s.label, path: s.path, files: 0, bytes: 0, samples: 0, error: (err as Error).message };
        }
      });
    const state = () => ({ settings: service.get(), stores: storeInfo() });

    ctx.http.get('/', async () => state());

    /** POST /api/dev/settings { saveOcrSamples?: boolean, ... } */
    ctx.http.post('/settings', async (req, reply) => {
      const body = req.body;
      if (typeof body !== 'object' || body === null || Array.isArray(body)) return reply.code(400).send({ error: 'Erwartet ein Objekt mit Schaltern' });
      const unknown = Object.keys(body).filter((k) => !KEYS.includes(k as keyof DevSettings));
      if (unknown.length) return reply.code(400).send({ error: `Unbekannte Schalter: ${unknown.join(', ')}` });
      const patch = pick(body);
      if (Object.keys(patch).length !== Object.keys(body).length) return reply.code(400).send({ error: 'Schalter nur mit true oder false' });
      const next = { ...settings, ...patch };
      try {
        const tmp = `${file}.tmp`;
        writeFileSync(tmp, JSON.stringify(next, null, 2));
        renameSync(tmp, file);
      } catch (err) {
        return reply.code(500).send({ error: `Einstellungen nicht gespeichert: ${(err as Error).message}` });
      }
      const changed = KEYS.filter((k) => next[k] !== settings[k]);
      settings = next;
      if (changed.length) {
        ctx.log.info(`Dev: ${changed.map((k) => `${k} ${settings[k] ? 'an' : 'aus'}`).join(', ')}`);
        for (const fn of listeners) {
          try {
            fn(service.get());
          } catch (err) {
            ctx.log.warn(`Dev: Listener fehlgeschlagen: ${(err as Error).message}`);
          }
        }
        ctx.ws.broadcast('state', state());
      }
      return state();
    });

    /** POST /api/dev/clear { store: "<id>" }: gespeicherte Beispiele eines Ordners löschen. */
    ctx.http.post('/clear', async (req, reply) => {
      const id = (req.body as { store?: unknown } | null)?.store;
      const store = stores().find((s) => s.id === id);
      if (!store) return reply.code(400).send({ error: 'Unbekannter Ordner' });
      let deleted: number;
      try {
        deleted = store.clear();
      } catch (err) {
        return reply.code(500).send({ error: `Löschen fehlgeschlagen: ${(err as Error).message}` });
      }
      ctx.log.info(`Dev: ${deleted} Datei(en) in ${store.label} gelöscht`);
      const out = state();
      ctx.ws.broadcast('state', out);
      return { ...out, deleted };
    });
  },
};

export default mod;
