import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { BhModule } from '../../core/types.js';
import { calculate, DEFAULT_OPTIONS, InputError } from './calc.js';
import type { CalcOptions, Dataset, LoadoutInput, ScanInput } from './types.js';

/** Ein gespeichertes Loadout (Schiff + Laser + Module). */
interface SavedLoadout extends LoadoutInput {
  id: string;
  name: string;
  shipId: string;
}

interface LoadoutStore {
  activeId: string;
  loadouts: SavedLoadout[];
}

const MAX_LOADOUTS = 50;

function loadDataset(dir: string): Dataset {
  const file = join(dir, 'data', 'dataset.json');
  if (!existsSync(file)) throw new Error(`Datensatz fehlt: ${file} (npm run build kopiert ihn nach dist)`);
  return JSON.parse(readFileSync(file, 'utf8')) as Dataset;
}

/**
 * Mining Companion, Stufe 1: Scan-Werte eingeben (später per OCR), Loadout wählen, Ergebnis wie Bedrock.
 * Rechenkern: calc.ts. Daten: data/dataset.json (scripts/mining-data.mjs).
 */
const mod: BhModule = {
  manifest: {
    id: 'mining',
    name: 'Mining',
    version: '0.1.0',
    roles: ['companion'],
    nav: { label: 'Mining', icon: '⛏️' },
    ui: true,
  },

  setup(ctx) {
    const data = loadDataset(ctx.dir);
    const storeFile = join(ctx.dataDir, 'loadouts.json');

    const defaultLoadout = (): SavedLoadout => {
      const ship = data.ships[0];
      return { id: randomUUID(), name: `${ship.name} (Standard)`, shipId: ship.id, laserId: ship.heads[0].stockLaser, moduleIds: [] };
    };

    /** Prüft ein Loadout gegen den Datensatz. Wirft InputError mit verständlicher Meldung. */
    function validateLoadout(raw: unknown): SavedLoadout {
      const l = (raw ?? {}) as Record<string, unknown>;
      const name = typeof l.name === 'string' ? l.name.trim().slice(0, 60) : '';
      if (!name) throw new InputError('Loadout braucht einen Namen');
      const ship = data.ships.find((s) => s.id === l.shipId);
      if (!ship) throw new InputError(`Unbekanntes Schiff "${String(l.shipId)}"`);
      const laser = data.lasers.find((x) => x.id === l.laserId);
      if (!laser) throw new InputError(`Unbekannter Laser "${String(l.laserId)}"`);
      const head = ship.heads[0];
      if (laser.size !== head.size) throw new InputError(`${laser.name} (S${laser.size}) passt nicht in die ${ship.name} (S${head.size})`);
      // Sonderlaser (Pitman, Hyūn) tragen den Schiffsnamen als Pflicht-Tag, z. B. "DRAK_Golem"
      const special = laser.requiredTags.filter((t) => t !== 'miningMount');
      if (special.length && !special.includes(ship.id)) throw new InputError(`${laser.name} passt nur in ein bestimmtes Schiff`);
      const moduleIds = Array.isArray(l.moduleIds) ? l.moduleIds.filter((x): x is string => typeof x === 'string' && x !== '') : [];
      if (moduleIds.length > laser.slots) throw new InputError(`${laser.name} hat nur ${laser.slots} Modul-Slot(s)`);
      for (const id of moduleIds) if (!data.modules.some((m) => m.id === id)) throw new InputError(`Unbekanntes Modul "${id}"`);
      const id = typeof l.id === 'string' && /^[\w-]{1,64}$/.test(l.id) ? l.id : randomUUID();
      return { id, name, shipId: ship.id, laserId: laser.id, moduleIds };
    }

    function readStore(): LoadoutStore {
      try {
        if (existsSync(storeFile)) {
          const raw = JSON.parse(readFileSync(storeFile, 'utf8')) as LoadoutStore;
          // Einträge, die nicht mehr zum Datensatz passen (z. B. nach einem Patch), still verwerfen
          const loadouts = (raw.loadouts ?? []).flatMap((l) => {
            try {
              return [validateLoadout(l)];
            } catch {
              ctx.log.warn(`Loadout "${l?.name}" passt nicht mehr zu den Spieldaten und wurde ausgeblendet`);
              return [];
            }
          });
          if (loadouts.length) {
            const activeId = loadouts.some((l) => l.id === raw.activeId) ? raw.activeId : loadouts[0].id;
            return { activeId, loadouts };
          }
        }
      } catch (err) {
        ctx.log.warn(`loadouts.json nicht lesbar, starte mit Standard: ${(err as Error).message}`);
      }
      const d = defaultLoadout();
      return { activeId: d.id, loadouts: [d] };
    }

    function writeStore(store: LoadoutStore) {
      writeFileSync(storeFile + '.tmp', JSON.stringify(store, null, 2));
      renameSync(storeFile + '.tmp', storeFile);
    }

    let store = readStore();

    const badRequest = (reply: { code(n: number): { send(b: unknown): unknown } }, err: unknown) => {
      if (err instanceof InputError) return reply.code(400).send({ error: err.message });
      throw err;
    };

    /** Datensatz für die Oberfläche (Auswahllisten). */
    ctx.http.get('/data', async () => ({
      build: data.build,
      ships: data.ships,
      lasers: data.lasers,
      modules: data.modules,
      gadgets: data.gadgets,
      ores: data.ores,
      defaults: DEFAULT_OPTIONS,
    }));

    ctx.http.get('/loadouts', async () => store);

    /** Ganze Liste speichern (einfach und robust bei wenigen Einträgen). */
    ctx.http.put('/loadouts', async (req, reply) => {
      try {
        const body = (req.body ?? {}) as Partial<LoadoutStore>;
        if (!Array.isArray(body.loadouts) || body.loadouts.length === 0) throw new InputError('Mindestens ein Loadout nötig');
        if (body.loadouts.length > MAX_LOADOUTS) throw new InputError(`Höchstens ${MAX_LOADOUTS} Loadouts`);
        const loadouts = body.loadouts.map(validateLoadout);
        if (new Set(loadouts.map((l) => l.id)).size !== loadouts.length) throw new InputError('Doppelte Loadout-ID');
        const activeId = loadouts.some((l) => l.id === body.activeId) ? body.activeId! : loadouts[0].id;
        store = { activeId, loadouts };
        writeStore(store);
        return store;
      } catch (err) {
        return badRequest(reply, err);
      }
    });

    ctx.http.post('/calc', async (req, reply) => {
      try {
        const body = (req.body ?? {}) as { scan?: ScanInput; loadout?: LoadoutInput; options?: Partial<CalcOptions> };
        if (!body.scan || typeof body.scan !== 'object') throw new InputError('Scan-Werte fehlen');
        const loadout = body.loadout ?? store.loadouts.find((l) => l.id === store.activeId)!;
        const options = { ...DEFAULT_OPTIONS, ...(body.options ?? {}) };
        return calculate(data, body.scan, loadout, options);
      } catch (err) {
        return badRequest(reply, err);
      }
    });

    ctx.log.info(`Spieldaten ${data.build}: ${data.lasers.length} Laser, ${data.modules.length} Module, ${data.gadgets.length} Gadgets`);
  },
};

export default mod;
