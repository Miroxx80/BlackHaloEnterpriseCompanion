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
  mass: Box;
  resistance: Box;
  instability: Box;
  /** Nur die Zahl vor "SCU" in der COMP.-Zeile. */
  scu: Box;
  /** Zusammensetzung: erste Zeile, Abstand, Spalten (Anteil, Erz, Qualität). */
  rows: { top: number; step: number; height: number; max: number; pct: [number, number]; ore: [number, number]; quality: [number, number] };
}

export const PROSPECTOR_1080: HudLayout = {
  id: 'prospector-1920x1080',
  width: 1920,
  height: 1080,
  panel: [1355, 475, 200, 265],
  title: [1365, 508, 110, 16],
  mass: [1450, 527, 70, 18],
  resistance: [1450, 546, 70, 18],
  instability: [1450, 566, 70, 18],
  scu: [1478, 619, 40, 18],
  rows: { top: 656, step: 15, height: 14, max: 8, pct: [1364, 48], ore: [1412, 92], quality: [1505, 42] },
};
