// Tests für das Einlesen von Screenshots (OCR-Grundgerüst): Farben, Auswertung, Schnittstelle.
// Die Texterkennung selbst ist austauschbar; hier wird alles geprüft, was unabhängig davon funktioniert.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { startApp } from '../dist/core/app.js';
import { loadScreen, crop, textColor, blockArtifacts } from '../dist/modules/mining/ocr/image.js';
import { PROSPECTOR_1080 } from '../dist/modules/mining/ocr/layout.js';
import { cleanNumber, matchOre, resolvePercents, zeroEightVariants, massScuPlausible } from '../dist/modules/mining/ocr/parse.js';
import { readScan } from '../dist/modules/mining/ocr/pipeline.js';
import { noReader } from '../dist/modules/mining/ocr/engine.js';
import { createPaddleDetector, createPaddleReader } from '../dist/modules/mining/ocr/paddle.js';
import { loadGlyphModel, validModel, glyphFeatures, classify, trainClassifier, PIXEL_DIMS, SHAPE_DIMS } from '../dist/modules/mining/ocr/glyphs.js';
import { matchParts, compareScan } from '../scripts/ocr-compare.mjs';
import { parseSignatureText, readSignatures, SignatureTracker } from '../dist/modules/mining/ocr/signatures.js';
import { matchSignature } from '../dist/modules/mining/signature.js';

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
  const app = await startApp({ overrides: { server: { host: '127.0.0.1', port: 0 }, modules: { controls: { driver: 'mock' }, dev: { saveOcrSamples: true } } }, dataRoot });
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
// Mit der eigenen Ziffernerkennung wie in der App. Sie hat die Testbilder nie gelernt (ocr-train-glyphs.mjs nimmt
// Scans aus, deren Bild in test/fixtures liegt): Die Tests prüfen sie also an fremden Bildern.
const paddle = { reader: createPaddleReader(OCR_DIR), detector: createPaddleDetector(OCR_DIR), glyphs: loadGlyphModel(OCR_DIR) };

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
    const { result, panelPng } = await readScan(screen, paddle.reader, data.ores, { detector: paddle.detector, glyphs: paddle.glyphs });
    assert.ok(result.panelFound);
    assert.ok(Math.abs(result.offset[0] - dx) <= 4 && Math.abs(result.offset[1] - dy) <= 4, `Versatz ${result.offset}`);
    const d = result.draft;
    assert.equal(d.mass, String(truth.mass));
    assert.deepEqual(d.parts.map((p) => p.ore), ['Raw_Silicon', 'Raw_Hephaestanite', 'Raw_Hephaestanite', 'Raw_Quartz', 'inert']);
    assert.deepEqual(silentErrors(result, truth), []);
    assert.ok(!result.marks['parts.0.ore'] && !result.marks['parts.4.ore'], `eindeutige Erznamen nicht markiert: ${result.raw['parts.0.ore']} / ${result.raw['parts.4.ore']}`);
    assert.equal(result.scale, 1);
    // Beispielbild enthält den ganzen (erweiterten) Suchbereich
    const meta = await sharp(panelPng).metadata();
    assert.equal(`${meta.width}x${meta.height}`, `${PROSPECTOR_1080.wide[2]}x${PROSPECTOR_1080.wide[3]}`);
  });
}

test('PC-Test-Bilder mit bekannten Werten: kein falscher Wert und kein falsches Erz unmarkiert', async () => {
  const truths = JSON.parse(readFileSync(new URL('./fixtures/hud/panel-2026-11-26/regions.json', import.meta.url), 'utf8'));
  for (const [file, truth] of Object.entries(truths)) {
    // Suchbereich (576x608 ab 1184,392) zurück an seine Stelle im Bild
    const screen = await sharp({ create: { width: 1920, height: 1080, channels: 3, background: '#787878' } })
      .composite([{ input: await sharp(fixture(`hud/panel-2026-11-26/${file}`)).png().toBuffer(), left: 1184, top: 392 }]).png().toBuffer();
    const { result } = await readScan(screen, paddle.reader, data.ores, { detector: paddle.detector, glyphs: paddle.glyphs });
    assert.ok(result.panelFound, file);
    assert.deepEqual(silentErrors(result, truth), [], file);
    // Farbe wie im Spiel (meist weiß; der Farbsaum darf nicht als grün/rot gelten)
    assert.deepEqual([result.draft.resColor, result.draft.instColor], [truth.resistance.color ?? 'white', truth.instability.color ?? 'white'], file);
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
    const { result } = await readScan(screen, paddle.reader, data.ores, { detector: paddle.detector, glyphs: paddle.glyphs });
    assert.ok(result.panelFound, `Scan ${i + 1}`);
    assert.ok(Math.abs(result.offset[0] - ex) <= 4 && Math.abs(result.offset[1] - ey) <= 4, `Scan ${i + 1}: Versatz ${result.offset}`);
    assert.ok(result.anchors.length >= 3, `Scan ${i + 1}: ${result.anchors}`);
  }
  // Ohne Panel: nichts gefunden
  const empty = await sharp({ create: { width: 1920, height: 1080, channels: 3, background: '#787878' } }).png().toBuffer();
  assert.equal((await readScan(empty, paddle.reader, data.ores, { detector: paddle.detector, glyphs: paddle.glyphs })).result.panelFound, false);
});

/** Screenshot um die Bildmitte skalieren, wie sich das HUD mit dem FOV ändert (k < 1: höheres FOV), wieder 1920x1080. */
async function zoomScreen(buf, k) {
  const [w, h] = [Math.round(1920 * k), Math.round(1080 * k)];
  const big = await sharp(buf).removeAlpha().resize(w, h, { kernel: 'lanczos3' }).png().toBuffer();
  if (k >= 1) return sharp(big).extract({ left: Math.round((w - 1920) / 2), top: Math.round((h - 1080) / 2), width: 1920, height: 1080 }).png().toBuffer();
  return sharp({ create: { width: 1920, height: 1080, channels: 3, background: '#787878' } })
    .composite([{ input: big, left: Math.round((1920 - w) / 2), top: Math.round((1080 - h) / 2) }]).png().toBuffer();
}

/** Gespeicherten Suchbereich (576x608 ab 1184,392) zurück an seine Stelle in einem 1920x1080-Bild. */
const regionScreen = async (input) =>
  sharp({ create: { width: 1920, height: 1080, channels: 3, background: '#787878' } })
    .composite([{ input: await sharp(input).png().toBuffer(), left: 1184, top: 392 }]).png().toBuffer();

/** Erze und Zeilen: alle Zeilen da (keine verloren), jedes Erz richtig oder markiert. */
function checkRows(result, truth, what) {
  assert.equal(result.draft.parts.length, truth.parts.length, `${what}: Zeilen ${result.draft.parts.map((p) => p.pct)}`);
  const wrongOre = truth.parts.map((p, i) => i).filter((i) => result.draft.parts[i].ore !== truth.parts[i].ore && !result.marks[`parts.${i}.ore`]);
  assert.deepEqual(wrongOre, [], `${what}: falsches Erz unmarkiert`);
}

for (const k of [0.78, 1.15]) {
  test(`Anderes FOV (HUD-Maßstab ${k}): Maßstab erkannt, gleiche Werte gelesen oder markiert, keine Zeile verloren`, async () => {
    const helix = JSON.parse(readFileSync(new URL('./fixtures/hud/prospector-helix1-20pct.json', import.meta.url), 'utf8')).scan;
    const ids = ['Raw_Silicon', 'Raw_Hephaestanite', 'Raw_Hephaestanite', 'Raw_Quartz', 'inert']; // Namen wie im HUD -> Kennungen
    helix.parts = helix.parts.map((p, i) => ({ ...p, ore: ids[i] }));
    const regions = JSON.parse(readFileSync(new URL('./fixtures/hud/panel-2026-11-26/regions.json', import.meta.url), 'utf8'));
    const cases = [
      ['Vollbild Helix', await sharp(fixture(HUD[0])).resize(1920, 1080, { fit: 'fill' }).png().toBuffer(), helix],
      ['region-rock-3698kg', await regionScreen(fixture('hud/panel-2026-11-26/region-rock-3698kg.webp')), regions['region-rock-3698kg.webp']],
    ];
    for (const [what, screen, truth] of cases) {
      // Mit Ziffernerkennung wie in der App, Zeilenabstand-Sperre absichtlich weit: Sie darf trotzdem nicht greifen
      const wide = { ...paddle.glyphs, rowPitch: [5, 40] };
      const { result } = await readScan(await zoomScreen(screen, k), paddle.reader, data.ores, { detector: paddle.detector, glyphs: wide });
      assert.ok(result.panelFound, what);
      assert.ok(Math.abs(result.scale - k) <= 0.03, `${what}: Maßstab ${result.scale}`);
      assert.deepEqual(silentErrors(result, truth), [], what);
      assert.deepEqual([result.draft.resColor, result.draft.instColor], [truth.resistance.color ?? 'white', truth.instability.color ?? 'white'], what);
      checkRows(result, truth, what);
    }
  });
}

test('FOV 100 (echte Scans eines Freundes): Panel ~0,86x erkannt, erste Zeile unter dem Balken gelesen, nichts still falsch', async () => {
  const dir = new URL('./fixtures/hud/panel-fov100/', import.meta.url);
  const ids = readdirSync(dir).filter((f) => f.endsWith('-truth.json')).map((f) => f.slice(0, -'-truth.json'.length));
  assert.equal(ids.length, 2);
  for (const id of ids) {
    // Format wie bei "Alles geprüft" (Texte) -> wie regions.json (Zahlen, Werte mit Farbe)
    const scan = JSON.parse(readFileSync(new URL(`${id}-truth.json`, dir), 'utf8')).scan;
    const truth = {
      mass: Number(scan.mass), scu: Number(scan.scu),
      resistance: { value: Number(scan.resistance), color: scan.resColor }, instability: { value: Number(scan.instability), color: scan.instColor },
      parts: scan.parts.map((p) => ({ pct: Number(p.pct), ore: p.ore, quality: Number(p.quality || 0) })),
    };
    const { result } = await readScan(await regionScreen(fixture(`hud/panel-fov100/${id}-panel.png`)), paddle.reader, data.ores, { detector: paddle.detector });
    assert.ok(result.panelFound, id);
    assert.ok(result.scale > 0.83 && result.scale < 0.9, `${id}: Maßstab ${result.scale}`);
    assert.ok(result.offset[0] < -40, `${id}: Panel weiter links (${result.offset})`);
    assert.deepEqual(silentErrors(result, truth), [], id);
    assert.deepEqual([result.draft.resColor, result.draft.instColor], ['white', 'white'], id);
    checkRows(result, truth, id);
    // Diese beiden Scans liest die OCR vollständig richtig (markiert ist trotzdem einiges)
    assert.deepEqual(result.draft.parts.map((p) => Number(p.pct)), truth.parts.map((p) => p.pct), id);
    assert.equal(Number(result.draft.mass), truth.mass, id);
    // Zeilenabstand im Screenshot (nicht im umgerechneten Bild): kleiner als bei FOV 86
    assert.ok(result.rowPitch > 15 && result.rowPitch < 18, `${id}: Zeilenabstand ${result.rowPitch}`);
    // Eigene Ziffernerkennung hat nur FOV 86 gelernt: bei umgerechnetem Panel nie benutzt (gleiche Markierungen)
    const withGlyphs = (await readScan(await regionScreen(fixture(`hud/panel-fov100/${id}-panel.png`)), paddle.reader, data.ores, { detector: paddle.detector, glyphs: paddle.glyphs })).result;
    assert.deepEqual(withGlyphs.marks, result.marks, `${id}: Ziffernerkennung bei anderem Maßstab benutzt`);
    assert.deepEqual(withGlyphs.draft, result.draft, id);
  }
});

test('Maßstab nicht sicher bestimmbar (nur zwei Beschriftungen): alle Werte markiert', async () => {
  // RES:, INST: und COMP. übermalen: Es bleiben RESULTS und MASS, daraus lässt sich der Maßstab nicht prüfen
  const base = await sharp(fixture(HUD[0])).resize(1920, 1080, { fit: 'fill' }).png().toBuffer();
  const patch = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: '#000000' } }).png().toBuffer();
  const screen = await sharp(base)
    .composite([
      { input: await patch(46, 22), left: 1360, top: 545 },
      { input: await patch(46, 22), left: 1360, top: 565 },
      { input: await patch(62, 24), left: 1360, top: 616 },
    ])
    .png()
    .toBuffer();
  const { result } = await readScan(screen, paddle.reader, data.ores, { detector: paddle.detector });
  assert.ok(result.panelFound);
  assert.deepEqual(result.anchors.sort(), ['mass', 'results']);
  for (const k of ['mass', 'resistance', 'instability', 'scu', 'resColor', 'instColor', 'parts.0.pct', 'parts.0.ore', 'parts.0.quality']) {
    assert.equal(result.marks[k], 'check', k);
  }
  assert.ok(result.notes.some((n) => /nicht sicher erkannt/.test(n)), result.notes.join(' | '));
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
  const app = await startApp({ overrides: { server: { host: '127.0.0.1', port: 0 }, modules: { controls: { driver: 'mock' }, dev: { saveOcrSamples: true } } }, dataRoot });
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
    const { result } = await readScan(screen, paddle.reader, data.ores, { detector: paddle.detector, glyphs: paddle.glyphs });
    assert.deepEqual(silentErrors(result, truth), [], `Einfügung bei ${x},${y}`);
  }
});

test('Erznamen: ganzer kurzer Name mit sauberer Form ist sicher, ähnliche Namen nicht', () => {
  assert.deepEqual(matchOre('TIN (ORE)', data.ores), { id: 'Ore_Tin', exact: true }); // "TIT..." betrifft nur Abkürzungen
  assert.deepEqual(matchOre('TIN(ORE)', data.ores), { id: 'Ore_Tin', exact: true });
  assert.equal(matchOre('TINCORE)', data.ores).exact, false, 'Form verstümmelt');
  assert.equal(matchOre('TIN', data.ores).exact, false, 'ohne Form');
  assert.equal(matchOre('TARANITE (RAW)', data.ores).exact, false, 'LARANITE ist einen Buchstaben entfernt');
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

test('Radar-Signatur: Zahl lesen, Pin abschneiden, Text ablehnen', () => {
  assert.deepEqual(parseSignatureText('16,960'), { value: 16960, separator: true });
  assert.deepEqual(parseSignatureText('7.200'), { value: 7200, separator: true });
  assert.deepEqual(parseSignatureText('3400'), { value: 3400, separator: false });
  assert.equal(parseSignatureText('UNKNOWN'), null);
  assert.equal(parseSignatureText('11.4K'), null);
  assert.equal(parseSignatureText('90'), null);
  assert.equal(parseSignatureText('999,999'), null);
});

test('Radar-Signatur live: Marker im Band gefunden (orange und grün), kein Fehlgriff auf UNKNOWN/Entfernung', async () => {
  const isKnown = (v) => matchSignature(v, data).exact;
  for (const [file, want] of [['band-3400-orange.png', 3400], ['band-7200-green.png', 7200], ['band-4180-prospector-pc-test.png', 4180]]) {
    const { data: px, info } = await sharp(fixture(`hud/signature/${file}`)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const reads = await readSignatures({ width: info.width, height: info.height, data: px }, paddle.reader, paddle.detector, isKnown);
    assert.deepEqual(reads.map((r) => r.value), [want], file);
  }
});

test('Radar-Signatur: Bestätigung über mehrere Bilder, Halten, feste Anzeigen ignorieren', () => {
  const isKnown = (v) => matchSignature(v, data).exact;
  const r = (value, extra = {}) => ({ value, text: String(value), confidence: 0.9, separator: true, ambiguous: false, x: 900, y: 400, ...extra });
  const t = new SignatureTracker(isKnown, { windowMs: 20000, holdMs: 45000, singleConfidence: 0.97, stuckFrames: 5 });
  t.add([r(16960)], 0);
  assert.equal(t.contacts(0).length, 0, 'eine unsichere Lesung reicht nicht');
  t.add([r(16960)], 800);
  assert.deepEqual(t.contacts(800).map((c) => c.value), [16960]);
  // Einmal sehr sicher, mit Komma und bekannter Signatur: sofort
  t.add([r(6370, { confidence: 0.99, x: 700 })], 1000);
  assert.ok(t.contacts(1000).some((c) => c.value === 6370));
  // Sicher, aber mit 0/6/8/9-Zweifel: nicht sofort
  t.add([r(12000, { confidence: 0.99, ambiguous: true, x: 600 })], 1200);
  assert.ok(!t.contacts(1200).some((c) => c.value === 12000));
  // Unbekannter Wert (auch mit Komma) braucht 3 Lesungen
  t.add([r(12345, { x: 500 })], 1300);
  t.add([r(12345, { x: 500 })], 1400);
  assert.ok(!t.contacts(1400).some((c) => c.value === 12345));
  t.add([r(12345, { x: 500 })], 1500);
  assert.ok(t.contacts(1500).some((c) => c.value === 12345));
  // Halten und verfallen
  assert.ok(t.contacts(40000).some((c) => c.value === 16960));
  assert.ok(!t.contacts(50000).some((c) => c.value === 16960));
  // Gleicher Wert an gleicher Stelle über viele Bilder: Cockpit-Anzeige, wird ignoriert
  const s = new SignatureTracker(isKnown, { windowMs: 20000, holdMs: 45000, singleConfidence: 0.97, stuckFrames: 5 });
  for (let i = 0; i < 6; i++) s.add([r(8390, { x: 1200, y: 300 })], i * 800);
  assert.equal(s.contacts(5000).length, 0);
});

test('API: Live-Lesen über die Desktop-App (Attrappe), an/aus, Kontakte an alle Geräte', async () => {
  const band = await sharp(fixture('hud/signature/band-3400-orange.png')).png().toBuffer();
  const regions = [];
  const capture = async (region) => {
    regions.push(region);
    return band;
  };
  const opts = { overrides: { server: { host: '127.0.0.1', port: 0 }, modules: { controls: { driver: 'mock' }, mining: { signatureIntervalMs: 300 } } }, dataRoot: mkdtempSync(join(tmpdir(), 'bh-live-')) };
  const app = await startApp({ ...opts, services: { 'desktop.screen': { capture } } });
  const base = `http://127.0.0.1:${app.port}/api/mining`;
  const post = (on) => fetch(`${base}/signature/live`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on }) });
  try {
    assert.equal((await (await fetch(`${base}/signature/live`)).json()).capture, true);
    assert.equal((await post('ja')).status, 400);
    assert.equal((await post(true)).status, 200);
    let state;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      state = await (await fetch(`${base}/signature/live`)).json();
      if (state.contacts.length) break;
    }
    assert.equal(state.on, true);
    assert.deepEqual(state.contacts.map((c) => c.value), [3400]);
    assert.equal(state.contacts[0].candidates[0].label, 'Lindinium');
    assert.deepEqual(regions[0], { x: 636, y: 230, width: 648, height: 352 });
    assert.equal((await (await post(false)).json()).on, false);
    const n = regions.length;
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(regions.length, n, 'aus = keine Aufnahmen mehr');
  } finally {
    await app.stop();
  }
  // Ohne Desktop-App: abgelehnt
  const plain = await startApp({ ...opts, dataRoot: mkdtempSync(join(tmpdir(), 'bh-live-')) });
  try {
    const res = await fetch(`http://127.0.0.1:${plain.port}/api/mining/signature/live`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"on":true}' });
    assert.equal(res.status, 501);
  } finally {
    await plain.stop();
  }
});

/** Suchbereich eines Testbilds aus panel-2026-11-26 zurück an seine Stelle in einem 1920x1080-Bild. */
const pcTestScreen = (file) => regionScreen(fixture(`hud/panel-2026-11-26/${file}`));

test('Eigene Ziffernerkennung: Modell gültig, ändert nie einen Wert, neue Markierungen nur als Widerspruch, kein Fehler still', async () => {
  assert.ok(paddle.glyphs, 'data/ocr/glyphs.json fehlt oder passt nicht (scripts/ocr-train-glyphs.mjs)');
  assert.ok(paddle.glyphs.models.some((m) => m.dims === PIXEL_DIMS) && paddle.glyphs.models.some((m) => m.dims === SHAPE_DIMS));
  assert.equal(validModel({ ...paddle.glyphs, version: 1 }), false, 'alte Version wird nicht benutzt');
  assert.equal(validModel({ ...paddle.glyphs, thresholds: { ...paddle.glyphs.thresholds, lookalike: [0.1, 0.1] } }), false, 'zu lockere Schwelle');
  assert.equal(loadGlyphModel(tmpdir()), null, 'ohne Datei: keine Ziffernerkennung');
  const truths = JSON.parse(readFileSync(new URL('./fixtures/hud/panel-2026-11-26/regions.json', import.meta.url), 'utf8'));
  let removed = 0;
  for (const [file, truth] of Object.entries(truths)) {
    const screen = await pcTestScreen(file);
    const plain = (await readScan(screen, paddle.reader, data.ores, { detector: paddle.detector })).result;
    const withGlyphs = (await readScan(screen, paddle.reader, data.ores, { detector: paddle.detector, glyphs: paddle.glyphs })).result;
    assert.deepEqual(withGlyphs.draft, plain.draft, `${file}: Werte dürfen sich nie ändern`);
    // Zusätzlich markieren darf sie nur, wenn ein Modell einer Ziffer widerspricht (glyph)
    for (const k of Object.keys(withGlyphs.marks)) assert.ok(plain.marks[k] || withGlyphs.reasons[k]?.includes('glyph'), `${file}: neue Markierung ${k}`);
    removed += Object.keys(plain.marks).filter((k) => !withGlyphs.marks[k]).length;
    assert.deepEqual(silentErrors(withGlyphs, truth), [], file);
    // Andere HUD-Größe (FOV): Zeilenabstand außerhalb des gelernten Bereichs -> nichts bestätigen
    const otherFov = { ...paddle.glyphs, rowPitch: [10, 12] };
    const gated = (await readScan(screen, paddle.reader, data.ores, { detector: paddle.detector, glyphs: otherFov })).result;
    assert.deepEqual(gated.marks, plain.marks, `${file}: bei anderem FOV keine Bestätigung`);
  }
  assert.ok(removed > 0, 'an den (nie gelernten) Testbildern wird mindestens ein Zweifel bestätigt');
});

test('Eigene Ziffernerkennung: Merkmale und Lernen (kleines Beispiel)', () => {
  // Zwei künstliche Ziffern: senkrechter Strich ("1") und Ring ("0"), je leicht verschoben
  const glyph = (kind, shift) => {
    const w = 30;
    const h = 20;
    const px = Buffer.alloc(w * h * 3, 20);
    const cx = 15 + shift;
    for (let y = 5; y < 15; y++) {
      for (let x = 0; x < w; x++) {
        const ring = Math.abs(x - (cx - 3)) <= 1 || Math.abs(x - (cx + 3)) <= 1 || ((y <= 6 || y >= 13) && Math.abs(x - cx) <= 3);
        if (kind === '1' ? Math.abs(x - cx) <= 1 : ring) px.fill(240, (y * w + x) * 3, (y * w + x) * 3 + 3);
      }
    }
    return glyphFeatures({ width: w, height: h, data: px }, [(cx - 2) / w])[0];
  };
  const X = [];
  const y = [];
  for (const shift of [-1, 0, 1]) {
    for (const d of ['0', '1']) {
      X.push(glyph(d, shift));
      y.push(d);
    }
  }
  assert.ok(X.every((f) => f && f.length === SHAPE_DIMS));
  const m = trainClassifier('shape', SHAPE_DIMS, X, y, { epochs: 200 });
  const p = classify(m, glyph('0', 0.5));
  assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(p[0] > p[1], 'Ring als 0 erkannt');
});

/**
 * Liest wie PaddleOCR, verändert aber jede Zahl mit `change` (Zeichenliste -> neue Zeichenliste oder null), z. B. um
 * Lesefehler nachzustellen. Zweite Lesung (helle Pixel) unverändert.
 */
function forgingReader(change) {
  const counts = { changed: 0 };
  return {
    counts,
    name: paddle.reader.name,
    async read(image, kind, opts) {
      const r = await paddle.reader.read(image, kind, opts);
      if (!r?.chars?.length || opts?.variant || !['integer', 'number', 'scu'].includes(kind)) return r;
      const chars = change(r.chars);
      if (!chars) return r;
      counts.changed++;
      return { ...r, text: chars.map((c) => c.c).join(''), chars, ambiguous: chars.some((c) => c.amb), confidence: Math.min(...chars.map((c) => c.p)) };
    },
  };
}

test('Ziffernerkennung hebt keinen Zweifel auf, wenn zwei gleiche Ziffern zu einer verschmolzen sind ("22.65" -> "2.65")', async () => {
  // Gieriges CTC: "22" wird als eine 2 gelesen, die übrige Ziffer ist unsicher. Die Ziffernerkennung sieht dort eine
  // gute 2; sie darf den Zweifel nur aufheben, wo die Zahl der Ziffern anders geprüft ist (Review-Fund).
  const merge = forgingReader((chars) => {
    const i = chars.findIndex((c, k) => k > 0 && /\d/.test(c.c) && c.c === chars[k - 1].c);
    if (i < 0) return null;
    return chars.filter((_, k) => k !== i).map((c, k) => (k === i - 1 ? { ...c, p: 0.5, ...('0689'.includes(c.c) ? { amb: true } : {}) } : c));
  });
  const truths = JSON.parse(readFileSync(new URL('./fixtures/hud/panel-2026-11-26/regions.json', import.meta.url), 'utf8'));
  for (const file of ['region-confirmed-10323kg.png', 'region-dark-ice-2296kg.png', 'region-confirmed-inst-85.png', 'region-dark-ice-3312kg.png']) {
    const { result } = await readScan(await pcTestScreen(file), merge, data.ores, { detector: paddle.detector, glyphs: paddle.glyphs });
    assert.deepEqual(silentErrors(result, truths[file]), [], file);
  }
  assert.ok(merge.counts.changed >= 6, `zu wenig verschmolzene Zahlen: ${merge.counts.changed}`);
});

test('Ziffernerkennung widerspricht einer sicher, aber falsch gelesenen 0/8 (glyph)', async () => {
  // PaddleOCR liest manchmal eine durchgestrichene 0 mit über 0,995 als 8 (Review-Fund): nachgestellt, indem die
  // erste 0 bzw. 8 einer Zahl sicher zur anderen wird
  const swap = forgingReader((chars) => {
    const i = chars.findIndex((c) => c.c === '0' || c.c === '8');
    if (i < 0) return null;
    return chars.map((c, k) => (k === i ? { ...c, c: c.c === '0' ? '8' : '0', p: 0.999, amb: undefined } : c));
  });
  const truths = JSON.parse(readFileSync(new URL('./fixtures/hud/panel-2026-11-26/regions.json', import.meta.url), 'utf8'));
  let vetoed = 0;
  for (const file of ['region-confirmed-10323kg.png', 'region-confirmed-6079kg.png', 'region-dark-ice-3312kg.png', 'region-confirmed-6859kg.png']) {
    const { result } = await readScan(await pcTestScreen(file), swap, data.ores, { detector: paddle.detector, glyphs: paddle.glyphs });
    assert.deepEqual(silentErrors(result, truths[file]), [], file);
    vetoed += Object.values(result.reasons).filter((r) => r.includes('glyph')).length;
  }
  assert.ok(swap.counts.changed >= 8 && vetoed >= 3, `vertauscht ${swap.counts.changed}, widersprochen ${vetoed}`);
});

test('JPEG oder andere Auflösung: erkannt, Ziffernerkennung bestätigt nichts, nichts still falsch', async () => {
  const truths = JSON.parse(readFileSync(new URL('./fixtures/hud/panel-2026-11-26/regions.json', import.meta.url), 'utf8'));
  for (const file of ['region-confirmed-6079kg.png', 'region-confirmed-10323kg.png']) {
    const png = await pcTestScreen(file);
    const area = PROSPECTOR_1080.search;
    assert.ok(blockArtifacts(await loadScreen(png, PROSPECTOR_1080), area) < 0.15, `${file}: PNG gilt als verlustfrei`);
    for (const [what, input] of [
      ['JPEG', await sharp(png).jpeg({ quality: 80 }).toBuffer()],
      ['JPEG als PNG', await sharp(await sharp(png).jpeg({ quality: 80 }).toBuffer()).png().toBuffer()],
      ['1280x720', await sharp(png).resize(1280, 720, { kernel: 'lanczos3' }).png().toBuffer()],
    ]) {
      if (what.startsWith('JPEG')) assert.ok(blockArtifacts(await loadScreen(input, PROSPECTOR_1080), area) > 0.15, `${file} ${what}: JPEG erkannt`);
      const plain = (await readScan(input, paddle.reader, data.ores, { detector: paddle.detector })).result;
      const withGlyphs = (await readScan(input, paddle.reader, data.ores, { detector: paddle.detector, glyphs: paddle.glyphs })).result;
      assert.ok(withGlyphs.notes.some((n) => /verlustbehaftet|anderer Auflösung/.test(n)), `${file} ${what}: ${withGlyphs.notes.join(' | ')}`);
      for (const k of Object.keys(plain.marks)) assert.ok(withGlyphs.marks[k], `${file} ${what}: ${k} bestätigt`);
      assert.deepEqual(silentErrors(withGlyphs, truths[file]), [], `${file} ${what}`);
    }
  }
});

test('Anteil einer Zeile unlesbar: Qualität dieser Zeile wird mitmarkiert (könnte zur Nachbarzeile gehören)', async () => {
  // Punkt im Anteil verloren ("978%" statt "9.78%"): Formfehler
  const noDot = forgingReader((chars) => (chars.at(-1)?.c === '%' && chars.some((c) => c.c === '.') ? chars.filter((c) => c.c !== '.') : null));
  const { result } = await readScan(await pcTestScreen('region-confirmed-6079kg.png'), noDot, data.ores, { detector: paddle.detector, glyphs: paddle.glyphs });
  const rows = result.draft.parts.map((_, i) => i).filter((i) => result.reasons[`parts.${i}.pct`]?.includes('format'));
  assert.ok(rows.length >= 2, JSON.stringify(result.reasons));
  for (const i of rows) assert.ok(result.reasons[`parts.${i}.quality`]?.includes('box'), `Zeile ${i}: ${result.reasons[`parts.${i}.quality`]}`);
});

test('Formprüfung: führende Null ("05.56" statt 85.56) wird markiert, auch neben bestätigten Ziffern', async () => {
  const { result } = await readScan(await pcTestScreen('region-confirmed-inst-85.png'), paddle.reader, data.ores, { detector: paddle.detector, glyphs: paddle.glyphs });
  if (result.draft.instability !== '85.56') assert.ok(result.marks.instability, `Instabilität ${result.draft.instability} unmarkiert`);
  if (/^0\d/.test(result.draft.instability)) assert.ok(result.reasons.instability.includes('format'));
});

test('Auswertung (ocr-eval): Zeilen ohne Rücksicht auf die Reihenfolge zuordnen, leere Wahrheit zählt nicht', () => {
  const part = (pct, ore, quality) => ({ pct, ore, quality });
  // Die OCR fand die erste Zeile nicht; die Wahrheit hat sie am Ende nachgetragen
  const truth = { mass: '100', resistance: '0', instability: '1.00', scu: '', resColor: 'white', instColor: 'white', parts: [part('50.00', 'Ore_Tin', '537'), part('40.00', 'inert', '0'), part('10.00', 'Ore_Copper', '359')] };
  const read = [part('50.00', 'Ore_Tin', '537'), part('40.00', 'inert', '0')];
  assert.deepEqual(matchParts([read[1], read[0]], truth.parts), [1, 0]);
  const result = { draft: { mass: '100', resistance: '0', instability: '1.00', scu: '7.00', resColor: 'white', instColor: 'white', parts: read }, marks: { 'parts.0.pct': 'check' } };
  const fields = compareScan(result, truth);
  assert.ok(!fields.some((f) => f.key === 'scu'), 'SCU nicht eingetragen: nicht geprüft');
  assert.deepEqual(fields.filter((f) => !f.ok).map((f) => f.key), ['parts.2.pct', 'parts.2.ore', 'parts.2.quality']);
  assert.ok(fields.filter((f) => !f.ok).every((f) => f.marked), 'fehlende Zeile gilt als gewarnt, wenn ein Anteil markiert ist');
});
