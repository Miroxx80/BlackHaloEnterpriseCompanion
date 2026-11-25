import { BrowserWindow, ipcMain, screen, shell, type Rectangle } from 'electron';
import type { LogFile } from './log.js';
import type { SettingsStore, WindowBounds } from './settings.js';

const DEFAULT_SIZE = { width: 1100, height: 760 };
const MIN_VISIBLE = { width: 120, height: 60 };
const BG = '#0b1020';

function page(title: string, text: string) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const html = `<!doctype html><meta charset="utf-8"><title>Black Halo</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:${BG};color:#e6e9f5;font:16px system-ui,'Segoe UI',sans-serif">
<div style="text-align:center;max-width:520px;padding:16px"><h2 style="color:#f2a93b">${esc(title)}</h2><p>${esc(text)}</p></div>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

/** Ist genug vom Fenster auf irgendeinem Bildschirm sichtbar? (Bildschirm abgesteckt, Auflösung geändert ...) */
function isVisibleOnSomeDisplay(b: Rectangle): boolean {
  return screen.getAllDisplays().some(({ workArea: w }) => {
    const width = Math.min(b.x + b.width, w.x + w.width) - Math.max(b.x, w.x);
    const height = Math.min(b.y + b.height, w.y + w.height) - Math.max(b.y, w.y);
    return width >= MIN_VISIBLE.width && height >= MIN_VISIBLE.height;
  });
}

interface Options {
  preload: string;
  icon: string;
  settings: SettingsStore;
  log: LogFile;
  devTools: boolean;
}

/**
 * Das Hauptfenster. Wird beim Schließen wirklich beendet (nicht nur versteckt), damit neben dem Spiel
 * kein Speicher belegt bleibt. Der Server läuft unabhängig davon weiter.
 */
export class MainWindow {
  private win: BrowserWindow | null = null;
  private url: string | null = null;
  private status = page('Black Halo', 'Server startet ...');
  private saveTimer: NodeJS.Timeout | null = null;
  /** Modul, das nach dem Laden angezeigt werden soll (z. B. Tray "Gerät verbinden"). */
  private pendingHash: string | null = null;
  /** true, sobald die echte Oberfläche geladen ist. Danach verbindet sich die Shell selbst neu. */
  private showingShell = false;

  constructor(private readonly opts: Options) {
    ipcMain.on('bh:set-focusable', (e, value: unknown) => {
      if (!this.win || e.sender !== this.win.webContents || typeof value !== 'boolean') return;
      if (this.win.isFocusable() !== value) this.win.setFocusable(value);
    });
  }

  get isOpen() {
    return !!this.win;
  }

  /** Server ist bereit: echte Oberfläche laden. */
  setServerUrl(url: string) {
    const changed = url !== this.url;
    this.url = url;
    if (this.win && (changed || !this.showingShell)) void this.load();
  }

  /** Server ist (dauerhaft) nicht verfügbar: Hinweis statt Oberfläche zeigen. */
  setServerUnavailable(text: string) {
    this.url = null;
    this.showingShell = false;
    this.status = page('Server nicht verfügbar', text);
    if (this.win) void this.load();
  }

  setAlwaysOnTop(value: boolean) {
    this.win?.setAlwaysOnTop(value);
  }

  /** Öffnet das Fenster (oder holt es nach vorn). hash wählt ein Modul, z. B. "pairing". */
  show(hash?: string) {
    if (!this.win) this.create();
    const win = this.win!;
    if (hash && this.showingShell) {
      void win.webContents.executeJavaScript(`location.hash = ${JSON.stringify(hash)}`).catch(() => {});
    } else if (hash) {
      this.pendingHash = hash;
    }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  close() {
    this.win?.close();
  }

  private create() {
    const saved = this.opts.settings.get().window;
    const bounds: Partial<WindowBounds> =
      saved && isVisibleOnSomeDisplay(saved) ? saved : { ...DEFAULT_SIZE }; // ohne x/y: zentriert auf dem Hauptbildschirm

    const win = new BrowserWindow({
      ...bounds,
      minWidth: 360,
      minHeight: 300,
      show: false,
      backgroundColor: BG,
      icon: this.opts.icon,
      title: 'Black Halo',
      alwaysOnTop: this.opts.settings.get().alwaysOnTop,
      autoHideMenuBar: true,
      webPreferences: {
        preload: this.opts.preload,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        devTools: this.opts.devTools,
      },
    });
    this.win = win;
    if (saved?.maximized && bounds === saved) win.maximize();

    win.once('ready-to-show', () => win.show());
    win.on('resize', () => this.scheduleSave());
    win.on('move', () => this.scheduleSave());
    win.on('close', () => this.saveBounds());
    win.on('closed', () => {
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.win = null;
      this.showingShell = false;
    });

    const wc = win.webContents;
    // Nur die eigene Oberfläche im Fenster. Links nach außen gehen in den normalen Browser.
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    wc.on('will-navigate', (e, url) => {
      if (this.url && new URL(url).origin === new URL(this.url).origin) return;
      e.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    });
    wc.on('render-process-gone', (_e, d) => {
      this.opts.log.line('ERROR', `Fensterinhalt abgestürzt (${d.reason}), lade neu`);
      if (this.win) void this.load();
    });
    if (this.opts.devTools) {
      wc.on('before-input-event', (_e, input) => {
        if (input.type === 'keyDown' && input.key === 'F12') wc.toggleDevTools();
      });
    }

    void this.load();
  }

  private async load() {
    const win = this.win;
    if (!win) return;
    // Nach einem Modulwechsel per Tray ("Gerät verbinden") direkt dort landen
    const hash = this.pendingHash ? '#' + this.pendingHash : '';
    this.pendingHash = null;
    const url = this.url;
    this.showingShell = false;
    try {
      await win.loadURL(url ? url + hash : this.status);
      if (url && this.win === win) this.showingShell = true;
    } catch (err) {
      // z. B. Server gerade im Neustart. Sobald er wieder bereit ist, lädt setServerUrl() neu.
      this.opts.log.line('WARN', `Oberfläche konnte nicht geladen werden: ${(err as Error).message}`);
      if (this.win === win) await win.loadURL(page('Black Halo', 'Verbinde mit dem Server ...')).catch(() => {});
    }
  }

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveBounds(), 500);
  }

  private saveBounds() {
    const win = this.win;
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    // Bei maximiertem Fenster die "normale" Größe merken, damit Wiederherstellen sinnvoll ist
    const b = win.getNormalBounds();
    this.opts.settings.update({ window: { ...b, maximized: win.isMaximized() } });
  }
}
