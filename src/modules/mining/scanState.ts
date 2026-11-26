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
}

export type ScanOp =
  | { op: 'set'; field: 'mass' | 'resistance' | 'instability' | 'scu' | 'gadget' | 'resColor' | 'instColor'; value: string }
  | { op: 'part'; index: number; field: 'pct' | 'ore' | 'quality'; value: string }
  | { op: 'addPart' }
  | { op: 'removePart'; index: number }
  | { op: 'reset' }
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
});

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
    };
  }

  /** Befehle der Reihe nach anwenden. Ungültige Befehle brechen alles ab (nichts wird halb übernommen). */
  function apply(current: ScanDraft, rawOps: unknown): ScanDraft {
    if (!Array.isArray(rawOps) || rawOps.length === 0) throw new InputError('Keine Änderungen');
    if (rawOps.length > MAX_OPS) throw new InputError(`Höchstens ${MAX_OPS} Änderungen auf einmal`);
    const d: ScanDraft = structuredClone(current);
    for (const raw of rawOps) {
      const op = (raw ?? {}) as Record<string, unknown>;
      switch (op.op) {
        case 'set':
          if ((TEXT_FIELDS as readonly string[]).includes(op.field as string)) d[op.field as (typeof TEXT_FIELDS)[number]] = text(op.value, String(op.field));
          else if (op.field === 'resColor' || op.field === 'instColor') d[op.field] = color(op.value, String(op.field));
          else if (op.field === 'gadget') d.gadget = gadget(op.value);
          else throw new InputError('Unbekanntes Feld');
          break;
        case 'part': {
          const i = index(op.index, d.parts.length);
          if (op.field === 'pct' || op.field === 'quality') d.parts[i][op.field] = text(op.value, op.field === 'pct' ? 'Anteil' : 'Qualität');
          else if (op.field === 'ore') d.parts[i].ore = ore(op.value);
          else throw new InputError('Unbekanntes Feld');
          break;
        }
        case 'addPart':
          if (d.parts.length >= MAX_PARTS) throw new InputError(`Höchstens ${MAX_PARTS} Zeilen`);
          d.parts.push(emptyPart());
          break;
        case 'removePart':
          d.parts.splice(index(op.index, d.parts.length), 1);
          if (!d.parts.length) d.parts.push(emptyPart());
          break;
        case 'reset':
          Object.assign(d, emptyDraft());
          break;
        case 'replace':
          Object.assign(d, validateDraft(op.scan));
          break;
        default:
          throw new InputError('Unbekannter Befehl');
      }
    }
    return d;
  }

  return { validateDraft, apply };
}
