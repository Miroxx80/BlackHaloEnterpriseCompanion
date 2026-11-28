// Lernt die Schrift der Radar-Schilder (src/modules/mining/data/ocr/tagfont.json) aus markierten Schildern, siehe
// src/modules/mining/ocr/tagfont.ts. Quellen: test/fixtures/hud/signature/tags (Ausschnitte mit labels.json) und die
// Bänder in test/fixtures/hud/signature (Kasten aus BANDS unten).
//
// Aufruf (nach npm run build):
//   node scripts/ocr-train-tagfont.mjs [--dry]
// Misst immer zuerst ehrlich: jedes Schild mit einem Modell, das ohne alle Schilder desselben Werts gelernt hat
// (leave-one-value-out; ein Wert ist für das Modell dann so neu wie eine Signatur, die es nie gesehen hat).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const T = await import(join(root, 'dist/modules/mining/ocr/tagfont.js'));
const { matchSignature } = await import(join(root, 'dist/modules/mining/signature.js'));
const data = JSON.parse(readFileSync(join(root, 'src/modules/mining/data/dataset.json'), 'utf8'));
const dry = process.argv.includes('--dry');

/**
 * Schwellen (tagfont.ts), gemessen am 2026-11-28 an 31 Schildern aus dem Aaron Halo und den 3 Bändern, jedes Schild mit
 * einem Modell ohne seinen Wert, dazu je 18 Varianten (Kasten ±1–2 px, halbes Pixel verschoben, unscharf, heller/dunkler,
 * Gamma, JPEG, skaliert 0,85/1,2), 89 Schilder mit vertauschten Ziffern (andere, meist unbekannte Werte) und ~500 andere
 * Textkästen der Bänder (Cockpit, Entfernungen, UNKNOWN):
 * - slot 0: Kein falscher Wert hatte jede Ziffer als beste Ziffer (341 richtige freie Lesungen, 0 falsche; vertauschte
 *   Ziffern: 10 bekannte Werte richtig, 79 unbekannte nichts).
 * - veto 0 (reserviert, seit signatures.ts nur noch liest, wenn beide denselben Wert lesen, ungenutzt): PaddleOCR
 *   allein sollte am gefundenen Schild nur zählen, wenn dort auch jede seiner Ziffern die beste ist. Eine
 *   lockerere Schwelle trennt nicht: falsch gelesen wurde 3,840 statt 3,540 mit -0,081, richtige 19,275 lagen bei
 *   Modellen ohne dieses Bild bei -0,061/-0,073. In den echten Bildern kam keine richtige Lesung über diesen Weg.
 * - pin 0,4: richtige Schilder ab 0,48. Allein nicht trennscharf (Cockpit-Kästen bis ~0,5), entscheidend ist slot.
 */
const THRESHOLDS = { pin: 0.4, slot: 0.0, veto: 0.0 };

/** Bänder der Fixtures mit Kasten der Zahl (relativ zum Band). */
const BANDS = [
  { file: 'band-3400-orange.png', value: 3400, box: [319, 116, 34, 19] },
  { file: 'band-4180-prospector-pc-test.png', value: 4180, box: [315, 116, 42, 18] },
  { file: 'band-7200-green.png', value: 7200, box: [309, 186, 34, 10] },
];

const load = async (file) => {
  const { data: px, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: px };
};
const dir = join(root, 'test/fixtures/hud/signature');
const labels = JSON.parse(readFileSync(join(dir, 'tags', 'labels.json'), 'utf8'));
const samples = [];
for (const l of labels) samples.push({ name: l.file, img: await load(join(dir, 'tags', l.file)), box: l.box, value: l.value });
for (const b of BANDS) samples.push({ name: b.file, img: await load(join(dir, b.file)), box: b.box, value: b.value });

const lexicon = [];
for (let v = 1000; v <= 300_000; v += 5) if (matchSignature(v, data).exact) lexicon.push(v);

// Leave-one-value-out
const tally = { right: 0, wrong: 0, none: 0, notFound: 0 };
const lines = [];
for (const s of samples) {
  const model = T.trainTagFont(samples.filter((x) => x.value !== s.value), THRESHOLDS);
  const r = T.readTag(s.img, s.box, model, lexicon);
  const outcome = !r ? 'notFound' : r.value === null ? 'none' : r.value === s.value ? 'right' : 'wrong';
  tally[outcome]++;
  lines.push(`${s.name.padEnd(40)} ${String(s.value).padStart(6)} ${outcome.padEnd(8)} ${r ? `frei ${r.best?.free ?? '-'} Abstand ${r.best?.slotMargin.toFixed(3) ?? '-'} Pin ${r.pin.toFixed(2)}` : ''}`);
}
console.log(lines.join('\n'));
console.log(`Ohne den Wert gelernt: richtig ${tally.right}, falsch ${tally.wrong}, nichts ${tally.none}, kein Schild ${tally.notFound} (von ${samples.length})`);

const model = T.trainTagFont(samples, THRESHOLDS);
model.trainedOn = `${model.trainedOn}; je Wert ohne ihn gelernt: richtig ${tally.right}, falsch ${tally.wrong}, nichts ${tally.none + tally.notFound} von ${samples.length}`;
const round = (v) => v.map((x) => Math.round(x * 1e5) / 1e5);
const out = { ...model, templates: Object.fromEntries(Object.entries(model.templates).map(([c, v]) => [c, round(v)])), pinTemplate: round(model.pinTemplate) };
if (dry) console.log('--dry: nicht geschrieben');
else {
  writeFileSync(join(root, 'src/modules/mining/data/ocr/tagfont.json'), JSON.stringify(out) + '\n');
  console.log(`geschrieben: src/modules/mining/data/ocr/tagfont.json (${model.trainedOn})`);
}
