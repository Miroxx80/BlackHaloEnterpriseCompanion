/**
 * Screenshot -> Scan-Entwurf. Ablauf: laden, Panel suchen (Detektion der Beschriftungen), Farben, Felder lesen,
 * auswerten, markieren. Grundsatz: Lieber ein Feld zu viel gelb markieren als einen falschen Wert still übernehmen.
 */
import type { ScanDraft } from '../scanState.js';
import { emptyDraft } from '../scanState.js';
import type { Ore } from '../types.js';
import { noDetector, type LineReader, type ReadKind, type ReadResult, type TextDetector } from './engine.js';
import { blockArtifacts, crop, cropPadded, findBand, loadScreen, rescaleRegion, textColor, toPng, type Rgb } from './image.js';
import { PANEL_LABELS, PROSPECTOR_1080, type Box, type HudLayout, type PanelLabel } from './layout.js';
import { judgeDigits, validModel, type DigitJudgement, type GlyphModel } from './glyphs.js';
import { cleanNumber, levenshtein, massScuPlausible, matchOre, resolvePercents, scuValue, zeroEightVariants } from './parse.js';

/** Unter dieser Sicherheit der Erkennung wird ein Feld zum Prüfen markiert. */
const MIN_CONFIDENCE = 0.8;
/**
 * Bei einem Bild, das anders aussieht als die gemessenen Scans (JPEG, skaliert, umgerechnetes HUD), gilt diese
 * Schwelle: Als JPEG las PaddleOCR eine 6 mit 0,87 als 5, und ein zweiter Fehler glich die Summe der Anteile aus
 * (Review). Kostet an den 82 Scans als JPEG 12 zusätzlich gelbe Felder.
 */
const STRICT_MIN_CONFIDENCE = 0.9;
/** So weit dürfen die gefundenen Beschriftungen vom gemeinsamen Versatz abweichen (HUD wackelt 3–5 px). */
const ANCHOR_TOLERANCE = 6;
/** Mehr SCU hat kein Stein, den eine Prospector bearbeiten kann (Plausibilität, falls die Masse fehlt). */
const MAX_SCU = 500;

export interface OcrResult {
  layout: string;
  engine: string;
  panelFound: boolean;
  /**
   * Versatz des Panels gegenüber der Standard-Lage [x, y] (null: nicht gesucht oder nicht gefunden). Bei anderem
   * Maßstab: Versatz der MASS-Beschriftung.
   */
  offset: [number, number] | null;
  /** Größe des HUD gegenüber FOV 86 (1 = Standard; z. B. 0,87 bei FOV 100). */
  scale: number;
  /** Gefundene Beschriftungen (z. B. ["mass", "res", "comp"]). */
  anchors: string[];
  /**
   * Abstand der Zeilen MASS/RES/INST in px (null: nicht messbar). Die HUD-Größe hängt am FOV: bei FOV 86 ~20 px,
   * bei FOV 100 ~16 px.
   */
  rowPitch?: number | null;
  draft: ScanDraft;
  /** Felder (Pfade wie im Entwurf, z. B. "mass", "parts.2.pct"), die geprüft werden sollten. */
  marks: Record<string, 'check'>;
  notes: string[];
  /**
   * Warum Felder markiert sind (conf, amb, glyph, variant, format, box, empty, ore, color, plaus, sum, scale), für
   * Fehlersuche und Abstimmung.
   */
  reasons?: Record<string, string[]>;
  /** Rohtexte der Erkennung, für Fehlersuche und Beispielsammlung. */
  raw: Record<string, string | null>;
  ms: number;
}

export interface ReadScanOptions {
  layout?: HudLayout;
  /** Findet das Panel, auch wenn es verschoben ist. Ohne: feste Lage (nur für Tests und als Notbehelf). */
  detector?: TextDetector;
  /** Mitschnitt jeder Lesung (Ausschnitt + Ergebnis), z. B. um Trainingsdaten für eine Ziffernerkennung zu sammeln. */
  trace?: (key: string, image: Rgb, kind: ReadKind, read: ReadResult | null) => void;
  /**
   * Eigene Ziffernerkennung (data/ocr/glyphs.json, siehe glyphs.ts): bestätigt zweifelhafte Ziffern (0/6/8/9,
   * geringe Sicherheit), ändert nie einen Wert. Ohne: jede zweifelhafte Ziffer bleibt markiert.
   */
  glyphs?: GlyphModel | null;
}

/** Ausschnitt zum Lesen, mit seiner Lage in Standard-Koordinaten (links, Breite). */
type Crop = { image: Rgb; left: number; width: number };

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

/** Liegt Kasten a ganz in Kasten b? */
const inside = (a: Box, b: Box) => a[0] >= b[0] && a[1] >= b[1] && right(a) <= right(b) && a[1] + a[3] <= b[1] + b[3];

/** Versatz bei Maßstab 1 (wie bisher): Median über die gefundenen Beschriftungen. */
function labelOffset(layout: HudLayout, labels: Partial<Record<PanelLabel, Box>>): [number, number] {
  const keys = Object.keys(labels) as PanelLabel[];
  return [median(keys.map((k) => labels[k]![0] - layout.anchors[k][0])), median(keys.map((k) => labels[k]![1] - layout.anchors[k][1]))];
}

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

/** Lage des Panels: Bildschirm = scale x Standard-Lage + [tx, ty]. */
export interface PanelFit {
  scale: number;
  tx: number;
  ty: number;
  /** Gefundene Beschriftungen (je eine pro Art, die zur Lage passt). */
  labels: Partial<Record<PanelLabel, Box>>;
  /** Ist der Maßstab aus genug Beschriftungen mit genug Abstand bestimmt? */
  scaleSure: boolean;
}

/**
 * Panel finden: Kästen der Detektion lesen, Beschriftungen (MASS, RES, ...) erkennen und Maßstab und Versatz
 * bestimmen, auf die sich die meisten verschiedenen Beschriftungen einigen. Ein einzelner Treffer reicht nicht.
 * Der Maßstab kommt aus dem senkrechten Abstand der Beschriftungen (RESULTS -> MASS -> RES -> INST -> COMP.):
 * Das HUD wird mit dem Sichtfeld (FOV) kleiner oder größer. near: nur Kästen höchstens so weit (px) von der
 * Standard-Lage einer Beschriftung betrachten.
 */
export async function locatePanel(
  img: Rgb,
  layout: HudLayout,
  reader: LineReader,
  boxes: Box[],
  near?: number,
): Promise<PanelFit | null> {
  const candidates: { key: PanelLabel; box: Box }[] = [];
  const anchors = Object.values(layout.anchors);
  for (const box of boxes) {
    if (box[2] > 100 * SCALE_RANGE[1] || box[3] > 32 * SCALE_RANGE[1] || box[2] < 12 * SCALE_RANGE[0]) continue; // Beschriftungen sind kurz
    // Nur Kästen nahe der Standard-Lage einer Beschriftung lesen (nach dem Umrechnen; spart Zeit)
    if (near != null && !anchors.some(([ax, ay]) => Math.abs(box[0] - ax) <= near && Math.abs(box[1] - ay) <= near)) continue;
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
    candidates.push({ key: best, box });
  }
  const anchor = (k: PanelLabel) => layout.anchors[k];
  const inliers = (s: number, tx: number, ty: number) => {
    const tol = ANCHOR_TOLERANCE * Math.max(1, s);
    return candidates.filter((c) => Math.abs(c.box[0] - (s * anchor(c.key)[0] + tx)) <= tol && Math.abs(c.box[1] - (s * anchor(c.key)[1] + ty)) <= tol);
  };
  const keyCount = (g: typeof candidates) => new Set(g.map((c) => c.key)).size;
  // Annahmen: Maßstab 1 (wie bisher, je Beschriftung ein Versatz) und jedes Paar verschiedener Beschriftungen
  const hypotheses: [number, number, number][] = [];
  for (const c of candidates) hypotheses.push([1, c.box[0] - anchor(c.key)[0], c.box[1] - anchor(c.key)[1]]);
  for (const a of candidates) {
    for (const b of candidates) {
      const span = anchor(b.key)[1] - anchor(a.key)[1];
      if (span < MIN_SCALE_SPAN) continue;
      const s = (b.box[1] - a.box[1]) / span;
      if (s < SCALE_RANGE[0] || s > SCALE_RANGE[1]) continue;
      hypotheses.push([s, (a.box[0] + b.box[0] - s * (anchor(a.key)[0] + anchor(b.key)[0])) / 2, a.box[1] - s * anchor(a.key)[1]]);
    }
  }
  let group: typeof candidates = [];
  let groupErr = Infinity;
  for (const [s, tx, ty] of hypotheses) {
    const g = inliers(s, tx, ty);
    const err = g.reduce((e, c) => e + Math.abs(c.box[1] - (s * anchor(c.key)[1] + ty)), 0) / Math.max(1, g.length);
    const n = keyCount(g);
    if (n > keyCount(group) || (n === keyCount(group) && n > 0 && err < groupErr)) [group, groupErr] = [g, err];
  }
  if (keyCount(group) < 2) return null;
  // Je Beschriftung ein Kasten, dann Maßstab und Versatz ausgleichen (kleinste Quadrate über die Höhen)
  const fitOf = (g: typeof candidates) => {
    const ys = g.map((c) => anchor(c.key)[1]);
    const my = ys.reduce((a, b) => a + b, 0) / g.length;
    const mb = g.reduce((a, c) => a + c.box[1], 0) / g.length;
    const varY = ys.reduce((a, y) => a + (y - my) ** 2, 0);
    const span = Math.max(...ys) - Math.min(...ys);
    const s = span >= MIN_SCALE_SPAN && varY > 0 ? g.reduce((a, c) => a + (anchor(c.key)[1] - my) * (c.box[1] - mb), 0) / varY : 1;
    return { s, ty: mb - s * my, tx: median(g.map((c) => c.box[0] - s * anchor(c.key)[0])), span };
  };
  let { s, tx, ty, span } = fitOf(group);
  const labels: Partial<Record<PanelLabel, Box>> = {};
  for (const c of group) {
    const cur = labels[c.key];
    const off = (b: Box) => Math.abs(b[1] - (s * anchor(c.key)[1] + ty));
    if (!cur || off(c.box) < off(cur)) labels[c.key] = c.box;
  }
  const chosen = (Object.entries(labels) as [PanelLabel, Box][]).map(([key, box]) => ({ key, box }));
  ({ s, tx, ty, span } = fitOf(chosen));
  const scaleSure = chosen.length >= 3 && span >= SURE_SCALE_SPAN && s >= SCALE_RANGE[0] && s <= SCALE_RANGE[1];
  return { scale: Math.min(SCALE_RANGE[1], Math.max(SCALE_RANGE[0], s)), tx, ty, labels, scaleSure };
}

/** Spanne des HUD-Maßstabs (FOV ~70 bis ~120 bei 1920x1080: ~1,3 bis ~0,6). */
const SCALE_RANGE: [number, number] = [0.55, 1.35];
/** Aus Beschriftungen mit weniger senkrechtem Abstand (Standard-Lage) wird kein Maßstab geschätzt. */
const MIN_SCALE_SPAN = 18;
/** Erst ab diesem Abstand (und 3 Beschriftungen) gilt der Maßstab als sicher (RES -> INST allein: 20 px). */
const SURE_SCALE_SPAN = 40;
/**
 * Bis zu dieser Abweichung gilt der Maßstab als 1 (nicht umrechnen). Gemessen bei FOV 86: 0,975–1,026 (Streuung der
 * Detektion); FOV 100: 0,856–0,879.
 */
const SCALE_SNAP = 0.04;
/**
 * Gilt eine 0/6/8/9 nur ab dieser Sicherheit als eindeutig (sonst 0,995, siehe paddle.ts), wenn die Ziffern anders
 * aussehen als in den gemessenen Scans: HUD umgerechnet (anderes FOV), Panel etwas kleiner ohne Umrechnung (Maßstab
 * unter SMALL_GLYPH_SCALE), Screenshot in anderer Auflösung (skaliert) oder verlustbehaftet (JPEG). Gemessen an 82
 * Scans, künstlich auf 0,78 und 0,7 verkleinert: falsch gelesene 0/8 bis 0,9991 (bei 1,0: keine über 0,995); bei
 * 1280x720, als JPEG oder leicht verkleinert (Review): 0,9956–0,9983. Die Schwelle trennt dort kaum noch, markiert also
 * fast jede 0/6/8/9: lieber gelb als still falsch.
 */
const SMALL_LOOKALIKE_MIN_P = 0.9995;
/**
 * Unter diesem gemessenen Maßstab (vor dem Einrasten auf 1) gelten die Ziffern als kleiner als gelernt. FOV 86 streut
 * 0,975–1,026; ein Panel bei 0,98 (künstlich) las eine 0 mit 0,995 als 8 (Review).
 */
const SMALL_GLYPH_SCALE = 0.99;
/** Ab diesem Wert von blockArtifacts gilt ein Bild als JPEG-komprimiert (echte Aufnahmen bis 0,07, JPEG ab 0,27). */
const LOSSY_BLOCKS = 0.15;
/**
 * Höchstens so breit (Standard-px) ist der Kasten eines Werts je gelesenem Zeichen (Ziffer 1, "." 0,5, "%" 1,5).
 * Breiter: Ein Zeichen fehlt vermutlich ("5%" statt "50%", "339" statt "3339"). Gemessen an richtig gelesenen Werten
 * (99 Scans, auch unscharf und als JPEG): bis 10,4, einzelne Ausreißer schon aus anderem Grund gelb; verlorene
 * Ziffern 10–17 (ein Teil bleibt darunter: nur eine zusätzliche Prüfung, kein Beweis).
 */
const WIDTH_PER_CHAR = 11;
const charWidth = (c: string) => (c === '.' ? 0.5 : c === '%' ? 1.5 : 1);
/** Nach dem Umrechnen darf das Panel höchstens so weit (px) von der Standard-Lage abweichen. */
const RESCALE_TOLERANCE = 10;

export async function readScan(
  input: Buffer,
  reader: LineReader,
  ores: Ore[],
  { layout = PROSPECTOR_1080, detector = noDetector, trace, glyphs }: ReadScanOptions = {},
): Promise<{ result: OcrResult; panelPng: Buffer }> {
  const t0 = Date.now();
  const screen = await loadScreen(input, layout);
  /**
   * Sieht das Bild aus wie die Scans, an denen gemessen und gelernt wurde (verlustfreies PNG in 1920x1080)? Ein
   * JPEG (auch als PNG weitergegeben) oder ein skaliertes Bild verändert die Ziffern: Dann bestätigt die eigene
   * Ziffernerkennung nichts, und 0/6/8/9 brauchen die strengere Schwelle.
   */
  const lossy = screen.format !== 'png' || blockArtifacts(screen, layout.search) > LOSSY_BLOCKS;
  const nativeInput = !lossy && !screen.resized;
  /** Bild, in dem gelesen wird: der Screenshot, bei anderem HUD-Maßstab mit umgerechnetem Panel-Bereich. */
  let img: Rgb = screen;
  const notes: string[] = [];
  const marks: Record<string, 'check'> = {};
  const raw: Record<string, string | null> = {};
  const draft = emptyDraft();
  const withDetection = detector !== noDetector;
  // Beispielbild: der ganze Suchbereich, damit auch verschobene Panels vollständig drin sind
  const panelPng = await toPng(crop(screen, withDetection ? layout.wide : layout.panel));
  /**
   * conf: geringe Sicherheit, amb: 0/6/8/9 zweifelhaft, glyph: eigene Ziffernerkennung widerspricht einer Ziffer,
   * variant: zweite Lesung anders, format: Form passt nicht,
   * box: Kasten unsicher, empty: nichts gelesen, ore: Erzname nicht eindeutig, color: Farbe unsicher,
   * plaus: Wert unmöglich (Bereich, Masse/SCU/Dichte), sum: Anteile ergeben nicht 100 % oder wurden getauscht,
   * scale: Größe des Panels (FOV) nicht sicher erkannt.
   */
  type Reason = 'conf' | 'amb' | 'glyph' | 'variant' | 'format' | 'box' | 'empty' | 'ore' | 'color' | 'plaus' | 'sum' | 'scale';
  const why: Record<string, Set<Reason>> = {};
  const flag = (key: string, reason: Reason) => {
    marks[key] = 'check';
    (why[key] ??= new Set()).add(reason);
  };
  let scale = 1;
  const finish = (panelFound: boolean, offset: [number, number] | null, anchors: string[]) => ({
    result: {
      layout: layout.id, engine: reader.name, panelFound, offset, scale, anchors, rowPitch, draft, marks, notes, raw, ms: Date.now() - t0,
      reasons: Object.fromEntries(Object.entries(why).filter(([k]) => marks[k]).map(([k, r]) => [k, [...r]])),
    },
    panelPng,
  });

  // ---------- Panel finden ----------
  let dx = 0;
  let dy = 0;
  let labels: Partial<Record<PanelLabel, Box>> = {};
  let boxes: Box[] = [];
  /** Maßstab nicht sicher bestimmt: alles prüfen lassen (am Ende markiert). */
  let scaleDoubt = false;
  /** Standard-Lage -> Screenshot: Bildschirm = s x Standard + [tx, ty] (gilt für das Lesen der Pixel). */
  let view = { s: 1, tx: 0, ty: 0 };
  /** Versatz für die Anzeige: Lage der MASS-Beschriftung gegenüber der Standard-Lage im Screenshot. */
  let shown: [number, number] = [0, 0];
  let rowPitch: number | null = null;
  /** Gemessener Maßstab vor dem Einrasten auf 1 (Größe der Ziffern im Screenshot gegenüber den Lerndaten). */
  let measuredScale = 1;
  if (withDetection) {
    const detect = async (from: Rgb, region: Box) => (await detector.detect(from, region)).filter((b) => b[2] >= 5 && b[3] >= 5);
    // Zuerst im gewohnten Bereich (bei FOV 86 steht das Panel immer darin), sonst im erweiterten (anderes FOV)
    let region = layout.search;
    boxes = await detect(img, region);
    let found = await locatePanel(img, layout, reader, boxes);
    if (!found) {
      region = layout.wide;
      boxes = await detect(img, region);
      found = await locatePanel(img, layout, reader, boxes);
    }
    if (!found) {
      notes.push('Kein Scan-Panel gefunden (Mining-Modus, Prospector, 1920x1080, englisches HUD?).');
      return finish(false, null, []);
    }
    if (!found.scaleSure) scaleDoubt = true;
    measuredScale = found.scale;
    const [mx, my] = layout.anchors.mass;
    shown = [Math.round((found.scale - 1) * mx + found.tx), Math.round((found.scale - 1) * my + found.ty)];
    // Kleine Abweichungen vom Maßstab 1 sind Streuung der Detektion: dann wie bisher nur ein Versatz
    const s = Math.abs(found.scale - 1) > SCALE_SNAP ? found.scale : 1;
    const [tx, ty] = s === 1 ? labelOffset(layout, found.labels) : [found.tx, found.ty];
    const [rx, ry, rw, rh] = layout.rescaled;
    if (s !== 1 || !inside([s * rx + tx, s * ry + ty, s * rw, s * rh], region)) {
      // HUD in anderem Maßstab (FOV) oder Panel ragt aus dem durchsuchten Bereich: Panel-Bereich auf Standard-Größe und
      // Standard-Lage umrechnen und dort neu suchen. Danach gelten alle Maße und Prüfungen wie gewohnt. Gelesen werden
      // die Pixel trotzdem aus dem Screenshot (siehe pixels).
      scale = s;
      view = { s, tx, ty };
      img = await rescaleRegion(screen, layout.rescaled, s, tx, ty);
      boxes = await detect(img, layout.rescaled);
      found = await locatePanel(img, layout, reader, boxes, RESCALE_TOLERANCE + ANCHOR_TOLERANCE);
      if (!found) {
        notes.push(`Scan-Panel ${s === 1 ? 'am Rand' : `in ungewohnter Größe (${s.toFixed(2)}x, FOV?)`} nicht sicher erkannt. Bitte Werte eintragen.`);
        return finish(false, null, []);
      }
      // Gegenprobe: Jetzt muss das Panel in Standard-Größe an der Standard-Lage stehen
      const [cx, cy] = [(found.scale - 1) * mx + found.tx, (found.scale - 1) * my + found.ty];
      if (!found.scaleSure || Math.abs(found.scale - 1) > SCALE_SNAP || Math.hypot(cx, cy) > RESCALE_TOLERANCE) scaleDoubt = true;
      if (s !== 1) notes.push(`HUD ${s < 1 ? 'kleiner' : 'größer'} als bei FOV 86 (${s.toFixed(2)}x), umgerechnet.`);
    }
    labels = found.labels;
    [dx, dy] = labelOffset(layout, labels);
    // Zeilenabstand im Screenshot (die Beschriftungen liegen nach dem Umrechnen in Standard-Größe vor)
    const pitch = measureRowPitch(labels);
    rowPitch = pitch == null ? null : pitch * view.s;
    if (img === screen) shown = [dx, dy];
    const [sx, sy] = shown;
    if (Math.abs(sx) > 3 || Math.abs(sy) > 3) notes.push(`Panel ${sy > 0 ? sy + ' px tiefer' : -sy + ' px höher'} gefunden${sx ? ` (${sx > 0 ? '+' : ''}${sx} px seitlich)` : ''}.`);
  } else if (!panelVisible(img, layout.panel)) {
    notes.push('Kein Scan-Panel an der erwarteten Stelle gefunden (Mining-Modus, Prospector, 1920x1080?).');
    return finish(false, null, []);
  }
  const at = (b: Box) => shift(b, dx, dy);
  // Eigene Ziffernerkennung nur bei der HUD-Größe, an der sie gelernt hat (sonst sieht die Schrift anders aus). Die
  // Pixel kommen immer aus dem Screenshot: Bei umgerechnetem Panel (anderes FOV) sind die Ziffern dort kleiner oder
  // größer als beim Lernen, dann nie (auch wenn der Zeilenabstand gerade noch passt).
  const glyphsFit = validModel(glyphs) && view.s === 1 && rowPitch != null && rowPitch >= glyphs.rowPitch[0] && rowPitch <= glyphs.rowPitch[1];
  // Widersprechen (zusätzlich markieren) darf sie dann immer; Zweifel aufheben nur bei einem Bild wie beim Lernen:
  // Bei JPEG lagen beide Modelle sicher daneben (eine 8 als 6, Review), PaddleOCR hatte dort richtig gezweifelt.
  const glyphsConfirm = glyphsFit && nativeInput;
  /** Ziffern sehen anders aus als in den gemessenen Scans: strengere Schwelle für 0/6/8/9 (SMALL_LOOKALIKE_MIN_P). */
  const strictLookalike = view.s !== 1 || measuredScale < SMALL_GLYPH_SCALE || !nativeInput;
  if (lossy || screen.resized) {
    notes.push(`Bild ${lossy ? 'verlustbehaftet (JPEG?)' : `in anderer Auflösung`}: mehr Felder zum Prüfen markiert. Am besten "Am PC einlesen" oder ein PNG in 1920x1080.`);
  }

  /**
   * Pixel eines Kastens (Standard-Lage, ggf. mit Rand). Immer aus dem Screenshot selbst: Bei anderem Maßstab wird
   * der Kasten zurückgerechnet, statt das umgerechnete Bild zu lesen (einmal weniger abgetastet, Farben unverfälscht).
   * left/width: Lage des Ausschnitts in Standard-Koordinaten.
   */
  const pixels = ([x, y, w, h]: Box, pad = 0): Crop => {
    const { s, tx, ty } = view;
    const p = Math.round(pad * s);
    const [cx, cy0, cw, ch] = clampBox(screen, [s * x + tx, s * y + ty, s * w, s * h]);
    const x0 = Math.max(0, cx - p);
    const y0 = Math.max(0, cy0 - p);
    const image = crop(screen, [x0, y0, Math.min(screen.width, cx + cw + p) - x0, Math.min(screen.height, cy0 + ch + p) - y0]);
    return { image, left: (x0 - tx) / s, width: image.width / s };
  };

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
    const box = union(chain);
    // Wert steht an fester Stelle: MASS/RES/INST linksbündig ~90 px rechts der Beschriftung, SCU rechtsbündig ~177 px.
    // Weicht der Kasten ab, steckt vermutlich fremder Text mit drin (z. B. eine Ziffer zwischen Beschriftung und Wert).
    if (field === 'scu' ? Math.abs(right(box) - label[0] - 177) > 8 : Math.abs(box[0] - label[0] - 90) > 9) boxDoubt.add(field);
    return box;
  };

  /** Ausschnitt für die Erkennung: mit Rand, schmale Ziffern (z. B. "0") etwas breiter. */
  const cropFor = (box: Box, kind: ReadKind): Crop => {
    let [x, y, w, h] = box;
    if (kind !== 'text' && w < h * 1.3) {
      const grow = Math.ceil((h * 1.3 - w) / 2);
      x -= grow;
      w += 2 * grow;
    }
    return pixels([x, y, w, h], 3);
  };

  /** Zeichen des Werts je Feld (ohne "%" und "SCU"), für Prüfungen nach dem Lesen. */
  const valueOf: Record<string, Char[]> = {};
  /**
   * Von der Ziffernerkennung aufgehobene Zweifel, die nur gelten, wenn die Dichte-Prüfung Masse und SCU bestätigt:
   * Ob die Zahl der Ziffern stimmt, zeigt nur sie (PaddleOCR liest "88" manchmal als eine 8).
   */
  const densityGated: Record<string, Reason[]> = {};

  /**
   * Eine Zeile lesen, zweimal (normal und nur übersteuerte Pixel). Weichen die Lesungen voneinander ab, die
   * Sicherheit ist gering oder eine 0/6/8 zweifelhaft: zum Prüfen markieren. Namen prüft die Erzliste.
   */
  const read = async (key: string, box: Box | null, kind: ReadKind): Promise<ReadResult | null> => {
    if (!box) {
      raw[key] = null;
      return null;
    }
    const { image } = cropFor(box, kind);
    const a = await reader.read(image, kind);
    trace?.(key, image, kind, a);
    raw[key] = a?.text ?? null;
    if (!a || !a.text || kind === 'text') return a;
    const reasons = new Set<Reason>();
    // Sicherheit nur über die Zeichen des Werts ("%" beim Anteil und "SCU" gehören nicht dazu)
    const value = a.chars?.length ? valueChars(key, kind, a.chars) : null;
    if (value) valueOf[key] = value;
    const minConfidence = nativeInput && view.s === 1 ? MIN_CONFIDENCE : STRICT_MIN_CONFIDENCE;
    if (value ? value.some((c) => c.p < minConfidence) : a.confidence < minConfidence) reasons.add('conf');
    if (a.ambiguous) reasons.add('amb');
    // Ziffern anders als in den gemessenen Scans (anderes FOV, kleiner, skaliert, JPEG): Die Sicherheit trennt
    // 0/6/8/9 schlechter (siehe SMALL_LOOKALIKE_MIN_P). Strengere Schwelle für diese Ziffern.
    const doubtfulLookalike = (c: Char) => !!c.amb || (strictLookalike && '0689'.includes(c.c) && c.p < SMALL_LOOKALIKE_MIN_P);
    if (a.chars?.some(doubtfulLookalike)) reasons.add('amb');
    // Kasten deutlich breiter als der gelesene Text: Ein Zeichen fehlt vermutlich (z. B. "5%" statt "50%", oder zwei
    // gleiche Ziffern als eine gelesen). Bei SCU steht "SCU" mit im Kasten.
    if (kind !== 'scu' && box[2] / [...a.text].reduce((u, c) => u + charWidth(c), 0) > WIDTH_PER_CHAR) reasons.add('format');
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
    if (glyphsFit && value) {
      const judged = judgeDigits(glyphs!, image, value);
      // Widerspruch: Hält eines der Modelle eine Ziffer für unwahrscheinlich, markieren, auch wenn PaddleOCR sicher
      // ist (Review: eine durchgestrichene 0 mit 0,995 als 8 gelesen, beide Modelle sahen eine 0)
      const t = glyphs!.thresholds.agree;
      if (value.some((c, i) => /\d/.test(c.c) && judged[i]?.prob.some((p, k) => p < t[k]))) reasons.add('glyph');
      // Zweifel an Ziffern: Bestätigt die eigene Ziffernerkennung sie sicher, entfällt er (der Wert bleibt, wie gelesen)
      else if (glyphsConfirm && (reasons.has('amb') || reasons.has('conf'))) {
        const ok = confirmDigits(glyphs!, judged, value, a.chars!, digitCountCheck(key, value), doubtfulLookalike);
        const removed: Reason[] = [];
        if (ok.amb && reasons.delete('amb')) removed.push('amb');
        if (ok.conf && reasons.delete('conf')) removed.push('conf');
        if (ok.density && removed.length) densityGated[key] = removed;
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
    const c = textColor(pixels(box).image);
    if (c) {
      draft[key] = c.color;
      if (c.share < 0.7) flag(key, 'color');
    } else {
      flag(key, 'color');
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
    if (v == null) flag(k, 'empty'); // nichts oder keine Zahl gelesen
  }
  for (const k of boxDoubt) flag(k, 'box');
  // Das HUD zeigt die Instabilität immer mit zwei Nachkommastellen; fehlt eine Ziffer, ist etwas verloren gegangen
  if (inst != null && !/^\d+\.\d{2}$/.test(inst)) flag('instability', 'format');
  // Die Resistenz steht immer mit "%" da; fehlt es, ist etwas verloren gegangen (z. B. "0%" als "3" gelesen)
  if (res != null && !raw.resistance?.includes('%')) flag('resistance', 'format');
  // Ebenso SCU mit zwei Nachkommastellen, Resistenz ganzzahlig, nirgends eine führende Null ("05.56" statt "85.56":
  // eine 8 als 0 gelesen). So fällt ein Lesefehler auch dann auf, wenn eine andere Ziffer bestätigt wurde.
  if (scu != null && !/^\d+\.\d{2}m?$/.test(scu)) flag('scu', 'format');
  if (res != null && !/^\d+$/.test(res)) flag('resistance', 'format');
  for (const [k, v] of [['mass', mass], ['resistance', res], ['instability', inst], ['scu', scu]] as const) {
    if (v != null && /^0\d/.test(v)) flag(k, 'format');
  }
  if (res != null && Number(res) > 100) {
    // 0/8-Verwechslung? Variante unter 100 % nehmen, aber markieren
    const alt = zeroEightVariants(res).find((v) => Number(v) <= 100);
    if (alt) draft.resistance = alt;
    flag('resistance', 'plaus');
  }
  if (scu != null && scuValue(scu) > MAX_SCU) {
    draft.scu = '';
    flag('scu', 'plaus');
  }
  if (massScuPlausible(mass, draft.scu || null) === false) {
    const alt = zeroEightVariants(mass!).find((m) => massScuPlausible(m, draft.scu));
    if (alt) draft.mass = alt;
    flag('mass', 'plaus');
    flag('scu', 'plaus');
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
      if (!rest.length) {
        rowMissing = true; // Zeile nur aus fremdem Text am Rand: dort könnte eine echte Zeile stehen
        continue;
      }
      // Mehrere Kästen in der Qualitätsspalte, oder Anteil/Name reicht bis an den Qualitätskasten: welcher Kasten die
      // Qualität ist, ist nicht sicher. Lange Namen ("INERT MATERIALS", "TITANIUM (ORE)") enden bis ~142 px rechts von
      // COMP, die dreistellige Qualität beginnt ab ~147 px. Verschluckt der Name eine Ziffer der Qualität, fehlt sie
      // dort: das fängt die Formprüfung (dreistellig) ab.
      const nameEnd = q ? Math.min(q[0] - 3, comp[0] + 145) : comp[0] + 130;
      const qualityDoubt = qCol.length > 1 || rest.some((b) => right(b) > nameEnd);
      const left = union(rest);
      const split = await splitPercent(reader, left, cropFor);
      const pctText = await read(`parts.${i}.pct`, split?.pct ?? left, 'number');
      const oreText = split?.name ? await read(`parts.${i}.ore`, split.name, 'text') : null;
      const qualityText = q ? await read(`parts.${i}.quality`, q, 'integer') : null;
      const ore = matchOre(oreText?.text, ores);
      if (!ore || !ore.exact) flag(`parts.${i}.ore`, 'ore');
      const quality = cleanNumber(qualityText?.text, { int: true });
      if (quality == null && ore?.id !== 'inert') flag(`parts.${i}.quality`, 'empty');
      // Qualität: dreistellig bis 1000 (Stufenwerte des Erzes, keine unter 100), Inert zeigt 0
      if (quality != null && !(ore?.id === 'inert' ? quality === '0' : /^([1-9]\d{2}|1000)$/.test(quality))) {
        flag(`parts.${i}.quality`, 'format');
      }
      if (outside) {
        flag(`parts.${i}.ore`, 'box');
        flag(`parts.${i}.quality`, 'box');
      }
      if (qualityDoubt) flag(`parts.${i}.quality`, 'box');
      // Nichts Lesbares (z. B. Teil des Balkens vor hellem Boden): keine Zeile daraus machen
      if (!pctText?.text && !oreText?.text && !qualityText?.text) {
        for (const k of Object.keys(marks)) if (k.startsWith(`parts.${i}.`)) delete marks[k];
        for (const k of Object.keys(raw)) if (k.startsWith(`parts.${i}.`)) delete raw[k];
        // Unter der ersten Zeile könnte das eine echte, nur unlesbare Zeile sein
        if (rows.length) rowMissing = true;
        continue;
      }
      let pct = cleanNumber(pctText?.text);
      // Punkt nicht gelesen ("2750" statt "27.50"): Anteile haben immer zwei Nachkommastellen
      if (pct && !pct.includes('.') && pct.length >= 3) {
        if (Number(pct) > 100) pct = `${pct.slice(0, -2)}.${pct.slice(-2)}`; // "100" kann auch 100 % sein
        flag(`parts.${i}.pct`, 'format');
      }
      // Sonst muss das Format stimmen (z. B. "70.7" statt "70.71": Ziffer verloren)
      if (pct && (!/^\d+\.\d{2}$/.test(pct) || /^0\d/.test(pct))) flag(`parts.${i}.pct`, 'format');
      // Anteil oder Erz der Zeile nicht lesbar: Dann ist auch nicht sicher, dass der Qualitätskasten zu dieser Zeile
      // gehört (vor hellem Boden nahm eine Zeile die Qualität der Nachbarzeile, Review)
      if (!pct || why[`parts.${i}.pct`]?.has('format') || !ore) flag(`parts.${i}.quality`, 'box');
      rows.push({ pct, ore: ore?.id ?? null, quality });
    }
  }
  // Fehlt eine Zeile, können die Kästen verrutscht sein: auch jede Qualität prüfen lassen
  if (rowMissing) rows.forEach((_, i) => flag(`parts.${i}.quality`, 'box'));
  if (rows.length) {
    const resolved = resolvePercents(rows.map((r) => r.pct));
    const markAllPct = () => rows.forEach((_, i) => flag(`parts.${i}.pct`, 'sum'));
    const finalSum = resolved.values.reduce((s, v) => s + (v ? Number(v) : 0), 0);
    const complete = resolved.values.every((v) => v);
    const sumNote = () =>
      notes.push(
        rowMissing || finalSum < SUM_WINDOW[0]
          ? `Die Anteile ergeben ${finalSum.toFixed(2)} %. Fehlt eine Zeile? Bitte die Zusammensetzung prüfen.`
          : `Die Anteile ergeben ${finalSum.toFixed(2)} % statt 100 %. Bitte die Zusammensetzung prüfen.`,
      );
    const sumOff = !complete || finalSum < SUM_WINDOW[0] || finalSum > SUM_WINDOW[1] || rowMissing;
    if (resolved.changed.length) {
      // Eine Tauschung hat die Summe repariert, aber welche Zeile wirklich falsch war, ist nicht sicher
      markAllPct();
      notes.push('Anteile wurden automatisch korrigiert (0/8-Verwechslung). Bitte alle Anteile prüfen.');
      if (sumOff) sumNote();
    } else if (sumOff) {
      markAllPct();
      sumNote();
    }
    // Stimmt die Summe, bleiben alle Markierungen aus dem Lesen stehen. Die Summe hebt keine auf: Zwei Lesefehler
    // können sich ausgleichen, und die zweite Nachkommastelle kann sie ohnehin nicht klären (Code-Prüfung).
    draft.parts = rows.map((r, i) => ({ pct: resolved.values[i] ?? '', ore: r.ore ?? '', quality: r.quality ?? '' }));
  } else if (withDetection) {
    flag('parts.0.pct', 'empty');
    notes.push('Zusammensetzung nicht gefunden. Bitte eintragen.');
  }
  // Dichte-Prüfung: Masse = 142,857 x SCU x Summe(Anteil x Dichte), Inert 1. An echten Scans gemessen: 0–2 %
  // daneben. Nur zusätzliche Markierungen, nie weniger.
  const expected = expectedMass(draft, ores);
  const densityOk = expected != null && Math.abs(Number(draft.mass) / expected - 1) <= MASS_TOLERANCE;
  if (expected && !densityOk) {
    flag('mass', 'plaus');
    flag('scu', 'plaus');
    notes.push(`Masse passt nicht zu SCU und Zusammensetzung (erwartet etwa ${Math.round(expected)} kg). Bitte Masse, SCU und Anteile prüfen.`);
  }
  if (!densityOk) {
    // Ohne bestätigte Dichte gilt kein aufgehobener Zweifel an Masse und SCU (Zahl der Ziffern ungeprüft)
    for (const [k, rs] of Object.entries(densityGated)) for (const r of rs) flag(k, r);
  }
  if (expected == null) {
    // Ohne Dichte-Prüfung (Anteile ergeben nicht 100 %, Zeile fehlt, SCU fehlt) bewacht nichts Masse und SCU: dort
    // die strengere Schwelle für 0/6/8/9 (Review: SCU 12.84 statt 12.04 mit 0,995, Anteile zugleich falsch gelesen)
    for (const k of ['mass', 'scu']) {
      if (valueOf[k]?.some((c) => '0689'.includes(c.c) && c.p < SMALL_LOOKALIKE_MIN_P)) flag(k, 'amb');
    }
  }
  if (reader.name === 'keine') notes.push('Texterkennung noch nicht aktiv: nur die Farben wurden gelesen, Zahlen bitte eintragen.');

  if (scaleDoubt) {
    // Größe des Panels nicht sicher bestimmt (zu wenige Beschriftungen oder Gegenprobe nach dem Umrechnen daneben):
    // Zeilen und Werte könnten verrutscht sein. Alles prüfen lassen.
    for (const k of ['mass', 'resistance', 'instability', 'scu', 'resColor', 'instColor']) flag(k, 'scale');
    for (let i = 0; i < Math.max(1, draft.parts.length); i++) for (const f of ['pct', 'ore', 'quality']) flag(`parts.${i}.${f}`, 'scale');
    notes.push('Größe des Scan-Panels nicht sicher erkannt (FOV?). Bitte alle Werte prüfen.');
  }

  return finish(true, withDetection ? shown : null, Object.keys(labels));
}

/** Zeilenabstand MASS/RES/INST aus den gefundenen Beschriftungen (null, wenn nicht messbar). */
function measureRowPitch(labels: Partial<Record<PanelLabel, Box>>): number | null {
  const { mass, res, inst } = labels;
  if (mass && inst) return (inst[1] - mass[1]) / 2;
  if (mass && res) return res[1] - mass[1];
  if (res && inst) return inst[1] - res[1];
  return null;
}

type Char = NonNullable<ReadResult['chars']>[number];

/** Zeichen, die den Wert bilden: beim Anteil ohne "%", bei SCU nur die Zahl vor "SCU". */
function valueChars(key: string, kind: ReadKind, chars: Char[]): Char[] {
  if (kind === 'scu') {
    const end = chars.findIndex((c) => /[SCU ]/.test(c.c));
    return end >= 0 ? chars.slice(0, end) : chars;
  }
  // Der Anteil hat immer zwei Nachkommastellen (Formatprüfung), ein unsicheres "%" verdeckt dort keine Ziffer
  if (/^parts\.\d+\.pct$/.test(key) && chars[chars.length - 1]?.c === '%') return chars.slice(0, -1);
  return chars;
}

/**
 * Ist die Zahl der Ziffern an Stelle i des Werts unabhängig geprüft? PaddleOCR liest zwei gleiche Ziffern
 * nebeneinander manchmal als eine ("88" -> "8") und zweifelt dann oft an ihr; die Ziffernerkennung sieht dort eine
 * richtige 8 und würde den einzigen Hinweis aufheben. 'yes': Formprüfung (Qualität dreistellig, zwei
 * Nachkommastellen) bzw. Summe der Anteile; 'density': nur über die Dichte-Prüfung (Masse, SCU vor dem Punkt); 'no':
 * gar nicht (Resistenz, Instabilität vor dem Punkt), dort hebt die Ziffernerkennung nichts auf.
 */
function digitCountCheck(key: string, value: Char[]): (i: number) => 'yes' | 'density' | 'no' {
  const dot = value.findIndex((c) => c.c === '.');
  const decimal = (i: number) => dot >= 0 && i > dot;
  if (/^parts\.\d+\.(pct|quality)$/.test(key)) return () => 'yes';
  if (key === 'mass') return () => 'density';
  if (key === 'scu') return (i) => (decimal(i) ? 'yes' : 'density');
  if (key === 'instability') return (i) => (decimal(i) ? 'yes' : 'no');
  return () => 'no';
}

/**
 * Zweite Meinung der eigenen Ziffernerkennung zu den Ziffern eines Werts (alle ihre Modelle müssen zustimmen).
 * Bestätigt nur, wenn sie bei jeder Ziffer mit der Erkennung einig ist (sonst könnte ein Lesefehler an anderer Stelle
 * des Felds unbemerkt bleiben). amb: jede zweifelhafte 0/6/8/9 sicher dieselbe; conf: jedes unsichere Zeichen eine
 * sicher bestätigte Ziffer. Nur an Stellen, deren Ziffernzahl geprüft ist (count); density: gilt nur, wenn die
 * Dichte-Prüfung später passt. amb: welche 0/6/8/9 zweifelhaft sind (PaddleOCR oder strengere Schwelle).
 */
function confirmDigits(
  model: GlyphModel,
  judged: (DigitJudgement | null)[],
  value: Char[],
  all: Char[],
  count: (i: number) => 'yes' | 'density' | 'no',
  amb: (c: Char) => boolean,
): { amb: boolean; conf: boolean; density: boolean } {
  const t = model.thresholds;
  const atLeast = (v: number[] | null | undefined, min: number[]) => !!v && v.every((x, k) => x >= min[k]);
  const agree = value.every((c, i) => !/\d/.test(c.c) || atLeast(judged[i]?.prob, t.agree));
  if (!agree) return { amb: false, conf: false, density: false };
  const sureLookalike = (i: number) => atLeast(judged[i]?.share, t.lookalike);
  const ambInValue = all.filter(amb).every((c) => value.includes(c));
  const doubtful = (c: Char) => amb(c) || c.p < MIN_CONFIDENCE;
  const counted = value.every((c, i) => !doubtful(c) || count(i) !== 'no');
  return {
    amb: counted && ambInValue && value.every((c, i) => !amb(c) || sureLookalike(i)),
    conf: counted && value.every(
      (c, i) => c.p >= MIN_CONFIDENCE || (/\d/.test(c.c) && atLeast(judged[i]?.prob, t.digit) && (judged[i]!.share == null || sureLookalike(i))),
    ),
    density: value.some((c, i) => doubtful(c) && count(i) === 'density'),
  };
}

/** Ab diesem Median der Helligkeit gilt ein Ausschnitt als heller Hintergrund. */
const BRIGHT_BACKGROUND = 120;
function medianLum(img: Rgb): number {
  const v: number[] = [];
  for (let i = 0; i < img.data.length; i += 3) v.push(0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]);
  return v.sort((a, b) => a - b)[v.length >> 1] ?? 0;
}

/** Abweichung der Masse von der Dichte-Rechnung, ab der markiert wird (gemessen 0–2,1 %). */
const MASS_TOLERANCE = 0.035;
const KG_PER_SCU = 100 / 0.7;

/** Erwartete Masse aus SCU und Zusammensetzung; null, wenn etwas fehlt oder unbekannt ist. */
export function expectedMass(d: ScanDraft, ores: Ore[]): number | null {
  const scu = d.scu ? scuValue(d.scu) : NaN;
  if (!d.mass || !Number.isFinite(scu) || scu <= 0 || !d.parts.length) return null;
  let density = 0;
  let total = 0;
  for (const p of d.parts) {
    const pct = Number(p.pct);
    const rho = p.ore === 'inert' ? 1 : ores.find((o) => o.id === p.ore)?.density;
    if (!p.pct || !Number.isFinite(pct) || !rho) return null;
    density += (pct / 100) * rho;
    total += pct;
  }
  if (total < SUM_WINDOW[0] || total > SUM_WINDOW[1]) return null;
  return KG_PER_SCU * scu * density;
}

/**
 * Spanne, in der die angezeigten Anteile zusammen liegen. Gemessen an 99 bestätigten Scans: 99,96–100,00 (eine
 * Wahrheit mit 100,07, am Bild nicht sicher zu klären). Enger als früher (99,9–100,1): Ein Lesefehler in der zweiten
 * Nachkommastelle lag sonst genau auf dem Rand (99,90, Review).
 */
const SUM_WINDOW: [number, number] = [99.94, 100.08];

/**
 * "42.10% HEPH (RAW)" in Anteil und Name teilen: Zeile einmal ganz lesen, Lage des "%" (bzw. des ersten
 * Buchstabens) bestimmen. Die Detektion fasst die beiden Spalten oft zu einem Kasten zusammen.
 */
async function splitPercent(
  reader: LineReader,
  box: Box,
  cropFor: (b: Box, k: ReadKind) => Crop,
): Promise<{ pct: Box; name: Box | null } | null> {
  const { image, left, width } = cropFor(box, 'row');
  const r = await reader.read(image, 'row');
  if (!r?.chars?.length) return null;
  // Lage im Ausschnitt (0..1) -> Standard-Lage
  const toX = (at: number) => left + at * width;
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
