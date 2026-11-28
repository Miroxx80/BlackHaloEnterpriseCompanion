/**
 * Lage der HUD-Elemente im Mining-Modus der Prospector bei 1920x1080 (englisches HUD), vermessen an
 * test/fixtures/hud/*.webp. Das Scan-Panel steht aber NICHT fest: Im PC-Test vom 2026-11-26 lag es bis zu
 * ~100 px tiefer und ~15 px weiter rechts. Deshalb sucht die Detektion die Beschriftungen (Anker) im Bereich
 * `search`, und alle übrigen Kästen werden um denselben Versatz verschoben.
 * Außerdem hängt die Größe des HUD am Sichtfeld (FOV): Bei FOV 100 ist das Panel nur ~0,865x so groß wie bei FOV 86
 * (gemessen an 17 Scans; passt zu Maßstab ~ 86 / FOV) und rückt zur Bildmitte. Die Maße hier gelten für FOV 86
 * (Maßstab 1); bei anderem Maßstab wird der Bereich `rescaled` auf diesen Maßstab umgerechnet (pipeline.ts).
 * Boxen: [links, oben, Breite, Höhe] in Pixeln.
 */
export type Box = [number, number, number, number];

/** Beschriftungen im Panel, an denen es gefunden wird. */
export const PANEL_LABELS = { results: 'RESULTS', mass: 'MASS', res: 'RES', inst: 'INST', comp: 'COMP' } as const;
export type PanelLabel = keyof typeof PANEL_LABELS;

export interface HudLayout {
  id: string;
  /** Hier wird zuerst nach dem Panel gesucht (Detektion). Bei FOV 86 steht es immer darin. */
  search: Box;
  /**
   * Erweiterter Suchbereich für andere HUD-Maßstäbe (wenn in `search` nichts gefunden wird). Wird als Beispielbild
   * gespeichert (enthält `search`).
   */
  wide: Box;
  /**
   * Bei anderem HUD-Maßstab: Dieser Bereich (Standard-Lage) wird aus dem Bild auf Maßstab 1 umgerechnet und erneut
   * durchsucht. Enthält das ganze Panel mit 8 Zeilen und etwas Rand.
   */
  rescaled: Box;
  /** Linke obere Ecke der Beschriftungen bei Versatz 0 (so wie die Detektion sie findet). */
  anchors: Record<PanelLabel, [number, number]>;
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
  search: [1184, 392, 576, 608],
  // Panel bei Maßstab 0,55..1,35 um die Bildmitte (960,540) plus Versatz wie gemessen (seitlich ~±20, senkrecht
  // -30..+120). Links um 32 px erweitert, damit die Detektion in `search` dasselbe Raster hat.
  wide: [1152, 392, 640, 640],
  rescaled: [1312, 448, 288, 384],
  anchors: { results: [1368, 480], mass: [1364, 529], res: [1365, 549], inst: [1365, 569], comp: [1366, 621] },
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


/**
 * Größen gespeicherter Beispielbilder (ocr-samples): aktueller Suchbereich zuerst, dann frühere Versionen.
 * Zum Zurücksetzen an die richtige Stelle (scripts/ocr-eval.mjs, Tests); erkannt an Breite und Höhe.
 */
export const SAVED_CROPS: Box[] = [PROSPECTOR_1080.wide, PROSPECTOR_1080.search, PROSPECTOR_1080.panel];
