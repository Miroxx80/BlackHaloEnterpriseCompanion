import { app, Notification } from 'electron';
import { EventEmitter } from 'node:events';
import type { LogFile } from './log.js';
import type { UpdateState } from '../core/types.js';

/**
 * Updates über GitHub Releases (öffentliches Repo) mit electron-updater. Nichts passiert ungefragt:
 * - beim Start (nur installierte Version) einmal nachsehen und melden, wenn es eine neue Version gibt
 * - Herunterladen und Installieren erst auf Knopfdruck (Tray, Fenster oder Handy), danach Neustart
 * Der Release braucht neben dem Installer die Dateien latest.yml und *.blockmap (macht npm run dist).
 */
export class Updater extends EventEmitter {
  state: UpdateState = { status: 'idle', current: app.getVersion() };
  private updater: typeof import('electron-updater').autoUpdater | null = null;
  private loading: Promise<void> | null = null;

  constructor(private readonly log: LogFile) {
    super();
  }

  private set(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch, current: app.getVersion() };
    this.emit('state', this.state);
  }

  /** Fehler kurz und verständlich anzeigen, die volle Meldung steht im Log. */
  private fail(err: unknown) {
    const raw = (err as Error)?.message ?? String(err);
    this.log.line('ERROR', `Update: ${raw}`);
    this.set({ status: 'error', error: shortError(raw) });
  }

  /** electron-updater erst bei Bedarf laden (nur in der installierten Version sinnvoll). */
  private async init() {
    if (!app.isPackaged) {
      this.set({ status: 'unsupported', error: 'Updates gibt es nur in der installierten Version.' });
      return null;
    }
    this.loading ??= (async () => {
      // CommonJS-Paket: autoUpdater ist ein Getter, den Node beim import() nicht als benannten Export erkennt.
      // Er hängt am Default-Export (module.exports).
      const mod = await import('electron-updater');
      const autoUpdater = mod.autoUpdater ?? (mod.default as unknown as typeof mod).autoUpdater;
      if (!autoUpdater) throw new Error('electron-updater nicht geladen');
      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = false;
      autoUpdater.logger = { info: (m: unknown) => this.log.line('INFO', `Update: ${m}`), warn: (m: unknown) => this.log.line('WARN', `Update: ${m}`), error: (m: unknown) => this.log.line('ERROR', `Update: ${m}`), debug: () => {} };
      autoUpdater.on('checking-for-update', () => this.set({ status: 'checking', error: undefined }));
      autoUpdater.on('update-available', (info) => this.set({ status: 'available', latest: info.version, notes: notesOf(info.releaseNotes) }));
      autoUpdater.on('update-not-available', (info) => this.set({ status: 'none', latest: info.version }));
      autoUpdater.on('download-progress', (p) => this.set({ status: 'downloading', progress: Math.round(p.percent) }));
      autoUpdater.on('update-downloaded', (info) => {
        this.set({ status: 'ready', latest: info.version, progress: 100 });
        this.log.line('INFO', `Update ${info.version} geladen, installiere und starte neu`);
        // Installer läuft still (Installation pro Benutzer) und startet die App danach wieder
        setImmediate(() => autoUpdater.quitAndInstall(true, true));
      });
      autoUpdater.on('error', (err) => this.fail(err));
      this.updater = autoUpdater;
    })();
    try {
      await this.loading;
    } catch (err) {
      // Beim nächsten Versuch neu laden
      this.loading = null;
      this.fail(err);
      return null;
    }
    return this.updater;
  }

  /** Nach neuer Version sehen. notify: bei Fund eine Windows-Benachrichtigung zeigen (Start-Prüfung). */
  async check(notify = false) {
    const u = await this.init();
    if (!u) return this.state;
    try {
      await u.checkForUpdates();
      if (notify && this.state.status === 'available' && Notification.isSupported()) {
        new Notification({ title: 'Black Halo: Update verfügbar', body: `Version ${this.state.latest} ist da. Installieren über das Tray-Menü oder in der App (Status).` }).show();
      }
    } catch (err) {
      this.fail(err);
    }
    return this.state;
  }

  /** Neue Version herunterladen und installieren (App startet danach neu). */
  async install() {
    const u = await this.init();
    if (!u) return this.state;
    if (this.state.status !== 'available') await this.check();
    if (this.state.status !== 'available') return this.state;
    this.set({ status: 'downloading', progress: 0 });
    u.downloadUpdate().catch((err: unknown) => this.fail(err));
    return this.state;
  }
}

function notesOf(notes: unknown): string | undefined {
  if (typeof notes === 'string') return notes.replace(/<[^>]+>/g, '').trim().slice(0, 2000) || undefined;
  if (Array.isArray(notes)) return notes.map((n) => (n as { note?: string }).note ?? '').join('\n').replace(/<[^>]+>/g, '').trim().slice(0, 2000) || undefined;
  return undefined;
}

/** Häufige Fehler übersetzen, sonst nur die erste Zeile (electron-updater hängt Header und Stacktrace an). */
export function shortError(raw: string): string {
  const missing = /Cannot find (\S+) in the latest release artifacts/.exec(raw);
  if (missing) return `Im neuesten Release auf GitHub fehlt die Datei ${missing[1]}. Beim Release alle drei Dateien aus release\\ hochladen (Setup-.exe, .blockmap, latest.yml).`;
  if (/HttpError: 404|status maybe not reported, but 404/.test(raw)) return 'GitHub meldet 404: Releases nicht erreichbar (Repo privat?) oder Datei fehlt.';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ERR_INTERNET_DISCONNECTED|net::ERR_/.test(raw)) return 'GitHub nicht erreichbar. Internetverbindung prüfen.';
  if (/sha512 checksum mismatch/i.test(raw)) return 'Download beschädigt (Prüfsumme passt nicht). Bitte nochmal versuchen.';
  const first = raw.split('\n')[0].trim();
  return first.length > 200 ? `${first.slice(0, 200)}…` : first;
}
