import { desktopCapturer, Notification, screen } from 'electron';
import type { LogFile } from './log.js';

/** Screenshot des Hauptbildschirms (dort läuft das Spiel) als PNG in 1920x1080, optional nur ein Ausschnitt. */
export async function captureScreen(region?: { x: number; y: number; width: number; height: number }): Promise<Buffer> {
  const primary = screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } });
  const source = sources.find((s) => s.display_id === String(primary.id)) ?? sources[0];
  if (!source || source.thumbnail.isEmpty()) throw new Error('Keine Bildschirmaufnahme möglich');
  const image = source.thumbnail.getSize().width === 1920 ? source.thumbnail : source.thumbnail.resize({ width: 1920, height: 1080 });
  return (region ? image.crop(region) : image).toPNG();
}

/**
 * Tray/Hotkey -> Screenshot des Hauptbildschirms -> OCR auf dem lokalen Server (Ergebnis landet im gemeinsamen Scan,
 * also sofort auch auf Handy und zweitem Bildschirm). Nur Bildschirmaufnahme über Windows, kein Eingriff ins Spiel.
 */
export async function captureAndRead(server: { port: number; token: string } | null, log: LogFile): Promise<void> {
  const notify = (title: string, body: string) => {
    if (Notification.isSupported()) new Notification({ title, body, silent: true }).show();
  };
  if (!server) {
    notify('Black Halo', 'Server läuft noch nicht.');
    return;
  }
  try {
    const t0 = Date.now();
    const png = await captureScreen();
    const res = await fetch(`http://127.0.0.1:${server.port}/api/mining/ocr?apply=1`, {
      method: 'POST',
      headers: { 'content-type': 'image/png', ...(server.token ? { 'x-bh-token': server.token } : {}) },
      body: new Uint8Array(png),
    });
    const result = (await res.json()) as { error?: string; panelFound?: boolean; marks?: object; notes?: string[] };
    if (!res.ok) throw new Error(result.error ?? `HTTP ${res.status}`);
    const checks = Object.keys(result.marks ?? {}).length;
    log.line('INFO', `Scan per Hotkey gelesen (${Date.now() - t0} ms), Panel ${result.panelFound ? 'gefunden' : 'nicht gefunden'}`);
    if (!result.panelFound) notify('Kein Scan gefunden', 'Das Scan-Panel war nicht an der erwarteten Stelle (Mining-Modus, Prospector, 1920x1080).');
    else notify('Scan gelesen', checks ? `${checks} Feld(er) bitte prüfen.` : 'Werte übernommen.');
  } catch (err) {
    log.line('ERROR', `Scan per Hotkey fehlgeschlagen: ${(err as Error).message}`);
    notify('Scan fehlgeschlagen', (err as Error).message);
  }
}
