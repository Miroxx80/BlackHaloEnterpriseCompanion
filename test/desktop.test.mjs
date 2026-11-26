// Ende-zu-Ende-Test der Desktop-App (Electron). Braucht Playwright und eine Anzeige
// (unter Linux z. B. "xvfb-run -a npm run test:desktop"). Ohne Playwright wird er übersprungen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let electron;
try {
  ({ _electron: electron } = createRequire(import.meta.url)('playwright'));
} catch {
  electron = null;
}

/** Fester freier Port: Nach einem Absturz startet der Server auf demselben Port neu (wie im echten Betrieb). */
const freePort = () =>
  new Promise((resolve) => {
    const srv = createServer().listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

const until = async (fn, what, ms = 15000) => {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* weiter versuchen */
    }
    if (Date.now() > end) throw new Error(`Timeout: ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

test('Desktop-App: Fenster, QR, Absturz-Neustart, Tray-Betrieb', { skip: !electron && 'playwright nicht installiert' }, async () => {
  const userDir = mkdtempSync(join(tmpdir(), 'bh-desktop-'));
  // Wie beim Windows-Test: Platzhalter aus der Anleitung als Schlüssel übernommen. Die App muss trotzdem laufen.
  mkdirSync(join(userDir, 'config'));
  writeFileSync(join(userDir, 'config', 'local.json'), JSON.stringify({ security: { token: '…bleibt wie es ist…' } }));
  const args = ['.'];
  if (process.getuid?.() === 0) args.push('--no-sandbox'); // nur im Container als root nötig
  const executablePath = createRequire(import.meta.url)('electron'); // Pfad zur electron-Binary aus diesem Projekt
  const app = await electron.launch({ executablePath, args, env: { ...process.env, BH_USER_DIR: userDir, BH_PORT: String(await freePort()) } });

  // Bei einem Fehlschlag: letzten Schritt und das Ende des App-Logs ausgeben (sporadische Fehler nachvollziehen)
  let step = 'Start';
  const mark = (name) => (step = name);
  try {
    const win = await app.firstWindow();
    // Verbindungsanzeige der Shell: Text der Kopf-/Seitenleiste ('Verbunden' / 'Getrennt')
    const isOnline = () => win.evaluate(() => document.querySelector('#conn .conn-state')?.textContent === 'Verbunden');
    await win.waitForSelector('nav a[data-id="pairing"]', { timeout: 15000 });
    await win.waitForSelector('.keys .key'); // Controls hat seine Buttons per REST geladen (Token im Header ok)

    mark('Token');
    // Token wurde erzeugt, gespeichert und aus der Adresszeile entfernt
    const local = JSON.parse(readFileSync(join(userDir, 'config', 'local.json'), 'utf8'));
    assert.ok(local.security.token.length >= 20);
    assert.ok(!win.url().includes('token='));
    const port = new URL(win.url()).port;
    const api = (path) => fetch(`http://127.0.0.1:${port}${path}`, { headers: { 'x-bh-token': local.security.token } });
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/modules`)).status, 401);

    mark('Fokus');
    // Fenster ist in allen Ansichten ein normales, fokussierbares Fenster
    await win.evaluate(() => (location.hash = 'controls'));
    await win.waitForSelector('.keys .key');
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocusable()), true);

    mark('QR');
    // QR-Code-Ansicht
    await win.evaluate(() => (location.hash = 'pairing'));
    await win.waitForSelector('.pair img, .view .note, .view .alert');

    mark('Aufnahme am PC');
    // Knopf "Am PC einlesen": Server bittet die Desktop-App um einen Screenshot, liest ihn (hier ohne Spiel: kein Panel)
    const capInfo = await (await api('/api/mining/ocr')).json();
    assert.equal(capInfo.capture, true);
    const cap = await fetch(`http://127.0.0.1:${port}/api/mining/ocr/capture`, { method: 'POST', headers: { 'x-bh-token': local.security.token } });
    const capOut = await cap.json();
    assert.equal(cap.status, 200, JSON.stringify(capOut));
    assert.equal(capOut.panelFound, false);
    assert.equal(capOut.applied, false);
    await win.evaluate(() => (location.hash = 'mining'));
    await win.waitForSelector('button[aria-label="Am PC einlesen"]:not([hidden])');

    mark('Absturz-Neustart');
    // Server-Prozess abschießen: wird neu gestartet, die Shell verbindet sich wieder
    await until(() => isOnline(), 'verbunden');
    const killed = await app.evaluate(({ app: a }) => {
      const m = a.getAppMetrics().find((p) => p.serviceName === 'Black Halo Server' || p.name === 'Black Halo Server');
      if (!m) return false;
      process.kill(m.pid, 'SIGKILL');
      return true;
    });
    assert.ok(killed, 'Server-Prozess gefunden');
    await until(async () => !(await isOnline()), 'Verbindung weg');
    await until(() => isOnline(), 'wieder verbunden', 20000);
    assert.equal((await api('/api/status')).status, 200);

    mark('Fenster schließen');
    // Fenster schließen: App und Server laufen im Tray weiter, Fensterposition gespeichert
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await until(async () => (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)) === 0, 'Fenster zu');
    assert.equal((await api('/api/status')).status, 200);
    const desk = JSON.parse(readFileSync(join(userDir, 'desktop.json'), 'utf8'));
    assert.equal(typeof desk.window.width, 'number');

    assert.ok(existsSync(join(userDir, 'logs', 'blackhalo.log')));

    mark('Beenden');
    // Beenden stoppt auch den Server
    await Promise.all([app.waitForEvent('close'), app.evaluate(({ app: a }) => a.quit())]);
    await assert.rejects(api('/api/status'));
  } catch (err) {
    const logFile = join(userDir, 'logs', 'blackhalo.log');
    const tail = existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').slice(-30).join('\n') : '(kein Log)';
    console.error(`Fehlgeschlagen im Schritt "${step}": ${err.message}\n--- Ende von blackhalo.log ---\n${tail}`);
    throw err;
  } finally {
    await app.close().catch(() => {});
  }
});
