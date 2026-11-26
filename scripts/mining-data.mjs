// Erzeugt den Ausrüstungs-Datensatz für das Mining-Modul aus scunpacked-data (Spieldaten pro LIVE-Build).
//
//   node scripts/mining-data.mjs            -> neuester Stand
//   node scripts/mining-data.mjs <commit>   -> bestimmter Commit, vollständiger Hash (40 Zeichen)
//
// Braucht nur git (keine GitHub-API, kein Token). Es wird ein Klon ohne Dateiinhalte angelegt und nur die
// benötigten Dateien werden geladen. Ergebnis: src/modules/mining/data/dataset.json (wird eingecheckt).
//
// Wichtig: Es werden die "Raw"-Blöcke gelesen. Beschreibungstexte und "stdItem" enthalten teils veraltete Werte
// (z. B. Laserleistung von vor 4.9). Siehe docs/research/mining-companion.md.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'https://github.com/StarCitizenWiki/scunpacked-data.git';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'src', 'modules', 'mining', 'data', 'dataset.json');
const wanted = process.argv[2];

const git = (cwd, ...args) => execFileSync('git', ['-c', 'gc.auto=0', ...args], { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

const dir = mkdtempSync(join(tmpdir(), 'bh-scunpacked-'));
try {
  console.log('Lade Verzeichnisbaum ...');
  git(dir, 'init', '-q');
  git(dir, 'remote', 'add', 'origin', REPO);
  git(dir, 'fetch', '-q', '--filter=blob:none', '--depth', '1', 'origin', wanted ?? 'HEAD');
  const commit = git(dir, 'rev-parse', 'FETCH_HEAD').trim();
  const build = git(dir, 'log', '-1', '--format=%s', 'FETCH_HEAD').trim();
  const files = git(dir, 'ls-tree', '-r', '--name-only', 'FETCH_HEAD', 'items/').split('\n').filter(Boolean);
  const read = (path) => JSON.parse(git(dir, 'show', `FETCH_HEAD:${path}`));
  console.log(`Build: ${build} (${commit.slice(0, 7)})`);

  const pick = (re, skip) => files.filter((f) => re.test(f) && !skip.test(f));
  const laserFiles = pick(/^items\/mining_laser_.*\.json$/, /test|template|_s0\.json$|mpuv/);
  const moduleFiles = pick(/^items\/mining_modules_(active|passive)_.*\.json$/, /^$/);
  const gadgetFiles = pick(/^items\/mining_gadget_.*\.json$/, /^$/);

  const lasers = laserFiles.map((f) => laser(read(f), f));
  const modules = moduleFiles.map((f) => miningModule(read(f), f));
  const gadgets = gadgetFiles.map((f) => gadget(read(f), f));
  const { ores, decayPerMass } = resources(read('resources/resources.json'));

  const dataset = {
    _comment: 'Generiert von scripts/mining-data.mjs aus scunpacked-data. Nicht von Hand ändern.',
    build,
    source: { repo: REPO, commit },
    ruleset: { decayPerMass },
    ships: ships(),
    lasers: lasers.sort(byName),
    modules: modules.sort(byName),
    gadgets: gadgets.sort(byName),
    ores,
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(dataset, null, 2) + '\n');
  console.log(
    `${lasers.length} Laser, ${modules.length} Module, ${gadgets.length} Gadgets, ${ores.length} Erze -> ${out}`,
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------

function byName(a, b) {
  return a.name.localeCompare(b.name);
}

/** "-30" aus { FloatModifierMultiplicative: { value: -30 } }, sonst 0. */
function pct(mod) {
  return mod?.FloatModifierMultiplicative?.value ?? 0;
}

function idFrom(file) {
  return file.replace(/^items\//, '').replace(/\.json$/, '');
}

function nameOf(raw, file) {
  const loc = raw.Entity.Components.SAttachableComponentParams.AttachDef.Localization;
  const name = (loc.English?.Name ?? loc.Name ?? '').replace(/ Mining Laser$/, '').replace(/ Module$/, '').trim();
  if (name && !name.includes('PLACEHOLDER')) return name;
  // Ohne Namen im Spiel (z. B. der Hyūn-Laser): aus dem Dateinamen ableiten
  return idFrom(file)
    .replace(/^mining_(laser|modules_(active|passive)|gadget)_/, '')
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function laser(json, file) {
  const raw = json.Raw;
  const c = raw.Entity.Components;
  const attach = c.SAttachableComponentParams.AttachDef;
  const params = c.SEntityComponentMiningLaserParams;
  const actions = c.SCItemWeaponComponentParams.fireActions;
  const beam = (hitType) => {
    const a = actions.find((x) => JSON.stringify(x).includes(`"hitType":"${hitType}"`));
    if (!a) throw new Error(`${file}: kein Strahl ${hitType}`);
    const s = JSON.stringify(a);
    const num = (key) => Number(s.match(new RegExp(`"${key}":(-?[\\d.]+)`))[1]);
    return { energy: num('DamageEnergy'), full: num('fullDamageRange'), zero: num('zeroDamageRange') };
  };
  const fracture = beam('ElectricArc');
  const extraction = beam('Extraction');
  const m = params.miningLaserModifiers ?? {};
  // Ports ist meist ein Array, bei nur einem Port aber ein Objekt { SItemPortDef: {...} } (z. B. Klein-S1)
  const rawPorts = c.SItemPortContainerComponentParams?.Ports;
  const ports = Array.isArray(rawPorts) ? rawPorts : rawPorts ? [rawPorts.SItemPortDef ?? rawPorts].flat() : [];
  // Types kommt in zwei Formen vor: { SItemPortDefTypes: {Type} } oder als Array [{Type}, ...] (z. B. Pitman)
  const typesOf = (p) => {
    const t = p.Types?.SItemPortDefTypes ?? p.Types;
    return Array.isArray(t) ? t : t ? [t] : [];
  };
  const slots = ports.filter((p) => typesOf(p).some((t) => t.Type === 'MiningModifier')).length;
  // Gegenprobe über die Namen der Slot-Ports; weichen beide ab, hat sich das Datenformat geändert
  const byName = ports.filter((p) => /^BONE_ItemPort_Consumable_\d+$/.test(p.Name)).length;
  if (byName !== slots) throw new Error(`${file}: Modul-Slots unklar (${slots} nach Typ, ${byName} nach Name)`);
  return {
    id: idFrom(file),
    name: nameOf(raw, file),
    size: attach.Size,
    power: fracture.energy,
    throttleMin: params.throttleMinimum,
    extraction: extraction.energy,
    rangeFull: fracture.full,
    rangeZero: fracture.zero,
    slots,
    requiredTags: (attach.RequiredTags ?? '').split(' ').filter(Boolean),
    mods: {
      resistance: pct(m.resistanceModifier),
      instability: pct(m.laserInstability),
      window: pct(m.optimalChargeWindowSizeModifier),
      rate: pct(m.optimalChargeWindowRateModifier),
    },
    inertFilter: pct(params.filterParams?.filterModifier),
  };
}

function miningModule(json, file) {
  const raw = json.Raw;
  const p = raw.Entity.Components.EntityComponentAttachableModifierParams;
  const mods = Object.values(p.modifiers);
  const weapon = (index) =>
    mods.find((x) => x.fireActionIndex === index && x.weaponModifier)?.weaponModifier.weaponStats.damageMultiplier ?? 1;
  const mining = mods.find((x) => x.MiningLaserModifier)?.MiningLaserModifier ?? p.modifiers.ItemMiningModifierParams?.MiningLaserModifier ?? {};
  const filter = p.modifiers.MiningFilterItemModifierParams?.filterParams?.filterModifier;
  const lifetime = JSON.stringify(p.modifiers).match(/"lifetime":([\d.]+)/);
  const active = p.activationMethod === 'ActivateOnDemand';
  return {
    id: idFrom(file),
    name: nameOf(raw, file),
    active,
    power: weapon(0),
    extraction: weapon(1),
    mods: {
      resistance: pct(mining.resistanceModifier),
      instability: pct(mining.laserInstability),
      window: pct(mining.optimalChargeWindowSizeModifier),
      rate: pct(mining.optimalChargeWindowRateModifier),
      shatter: pct(mining.shatterdamageModifier),
      catastrophic: pct(mining.catastrophicChargeWindowRateModifier),
      inertFilter: pct(filter),
    },
    uses: active ? p.charges : null,
    durationS: active && lifetime ? Number(lifetime[1]) : null,
    canInterrupt: !!p.canInterrupt,
    isInterruptible: !!p.isInterruptible,
  };
}

function gadget(json, file) {
  const raw = json.Raw;
  const m = raw.Entity.Components.EntityComponentAttachableModifierParams.modifiers.ItemMineableRockModifierParams.MiningLaserModifier;
  return {
    id: idFrom(file),
    name: nameOf(raw, file),
    mods: {
      resistance: pct(m.resistanceModifier),
      instability: pct(m.laserInstability),
      window: pct(m.optimalChargeWindowSizeModifier),
      rate: pct(m.optimalChargeWindowRateModifier),
      cluster: pct(m.clusterFactorModifier),
    },
  };
}

/** Erze aus Schiffs-Steinen (PowerCapacityPerMass 10) und die Bruch-Konstante dieser Steine. */
function resources(list) {
  const shipRocks = list.filter((r) => r.Kind === 'mineable' && r.GlobalParams?.PowerCapacityPerMass === 10);
  const decay = [...new Set(shipRocks.map((r) => r.GlobalParams.DecayPerMass))];
  if (decay.length !== 1) throw new Error(`Uneinheitliche DecayPerMass bei Schiffs-Steinen: ${decay.join(', ')}`);
  // Namen aus dem Schlüssel ableiten, nicht aus dem Anzeigenamen: Der ist uneinheitlich
  // ("Raw Ice", "Hephaestanite (R)"). Schlüssel: Ore_Gold, Raw_Bexalite, RawSilicon, vereinzelt nur "Copper".
  const ores = new Map();
  for (const rock of shipRocks) {
    for (const part of rock.Composition?.Parts ?? []) {
      const m = /^(Ore|Raw)_?(.+)$/.exec(part.Key ?? '');
      const form = m ? m[1].toUpperCase() : 'ORE';
      const name = m ? m[2] : part.Key;
      const id = `${form === 'RAW' ? 'Raw' : 'Ore'}_${name}`;
      if (!name || ores.has(id)) continue;
      ores.set(id, { id, name, form });
    }
  }
  return { ores: [...ores.values()].sort(byName), decayPerMass: decay[0] };
}

/**
 * Schiffe sind von Hand gepflegt (aus scunpacked ships/*.json, Stand 4.10.3). Der Loadout-Baum ist dort
 * sehr verschachtelt, und Schiffe ändern sich selten. Weitere Schiffe (MOLE, Golem) kommen später dazu.
 */
function ships() {
  return [
    {
      id: 'MISC_Prospector',
      name: 'MISC Prospector',
      heads: [{ position: 'FRONT', size: 1, stockLaser: 'mining_laser_grin_arbor_s1' }],
    },
  ];
}
