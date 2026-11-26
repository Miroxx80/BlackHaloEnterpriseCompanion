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
 * Farbe eines HUD-Werts: helle Pixel einzeln als weiß/grün/rot einordnen, Mehrheit entscheidet.
 * Getestet an echten Scans (weiß vor dunklem All, grün/rot vor heller Planetenoberfläche).
 * share: Anteil der Stimmen für die gewählte Farbe (0..1); null, wenn kaum Text zu sehen ist.
 */
export function textColor(img: Rgb): { color: TextColor; share: number } | null {
  const votes = { white: 0, green: 0, red: 0 };
  for (let i = 0; i < img.data.length; i += 3) {
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
    const max = Math.max(r, g, b);
    if (max <= 150) continue;
    const min = Math.min(r, g, b);
    if (max - min < 50) votes.white++;
    else if (g > r + 40 && g >= b) votes.green++;
    else if (r > g + 40 && r > b + 20) votes.red++;
  }
  const total = votes.white + votes.green + votes.red;
  if (total < 15) return null;
  const color = (Object.keys(votes) as TextColor[]).reduce((a, b) => (votes[b] > votes[a] ? b : a));
  return { color, share: votes[color] / total };
}

/** Als PNG (z. B. für gespeicherte Beispielbilder). */
export function toPng(img: Rgb): Promise<Buffer> {
  return sharp(img.data, { raw: { width: img.width, height: img.height, channels: 3 } }).png().toBuffer();
}
