// Einstieg der Desktop-App (Electron-Hauptprozess): Tray, Fenster, Server-Prozess.
// Der Hub und der reine Browser-Betrieb nutzen weiterhin src/main.ts ohne Electron.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, Menu, shell } from 'electron';
import { createLogFile } from './log.js';
import { createSettingsStore } from './settings.js';
import { ServerSupervisor } from './supervisor.js';
import { createTray, type TrayState } from './tray.js';
import { MainWindow } from './window.js';

const here = dirname(fileURLToPath(import.meta.url)); // dist/desktop
const rootDir = join(here, '..', '..');

// Nutzerordner: %APPDATA%\BlackHalo (Config, Daten, Logs). BH_USER_DIR überschreibt (Tests, Entwicklung).
const userDir = process.env.BH_USER_DIR || join(app.getPath('appData'), 'BlackHalo');
app.setPath('userData', userDir);
mkdirSync(join(userDir, 'config'), { recursive: true });

const AUTOSTART_ARGS = ['--hidden'];
const startHidden = process.argv.includes('--hidden');

if (!app.requestSingleInstanceLock()) {
  // Läuft schon: die laufende Instanz öffnet ihr Fenster (second-instance), diese hier beendet sich.
  app.quit();
} else {
  const log = createLogFile(join(userDir, 'logs'));
  log.line('INFO', `Start (Version ${app.getVersion()}, Nutzerordner ${userDir})`);

  const settings = createSettingsStore(join(userDir, 'desktop.json'));
  const supervisor = new ServerSupervisor(join(here, 'serverEntry.js'), userDir, log);
  const icon = join(rootDir, 'assets', 'icon.png');
  const window = new MainWindow({
    icon,
    settings,
    log,
    devTools: !app.isPackaged,
  });

  const autostart = () =>
    app.isPackaged && app.getLoginItemSettings({ args: AUTOSTART_ARGS }).openAtLogin;

  let tray: ReturnType<typeof createTray> | null = null;
  const refreshTray = () => {
    const s: TrayState = {
      server: supervisor.state,
      port: supervisor.info?.port,
      error: supervisor.lastError || undefined,
      alwaysOnTop: settings.get().alwaysOnTop,
      autostart: autostart(),
      autostartAvailable: app.isPackaged,
    };
    tray?.update(s);
  };

  supervisor.on('ready', (info) => {
    const q = info.token ? `?token=${encodeURIComponent(info.token)}` : '';
    window.setServerUrl(`http://127.0.0.1:${info.port}/${q}`);
  });
  supervisor.on('state', (state) => {
    if (state === 'failed') {
      window.setServerUnavailable(
        `${supervisor.lastError || 'Unbekannter Fehler'}. Über das Tray-Menü kannst du den Server neu starten ` +
          `oder den Log-Ordner öffnen.`,
      );
    }
    refreshTray();
  });

  let quitting = false;
  const quit = async () => {
    if (quitting) return;
    quitting = true;
    log.line('INFO', 'Beende ...');
    window.close();
    tray?.destroy();
    tray = null; // refreshTray() darf das zerstörte Tray nicht mehr anfassen
    await supervisor.stop();
    await log.close();
    app.exit(0);
  };

  app.on('second-instance', () => window.show());
  // Alle Fenster zu heißt nicht beenden: Die App lebt im Tray weiter.
  app.on('window-all-closed', () => {});
  app.on('before-quit', (e) => {
    if (quitting) return;
    e.preventDefault(); // z. B. Windows-Abmeldung: erst den Server sauber stoppen
    void quit();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    tray = createTray(icon, {
      openWindow: () => window.show(),
      openPairing: () => window.show('pairing'),
      toggleAlwaysOnTop: (value) => {
        settings.update({ alwaysOnTop: value });
        window.setAlwaysOnTop(value);
        refreshTray();
      },
      toggleAutostart: (value) => {
        if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: value, args: AUTOSTART_ARGS });
        refreshTray();
      },
      restartServer: () => void supervisor.restart(),
      openLogs: () => void shell.openPath(join(userDir, 'logs')),
      openConfig: () => void shell.openPath(join(userDir, 'config')),
      quit: () => void quit(),
    });
    supervisor.start();
    refreshTray();
    if (!startHidden) window.show();
  });
}
