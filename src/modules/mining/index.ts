import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { FastifyReply } from 'fastify';
import {
  DEV_DEFAULTS,
  DEV_SETTINGS_SERVICE,
  SAMPLE_STORES_SERVICE,
  SCREEN_CAPTURE_SERVICE,
  type BhModule,
  type DevSettings,
  type DevSettingsService,
  type SampleStore,
  type ScreenCaptureService,
} from '../../core/types.js';
import { calculate, DEFAULT_OPTIONS, InputError, POWER_BONUS_RANGE } from './calc.js';
import { knownSignatures, matchSignature, parseSignature, signatureTable, summarizeSignature } from './signature.js';
import { createScanValidator, emptyDraft, type ScanDraft } from './scanState.js';
import { noDetector, noReader, type LineReader, type TextDetector } from './ocr/engine.js';
import { ScreenError } from './ocr/image.js';
import { readScan } from './ocr/pipeline.js';
import { createPaddleDetector, createPaddleReader } from './ocr/paddle.js';
import { loadGlyphModel } from './ocr/glyphs.js';
import { readSignatures, SIGNATURE_BAND, SignatureTracker, type SignatureTrace } from './ocr/signatures.js';
import { loadTagFont } from './ocr/tagfont.js';
import { loadWin32 } from '../controls/input/win32.js';
import sharp from 'sharp';
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
let stopLive: (() => void) | null = null;

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
      signatures: {
        table: signatureTable(data),
        families: data.signatures.families,
        debris: data.signatures.debris,
        locations: data.signatures.locations.map(({ id, name, system, surface }) => ({ id, name, system, surface })),
      },
    }));

    /** GET /api/mining/signature?value=6370[&location=HPP_Stanton1d]: Radar-Signatur deuten. */
    ctx.http.get<{ Querystring: { value?: string; location?: string } }>('/signature', async (req, reply) => {
      const value = parseSignature(req.query.value ?? '');
      if (value == null) return reply.code(400).send({ error: 'Signatur als Zahl eingeben (z. B. 6370 oder 6.370).' });
      const location = typeof req.query.location === 'string' && /^[\w-]{1,64}$/.test(req.query.location) ? req.query.location : undefined;
      return matchSignature(value, data, { location });
    });

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
    /** Overlay neu verteilen (wird unten gesetzt, sobald alles da ist). */
    let notifyOverlay = () => {};
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
    const ocrDir = join(ctx.dir, 'data', 'ocr');
    const reader: LineReader = ctx.config.ocr === false ? noReader : createPaddleReader(ocrDir);
    const detector: TextDetector = ctx.config.ocr === false ? noDetector : createPaddleDetector(ocrDir);
    // Eigene Ziffernerkennung (bestätigt nur zweifelhafte Ziffern); fehlt das Modell, bleibt alles markiert wie bisher
    const glyphs = ctx.config.ocr === false ? null : loadGlyphModel(ocrDir);
    // Schrift der Radar-Schilder (zweite Meinung beim Live-Lesen); fehlt das Modell, liest das Lexikon allein
    const tagFont = ctx.config.ocr === false ? null : loadTagFont(ocrDir);
    /** Schalter aus dem Menü "Dev" (zur Zeit des Aufrufs gelesen); ohne Dev-Modul gilt der Standard (aus). */
    const devSetting = (key: keyof DevSettings) => ctx.services.get<DevSettingsService>(DEV_SETTINGS_SERVICE)?.get()[key] ?? DEV_DEFAULTS[key];
    const samplesDir = join(ctx.dataDir, 'ocr-samples');
    const confirmedDir = join(samplesDir, 'confirmed');
    const MAX_SAMPLES = 60;
    const MAX_CONFIRMED = 200;
    /** Älteste Beispiele (Bild + JSON-Dateien mit derselben Kennung) über der Grenze löschen. */
    function rotate(dir: string, max: number, image = '-panel.png') {
      const files = readdirSync(dir).filter((f) => f.endsWith(image)).sort();
      for (const old of files.slice(0, Math.max(0, files.length - max))) {
        const id = old.slice(0, -image.length);
        for (const f of readdirSync(dir)) if (f.startsWith(id + '-')) rmSync(join(dir, f), { force: true });
      }
    }
    /**
     * Kennung einer OCR (Zeitstempel). Jede OCR bekommt eine, auch wenn kein Bild gespeichert wird: Sie schützt den
     * neuen Scan vor verspäteten Änderungen zum alten (409 bei POST /scan, "Alles geprüft" nur für den gesehenen Scan)
     * und zeigt "Bitte prüfen" an allen Geräten. Gleicher Zeitstempel zweimal (sehr selten): Zähler anhängen.
     */
    let lastOcrId = '';
    let sameIdCount = 0;
    function newOcrId(): string {
      const t = new Date().toISOString().replace(/[:.]/g, '-');
      sameIdCount = t === lastOcrId.slice(0, t.length) ? sameIdCount + 1 : 0;
      lastOcrId = sameIdCount ? `${t}-${sameIdCount}` : t;
      return lastOcrId;
    }
    /** Panel-Ausschnitt + Ergebnis unter der Kennung der OCR aufheben (verlustfreie Beispiele, um die Erkennung zu verbessern). */
    function keepSample(id: string, panelPng: Buffer, result: unknown) {
      try {
        mkdirSync(samplesDir, { recursive: true });
        writeFileSync(join(samplesDir, `${id}-panel.png`), panelPng);
        writeFileSync(join(samplesDir, `${id}-result.json`), JSON.stringify(result, null, 2));
        rotate(samplesDir, MAX_SAMPLES);
      } catch (err) {
        ctx.log.warn(`OCR-Beispiel nicht gespeichert: ${(err as Error).message}`);
      }
    }
    /**
     * "Alles geprüft" nach einer OCR: Beispiel nach confirmed/ verschieben und den bestätigten Scan als Wahrheit
     * daneben legen (Trainingsdaten). Bestätigte Beispiele werden nicht mit den übrigen rotiert.
     */
    function confirmSample(id: string, scan: ScanDraft) {
      try {
        const panel = join(samplesDir, `${id}-panel.png`);
        if (!existsSync(panel)) return; // schon rotiert
        mkdirSync(confirmedDir, { recursive: true });
        for (const suffix of ['-panel.png', '-result.json']) {
          if (existsSync(join(samplesDir, id + suffix))) renameSync(join(samplesDir, id + suffix), join(confirmedDir, id + suffix));
        }
        const { marks: _m, ocrSample: _o, ...truth } = scan;
        writeFileSync(join(confirmedDir, `${id}-truth.json`), JSON.stringify({ confirmedAt: new Date().toISOString(), scan: truth }, null, 2));
        rotate(confirmedDir, MAX_CONFIRMED);
        ctx.log.info(`OCR-Beispiel ${id} bestätigt (Trainingsdaten)`);
      } catch (err) {
        ctx.log.warn(`OCR-Beispiel nicht bestätigt: ${(err as Error).message}`);
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
        const { result, panelPng } = await readScan(image, reader, data.ores, { detector, glyphs });
        const sample = newOcrId();
        // Beispielbild nur, wenn im Menü "Dev" eingeschaltet (sonst wächst der Ordner bei jedem Scan).
        // Ohne Bild bleibt "Alles geprüft" harmlos: confirmSample findet kein Bild und speichert nichts.
        if (devSetting('saveOcrSamples')) keepSample(sample, panelPng, result);
        let applied = false;
        if (apply && result.panelFound) {
          commitScan(validator.validateDraft({ ...result.draft, marks: result.marks, ocrSample: sample }), 'ocr');
          applied = true;
        }
        ctx.log.info(`OCR (${result.engine}, ${result.ms} ms): Panel ${result.panelFound ? 'gefunden' : 'nicht gefunden'}${result.scale !== 1 ? ` (HUD-Maßstab ${result.scale.toFixed(2)})` : ''}, ${Object.keys(result.marks).length} Feld(er) zu prüfen`);
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

    // ---------- Radar-Signaturen live lesen ----------
    // Desktop-App nimmt etwa jede Sekunde das Band um das Fadenkreuz auf (nur wenn Star Citizen vorne ist), die
    // gelesenen Zahlen werden über mehrere Bilder bestätigt und an alle Geräte verteilt. Nur anzeigen, nie steuern.
    const isKnown = (v: number) => matchSignature(v, data).exact;
    // Lexikon der Live-Lesung (sonst einmalig aus isKnown bestimmt, ~3 s beim ersten Bild)
    const known = knownSignatures(data);
    const tracker = new SignatureTracker(isKnown);
    const liveInterval = Math.max(300, Number(ctx.config.signatureIntervalMs) || 800);
    const gameProcess = String(ctx.config.gameProcess ?? 'StarCitizen.exe').toLowerCase();
    const sigSamplesDir = join(ctx.dataDir, 'signature-samples');
    // Fehlersuche (Dev): Bilder auch ohne Treffer, höchstens alle FRAME_EVERY_MS eins, die letzten MAX_FRAMES
    const sigFramesDir = join(ctx.dataDir, 'signature-frames');
    const FRAME_EVERY_MS = 3000;
    const MAX_FRAMES = 200;
    let lastFrameSaved = 0;
    const live = { on: false, status: 'aus', ms: 0, captureMs: 0, readMs: 0, frameAt: 0 };
    /** Mindestpause nach jedem Bild, damit das Lesen neben dem Spiel nicht dauernd CPU belegt. */
    const LIVE_MIN_PAUSE = 600;
    let liveTimer: NodeJS.Timeout | null = null;
    // Ort fürs Live-Lesen (für alle Geräte gleich, bleibt nach Neustart): Deutungen, die dort nicht vorkommen, fallen weg
    const locationFile = join(ctx.dataDir, 'signature-location.json');
    const validLocation = (v: unknown): v is string => typeof v === 'string' && data.signatures.locations.some((l) => l.id === v);
    let liveLocation: string | undefined;
    /** Wurde der Ort je gewählt? (Sonst übernimmt der PC beim ersten Mal den eines Geräts.) */
    let locationChosen = existsSync(locationFile);
    try {
      const saved = locationChosen ? JSON.parse(readFileSync(locationFile, 'utf8')).location : undefined;
      if (validLocation(saved)) liveLocation = saved;
    } catch (err) {
      ctx.log.warn(`Ort fürs Live-Lesen nicht lesbar: ${(err as Error).message}`);
    }
    const summarize = (value: number) => summarizeSignature(value, data, liveLocation);
    const liveState = () => ({
      on: live.on,
      status: live.status,
      ms: live.ms,
      captureMs: live.captureMs,
      readMs: live.readMs,
      capture: Boolean(screen),
      // null: noch nie gewählt; '': bewusst "Ort: egal"
      location: locationChosen ? (liveLocation ?? '') : null,
      contacts: tracker.contacts(Date.now()).map((c) => ({ ...c, ...summarize(c.value) })),
    });
    let lastBroadcast = '';
    const broadcastLive = (force = false) => {
      const state = liveState();
      const key = JSON.stringify({ ...state, ms: 0, contacts: state.contacts.map((c) => [c.value, c.lastSeen]) });
      if (!force && key === lastBroadcast) return;
      lastBroadcast = key;
      ctx.ws.broadcast('signatures', state);
    };
    /** Ist das Spiel im Vordergrund? Unter Windows über die Fenster-API (wie Controls), sonst immer ja. */
    const gameInFront = async () => {
      if (process.platform !== 'win32') return true;
      try {
        const w = await loadWin32();
        return w.processName(w.foreground()).toLowerCase() === gameProcess;
      } catch {
        return true;
      }
    };
    /** Bild mit neu bestätigter Signatur aufheben (Trainingsdaten für eine spätere eigene Erkennung). */
    const keepSignatureSample = (png: Buffer, info: unknown) => {
      try {
        mkdirSync(sigSamplesDir, { recursive: true });
        const id = new Date().toISOString().replace(/[:.]/g, '-');
        writeFileSync(join(sigSamplesDir, `${id}-band.png`), png);
        writeFileSync(join(sigSamplesDir, `${id}-reads.json`), JSON.stringify(info, null, 2));
        rotate(sigSamplesDir, MAX_SAMPLES, '-band.png');
      } catch (err) {
        ctx.log.warn(`Signatur-Beispiel nicht gespeichert: ${(err as Error).message}`);
      }
    };

    // Beispiel-Ordner fürs Menü "Dev": Größe anzeigen und leeren (nur Dateien direkt im Ordner, confirmed/ ist ein eigener)
    const sampleStore = (id: string, label: string, dir: string, image: string): SampleStore => {
      const files = () => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()) : []);
      return {
        id,
        label,
        path: dir,
        stats() {
          const list = files();
          let bytes = 0;
          for (const f of list) {
            try {
              bytes += statSync(join(dir, f.name)).size;
            } catch {
              // inzwischen gelöscht (Rotation)
            }
          }
          return { files: list.length, bytes, samples: list.filter((f) => f.name.endsWith(image)).length };
        },
        clear() {
          let n = 0;
          for (const f of files()) {
            rmSync(join(dir, f.name), { force: true });
            n++;
          }
          return n;
        },
      };
    };
    ctx.services.provide<SampleStore[]>(SAMPLE_STORES_SERVICE, [
      sampleStore('ocr', 'OCR-Scans (letzte Lesungen)', samplesDir, '-panel.png'),
      sampleStore('ocr-confirmed', 'OCR-Scans bestätigt (Trainingsdaten)', confirmedDir, '-panel.png'),
      sampleStore('signature', 'Radar-Signaturen', sigSamplesDir, '-band.png'),
      sampleStore('signature-frames', 'Radar-Bilder (Fehlersuche)', sigFramesDir, '-band.png'),
    ]);
    /** Fehlersuche: Bild des Suchbands mit allen Kästen und Lesungen aufheben (auch ohne Treffer). */
    const keepFrame = (png: Buffer, info: unknown) => {
      try {
        mkdirSync(sigFramesDir, { recursive: true });
        const id = new Date().toISOString().replace(/[:.]/g, '-');
        writeFileSync(join(sigFramesDir, `${id}-band.png`), png);
        writeFileSync(join(sigFramesDir, `${id}-trace.json`), JSON.stringify(info, null, 2));
        rotate(sigFramesDir, MAX_FRAMES, '-band.png');
      } catch (err) {
        ctx.log.warn(`Radar-Bild (Fehlersuche) nicht gespeichert: ${(err as Error).message}`);
      }
    };
    const liveTick = async () => {
      liveTimer = null;
      if (!live.on || !screen) return;
      const t0 = Date.now();
      try {
        if (!(await gameInFront())) {
          live.status = 'pausiert: Star Citizen ist nicht im Vordergrund';
          if (tracker.contacts(Date.now()).length === 0) tracker.clear();
        } else {
          const [x, y, width, height] = SIGNATURE_BAND;
          const png = await screen.capture({ x, y, width, height });
          live.captureMs = Date.now() - t0;
          const { data: px, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
          const before = new Set(tracker.contacts(Date.now()).map((c) => c.value));
          const frames = devSetting('saveSignatureFrames') && Date.now() - lastFrameSaved >= FRAME_EVERY_MS;
          const trace: SignatureTrace[] | undefined = frames ? [] : undefined;
          const reads = await readSignatures({ width: info.width, height: info.height, data: px }, reader, detector, isKnown, [0, 0, info.width, info.height], [x, y], trace, { known, tagFont });
          live.frameAt = Date.now();
          tracker.add(reads, live.frameAt);
          const contacts = tracker.contacts(Date.now());
          const fresh = contacts.filter((c) => !before.has(c.value));
          if (fresh.length && devSetting('saveSignatureSamples')) keepSignatureSample(png, { reads, confirmed: fresh.map((c) => c.value) });
          if (frames) {
            lastFrameSaved = Date.now();
            keepFrame(png, { band: SIGNATURE_BAND, ms: Date.now() - t0, boxes: trace, reads, contacts: contacts.map((c) => c.value) });
          }
          live.ms = Date.now() - t0;
          live.readMs = live.ms - live.captureMs;
          live.status = 'läuft';
        }
      } catch (err) {
        live.status = `Fehler: ${(err as Error).message}`;
      }
      broadcastLive();
      notifyOverlay();
      if (live.on) liveTimer = setTimeout(liveTick, Math.max(LIVE_MIN_PAUSE, liveInterval - (Date.now() - t0)));
    };
    const setLive = (on: boolean) => {
      live.on = on;
      live.status = on ? 'startet' : 'aus';
      if (liveTimer) clearTimeout(liveTimer);
      liveTimer = null;
      if (on) void liveTick();
      broadcastLive(true);
    };
    stopLive = () => {
      live.on = false;
      if (liveTimer) clearTimeout(liveTimer);
      liveTimer = null;
    };

    /** GET /api/mining/signature/live: Stand des Live-Lesens (an, Status, bestätigte Kontakte). */
    ctx.http.get('/signature/live', async () => liveState());

    /**
     * POST /api/mining/signature/live { on?: true|false, location?: "<Ort-ID>"|"" }: Live-Lesen ein/aus und Ort für die
     * Deutung (für alle Geräte; "" = Ort egal).
     */
    ctx.http.post('/signature/live', async (req, reply) => {
      const body = (req.body ?? {}) as { on?: unknown; location?: unknown };
      const hasOn = 'on' in body;
      const hasLocation = 'location' in body;
      if (!hasOn && !hasLocation) return reply.code(400).send({ error: 'on: true oder false, oder location' });
      if (hasOn && typeof body.on !== 'boolean') return reply.code(400).send({ error: 'on: true oder false' });
      if (hasLocation && body.location !== '' && !validLocation(body.location)) return reply.code(400).send({ error: 'Unbekannter Ort' });
      if (body.on === true && !screen) return reply.code(501).send({ error: 'Live-Lesen geht nur, wenn Black Halo als Desktop-App läuft.' });
      if (hasLocation) {
        const next = body.location === '' ? undefined : (body.location as string);
        if (next !== liveLocation || !locationChosen) {
          liveLocation = next;
          locationChosen = true;
          try {
            writeFileSync(locationFile, JSON.stringify({ location: liveLocation ?? '' }));
          } catch (err) {
            ctx.log.warn(`Ort fürs Live-Lesen nicht gespeichert: ${(err as Error).message}`);
          }
          broadcastLive(true);
          notifyOverlay();
        }
      }
      if (hasOn) setLive(body.on as boolean);
      return liveState();
    });

    // ---------- Overlay über dem Spiel ----------
    // Die Desktop-App zeigt ein durchsichtiges, durchklickbares Fenster (nur Anzeige). Es lädt /modules/mining/overlay.html
    // und zeigt die Deutung live gelesener Radar-Signaturen neben dem Marker. Ein/aus vom Handy aus.
    // (Ein Band am Energie-Bogen wurde getestet und verworfen: Das HUD wackelt ständig mit dem Kopf, das Overlay
    // müsste etwa 10x pro Sekunde nachgeführt werden.)
    const overlayPrefs = { visible: true };
    const overlayState = () => ({
      ...overlayPrefs,
      // Nur Signaturen aus dem zuletzt gelesenen Bild: Marker bewegen sich, alte Beschriftungen würden überlappen
      contacts: tracker
        .contacts(Date.now())
        .filter((c) => live.on && c.lastSeen === live.frameAt && Date.now() - c.lastSeen < 3000)
        .map((c) => ({ value: c.value, x: c.x, y: c.y, lastSeen: c.lastSeen, ...summarize(c.value) })),
    });
    // Signatur-Beschriftungen nach 3 s ausblenden, auch wenn kein neues Bild kommt (z. B. Spiel nicht vorne)
    const overlayClock = setInterval(() => notifyOverlay(), 1000);
    overlayClock.unref();
    const stopLiveOnly = stopLive;
    stopLive = () => {
      stopLiveOnly?.();
      clearInterval(overlayClock);
    };
    let lastOverlay = '';
    notifyOverlay = () => {
      const state = overlayState();
      const key = JSON.stringify(state);
      if (key === lastOverlay) return;
      lastOverlay = key;
      ctx.ws.broadcast('overlay', state);
    };

    /** GET /api/mining/overlay: was das Overlay zeichnet. */
    ctx.http.get('/overlay', async () => overlayState());

    /** POST /api/mining/overlay { visible }: Overlay ein/aus (für alle Geräte). */
    ctx.http.post('/overlay', async (req, reply) => {
      const visible = (req.body as { visible?: unknown } | null)?.visible;
      if (typeof visible !== 'boolean') return reply.code(400).send({ error: 'visible: true oder false' });
      overlayPrefs.visible = visible;
      notifyOverlay();
      return overlayState();
    });

    /** Änderungen als Befehle: { ops: [...], origin: "<geräte-id>" }. Antwort: neuer Stand. */
    ctx.http.post('/scan', async (req, reply) => {
      try {
        const body = (req.body ?? {}) as { ops?: unknown; origin?: unknown; base?: unknown };
        const origin = typeof body.origin === 'string' && /^[\w-]{1,64}$/.test(body.origin) ? body.origin : 'unbekannt';
        // base: OCR-Stand, auf den sich die Änderungen beziehen ('' = keiner). Kam inzwischen eine andere OCR, würden
        // die Änderungen den neuen Scan verfälschen (z. B. verspätet gesendet nach einem Funkloch): ablehnen.
        const now = current.scan.ocrSample ?? '';
        if (typeof body.base === 'string' && now && body.base !== now) {
          return reply.code(409).send({ error: 'Inzwischen wurde ein neuer Scan eingelesen. Die Änderung wurde nicht übernommen.', current });
        }
        // "Alles geprüft" nach einer OCR: korrigierten Scan (Stand beim Bestätigen) als Wahrheit speichern.
        // Erst nach erfolgreicher Anwendung aller Befehle schreiben.
        const confirmed: [string, ScanDraft][] = [];
        const next = validator.apply(current.scan, body.ops, (sample, scan) => confirmed.push([sample, scan]));
        for (const [sample, scan] of confirmed) confirmSample(sample, scan);
        return commitScan(next, origin);
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
    stopLive?.();
    stopLive = null;
    flushPending?.();
    flushPending = null;
  },
};

export default mod;
