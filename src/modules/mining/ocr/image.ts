import sharp from 'sharp';
import type { Box, HudLayout } from './layout.js';

/** Bild als RGB-Pixel (3 Byte pro Pixel), auf die Layout-Auflösung gebracht. */
export interface Rgb {
  width: number;
  height: number;
  data: Buffer;
}

export class ScreenError extends Error {}

/** Geladener Screenshot mit Herkunft: Nur ein verlustfreies Bild in Layout-Größe sieht aus wie die Lerndaten. */
export interface Screen extends Rgb {
  /** Dateiformat laut sharp (png, jpeg, webp, ...). */
  format: string;
  /** Auf die Layout-Größe skaliert (andere Auflösung): Die Ziffern sind dann neu abgetastet. */
  resized: boolean;
}

/**
 * Screenshot laden (PNG, JPG, WebP). Andere 16:9-Auflösungen werden auf die Layout-Größe skaliert;
 * andere Seitenverhältnisse (z. B. Ultrawide) werden abgelehnt, weil das HUD dort anders liegt.
 */
export async function loadScreen(input: Buffer, layout: HudLayout): Promise<Screen> {
  let img = sharp(input, { failOn: 'error' });
  const meta = await img.metadata();
  if (!meta.width || !meta.height) throw new ScreenError('Bild konnte nicht gelesen werden');
  const ratio = meta.width / meta.height;
  if (Math.abs(ratio - layout.width / layout.height) > 0.01) {
    throw new ScreenError(`Nur 16:9-Bilder werden unterstützt (dieses: ${meta.width}x${meta.height})`);
  }
  const resized = meta.width !== layout.width || meta.height !== layout.height;
  if (resized) {
    img = img.resize(layout.width, layout.height, { fit: 'fill', kernel: 'lanczos3' });
  }
  const { data, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data, format: meta.format ?? 'unbekannt', resized };
}

/**
 * Spuren einer JPEG-Kompression (auch wenn das Bild danach als PNG gespeichert wurde): Kanten im 8-px-Raster der
 * Blöcke. Gemessen wird nur in glatter Umgebung (Nachbarstufen höchstens 2), wie viel stärker die Stufe genau an der
 * Blockgrenze ist als an den anderen sieben Stellen (Median). Gemessen an 99 echten Aufnahmen (PNG): -0,09 bis 0,07;
 * dieselben Bilder als JPEG Qualität 95: ab 0,27, Qualität 60–85: ab 0,5. Bildbereich `box` (z. B. Suchbereich).
 */
export function blockArtifacts(img: Rgb, [x0, y0, w, h]: Box): number {
  const L = (x: number, y: number) => {
    const o = (y * img.width + x) * 3;
    return (img.data[o] + img.data[o + 1] + img.data[o + 2]) / 3;
  };
  const sum = new Array<number>(8).fill(0);
  const n = new Array<number>(8).fill(0);
  const x1 = Math.min(img.width, x0 + w);
  const y1 = Math.min(img.height, y0 + h);
  const add = (pos: number, a: number, b: number, c: number) => {
    if (Math.max(a, c) > 2) return; // nur glatte Umgebung
    sum[pos % 8] += b - (a + c) / 2;
    n[pos % 8]++;
  };
  for (let y = y0; y < y1; y++) {
    for (let x = x0 + 2; x < x1 - 1; x++) add(x, Math.abs(L(x - 1, y) - L(x - 2, y)), Math.abs(L(x, y) - L(x - 1, y)), Math.abs(L(x + 1, y) - L(x, y)));
  }
  for (let y = y0 + 2; y < y1 - 1; y++) {
    for (let x = x0; x < x1; x++) add(y, Math.abs(L(x, y - 1) - L(x, y - 2)), Math.abs(L(x, y) - L(x, y - 1)), Math.abs(L(x, y + 1) - L(x, y)));
  }
  const mean = sum.map((v, i) => v / Math.max(1, n[i]));
  return mean[0] - mean.slice(1).sort((a, b) => a - b)[3];
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
  // Leicht grün/rot getönt (unter der Schwelle): eher weiß, aber nicht sicher. Gemessen an echten weißen Werten:
  // Grün-Verhältnis bis 1,068, Rot-Verhältnis bis 0,998 (Rot also enger prüfbar).
  const tinted = greenRatio > 1.075 || redRatio > 1.03;
  const share = clamp((Math.min(r, g, b) / Math.max(r, g, b) - 0.7) / 0.25);
  return { color: 'white', share: tinted ? Math.min(share, 0.5) : share };
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

/**
 * HUD in anderem Maßstab (FOV): Bereich `region` (Standard-Lage, Maßstab 1) aus dem Bild neu abtasten, wobei
 * Bildschirm = scale x Standard + [tx, ty]. Ergebnis ist eine Kopie des Bilds, in der dieser Bereich so aussieht wie
 * bei Maßstab 1 an der Standard-Lage; der Rest bleibt unverändert. Außerhalb des Bilds: schwarz. Lanczos, wie beim
 * Skalieren anderer Auflösungen in loadScreen.
 */
export async function rescaleRegion(img: Rgb, [rx, ry, rw, rh]: Box, scale: number, tx: number, ty: number): Promise<Rgb> {
  const x0 = Math.round(scale * rx + tx);
  const y0 = Math.round(scale * ry + ty);
  const w = Math.max(1, Math.round(scale * rw));
  const h = Math.max(1, Math.round(scale * rh));
  const cx0 = Math.max(0, x0);
  const cy0 = Math.max(0, y0);
  const cx1 = Math.min(img.width, x0 + w);
  const cy1 = Math.min(img.height, y0 + h);
  const out: Rgb = { width: img.width, height: img.height, data: Buffer.from(img.data) };
  let part: Buffer;
  if (cx1 - cx0 < 2 || cy1 - cy0 < 2) {
    part = Buffer.alloc(rw * rh * 3);
  } else {
    // Zwei Schritte: sharp würde extend sonst erst nach dem Skalieren anwenden
    const cut = await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 3 } })
      .extract({ left: cx0, top: cy0, width: cx1 - cx0, height: cy1 - cy0 })
      .extend({ left: cx0 - x0, top: cy0 - y0, right: x0 + w - cx1, bottom: y0 + h - cy1, background: '#000000' })
      .raw()
      .toBuffer({ resolveWithObject: true });
    part = await sharp(cut.data, { raw: { width: cut.info.width, height: cut.info.height, channels: 3 } })
      .resize(rw, rh, { fit: 'fill', kernel: 'lanczos3' })
      .raw()
      .toBuffer();
  }
  for (let y = 0; y < rh; y++) part.copy(out.data, ((ry + y) * img.width + rx) * 3, y * rw * 3, (y + 1) * rw * 3);
  return out;
}
