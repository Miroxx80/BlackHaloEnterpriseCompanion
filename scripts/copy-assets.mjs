// Kopiert die UI-Ordner der Module (src/modules/<id>/ui) nach dist/modules/<id>/ui.
// tsc kompiliert nur TypeScript, die UI besteht aus reinem JS/HTML/CSS ohne Build.
import { cpSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcModules = join(root, 'src', 'modules');
const distModules = join(root, 'dist', 'modules');

for (const id of readdirSync(srcModules)) {
  const ui = join(srcModules, id, 'ui');
  if (existsSync(ui) && statSync(ui).isDirectory()) {
    cpSync(ui, join(distModules, id, 'ui'), { recursive: true });
  }
}
console.log('Assets kopiert.');
