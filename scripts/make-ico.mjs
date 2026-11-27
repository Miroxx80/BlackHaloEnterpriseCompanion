// Erzeugt assets/icon.ico aus assets/icon.png (16–256 px, PNG-Einträge). Nur nötig, wenn sich das Logo ändert:
// node scripts/make-ico.mjs
// Grund: Das Icon-Werkzeug von electron-builder stürzt unter Windows teils ab (0xC0000005). Mit fertiger .ico
// wird es nicht gebraucht.
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const src = new URL('../assets/icon.png', import.meta.url);
const pngs = await Promise.all(SIZES.map((s) => sharp(src.pathname.replace(/^\/([A-Za-z]:)/, '$1')).resize(s, s).png().toBuffer()));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(SIZES.length, 4);
const dir = Buffer.alloc(16 * SIZES.length);
let offset = 6 + dir.length;
SIZES.forEach((s, i) => {
  const o = i * 16;
  dir[o] = s >= 256 ? 0 : s;
  dir[o + 1] = s >= 256 ? 0 : s;
  dir[o + 2] = 0;
  dir[o + 3] = 0;
  dir.writeUInt16LE(1, o + 4);
  dir.writeUInt16LE(32, o + 6);
  dir.writeUInt32LE(pngs[i].length, o + 8);
  dir.writeUInt32LE(offset, o + 12);
  offset += pngs[i].length;
});
writeFileSync(new URL('../assets/icon.ico', import.meta.url), Buffer.concat([header, dir, ...pngs]));
console.log('assets/icon.ico geschrieben');
