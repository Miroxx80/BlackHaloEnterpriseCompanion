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
import { createPaddleDetector, createPaddleReader } from '../dist/modules/mining/ocr/paddle.js';

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

const OCR_DIR = new URL('../src/modules/mining/data/ocr', import.meta.url).pathname;
const paddle = { reader: createPaddleReader(OCR_DIR), detector: createPaddleDetector(OCR_DIR) };

/** Ganzen Screenshot um dx/dy verschieben (so wie das Panel im Spiel wandert). */
async function shiftScreen(buf, dx, dy) {
  const src = await sharp(buf).removeAlpha().extract({ left: Math.max(0, -dx), top: Math.max(0, -dy), width: 1920 - Math.abs(dx), height: 1080 - Math.abs(dy) }).png().toBuffer();
  return sharp({ create: { width: 1920, height: 1080, channels: 3, background: '#202020' } }).composite([{ input: src, left: Math.max(0, dx), top: Math.max(0, dy) }]).png().toBuffer();
}

/** Sicherheitsregel: Jeder Wert, der vom echten Wert abweicht, ist zum Prüfen markiert. */
function silentErrors(result, truth) {
  const d = result.draft;
  const expected = {
    mass: truth.mass, resistance: truth.resistance.value, instability: truth.instability.value, scu: truth.scu,
    ...Object.fromEntries(truth.parts.flatMap((p, i) => [[`parts.${i}.pct`, p.pct], [`parts.${i}.quality`, p.quality]])),
  };
  const read = {
    mass: d.mass, resistance: d.resistance, instability: d.instability, scu: d.scu,
    ...Object.fromEntries(d.parts.flatMap((p, i) => [[`parts.${i}.pct`, p.pct], [`parts.${i}.quality`, p.quality]])),
  };
  // Fehlende Zeile: gilt als gewarnt, wenn die Anteile markiert sind (dann steht auch "Fehlt eine Zeile?" da)
  const pctMarked = Object.keys(result.marks).some((k) => /^parts\.\d+\.pct$/.test(k));
  const missing = (k) => /^parts\.(\d+)\./.test(k) && !d.parts[+k.split('.')[1]] && pctMarked;
  const wrong = Object.keys(expected).filter((k) => Number(read[k] ?? NaN) !== Number(expected[k]) && !result.marks[k] && !missing(k));
  return wrong.map((k) => `${k}=${read[k]} (echt ${expected[k]})`);
}

for (const [name, dx, dy] of [['Standard-Lage', 0, 0], ['Panel verschoben wie im PC-Test', 12, 95]]) {
  test(`PaddleOCR am echten Screenshot (${name}): Panel gefunden, Werte gelesen, kein falscher Wert unmarkiert`, async () => {
    const truth = JSON.parse(readFileSync(new URL('./fixtures/hud/prospector-helix1-20pct.json', import.meta.url), 'utf8')).scan;
    const screen = await shiftScreen(await sharp(fixture(HUD[0])).resize(1920, 1080, { fit: 'fill' }).png().toBuffer(), dx, dy);
    const { result, panelPng } = await readScan(screen, paddle.reader, data.ores, { detector: paddle.detector });
    assert.ok(result.panelFound);
    assert.ok(Math.abs(result.offset[0] - dx) <= 4 && Math.abs(result.offset[1] - dy) <= 4, `Versatz ${result.offset}`);
    const d = result.draft;
    assert.equal(d.mass, String(truth.mass));
    assert.deepEqual(d.parts.map((p) => p.ore), ['Raw_Silicon', 'Raw_Hephaestanite', 'Raw_Hephaestanite', 'Raw_Quartz', 'inert']);
    assert.deepEqual(silentErrors(result, truth), []);
    assert.ok(!result.marks['parts.0.ore'] && !result.marks['parts.4.ore'], `eindeutige Erznamen nicht markiert: ${result.raw['parts.0.ore']} / ${result.raw['parts.4.ore']}`);
    // Beispielbild enthält den ganzen Suchbereich
    const meta = await sharp(panelPng).metadata();
    assert.equal(`${meta.width}x${meta.height}`, '576x608');
  });
}

test('PC-Test-Bilder mit bekannten Werten: kein falscher Wert und kein falsches Erz unmarkiert', async () => {
  const truths = JSON.parse(readFileSync(new URL('./fixtures/hud/panel-2026-11-26/regions.json', import.meta.url), 'utf8'));
  for (const [file, truth] of Object.entries(truths)) {
    // Suchbereich (576x608 ab 1184,392) zurück an seine Stelle im Bild
    const screen = await sharp({ create: { width: 1920, height: 1080, channels: 3, background: '#787878' } })
      .composite([{ input: await sharp(fixture(`hud/panel-2026-11-26/${file}`)).png().toBuffer(), left: 1184, top: 392 }]).png().toBuffer();
    const { result } = await readScan(screen, paddle.reader, data.ores, { detector: paddle.detector });
    assert.ok(result.panelFound, file);
    assert.deepEqual(silentErrors(result, truth), [], file);
    // Alle Testbilder zeigen weiße Werte (Farbsaum darf nicht als grün/rot gelten)
    assert.deepEqual([result.draft.resColor, result.draft.instColor], ['white', 'white'], file);
    const rowsWarned = Object.keys(result.marks).some((k) => /^parts\.\d+\.pct$/.test(k));
    const wrongOre = truth.parts.map((p, i) => i).filter((i) => (result.draft.parts[i] ? result.draft.parts[i].ore !== truth.parts[i].ore && !result.marks[`parts.${i}.ore`] : !rowsWarned));
    assert.deepEqual(wrongOre, [], `${file}: falsches Erz unmarkiert`);
  }
});

test('Panel finden in den Scans vom PC-Test (heller Planet, Panel bis 96 px verschoben)', async () => {
  // Gespeicherte Panel-Ausschnitte (200x265 ab 1355,475) zurück an ihre Stelle im Bild
  const expected = [[1, -2], [-3, 15], [16, 94], [7, 96], [12, 92]];
  for (const [i, [ex, ey]] of expected.entries()) {
    const screen = await sharp({ create: { width: 1920, height: 1080, channels: 3, background: '#787878' } })
      .composite([{ input: fixture(`hud/panel-2026-11-26/scan-${i + 1}.png`), left: 1355, top: 475 }]).png().toBuffer();
    const { result } = await readScan(screen, paddle.reader, data.ores, { detector: paddle.detector });
    assert.ok(result.panelFound, `Scan ${i + 1}`);
    assert.ok(Math.abs(result.offset[0] - ex) <= 4 && Math.abs(result.offset[1] - ey) <= 4, `Scan ${i + 1}: Versatz ${result.offset}`);
    assert.ok(result.anchors.length >= 3, `Scan ${i + 1}: ${result.anchors}`);
  }
  // Ohne Panel: nichts gefunden
  const empty = await sharp({ create: { width: 1920, height: 1080, channels: 3, background: '#787878' } }).png().toBuffer();
  assert.equal((await readScan(empty, paddle.reader, data.ores, { detector: paddle.detector })).result.panelFound, false);
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

test('API: "Alles geprüft" nach einer OCR speichert den korrigierten Scan als Wahrheit (Trainingsdaten)', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'bh-truth-'));
  const app = await startApp({ overrides: { server: { host: '127.0.0.1', port: 0 }, modules: { controls: { driver: 'mock' } } }, dataRoot });
  const base = `http://127.0.0.1:${app.port}/api/mining`;
  const post = (ops) => fetch(`${base}/scan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ origin: 't', ops }) });
  try {
    const out = await (await fetch(`${base}/ocr?apply=1`, { method: 'POST', headers: { 'content-type': 'image/webp' }, body: fixture(HUD[0]) })).json();
    assert.equal(out.applied, true);
    let shared = await (await fetch(`${base}/scan`)).json();
    const id = shared.scan.ocrSample;
    assert.match(id, /^[\w-]+$/, 'Scan kennt sein Beispiel, solange er nicht bestätigt ist');
    // Korrigieren lässt die Kennung stehen
    shared = await (await post([{ op: 'set', field: 'instability', value: '58.23' }])).json();
    assert.equal(shared.scan.ocrSample, id);
    // Bestätigen: Beispiel wandert nach confirmed/, Wahrheit = korrigierter Scan
    shared = await (await post([{ op: 'set', field: 'mass', value: '2927' }, { op: 'unmark', sample: id }, { op: 'reset' }])).json();
    assert.equal(shared.scan.mass, '', 'reset im selben Paket wirkt danach');
    assert.equal(shared.scan.ocrSample, undefined);
    const dir = join(dataRoot, 'mining', 'ocr-samples', 'confirmed');
    assert.deepEqual(readdirSync(dir).sort(), [`${id}-panel.png`, `${id}-result.json`, `${id}-truth.json`]);
    const truth = JSON.parse(readFileSync(join(dir, `${id}-truth.json`), 'utf8'));
    assert.equal(truth.scan.instability, '58.23');
    assert.equal(truth.scan.mass, '2927');
    assert.equal(truth.scan.marks, undefined);
    // Wahrheit = Stand im Moment der Bestätigung, nicht nach dem reset im selben Paket
    assert.equal(truth.scan.parts.length > 1, true);
    assert.ok(!readdirSync(join(dataRoot, 'mining', 'ocr-samples')).some((f) => f.startsWith(id)), 'nicht mehr bei den unbestätigten');
    // Nochmal bestätigen oder ohne OCR: nichts passiert
    assert.equal((await post([{ op: 'unmark', sample: id }])).status, 200);
    assert.equal(readdirSync(dir).length, 3);
    // Veraltete Bestätigung (Gerät hat noch das alte Beispiel): neue OCR bleibt unbestätigt und markiert
    await fetch(`${base}/ocr?apply=1`, { method: 'POST', headers: { 'content-type': 'image/webp' }, body: fixture(HUD[2]) });
    const fresh = (await (await fetch(`${base}/scan`)).json()).scan;
    shared = await (await post([{ op: 'unmark', sample: id }])).json();
    assert.equal(shared.scan.ocrSample, fresh.ocrSample);
    assert.deepEqual(shared.scan.marks, fresh.marks);
    assert.equal(readdirSync(dir).length, 3);
    // Neue Werte von Hand (replace/reset) beenden den Bezug zum Beispiel; ungültige Kennungen werden abgelehnt
    await fetch(`${base}/ocr?apply=1`, { method: 'POST', headers: { 'content-type': 'image/webp' }, body: fixture(HUD[1]) });
    shared = await (await post([{ op: 'reset' }])).json();
    assert.equal(shared.scan.ocrSample, undefined);
    assert.equal((await post([{ op: 'replace', scan: { ...shared.scan, ocrSample: '../../x' } }])).status, 400);
    // Gerät ohne offene OCR ('') bestätigt nicht versehentlich eine frische OCR; Eingaben zum alten Stand: 409
    await fetch(`${base}/ocr?apply=1`, { method: 'POST', headers: { 'content-type': 'image/webp' }, body: fixture(HUD[1]) });
    const ocr2 = (await (await fetch(`${base}/scan`)).json()).scan;
    shared = await (await post([{ op: 'unmark', sample: '' }])).json();
    assert.equal(shared.scan.ocrSample, ocr2.ocrSample);
    assert.deepEqual(shared.scan.marks, ocr2.marks);
    const stale = await fetch(`${base}/scan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ origin: 't', base: id, ops: [{ op: 'set', field: 'mass', value: '1' }] }) });
    assert.equal(stale.status, 409);
    assert.equal((await (await fetch(`${base}/scan`)).json()).scan.mass, ocr2.mass);
    const ok = await fetch(`${base}/scan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ origin: 't', base: ocr2.ocrSample, ops: [{ op: 'set', field: 'mass', value: '1' }] }) });
    assert.equal(ok.status, 200);
  } finally {
    await app.stop();
  }
});

test('Fremder Text direkt neben dem Panel wird nicht in Werte oder Qualität gelesen (Review-Fund)', async () => {
  // Echtes Bild; die Ziffern der Masse ("2296") werden rechts neben das Panel kopiert, in die INST-Zeile und Zeile 2
  const truth = JSON.parse(readFileSync(new URL('./fixtures/hud/panel-2026-11-26/regions.json', import.meta.url), 'utf8'))['region-dark-ice-2296kg.png'];
  const base = await sharp({ create: { width: 1920, height: 1080, channels: 3, background: '#787878' } })
    .composite([{ input: fixture('hud/panel-2026-11-26/region-dark-ice-2296kg.png'), left: 1184, top: 392 }]).png().toBuffer();
  const digits = await sharp(base).extract({ left: 1455, top: 523, width: 38, height: 21 }).png().toBuffer();
  for (const [x, y] of [[1560, 562], [1556, 668], [1555, 653]]) {
    const screen = await sharp(base).composite([{ input: digits, left: x, top: y }]).png().toBuffer();
    const { result } = await readScan(screen, paddle.reader, data.ores, { detector: paddle.detector });
    assert.deepEqual(silentErrors(result, truth), [], `Einfügung bei ${x},${y}`);
  }
});

test('Erznamen: eindeutige Abkürzung nur sicher, wenn kein anderes Erz einen Buchstaben entfernt ist', () => {
  assert.deepEqual(matchOre('HEPH (RAW)', data.ores), { id: 'Raw_Hephaestanite', exact: true });
  assert.deepEqual(matchOre('QUARTZ (RAW)', data.ores), { id: 'Raw_Quartz', exact: true });
  assert.equal(matchOre('QUAR (RAW)', data.ores)?.exact, false, 'QUAN (Quantainium) ist einen Buchstaben entfernt');
  const lara = matchOre('LARA (RAW)', data.ores);
  if (lara) assert.equal(lara.exact, false, 'TARA (Taranite) ist einen Buchstaben entfernt');
});

test('Farbe: leicht grün/rot getöntes Weiß ist unsicher (Review-Fund)', () => {
  const solid = (r, g, b) => {
    const data = Buffer.alloc(30 * 20 * 3);
    for (let i = 0; i < 30 * 20; i++) {
      const on = i % 30 > 5 && i % 30 < 25 && Math.floor(i / 30) > 5 && Math.floor(i / 30) < 15;
      data.set(on ? [r, g, b] : [20, 20, 20], i * 3);
    }
    return { width: 30, height: 20, data };
  };
  for (const c of [[200, 222, 200], [222, 200, 200]]) {
    const res = textColor(solid(...c));
    assert.ok(res.color !== 'white' || res.share < 0.7, `${c}: ${JSON.stringify(res)}`);
  }
  assert.ok(textColor(solid(230, 232, 228)).share >= 0.7, 'echtes Weiß bleibt sicher');
});
