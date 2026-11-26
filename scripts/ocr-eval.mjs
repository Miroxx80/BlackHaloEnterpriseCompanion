// Misst die OCR an bestätigten Scans ("Alles geprüft" -> ocr-samples/confirmed): Trefferquote, unnötig gelbe Felder
// und vor allem falsche Werte OHNE Markierung (die darf es nie geben).
// Aufruf: npm run build, dann  node scripts/ocr-eval.mjs <Ordner mit *-panel.png und *-truth.json>
// Unter Windows z. B.:          node scripts/ocr-eval.mjs %APPDATA%\BlackHalo\data\mining\ocr-samples\confirmed
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { readScan } = await import(join(root, 'dist/modules/mining/ocr/pipeline.js'));
const { createPaddleDetector, createPaddleReader } = await import(join(root, 'dist/modules/mining/ocr/paddle.js'));
const { PROSPECTOR_1080 } = await import(join(root, 'dist/modules/mining/ocr/layout.js'));
const data = JSON.parse(readFileSync(join(root, 'src/modules/mining/data/dataset.json'), 'utf8'));
const ocrDir = join(root, 'src/modules/mining/data/ocr');
const reader = createPaddleReader(ocrDir);
const detector = createPaddleDetector(ocrDir);

const dir = process.argv[2];
if (!dir) {
  console.error('Ordner fehlt: node scripts/ocr-eval.mjs <ocr-samples/confirmed>');
  process.exit(1);
}
const ids = readdirSync(dir).filter((f) => f.endsWith('-truth.json')).map((f) => f.slice(0, -'-truth.json'.length)).sort();
const [sx, sy] = PROSPECTOR_1080.search;
const value = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return NaN;
  return s.endsWith('m') ? Number(s.slice(0, -1)) / 1000 : Number(s);
};

let fields = 0;
let right = 0;
let rightYellow = 0;
let wrongYellow = 0;
const silent = [];
const reasons = {};
for (const id of ids) {
  const truth = JSON.parse(readFileSync(join(dir, `${id}-truth.json`), 'utf8')).scan;
  // Gespeichert ist der Suchbereich; zurück an seine Stelle in einem 1920x1080-Bild
  const screen = await sharp({ create: { width: 1920, height: 1080, channels: 3, background: '#787878' } })
    .composite([{ input: join(dir, `${id}-panel.png`), left: sx, top: sy }])
    .png()
    .toBuffer();
  const { result: r } = await readScan(screen, reader, data.ores, { detector });
  const d = r.draft;
  const pctMarked = Object.keys(r.marks).some((k) => /^parts\.\d+\.pct$/.test(k));
  const pairs = ['mass', 'resistance', 'instability', 'scu', 'resColor', 'instColor'].map((k) => [k, d[k], truth[k]]);
  for (let i = 0; i < Math.max(d.parts.length, truth.parts.length); i++) {
    for (const f of ['pct', 'ore', 'quality']) pairs.push([`parts.${i}.${f}`, d.parts[i]?.[f], truth.parts[i]?.[f]]);
  }
  const wrong = [];
  for (const [k, read, want] of pairs) {
    fields++;
    const text = k.endsWith('Color') || k.endsWith('.ore');
    const emptyQuality = k.endsWith('.quality') && !Number(want || 0) && !Number(read || 0);
    const ok = emptyQuality || (text ? read === want : value(read) === value(want));
    // Fehlende Zeile gilt als gewarnt, wenn die Anteile markiert sind ("Fehlt eine Zeile?")
    const marked = Boolean(r.marks[k]) || (k.startsWith('parts.') && !d.parts[+k.split('.')[1]] && pctMarked);
    if (ok) {
      right++;
      if (marked) {
        rightYellow++;
        for (const why of r.reasons?.[k] ?? ['sonst']) reasons[why] = (reasons[why] ?? 0) + 1;
      }
    } else if (marked) {
      wrongYellow++;
      wrong.push(`${k}=${read ?? '-'}? (echt ${want ?? '-'})`);
    } else {
      silent.push(`${id}: ${k}=${read} (echt ${want})`);
      wrong.push(`${k}=${read} STILL (echt ${want})`);
    }
  }
  console.log(`${id}  Versatz ${r.offset}  gelb ${Object.keys(r.marks).length}  ${wrong.length ? 'falsch: ' + wrong.join(', ') : 'alles richtig'}`);
}
console.log(`\n${ids.length} Scans, ${fields} Felder: richtig ${right} (${((100 * right) / fields).toFixed(1)} %), davon unnötig gelb ${rightYellow}`);
console.log(`Falsch und gelb: ${wrongYellow}. FALSCH OHNE MARKIERUNG: ${silent.length}`);
console.log('Gründe für unnötiges Gelb:', reasons);
for (const s of silent) console.log('  STILL FALSCH:', s);
process.exit(silent.length ? 1 : 0);
