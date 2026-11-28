/**
 * Pin der Radar-Schilder finden: Links neben der Signatur steht ein Ortsmarker (Tropfen mit Loch, darunter ein
 * breiter Fuß) in der HUD-Farbe des Schiffs (orange, grün, blau, ...). Die Ziffern daneben sind fast weiß und
 * kleiner als der Pin. Cockpit-Anzeigen (COOL, 89°, 5.0km, 0.0 G, Leistungs-Chevrons) haben keinen Pin.
 *
 * Gesucht wird farbunabhängig: farbige Flächen (Chroma = größter minus kleinster Kanal) als zusammenhängende
 * Stücke, dann Form (Fuß breiter als der Hals, Seitenverhältnis, Füllung) und Lage der Ziffern rechts daneben
 * (beginnen unter der Pin-Spitze, enden über dem Fuß, Pin 1,2–2,6x so hoch wie die Ziffern).
 *
 * Grenze: Farbunabhängig heißt nur "jeder Farbton", nicht "jede Farbe". Der Pin muss gesättigt sein (Chroma ab 40 und
 * ab 45–75 % des farbigsten Pixels im Suchfenster), die Ziffern deutlich weniger. Ein weißer/grauer HUD-Pin oder ein
 * Hintergrund, der farbiger ist als der Pin (oranger/gelber Planetenboden), ergibt keinen Pin und damit keine Lesung
 * (kein Ersatzweg). Gemessen nur an orangen, grünen und blauen HUDs; für andere Schiffe/Orte erst Bilder sammeln.
 *
 * Gemessen an 32 Bildern aus dem Aaron Halo (Prospector, 1920x1080) und 3 Testbildern (orange, grün, blau):
 * Pin gefunden an 34 von 35 Schildern (nicht: der Kasten nur um die abgetrennte "11" in 08-57-11; das Schild wird
 * über den Nachbarkasten gefunden), an 1 von 467 lesbaren Kästen ohne Schild (die Lexikon-Lesung verwirft ihn).
 * Unscharf, JPEG, Gamma, Maßstab 0,8/1,25: 29–34 von 35 Schildern, höchstens 7 von 467 anderen Kästen. Der Pin
 * ist also vor allem ein Filter (Tempo: eine Erkennung statt ~15 pro Bild) und legt den Lesebereich fest; die
 * Sicherheit gegen falsche Werte kommt aus Lexikon-Lesung und Schild-Schrift. Die Grenzen unten liegen deutlich außerhalb dessen,
 * was an echten Pins gemessen wurde (Werte in Klammern).
 */
import type { Rgb } from './image.js';
import type { Box } from './layout.js';

export interface PinMatch {
  /** Pin im Bild (x, y, Breite, Höhe). */
  box: Box;
  /** Erste Spalte rechts vom Pin. */
  right: number;
  /** Ziffernspur rechts vom Pin: letzte helle Spalte, oberste und unterste Zeile. */
  digitRight: number;
  digitTop: number;
  digitBottom: number;
}

/** Grenzen der Form (gemessen an echten Pins in Klammern). */
const PIN = {
  minHeight: 8, // (10..24)
  aspect: [0.65, 1.2], // Breite/Höhe (0,78..1,0)
  fill: [0.3, 0.75], // Anteil gefüllter Pixel im Rechteck (0,40..0,61)
  footRatio: 2, // Fuß (untere 30 %) / Hals (45..75 %) (ab 2,5)
  headRatio: [0.35, 0.9], // Kopfbreite / Pinbreite (0,47..0,75)
  toDigits: [1.2, 2.6], // Pinhöhe / Ziffernhöhe (1,38..2,0)
  above: [0.05, 0.5], // Ziffern beginnen so weit unter der Spitze (Anteil Pinhöhe) (0,17..0,35)
  below: 0.03, // und enden so weit über dem Fußende (0,06..0,30)
  digitWidth: 1.0, // Ziffernspur mindestens so breit wie der Pin hoch ist (ab 1,35)
} as const;
/** Farbschwellen relativ zum farbigsten Pixel im Suchfenster: mehrere, weil Ziffern-Farbsäume und Fels stören. */
const CHROMA_LEVELS = [0.45, 0.6, 0.75];
const CHROMA_MIN = 40;

interface Comp {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  px: number[];
}

function components(mask: Uint8Array, W: number, H: number): Comp[] {
  const seen = new Uint8Array(W * H);
  const out: Comp[] = [];
  const stack: number[] = [];
  for (let i = 0; i < W * H; i++) {
    if (!mask[i] || seen[i]) continue;
    const c: Comp = { x0: W, y0: H, x1: -1, y1: -1, px: [] };
    seen[i] = 1;
    stack.push(i);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W;
      const y = (p - x) / W;
      c.px.push(p);
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const q = yy * W + xx;
          if (mask[q] && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
    out.push(c);
  }
  return out;
}

const quantile = (sorted: ArrayLike<number>, q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];

/**
 * Pin zu einem Textkasten suchen: links davon (bis 2,6 Kastenhöhen) oder im linken Teil des Kastens (der Detektor
 * nimmt den Pin manchmal mit). Nur Pins, deren Ziffernspur in der Zeile des Kastens liegt und bis in den Kasten reicht;
 * davon der mit der breitesten Ziffernspur, sonst null.
 */
export function findPin(img: Rgb, [bx, by, bw, bh]: Box): PinMatch | null {
  const x0 = Math.max(0, Math.round(bx - 2.6 * bh));
  const x1 = Math.min(img.width, bx + bw);
  const y0 = Math.max(0, Math.round(by - 0.9 * bh));
  const y1 = Math.min(img.height, Math.round(by + 1.9 * bh));
  const W = x1 - x0;
  const H = y1 - y0;
  if (W < 6 || H < 6) return null;
  const L = new Float32Array(W * H);
  const C = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = ((y0 + y) * img.width + x0 + x) * 3;
      const r = img.data[o];
      const g = img.data[o + 1];
      const b = img.data[o + 2];
      L[y * W + x] = 0.299 * r + 0.587 * g + 0.114 * b;
      C[y * W + x] = Math.max(r, g, b) - Math.min(r, g, b);
    }
  }
  const cTop = quantile(Float32Array.from(C).sort(), 0.99);
  let best: PinMatch | null = null;
  let bestWidth = 0;
  for (const level of CHROMA_LEVELS) {
    const cth = Math.max(CHROMA_MIN, level * cTop);
    const mask = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) mask[i] = C[i] >= cth && L[i] >= 50 ? 1 : 0;
    for (const c of components(mask, W, H)) {
      const w = c.x1 - c.x0 + 1;
      const h = c.y1 - c.y0 + 1;
      if (h < PIN.minHeight || c.px.length < 15) continue;
      const aspect = w / h;
      const fill = c.px.length / (w * h);
      if (aspect < PIN.aspect[0] || aspect > PIN.aspect[1] || fill < PIN.fill[0] || fill > PIN.fill[1]) continue;
      // Breite je Zeile: Kopf (oben), Hals (Mitte unten), Fuß (unten)
      const rowMin = new Array<number>(h).fill(W);
      const rowMax = new Array<number>(h).fill(-1);
      for (const p of c.px) {
        const x = p % W;
        const r = (p - x) / W - c.y0;
        if (x < rowMin[r]) rowMin[r] = x;
        if (x > rowMax[r]) rowMax[r] = x;
      }
      const rowW = rowMin.map((a, i) => (rowMax[i] >= a ? rowMax[i] - a + 1 : 0));
      const foot = Math.max(...rowW.slice(Math.floor(h * 0.7)));
      const neckFrom = Math.floor(h * 0.45);
      const neck = Math.min(...rowW.slice(neckFrom, Math.max(neckFrom + 1, Math.floor(h * 0.75))));
      const head = Math.max(...rowW.slice(0, Math.ceil(h * 0.45)));
      if (foot / Math.max(1, neck) < PIN.footRatio) continue;
      if (head / w < PIN.headRatio[0] || head / w > PIN.headRatio[1]) continue;
      const digits = digitTrack(L, C, W, H, c, cth);
      if (!digits) continue;
      const dh = digits.bottom - digits.top + 1;
      const above = (digits.top - c.y0) / h;
      const below = (c.y1 - digits.bottom) / h;
      if (h / dh < PIN.toDigits[0] || h / dh > PIN.toDigits[1]) continue;
      if (above < PIN.above[0] || above > PIN.above[1] || below < PIN.below) continue;
      if (digits.width < PIN.digitWidth * h) continue;
      // Die Ziffernspur muss zum Kasten gehören: in seiner Zeile (mindestens halbe Ziffernhöhe Überlappung) und
      // waagrecht mit ihm überlappen. Sonst bekäme ein Kasten bei zwei nahen Schildern den Pin des Nachbarn (beide
      // gingen verloren). Der Kasten darf links mehr enthalten ("26.6km 2,000"), die Spur ihn rechts überragen (",565").
      const overlap = Math.min(y0 + digits.bottom, by + bh - 1) - Math.max(y0 + digits.top, by) + 1;
      if (overlap < 0.5 * dh) continue;
      if (x0 + digits.right < bx || x0 + digits.left > bx + bw - 1) continue;
      if (digits.width > bestWidth) {
        bestWidth = digits.width;
        best = {
          box: [x0 + c.x0, y0 + c.y0, w, h],
          right: x0 + c.x1 + 1,
          digitRight: x0 + digits.right,
          digitTop: y0 + digits.top,
          digitBottom: y0 + digits.bottom,
        };
      }
    }
  }
  return best;
}

/**
 * Helle, nicht farbige Spalten rechts vom Pin (Ziffern). Beginnt höchstens 0,8 Pinhöhen rechts davon, Lücken
 * höchstens 0,45 Pinhöhen (Komma). Höhe aus dem Zeilenprofil (Zeilen mit mindestens 30 % der vollsten Zeile),
 * damit einzelne Felsbrocken die Höhe nicht verfälschen.
 */
function digitTrack(L: Float32Array, C: Float32Array, W: number, H: number, c: Comp, cth: number) {
  const h = c.y1 - c.y0 + 1;
  const ly0 = c.y0 + Math.round(0.05 * h);
  const ly1 = c.y0 + Math.round(0.8 * h);
  const vals: number[] = [];
  for (let y = ly0; y <= Math.min(H - 1, ly1); y++) for (let x = c.x1 + 1; x < W; x++) vals.push(L[y * W + x]);
  if (!vals.length) return null;
  vals.sort((a, b) => a - b);
  const lo = quantile(vals, 0.3);
  const lth = Math.max(80, lo + 0.45 * (quantile(vals, 0.98) - lo));
  const ya = Math.max(0, c.y0 - 2);
  const yb = Math.min(H - 1, c.y1);
  let start = -1;
  let end = -1;
  let gap = 0;
  for (let x = c.x1 + 1; x < W; x++) {
    let on = false;
    for (let y = ya; y <= yb && !on; y++) on = L[y * W + x] >= lth && C[y * W + x] < cth * 1.6;
    if (on) {
      if (start < 0) {
        if (x - c.x1 > 0.8 * h) break;
        start = x;
      }
      end = x;
      gap = 0;
    } else if (start >= 0 && ++gap > 0.45 * h) break;
  }
  if (start < 0) return null;
  const counts: number[] = [];
  for (let y = ya; y <= yb; y++) {
    let k = 0;
    for (let x = start; x <= end; x++) if (L[y * W + x] >= lth) k++;
    counts.push(k);
  }
  const max = Math.max(...counts);
  let top = -1;
  let bottom = -1;
  counts.forEach((k, i) => {
    if (k < 0.3 * max) return;
    if (top < 0) top = ya + i;
    bottom = ya + i;
  });
  if (top < 0) return null;
  return { left: start, right: end, width: end - start + 1, top, bottom };
}
