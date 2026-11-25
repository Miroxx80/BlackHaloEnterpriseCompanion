import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron';
import type { ServerState } from './supervisor.js';

export interface TrayState {
  server: ServerState;
  port?: number;
  error?: string;
  alwaysOnTop: boolean;
  autostart: boolean;
  /** Autostart nur in der installierten Version (im Entwicklungsmodus würde electron.exe eingetragen). */
  autostartAvailable: boolean;
}

export interface TrayActions {
  openWindow(): void;
  openPairing(): void;
  toggleAlwaysOnTop(value: boolean): void;
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
