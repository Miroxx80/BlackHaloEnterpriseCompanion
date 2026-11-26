// Tests für das Einlesen von Screenshots (OCR-Grundgerüst): Farben, Auswertung, Schnittstelle.
// Die Texterkennung selbst ist austauschbar; hier wird alles geprüft, was unabhängig davon funktioniert.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { startApp } from '../dist/core/app.js';
import { loadScreen, crop, textColor } from '../dist/modules/mining/ocr/image.js';
import { PROSPECTOR_1080 } from '../dist/modules/mining/ocr/layout.js';
import { cleanNumber, matchOre, resolvePercents, zeroEightVariants, massScuPlausible } from '../dist/modules/mining/ocr/parse.js';
import { readScan } from '../dist/modules/mining/ocr/pipeline.js';
import { noReader } from '../dist/modules/mining/ocr/engine.js';
import { createPaddleReader } from '../dist/modules/mining/ocr/paddle.js';

const fixture = (p) => readFileSync(new URL(`./fixtures/${p}`, import.meta.url));
const data = JSON.parse(readFileSync(new URL('../src/modules/mining/data/dataset.json', import.meta.url), 'utf8'));
const HUD = ['hud/prospector-helix1-20pct.webp', 'hud/prospector-helix1-50pct.webp', 'hud/prospector-helix1-100pct.webp'];

test('Farbe von Resistenz/Instabilität: weiß in den HUD-Bildern, grün/rot im Titan-Scan', async () => {
  for (const f of HUD) {
    const img = await loadScreen(fixture(f), PROSPECTOR_1080);
    assert.equal(textColor(crop(img, PROSPECTOR_1080.resistance)).color, 'white', f);
    assert.equal(textColor(crop(img, PROSPECTOR_1080.instability)).color, 'white', f);
  }
  // Titan-Scan (Ausschnitt, heller Planetenhintergrund): Resistenz grün, Instabilität rot, Masse weiß
  const { data: px, info } = await sharp(fixture('scan-panel/titanium-458kg.png')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const img = { width: info.width, height: info.height, data: px };
  assert.equal(textColor(crop(img, [125, 85, 23, 10])).color, 'white');
  assert.equal(textColor(crop(img, [125, 105, 25, 12])).color, 'green');
  assert.equal(textColor(crop(img, [124, 128, 24, 12])).color, 'red');
});

test('Zahlen und Erznamen aus gelesenen Texten', () => {
  assert.equal(cleanNumber('58.23'), '58.23');
  assert.equal(cleanNumber('0%'), '0');
  assert.equal(cleanNumber('O%'), '0'); // O statt 0
  assert.equal(cleanNumber('2,927', { int: true }), '2927');
  assert.equal(cleanNumber('901.80m'), '901.80m');
  assert.equal(cleanNumber('12a'), null);
  const ore = (t) => matchOre(t, data.ores);
  assert.deepEqual(ore('HEPH (RAW)'), { id: 'Raw_Hephaestanite', exact: true }); // eindeutige Abkürzung der Prospector
  assert.deepEqual(ore('TITANIUM (ORE)'), { id: 'Ore_Titanium', exact: true });
  assert.deepEqual(ore('QUARTZ (RAW)'), { id: 'Raw_Quartz', exact: true });
  assert.equal(ore('SILICON (RAW)').id, 'Raw_Silicon');
  assert.equal(ore('INERT MATERIALS').id, 'inert');
  assert.equal(ore('TITANIVM (ORE)').id, 'Ore_Titanium'); // ein Lesefehler
  assert.equal(ore('XYZ'), null);
});

test('Durchgestrichene Null: 0/8-Verwechslung über die Summe der Anteile auflösen', () => {
  assert.deepEqual(zeroEightVariants('80'), ['80', '00', '88', '08']);
  // Echte Werte 8.31 % + 91.69 %; gelesen "0.31" -> Summe 92 % -> Tausch auf 8.31 und markieren
  const r = resolvePercents(['0.31', '91.69']);
  assert.deepEqual(r.values, ['8.31', '91.69']);
  assert.deepEqual(r.changed, [0]);
  assert.equal(r.ok, true);
  // Stimmt schon: nichts ändern
  assert.deepEqual(resolvePercents(['4.14', '3.58', '42.18', '3.88', '46.27']).changed, []);
  // Masse/SCU: 2927 kg bei 9,84 SCU passt; bei 0,5 SCU wäre die Dichte 41 (dichter als jedes Erz)
  assert.equal(massScuPlausible('2927', '9.84'), true);
  assert.equal(massScuPlausible('2927', '0.5'), false);
});

test('Ablauf: Panel erkennen, Farben übernehmen; ohne Panel nichts übernehmen', async () => {
  const { result, panelPng } = await readScan(fixture(HUD[0]), noReader, data.ores);
  assert.equal(result.panelFound, true);
  assert.deepEqual([result.draft.resColor, result.draft.instColor], ['white', 'white']);
  assert.ok(panelPng.length > 1000);
  const black = await sharp({ create: { width: 1920, height: 1080, channels: 3, background: '#05080c' } }).png().toBuffer();
  const empty = await readScan(black, noReader, data.ores);
  assert.equal(empty.result.panelFound, false);
  await assert.rejects(readScan(await sharp({ create: { width: 800, height: 800, channels: 3, background: '#000' } }).png().toBuffer(), noReader, data.ores), /16:9/);
});

test('API: Screenshot einlesen, in den gemeinsamen Scan übernehmen, Beispiel speichern, Markierungen', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'bh-ocr-api-'));
  const app = await startApp({ overrides: { server: { host: '127.0.0.1', port: 0 }, modules: { controls: { driver: 'mock' } } }, dataRoot });
  const base = `http://127.0.0.1:${app.port}/api/mining`;
  try {
    // Vorher: Resistenz rot gesetzt
    await fetch(`${base}/scan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ origin: 't', ops: [{ op: 'set', field: 'resColor', value: 'red' }] }) });
    const res = await fetch(`${base}/ocr?apply=1`, { method: 'POST', headers: { 'content-type': 'image/webp' }, body: fixture(HUD[1]) });
    assert.equal(res.status, 200);
    const out = await res.json();
    assert.equal(out.applied, true);
    const shared = await (await fetch(`${base}/scan`)).json();
    assert.equal(shared.scan.resColor, 'white'); // vom Screenshot übernommen
    assert.ok(readdirSync(join(dataRoot, 'mining', 'ocr-samples')).some((f) => f.endsWith('-panel.png')));

    assert.equal((await fetch(`${base}/ocr`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: Buffer.from('kein bild') })).status, 500);
    assert.equal((await fetch(`${base}/ocr`, { method: 'POST' })).status, 400);

    // Markierungen: per replace gesetzt, durch Bearbeiten des Felds entfernt, bei Zeile-Löschen verschoben
    const replace = { ...shared.scan, parts: [{ pct: '1', ore: '', quality: '' }, { pct: '2', ore: '', quality: '' }], marks: { mass: 'check', 'parts.1.pct': 'check' } };
    let s = await (await fetch(`${base}/scan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ origin: 't', ops: [{ op: 'replace', scan: replace }] }) })).json();
    assert.deepEqual(s.scan.marks, { mass: 'check', 'parts.1.pct': 'check' });
    s = await (await fetch(`${base}/scan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ origin: 't', ops: [{ op: 'set', field: 'mass', value: '1' }, { op: 'removePart', index: 0 }] }) })).json();
    assert.deepEqual(s.scan.marks, { 'parts.0.pct': 'check' });
    const bad = await fetch(`${base}/scan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ origin: 't', ops: [{ op: 'replace', scan: { ...replace, marks: { gibtsnicht: 'check' } } }] }) });
    assert.equal(bad.status, 400);
    // __proto__ entfernt Fastify schon beim Einlesen (Schutz gegen Prototype-Pollution)
    const proto = await fetch(`${base}/scan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"origin":"t","ops":[{"op":"replace","scan":' + JSON.stringify({ ...replace, marks: {} }).replace('"marks":{}', '"marks":{"__proto__":{"polluted":true}}') + '}]}' });
    assert.ok([200, 400].includes(proto.status));
    assert.equal({}.polluted, undefined);
  } finally {
    await app.stop();
  }
});

test('PaddleOCR am echten Screenshot: Werte gelesen, und kein falscher Wert bleibt unmarkiert', async () => {
  const reader = createPaddleReader(new URL('../src/modules/mining/data/ocr', import.meta.url).pathname);
  const truth = JSON.parse(readFileSync(new URL('./fixtures/hud/prospector-helix1-20pct.json', import.meta.url), 'utf8')).scan;
  const { result } = await readScan(fixture(HUD[0]), reader, data.ores);
  const d = result.draft;
  // Was sicher gelesen werden muss
  assert.equal(d.mass, String(truth.mass));
  assert.deepEqual(d.parts.map((p) => p.ore), ['Raw_Silicon', 'Raw_Hephaestanite', 'Raw_Hephaestanite', 'Raw_Quartz', 'inert']);
  assert.deepEqual(d.parts.map((p) => Number(p.pct)), truth.parts.map((p) => p.pct));
  // Sicherheitsregel: Jeder Wert, der vom echten Wert abweicht, ist zum Prüfen markiert
  const expected = {
    mass: String(truth.mass),
    resistance: String(truth.resistance.value),
    instability: String(truth.instability.value),
    scu: String(truth.scu),
    ...Object.fromEntries(truth.parts.map((p, i) => [`parts.${i}.quality`, String(p.quality)])),
  };
  const read = { mass: d.mass, resistance: d.resistance, instability: d.instability, scu: d.scu, ...Object.fromEntries(d.parts.map((p, i) => [`parts.${i}.quality`, p.quality])) };
  const silent = Object.keys(expected).filter((k) => Number(read[k]) !== Number(expected[k]) && !result.marks[k]);
  assert.deepEqual(silent, [], `falsch und nicht markiert: ${silent.map((k) => `${k}=${read[k]} (echt ${expected[k]})`).join(', ')}`);
  assert.ok(!result.marks['parts.0.ore'] && !result.marks['parts.4.ore'], 'eindeutige Erznamen nicht markiert');
});

test('API: "Am PC einlesen" nimmt über die Desktop-App auf, ohne Desktop-App 501', async () => {
  const opts = (dataRoot) => ({ overrides: { server: { host: '127.0.0.1', port: 0 }, modules: { controls: { driver: 'mock' } } }, dataRoot });
  // Ohne Desktop-App: Knopf ausgeblendet, Route lehnt ab
  const plain = await startApp(opts(mkdtempSync(join(tmpdir(), 'bh-cap-'))));
  try {
    const base = `http://127.0.0.1:${plain.port}/api/mining`;
    assert.equal((await (await fetch(`${base}/ocr`)).json()).capture, false);
    assert.equal((await fetch(`${base}/ocr/capture`, { method: 'POST' })).status, 501);
  } finally {
    await plain.stop();
  }
  // Mit Desktop-App: Aufnahme wird gelesen und übernommen; Fehler der Aufnahme -> 502
  let fail = false;
  const capture = async () => {
    if (fail) throw new Error('kaputt');
    return sharp(fixture(HUD[1])).png().toBuffer();
  };
  const app = await startApp({ ...opts(mkdtempSync(join(tmpdir(), 'bh-cap-'))), services: { 'desktop.screen': { capture } } });
  try {
    const base = `http://127.0.0.1:${app.port}/api/mining`;
    assert.equal((await (await fetch(`${base}/ocr`)).json()).capture, true);
    const res = await fetch(`${base}/ocr/capture`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 200);
    const out = await res.json();
    assert.equal(out.applied, true);
    assert.equal((await (await fetch(`${base}/scan`)).json()).scan.mass, out.draft.mass);
    fail = true;
    const bad = await fetch(`${base}/ocr/capture`, { method: 'POST' });
    assert.equal(bad.status, 502);
    assert.match((await bad.json()).error, /kaputt/);
  } finally {
    await app.stop();
  }
});
