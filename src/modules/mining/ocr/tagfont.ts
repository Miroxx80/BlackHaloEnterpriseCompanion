/**
 * Eigene Lesung der Radar-Schilder (zweiter Leser neben der Lexikon-Lesung mit PaddleOCR, siehe signatures.ts:
 * ein Wert gilt nur, wenn beide ihn lesen; liest nie allein). Das Schild hat immer denselben Aufbau: links ein
 * Pin in HUD-Farbe, dann weiße Ziffern mit Tausender-Komma ("11,565") auf einer matten Platte. Die Schrift ist fest,
 * bei 1080p aber nur ~9 px hoch, unscharf und mit rot/blauen Farbsäumen. PaddleOCR verliert dort gern die schmale
 * führende 1 ("1.520"), liest 5 als 6 oder 9 als 0. Hier wird deshalb nicht frei gelesen, sondern geprüft, welche
 * bekannte Signatur das Schild am besten erklärt:
 *
 * 1. Lage: Ziffernzeile (helle Pixel in allen Kanälen) am Detektor-Kasten, Gruppen heller Spalten, das Komma (nur unten
 *    hell) mit genau 3 Ziffern danach, links davon der Pin (gesättigte Fläche, Vorlage `pin`).
 * 2. Für jeden bekannten Wert ("11,565") werden die Ziffern nach ihrer Breite (1 schmal) zwischen Zeilenanfang, Komma
 *    und Zeilenende verteilt und jede Ziffer mit allen 10 Vorlagen verglichen (Farbraster je Kanal normiert,
 *    Korrelation, um ±1 px verschoben).
 * 3. Ein Wert gilt nur, wenn jede seiner Ziffern an ihrer Stelle auch frei gelesen die beste ist (Abstand `slot` zur
 *    zweitbesten Ziffer) und es genau einen solchen Wert gibt. Die Lesung ohne Lexikon muss also selbst eine bekannte
 *    Signatur ergeben; das Lexikon zwingt nie eine Ziffer.
 *
 * Gelernt an markierten Schildern (scripts/ocr-train-tagfont.mjs, Ausschnitte in test/fixtures/hud/signature/tags),
 * Modell in data/ocr/tagfont.json. Nur anzeigen, nie steuern.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Rgb } from './image.js';
import type { Box } from './layout.js';

export const TAGFONT_VERSION = 1;

export interface TagFontModel {
  /** Aufbau der Merkmale; ein Modell mit anderer Version wird nicht benutzt. */
  version: number;
  /** Raster je Ziffer (Breite, Höhe; dazu 3 Farbkanäle) und für den Pin (Breite, Höhe; Sättigung). */
  glyph: [number, number];
  pin: [number, number];
  /** Breite der 1 im Verhältnis zu den anderen Ziffern. */
  adv1: number;
  /** Mittlere Ziffer je Klasse "0".."9" (normiert). */
  templates: Record<string, number[]>;
  pinTemplate: number[];
  /**
   * pin: Mindest-Korrelation mit der Pin-Vorlage, damit ein Schild als gefunden gilt.
   * slot: Mindestabstand jeder Ziffer zur zweitbesten Ziffer an ihrer Stelle.
   * veto: reserviert, zur Zeit ungenutzt (bleibt im Format, damit vorhandene Modelle gültig bleiben). Gedacht als
   * Widerspruch gegen eine Lesung von PaddleOCR allein; seit signatures.ts nur noch liest, wenn beide denselben Wert
   * lesen, gibt es diese Lesung nicht mehr. TagReading.check liefert dort nur noch tagFit für den Trace.
   */
  thresholds: { pin: number; slot: number; veto: number };
  /** Herkunft (Schilder, LOO-Ergebnis), nur zur Information. */
  trainedOn?: string;
}

/** Lage einer Ziffernzeile mit Komma. */
export interface TagGeometry {
  top: number;
  bottom: number;
  /** Ziffernhöhe in px. */
  h: number;
  /** Erste und letzte helle Spalte der Zeile. */
  left: number;
  right: number;
  /** Letzte Ziffernspalte vor dem Komma, erste danach. */
  inkL: number;
  inkR: number;
  /** Hell/Dunkel der Platte (Minimum der Kanäle) für die Schwelle. */
  lo: number;
  hi: number;
}

// ---------------------------------------------------------------- Pixel

const at = (img: Rgb, x: number, y: number) => {
  const xi = x < 0 ? 0 : x >= img.width ? img.width - 1 : x | 0;
  const yi = y < 0 ? 0 : y >= img.height ? img.height - 1 : y | 0;
  return (yi * img.width + xi) * 3;
};
const minAt = (img: Rgb, x: number, y: number) => {
  const o = at(img, x, y);
  return Math.min(img.data[o], img.data[o + 1], img.data[o + 2]);
};
const satAt = (img: Rgb, x: number, y: number) => {
  const o = at(img, x, y);
  const r = img.data[o];
  const g = img.data[o + 1];
  const b = img.data[o + 2];
  return Math.max(r, g, b) - Math.min(r, g, b);
};
const chanAt = (c: number) => (img: Rgb, x: number, y: number) => img.data[at(img, x, y) + c];
const CHANNELS = [chanAt(0), chanAt(1), chanAt(2)];

/** Bilinear zwischen Pixelmitten (Pixel x liegt bei x). */
function bilinear(f: (img: Rgb, x: number, y: number) => number, img: Rgb, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const wx = x - x0;
  const wy = y - y0;
  return (
    (1 - wy) * ((1 - wx) * f(img, x0, y0) + wx * f(img, x0 + 1, y0)) + wy * ((1 - wx) * f(img, x0, y0 + 1) + wx * f(img, x0 + 1, y0 + 1))
  );
}

/** Mittelwert 0, Länge 1 (Korrelation = Skalarprodukt). */
function znorm(v: ArrayLike<number>): number[] {
  const n = v.length;
  let m = 0;
  for (let i = 0; i < n; i++) m += v[i];
  m /= n;
  let s = 0;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    out[i] = v[i] - m;
    s += out[i] * out[i];
  }
  s = Math.sqrt(s) || 1;
  for (let i = 0; i < n; i++) out[i] /= s;
  return out;
}

/** Je Farbkanal normiert (Farbe der Platte und des HUD fällt heraus, die Form der Farbsäume bleibt). */
function channelNorm(v: number[]): number[] {
  const n = v.length / 3;
  const out: number[] = [];
  for (let c = 0; c < 3; c++) for (const x of znorm(v.slice(c * n, (c + 1) * n))) out.push(x / Math.sqrt(3));
  return out;
}

const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

const percentile = (vals: number[], p: number) => {
  const s = [...vals].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
};

// ---------------------------------------------------------------- Lage

/**
 * Ziffernzeilen mit Komma am Kasten finden. Die Zeile darf über den Kasten hinausgehen (der Detektor findet manchmal
 * nur ",565"). Mehrere Ergebnisse, wenn das Komma nicht eindeutig ist; welches passt, entscheidet die Lesung.
 */
export function locateTag(img: Rgb, [bx, by, bw, bh]: Box): TagGeometry[] {
  const vals: number[] = [];
  for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) vals.push(minAt(img, x, y));
  if (!vals.length) return [];
  // Platte (dunkleres Drittel) und Schrift (hellste Pixel): Schwelle in der Mitte
  const lo = percentile(vals, 0.3);
  const hi = percentile(vals, 0.97);
  if (hi - lo < 40) return [];
  const thr = (lo + hi) / 2;
  const ink = (x: number, y: number) => minAt(img, x, y) > thr;
  // Zeile: Zeilen mit vielen hellen Pixeln um die hellste herum
  const y0 = Math.max(0, Math.floor(by - 0.3 * bh));
  const y1 = Math.min(img.height - 1, Math.ceil(by + 1.3 * bh));
  const prof: number[] = [];
  for (let y = y0; y <= y1; y++) {
    let n = 0;
    for (let x = bx; x < bx + bw; x++) if (ink(x, y)) n++;
    prof.push(n);
  }
  let best = 0;
  for (let i = 1; i < prof.length; i++) if (prof[i] > prof[best]) best = i;
  const lim = 0.3 * prof[best];
  let a = best;
  let b = best;
  while (a > 0 && prof[a - 1] >= lim) a--;
  while (b < prof.length - 1 && prof[b + 1] >= lim) b++;
  const top = y0 + a;
  const bottom = y0 + b;
  const h = bottom - top + 1;
  if (h < 6 || h > 64) return []; // 1080p ~9 px, herangezoomt (F) bis etwa 2,5x
  // Spalten: hell oben (Ziffer) / hell unten (Ziffer oder Komma, das unter die Zeile reicht)
  const cx0 = Math.max(0, Math.floor(bx - 4 * h));
  const cx1 = Math.min(img.width - 1, Math.ceil(bx + bw + 2 * h));
  const yEnd = Math.min(img.height - 1, bottom + Math.max(1, Math.round(0.35 * h)));
  const upTo = top + Math.round(0.5 * h);
  const lowFrom = bottom - Math.round(0.25 * h);
  const up: boolean[] = [];
  const low: boolean[] = [];
  for (let x = cx0; x <= cx1; x++) {
    let u = false;
    let l = false;
    for (let y = top; y <= yEnd; y++) {
      if (!ink(x, y)) continue;
      if (y < upTo) u = true;
      if (y >= lowFrom) l = true;
    }
    up.push(u);
    low.push(l);
  }
  // Gruppen heller Spalten; Lücken bis 0,3 Zeilenhöhen gehören dazu (zwischen Pin und Zahl ist mehr Platz)
  const gapMax = Math.max(2, Math.round(0.3 * h));
  const groups: [number, number][] = [];
  let gap = Infinity;
  for (let i = 0; i < up.length; i++) {
    if (up[i] || low[i]) {
      if (groups.length && gap <= gapMax) groups[groups.length - 1][1] = i;
      else groups.push([i, i]);
      gap = 0;
    } else gap++;
  }
  const out: TagGeometry[] = [];
  for (const [g0, g1] of groups) {
    const left = cx0 + g0;
    const right = cx0 + g1;
    if (right < bx || left > bx + bw) continue;
    // Komma: Spalten nur unten hell, innen in der Gruppe; links/rechts davon die nächste Ziffernspalte
    for (let i = g0 + 1; i < g1; i++) {
      if (!(low[i] && !up[i]) || (low[i - 1] && !up[i - 1])) continue;
      let j = i;
      while (j + 1 < g1 && low[j + 1] && !up[j + 1]) j++;
      let l = i - 1;
      while (l > g0 && !up[l]) l--;
      let r = j + 1;
      while (r < g1 && !up[r]) r++;
      const inkL = cx0 + l;
      const inkR = cx0 + r;
      // Danach genau 3 Ziffern, davor 1–3
      const sw = right - inkR + 1;
      const pw = inkL - left + 1;
      if (sw < 1.35 * h || sw > 3 * h || pw < 0.2 * h || pw > 3 * h) continue;
      out.push({ top, bottom, h, left, right, inkL, inkR, lo, hi });
    }
  }
  return out;
}

/** Sättigung links der Zahl auf festem Raster (Pin). */
export function pinFeatures(img: Rgb, g: TagGeometry, [pw, ph]: [number, number]): number[] {
  const x0 = g.left - 2.4 * g.h;
  const x1 = g.left - 0.15 * g.h;
  const y0 = g.top - 0.95 * g.h;
  const y1 = g.bottom + 0.65 * g.h;
  const v: number[] = [];
  for (let j = 0; j < ph; j++)
    for (let i = 0; i < pw; i++) v.push(bilinear(satAt, img, x0 + ((i + 0.5) / pw) * (x1 - x0) - 0.5, y0 + ((j + 0.5) / ph) * (y1 - y0) - 0.5));
  return znorm(v);
}

/** Eine Ziffer (Mitte cx, Breite w) als Farbraster gw x gh x 3, je Kanal normiert. */
export function glyphFeatures(img: Rgb, g: TagGeometry, cx: number, w: number, [gw, gh]: [number, number]): number[] {
  const v: number[] = [];
  const rows = g.bottom - g.top + 1;
  for (const f of CHANNELS)
    for (let j = 0; j < gh; j++)
      for (let i = 0; i < gw; i++) v.push(bilinear(f, img, cx - w / 2 + ((i + 0.5) / gw) * w - 0.5, g.top - 0.5 + ((j + 0.5) / gh) * rows));
  return channelNorm(v);
}

export interface Slot {
  c: string;
  cx: number;
  w: number;
}

/** "11,565" -> Ziffern vor und nach dem Komma. */
export const splitValue = (v: number) => ({ pre: String(Math.floor(v / 1000)), suf: String(v % 1000).padStart(3, '0') });

/**
 * Ziffern eines Werts auf die Zeile verteilen (nach Breite, die 1 schmal). ratio: Verhältnis der Ziffernbreiten vor
 * und nach dem Komma (log, 0 = gleich); passt die Zahl der Ziffern nicht, ist es groß.
 */
export function layoutValue(g: TagGeometry, value: number, adv1: number): { slots: Slot[]; ratio: number } {
  const { pre, suf } = splitValue(value);
  const slots: Slot[] = [];
  const adv = (c: string) => (c === '1' ? adv1 : 1);
  const place = (s: string, a: number, b: number) => {
    const u = (b - a + 1) / [...s].reduce((t, c) => t + adv(c), 0);
    let x = a;
    for (const c of s) {
      slots.push({ c, cx: x + (adv(c) * u) / 2, w: adv(c) * u });
      x += adv(c) * u;
    }
    return u;
  };
  const uPre = place(pre, g.left, g.inkL);
  const uSuf = place(suf, g.inkR, g.right);
  return { slots, ratio: Math.abs(Math.log(uPre / uSuf)) };
}

/** Zulässiges Verhältnis der Ziffernbreiten vor/nach dem Komma (log). */
const MAX_RATIO = 0.35;
/** Verschiebungen je Ziffer (px), die beste zählt. */
const JITTER = [-1, -0.5, 0, 0.5, 1];

/** Korrelation einer Stelle mit einer Vorlage, beste Verschiebung. */
function slotScore(img: Rgb, g: TagGeometry, s: Slot, tpl: number[], grid: [number, number]) {
  let best = -2;
  let vec: number[] = [];
  for (const dx of JITTER) {
    const v = glyphFeatures(img, g, s.cx + dx, s.w, grid);
    const sc = dot(v, tpl);
    if (sc > best) {
      best = sc;
      vec = v;
    }
  }
  return { score: best, vec };
}

/** Korrelation einer Stelle mit allen Vorlagen (je Vorlage die beste Verschiebung). */
function slotScores(img: Rgb, g: TagGeometry, s: Slot, model: TagFontModel): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of Object.keys(model.templates)) out[d] = -Infinity;
  for (const dx of JITTER) {
    const v = glyphFeatures(img, g, s.cx + dx, s.w, model.glyph);
    for (const d in out) out[d] = Math.max(out[d], dot(v, model.templates[d]));
  }
  return out;
}

// ---------------------------------------------------------------- Lesen

export interface TagValueCheck {
  value: number;
  /** Kleinster Abstand einer Ziffer zur besten anderen Ziffer an ihrer Stelle (> 0: jede Ziffer ist die beste). */
  slotMargin: number;
  /** Mittlere Korrelation der Ziffern. */
  mean: number;
  /** Was an diesen Stellen frei gelesen die beste Ziffer wäre. */
  free: string;
}

export interface TagReading {
  /** Schild gefunden (Ziffernzeile mit Komma und Pin)? */
  located: boolean;
  /** Bekannte Signatur, die das Schild eindeutig erklärt, sonst null. */
  value: number | null;
  /** Bester Wert, dessen Ziffern alle passen (sonst der mit der höchsten mittleren Korrelation, nur zur Fehlersuche). */
  best: TagValueCheck | null;
  pin: number;
  /** Mitte der Ziffernzeile (Bildkoordinaten). */
  x: number;
  y: number;
  /** Beliebigen Wert am gefundenen Schild prüfen (null: passt nicht auf die Zeile, z. B. eine Ziffer zu wenig). */
  check(value: number): TagValueCheck | null;
}

/**
 * Schild am Detektor-Kasten lesen. lexicon: alle bekannten Signaturen (aufsteigend). Liefert null, wenn kein Schild
 * mit Pin gefunden wurde.
 */
export function readTag(img: Rgb, box: Box, model: TagFontModel, lexicon: readonly number[]): TagReading | null {
  const digits = Object.keys(model.templates);
  const found = locateTag(img, box)
    .map((g) => ({ g, pin: dot(pinFeatures(img, g, model.pin), model.pinTemplate) }))
    .filter((x) => x.pin >= model.thresholds.pin);
  if (!found.length) return null;
  const caches = found.map(() => new Map<string, Record<string, number>>());
  const evaluate = (k: number, value: number): TagValueCheck | null => {
    const { g } = found[k];
    const lay = layoutValue(g, value, model.adv1);
    if (lay.ratio > MAX_RATIO) return null;
    let sum = 0;
    let margin = Infinity;
    let free = '';
    for (const s of lay.slots) {
      if (!model.templates[s.c]) return null;
      const key = `${s.cx.toFixed(2)}/${s.w.toFixed(2)}`;
      let scores = caches[k].get(key);
      if (!scores) {
        scores = slotScores(img, g, s, model);
        caches[k].set(key, scores);
      }
      let other = -Infinity;
      let arg = s.c;
      for (const d of digits) {
        if (d !== s.c && scores[d] > other) other = scores[d];
        if (scores[d] > scores[arg]) arg = d;
      }
      free += arg;
      sum += scores[s.c];
      margin = Math.min(margin, scores[s.c] - other);
    }
    return { value, slotMargin: margin, mean: sum / lay.slots.length, free };
  };
  const check = (value: number) => {
    let best: TagValueCheck | null = null;
    for (let k = 0; k < found.length; k++) {
      const r = evaluate(k, value);
      if (r && (!best || r.slotMargin > best.slotMargin)) best = r;
    }
    return best;
  };
  // Alle bekannten Werte: welche erklären das Schild Ziffer für Ziffer? (je Lage)
  let best: TagValueCheck | null = null;
  let bestK = 0;
  // Ohne Übereinstimmung nur zur Fehlersuche: der Wert mit der höchsten mittleren Korrelation
  let top: TagValueCheck | null = null;
  let topK = 0;
  const agreeing = new Set<number>();
  for (let k = 0; k < found.length; k++) {
    for (const v of lexicon) {
      if (v < 1000) continue;
      const r = evaluate(k, v);
      if (!r) continue;
      if (!top || r.mean > top.mean) [top, topK] = [r, k];
      if (r.slotMargin <= 0) continue;
      agreeing.add(v);
      if (!best || r.mean > best.mean) [best, bestK] = [r, k];
    }
  }
  const sure = !!best && agreeing.size === 1 && best.slotMargin >= model.thresholds.slot;
  const k = best ? bestK : topK;
  const g = found[k].g;
  return {
    located: true,
    value: sure ? best!.value : null,
    best: best ?? top,
    pin: found[k].pin,
    x: (g.left + g.right) / 2,
    y: (g.top + g.bottom) / 2,
    check,
  };
}

// ---------------------------------------------------------------- Lernen

export interface TagSample {
  img: Rgb;
  box: Box;
  value: number;
}

const GLYPH: [number, number] = [6, 10];
const PIN: [number, number] = [12, 16];
const ADV1 = 0.55;

const meanVector = (vs: number[][]) => {
  const m = new Array<number>(vs[0].length).fill(0);
  for (const v of vs) for (let i = 0; i < m.length; i++) m[i] += v[i];
  return m;
};

/**
 * Vorlagen lernen: je Schild die Lage wählen, zu der der Wert am besten passt, Ziffern ausschneiden, Mittel je Ziffer.
 * Dreimal: danach mit den Vorlagen ausgerichtet (beste Verschiebung) und nur mit Lagen, an denen der Pin passt.
 */
export function trainTagFont(samples: TagSample[], thresholds: TagFontModel['thresholds'], rounds = 3): TagFontModel {
  let model: TagFontModel | null = null;
  for (let round = 0; round < rounds; round++) {
    const acc: Record<string, number[][]> = {};
    const pins: number[][] = [];
    for (const s of samples) {
      let pick: { g: TagGeometry; slots: Slot[] } | null = null;
      let pickScore = -Infinity;
      for (const g of locateTag(s.img, s.box)) {
        const lay = layoutValue(g, s.value, ADV1);
        if (lay.ratio > MAX_RATIO) continue;
        let score = -lay.ratio;
        if (model) {
          if (dot(pinFeatures(s.img, g, PIN), model.pinTemplate) < thresholds.pin) continue;
          const m = model;
          score += lay.slots.reduce((t, q) => t + (m.templates[q.c] ? slotScore(s.img, g, q, m.templates[q.c], GLYPH).score : 0), 0) / lay.slots.length;
        }
        if (score > pickScore) {
          pickScore = score;
          pick = { g, slots: lay.slots };
        }
      }
      if (!pick) continue;
      pins.push(pinFeatures(s.img, pick.g, PIN));
      for (const q of pick.slots) {
        const tpl = model?.templates[q.c];
        (acc[q.c] ??= []).push(tpl ? slotScore(s.img, pick.g, q, tpl, GLYPH).vec : glyphFeatures(s.img, pick.g, q.cx, q.w, GLYPH));
      }
    }
    if (!pins.length) throw new Error('Keine Schilder zum Lernen gefunden');
    const templates: Record<string, number[]> = {};
    for (const c of Object.keys(acc).sort()) templates[c] = channelNorm(meanVector(acc[c]));
    model = {
      version: TAGFONT_VERSION,
      glyph: GLYPH,
      pin: PIN,
      adv1: ADV1,
      templates,
      pinTemplate: znorm(meanVector(pins)),
      thresholds,
      trainedOn: `${pins.length} Schilder, Ziffern ${Object.entries(acc).map(([c, v]) => `${c}:${v.length}`).join(' ')}`,
    };
  }
  return model!;
}

// ---------------------------------------------------------------- Laden

function validModel(m: unknown): m is TagFontModel {
  const t = m as TagFontModel;
  const n = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
  return (
    !!t &&
    t.version === TAGFONT_VERSION &&
    Array.isArray(t.glyph) &&
    Array.isArray(t.pin) &&
    n(t.adv1) &&
    !!t.templates &&
    Object.values(t.templates).every((v) => Array.isArray(v) && v.length === t.glyph[0] * t.glyph[1] * 3) &&
    Array.isArray(t.pinTemplate) &&
    t.pinTemplate.length === t.pin[0] * t.pin[1] &&
    !!t.thresholds &&
    n(t.thresholds.pin) &&
    n(t.thresholds.slot) &&
    n(t.thresholds.veto)
  );
}

/** Modell aus data/ocr/tagfont.json; null, wenn es fehlt oder nicht passt (dann liest nur PaddleOCR). */
export function loadTagFont(dir: string): TagFontModel | null {
  const file = join(dir, 'tagfont.json');
  if (!existsSync(file)) return null;
  try {
    const m: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return validModel(m) ? m : null;
  } catch {
    return null;
  }
}
