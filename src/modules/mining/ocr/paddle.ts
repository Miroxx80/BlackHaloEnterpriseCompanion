/**
 * Texterkennung mit PaddleOCR (PP-OCRv4, nur Zeilenerkennung) über onnxruntime-node.
 * Ausgewählt im Vergleich vom 2026-11-26: 86 % auf verlustbehafteten Screenshots, Erznamen 10/10.
 * Modell und Herkunft: data/ocr/HERKUNFT.md. Läuft lokal auf der CPU, keine Cloud.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LineReader } from './engine.js';
import type { Rgb } from './image.js';

const NUMBER = '0123456789.%m';
const INTEGER = '0123456789';
const TEXT = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ() ';
const SCU = '0123456789.mSCU ';
const HEIGHT = 48;

type Ort = typeof import('onnxruntime-node');
type Session = import('onnxruntime-node').InferenceSession;

/** Bild (bereits mit etwas Rand ausgeschnitten) -> Eingabetensor (BGR, normalisiert, Höhe 48). */
function toTensorData(img: Rgb): { data: Float32Array; width: number } {
  const scale = HEIGHT / img.height;
  const width = Math.max(16, Math.ceil(img.width * scale));
  const out = new Float32Array(3 * HEIGHT * width).fill(-1);
  const lum = (x: number, y: number) => {
    x = Math.min(Math.max(x, 0), img.width - 1);
    y = Math.min(Math.max(y, 0), img.height - 1);
    const o = (y * img.width + x) * 3;
    return 0.299 * img.data[o] + 0.587 * img.data[o + 1] + 0.114 * img.data[o + 2];
  };
  for (let y = 0; y < HEIGHT; y++) {
    const fy = (y + 0.5) / scale - 0.5;
    const y0 = Math.floor(fy);
    const wy = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = (x + 0.5) / scale - 0.5;
      const x0 = Math.floor(fx);
      const wx = fx - x0;
      const v =
        (1 - wy) * ((1 - wx) * lum(x0, y0) + wx * lum(x0 + 1, y0)) + wy * ((1 - wx) * lum(x0, y0 + 1) + wx * lum(x0 + 1, y0 + 1));
      const n = (v / 255 - 0.5) / 0.5;
      // Helligkeit auf alle drei Kanäle (das Modell erwartet BGR; bei Graustufen identisch)
      for (let c = 0; c < 3; c++) out[c * HEIGHT * width + y * width + x] = n;
    }
  }
  return { data: out, width };
}

/** Unter diesem Anteil (unter 0/6/8) gilt eine gelesene 0, 6 oder 8 als nicht eindeutig. */
const LOOKALIKE_SURE = 0.98;

/** Gieriges CTC-Dekodieren, nur erlaubte Zeichen. Sicherheit = kleinste Zeichen-Wahrscheinlichkeit. */
function decode(probs: Float32Array, steps: number, classes: number, chars: string[], allowed: number[], lookalike: number[]) {
  let text = '';
  let prev = -1;
  let conf = 1;
  let ambiguous = false;
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
      conf = Math.min(conf, bestP);
      if (lookalike.includes(best)) {
        const total = lookalike.reduce((s, i) => s + probs[t * classes + i], 0);
        if (bestP / total < LOOKALIKE_SURE) ambiguous = true;
      }
    }
    prev = best;
  }
  return { text, confidence: text ? conf : 0, ambiguous };
}

/** Lädt Modell und Zeichenliste beim ersten Gebrauch (ca. 0,1 s), danach ca. 5–20 ms pro Zeile. */
export function createPaddleReader(modelDir: string): LineReader {
  let ready: Promise<{ ort: Ort; session: Session; chars: string[]; lookalike: number[]; allow: Record<string, number[]> }> | null = null;

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
      const lookalike = ['0', '6', '8'].map((c) => chars.indexOf(c));
      return { ort, session, chars, lookalike, allow: { number: indices(NUMBER), integer: indices(INTEGER), text: indices(TEXT), scu: indices(SCU) } };
    })());

  return {
    name: 'PaddleOCR v4',
    async read(img, kind) {
      const m = await init();
      const { data, width } = toTensorData(img);
      const tensor = new m.ort.Tensor('float32', data, [1, 3, HEIGHT, width]);
      const result = await m.session.run({ [m.session.inputNames[0]]: tensor });
      const out = result[m.session.outputNames[0]];
      const [, steps, classes] = out.dims as number[];
      return decode(out.data as Float32Array, steps, classes, m.chars, m.allow[kind], kind === 'text' ? [] : m.lookalike);
    },
  };
}
