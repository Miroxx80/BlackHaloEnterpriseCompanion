// Menü "Dev": Schalter (Standard aus), Speichern der OCR-Beispiele nur wenn eingeschaltet, Ordner anzeigen und leeren.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp } from '../dist/core/app.js';

const HUD = readFileSync(new URL('./fixtures/hud/prospector-helix1-50pct.webp', import.meta.url));
const opts = (dataRoot, extra = {}) => ({ overrides: { server: { host: '127.0.0.1', port: 0 }, modules: { controls: { driver: 'mock' }, ...extra } }, dataRoot });
const json = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('Dev: Standard aus, OCR speichert kein Bild, Schutz vor veralteten Änderungen bleibt', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'bh-dev-off-'));
  const app = await startApp(opts(dataRoot));
  const base = `http://127.0.0.1:${app.port}/api`;
  try {
    const dev = await (await fetch(`${base}/dev`)).json();
    assert.deepEqual(dev.settings, { saveOcrSamples: false, saveSignatureSamples: false });
    assert.deepEqual(dev.stores.map((s) => s.id), ['ocr', 'ocr-confirmed', 'signature']);
    assert.ok(dev.stores.every((s) => s.files === 0 && s.bytes === 0));

    const out = await (await fetch(`${base}/mining/ocr?apply=1`, { method: 'POST', headers: { 'content-type': 'image/webp' }, body: HUD })).json();
    assert.equal(out.applied, true);
    assert.equal(existsSync(join(dataRoot, 'mining', 'ocr-samples')), false, 'kein Ordner, keine Bilder');
    const shared = await (await fetch(`${base}/mining/scan`)).json();
    // Die OCR hat trotzdem eine Kennung (Schutz vor verspäteten Änderungen, "Bitte prüfen" an allen Geräten)
    const id1 = shared.scan.ocrSample;
    assert.match(id1, /^[\w-]+$/);

    // Zweite OCR: Änderungen und "Alles geprüft" zum alten Scan (oder ohne bekannte OCR) treffen den neuen nicht
    const ocr2 = (await (await fetch(`${base}/mining/ocr?apply=1`, { method: 'POST', headers: { 'content-type': 'image/webp' }, body: HUD })).json()).draft;
    const now = (await (await fetch(`${base}/mining/scan`)).json()).scan;
    assert.notEqual(now.ocrSample, id1);
    assert.ok(Object.keys(now.marks ?? {}).length > 0, 'Testbild braucht gelbe Felder');
    for (const b of [id1, '']) {
      const stale = await fetch(`${base}/mining/scan`, json({ origin: 't', base: b, ops: [{ op: 'set', field: 'mass', value: '1' }, { op: 'unmark', sample: b }] }));
      assert.equal(stale.status, 409, `base ${JSON.stringify(b)}`);
    }
    const quiet = await (await fetch(`${base}/mining/scan`, json({ origin: 't', ops: [{ op: 'unmark', sample: '' }] }))).json();
    assert.deepEqual(quiet.scan.marks, now.marks, 'Gerät ohne offene OCR bestätigt die neue nicht');
    assert.equal(quiet.scan.mass, ocr2.mass);

    // "Alles geprüft" zum aktuellen Scan geht, speichert aber nichts
    const done = await fetch(`${base}/mining/scan`, json({ origin: 't', base: now.ocrSample, ops: [{ op: 'unmark', sample: now.ocrSample }] }));
    assert.equal(done.status, 200);
    const after = (await done.json()).scan;
    assert.deepEqual(after.marks ?? {}, {});
    assert.equal(after.ocrSample, undefined);
    assert.equal(existsSync(join(dataRoot, 'mining', 'ocr-samples')), false, 'auch nach dem Bestätigen keine Bilder');
  } finally {
    await app.stop();
  }
});

test('Dev: Schalter an -> Beispiel gespeichert, Ordner anzeigen und leeren, Stand bleibt nach Neustart', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'bh-dev-on-'));
  let app = await startApp(opts(dataRoot));
  let base = `http://127.0.0.1:${app.port}/api`;
  try {
    const on = await (await fetch(`${base}/dev/settings`, json({ saveOcrSamples: true }))).json();
    assert.equal(on.settings.saveOcrSamples, true);
    assert.equal(on.settings.saveSignatureSamples, false);

    const out = await (await fetch(`${base}/mining/ocr?apply=1`, { method: 'POST', headers: { 'content-type': 'image/webp' }, body: HUD })).json();
    assert.equal(out.applied, true);
    const shared = await (await fetch(`${base}/mining/scan`)).json();
    assert.match(shared.scan.ocrSample, /^[\w-]+$/);
    const samples = join(dataRoot, 'mining', 'ocr-samples');
    assert.ok(readdirSync(samples).some((f) => f.endsWith('-panel.png')));

    // Bestätigt landet in confirmed/ (eigener Ordner in der Liste)
    await fetch(`${base}/mining/scan`, json({ origin: 't', ops: [{ op: 'unmark', sample: shared.scan.ocrSample }] }));
    let dev = await (await fetch(`${base}/dev`)).json();
    const byId = (d, id) => d.stores.find((s) => s.id === id);
    assert.equal(byId(dev, 'ocr-confirmed').samples, 1);
    assert.equal(byId(dev, 'ocr-confirmed').files, 3); // Bild, Ergebnis, Wahrheit
    assert.ok(byId(dev, 'ocr-confirmed').bytes > 1000);
    assert.equal(byId(dev, 'ocr').samples, 0);

    // Noch ein unbestätigter Scan; Leeren von "ocr" lässt confirmed/ stehen
    await fetch(`${base}/mining/ocr?apply=1`, { method: 'POST', headers: { 'content-type': 'image/webp' }, body: HUD });
    dev = await (await fetch(`${base}/dev`)).json();
    assert.equal(byId(dev, 'ocr').samples, 1);
    const cleared = await (await fetch(`${base}/dev/clear`, json({ store: 'ocr' }))).json();
    assert.equal(cleared.deleted, 2);
    assert.equal(byId(cleared, 'ocr').files, 0);
    assert.equal(byId(cleared, 'ocr-confirmed').samples, 1);
    // Ein Scan, dessen Beispiel gelöscht wurde, lässt sich trotzdem bestätigen (es wird nur nichts gespeichert)
    const sample = (await (await fetch(`${base}/mining/scan`)).json()).scan.ocrSample;
    assert.equal((await fetch(`${base}/mining/scan`, json({ origin: 't', ops: [{ op: 'unmark', sample }] }))).status, 200);
    assert.equal(byId(await (await fetch(`${base}/dev`)).json(), 'ocr-confirmed').samples, 1);

    // Ungültige Eingaben
    assert.equal((await fetch(`${base}/dev/settings`, json({ saveOcrSamples: 'ja' }))).status, 400);
    assert.equal((await fetch(`${base}/dev/settings`, json({ irgendwas: true }))).status, 400);
    assert.equal((await fetch(`${base}/dev/settings`, json([true]))).status, 400);
    assert.equal((await fetch(`${base}/dev/clear`, json({ store: '../mining' }))).status, 400);
    assert.equal((await fetch(`${base}/dev/clear`, json({}))).status, 400);
  } finally {
    await app.stop();
  }
  // Neustart: Stand aus data/dev/settings.json
  app = await startApp(opts(dataRoot));
  base = `http://127.0.0.1:${app.port}/api`;
  try {
    assert.equal((await (await fetch(`${base}/dev`)).json()).settings.saveOcrSamples, true);
    await fetch(`${base}/dev/settings`, json({ saveOcrSamples: false }));
    const before = readdirSync(join(dataRoot, 'mining', 'ocr-samples')).length;
    await fetch(`${base}/mining/ocr?apply=1`, { method: 'POST', headers: { 'content-type': 'image/webp' }, body: HUD });
    assert.equal(readdirSync(join(dataRoot, 'mining', 'ocr-samples')).length, before, 'aus: nichts Neues');
  } finally {
    await app.stop();
  }
});

test('Dev: Startwert aus der Config, kaputte settings.json -> Standard, Änderung geht an alle Geräte', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'bh-dev-cfg-'));
  mkdirSync(join(dataRoot, 'dev'), { recursive: true });
  writeFileSync(join(dataRoot, 'dev', 'settings.json'), '{kaputt');
  const app = await startApp(opts(dataRoot, { dev: { saveSignatureSamples: true, saveOcrSamples: 'egal' } }));
  const base = `http://127.0.0.1:${app.port}/api`;
  try {
    assert.deepEqual((await (await fetch(`${base}/dev`)).json()).settings, { saveOcrSamples: false, saveSignatureSamples: true });
    const ws = new WebSocket(`ws://127.0.0.1:${app.port}/ws`);
    const got = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('keine dev:state-Nachricht')), 3000);
      ws.addEventListener('message', (e) => {
        const m = JSON.parse(e.data);
        if (m.type === 'dev:state') {
          clearTimeout(t);
          resolve(m.payload);
        }
      });
    });
    await new Promise((r) => ws.addEventListener('open', r, { once: true }));
    await fetch(`${base}/dev/settings`, json({ saveOcrSamples: true }));
    assert.equal((await got).settings.saveOcrSamples, true);
    ws.close();
    // Datei wurde sauber neu geschrieben
    assert.deepEqual(JSON.parse(readFileSync(join(dataRoot, 'dev', 'settings.json'), 'utf8')), { saveOcrSamples: true, saveSignatureSamples: true });
  } finally {
    await app.stop();
  }
});

test('Dev: Modul abgeschaltet -> Mining speichert nichts (Standard aus)', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'bh-dev-disabled-'));
  const app = await startApp(opts(dataRoot, { dev: { enabled: false, saveOcrSamples: true } }));
  const base = `http://127.0.0.1:${app.port}/api`;
  try {
    assert.equal((await fetch(`${base}/dev`)).status, 404);
    const out = await (await fetch(`${base}/mining/ocr?apply=1`, { method: 'POST', headers: { 'content-type': 'image/webp' }, body: HUD })).json();
    assert.equal(out.applied, true);
    assert.equal(existsSync(join(dataRoot, 'mining', 'ocr-samples')), false);
  } finally {
    await app.stop();
  }
});
