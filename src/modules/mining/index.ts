import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { FastifyReply } from 'fastify';
import { SCREEN_CAPTURE_SERVICE, type BhModule, type ScreenCaptureService } from '../../core/types.js';
import { calculate, DEFAULT_OPTIONS, InputError, POWER_BONUS_RANGE } from './calc.js';
import { createScanValidator, emptyDraft, type ScanDraft } from './scanState.js';
import { noReader, type LineReader } from './ocr/engine.js';
import { ScreenError } from './ocr/image.js';
import { readScan } from './ocr/pipeline.js';
import { createPaddleReader } from './ocr/paddle.js';
import type { CalcOptions, Dataset, LoadoutInput, ScanInput } from './types.js';

/** Service "mining.scan" für andere Module (z. B. OCR): aktuellen Scan lesen oder ersetzen. */
export interface MiningScanService {
  get(): { revision: number; scan: ScanDraft };
  replace(scan: ScanDraft, origin?: string): { revision: number; scan: ScanDraft };
}

/** Ein gespeichertes Loadout (Schiff + Laser + Module). */
interface SavedLoadout extends LoadoutInput {
  id: string;
  name: string;
  shipId: string;
}

interface LoadoutStore {
  activeId: string;
  loadouts: SavedLoadout[];
  /**
   * Zählt jede Änderung hoch. Ein Gerät muss beim Speichern den Stand mitschicken, den es kennt.
   * So überschreibt das Handy nicht, was am PC inzwischen geändert wurde (HTTP 409).
   */
  revision: number;
  /**
   * Loadouts, die nicht mehr zu den Spieldaten passen (z. B. Modul nach einem Patch entfernt).
   * Sie bleiben in der Datei erhalten, damit nichts verloren geht, werden aber nicht angeboten.
   */
  stale: unknown[];
}

const MAX_LOADOUTS = 50;

/** Ausstehendes Speichern beim Beenden sofort erledigen (gesetzt in setup). */
let flushPending: (() => void) | null = null;

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
    nav: { label: 'Mining', icon: 'mining', description: 'Mining Companion' },
    ui: true,
  },

  setup(ctx) {
    const data = loadDataset(ctx.dir);
    const storeFile = join(ctx.dataDir, 'loadouts.json');

    const defaultLoadout = (): SavedLoadout => {
      const ship = data.ships[0];
      return { id: randomUUID(), name: `${ship.name} (Standard)`, shipId: ship.id, laserId: ship.heads[0].stockLaser, moduleIds: [], powerBonusPct: 0 };
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
      // Crafting-Bonus auf die Laserleistung in %, fehlt bei älteren Einträgen
      const bonus = l.powerBonusPct ?? 0;
      if (typeof bonus !== 'number' || !Number.isFinite(bonus) || bonus < POWER_BONUS_RANGE[0] || bonus > POWER_BONUS_RANGE[1]) {
        throw new InputError(`Crafting-Bonus muss zwischen ${POWER_BONUS_RANGE[0]} und ${POWER_BONUS_RANGE[1]} % liegen`);
      }
      return { id, name, shipId: ship.id, laserId: laser.id, moduleIds, powerBonusPct: Math.round(bonus * 100) / 100 };
    }

    function freshStore(stale: unknown[] = []): LoadoutStore {
      const d = defaultLoadout();
      return { activeId: d.id, loadouts: [d], revision: 1, stale };
    }

    /** Sicherungskopie einer Datei, die nicht gelesen werden konnte, bevor sie ersetzt wird. */
    function backupBrokenFile(reason: string) {
      const backup = `${storeFile}.kaputt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      try {
        copyFileSync(storeFile, backup);
        ctx.log.warn(`loadouts.json nicht lesbar (${reason}), Sicherung: ${backup}. Starte mit Standard.`);
      } catch {
        ctx.log.warn(`loadouts.json nicht lesbar (${reason}). Starte mit Standard.`);
      }
    }

    function readStore(): LoadoutStore {
      if (!existsSync(storeFile)) return freshStore();
      let raw: Partial<LoadoutStore>;
      try {
        raw = JSON.parse(readFileSync(storeFile, 'utf8'));
        if (typeof raw !== 'object' || raw === null || !Array.isArray(raw.loadouts)) throw new Error('unerwarteter Aufbau');
      } catch (err) {
        backupBrokenFile((err as Error).message);
        return freshStore();
      }
      const stale: unknown[] = Array.isArray(raw.stale) ? raw.stale : [];
      const loadouts: SavedLoadout[] = [];
      for (const l of raw.loadouts!) {
        try {
          loadouts.push(validateLoadout(l));
        } catch (err) {
          // Nicht löschen, sondern beiseitelegen: nach einem Daten-Update evtl. reparierbar
          stale.push(l);
          ctx.log.warn(`Loadout "${(l as { name?: string })?.name}" passt nicht mehr zu den Spieldaten: ${(err as Error).message}`);
        }
      }
      if (!loadouts.length) return freshStore(stale);
      const activeId = loadouts.some((l) => l.id === raw.activeId) ? raw.activeId! : loadouts[0].id;
      const revision = Number.isInteger(raw.revision) && raw.revision! > 0 ? raw.revision! : 1;
      return { activeId, loadouts, revision, stale };
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

    /** Was die Oberfläche sieht: ohne die beiseitegelegten Einträge, nur deren Anzahl. */
    const publicStore = () => ({
      activeId: store.activeId,
      loadouts: store.loadouts,
      revision: store.revision,
      staleCount: store.stale.length,
    });

    ctx.http.get('/loadouts', async () => publicStore());

    /** Ganze Liste speichern (einfach und robust bei wenigen Einträgen), mit Schutz vor veraltetem Stand. */
    // ---------- Gemeinsamer aktueller Scan (für alle Geräte) ----------
    const validator = createScanValidator(data);
    const scanFile = join(ctx.dataDir, 'scan.json');
    let current = { revision: 1, scan: emptyDraft() };
    if (existsSync(scanFile)) {
      try {
        const raw = JSON.parse(readFileSync(scanFile, 'utf8')) as { revision?: unknown; scan?: unknown };
        current = {
          revision: Number.isInteger(raw.revision) && (raw.revision as number) > 0 ? (raw.revision as number) : 1,
          scan: validator.validateDraft(raw.scan),
        };
      } catch (err) {
        ctx.log.warn(`scan.json nicht lesbar, starte leer: ${(err as Error).message}`);
      }
    }
    // Schreiben gebündelt: Beim Tippen kommen viele kleine Änderungen hintereinander
    let saveTimer: NodeJS.Timeout | null = null;
    const writeScan = () => {
      try {
        writeFileSync(scanFile + '.tmp', JSON.stringify(current));
        renameSync(scanFile + '.tmp', scanFile);
      } catch (err) {
        ctx.log.warn(`scan.json konnte nicht gespeichert werden: ${(err as Error).message}`);
      }
    };
    const saveScan = () => {
      if (saveTimer) return;
      saveTimer = setTimeout(() => {
        saveTimer = null;
        writeScan();
      }, 300);
    };
    flushPending = () => {
      if (!saveTimer) return;
      clearTimeout(saveTimer);
      saveTimer = null;
      writeScan();
    };

    /** Änderung übernehmen, speichern und an alle Geräte verteilen. origin: wer geändert hat (Gerät/OCR). */
    function commitScan(next: ScanDraft, origin: string) {
      current = { revision: current.revision + 1, scan: next };
      saveScan();
      ctx.ws.broadcast('scan', { ...current, origin });
      return current;
    }

    ctx.services.provide<MiningScanService>('mining.scan', {
      get: () => current,
      replace: (scan, origin = 'service') => commitScan(validator.validateDraft(scan), origin),
    });

    ctx.http.get('/scan', async () => current);

    // ---------- OCR: Screenshot einlesen ----------
    // Texterkennung: PaddleOCR (Modell in data/ocr). Abschaltbar per Config modules.mining.ocr = false.
    const reader: LineReader = ctx.config.ocr === false ? noReader : createPaddleReader(join(ctx.dir, 'data', 'ocr'));
    const samplesDir = join(ctx.dataDir, 'ocr-samples');
    const MAX_SAMPLES = 100;
    /** Panel-Ausschnitt + Ergebnis aufheben: verlustfreie Beispiele, um die Erkennung zu verbessern. */
    function keepSample(panelPng: Buffer, result: unknown) {
      try {
        mkdirSync(samplesDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        writeFileSync(join(samplesDir, `${stamp}-panel.png`), panelPng);
        writeFileSync(join(samplesDir, `${stamp}-result.json`), JSON.stringify(result, null, 2));
        const files = readdirSync(samplesDir).filter((f) => f.endsWith('-panel.png')).sort();
        for (const old of files.slice(0, Math.max(0, files.length - MAX_SAMPLES))) {
          rmSync(join(samplesDir, old), { force: true });
          rmSync(join(samplesDir, old.replace('-panel.png', '-result.json')), { force: true });
        }
      } catch (err) {
        ctx.log.warn(`OCR-Beispiel nicht gespeichert: ${(err as Error).message}`);
      }
    }

    // Bilder kommen als rohe Bytes (Content-Type image/png, image/jpeg, image/webp)
    ctx.http.addContentTypeParser(
      ['image/png', 'image/jpeg', 'image/webp', 'application/octet-stream'],
      { parseAs: 'buffer', bodyLimit: 20 * 1024 * 1024 },
      (_req, body, done) => done(null, body),
    );

    /** Screenshot lesen; apply: Ergebnis in den gemeinsamen Scan übernehmen (nur wenn das Panel gefunden wurde). */
    async function ocrImage(image: Buffer, apply: boolean, reply: FastifyReply) {
      try {
        const { result, panelPng } = await readScan(image, reader, data.ores);
        keepSample(panelPng, result);
        let applied = false;
        if (apply && result.panelFound) {
          commitScan(validator.validateDraft({ ...result.draft, marks: result.marks }), 'ocr');
          applied = true;
        }
        ctx.log.info(`OCR (${result.engine}, ${result.ms} ms): Panel ${result.panelFound ? 'gefunden' : 'nicht gefunden'}, ${Object.keys(result.marks).length} Feld(er) zu prüfen`);
        return { ...result, applied };
      } catch (err) {
        if (err instanceof ScreenError) return reply.code(400).send({ error: err.message });
        ctx.log.error('OCR fehlgeschlagen:', err);
        return reply.code(500).send({ error: `Screenshot konnte nicht gelesen werden: ${(err as Error).message}` });
      }
    }

    /** POST /api/mining/ocr[?apply=1] mit dem Screenshot als Body. */
    ctx.http.post<{ Querystring: { apply?: string } }>('/ocr', async (req, reply) => {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return reply.code(400).send({ error: 'Screenshot fehlt (PNG, JPG oder WebP als Body senden)' });
      }
      return ocrImage(req.body, req.query.apply === '1', reply);
    });

    // Bildschirmaufnahme am Spiel-PC: nur in der Desktop-App. Hotkeys kommen im Spiel nicht an (Star Citizen
    // blockiert sie), deshalb löst man die Aufnahme per Knopf aus, z. B. am Handy.
    const screen = ctx.services.get<ScreenCaptureService>(SCREEN_CAPTURE_SERVICE);
    let capturing = false;

    /** GET /api/mining/ocr: Was ist möglich? */
    ctx.http.get('/ocr', async () => ({ engine: reader.name, capture: Boolean(screen) }));

    /** POST /api/mining/ocr/capture: Screenshot am Spiel-PC aufnehmen, lesen und übernehmen. */
    ctx.http.post('/ocr/capture', async (_req, reply) => {
      if (!screen) return reply.code(501).send({ error: 'Aufnahme am PC geht nur, wenn Black Halo als Desktop-App läuft.' });
      if (capturing) return reply.code(409).send({ error: 'Es wird gerade schon ein Screenshot gelesen.' });
      capturing = true;
      try {
        let png: Buffer;
        try {
          png = await screen.capture();
        } catch (err) {
          return reply.code(502).send({ error: `Bildschirmaufnahme fehlgeschlagen: ${(err as Error).message}` });
        }
        return await ocrImage(png, true, reply);
      } finally {
        capturing = false;
      }
    });

    /** Änderungen als Befehle: { ops: [...], origin: "<geräte-id>" }. Antwort: neuer Stand. */
    ctx.http.post('/scan', async (req, reply) => {
      try {
        const body = (req.body ?? {}) as { ops?: unknown; origin?: unknown };
        const origin = typeof body.origin === 'string' && /^[\w-]{1,64}$/.test(body.origin) ? body.origin : 'unbekannt';
        return commitScan(validator.apply(current.scan, body.ops), origin);
      } catch (err) {
        return badRequest(reply, err);
      }
    });

    ctx.http.put('/loadouts', async (req, reply) => {
      try {
        const body = (req.body ?? {}) as Partial<LoadoutStore>;
        if (body.revision !== store.revision) {
          return reply.code(409).send({
            error: 'Die Loadouts wurden inzwischen auf einem anderen Gerät geändert. Der aktuelle Stand wurde geladen.',
            current: publicStore(),
          });
        }
        if (!Array.isArray(body.loadouts) || body.loadouts.length === 0) throw new InputError('Mindestens ein Loadout nötig');
        if (body.loadouts.length > MAX_LOADOUTS) throw new InputError(`Höchstens ${MAX_LOADOUTS} Loadouts`);
        const loadouts = body.loadouts.map(validateLoadout);
        if (new Set(loadouts.map((l) => l.id)).size !== loadouts.length) throw new InputError('Doppelte Loadout-ID');
        const activeId = loadouts.some((l) => l.id === body.activeId) ? body.activeId! : loadouts[0].id;
        store = { activeId, loadouts, revision: store.revision + 1, stale: store.stale };
        writeStore(store);
        // Andere Geräte (z. B. Handy) übernehmen Loadout-Wechsel sofort
        ctx.ws.broadcast('loadouts', publicStore());
        return publicStore();
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

  stop() {
    flushPending?.();
    flushPending = null;
  },
};

export default mod;
