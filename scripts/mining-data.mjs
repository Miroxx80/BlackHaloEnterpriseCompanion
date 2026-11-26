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

// Radar-Signaturen (siehe signatureData)
const RARITIES = ['Legendary', 'Epic', 'Rare', 'Uncommon', 'Common'];
/** Spawn-Tabellen ohne Ort, den ein Spieler ansteuern kann (Events, Platzhalter, nur Bergung, Höhlen). */
const HIDDEN_TABLES = /^(HPP_ShipGraveyard|HPP_SpaceDerelict|HPP_ResourceRush|AsteroidCluster_|HPP_Lagrange_(G|Occupied)$|Loot_Caves_)/;
/** Lesbare Namen für Tabellen mit vielen Orten. */
const TABLE_NAMES = {
  HPP_AaronHalo: 'Aaron Halo',
  HPP_Stanton2c_Belt: 'Yela-Gürtel / Terminus-Ring',
  HPP_Pyro_DeepSpaceAsteroids: 'Pyro-Asteroiden (Cluster, RAB, RMB)',
};
const FAMILY_OF = (key) =>
  /^MineableRock_GroundVehicle_/.test(key) ? 'roc' : /^MineableRock_FPS_/.test(key) ? 'fps' : null;


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
  const resourceList = read('resources/resources.json');
  const { ores, decayPerMass } = resources(resourceList);
  const signatures = signatureData(resourceList, read('resources/locations.json'), read('resources/commodities.json'), ores);

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
    signatures,
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(dataset, null, 2) + '\n');
  console.log(
    `${lasers.length} Laser, ${modules.length} Module, ${gadgets.length} Gadgets, ${ores.length} Erze, ` +
      `${ores.filter((o) => o.signature).length} Signaturen, ${signatures.locations.length} Fundorte -> ${out}`,
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

// ---------------------------------------------------------------------------
// Radar-Signaturen und Fundorte (resources.json, locations.json, commodities.json)

/**
 * Signatur je Schiffs-Erz (aus den Steinen MineableRock_(Asteroid|Surface)<Seltenheit>_<Erz>), Dichte je Erz,
 * Clustergrößen je Seltenheit, Bodenfamilien (ROC/Hand), Bergung und Pflanzen sowie Fundorte mit Wahrscheinlichkeiten.
 * Nur Steine, die in einer Spawn-Tabelle vorkommen (alte Gesteinstypen mit 4000–4900 und _TEMPLATE fallen so weg).
 */
function signatureData(list, tables, commodities, ores) {
  const byUuid = new Map(list.map((r) => [r.UUID, r]));
  const commodityByUuid = new Map((Array.isArray(commodities) ? commodities : Object.values(commodities)).map((c) => [c.UUID, c]));
  const used = new Set(tables.flatMap((t) => t.Groups.flatMap((g) => g.Deposits.map((d) => d.ResourceUUID))));
  const oreId = (key) => {
    const m = /^(Ore|Raw)_?(.+)$/.exec(key ?? '');
    return m ? `${m[1] === 'Raw' ? 'Raw' : 'Ore'}_${m[2]}` : null;
  };

  // Dichte aller Erze (g/cm³ = relative Dichte; Inert 1)
  for (const rock of list) {
    for (const part of rock.Composition?.Parts ?? []) {
      const ore = ores.find((o) => o.id === oreId(part.Key));
      const density = commodityByUuid.get(part.ResourceTypeUUID)?.DensityGPerCc;
      if (ore && density && ore.density === undefined) ore.density = density;
    }
  }

  // Schiffs-Erze: Signatur und Seltenheit aus dem Stein-Schlüssel (das Feld Tier ist unzuverlässig)
  for (const rock of list) {
    const m = /^MineableRock_(Asteroid|Surface)(Legendary|Epic|Rare|Uncommon|Common)_([A-Za-z]+)$/.exec(rock.Key ?? '');
    if (!m || !used.has(rock.UUID) || !rock.Signature) continue;
    const main = [...(rock.Composition?.Parts ?? [])].sort((a, b) => b.MaxPercentage - a.MaxPercentage)[0];
    const ore = ores.find((o) => o.id === oreId(main?.Key));
    if (!ore) throw new Error(`${rock.Key}: Haupterz ${main?.Key} unbekannt`);
    if (ore.signature !== undefined && ore.signature !== rock.Signature) throw new Error(`${ore.id}: zwei Signaturen`);
    ore.signature = rock.Signature;
    ore.rarity = m[2].toLowerCase();
  }

  // Clustergrößen je Seltenheit (Preset <Seltenheit>ShipMineable_Cluster)
  const presets = new Map();
  for (const t of tables) for (const g of t.Groups) for (const d of g.Deposits) if (d.Clustering) presets.set(d.Clustering.Key, d.Clustering);
  const clusters = {};
  for (const r of RARITIES) {
    const c = presets.get(`${r}ShipMineable_Cluster`);
    if (!c) throw new Error(`Cluster-Preset ${r} fehlt`);
    const total = c.Params.reduce((s, p) => s + p.RelativeProbability, 0);
    clusters[r.toLowerCase()] = {
      probability: c.ProbabilityOfClustering,
      sizes: c.Params.map((p) => ({ size: p.MinSize, p: +(p.RelativeProbability / total).toFixed(4) })).sort((a, b) => a.size - b.size),
    };
  }

  // Familien am Boden und Bergung: Signatur gleich für alle Mineralien einer Familie
  const families = { roc: { base: 0, minerals: new Set(), max: 0 }, fps: { base: 0, minerals: new Set(), max: 0 } };
  const debris = new Map();
  let scrapMax = 0;
  let plantMax = 0;
  for (const t of tables) {
    for (const g of t.Groups) {
      for (const d of g.Deposits) {
        const r = byUuid.get(d.ResourceUUID);
        if (!r?.Signature) continue;
        const fam = FAMILY_OF(r.Key);
        if (fam) {
          const f = families[fam];
          if (f.base && f.base !== r.Signature) throw new Error(`${fam}: uneinheitliche Signatur`);
          f.base = r.Signature;
          f.minerals.add(r.Composition?.Parts?.[0]?.Key ?? r.Key.replace(/^.*_/, ''));
          f.max = Math.max(f.max, d.Clustering?.MaxSize ?? 1);
        } else if (r.Kind === 'salvageable') {
          if (r.Signature === 2000) scrapMax = Math.max(scrapMax, d.Clustering?.MaxSize ?? 1);
          else debris.set(r.Signature, (debris.get(r.Signature) ?? new Set()).add(r.Key.replace(/^SalvageableDebris_/, '')));
        } else if (/harvestable/.test(r.Kind) && r.Signature === 2000) {
          plantMax = Math.max(plantMax, d.Clustering?.MaxSize ?? 1);
        }
      }
    }
  }

  // Fundorte: Anteile der Schiffs-Erze (innerhalb der Gruppe) und welche Bodenfamilien es dort gibt
  const locations = [];
  for (const t of tables) {
    const id = t.Provider.Name;
    if (HIDDEN_TABLES.test(id)) continue;
    const ship = t.Groups.filter((g) => /^SpaceShip_Mineables/.test(g.GroupName));
    const deposits = ship.flatMap((g) => g.Deposits.map((d) => ({ d, w: g.GroupProbability * d.RelativeProbability })));
    const total = deposits.reduce((s, x) => s + x.w, 0);
    const share = new Map();
    for (const { d, w } of deposits) {
      const r = byUuid.get(d.ResourceUUID);
      const main = [...(r?.Composition?.Parts ?? [])].sort((a, b) => b.MaxPercentage - a.MaxPercentage)[0];
      const ore = oreId(main?.Key);
      if (ore && total) share.set(ore, (share.get(ore) ?? 0) + w / total);
    }
    const ground = new Set();
    for (const g of t.Groups) for (const d of g.Deposits) {
      const fam = FAMILY_OF(byUuid.get(d.ResourceUUID)?.Key);
      if (fam) ground.add(fam);
    }
    if (!share.size && !ground.size) continue;
    const places = [...new Set(t.Locations.map((l) => l.Name))];
    // Belt-Tabelle von Yela hängt in den Daten an Pyro6 (Terminus, "planet"): ist aber ein Asteroidengürtel
    const type = id === 'HPP_Stanton2c_Belt' ? 'belt' : (t.Locations[0]?.Type ?? 'unknown');
    // Lagrange-Gruppen eines Planeten ("PYR1 L1", "PYR1 L2", ...) kurz benennen
    const lagrange = places.length > 2 && places.every((p) => /^PYR\d L\d$/.test(p));
    // System aus dem Schlüssel (Pyro6 = Terminus), nicht aus dem Feld System
    const system = id === 'HPP_Stanton2c_Belt' ? 'Stanton' : /Pyro/.test(id + t.Locations[0]?.Key) ? 'Pyro' : /Nyx/.test(id) ? 'Nyx' : 'Stanton';
    locations.push({
      id,
      name: TABLE_NAMES[id] ?? (lagrange ? `${[...new Set(places.map((p) => p.split(' ')[0]))].join(' / ')} Lagrange-Punkte` : places.join(', ')),
      system,
      surface: type === 'planet' || type === 'moon',
      ores: [...share].map(([ore, p]) => ({ ore, p: +p.toFixed(4) })).sort((a, b) => b.p - a.p),
      ground: [...ground].sort(),
    });
  }
  locations.sort((a, b) => a.system.localeCompare(b.system) || a.name.localeCompare(b.name));

  return {
    _comment: 'Signatur auf dem Radar = Basis-Signatur x Anzahl Steine. Bodenfamilien: Mineral nur über den Ort bestimmbar.',
    clusters,
    families: [
      { id: 'roc', label: 'ROC-Vorkommen (Bodenfahrzeug)', base: families.roc.base, maxCount: families.roc.max, minerals: [...families.roc.minerals].sort() },
      { id: 'fps', label: 'Handabbau (FPS)', base: families.fps.base, maxCount: families.fps.max, minerals: [...families.fps.minerals].sort() },
      { id: 'small', label: 'Bergung (Wrackteile) oder Pflanzen', base: 2000, maxCount: Math.max(scrapMax, plantMax), minerals: [] },
    ],
    debris: [...debris].map(([base, what]) => ({ base, label: `Wrack (${[...what].sort().join(', ')})` })).sort((a, b) => a.base - b.base),
    locations,
  };
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
