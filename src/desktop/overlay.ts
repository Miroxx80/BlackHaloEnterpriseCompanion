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
  private keepAlive: NodeJS.Timeout | null = null;
  private lastRebuild = 0;

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
      if (this.keepAlive) clearInterval(this.keepAlive);
      this.keepAlive = null;
    });
    // Selbstheilung (vorher half nur Aus/An im Tray): jede Ursache steht im Log, um sie später zuordnen zu können
    // 1. Darstellungsprozess abgestürzt oder hängt (z. B. Grafiktreiber-Reset): Fenster neu aufbauen
    win.webContents.on('render-process-gone', (_e, d) => this.rebuild(`Darstellung beendet (${d.reason})`));
    win.on('unresponsive', () => this.rebuild('Fenster reagiert nicht'));
    // 2. Seite nicht geladen (Server kurz weg): nach 2 s erneut laden statt leer zu bleiben
    win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      if (!isMainFrame) return;
      this.log.line('WARN', `Overlay: Laden fehlgeschlagen (${code} ${desc}), neuer Versuch in 2 s`);
      setTimeout(() => {
        if (this.win === win && this.url && !win.isDestroyed()) void win.loadURL(this.url).catch(() => {});
      }, 2000);
    });
    // 3. Andere Fenster (das Spiel) können sich davor schieben: regelmäßig wieder nach vorn, ohne Fokus
    win.on('always-on-top-changed', (_e, onTop) => {
      if (!onTop && !win.isDestroyed()) {
        this.log.line('WARN', 'Overlay: "immer im Vordergrund" verloren, wieder gesetzt');
        win.setAlwaysOnTop(true, 'screen-saver');
      }
    });
    this.keepAlive = setInterval(() => {
      if (win.isDestroyed()) return;
      win.setAlwaysOnTop(true, 'screen-saver');
      if (!win.isVisible()) {
        this.log.line('WARN', 'Overlay: Fenster war unsichtbar, wieder gezeigt');
        win.showInactive();
      }
    }, 5000);
    if (this.url) void win.loadURL(this.url).catch(() => {});
    this.log.line('INFO', `Overlay an (${bounds.width}x${bounds.height})`);
  }

  /** Fenster verwerfen und neu bauen (höchstens einmal pro 10 s, falls es dauerhaft scheitert). */
  private rebuild(reason: string) {
    if (!this.win) return;
    const now = Date.now();
    if (now - this.lastRebuild < 10_000) {
      this.log.line('ERROR', `Overlay: ${reason}, wiederholt; erst in ein paar Sekunden neuer Versuch`);
      setTimeout(() => this.rebuild(reason), 10_000 - (now - this.lastRebuild));
      return;
    }
    this.lastRebuild = now;
    this.log.line('WARN', `Overlay: ${reason}, baue Fenster neu auf`);
    this.hide();
    this.show();
  }

  hide() {
    if (!this.win) return;
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.keepAlive = null;
    this.win.destroy();
    this.win = null;
    this.log.line('INFO', 'Overlay aus');
  }
}
