/**
 * Lage der HUD-Elemente im Mining-Modus der Prospector bei 1920x1080 (englisches HUD).
 * Das HUD ist fest am Laser-Mittelpunkt zentriert und steht beim Minen immer an derselben Stelle
 * (bestätigt von der Org-Leitung, vermessen an test/fixtures/hud/*.webp).
 * Boxen: [links, oben, Breite, Höhe] in Pixeln.
 */
export type Box = [number, number, number, number];

export interface HudLayout {
  id: string;
  width: number;
  height: number;
  /** Ganzes Scan-Panel (für Beispielbilder und die Prüfung, ob das Panel überhaupt da ist). */
  panel: Box;
  /** Erzname in der Titelzeile, z. B. "HEPH (RAW)". */
  title: Box;
  /** Suchfenster für die Werte (die Zeile wird darin gesucht, weil das Panel um einige Pixel wandern kann). */
  mass: Box;
  resistance: Box;
  instability: Box;
  /** "x.xx SCU" in der COMP.-Zeile. */
  scu: Box;
  /** Zusammensetzung: Suchfenster der ersten Zeile, folgende Zeilen direkt darunter. */
  rows: { x: number; width: number; firstTop: number; firstHeight: number; nextHeight: number; max: number };
}

export const PROSPECTOR_1080: HudLayout = {
  id: 'prospector-1920x1080',
  width: 1920,
  height: 1080,
  panel: [1355, 475, 200, 265],
  title: [1365, 508, 110, 16],
  mass: [1445, 524, 85, 22],
  resistance: [1445, 545, 85, 20],
  instability: [1445, 565, 85, 20],
  scu: [1470, 615, 90, 22],
  rows: { x: 1358, width: 195, firstTop: 655, firstHeight: 20, nextHeight: 15, max: 8 },
};
