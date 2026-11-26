import sharp from 'sharp';
import type { Box, HudLayout } from './layout.js';

/** Bild als RGB-Pixel (3 Byte pro Pixel), auf die Layout-Auflösung gebracht. */
export interface Rgb {
  width: number;
  height: number;
  data: Buffer;
}

export class ScreenError extends Error {}

/**
 * Screenshot laden (PNG, JPG, WebP). Andere 16:9-Auflösungen werden auf die Layout-Größe skaliert;
 * andere Seitenverhältnisse (z. B. Ultrawide) werden abgelehnt, weil das HUD dort anders liegt.
 */
export async function loadScreen(input: Buffer, layout: HudLayout): Promise<Rgb> {
  let img = sharp(input, { failOn: 'error' });
  const meta = await img.metadata();
  if (!meta.width || !meta.height) throw new ScreenError('Bild konnte nicht gelesen werden');
  const ratio = meta.width / meta.height;
  if (Math.abs(ratio - layout.width / layout.height) > 0.01) {
    throw new ScreenError(`Nur 16:9-Bilder werden unterstützt (dieses: ${meta.width}x${meta.height})`);
  }
  if (meta.width !== layout.width || meta.height !== layout.height) {
    img = img.resize(layout.width, layout.height, { fit: 'fill', kernel: 'lanczos3' });
  }
  const { data, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data };
}

/** Ausschnitt als neues RGB-Bild. */
export function crop(img: Rgb, [left, top, w, h]: Box): Rgb {
  const out = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    const src = ((top + y) * img.width + left) * 3;
    img.data.copy(out, y * w * 3, src, src + w * 3);
  }
  return { width: w, height: h, data: out };
}

export type TextColor = 'white' | 'green' | 'red';

/**
 * Farbe eines HUD-Werts aus dem Mittel aller hellen Pixel. Einzelne Pixel taugen nicht: Die HUD-Schrift hat einen
 * Farbsaum (chromatische Aberration), weiße Ziffern bestehen großteils aus cyan-, gelbgrün- und rotstichigen Pixeln
 * (PC-Test 2026-11-26: Pixel-Abstimmung ergab "grün" für weiße Schrift). Im Mittel gemessen:
 * weiß = alle Kanäle ähnlich (kleinster/größter Kanal >= 0,90), grün = Grün ~1,3x, rot = Rot ~1,4x der anderen.
 * Vor hellem Boden zählen nur Pixel deutlich heller als der Hintergrund (Median).
 * share: wie eindeutig (0..1); null, wenn kaum Text zu sehen ist.
 */
export function textColor(img: Rgb): { color: TextColor; share: number } | null {
  const maxima: number[] = [];
  for (let i = 0; i < img.data.length; i += 3) maxima.push(Math.max(img.data[i], img.data[i + 1], img.data[i + 2]));
  const background = [...maxima].sort((a, b) => a - b)[maxima.length >> 1] ?? 0;
  const from = Math.min(245, Math.max(150, background + 25));
  const sum = [0, 0, 0];
  let n = 0;
  for (let i = 0, k = 0; i < img.data.length; i += 3, k++) {
    if (maxima[k] <= from) continue;
    sum[0] += img.data[i];
    sum[1] += img.data[i + 1];
    sum[2] += img.data[i + 2];
    n++;
  }
  if (n < 15) return null;
  const [r, g, b] = sum.map((v) => v / n);
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const greenRatio = g / Math.max(r, b);
  const redRatio = r / Math.max(g, b);
  if (greenRatio >= 1.12) return { color: 'green', share: clamp((greenRatio - 1) / 0.25) };
  if (redRatio >= 1.12) return { color: 'red', share: clamp((redRatio - 1) / 0.3) };
  return { color: 'white', share: clamp((Math.min(r, g, b) / Math.max(r, g, b) - 0.7) / 0.25) };
}

const ink = (img: Rgb, x: number, y: number, thr: number) => {
  const o = (y * img.width + x) * 3;
  return Math.max(img.data[o], img.data[o + 1], img.data[o + 2]) > thr;
};

/**
 * Textzeile in einem Suchfenster finden (helle Pixel zeilen- und spaltenweise). Das Panel steht nicht
 * pixelgenau fest (gemessen: bis 5 px Versatz zwischen Screenshots), deshalb Fenster statt fester Kästen.
 */
export function findBand(img: Rgb, [wx, wy, ww, wh]: Box, thr = 110, expectH = 9): Box | null {
  const rows: number[] = [];
  for (let y = wy; y < wy + wh; y++) {
    let c = 0;
    for (let x = wx; x < wx + ww; x++) if (ink(img, x, y, thr)) c++;
    rows.push(c);
  }
  const runs: { s: number; e: number; score: number }[] = [];
  let s = -1;
  let sum = 0;
  for (let i = 0; i <= rows.length; i++) {
    const v = i < rows.length ? rows[i] : 0;
    if (v > 0) {
      if (s < 0) [s, sum] = [i, 0];
      sum += v;
    } else if (s >= 0) {
      const h = i - s;
      runs.push({ s, e: i - 1, score: sum * (h >= expectH - 3 && h <= expectH + 6 ? 1 : 0.2) });
      s = -1;
    }
  }
  if (!runs.length) return null;
  const r = runs.sort((a, b) => b.score - a.score)[0];
  const y0 = wy + r.s;
  const y1 = wy + r.e;
  let x0 = -1;
  let x1 = -1;
  for (let x = wx; x < wx + ww; x++) {
    for (let y = y0; y <= y1; y++) {
      if (ink(img, x, y, thr)) {
        if (x0 < 0) x0 = x;
        x1 = x;
        break;
      }
    }
  }
  return x0 < 0 ? null : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

/** Ausschnitt mit Rand (für die Texterkennung), am Bildrand begrenzt. */
export function cropPadded(img: Rgb, [x, y, w, h]: Box, pad = 3): Rgb {
  const x0 = Math.max(0, x - pad);
  const y0 = Math.max(0, y - pad);
  const x1 = Math.min(img.width, x + w + pad);
  const y1 = Math.min(img.height, y + h + pad);
  return crop(img, [x0, y0, x1 - x0, y1 - y0]);
}

/** Als PNG (z. B. für gespeicherte Beispielbilder). */
export function toPng(img: Rgb): Promise<Buffer> {
  return sharp(img.data, { raw: { width: img.width, height: img.height, channels: 3 } }).png().toBuffer();
}
