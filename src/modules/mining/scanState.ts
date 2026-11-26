/**
 * Gemeinsamer "aktueller Scan" für alle Geräte (PC-Fenster, Handy, Tablet, später OCR).
 *
 * Gespeichert wird der Entwurf genau so, wie er getippt wurde (Texte, z. B. "64," oder "901.80m"),
 * damit auf allen Geräten dasselbe in den Feldern steht. Gerechnet wird daraus erst in der Oberfläche.
 * Änderungen kommen als kleine Befehle pro Feld, damit sich zwei Geräte nicht gegenseitig
 * ganze Formulare überschreiben.
 */
import { InputError } from './calc.js';
import type { Dataset } from './types.js';

export type ColorChoice = 'white' | 'green' | 'red';

export interface PartDraft {
  pct: string;
  ore: string;
  quality: string;
}

export interface ScanDraft {
  mass: string;
  resistance: string;
  resColor: ColorChoice;
  instability: string;
  instColor: ColorChoice;
  scu: string;
  gadget: string;
  parts: PartDraft[];
  /**
   * Felder, die zum Prüfen markiert sind (z. B. von der OCR unsicher gelesen). Pfade wie "mass", "resColor",
   * "parts.2.pct". Eine Änderung am Feld entfernt die Markierung.
   */
  marks?: Record<string, 'check'>;
  /**
   * Kennung des OCR-Beispiels, aus dem dieser Scan stammt, solange er noch nicht bestätigt ist. "Alles geprüft"
   * speichert den (korrigierten) Scan dann als Wahrheit zum Beispiel (Trainingsdaten für die Erkennung).
   */
  ocrSample?: string;
}

export type ScanOp =
  | { op: 'set'; field: 'mass' | 'resistance' | 'instability' | 'scu' | 'gadget' | 'resColor' | 'instColor'; value: string }
  | { op: 'part'; index: number; field: 'pct' | 'ore' | 'quality'; value: string }
  | { op: 'addPart' }
  | { op: 'removePart'; index: number }
  | { op: 'reset' }
  /** sample: das OCR-Beispiel, das bestätigt wird (passt es nicht mehr zum Scan, wird nichts getan). */
  | { op: 'unmark'; sample?: string }
  | { op: 'replace'; scan: ScanDraft };

export const MAX_PARTS = 12;
const MAX_TEXT = 32;
const MAX_OPS = 50;
const COLORS: ColorChoice[] = ['white', 'green', 'red'];
const TEXT_FIELDS = ['mass', 'resistance', 'instability', 'scu'] as const;

export const emptyPart = (): PartDraft => ({ pct: '', ore: '', quality: '' });
export const emptyDraft = (): ScanDraft => ({
  mass: '',
  resistance: '',
  resColor: 'white',
  instability: '',
  instColor: 'white',
  scu: '',
  gadget: '',
  parts: [emptyPart()],
  marks: {},
});

const MARK_PATH = /^(mass|resistance|instability|scu|gadget|resColor|instColor|parts\.\d{1,2}\.(pct|ore|quality))$/;

function marks(v: unknown): Record<string, 'check'> {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw new InputError('Markierungen ungültig');
  const out: Record<string, 'check'> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (!MARK_PATH.test(k) || val !== 'check') throw new InputError('Markierungen ungültig');
    out[k] = 'check';
  }
  return out;
}

/** Zeilen-Markierungen beim Entfernen einer Zeile nachziehen (Zeile i weg, dahinter rutschen nach oben). */
function shiftRowMarks(m: Record<string, 'check'>, removed: number): Record<string, 'check'> {
  const out: Record<string, 'check'> = {};
  for (const k of Object.keys(m)) {
    const hit = /^parts\.(\d+)\.(.+)$/.exec(k);
    if (!hit) { out[k] = 'check'; continue; }
    const i = Number(hit[1]);
    if (i === removed) continue;
    out[i > removed ? `parts.${i - 1}.${hit[2]}` : k] = 'check';
  }
  return out;
}

const SAMPLE_ID = /^[\w-]{1,64}$/;
function sampleId(v: unknown): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string' || !SAMPLE_ID.test(v)) throw new InputError('OCR-Beispiel ungültig');
  return v;
}

function text(v: unknown, what: string): string {
  if (typeof v !== 'string') throw new InputError(`${what}: Text erwartet`);
  if (v.length > MAX_TEXT) throw new InputError(`${what}: höchstens ${MAX_TEXT} Zeichen`);
  return v;
}

function color(v: unknown, what: string): ColorChoice {
  if (!COLORS.includes(v as ColorChoice)) throw new InputError(`${what}: weiß, grün oder rot erwartet`);
  return v as ColorChoice;
}

function index(v: unknown, len: number): number {
  if (!Number.isInteger(v) || (v as number) < 0 || (v as number) >= len) throw new InputError('Ungültige Zeile');
  return v as number;
}

/** Prüft Entwürfe gegen den Datensatz (bekannte Gadgets und Erze). */
export function createScanValidator(data: Dataset) {
  const gadgets = new Set(data.gadgets.map((g) => g.id));
  const ores = new Set(data.ores.map((o) => o.id));

  const gadget = (v: unknown) => {
    const s = typeof v === 'string' ? v : '';
    if (typeof v !== 'string' || (s !== '' && !gadgets.has(s))) throw new InputError('Unbekanntes Gadget');
    return s;
  };
  const ore = (v: unknown) => {
    const s = typeof v === 'string' ? v : '';
    if (typeof v !== 'string' || (s !== '' && s !== 'inert' && !ores.has(s))) throw new InputError('Unbekanntes Erz');
    return s;
  };

  /** Vollständigen Entwurf prüfen (z. B. von der OCR oder beim Laden aus der Datei). */
  function validateDraft(raw: unknown): ScanDraft {
    const d = (raw ?? {}) as Record<string, unknown>;
    if (!Array.isArray(d.parts)) throw new InputError('Zusammensetzung fehlt');
    if (d.parts.length > MAX_PARTS) throw new InputError(`Höchstens ${MAX_PARTS} Zeilen`);
    const parts = d.parts.map((p, i) => {
      const q = (p ?? {}) as Record<string, unknown>;
      return { pct: text(q.pct, `Zeile ${i + 1} Anteil`), ore: ore(q.ore), quality: text(q.quality, `Zeile ${i + 1} Qualität`) };
    });
    return {
      mass: text(d.mass, 'Masse'),
      resistance: text(d.resistance, 'Resistenz'),
      resColor: color(d.resColor, 'Farbe Resistenz'),
      instability: text(d.instability, 'Instabilität'),
      instColor: color(d.instColor, 'Farbe Instabilität'),
      scu: text(d.scu, 'SCU'),
      gadget: gadget(d.gadget),
      parts: parts.length ? parts : [emptyPart()],
      marks: marks(d.marks),
      ...(sampleId(d.ocrSample) ? { ocrSample: sampleId(d.ocrSample) } : {}),
    };
  }

  /**
   * Befehle der Reihe nach anwenden. Ungültige Befehle brechen alles ab (nichts wird halb übernommen).
   * onConfirm: wird bei "Alles geprüft" nach einer OCR mit dem Stand genau in diesem Moment aufgerufen.
   */
  function apply(current: ScanDraft, rawOps: unknown, onConfirm?: (sample: string, scan: ScanDraft) => void): ScanDraft {
    if (!Array.isArray(rawOps) || rawOps.length === 0) throw new InputError('Keine Änderungen');
    if (rawOps.length > MAX_OPS) throw new InputError(`Höchstens ${MAX_OPS} Änderungen auf einmal`);
    const d: ScanDraft = structuredClone(current);
    d.marks ??= {};
    for (const raw of rawOps) {
      const op = (raw ?? {}) as Record<string, unknown>;
      switch (op.op) {
        case 'set':
          if ((TEXT_FIELDS as readonly string[]).includes(op.field as string)) d[op.field as (typeof TEXT_FIELDS)[number]] = text(op.value, String(op.field));
          else if (op.field === 'resColor' || op.field === 'instColor') d[op.field] = color(op.value, String(op.field));
          else if (op.field === 'gadget') d.gadget = gadget(op.value);
          else throw new InputError('Unbekanntes Feld');
          delete d.marks![op.field as string]; // bearbeitet = geprüft
          break;
        case 'part': {
          const i = index(op.index, d.parts.length);
          if (op.field === 'pct' || op.field === 'quality') d.parts[i][op.field] = text(op.value, op.field === 'pct' ? 'Anteil' : 'Qualität');
          else if (op.field === 'ore') d.parts[i].ore = ore(op.value);
          else throw new InputError('Unbekanntes Feld');
          delete d.marks![`parts.${i}.${op.field as string}`];
          break;
        }
        case 'addPart':
          if (d.parts.length >= MAX_PARTS) throw new InputError(`Höchstens ${MAX_PARTS} Zeilen`);
          d.parts.push(emptyPart());
          break;
        case 'removePart': {
          const i = index(op.index, d.parts.length);
          d.parts.splice(i, 1);
          d.marks = shiftRowMarks(d.marks!, i);
          if (!d.parts.length) d.parts.push(emptyPart());
          break;
        }
        case 'unmark': {
          // Gilt nur für den Scan, den das Gerät gesehen hat: Kam inzwischen eine neue OCR, nichts bestätigen
          // sample fehlt: altes Gerät (ohne Prüfung). '' : Gerät kennt keine offene OCR.
          const given = 'sample' in op;
          const sample = op.sample === '' ? undefined : sampleId(op.sample);
          if (given && sample !== d.ocrSample) break;
          if (d.ocrSample && sample === d.ocrSample) onConfirm?.(d.ocrSample, structuredClone(d));
          d.marks = {}; // alle Markierungen als geprüft bestätigen
          delete d.ocrSample;
          break;
        }
        case 'reset':
          Object.assign(d, emptyDraft());
          delete d.ocrSample;
          break;
        case 'replace': {
          const next = validateDraft(op.scan);
          delete d.ocrSample;
          Object.assign(d, next);
          break;
        }
        default:
          throw new InputError('Unbekannter Befehl');
      }
    }
    return d;
  }

  return { validateDraft, apply };
}
