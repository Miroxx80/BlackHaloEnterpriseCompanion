import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

/** Einstellungen der Desktop-App selbst (nicht des Servers). Liegt in desktop.json im Nutzerordner. */
export interface DesktopSettings {
  window?: WindowBounds;
  alwaysOnTop: boolean;
  /** Tastenkürzel für "Scan einlesen" (Electron-Schreibweise, z. B. "Alt+Shift+S"); leer = aus. */
  ocrHotkey: string;
  /** Overlay-Fenster über dem Spiel (Deutung der Radar-Signaturen). Ein/aus auch vom Handy aus. */
  overlay: boolean;
}

const DEFAULTS: DesktopSettings = { alwaysOnTop: false, ocrHotkey: 'Alt+Shift+S', overlay: false };

function isBounds(v: unknown): v is WindowBounds {
  const b = v as WindowBounds;
  return (
    !!b &&
    [b.x, b.y, b.width, b.height].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    typeof b.maximized === 'boolean'
  );
}

export function createSettingsStore(file: string) {
  let data: DesktopSettings = { ...DEFAULTS };
  if (existsSync(file)) {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      data = {
        alwaysOnTop: raw.alwaysOnTop === true,
        ocrHotkey: typeof raw.ocrHotkey === 'string' ? raw.ocrHotkey : DEFAULTS.ocrHotkey,
        overlay: raw.overlay === true,
        window: isBounds(raw.window) ? raw.window : undefined,
      };
    } catch {
      // Kaputte Datei: mit Standardwerten weitermachen, sie wird beim nächsten Speichern ersetzt
    }
  }

  return {
    get: () => data,
    update(patch: Partial<DesktopSettings>) {
      data = { ...data, ...patch };
      try {
        mkdirSync(dirname(file), { recursive: true });
        // Erst in eine Temp-Datei schreiben, dann umbenennen: kein halb geschriebenes JSON bei Absturz
        writeFileSync(file + '.tmp', JSON.stringify(data, null, 2));
        renameSync(file + '.tmp', file);
      } catch {
        // Einstellungen sind Komfort; Fehler beim Speichern dürfen nichts stoppen
      }
    },
  };
}

export type SettingsStore = ReturnType<typeof createSettingsStore>;
