/**
 * Stellt sicher, dass das Zielfenster (Star Citizen) im Vordergrund ist, bevor Tasten gesendet werden.
 * Plattformunabhängig: Die Windows-Funktionen kommen über WindowApi herein (testbar mit Attrappen).
 */

export type Hwnd = bigint;

export interface WindowApi {
  foreground(): Hwnd;
  /** Prozessname (z. B. "StarCitizen.exe") zum Fenster, oder "" wenn unbekannt. */
  processName(hwnd: Hwnd): string;
  /** Sichtbare Hauptfenster (keine Kind- oder Werkzeugfenster). */
  topLevelWindows(): Hwnd[];
  isMinimized(hwnd: Hwnd): boolean;
  restore(hwnd: Hwnd): void;
  setForeground(hwnd: Hwnd): boolean;
  /**
   * Windows lässt nur den Vordergrund-Prozess ein anderes Fenster nach vorn holen. Ein kurzer
   * Alt-Druck gilt als Benutzereingabe und hebt diese Sperre auf (bekannter, harmloser Weg).
   */
  unlockForeground(): void;
  sleep(ms: number): Promise<void>;
}

export interface Target {
  /** Prozessname des Spiels, Groß-/Kleinschreibung egal. Für Tests z. B. "notepad.exe". */
  process: string;
}

export interface ForegroundOptions {
  /** Wie lange auf den Fensterwechsel gewartet wird. */
  timeoutMs: number;
  /** Pause nach einem Wechsel, bis das Spiel die Tastatur wieder annimmt. */
  settleMs: number;
}

export const DEFAULT_FOREGROUND: ForegroundOptions = { timeoutMs: 600, settleMs: 150 };

/** Fehler, die dem Nutzer direkt angezeigt werden können. */
export class TargetError extends Error {
  constructor(
    message: string,
    readonly code: 'not-running' | 'not-foreground',
  ) {
    super(message);
    this.name = 'TargetError';
  }
}

export async function ensureForeground(api: WindowApi, target: Target, opts: ForegroundOptions): Promise<void> {
  const wanted = target.process.toLowerCase();
  const matches = (hwnd: Hwnd) => api.processName(hwnd).toLowerCase() === wanted;

  if (matches(api.foreground())) return; // Normalfall vom Tablet aus: Spiel ist schon vorn

  const hwnd = api.topLevelWindows().find(matches);
  if (hwnd === undefined) {
    throw new TargetError(`${target.process} läuft nicht (kein Fenster gefunden)`, 'not-running');
  }

  if (api.isMinimized(hwnd)) api.restore(hwnd);
  if (!(await tryActivate(api, hwnd, opts.timeoutMs / 2))) {
    api.unlockForeground();
    if (!(await tryActivate(api, hwnd, opts.timeoutMs / 2))) {
      throw new TargetError(
        `${target.process} konnte nicht in den Vordergrund geholt werden. Es wurde nichts gesendet.`,
        'not-foreground',
      );
    }
  }
  await api.sleep(opts.settleMs);
}

async function tryActivate(api: WindowApi, hwnd: Hwnd, timeoutMs: number): Promise<boolean> {
  api.setForeground(hwnd);
  const step = 20;
  for (let waited = 0; waited <= timeoutMs; waited += step) {
    if (api.foreground() === hwnd) return true;
    await api.sleep(step);
  }
  return false;
}
