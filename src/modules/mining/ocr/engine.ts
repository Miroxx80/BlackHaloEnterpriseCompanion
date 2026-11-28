import type { Rgb } from './image.js';
import type { Box } from './layout.js';

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
  read(img: Rgb, kind: ReadKind, options?: ReadOptions): Promise<ReadResult | null>;
  /**
   * Optional: rohe Ausgabe der Erkennung für eine Lexikon-Lesung (Radar-Signaturen). Pro Zeitschritt die
   * Log-Wahrscheinlichkeiten von Leerzeichen (blank, Spalte 0) und den Zeichen `chars`, über diese renormalisiert.
   */
  logProbs?(img: Rgb, chars: string): Promise<CharLogProbs | null>;
}

export interface CharLogProbs {
  /** Spalten 1..n entsprechen diesen Zeichen, Spalte 0 ist das CTC-Leerzeichen (blank). */
  chars: string;
  steps: number;
  /** steps x (chars.length + 1), natürlicher Logarithmus. */
  lp: Float64Array;
  /** Mittlerer Anteil aller anderen Zeichen vor dem Renormalisieren (hoch = da steht eher Text als eine Zahl). */
  other: number;
}

/**
 * 'scu': Zahl gefolgt von "SCU" (Buchstaben erlaubt, damit sie nicht als Ziffern gelesen werden).
 * 'label': Beschriftungen wie "MASS:" (zum Finden des Panels). 'row': ganze Zeile der Zusammensetzung.
 */
export type ReadKind = 'number' | 'integer' | 'text' | 'scu' | 'label' | 'row' | 'signature';

export interface ReadOptions {
  /**
   * 'normal': Helligkeit wie im Bild. 'bright': nur fast weiße Pixel zählen (die HUD-Schrift ist übersteuert,
   * heller Planetenboden meist nicht). Zwei Varianten, die übereinstimmen, gelten als sicherer.
   */
  variant?: 'normal' | 'bright';
}

export interface ReadResult {
  text: string;
  confidence: number;
  /**
   * true, wenn eine 0, 6, 8 oder 9 nicht eindeutig ist (durchgestrichene Null der HUD-Schrift). Gemessen:
   * Selbst bei 93 % Sicherheit für "0" stand im Spiel eine 8. Solche Werte immer prüfen lassen.
   */
  ambiguous?: boolean;
  /** Lage jedes Zeichens im Ausschnitt (0..1 der Breite), z. B. um eine Zeile in Spalten zu teilen. */
  /** amb: diese 0/6/8/9 ist zweifelhaft. */
  chars?: { c: string; at: number; p: number; amb?: boolean }[];
}

/** Platzhalter: liest nichts. Farben, Plausibilität und Beispielbilder funktionieren trotzdem. */
export const noReader: LineReader = {
  name: 'keine',
  async read() {
    return null;
  },
};

/** Findet Textzeilen in einem Bildbereich (Kästen in Bildschirm-Koordinaten). */
export interface TextDetector {
  readonly name: string;
  detect(img: Rgb, region: Box): Promise<Box[]>;
}

/** Ohne Detektion: Das Panel wird an der Standard-Stelle gelesen (feste Suchfenster). */
export const noDetector: TextDetector = {
  name: 'keine',
  async detect() {
    return [];
  },
};
