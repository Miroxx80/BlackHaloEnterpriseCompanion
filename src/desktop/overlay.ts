import { BrowserWindow, screen } from 'electron';
import type { LogFile } from './log.js';

/**
 * Overlay über dem Spiel: eigenes, durchsichtiges Fenster über dem Hauptbildschirm. Kein Eingriff ins Spiel
 * (kein DirectX-Hook, kein Einschleusen), nur Anzeige. Funktioniert, wenn Star Citizen als "Randloses Fenster" läuft.
 * - durchklickbar und ohne Fokus: Maus und Tastatur bleiben beim Spiel
 * - von Bildschirmaufnahmen ausgenommen (setContentProtection): die eigene OCR liest es nicht mit
 * - lädt /modules/mining/overlay.html vom lokalen Server, ein Client wie das Handy
 */
export class OverlayWindow {
  private win: BrowserWindow | null = null;
  private url: string | null = null;

  constructor(private readonly log: LogFile) {}

  setServer(port: number, token: string) {
    const q = token ? `?token=${encodeURIComponent(token)}` : '';
    this.url = `http://127.0.0.1:${port}/modules/mining/overlay.html${q}`;
    if (this.win) void this.win.loadURL(this.url).catch(() => {});
  }

  get visible() {
    return Boolean(this.win);
  }

  show() {
    if (this.win) return;
    const { bounds } = screen.getPrimaryDisplay();
    const win = new BrowserWindow({
      ...bounds,
      transparent: true,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, devTools: false },
    });
    this.win = win;
    // Über dem Spiel (auch über Vollbild-Fenstern), Maus geht durch
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(true);
    win.setContentProtection(true);
    win.setVisibleOnAllWorkspaces(true);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.once('ready-to-show', () => win.showInactive());
    win.on('closed', () => {
      if (this.win === win) this.win = null;
    });
    if (this.url) void win.loadURL(this.url).catch(() => {});
    this.log.line('INFO', `Overlay an (${bounds.width}x${bounds.height})`);
  }

  hide() {
    if (!this.win) return;
    this.win.destroy();
    this.win = null;
    this.log.line('INFO', 'Overlay aus');
  }
}
