// Ende-zu-Ende-Test der Desktop-App (Electron). Braucht Playwright und eine Anzeige
// (unter Linux z. B. "xvfb-run -a npm run test:desktop"). Ohne Playwright wird er übersprungen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
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

test('Desktop-App: Fenster, Fokus, QR, Absturz-Neustart, Tray-Betrieb', { skip: !electron && 'playwright nicht installiert' }, async () => {
  const userDir = mkdtempSync(join(tmpdir(), 'bh-desktop-'));
  const args = ['.'];
  if (process.getuid?.() === 0) args.push('--no-sandbox'); // nur im Container als root nötig
  const executablePath = createRequire(import.meta.url)('electron'); // Pfad zur electron-Binary aus diesem Projekt
  const app = await electron.launch({ executablePath, args, env: { ...process.env, BH_USER_DIR: userDir, BH_PORT: String(await freePort()) } });

  try {
    const win = await app.firstWindow();
    await win.waitForSelector('nav a[data-id="pairing"]', { timeout: 15000 });

    // Token wurde erzeugt, gespeichert und aus der Adresszeile entfernt
    const local = JSON.parse(readFileSync(join(userDir, 'config', 'local.json'), 'utf8'));
    assert.ok(local.security.token.length >= 20);
    assert.ok(!win.url().includes('token='));
    const port = new URL(win.url()).port;
    const api = (path) => fetch(`http://127.0.0.1:${port}${path}`, { headers: { 'x-bh-token': local.security.token } });
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/modules`)).status, 401);

    // Fokus je Ansicht: Controls nimmt keinen Fokus, Status schon
    const focusable = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocusable());
    await win.evaluate(() => (location.hash = 'controls'));
    await until(async () => (await focusable()) === false, 'Controls nicht fokussierbar');
    await win.evaluate(() => (location.hash = 'status'));
    await until(async () => (await focusable()) === true, 'Status fokussierbar');

    // QR-Code-Ansicht
    await win.evaluate(() => (location.hash = 'pairing'));
    await win.waitForSelector('#list img, #note:not(:empty)');

    // Server-Prozess abschießen: wird neu gestartet, die Shell verbindet sich wieder
    await until(() => win.$('#conn.on'), 'verbunden');
    const killed = await app.evaluate(({ app: a }) => {
      const m = a.getAppMetrics().find((p) => p.serviceName === 'Black Halo Server' || p.name === 'Black Halo Server');
      if (!m) return false;
      process.kill(m.pid, 'SIGKILL');
      return true;
    });
    assert.ok(killed, 'Server-Prozess gefunden');
    await until(() => win.$('#conn.off'), 'Verbindung weg');
    await until(() => win.$('#conn.on'), 'wieder verbunden', 20000);
    assert.equal((await api('/api/status')).status, 200);

    // Fenster schließen: App und Server laufen im Tray weiter, Fensterposition gespeichert
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await until(async () => (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)) === 0, 'Fenster zu');
    assert.equal((await api('/api/status')).status, 200);
    const desk = JSON.parse(readFileSync(join(userDir, 'desktop.json'), 'utf8'));
    assert.equal(typeof desk.window.width, 'number');

    assert.ok(existsSync(join(userDir, 'logs', 'blackhalo.log')));

    // Beenden stoppt auch den Server
    await Promise.all([app.waitForEvent('close'), app.evaluate(({ app: a }) => a.quit())]);
    await assert.rejects(api('/api/status'));
  } finally {
    await app.close().catch(() => {});
  }
});
