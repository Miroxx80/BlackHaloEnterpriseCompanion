/**
 * Texterkennung mit PaddleOCR (PP-OCRv4) über onnxruntime-node: Detektion (wo ist Text?) und Zeilenerkennung
 * (was steht da?). Ausgewählt im Vergleich vom 2026-11-26: 86 % auf verlustbehafteten Screenshots, Erznamen 10/10.
 * Modelle und Herkunft: data/ocr/HERKUNFT.md. Läuft lokal auf der CPU, keine Cloud.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LineReader, ReadKind, ReadOptions, TextDetector } from './engine.js';
import type { Rgb } from './image.js';
import type { Box } from './layout.js';

const DIGITS = '0123456789';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const CHARSETS: Record<ReadKind, string> = {
  number: DIGITS + '.%m',
  integer: DIGITS,
  text: LETTERS + '() ',
  scu: DIGITS + '.mSCU ',
  label: LETTERS + ':.',
  row: DIGITS + LETTERS + '.%() ',
};
const HEIGHT = 48;

type Ort = typeof import('onnxruntime-node');
type Session = import('onnxruntime-node').InferenceSession;

const lumAt = (img: Rgb, x: number, y: number) => {
  x = Math.min(Math.max(x, 0), img.width - 1);
  y = Math.min(Math.max(y, 0), img.height - 1);
  const o = (y * img.width + x) * 3;
  return 0.299 * img.data[o] + 0.587 * img.data[o + 1] + 0.114 * img.data[o + 2];
};

/** Ab dieser Helligkeit zählt ein Pixel in der Variante 'bright' als Schrift. */
const BRIGHT_FROM = 220;

/** Bild (bereits mit etwas Rand ausgeschnitten) -> Eingabetensor (Höhe 48, Werte -1..1). */
function toTensorData(img: Rgb, variant: ReadOptions['variant'] = 'normal'): { data: Float32Array; width: number } {
  const scale = HEIGHT / img.height;
  const width = Math.max(16, Math.ceil(img.width * scale));
  const out = new Float32Array(3 * HEIGHT * width).fill(-1);
  const norm =
    variant === 'bright'
      ? (v: number) => Math.max(0, Math.min(1, (v - BRIGHT_FROM) / (255 - BRIGHT_FROM))) * 2 - 1
      : (v: number) => (v / 255 - 0.5) / 0.5;
  for (let y = 0; y < HEIGHT; y++) {
    const fy = (y + 0.5) / scale - 0.5;
    const y0 = Math.floor(fy);
    const wy = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = (x + 0.5) / scale - 0.5;
      const x0 = Math.floor(fx);
      const wx = fx - x0;
      const v =
        (1 - wy) * ((1 - wx) * lumAt(img, x0, y0) + wx * lumAt(img, x0 + 1, y0)) +
        wy * ((1 - wx) * lumAt(img, x0, y0 + 1) + wx * lumAt(img, x0 + 1, y0 + 1));
      const n = norm(v);
      // Helligkeit auf alle drei Kanäle (das Modell erwartet BGR; bei Graustufen identisch)
      for (let c = 0; c < 3; c++) out[c * HEIGHT * width + y * width + x] = n;
    }
  }
  return { data: out, width };
}

/**
 * Unter diesem Anteil (unter 0/6/8/9) gilt eine gelesene 0, 6, 8 oder 9 als nicht eindeutig. Die 9 ist dabei,
 * seit im PC-Test eine durchgestrichene Null sicher als 9 gelesen wurde (Masse 32240 -> 32249).
 */
const LOOKALIKE_SURE = 0.98;
/**
 * Außerdem muss jede 0/6/8/9 für sich mindestens so sicher sein. Gemessen an 4 Screenshots: richtig gelesene
 * liegen fast immer bei 0,99 oder darüber, die beiden falschen (32240 -> 32249, 58.23 -> 50.23) bei 0,983/0,985.
 */
const LOOKALIKE_MIN_P = 0.99;

/** Gieriges CTC-Dekodieren, nur erlaubte Zeichen. Sicherheit = kleinste Zeichen-Wahrscheinlichkeit. */
function decode(probs: Float32Array, steps: number, classes: number, chars: string[], allowed: number[], lookalike: number[]) {
  let text = '';
  let prev = -1;
  let conf = 1;
  let ambiguous = false;
  const pos: { c: string; at: number; p: number }[] = [];
  for (let t = 0; t < steps; t++) {
    let best = 0;
    let bestP = probs[t * classes];
    for (const i of allowed) {
      const p = probs[t * classes + i];
      if (p > bestP) {
        bestP = p;
        best = i;
      }
    }
    if (best !== 0 && best !== prev) {
      text += chars[best];
      pos.push({ c: chars[best], at: (t + 0.5) / steps, p: bestP });
      conf = Math.min(conf, bestP);
      if (lookalike.includes(best)) {
        const total = lookalike.reduce((s, i) => s + probs[t * classes + i], 0);
        if (bestP / total < LOOKALIKE_SURE || bestP < LOOKALIKE_MIN_P) ambiguous = true;
      }
    }
    prev = best;
  }
  return { text, confidence: text ? conf : 0, ambiguous, chars: pos };
}

/** Lädt Modell und Zeichenliste beim ersten Gebrauch (ca. 0,1 s), danach ca. 5–20 ms pro Zeile. */
export function createPaddleReader(modelDir: string): LineReader {
  let ready: Promise<{ ort: Ort; session: Session; chars: string[]; lookalike: number[]; allow: Record<ReadKind, number[]> }> | null = null;

  const init = () =>
    (ready ??= (async () => {
      const ort = (await import('onnxruntime-node')) as unknown as Ort;
      const session = await ort.InferenceSession.create(join(modelDir, 'ppocr-v4-rec.onnx'), {
        intraOpNumThreads: 1,
        graphOptimizationLevel: 'all',
      });
      const keys = readFileSync(join(modelDir, 'ppocr_keys_v1.txt'), 'utf8').split(/\r?\n/);
      if (keys[keys.length - 1] === '') keys.pop();
      const chars = ['<blank>', ...keys, ' '];
      const indices = (set: string) => chars.map((c, i) => (i > 0 && set.includes(c) ? i : -1)).filter((i) => i > 0);
      const lookalike = ['0', '6', '8', '9'].map((c) => chars.indexOf(c));
      const allow = Object.fromEntries(Object.entries(CHARSETS).map(([k, set]) => [k, indices(set)])) as Record<ReadKind, number[]>;
      return { ort, session, chars, lookalike, allow };
    })());

  return {
    name: 'PaddleOCR v4',
    async read(img, kind, options) {
      const m = await init();
      const { data, width } = toTensorData(img, options?.variant);
      const tensor = new m.ort.Tensor('float32', data, [1, 3, HEIGHT, width]);
      const result = await m.session.run({ [m.session.inputNames[0]]: tensor });
      const out = result[m.session.outputNames[0]];
      const [, steps, classes] = out.dims as number[];
      // Die Breite des Tensors kann größer sein als das Bild (Mindestbreite): Lage auf das Bild umrechnen
      const r = decode(out.data as Float32Array, steps, classes, m.chars, m.allow[kind], kind === 'text' || kind === 'label' ? [] : m.lookalike);
      const used = (img.width * HEIGHT) / img.height / width;
      return { ...r, chars: r.chars.map((p) => ({ ...p, at: Math.min(1, p.at / used) })) };
    },
  };
}

/** Schwellen der Detektion (wie PaddleOCR-Standard, an den HUD-Bildern geprüft). */
const DET_THRESH = 0.3;
const DET_BOX_SCORE = 0.5;
const DET_UNCLIP = 1.6;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/**
 * Textzeilen finden (PP-OCRv4 det). Bereich wird auf ein Vielfaches von 32 gebracht. Kästen sind achsenparallel
 * (die HUD-Schrift ist waagerecht), leicht vergrößert wie bei PaddleOCR ("unclip").
 */
export function createPaddleDetector(modelDir: string): TextDetector {
  let ready: Promise<{ ort: Ort; session: Session }> | null = null;
  const init = () =>
    (ready ??= (async () => {
      const ort = (await import('onnxruntime-node')) as unknown as Ort;
      const session = await ort.InferenceSession.create(join(modelDir, 'ppocr-v4-det.onnx'), {
        intraOpNumThreads: 1,
        graphOptimizationLevel: 'all',
      });
      return { ort, session };
    })());

  return {
    name: 'PaddleOCR v4 det',
    async detect(img, [rx, ry, rw0, rh0]) {
      const m = await init();
      const W = Math.ceil(rw0 / 32) * 32;
      const H = Math.ceil(rh0 / 32) * 32;
      const data = new Float32Array(3 * W * H);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const sx = Math.min(img.width - 1, rx + x);
          const sy = Math.min(img.height - 1, ry + y);
          const o = (sy * img.width + sx) * 3;
          // Modell erwartet BGR
          for (let c = 0; c < 3; c++) data[c * W * H + y * W + x] = (img.data[o + 2 - c] / 255 - MEAN[c]) / STD[c];
        }
      }
      const result = await m.session.run({ [m.session.inputNames[0]]: new m.ort.Tensor('float32', data, [1, 3, H, W]) });
      const prob = result[m.session.outputNames[0]].data as Float32Array;
      return boxesFromMap(prob, W, H).map(([x, y, w, h]) => [rx + x, ry + y, w, h] as Box);
    },
  };
}

/** Zusammenhängende Flächen der Wahrscheinlichkeitskarte -> Kästen (Mindestwert, vergrößert). */
function boxesFromMap(prob: Float32Array, W: number, H: number): Box[] {
  const seen = new Uint8Array(W * H);
  const boxes: Box[] = [];
  const stack: number[] = [];
  for (let i = 0; i < W * H; i++) {
    if (seen[i] || prob[i] <= DET_THRESH) continue;
    let [x0, y0, x1, y1, n, sum] = [W, H, 0, 0, 0, 0];
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W;
      const y = (p - x) / W;
      n++;
      sum += prob[p];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      const next = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p - W, p + W];
      for (const q of next) {
        if (q >= 0 && q < W * H && !seen[q] && prob[q] > DET_THRESH) {
          seen[q] = 1;
          stack.push(q);
        }
      }
    }
    if (n < 6 || sum / n < DET_BOX_SCORE) continue;
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const d = (w * h * DET_UNCLIP) / (2 * (w + h));
    const bx = Math.max(0, Math.round(x0 - d));
    const by = Math.max(0, Math.round(y0 - d));
    boxes.push([bx, by, Math.min(W, Math.round(x1 + d + 1)) - bx, Math.min(H, Math.round(y1 + d + 1)) - by]);
  }
  return boxes;
}
