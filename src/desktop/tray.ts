import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron';
import type { ServerState } from './supervisor.js';
import type { UpdateState } from '../core/types.js';

export interface TrayState {
  server: ServerState;
  port?: number;
  error?: string;
  alwaysOnTop: boolean;
  autostart: boolean;
  /** Autostart nur in der installierten Version (im Entwicklungsmodus würde electron.exe eingetragen). */
  autostartAvailable: boolean;
  /** Tastenkürzel für "Scan einlesen", leer wenn aus oder nicht belegbar. */
  ocrHotkey: string;
  overlay: boolean;
  update: UpdateState;
  /** Updates nur in der installierten Version. */
  updatesAvailable: boolean;
}

export interface TrayActions {
  openWindow(): void;
  openPairing(): void;
  readScan(): void;
  toggleAlwaysOnTop(value: boolean): void;
  toggleOverlay(value: boolean): void;
  checkUpdate(): void;
  installUpdate(): void;
  toggleAutostart(value: boolean): void;
  restartServer(): void;
  openLogs(): void;
  openConfig(): void;
  quit(): void;
}

const LABELS: Record<ServerState, string> = {
  starting: 'Server startet ...',
  running: 'Server läuft',
  restarting: 'Server startet neu ...',
  failed: 'Server gestoppt (Fehler)',
  stopped: 'Server gestoppt',
};

export function createTray(iconPath: string, actions: TrayActions) {
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16, quality: 'best' });
  const tray = new Tray(icon);
  // Linksklick öffnet das Fenster, Rechtsklick das Menü (Windows-Standard)
  tray.on('click', () => actions.openWindow());

  function update(s: TrayState) {
    const status = s.server === 'running' && s.port ? `${LABELS[s.server]} (Port ${s.port})` : LABELS[s.server];
    tray.setToolTip(`Black Halo: ${status}`);

    const items: MenuItemConstructorOptions[] = [
      { label: status, enabled: false },
      ...(s.error && s.server !== 'running'
        ? [{ label: s.error.length > 80 ? s.error.slice(0, 77) + '...' : s.error, enabled: false }]
        : []),
      { type: 'separator' },
      { label: 'Fenster öffnen', click: actions.openWindow },
      { label: 'Gerät verbinden ...', click: actions.openPairing, enabled: s.server === 'running' },
      {
        label: s.ocrHotkey ? `Scan einlesen (${s.ocrHotkey})` : 'Scan einlesen',
        click: actions.readScan,
        enabled: s.server === 'running',
      },
      {
        label: 'Overlay über dem Spiel',
        type: 'checkbox',
        checked: s.overlay,
        enabled: s.server === 'running',
        click: (item) => actions.toggleOverlay(item.checked),
      },
      { type: 'separator' },
      {
        label: 'Immer im Vordergrund',
        type: 'checkbox',
        checked: s.alwaysOnTop,
        click: (item) => actions.toggleAlwaysOnTop(item.checked),
      },
      {
        label: s.autostartAvailable ? 'Mit Windows starten' : 'Mit Windows starten (nur installierte Version)',
        type: 'checkbox',
        checked: s.autostart,
        enabled: s.autostartAvailable,
        click: (item) => actions.toggleAutostart(item.checked),
      },
      { type: 'separator' },
      updateItem(s, actions),
      { type: 'separator' },
      { label: 'Server neu starten', click: actions.restartServer },
      { label: 'Log-Ordner öffnen', click: actions.openLogs },
      { label: 'Config-Ordner öffnen', click: actions.openConfig },
      { type: 'separator' },
      { label: 'Beenden', click: actions.quit },
    ];
    tray.setContextMenu(Menu.buildFromTemplate(items));
  }

  return { update, destroy: () => tray.destroy() };
}

/** Menüpunkt für Updates je nach Stand. */
function updateItem(s: TrayState, actions: TrayActions): MenuItemConstructorOptions {
  const u = s.update;
  if (!s.updatesAvailable) return { label: 'Nach Updates suchen (nur installierte Version)', enabled: false };
  if (u.status === 'available') return { label: `Update auf v${u.latest} installieren`, click: actions.installUpdate };
  if (u.status === 'downloading') return { label: `Update wird geladen (${u.progress ?? 0} %) ...`, enabled: false };
  if (u.status === 'ready') return { label: 'Update wird installiert ...', enabled: false };
  if (u.status === 'checking') return { label: 'Suche nach Updates ...', enabled: false };
  const hint = u.status === 'none' ? ' (aktuell)' : u.status === 'error' ? ' (Fehler, erneut versuchen)' : '';
  return { label: `Nach Updates suchen${hint}`, click: actions.checkUpdate };
}
