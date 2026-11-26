// Kopiert die Asset-Ordner der Module (src/modules/<id>/ui und /data) nach dist/modules/<id>/.
// tsc kompiliert nur TypeScript. Die UI besteht aus reinem JS/HTML/CSS ohne Build, data aus JSON-Dateien.
import { cpSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcModules = join(root, 'src', 'modules');
const distModules = join(root, 'dist', 'modules');

const ASSET_DIRS = ['ui', 'data'];

for (const id of readdirSync(srcModules)) {
  for (const name of ASSET_DIRS) {
    const dir = join(srcModules, id, name);
    if (existsSync(dir) && statSync(dir).isDirectory()) {
      cpSync(dir, join(distModules, id, name), { recursive: true });
    }
  }
}
console.log('Assets kopiert.');
