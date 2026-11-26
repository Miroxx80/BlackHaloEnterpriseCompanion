/**
 * Screenshot -> Scan-Entwurf. Ablauf: laden, Panel suchen (Detektion der Beschriftungen), Farben, Felder lesen,
 * auswerten, markieren. Grundsatz: Lieber ein Feld zu viel gelb markieren als einen falschen Wert still übernehmen.
 */
import type { ScanDraft } from '../scanState.js';
import { emptyDraft } from '../scanState.js';
import type { Ore } from '../types.js';
import { noDetector, type LineReader, type ReadKind, type ReadResult, type TextDetector } from './engine.js';
import { crop, cropPadded, findBand, loadScreen, textColor, toPng, type Rgb } from './image.js';
import { PANEL_LABELS, PROSPECTOR_1080, type Box, type HudLayout, type PanelLabel } from './layout.js';
import { cleanNumber, levenshtein, massScuPlausible, matchOre, resolvePercents, scuValue, zeroEightVariants } from './parse.js';

/** Unter dieser Sicherheit der Erkennung wird ein Feld zum Prüfen markiert. */
const MIN_CONFIDENCE = 0.8;
/** So weit dürfen die gefundenen Beschriftungen vom gemeinsamen Versatz abweichen (HUD wackelt 3–5 px). */
const ANCHOR_TOLERANCE = 6;
/** Mehr SCU hat kein Stein, den eine Prospector bearbeiten kann (Plausibilität, falls die Masse fehlt). */
const MAX_SCU = 500;

export interface OcrResult {
  layout: string;
  engine: string;
  panelFound: boolean;
  /** Versatz des Panels gegenüber der Standard-Lage [x, y] (null: nicht gesucht oder nicht gefunden). */
  offset: [number, number] | null;
  /** Gefundene Beschriftungen (z. B. ["mass", "res", "comp"]). */
  anchors: string[];
  draft: ScanDraft;
  /** Felder (Pfade wie im Entwurf, z. B. "mass", "parts.2.pct"), die geprüft werden sollten. */
  marks: Record<string, 'check'>;
  notes: string[];
  /** Rohtexte der Erkennung, für Fehlersuche und Beispielsammlung. */
  raw: Record<string, string | null>;
  ms: number;
}

export interface ReadScanOptions {
  layout?: HudLayout;
  /** Findet das Panel, auch wenn es verschoben ist. Ohne: feste Lage (nur für Tests und als Notbehelf). */
  detector?: TextDetector;
}

const shift = ([x, y, w, h]: Box, dx: number, dy: number): Box => [x + dx, y + dy, w, h];
const cy = (b: Box) => b[1] + b[3] / 2;
const right = (b: Box) => b[0] + b[2];
const union = (boxes: Box[]): Box => {
  const x0 = Math.min(...boxes.map((b) => b[0]));
  const y0 = Math.min(...boxes.map((b) => b[1]));
  const x1 = Math.max(...boxes.map(right));
  const y1 = Math.max(...boxes.map((b) => b[1] + b[3]));
  return [x0, y0, x1 - x0, y1 - y0];
};
const median = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1];

/** Ist das Scan-Panel zu sehen? Genug helle Pixel (Text/Rahmen) im Panel-Bereich (nur ohne Detektion). */
function panelVisible(img: Rgb, box: Box): boolean {
  const p = crop(img, box);
  let bright = 0;
  for (let i = 0; i < p.data.length; i += 3) if (Math.max(p.data[i], p.data[i + 1], p.data[i + 2]) > 170) bright++;
  return bright / (p.width * p.height) > 0.02;
}

/** Kasten auf das Bild begrenzen. */
function clampBox(img: Rgb, [x, y, w, h]: Box): Box {
  const x0 = Math.max(0, Math.min(img.width - 1, Math.round(x)));
  const y0 = Math.max(0, Math.min(img.height - 1, Math.round(y)));
  return [x0, y0, Math.max(1, Math.min(img.width - x0, Math.round(w))), Math.max(1, Math.min(img.height - y0, Math.round(h)))];
}

/**
 * Panel finden: Kästen der Detektion lesen, Beschriftungen (MASS, RES, ...) erkennen und den Versatz bestimmen,
 * auf den sich die meisten verschiedenen Beschriftungen einigen. Ein einzelner Treffer reicht nicht.
 */
async function locatePanel(img: Rgb, layout: HudLayout, reader: LineReader, boxes: Box[]) {
  const candidates: { key: PanelLabel; box: Box; dx: number; dy: number }[] = [];
  for (const box of boxes) {
    if (box[2] > 100 || box[3] > 32 || box[2] < 12) continue; // Beschriftungen sind kurz
    const r = await reader.read(cropPadded(img, box), 'label');
    const word = (r?.text ?? '').replace(/[^A-Z]/g, '');
    if (word.length < 2) continue;
    let best: PanelLabel | null = null;
    let bestD = Infinity;
    for (const [key, label] of Object.entries(PANEL_LABELS) as [PanelLabel, string][]) {
      const d = levenshtein(word, label);
      if (d < bestD) [best, bestD] = [key, d];
    }
    if (!best || bestD > (PANEL_LABELS[best].length > 4 ? 2 : 1)) continue;
    const [ax, ay] = layout.anchors[best];
    candidates.push({ key: best, box, dx: box[0] - ax, dy: box[1] - ay });
  }
  let group: typeof candidates = [];
  for (const c of candidates) {
    const near = candidates.filter((o) => Math.abs(o.dx - c.dx) <= ANCHOR_TOLERANCE && Math.abs(o.dy - c.dy) <= ANCHOR_TOLERANCE);
    if (new Set(near.map((n) => n.key)).size > new Set(group.map((g) => g.key)).size) group = near;
  }
  const keys = new Set(group.map((g) => g.key));
  if (keys.size < 2) return null;
  const dx = median(group.map((g) => g.dx));
  const dy = median(group.map((g) => g.dy));
  const labels: Partial<Record<PanelLabel, Box>> = {};
  for (const g of group) {
    const cur = labels[g.key];
    if (!cur || Math.abs(g.dy - dy) < Math.abs(cur[1] - layout.anchors[g.key][1] - dy)) labels[g.key] = g.box;
  }
  return { dx, dy, labels };
}

export async function readScan(
  input: Buffer,
  reader: LineReader,
  ores: Ore[],
  { layout = PROSPECTOR_1080, detector = noDetector }: ReadScanOptions = {},
): Promise<{ result: OcrResult; panelPng: Buffer }> {
  const t0 = Date.now();
  const img = await loadScreen(input, layout);
  const notes: string[] = [];
  const marks: Record<string, 'check'> = {};
  const raw: Record<string, string | null> = {};
  const draft = emptyDraft();
  const withDetection = detector !== noDetector;
  // Beispielbild: der ganze Suchbereich, damit auch verschobene Panels vollständig drin sind
  const panelPng = await toPng(crop(img, withDetection ? layout.search : layout.panel));
  const finish = (panelFound: boolean, offset: [number, number] | null, anchors: string[]) => ({
    result: { layout: layout.id, engine: reader.name, panelFound, offset, anchors, draft, marks, notes, raw, ms: Date.now() - t0 },
    panelPng,
  });

  // ---------- Panel finden ----------
  let dx = 0;
  let dy = 0;
  let labels: Partial<Record<PanelLabel, Box>> = {};
  let boxes: Box[] = [];
  if (withDetection) {
    boxes = (await detector.detect(img, layout.search)).filter((b) => b[2] >= 5 && b[3] >= 5);
    const found = await locatePanel(img, layout, reader, boxes);
    if (!found) {
      notes.push('Kein Scan-Panel gefunden (Mining-Modus, Prospector, 1920x1080, englisches HUD?).');
      return finish(false, null, []);
    }
    ({ dx, dy, labels } = found);
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) notes.push(`Panel ${dy > 0 ? dy + ' px tiefer' : -dy + ' px höher'} gefunden${dx ? ` (${dx > 0 ? '+' : ''}${dx} px seitlich)` : ''}.`);
  } else if (!panelVisible(img, layout.panel)) {
    notes.push('Kein Scan-Panel an der erwarteten Stelle gefunden (Mining-Modus, Prospector, 1920x1080?).');
    return finish(false, null, []);
  }
  const at = (b: Box) => shift(b, dx, dy);

  /** Kasten der Beschriftung (gefunden oder aus der Standard-Lage geschätzt). */
  const labelBox = (key: PanelLabel): Box => labels[key] ?? [layout.anchors[key][0] + dx, layout.anchors[key][1] + dy, 42, 20];

  /** Rechter Rand des Panels (mit etwas Spiel): Text rechts davon gehört nicht zum Scan (z. B. Markierungen im Raum). */
  const panelRight = layout.panel[0] + layout.panel[2] + dx + 5;
  /** Felder, deren Kasten unsicher zusammengesetzt ist (mehrere Kästen oder fremder Text direkt daneben). */
  const boxDoubt = new Set<string>();

  /**
   * Text rechts neben einer Beschriftung in derselben Zeile (aus der Detektion); sonst das verschobene Fenster.
   * Nur innerhalb des Panels, und nur der Kasten nächst der Beschriftung plus direkt anschließende (Lücke <= 12 px).
   */
  const valueBox = (key: PanelLabel, field: string, window: Box): Box => {
    if (!withDetection) return findBand(img, at(window)) ?? at(window);
    const label = labelBox(key);
    const row = boxes
      .filter((b) => Math.abs(cy(b) - cy(label)) <= 7 && b[0] > right(label) + 6 && b[0] < panelRight && b[3] <= 30 && b[2] >= 8)
      .sort((a, b) => a[0] - b[0]);
    const inside = row.filter((b) => right(b) <= panelRight);
    if (inside.length < row.length) boxDoubt.add(field); // Text ragt über den Panelrand
    if (!inside.length) return at(window);
    const chain = [inside[0]];
    for (const b of inside.slice(1)) {
      if (b[0] - right(chain[chain.length - 1]) <= 12) chain.push(b);
      else break;
    }
    if (chain.length < inside.length) boxDoubt.add(field);
    if (chain.length > 1 && field !== 'scu') boxDoubt.add(field); // "3.32" + "SCU" ist normal
    return union(chain);
  };

  /** Ausschnitt für die Erkennung: mit Rand, schmale Ziffern (z. B. "0") etwas breiter. */
  const cropFor = (box: Box, kind: ReadKind): Rgb => {
    let [x, y, w, h] = box;
    if (kind !== 'text' && w < h * 1.3) {
      const grow = Math.ceil((h * 1.3 - w) / 2);
      x -= grow;
      w += 2 * grow;
    }
    return cropPadded(img, clampBox(img, [x, y, w, h]));
  };

  /**
   * Eine Zeile lesen, zweimal (normal und nur übersteuerte Pixel). Weichen die Lesungen voneinander ab, die
   * Sicherheit ist gering oder eine 0/6/8 zweifelhaft: zum Prüfen markieren. Namen prüft die Erzliste.
   */
  /** Warum ein Feld markiert ist (nur 'amb' kann später durch die Summe der Anteile aufgelöst werden). */
  type Reason = 'conf' | 'amb' | 'variant' | 'format' | 'box';
  const why: Record<string, Set<Reason>> = {};
  const flag = (key: string, reason: Reason) => {
    marks[key] = 'check';
    (why[key] ??= new Set()).add(reason);
  };
  const results: Record<string, ReadResult> = {};
  const read = async (key: string, box: Box | null, kind: ReadKind): Promise<ReadResult | null> => {
    if (!box) {
      raw[key] = null;
      return null;
    }
    const image = cropFor(box, kind);
    const a = await reader.read(image, kind);
    raw[key] = a?.text ?? null;
    if (!a || !a.text || kind === 'text') return a;
    results[key] = a;
    const reasons = new Set<Reason>();
    if (a.confidence < MIN_CONFIDENCE) reasons.add('conf');
    if (a.ambiguous) reasons.add('amb');
    // Zweite Lesung nur vor hellem Boden (dort ist die Schrift übersteuert, der Boden nicht). Vor dunklem
    // Hintergrund liefert sie Bruchstücke und würde nur unnötig markieren.
    if (withDetection && medianLum(image) >= BRIGHT_BACKGROUND) {
      const b = await reader.read(image, kind, { variant: 'bright' });
      // Leer = keine Meinung
      if (b?.text && b.text.replace(/\s/g, '') !== a.text.replace(/\s/g, '')) {
        reasons.add('variant');
        raw[`${key}~`] = b.text;
      }
    }
    for (const r of reasons) flag(key, r);
    return a;
  };

  // ---------- Hauptwerte ----------
  const massBox = valueBox('mass', 'mass', layout.mass);
  const resBox = valueBox('res', 'resistance', layout.resistance);
  const instBox = valueBox('inst', 'instability', layout.instability);
  const scuBox = valueBox('comp', 'scu', layout.scu);

  // Farben von Resistenz und Instabilität (unabhängig von der Texterkennung)
  for (const [key, box] of [['resColor', resBox], ['instColor', instBox]] as const) {
    const c = textColor(crop(img, clampBox(img, box)));
    if (c) {
      draft[key] = c.color;
      if (c.share < 0.7) marks[key] = 'check';
    } else {
      marks[key] = 'check';
    }
  }

  const mass = cleanNumber((await read('mass', massBox, 'integer'))?.text, { int: true });
  const res = cleanNumber((await read('resistance', resBox, 'number'))?.text);
  const inst = cleanNumber((await read('instability', instBox, 'number'))?.text);
  // "9.84 SCU" bzw. "901.80m SCU": mit Buchstaben lesen, dann nur die Zahl nehmen
  const scuText = (await read('scu', scuBox, 'scu'))?.text ?? null;
  const scu = cleanNumber(scuText?.match(/\d+(\.\d+)?m?(?=\s*S|$)/)?.[0] ?? scuText?.match(/\d+(\.\d+)?/)?.[0] ?? null);
  draft.mass = mass ?? '';
  draft.resistance = res ?? '';
  draft.instability = inst ?? '';
  draft.scu = scu ?? '';
  for (const [k, v] of [['mass', mass], ['resistance', res], ['instability', inst], ['scu', scu]] as const) {
    if (v == null) marks[k] = 'check'; // nichts oder keine Zahl gelesen
  }
  for (const k of boxDoubt) flag(k, 'box');
  // Das HUD zeigt die Instabilität immer mit zwei Nachkommastellen; fehlt eine Ziffer, ist etwas verloren gegangen
  if (inst != null && !/^\d+\.\d{2}$/.test(inst)) flag('instability', 'format');
  if (res != null && Number(res) > 100) {
    // 0/8-Verwechslung? Variante unter 100 % nehmen, aber markieren
    const alt = zeroEightVariants(res).find((v) => Number(v) <= 100);
    if (alt) draft.resistance = alt;
    marks.resistance = 'check';
  }
  if (scu != null && scuValue(scu) > MAX_SCU) {
    draft.scu = '';
    marks.scu = 'check';
  }
  if (massScuPlausible(mass, draft.scu || null) === false) {
    const alt = zeroEightVariants(mass!).find((m) => massScuPlausible(m, draft.scu));
    if (alt) draft.mass = alt;
    marks.mass = 'check';
    marks.scu = 'check';
    notes.push('Masse und SCU passen nicht zusammen. Bitte beide Werte prüfen.');
  }

  // ---------- Zusammensetzung (nur mit Detektion) ----------
  const rows: { pct: string | null; ore: string | null; quality: string | null }[] = [];
  let rowMissing = false;
  if (withDetection) {
    const comp = labelBox('comp');
    const top = comp[1] + comp[3] + 10; // unter dem Balken der Zusammensetzung
    const candidates = boxes
      .filter((b) => cy(b) > top && b[0] >= comp[0] - 15 && b[0] < panelRight && b[3] >= 8 && b[3] <= 34 && b[2] >= 6)
      .sort((a, b) => cy(a) - cy(b));
    // In Zeilen gruppieren (Abstand ~15 px). Eine Lücke von bis zu ~2 Zeilen heißt: eine Zeile wurde nicht
    // erkannt (weiterlesen, aber markieren). Größere Lücke: Ende (darunter liegen andere HUD-Teile).
    const lines: Box[][] = [];
    for (const b of candidates) {
      const last = lines[lines.length - 1];
      const gap = last ? cy(b) - cy(union(last)) : cy(b) - top;
      if (last && Math.abs(gap) <= 6) last.push(b);
      else if (gap < 40) {
        if (last && gap > 22) rowMissing = true;
        lines.push([b]);
      } else break;
    }
    if (lines.length > layout.rows.max) rowMissing = true;
    for (const line of lines.slice(0, layout.rows.max)) {
      const i = rows.length;
      line.sort((a, b) => a[0] - b[0]);
      // Fremder Text, der über den Panelrand ragt: Zeile ist unsicher
      const outside = line.some((b) => right(b) > panelRight);
      const inLine = line.filter((b) => right(b) <= panelRight);
      // Qualität: rechtsbündige Spalte (rechter Rand ~ COMP + 130..185); der Rest ist Anteil + Name
      const qCol = inLine.filter((b) => b[0] > comp[0] + 120 && right(b) >= comp[0] + 130 && right(b) <= comp[0] + 185);
      const q = inLine.length > 1 && qCol.length ? qCol[qCol.length - 1] : null;
      const rest = q ? inLine.filter((b) => b !== q) : inLine;
      if (!rest.length) continue;
      const left = union(rest);
      const split = await splitPercent(img, reader, left, cropFor);
      const pctText = await read(`parts.${i}.pct`, split?.pct ?? left, 'number');
      const oreText = split?.name ? await read(`parts.${i}.ore`, split.name, 'text') : null;
      const qualityText = q ? await read(`parts.${i}.quality`, q, 'integer') : null;
      const ore = matchOre(oreText?.text, ores);
      if (!ore || !ore.exact) marks[`parts.${i}.ore`] = 'check';
      const quality = cleanNumber(qualityText?.text, { int: true });
      if (quality == null && ore?.id !== 'inert') marks[`parts.${i}.quality`] = 'check';
      if (quality != null && Number(quality) > 1000) flag(`parts.${i}.quality`, 'format'); // Qualität geht bis 1000
      if (outside) {
        flag(`parts.${i}.ore`, 'box');
        flag(`parts.${i}.quality`, 'box');
      }
      // Nichts Lesbares (z. B. Teil des Balkens vor hellem Boden): keine Zeile daraus machen
      if (!pctText?.text && !oreText?.text && !qualityText?.text) {
        for (const k of Object.keys(marks)) if (k.startsWith(`parts.${i}.`)) delete marks[k];
        for (const k of Object.keys(raw)) if (k.startsWith(`parts.${i}.`)) delete raw[k];
        continue;
      }
      let pct = cleanNumber(pctText?.text);
      // Punkt nicht gelesen ("2750" statt "27.50"): Anteile haben immer zwei Nachkommastellen
      if (pct && !pct.includes('.') && pct.length >= 3) {
        pct = `${pct.slice(0, -2)}.${pct.slice(-2)}`;
        flag(`parts.${i}.pct`, 'format');
      }
      // Sonst muss das Format stimmen (z. B. "70.7" statt "70.71": Ziffer verloren)
      if (pct && !/^\d+\.\d{2}$/.test(pct)) flag(`parts.${i}.pct`, 'format');
      rows.push({ pct, ore: ore?.id ?? null, quality });
    }
  }
  if (rows.length) {
    const resolved = resolvePercents(rows.map((r) => r.pct));
    const markAllPct = () => rows.forEach((_, i) => flag(`parts.${i}.pct`, 'format'));
    const finalSum = resolved.values.reduce((s, v) => s + (v ? Number(v) : 0), 0);
    const complete = resolved.values.every((v) => v);
    if (resolved.changed.length) {
      // Eine Tauschung hat die Summe repariert, aber welche Zeile wirklich falsch war, ist nicht sicher
      markAllPct();
      notes.push('Anteile wurden automatisch korrigiert (0/8-Verwechslung). Bitte alle Anteile prüfen.');
    } else if (!complete || finalSum < SUM_WINDOW[0] || finalSum > SUM_WINDOW[1] || rowMissing) {
      markAllPct();
      notes.push(
        rowMissing || finalSum < SUM_WINDOW[0]
          ? `Die Anteile ergeben ${finalSum.toFixed(2)} %. Fehlt eine Zeile? Bitte die Zusammensetzung prüfen.`
          : `Die Anteile ergeben ${finalSum.toFixed(2)} % statt 100 %. Bitte die Zusammensetzung prüfen.`,
      );
    } else {
      // Summe stimmt: Markierungen aus dem Lesen bleiben grundsätzlich stehen (die zweite Nachkommastelle kann die
      // Summe nicht klären). Eine zweifelhafte Ziffer weiter vorn ist geklärt, wenn jede Alternative die Summe
      // kippen würde, aber nur, wenn keine andere Zeile im Zweifel ist (zwei Fehler können sich ausgleichen).
      const values = rows.map((r) => Number(r.pct));
      const doubtful = rows.filter((_, i) => marks[`parts.${i}.pct`]).length;
      rows.forEach((row, i) => {
        const key = `parts.${i}.pct`;
        const reasons = why[key];
        if (doubtful !== 1 || !row.pct || !reasons || reasons.size !== 1 || !reasons.has('amb')) return;
        if (sumConfirms(row.pct, results[key], values, i)) delete marks[key];
      });
    }
    draft.parts = rows.map((r, i) => ({ pct: resolved.values[i] ?? '', ore: r.ore ?? '', quality: r.quality ?? '' }));
  } else if (withDetection) {
    marks['parts.0.pct'] = 'check';
    notes.push('Zusammensetzung nicht gefunden. Bitte eintragen.');
  }
  if (reader.name === 'keine') notes.push('Texterkennung noch nicht aktiv: nur die Farben wurden gelesen, Zahlen bitte eintragen.');

  return finish(true, withDetection ? [dx, dy] : null, Object.keys(labels));
}

/** Ab diesem Median der Helligkeit gilt ein Ausschnitt als heller Hintergrund. */
const BRIGHT_BACKGROUND = 120;
function medianLum(img: Rgb): number {
  const v: number[] = [];
  for (let i = 0; i < img.data.length; i += 3) v.push(0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]);
  return v.sort((a, b) => a - b)[v.length >> 1] ?? 0;
}

/** Spanne, in der die angezeigten Anteile zusammen liegen (gemessen 99,97–100,05). */
const SUM_WINDOW: [number, number] = [99.9, 100.1];
const LOOKALIKES = ['0', '6', '8', '9'];

/**
 * Bestätigt die Summe der Anteile einen Wert mit zweifelhaften Ziffern? Nur wenn keine zweifelhafte Ziffer in der
 * letzten Nachkommastelle steht und jede andere Lesart (0/6/8/9 getauscht) die Summe aus dem Fenster bringen würde.
 */
function sumConfirms(value: string, read: ReadResult | undefined, values: number[], index: number): boolean {
  const chars = (read?.chars ?? []).filter((c) => /[\d.]/.test(c.c));
  if (chars.map((c) => c.c).join('') !== value) return false; // Lage der Zeichen unklar
  const sum = values.reduce((s, v) => s + v, 0);
  if (sum < SUM_WINDOW[0] || sum > SUM_WINDOW[1]) return false;
  const lastDigit = value.length - 1;
  return chars.every((c, pos) => {
    if (!c.amb) return true;
    if (pos === lastDigit && value.includes('.')) return false;
    return LOOKALIKES.filter((d) => d !== c.c).every((d) => {
      const alt = Number(value.slice(0, pos) + d + value.slice(pos + 1));
      const altSum = sum - values[index] + alt;
      return altSum < SUM_WINDOW[0] || altSum > SUM_WINDOW[1];
    });
  });
}

/**
 * "42.10% HEPH (RAW)" in Anteil und Name teilen: Zeile einmal ganz lesen, Lage des "%" (bzw. des ersten
 * Buchstabens) bestimmen. Die Detektion fasst die beiden Spalten oft zu einem Kasten zusammen.
 */
async function splitPercent(
  img: Rgb,
  reader: LineReader,
  box: Box,
  cropFor: (b: Box, k: ReadKind) => Rgb,
): Promise<{ pct: Box; name: Box | null } | null> {
  const image = cropFor(box, 'row');
  const r = await reader.read(image, 'row');
  if (!r?.chars?.length) return null;
  // Lage im Ausschnitt -> Bildschirm (der Ausschnitt hat links bis zu 3 px Rand, siehe cropPadded)
  const x0 = Math.max(0, box[0] - 3);
  const toX = (at: number) => x0 + at * image.width;
  const pctIdx = r.chars.findIndex((c) => c.c === '%');
  const letterIdx = r.chars.findIndex((c) => /[A-Z(]/.test(c.c));
  let splitX: number | null = null;
  if (pctIdx >= 0 && pctIdx < r.chars.length - 1) splitX = (toX(r.chars[pctIdx].at) + toX(r.chars[pctIdx + 1].at)) / 2;
  else if (letterIdx > 0) splitX = (toX(r.chars[letterIdx - 1].at) + toX(r.chars[letterIdx].at)) / 2;
  if (splitX == null) return /^[\d.%]+$/.test(r.text) ? { pct: box, name: null } : null;
  const sx = Math.round(splitX);
  if (sx <= box[0] + 4 || sx >= right(box) - 4) return null;
  return { pct: [box[0], box[1], sx - box[0], box[3]], name: [sx, box[1], right(box) - sx, box[3]] };
}
