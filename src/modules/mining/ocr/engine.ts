import type { Rgb } from './image.js';

/**
 * Texterkennung für eine einzelne Zeile (Ausschnitt). Austauschbar: Welche Erkennung die HUD-Schrift
 * am besten liest, wird an echten Screenshots entschieden (Tesseract scheidet aus, 2/12 richtig).
 */
export interface LineReader {
  readonly name: string;
  /**
   * kind 'number': Ziffern, Punkt, % und m (Milli-SCU). 'integer': nur Ziffern (Masse, Qualität).
   * 'text': Erznamen in Großbuchstaben. confidence: 0..1.
   */
  read(img: Rgb, kind: ReadKind): Promise<ReadResult | null>;
}

/** 'scu': Zahl gefolgt von "SCU" (Buchstaben erlaubt, damit sie nicht als Ziffern gelesen werden). */
export type ReadKind = 'number' | 'integer' | 'text' | 'scu';

export interface ReadResult {
  text: string;
  confidence: number;
  /**
   * true, wenn eine 0, 6 oder 8 nicht eindeutig ist (durchgestrichene Null der HUD-Schrift). Gemessen:
   * Selbst bei 93 % Sicherheit für "0" stand im Spiel eine 8. Solche Werte immer prüfen lassen.
   */
  ambiguous?: boolean;
}

/** Platzhalter: liest nichts. Farben, Plausibilität und Beispielbilder funktionieren trotzdem. */
export const noReader: LineReader = {
  name: 'keine',
  async read() {
    return null;
  },
};
