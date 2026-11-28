// Misst die OCR an bestätigten Scans ("Alles geprüft" -> ocr-samples/confirmed): Trefferquote, unnötig gelbe Felder
// und vor allem falsche Werte OHNE Markierung (die darf es nie geben).
// Aufruf: npm run build, dann  node scripts/ocr-eval.mjs <Ordner mit *-panel.png und *-truth.json> [--no-glyphs] [--scale=k]
// Unter Windows z. B.:          node scripts/ocr-eval.mjs %APPDATA%\BlackHalo\data\mining\ocr-samples\confirmed
// --no-glyphs: ohne die eigene Ziffernerkennung (data/ocr/glyphs.json). Achtung: Sind die Scans im Ordner auch die
// Lerndaten des Modells, ist das Ergebnis geschönt; ehrlich misst  node scripts/ocr-train-glyphs.mjs <Ordner> --loo
// Anderes FOV nachstellen: --scale=0.78 vergrößert/verkleinert den ganzen Screenshot um die Bildmitte (HUD-Maßstab).
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { screenFromCrop, tally, zoomScreen } from './ocr-compare.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { readScan } = await import(join(root, 'dist/modules/mining/ocr/pipeline.js'));
const { createPaddleDetector, createPaddleReader } = await import(join(root, 'dist/modules/mining/ocr/paddle.js'));
// Auch mit älteren Ständen nutzbar (Vergleich vorher/nachher): ohne glyphs.js keine Ziffernerkennung, ohne
// SAVED_CROPS nur der alte Suchbereich
const { loadGlyphModel } = await import(join(root, 'dist/modules/mining/ocr/glyphs.js')).catch(() => ({ loadGlyphModel: () => null }));
const layoutModule = await import(join(root, 'dist/modules/mining/ocr/layout.js'));
const SAVED_CROPS = layoutModule.SAVED_CROPS ?? [layoutModule.PROSPECTOR_1080.search];
const data = JSON.parse(readFileSync(join(root, 'src/modules/mining/data/dataset.json'), 'utf8'));
const ocrDir = join(root, 'src/modules/mining/data/ocr');
const reader = createPaddleReader(ocrDir);
const detector = createPaddleDetector(ocrDir);

const args = process.argv.slice(2);
const glyphs = args.includes('--no-glyphs') ? null : loadGlyphModel(ocrDir);
const dir = args.find((a) => !a.startsWith('--'));
const zoom = Number(args.find((a) => a.startsWith('--scale='))?.slice('--scale='.length) ?? 1);
if (!dir || !(zoom > 0)) {
  console.error('Ordner fehlt: node scripts/ocr-eval.mjs <ocr-samples/confirmed> [--no-glyphs] [--scale=k]');
  process.exit(1);
}
const ids = readdirSync(dir).filter((f) => f.endsWith('-truth.json')).map((f) => f.slice(0, -'-truth.json'.length)).sort();

const t = tally();
for (const id of ids) {
  const truth = JSON.parse(readFileSync(join(dir, `${id}-truth.json`), 'utf8')).scan;
  // Gespeichert ist der Suchbereich (aktuelle oder frühere Größe); zurück an seine Stelle in einem 1920x1080-Bild
  const screen = await screenFromCrop(join(dir, `${id}-panel.png`), SAVED_CROPS);
  const { result: r } = await readScan(zoom === 1 ? screen : await zoomScreen(screen, zoom), reader, data.ores, { detector, glyphs });
  const wrong = t.add(id, r, truth);
  console.log(`${id}  Versatz ${r.offset}${r.scale && r.scale !== 1 ? `  Maßstab ${r.scale.toFixed(3)}` : ''}  ${r.ms} ms  gelb ${Object.keys(r.marks).length}  ${wrong.length ? 'falsch: ' + wrong.join(', ') : 'alles richtig'}`);
}
console.log(`\nZiffernerkennung: ${glyphs ? glyphs.trainedOn ?? 'ja' : 'aus'}`);
console.log(t.summary(ids.length));
for (const s of t.silent) console.log('  STILL FALSCH:', s);
process.exit(t.silent.length ? 1 : 0);
