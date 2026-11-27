// Tests für den Eingabe-Teil von "controls". Die Windows-API wird nachgebaut, damit alles
// auch unter Linux läuft. Echte Tastendrücke ans Spiel lassen sich nur am Windows-PC prüfen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from '../dist/core/app.js';
import { parseCombo } from '../dist/modules/controls/input/keys.js';
import { runCombo } from '../dist/modules/controls/input/sequence.js';
import { ensureForeground, TargetError } from '../dist/modules/controls/input/foreground.js';

const LOCAL = { server: { host: '127.0.0.1', port: 0 } };
const noSleep = async () => {};

test('Tastenangaben: Namen, Aliase, Scancodes, Fehler', () => {
  const c = parseCombo('Alt+N');
  assert.equal(c.spec, 'lalt+n');
  assert.deepEqual(c.keys.map((k) => [k.scan, k.extended]), [[0x38, false], [0x31, false]]);
  assert.deepEqual(parseCombo('rctrl+up').keys.map((k) => k.extended), [true, true]);
  assert.equal(parseCombo('esc').keys[0].name, 'escape');
  assert.equal(parseCombo('f13').keys[0].scan, 0x64);
  assert.throws(() => parseCombo('alt+gibtsnicht'), /Unbekannte Taste "gibtsnicht"/);
  assert.throws(() => parseCombo('alt++n'), /Ungültige/);
  assert.throws(() => parseCombo('alt+lalt'), /doppelt/);
  assert.throws(() => parseCombo(''), /Leere/);
});

test('Kombination: Reihenfolge, Halten, Loslassen auch bei Fehler', async () => {
  const log = [];
  const io = {
    down: (k) => log.push(`down ${k.name}`),
    up: (k) => log.push(`up ${k.name}`),
    sleep: async (ms) => log.push(`sleep ${ms}`),
  };
  await runCombo(parseCombo('lctrl+lshift+f1'), 300, io, { tapMs: 50, comboGapMs: 10 });
  assert.deepEqual(log, [
    'down lctrl', 'sleep 10', 'down lshift', 'sleep 10', 'down f1',
    'sleep 300',
    'up f1', 'sleep 10', 'up lshift', 'sleep 10', 'up lctrl', 'sleep 10',
  ]);

  // Fehler beim Drücken der zweiten Taste: die erste muss trotzdem wieder hoch
  const log2 = [];
  const failing = {
    down: (k) => {
      if (k.name === 'n') throw new Error('kaputt');
      log2.push(`down ${k.name}`);
    },
    up: (k) => log2.push(`up ${k.name}`),
    sleep: noSleep,
  };
  await assert.rejects(runCombo(parseCombo('alt+n'), undefined, failing, { tapMs: 50, comboGapMs: 0 }), /kaputt/);
  assert.deepEqual(log2, ['down lalt', 'up lalt']);
});

/** Nachgebaute Fenster-Welt: Fenster-ID -> Prozessname. */
function fakeWindows({ windows, foreground, allowSwitch = true, needsUnlock = false, minimized = [] }) {
  const calls = [];
  let fg = foreground;
  let unlocked = false;
  const mini = new Set(minimized);
  return {
    calls,
    api: {
      foreground: () => fg,
      processName: (h) => windows[h] ?? '',
      topLevelWindows: () => Object.keys(windows).map(BigInt),
      isMinimized: (h) => mini.has(h),
      restore: (h) => {
        calls.push(`restore ${h}`);
        mini.delete(h);
      },
      setForeground: (h) => {
        calls.push(`setForeground ${h}`);
        if (allowSwitch && (!needsUnlock || unlocked)) fg = h;
        return fg === h;
      },
      unlockForeground: () => {
        calls.push('unlock');
        unlocked = true;
      },
      sleep: noSleep,
    },
  };
}

const OPTS = { timeoutMs: 100, settleMs: 0 };
const SC = { process: 'StarCitizen.exe' };

test('Vordergrund: Spiel schon vorn -> nichts tun', async () => {
  const w = fakeWindows({ windows: { 1: 'StarCitizen.exe', 2: 'electron.exe' }, foreground: 1n });
  await ensureForeground(w.api, SC, OPTS);
  assert.deepEqual(w.calls, []);
});

test('Vordergrund: Spiel nach vorn holen, minimiert wiederherstellen, Groß-/Kleinschreibung egal', async () => {
  const w = fakeWindows({ windows: { 1: 'starcitizen.exe', 2: 'electron.exe' }, foreground: 2n, minimized: [1n] });
  await ensureForeground(w.api, SC, OPTS);
  assert.deepEqual(w.calls, ['restore 1', 'setForeground 1']);
});

test('Vordergrund: gesperrt -> Alt-Trick, dann klappt es', async () => {
  const w = fakeWindows({ windows: { 1: 'StarCitizen.exe', 2: 'chrome.exe' }, foreground: 2n, needsUnlock: true });
  await ensureForeground(w.api, SC, OPTS);
  assert.deepEqual(w.calls, ['setForeground 1', 'unlock', 'setForeground 1']);
});

test('Vordergrund: Fehler statt blind senden', async () => {
  const notRunning = fakeWindows({ windows: { 2: 'chrome.exe' }, foreground: 2n });
  await assert.rejects(ensureForeground(notRunning.api, SC, OPTS), (e) => e instanceof TargetError && e.code === 'not-running');

  const stuck = fakeWindows({ windows: { 1: 'StarCitizen.exe', 2: 'chrome.exe' }, foreground: 2n, allowSwitch: false });
  await assert.rejects(ensureForeground(stuck.api, SC, OPTS), (e) => e instanceof TargetError && e.code === 'not-foreground');
});

test('controls: Warteschlange, Halten, Überlastschutz', async () => {
  const app = await startApp({
    overrides: {
      ...LOCAL,
      modules: {
        controls: {
          driver: 'mock',
          buttons: [
            { id: 'kurz', label: 'Kurz', key: 'alt+n' },
            { id: 'lang', label: 'Lang', key: 'f', hold: 150 },
          ],
        },
      },
    },
  });
  const base = `http://127.0.0.1:${app.port}`;
  const press = (id) => fetch(`${base}/api/controls/press/${id}`, { method: 'POST' }).then((r) => r.status);
  try {
    const list = await (await fetch(`${base}/api/controls/buttons`)).json();
    assert.equal(list.driver, 'mock');
    assert.deepEqual(list.buttons.map((b) => [b.keys, b.hold]), [['lalt+n', undefined], ['f', 150]]);

    // Gehaltener Druck dauert so lange wie angegeben
    const t0 = Date.now();
    assert.equal(await press('lang'), 200);
    assert.ok(Date.now() - t0 >= 150);

    // Viele gleichzeitige Drücke: die ersten laufen nacheinander, der Rest wird abgelehnt
    const results = await Promise.all(Array.from({ length: 8 }, () => press('lang')));
    assert.equal(results.filter((s) => s === 200).length, 5);
    assert.equal(results.filter((s) => s === 429).length, 3);
    assert.equal(await press('gibtsnicht'), 404);
  } finally {
    await app.stop();
  }
});

test('controls: Tippfehler in der Config -> Modul fällt aus, Meldung nennt den Button', async () => {
  const app = await startApp({
    overrides: { ...LOCAL, modules: { controls: { driver: 'mock', buttons: [{ id: 'x', label: 'X', key: 'alt+gibtsnicht' }] } } },
  });
  try {
    const mods = await (await fetch(`http://127.0.0.1:${app.port}/api/modules`)).json();
    const controls = mods.modules.find((m) => m.id === 'controls');
    assert.equal(controls.state, 'failed');
    assert.match(controls.error, /Button #1 \("x"\).*Unbekannte Taste "gibtsnicht"/);
    assert.equal(mods.modules.find((m) => m.id === 'status').state, 'running');
  } finally {
    await app.stop();
  }
});

test('controls: Treiber "windows" außerhalb von Windows -> klare Meldung', { skip: process.platform === 'win32' }, async () => {
  const app = await startApp({ overrides: { ...LOCAL, modules: { controls: { driver: 'windows' } } } });
  try {
    const mods = await (await fetch(`http://127.0.0.1:${app.port}/api/modules`)).json();
    assert.match(mods.modules.find((m) => m.id === 'controls').error, /nur unter Windows/);
  } finally {
    await app.stop();
  }
});
