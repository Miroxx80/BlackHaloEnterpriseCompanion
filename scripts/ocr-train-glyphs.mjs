// Lernt die eigene Ziffernerkennung (src/modules/mining/data/ocr/glyphs.json) aus bestätigten Scans
// ("Alles geprüft" -> ocr-samples/confirmed). Sie bestätigt nur zweifelhafte Ziffern von PaddleOCR, siehe glyphs.ts.
//
// Aufruf (nach npm run build):
//   node scripts/ocr-train-glyphs.mjs <Ordner> [--loo] [--check <Ordner>]... [--dry]
//   --loo    ehrlich messen: jeder Scan mit einem Modell, das ohne ihn gelernt hat (dauert einige Minuten)
//   --check  zusätzlich an einem anderen Ordner messen (nie gelernt, z. B. Scans eines anderen Spielers)
//   --dry    Modell nicht schreiben
//   --scale=k  bei --loo die Scans zum Messen um die Bildmitte skalieren (anderes FOV nachstellen; gelernt wird
//            unverändert). Prüft, dass das Modell knapp neben FOV 86 nichts still falsch bestätigt.
// Scans, deren Bild auch in test/fixtures liegt, werden nicht gelernt: Die Tests prüfen das Modell an ihnen.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { screenFromCrop, tally, truthText, zoomScreen } from './ocr-compare.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { readScan } = await import(join(root, 'dist/modules/mining/ocr/pipeline.js'));
const { createPaddleDetector, createPaddleReader } = await import(join(root, 'dist/modules/mining/ocr/paddle.js'));
const G = await import(join(root, 'dist/modules/mining/ocr/glyphs.js'));
const { SAVED_CROPS } = await import(join(root, 'dist/modules/mining/ocr/layout.js'));
const data = JSON.parse(readFileSync(join(root, 'src/modules/mining/data/dataset.json'), 'utf8'));
const ocrDir = join(root, 'src/modules/mining/data/ocr');
const reader = createPaddleReader(ocrDir);
const detector = createPaddleDetector(ocrDir);

/**
 * Schwellen je Modell [pixel, shape]. Gemessen am 2026-11-27 an 82 Scans (FOV 86), jeder Scan nur mit Modellen ohne
 * ihn: falsch gelesene 0/6/8/9 erreichten höchstens pixel 0,80 (eine 0 in "7004", die wie eine 8 aussieht; shape dort
 * 0,90) und shape 0,97 (pixel dort 0,38); unsichere falsche Ziffern höchstens 0,67/0,68. Die frühere Wahl [0,8; 0,95]
 * lag nur knapp darüber und war an denselben Scans ausgesucht (Review). Jetzt mit festem Abstand: Kein bekannter
 * Fehler kommt näher als 0,09 an beide Schwellen zugleich heran. Mit --loo misst das Skript diesen Abstand neu und
 * schreibt ihn in glyphs.json (trainedOn); wird er kleiner, Schwellen prüfen.
 */
const THRESHOLDS = { lookalike: [0.9, 0.98], digit: [0.9, 0.98], agree: [0.3, 0.5] };
/** Spielraum um die gemessenen Zeilenabstände (px), in dem das Modell benutzt wird. */
const PITCH_MARGIN = 0.5;

const args = process.argv.slice(2);
const dir = args[0];
if (!dir || dir.startsWith('--')) {
  console.error('Ordner fehlt: node scripts/ocr-train-glyphs.mjs <ocr-samples/confirmed> [--loo] [--check <Ordner>] [--dry]');
  process.exit(1);
}
const zoom = Number(args.find((a) => a.startsWith('--scale='))?.slice('--scale='.length) ?? 1);
const checks = args.flatMap((a, i) => (a === '--check' && args[i + 1] ? [args[i + 1]] : []));

const pixelHash = async (input) => createHash('sha1').update(await sharp(input).removeAlpha().raw().toBuffer()).digest('hex');
/** Bilder der Tests (Suchbereich in einer der gespeicherten Größen), die nicht gelernt werden dürfen. */
async function fixtureHashes() {
  const out = new Set();
  const walk = async (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) await walk(p);
      else if (/\.(png|webp)$/.test(f)) {
        const m = await sharp(p).metadata();
        if (SAVED_CROPS.some((b) => b[2] === m.width && b[3] === m.height)) out.add(await pixelHash(p));
      }
    }
  };
  await walk(join(root, 'test', 'fixtures'));
  return out;
}

const screenOf = (folder, id) => screenFromCrop(join(folder, `${id}-panel.png`), SAVED_CROPS);

/** Scans lesen (ohne Ziffernerkennung), Ziffern mit der Wahrheit verbinden: nur bei gleicher Ziffernzahl. */
async function collect(folder, skip = new Set()) {
  const ids = readdirSync(folder).filter((f) => f.endsWith('-truth.json')).map((f) => f.slice(0, -'-truth.json'.length)).sort();
  const scans = [];
  for (const id of ids) {
    const truth = JSON.parse(readFileSync(join(folder, `${id}-truth.json`), 'utf8')).scan;
    const screen = await screenOf(folder, id);
    const reads = new Map();
    const { result } = await readScan(screen, reader, data.ores, { detector, trace: (key, image, kind, read) => reads.set(key, { image, kind, read }) });
    const samples = [];
    // Gelernt wird nur bei Maßstab 1: Nur dort benutzt die Erkennung das Modell (pipeline.ts, glyphsUsable)
    if (result.scale === 1) for (const [key, { image, kind, read }] of reads) {
      if (!/^(mass|resistance|instability|scu|parts\.\d+\.(pct|quality))$/.test(key) || !read?.chars?.length) continue;
      let chars = read.chars;
      if (kind === 'scu') {
        const end = chars.findIndex((c) => /[SCU ]/.test(c.c));
        if (end >= 0) chars = chars.slice(0, end);
      }
      const digits = chars.filter((c) => /\d/.test(c.c));
      const want = truthText(result, truth, key)?.replace(',', '.').replace(/m$/, '').replace(/\D/g, '');
      if (!want || want.length !== digits.length) continue;
      // r: von PaddleOCR gelesen (für den Abstand der Fehlurteile zu den Schwellen)
      G.glyphFeatures(image, digits.map((c) => c.at)).forEach((f, n) => f && samples.push({ f, t: want[n], r: digits[n].c }));
    }
    scans.push({ id, truth, screen, result, samples, learn: !skip.has(await pixelHash(join(folder, `${id}-panel.png`))) });
  }
  return scans;
}

const round = (v) => Number(v.toPrecision(5));
function train(scans, note) {
  const samples = scans.filter((s) => s.learn).flatMap((s) => s.samples);
  const pitches = scans.filter((s) => s.learn && s.result.scale === 1 && s.result.rowPitch != null).map((s) => s.result.rowPitch);
  const X = samples.map((s) => s.f);
  const y = samples.map((s) => s.t);
  const models = [G.trainClassifier('pixel', G.PIXEL_DIMS, X, y), G.trainClassifier('shape', G.SHAPE_DIMS, X, y)];
  return {
    version: G.GLYPH_VERSION,
    classes: G.DIGITS,
    thresholds: THRESHOLDS,
    rowPitch: [Math.min(...pitches) - PITCH_MARGIN, Math.max(...pitches) + PITCH_MARGIN],
    trainedOn: note ?? `${scans.filter((s) => s.learn).length} bestätigte Scans, ${samples.length} Ziffern`,
    models: models.map((m) => ({ ...m, mu: m.mu.map(round), sd: m.sd.map(round), w: m.w.map((row) => row.map(round)) })),
  };
}

async function measure(name, scans, modelFor, k = 1) {
  const before = tally();
  const after = tally();
  for (const s of scans) {
    const screen = k === 1 ? s.screen : await zoomScreen(s.screen, k);
    before.add(s.id, k === 1 ? s.result : (await readScan(screen, reader, data.ores, { detector })).result, s.truth);
    const { result } = await readScan(screen, reader, data.ores, { detector, glyphs: modelFor(s) });
    after.add(s.id, result, s.truth);
  }
  console.log(`\n=== ${name}: ohne Ziffernerkennung\n${before.summary(scans.length)}`);
  console.log(`=== ${name}: mit Ziffernerkennung\n${after.summary(scans.length)}`);
  for (const x of after.silent) console.log('  STILL FALSCH:', x);
  return after.silent.length;
}

/**
 * Abstand der Fehlurteile zu den Schwellen: Für jede von PaddleOCR falsch gelesene 0/6/8/9 der Anteil der gelesenen
 * Ziffer unter 0/6/8/9 in jedem Modell (Modell ohne diesen Scan gelernt). Bestätigt würde sie erst, wenn alle Modelle
 * über ihrer Schwelle liegen; margin = wie weit der knappste Fehler darunter bleibt (bei allen Modellen zugleich).
 */
function lookalikeMargin(scans, modelFor) {
  const worst = THRESHOLDS.lookalike.map(() => 0);
  let margin = Infinity;
  let n = 0;
  for (const s of scans) {
    const m = modelFor(s);
    for (const { f, t, r } of s.samples) {
      if (r === t || !'0689'.includes(r)) continue;
      n++;
      const share = m.models.map((c) => {
        const p = G.classify(c, f);
        const at = (d) => p[G.DIGITS.indexOf(d)];
        return at(r) / Math.max(1e-12, at('0') + at('6') + at('8') + at('9'));
      });
      share.forEach((v, k) => (worst[k] = Math.max(worst[k], v)));
      margin = Math.min(margin, Math.max(...share.map((v, k) => THRESHOLDS.lookalike[k] - v)));
    }
  }
  return { n, worst, margin };
}

const skip = await fixtureHashes();
const scans = await collect(dir, skip);
console.log(`${scans.length} Scans, davon ${scans.filter((s) => !s.learn).length} als Testbild ausgenommen; ${scans.filter((s) => s.learn).reduce((n, s) => n + s.samples.length, 0)} Ziffern zum Lernen`);
let model = train(scans);
let silent = 0;
if (args.includes('--loo')) {
  const loo = new Map(scans.map((s) => [s, train(scans.filter((o) => o !== s))]));
  const { n, worst, margin } = lookalikeMargin(scans, (s) => loo.get(s));
  const fmt = (v) => v.toFixed(2).replace('.', ',');
  const note = `je Scan ohne ihn gelernt: ${n} falsch gelesene 0/6/8/9, höchstens ${model.models.map((c, k) => `${c.name} ${fmt(worst[k])}`).join(' / ')}, ` +
    `knappster Fehler ${fmt(margin)} unter den Schwellen ${THRESHOLDS.lookalike.map(fmt).join(' / ')}`;
  console.log(`\nAbstand zu den Schwellen (${note})`);
  if (margin < 0.05) console.log('ACHTUNG: Abstand unter 0,05. Schwellen prüfen, bevor das Modell ausgeliefert wird.');
  model = { ...model, trainedOn: `${model.trainedOn}; ${note}` };
  silent += await measure(`jeder Scan ohne sich selbst gelernt${zoom !== 1 ? `, Maßstab ${zoom}` : ''}`, scans, (s) => loo.get(s), zoom);
}
for (const c of checks) silent += await measure(`Prüfordner ${c}`, await collect(c), () => model);
if (!args.includes('--dry')) {
  writeFileSync(join(ocrDir, 'glyphs.json'), JSON.stringify(model));
  console.log(`\nGeschrieben: src/modules/mining/data/ocr/glyphs.json (${model.trainedOn}, Zeilenabstand ${model.rowPitch.join('–')} px)`);
}
process.exit(silent ? 1 : 0);
