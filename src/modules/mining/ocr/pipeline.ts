/**
 * Screenshot -> Scan-Entwurf. Ablauf: laden, Panel vorhanden?, Farben, Felder lesen, auswerten, markieren.
 */
import type { ScanDraft } from '../scanState.js';
import { emptyDraft } from '../scanState.js';
import type { Ore } from '../types.js';
import type { LineReader, ReadKind } from './engine.js';
import { crop, cropPadded, findBand, loadScreen, splitColumns, textColor, toPng, type Rgb } from './image.js';
import { PROSPECTOR_1080, type Box, type HudLayout } from './layout.js';
import { cleanNumber, massScuPlausible, matchOre, resolvePercents, zeroEightVariants } from './parse.js';

/** Unter dieser Sicherheit der Erkennung wird ein Feld zum Prüfen markiert. */
const MIN_CONFIDENCE = 0.8;

export interface OcrResult {
  layout: string;
  engine: string;
  panelFound: boolean;
  draft: ScanDraft;
  /** Felder (Pfade wie im Entwurf, z. B. "mass", "parts.2.pct"), die geprüft werden sollten. */
  marks: Record<string, 'check'>;
  notes: string[];
  /** Rohtexte der Erkennung, für Fehlersuche und Beispielsammlung. */
  raw: Record<string, string | null>;
  ms: number;
}

/** Ist das Scan-Panel zu sehen? Genug helle Pixel (Text/Rahmen) im Panel-Bereich. */
function panelVisible(img: Rgb, box: Box): boolean {
  const p = crop(img, box);
  let bright = 0;
  for (let i = 0; i < p.data.length; i += 3) if (Math.max(p.data[i], p.data[i + 1], p.data[i + 2]) > 170) bright++;
  return bright / (p.width * p.height) > 0.02;
}

export async function readScan(
  input: Buffer,
  reader: LineReader,
  ores: Ore[],
  layout: HudLayout = PROSPECTOR_1080,
): Promise<{ result: OcrResult; panelPng: Buffer }> {
  const t0 = Date.now();
  const img = await loadScreen(input, layout);
  const notes: string[] = [];
  const marks: Record<string, 'check'> = {};
  const raw: Record<string, string | null> = {};
  const draft = emptyDraft();
  const panelPng = await toPng(crop(img, layout.panel));

  const panelFound = panelVisible(img, layout.panel);
  if (!panelFound) {
    notes.push('Kein Scan-Panel an der erwarteten Stelle gefunden (Mining-Modus, Prospector, 1920x1080?).');
    return { result: { layout: layout.id, engine: reader.name, panelFound, draft, marks, notes, raw, ms: Date.now() - t0 }, panelPng };
  }

  /** Eine Zeile lesen: Text im Suchfenster finden (oder fertige Box), mit Rand ausschneiden, erkennen. */
  const read = async (key: string, where: { window?: Box; box?: Box | null }, kind: ReadKind) => {
    const box = where.box ?? (where.window ? findBand(img, where.window) : null);
    if (!box) {
      raw[key] = null;
      return null;
    }
    const r = await reader.read(cropPadded(img, box), kind);
    raw[key] = r?.text ?? null;
    // Namen werden über die Erzliste geprüft (siehe unten), nicht über die Zeichensicherheit
    if (r && r.text && kind !== 'text' && (r.confidence < MIN_CONFIDENCE || r.ambiguous)) marks[key] = 'check';
    return r?.text ?? null;
  };

  // Farben von Resistenz und Instabilität (unabhängig von der Texterkennung)
  for (const [key, box] of [['resColor', layout.resistance], ['instColor', layout.instability]] as const) {
    const c = textColor(crop(img, box));
    if (c) {
      draft[key] = c.color;
      if (c.share < 0.7) marks[key] = 'check';
    } else {
      marks[key] = 'check';
    }
  }

  // Hauptwerte
  const mass = cleanNumber(await read('mass', { window: layout.mass }, 'integer'), { int: true });
  const res = cleanNumber(await read('resistance', { window: layout.resistance }, 'number'));
  const inst = cleanNumber(await read('instability', { window: layout.instability }, 'number'));
  // "9.84 SCU" bzw. "901.80m SCU": mit Buchstaben lesen, dann nur die Zahl nehmen
  const scuText = await read('scu', { window: layout.scu }, 'scu');
  const scu = cleanNumber(scuText?.match(/\d+(\.\d+)?m?(?=\s*S|$)/)?.[0] ?? scuText?.match(/\d+(\.\d+)?/)?.[0] ?? null);
  draft.mass = mass ?? '';
  draft.resistance = res ?? '';
  draft.instability = inst ?? '';
  draft.scu = scu ?? '';
  for (const [k, v] of [['mass', mass], ['resistance', res], ['instability', inst], ['scu', scu]] as const) {
    if (raw[k] != null && v == null) marks[k] = 'check'; // etwas gelesen, aber keine Zahl
  }
  if (res != null && Number(res) > 100) {
    // 0/8-Verwechslung? Variante unter 100 % nehmen, aber markieren
    const alt = zeroEightVariants(res).find((v) => Number(v) <= 100);
    if (alt) draft.resistance = alt;
    marks.resistance = 'check';
  }
  if (massScuPlausible(mass, scu) === false) {
    const alt = zeroEightVariants(mass!).find((m) => massScuPlausible(m, scu));
    if (alt) draft.mass = alt;
    marks.mass = 'check';
    marks.scu = 'check';
    notes.push('Masse und SCU passen nicht zusammen. Bitte beide Werte prüfen.');
  }

  // Zusammensetzung: Zeile für Zeile nach unten, bis keine mehr kommt; jede Zeile an Lücken teilen
  const rows: { pct: string | null; ore: string | null; quality: string | null }[] = [];
  let top = layout.rows.firstTop;
  for (let i = 0; i < layout.rows.max; i++) {
    const band = findBand(img, [layout.rows.x, top, layout.rows.width, i === 0 ? layout.rows.firstHeight : layout.rows.nextHeight]);
    if (!band || band[3] < 6) break;
    top = band[1] + band[3] + 2;
    const cols = splitColumns(img, band);
    if (cols.length < 2) break;
    const pctBox = cols[0];
    const qualityBox = cols[cols.length - 1];
    const nameBox: Box | null =
      cols.length > 2 ? [cols[1][0], band[1], cols[cols.length - 2][0] + cols[cols.length - 2][2] - cols[1][0], band[3]] : null;
    const pctText = await read(`parts.${i}.pct`, { box: pctBox }, 'number');
    const oreText = await read(`parts.${i}.ore`, { box: nameBox }, 'text');
    const qualityText = await read(`parts.${i}.quality`, { box: qualityBox }, 'integer');
    const ore = matchOre(oreText, ores);
    if (oreText && (!ore || !ore.exact)) marks[`parts.${i}.ore`] = 'check';
    rows.push({ pct: cleanNumber(pctText), ore: ore?.id ?? null, quality: cleanNumber(qualityText, { int: true }) });
  }
  if (rows.length) {
    const resolved = resolvePercents(rows.map((r) => r.pct));
    for (const i of resolved.changed) marks[`parts.${i}.pct`] = 'check';
    if (!resolved.ok) {
      rows.forEach((_, i) => (marks[`parts.${i}.pct`] = 'check'));
      notes.push('Die gelesenen Anteile ergeben keine 100 %. Bitte die Zusammensetzung prüfen.');
    } else {
      // Summe stimmt: Anteile gelten als bestätigt, außer den eben korrigierten
      rows.forEach((_, i) => {
        if (!resolved.changed.includes(i)) delete marks[`parts.${i}.pct`];
      });
    }
    draft.parts = rows.map((r, i) => ({ pct: resolved.values[i] ?? '', ore: r.ore ?? '', quality: r.quality ?? '' }));
  }
  if (reader.name === 'keine') notes.push('Texterkennung noch nicht aktiv: nur die Farben wurden gelesen, Zahlen bitte eintragen.');

  return { result: { layout: layout.id, engine: reader.name, panelFound, draft, marks, notes, raw, ms: Date.now() - t0 }, panelPng };
}
