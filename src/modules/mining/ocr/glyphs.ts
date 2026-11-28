/**
 * Eigene Ziffernerkennung als zweite Meinung zu PaddleOCR. Sie ändert nie eine gelesene Ziffer. Zwei Wirkungen
 * (pipeline.ts): Widerspruch: Hält eines der Modelle eine gelesene Ziffer für unwahrscheinlich (unter agree), wird
 * das Feld markiert, auch wenn PaddleOCR sicher war. Bestätigung: Liest PaddleOCR eine zweifelhafte Ziffer
 * (0/6/8/9-Verwechslung oder geringe Sicherheit) und sehen beide Modelle hier an derselben Stelle sicher dieselbe
 * Ziffer, entfällt der Zweifel; nur bei einem Bild wie beim Lernen (PNG, 1920x1080, FOV 86) und nur, wo die Zahl der
 * Ziffern anders geprüft ist. Gelernt an bestätigten Scans ("Alles geprüft"), siehe scripts/ocr-train-glyphs.mjs; die
 * Modelle liegen in data/ocr/glyphs.json.
 *
 * Ablauf je Ziffer: Textband der Zeile suchen, Lage der Ziffer aus der Erkennung (chars[].at) auf die Schrift
 * einrasten, auf ein Raster 10x14 bringen, Kontrast strecken. Zwei Softmax-Regressionen über die 10 Ziffern:
 * "pixel" sieht nur das Raster, "shape" zusätzlich die Richtungen der Kanten (Gradienten je 2x2 Zellen, robuster
 * gegen Verschiebung um ein Pixel). Beide müssen zustimmen: Ihre Fehler liegen an verschiedenen Stellen.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Rgb } from './image.js';

export const GLYPH_W = 10;
export const GLYPH_H = 14;
/** Kantenrichtungen: Zellen 2x2 des Rasters, 4 Richtungen. */
const CELL = 2;
const CELLS_X = Math.ceil(GLYPH_W / CELL);
const CELLS_Y = Math.ceil(GLYPH_H / CELL);
export const PIXEL_DIMS = GLYPH_W * GLYPH_H;
export const SHAPE_DIMS = PIXEL_DIMS + CELLS_X * CELLS_Y * 4;
export const DIGITS = '0123456789';
export const GLYPH_VERSION = 2;

/** Eine Softmax-Regression über die ersten `dims` Merkmale. */
export interface DigitClassifier {
  name: 'pixel' | 'shape';
  dims: number;
  /** Mittelwert und Streuung je Merkmal (Standardisierung). */
  mu: number[];
  sd: number[];
  /** Gewichte je Klasse (Merkmale, dann Achsenabschnitt). */
  w: number[][];
}

export interface GlyphModel {
  /** Aufbau der Merkmale; ein Modell mit anderer Version wird nicht benutzt. */
  version: number;
  classes: string;
  models: DigitClassifier[];
  /**
   * Schwellen je Modell (gleiche Reihenfolge wie models), gemessen an bestätigten Scans, jeder Scan nur mit Modellen
   * ohne ihn (siehe ocr-train-glyphs.mjs):
   * lookalike: Anteil der gelesenen Ziffer unter 0/6/8/9, ab dem eine zweifelhafte 0/6/8/9 bestätigt ist.
   * digit: Wahrscheinlichkeit, ab der eine unsichere Ziffer (geringe Sicherheit der Erkennung) bestätigt ist.
   * agree: Jede Ziffer des Felds muss mindestens so wahrscheinlich sein (Modelle und Erkennung einig), sonst wird
   * nichts bestätigt und das Feld markiert (Widerspruch).
   */
  thresholds: { lookalike: number[]; digit: number[]; agree: number[] };
  /** Abstand der Zeilen MASS/RES/INST in px, in dem gelernt wurde (die HUD-Größe hängt am FOV). */
  rowPitch: [number, number];
  /** Herkunft (Anzahl Scans, Ziffern, Abstand der Fehlurteile zu den Schwellen), nur zur Information. */
  trainedOn?: string;
}

/** Helligkeit als Mittel der drei Kanäle (der Farbsaum der HUD-Schrift verteilt sich so gleichmäßig). */
function luminance(img: Rgb): Float32Array {
  const L = new Float32Array(img.width * img.height);
  const d = img.data;
  for (let i = 0, k = 0; k < L.length; i += 3, k++) L[k] = (d[i] + d[i + 1] + d[i + 2]) / 3;
  return L;
}

interface Band {
  top: number;
  bottom: number;
  bg: number;
}

/** Textband: zusammenhängende Zeilen mit Schrift, die meiste Schrift gewinnt (angeschnittene Nachbarzeilen fallen weg). */
function textBand(img: Rgb, L: Float32Array): Band | null {
  const { width: w, height: h } = img;
  const sorted = Float32Array.from(L).sort();
  const bg = sorted[sorted.length >> 1];
  const hi = sorted[Math.floor(sorted.length * 0.98)];
  const thr = bg + (hi - bg) * 0.35;
  const rows: number[] = [];
  for (let y = 0; y < h; y++) {
    let c = 0;
    for (let x = 0; x < w; x++) if (L[y * w + x] > thr) c++;
    rows.push(c);
  }
  const mx = Math.max(...rows);
  let best: (Band & { sum: number }) | null = null;
  let s = -1;
  for (let y = 0; y <= h; y++) {
    const on = y < h && rows[y] >= Math.max(2, mx * 0.15);
    if (on && s < 0) s = y;
    if (!on && s >= 0) {
      const sum = rows.slice(s, y).reduce((a, b) => a + b, 0);
      if (!best || sum > best.sum) best = { top: s, bottom: y - 1, bg, sum };
      s = -1;
    }
  }
  return best && best.bottom - best.top >= 4 ? { top: best.top, bottom: best.bottom, bg } : null;
}

/** Kantenrichtungen des Rasters: je Zelle 2x2 die Stärke in 4 Richtungen (0°, 45°, 90°, 135°). */
function edgeHistogram(f: Float32Array): Float32Array {
  const h = new Float32Array(CELLS_X * CELLS_Y * 4);
  const at = (x: number, y: number) => f[Math.max(0, Math.min(GLYPH_H - 1, y)) * GLYPH_W + Math.max(0, Math.min(GLYPH_W - 1, x))];
  for (let y = 0; y < GLYPH_H; y++) {
    for (let x = 0; x < GLYPH_W; x++) {
      const gx = at(x + 1, y) - at(x - 1, y);
      const gy = at(x, y + 1) - at(x, y - 1);
      const mag = Math.hypot(gx, gy);
      if (!mag) continue;
      let angle = Math.atan2(gy, gx);
      if (angle < 0) angle += Math.PI;
      const bin = Math.round(angle / (Math.PI / 4)) % 4;
      h[(Math.floor(y / CELL) * CELLS_X + Math.floor(x / CELL)) * 4 + bin] += mag;
    }
  }
  return h;
}

/**
 * Merkmale (Raster, dann Kantenrichtungen; SHAPE_DIMS Werte) aller Zeichen eines Ausschnitts. Lage at: 0..1 der
 * Breite, wie von der Erkennung geliefert. null für ein Zeichen, wenn keine Schrift zu finden ist.
 */
export function glyphFeatures(img: Rgb, at: number[]): (Float32Array | null)[] {
  const L = luminance(img);
  const band = textBand(img, L);
  if (!band) return at.map(() => null);
  const { width: w, height: h } = img;
  const th = band.bottom - band.top + 1;
  const gw = th * 0.7;
  const ink = (x: number, y: number) => {
    const xi = Math.max(0, Math.min(w - 1, x));
    const yi = Math.max(0, Math.min(h - 1, y));
    return Math.max(0, L[yi * w + xi] - band.bg);
  };
  return at.map((a) => {
    // Der Zeitschritt der Erkennung liegt meist im linken Teil der Ziffer: etwas nach rechts, dann auf den
    // Schwerpunkt der Schrift einrasten (höchstens 0,35 Zeilenhöhen weit)
    const x0 = a * w + 0.12 * th;
    let cx = x0;
    for (let it = 0; it < 2; it++) {
      let m = 0;
      let sx = 0;
      for (let x = Math.floor(cx - gw / 2); x <= Math.ceil(cx + gw / 2); x++) {
        for (let y = band.top; y <= band.bottom; y++) {
          const v = ink(x, y);
          m += v;
          sx += v * x;
        }
      }
      if (m > 0) cx = Math.max(x0 - th * 0.35, Math.min(x0 + th * 0.35, sx / m));
    }
    const xa = cx - gw / 2 - 0.5;
    const xb = cx + gw / 2 + 0.5;
    const ya = band.top - 0.5;
    const yb = band.bottom + 1.5;
    const f = new Float32Array(PIXEL_DIMS);
    const sub = 3;
    for (let gy = 0; gy < GLYPH_H; gy++) {
      for (let gx = 0; gx < GLYPH_W; gx++) {
        let s = 0;
        for (let sy = 0; sy < sub; sy++) {
          for (let sxx = 0; sxx < sub; sxx++) {
            const fx = xa + ((gx + (sxx + 0.5) / sub) / GLYPH_W) * (xb - xa) - 0.5;
            const fy = ya + ((gy + (sy + 0.5) / sub) / GLYPH_H) * (yb - ya) - 0.5;
            const x1 = Math.floor(fx);
            const y1 = Math.floor(fy);
            const wx = fx - x1;
            const wy = fy - y1;
            s += (1 - wy) * ((1 - wx) * ink(x1, y1) + wx * ink(x1 + 1, y1)) + wy * ((1 - wx) * ink(x1, y1 + 1) + wx * ink(x1 + 1, y1 + 1));
          }
        }
        f[gy * GLYPH_W + gx] = s / (sub * sub);
      }
    }
    let mx = 0;
    for (const v of f) mx = Math.max(mx, v);
    if (mx <= 0) return null;
    // Kontrast strecken: das untere Drittel (Hintergrund, Glühen) auf 0
    const lo = Float32Array.from(f).sort()[Math.floor(f.length * 0.3)] / mx;
    for (let i = 0; i < f.length; i++) f[i] = Math.max(0, (f[i] / mx - lo) / (1 - lo));
    const out = new Float32Array(SHAPE_DIMS);
    out.set(f);
    out.set(edgeHistogram(f), PIXEL_DIMS);
    return out;
  });
}

/** Wahrscheinlichkeiten der 10 Ziffern für ein Merkmal. */
export function classify(m: DigitClassifier, f: ArrayLike<number>): number[] {
  const K = m.w.length;
  const out: number[] = [];
  let mx = -Infinity;
  for (let k = 0; k < K; k++) {
    const wk = m.w[k];
    let s = wk[m.dims];
    for (let j = 0; j < m.dims; j++) s += wk[j] * ((f[j] - m.mu[j]) / m.sd[j]);
    out.push(s);
    if (s > mx) mx = s;
  }
  let t = 0;
  for (let k = 0; k < K; k++) t += out[k] = Math.exp(out[k] - mx);
  return out.map((v) => v / t);
}

/** Gültiges Modell (Version, Größen, Schwellen)? Sonst wird es nicht benutzt. */
export function validModel(m: unknown): m is GlyphModel {
  const g = m as GlyphModel;
  if (!g || g.version !== GLYPH_VERSION || g.classes !== DIGITS || !Array.isArray(g.models) || !g.models.length) return false;
  const n = g.models.length;
  const t = g.thresholds;
  const okList = (v: unknown, min: number) => Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && x >= min && x <= 1);
  return (
    g.models.every(
      (c) => [PIXEL_DIMS, SHAPE_DIMS].includes(c.dims) && c.mu?.length === c.dims && c.sd?.length === c.dims &&
        c.w?.length === DIGITS.length && c.w.every((row) => row.length === c.dims + 1),
    ) &&
    !!t && okList(t.lookalike, 0.5) && okList(t.digit, 0.5) && okList(t.agree, 0.2) &&
    Array.isArray(g.rowPitch) && g.rowPitch.length === 2 && g.rowPitch[0] <= g.rowPitch[1]
  );
}

/** Modelle aus data/ocr/glyphs.json laden; null, wenn sie fehlen oder nicht passen (dann wird nichts bestätigt). */
export function loadGlyphModel(dir: string): GlyphModel | null {
  const file = join(dir, 'glyphs.json');
  if (!existsSync(file)) return null;
  try {
    const m: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return validModel(m) ? m : null;
  } catch {
    return null;
  }
}

/** Urteil je Ziffer und Modell: Wahrscheinlichkeit der gelesenen Ziffer, bei 0/6/8/9 auch ihr Anteil darunter. */
export interface DigitJudgement {
  prob: number[];
  share: number[] | null;
}

export function judgeDigits(model: GlyphModel, img: Rgb, chars: { c: string; at: number }[]): (DigitJudgement | null)[] {
  const digits = chars.map((c, i) => (/\d/.test(c.c) ? i : -1)).filter((i) => i >= 0);
  const features = glyphFeatures(img, digits.map((i) => chars[i].at));
  const out: (DigitJudgement | null)[] = chars.map(() => null);
  digits.forEach((i, n) => {
    const f = features[n];
    if (!f) return;
    const c = chars[i].c;
    const probs = model.models.map((m) => classify(m, f));
    const pick = (p: number[], d: string) => p[model.classes.indexOf(d)] ?? 0;
    const share = (p: number[]) => pick(p, c) / Math.max(1e-12, pick(p, '0') + pick(p, '6') + pick(p, '8') + pick(p, '9'));
    out[i] = { prob: probs.map((p) => pick(p, c)), share: '0689'.includes(c) ? probs.map(share) : null };
  });
  return out;
}

/**
 * Softmax-Regression (L2, Gradientenabstieg) über die ersten `dims` standardisierten Merkmale. Klein und ohne
 * Abhängigkeiten; für das Erzeugen der Modelle (scripts/ocr-train-glyphs.mjs) und Tests.
 */
export function trainClassifier(
  name: DigitClassifier['name'],
  dims: number,
  X: ArrayLike<number>[],
  labels: string[],
  { l2 = 1e-3, epochs = 300, lr = 0.5 }: { l2?: number; epochs?: number; lr?: number } = {},
): DigitClassifier {
  const n = X.length;
  const d = dims;
  const K = DIGITS.length;
  const y = labels.map((c) => DIGITS.indexOf(c));
  const mu = new Array<number>(d).fill(0);
  const sd = new Array<number>(d).fill(0);
  for (const x of X) for (let j = 0; j < d; j++) mu[j] += x[j] / n;
  for (const x of X) for (let j = 0; j < d; j++) sd[j] += (x[j] - mu[j]) ** 2 / n;
  for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  const Z = X.map((x) => Float64Array.from({ length: d }, (_, j) => (x[j] - mu[j]) / sd[j]));
  const W = Array.from({ length: K }, () => new Float64Array(d + 1));
  const p = new Float64Array(K);
  for (let e = 0; e < epochs; e++) {
    const G = Array.from({ length: K }, () => new Float64Array(d + 1));
    for (let i = 0; i < n; i++) {
      const z = Z[i];
      let m = -Infinity;
      for (let k = 0; k < K; k++) {
        let s = W[k][d];
        for (let j = 0; j < d; j++) s += W[k][j] * z[j];
        p[k] = s;
        if (s > m) m = s;
      }
      let t = 0;
      for (let k = 0; k < K; k++) t += p[k] = Math.exp(p[k] - m);
      for (let k = 0; k < K; k++) {
        const g = p[k] / t - (y[i] === k ? 1 : 0);
        for (let j = 0; j < d; j++) G[k][j] += g * z[j];
        G[k][d] += g;
      }
    }
    for (let k = 0; k < K; k++) for (let j = 0; j <= d; j++) W[k][j] -= lr * (G[k][j] / n + (j < d ? l2 * W[k][j] : 0));
  }
  return { name, dims, mu, sd, w: W.map((row) => Array.from(row)) };
}
