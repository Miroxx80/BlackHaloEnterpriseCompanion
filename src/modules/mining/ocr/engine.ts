import type { Rgb } from './image.js';

/**
 * Texterkennung für eine einzelne Zeile (Ausschnitt). Austauschbar: Welche Erkennung die HUD-Schrift
 * am besten liest, wird an echten Screenshots entschieden (Tesseract scheidet aus, 2/12 richtig).
 */
export interface LineReader {
  readonly name: string;
  /** kind 'number': nur Ziffern, Punkt, % und m (Milli-SCU). 'text': Erznamen in Großbuchstaben. */
  read(img: Rgb, kind: 'number' | 'text'): Promise<{ text: string; confidence: number } | null>;
}

/** Platzhalter: liest nichts. Farben, Plausibilität und Beispielbilder funktionieren trotzdem. */
export const noReader: LineReader = {
  name: 'keine',
  async read() {
    return null;
  },
};
