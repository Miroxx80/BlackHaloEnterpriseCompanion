// Erzeugt den Datensatz für das Navigations-Modul (Sprunghilfen) aus scunpacked-data (Spieldaten pro LIVE-Build).
//
//   node scripts/navigation-data.mjs            -> neuester Stand
//   node scripts/navigation-data.mjs <commit>   -> bestimmter Commit, vollständiger Hash (40 Zeichen)
//
// Braucht nur git (keine GitHub-API, kein Token). Es wird ein Klon ohne Dateiinhalte angelegt und nur
// starmap_positions.json und starmap.json werden geladen. Ergebnis: src/modules/navigation/data/dataset.json
// (wird eingecheckt).
//
// Inhalt: Positionen aller Quantum-Ziele in Stanton (Systemkoordinaten, Stern im Ursprung, in km), dazu die
// Mittelpunkte der Lagrange-Punkte als Referenz und die Bänder des Aaron Halo. Die Bänder stehen nicht in den
// Spieldaten; sie stammen aus der Vermessung von CaptSheppard / Cornerstone (cstone.space) und sind unten fest
// eingetragen.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'https://github.com/StarCitizenWiki/scunpacked-data.git';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'src', 'modules', 'navigation', 'data', 'dataset.json');
const wanted = process.argv[2];

const SYSTEM = 'stanton';
const STAR = 'Stanton';

const PLANETS = [
  ['hurston', 'Hurston', 'Hurston'],
  ['crusader', 'Crusader', 'Crusader'],
  ['arccorp', 'ArcCorp', 'ArcCorp'],
  ['microtech', 'microTech', 'microTech'],
];

/** [id, Name im Spiel, Planet (= Gruppe)] */
const MOONS = [
  ['aberdeen', 'Aberdeen', 'Hurston'],
  ['arial', 'Arial', 'Hurston'],
  ['ita', 'Ita', 'Hurston'],
  ['magda', 'Magda', 'Hurston'],
  ['cellin', 'Cellin', 'Crusader'],
  ['daymar', 'Daymar', 'Crusader'],
  ['yela', 'Yela', 'Crusader'],
  ['lyria', 'Lyria', 'ArcCorp'],
  ['wala', 'Wala', 'ArcCorp'],
  ['calliope', 'Calliope', 'microTech'],
  ['clio', 'Clio', 'microTech'],
  ['euterpe', 'Euterpe', 'microTech'],
];

/** Stationen an den Lagrange-Punkten. CRU-L2 und CRU-L3 haben keine Station und sind kein Quantum-Ziel. */
const LPOINT_STATIONS = [
  ['hur-l1', 'HUR-L1 Green Glade Station'],
  ['hur-l2', 'HUR-L2 Faithful Dream Station'],
  ['hur-l3', 'HUR-L3 Thundering Express Station'],
  ['hur-l4', 'HUR-L4 Melodic Fields Station'],
  ['hur-l5', 'HUR-L5 High Course Station'],
  ['cru-l1', 'CRU-L1 Ambitious Dream Station'],
  ['cru-l4', 'CRU-L4 Shallow Fields Station'],
  ['cru-l5', 'CRU-L5 Beautiful Glen Station'],
  ['arc-l1', 'ARC-L1 Wide Forest Station'],
  ['arc-l2', 'ARC-L2 Lively Pathway Station'],
  ['arc-l3', 'ARC-L3 Modern Express Station'],
  ['arc-l4', 'ARC-L4 Faint Glen Station'],
  ['arc-l5', 'ARC-L5 Yellow Core Station'],
  ['mic-l1', 'MIC-L1 Shallow Frontier Station'],
  ['mic-l2', 'MIC-L2 Long Forest Station'],
  ['mic-l3', 'MIC-L3 Endless Odyssey Station'],
  ['mic-l4', 'MIC-L4 Red Crossroads Station'],
  ['mic-l5', 'MIC-L5 Modern Icarus Station'],
];

/** [id, Name im Spiel, Kurzname, Gruppe, Art] */
const STATIONS = [
  ['seraphim', 'Seraphim Station', 'Seraphim', 'Crusader', 'station'],
  ['grim-hex', 'Grim HEX', 'Grim HEX', 'Crusader', 'station'],
  ['everus-harbor', 'Everus Harbor', 'Everus Harbor', 'Hurston', 'station'],
  ['baijini-point', 'Baijini Point', 'Baijini Point', 'ArcCorp', 'station'],
  ['port-tressler', 'Port Tressler', 'Port Tressler', 'microTech', 'station'],
  // Liegt mitten im Aaron Halo (Band 4)
  ['wikelo-selo', 'Wikelo Emporium Selo Station', 'Wikelo Selo', 'Sonstige', 'station'],
  // Sprungtor-Stationen, weit außerhalb der Ebene
  ['pyro-gateway', 'Pyro Gateway', 'Pyro Gateway', 'Sonstige', 'gateway'],
  ['terra-gateway', 'Terra Gateway', 'Terra Gateway', 'Sonstige', 'gateway'],
  ['nyx-gateway', 'Nyx Gateway', 'Nyx Gateway', 'Sonstige', 'gateway'],
];

/** Mittelpunkte der 20 Lagrange-Punkte (im Spiel unsichtbar, kein Quantum-Ziel). Nur für Referenzrechnungen. */
const MARKERS = ['HUR', 'CRU', 'ARC', 'MIC'].flatMap((p) =>
  [1, 2, 3, 4, 5].map((n) => [`${p.toLowerCase()}-l${n}-centre`, `${p} L${n}`]),
);

// Die drei Monde von microTech stehen in scunpacked gespiegelt: Ihr Abstand zu microTech hat das falsche
// Vorzeichen (geprüft im Spiel und gegen die Starmap). Richtig ist microTech - (Mond - microTech).
// Die erwarteten Werte (m) dienen als Kontrolle, damit die Korrektur auffällt, sobald scunpacked den Fehler behebt.
const MIRRORED_MOONS = {
  Calliope: [22398369308, 37168840679, 0],
  Clio: [22476728221, 37091020074, 0],
  Euterpe: [22488109736, 37081123565, 0],
};

// Aaron Halo: Bänder nach CaptSheppard / Cornerstone (cstone.space, Wissensdatenbank 65), Vermessung Alpha 3.16.1.
// Radien in km vom Systemursprung; above/below = halbe Dicke über/unter der Ebene an der dichtesten Stelle (km).
const HALO = {
  name: 'Aaron Halo',
  source: 'CaptSheppard / Cornerstone (cstone.space), Vermessung Alpha 3.16.1',
  bands: [
    { n: 1, inner: 19673000, outer: 19715000, densest: 19702000, above: 615, below: 635, note: 'fast leer' },
    { n: 2, inner: 19815000, outer: 19914000, densest: 19857000, above: 2063, below: 2078 },
    { n: 3, inner: 19914000, outer: 20071000, densest: 19995000, above: 4035, below: 4058 },
    { n: 4, inner: 20129000, outer: 20230000, densest: 20168000, above: 2897, below: 2926 },
    { n: 5, inner: 20230000, outer: 20407000, densest: 20320000, above: 4990, below: 5006, note: 'dichtestes Band' },
    { n: 6, inner: 20407000, outer: 20540000, densest: 20471000, above: 4991, below: 5008 },
    { n: 7, inner: 20540000, outer: 20750000, densest: 20662000, above: 4989, below: 5007 },
    { n: 8, inner: 20793000, outer: 20968000, densest: 20881000, above: 3475, below: 3498 },
    { n: 9, inner: 21046000, outer: 21132000, densest: 21082000, above: 2389, below: 2411 },
    { n: 10, inner: 21159000, outer: 21299000, densest: 21207000, above: 2006, below: 2010 },
  ],
};

// Kontrolle: Restdistanzen (km) je Band auf der Strecke ARC L1 -> CRU L4 (Mittelpunkte) laut Cornerstone-Karte.
const REFERENCE = { from: 'arc-l1-centre', to: 'cru-l4-centre', remaining: [
  12744804, 13157848, 13510150, 13934165, 14292609, 14637247, 15058764, 15524707, 15938062, 16188953,
] };

const git = (cwd, ...args) => execFileSync('git', ['-c', 'gc.auto=0', ...args], { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

const dir = mkdtempSync(join(tmpdir(), 'bh-scunpacked-'));
try {
  console.log('Lade Verzeichnisbaum ...');
  git(dir, 'init', '-q');
  git(dir, 'remote', 'add', 'origin', REPO);
  git(dir, 'fetch', '-q', '--filter=blob:none', '--depth', '1', 'origin', wanted ?? 'HEAD');
  const commit = git(dir, 'rev-parse', 'FETCH_HEAD').trim();
  const build = git(dir, 'log', '-1', '--format=%s', 'FETCH_HEAD').trim();
  const read = (path) => JSON.parse(git(dir, 'show', `FETCH_HEAD:${path}`));
  console.log(`Build: ${build} (${commit.slice(0, 7)})`);

  const positions = read('starmap_positions.json').entities.filter((e) => e.system === SYSTEM);
  const records = new Map(read('starmap.json').map((r) => [r.UUID, r]));

  const entity = (name) => {
    const found = positions.filter((e) => e.name === name);
    if (found.length !== 1) throw new Error(`${name}: ${found.length} Einträge in starmap_positions.json (erwartet: genau 1)`);
    return found[0];
  };
  const record = (e) => {
    const r = records.get(e.uuid);
    if (!r) throw new Error(`${e.name}: kein Eintrag in starmap.json (UUID ${e.uuid})`);
    return r;
  };
  /** Größter Radius (m) aus Größe und Hindernisradius für Quantum-Sprünge. */
  const bodyRadius = (e) => {
    const r = record(e);
    return Math.max(r.Size ?? 0, r.QuantumTravel?.ObstructionRadius ?? 0);
  };
  const km = (m) => Math.round(m) / 1000;

  const star = entity(STAR);
  if (star.x !== 0 || star.y !== 0 || star.z !== 0) throw new Error(`${STAR}: Stern liegt nicht im Ursprung`);
  const planetOf = new Map(PLANETS.map(([, name]) => [name, entity(name)]));

  /** Ein Ort aus den Spieldaten. qt = erwarteter Wert von qt_valid, wird geprüft. */
  const place = (id, name, short, kind, group, qt, withRadius) => {
    const e = entity(name);
    if (e.qt_valid !== qt) throw new Error(`${name}: qt_valid ist ${e.qt_valid}, erwartet ${qt}`);
    if (qt && record(e).Type?.ValidQuantumTravelDestination !== true) {
      throw new Error(`${name}: in starmap.json kein gültiges Quantum-Ziel`);
    }
    let pos = [e.x, e.y, e.z];
    if (MIRRORED_MOONS[name]) pos = unmirror(e, MIRRORED_MOONS[name]);
    return { id, name, short, kind, group, qt, pos: pos.map(km), radius: withRadius ? km(bodyRadius(e)) : 0 };
  };

  /** Spiegelung am Planeten aufheben und gegen die erwarteten Werte prüfen (siehe MIRRORED_MOONS). */
  const unmirror = (moon, expected) => {
    const parent = positions.find((e) => e.uuid === moon.parent_uuid);
    if (parent?.name !== 'microTech') throw new Error(`${moon.name}: Elternobjekt ist nicht microTech`);
    const p = [parent.x, parent.y, parent.z];
    const m = [moon.x, moon.y, moon.z];
    const fixed = p.map((c, i) => c - (m[i] - c));
    const off = Math.hypot(...fixed.map((c, i) => c - expected[i]));
    if (off > 1000) {
      const raw = Math.hypot(...m.map((c, i) => c - expected[i]));
      throw new Error(
        `${moon.name}: korrigierte Position weicht ${(off / 1000).toFixed(1)} km vom erwarteten Wert ab ` +
          `(unkorrigiert ${(raw / 1000).toFixed(1)} km). Wurde der Spiegelungsfehler in scunpacked behoben?`,
      );
    }
    return fixed;
  };

  const places = [
    ...PLANETS.map(([id, name, group]) => place(id, name, name, 'planet', group, true, true)),
    ...MOONS.map(([id, name, group]) => {
      const moon = place(id, name, name, 'moon', group, true, true);
      const parent = positions.find((e) => e.uuid === entity(name).parent_uuid);
      if (parent !== planetOf.get(group)) throw new Error(`${name}: gehört nicht zu ${group}`);
      return moon;
    }),
    ...LPOINT_STATIONS.map(([id, name]) => place(id, name, name.split(' ')[0], 'lpoint', 'Lagrange', true, false)),
    ...STATIONS.map(([id, name, short, group, kind]) => place(id, name, short, kind, group, true, false)),
    ...MARKERS.map(([id, name]) => place(id, name, name, 'marker', 'Lagrange', false, false)),
  ];

  checkPlaces(places, positions);
  checkReference(places);

  const dataset = {
    _comment:
      'Generiert von scripts/navigation-data.mjs aus scunpacked-data (Positionen in km, Stern im Ursprung) und der ' +
      'Aaron-Halo-Vermessung von Cornerstone. Nicht von Hand ändern.',
    build,
    source: { repo: REPO.replace(/\.git$/, ''), commit },
    system: 'Stanton',
    places,
    star: { radius: km(bodyRadius(star)) },
    halo: HALO,
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(dataset, null, 2) + '\n');

  const count = (kind) => places.filter((p) => p.kind === kind).length;
  console.log(
    `${count('planet')} Planeten, ${count('moon')} Monde, ${count('lpoint')} L-Punkt-Stationen, ` +
      `${count('station')} Stationen, ${count('gateway')} Sprungtore, ${count('marker')} L-Punkt-Mittelpunkte -> ${out}`,
  );
  for (const id of ['hurston', 'calliope', 'mic-l1', 'hur-l4', 'wikelo-selo', 'pyro-gateway', 'cru-l2-centre']) {
    const p = places.find((x) => x.id === id);
    const r = Math.hypot(...p.pos) / 1e6;
    console.log(`  ${p.id.padEnd(14)} ${p.pos.map((c) => c.toFixed(3).padStart(18)).join(' ')}  r=${r.toFixed(3)} Gm  ${p.name}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------

/** Vollständigkeit prüfen und auf neue Stationen hinweisen, die noch nicht in den Listen oben stehen. */
function checkPlaces(places, positions) {
  const ids = new Set();
  for (const p of places) {
    if (ids.has(p.id)) throw new Error(`Doppelte ID ${p.id}`);
    ids.add(p.id);
  }
  const count = (kind) => places.filter((p) => p.kind === kind).length;
  if (count('lpoint') !== 18) throw new Error(`${count('lpoint')} L-Punkt-Stationen statt 18`);
  if (count('marker') !== 20) throw new Error(`${count('marker')} L-Punkt-Mittelpunkte statt 20`);
  for (const lp of ['CRU-L2', 'CRU-L3']) {
    const station = positions.find((e) => e.name.startsWith(`${lp} `));
    if (station) throw new Error(`${lp} hat jetzt eine Station (${station.name}). Bitte in LPOINT_STATIONS aufnehmen.`);
  }
  const names = new Set(places.map((p) => p.name));
  const unknown = positions.filter(
    (e) =>
      e.qt_valid &&
      /^Manmade/.test(e.type) &&
      /Station$|Gateway$|^[A-Z]{3}-L\d /.test(e.name) &&
      !names.has(e.name) &&
      !/^Wikelo /.test(e.name), // weitere Wikelo-Stationen absichtlich nicht im Datensatz
  );
  for (const e of unknown) console.warn(`Hinweis: Quantum-Ziel ${e.name} (${e.type}) ist nicht im Datensatz.`);
}

/** Restdistanzen ARC L1 -> CRU L4 gegen die Cornerstone-Karte prüfen (je Band auf +-2 km). */
function checkReference(places) {
  const a = places.find((p) => p.id === REFERENCE.from).pos;
  const b = places.find((p) => p.id === REFERENCE.to).pos;
  const d = b.map((c, i) => c - a[i]);
  const len = Math.hypot(...d);
  HALO.bands.forEach((band, i) => {
    // |a + t d| = r, erster Schnittpunkt auf der Strecke
    const qa = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
    const qb = 2 * (a[0] * d[0] + a[1] * d[1] + a[2] * d[2]);
    const qc = a[0] ** 2 + a[1] ** 2 + a[2] ** 2 - band.densest ** 2;
    const disc = qb * qb - 4 * qa * qc;
    if (disc < 0) throw new Error(`Referenz: Band ${band.n} wird nicht gekreuzt`);
    const t = (-qb - Math.sqrt(disc)) / (2 * qa);
    const remaining = len * (1 - t);
    const diff = remaining - REFERENCE.remaining[i];
    if (Math.abs(diff) > 2) {
      throw new Error(`Referenz: Band ${band.n} bei ${remaining.toFixed(0)} km statt ${REFERENCE.remaining[i]} km`);
    }
  });
  console.log('Referenz ARC L1 -> CRU L4 stimmt mit der Cornerstone-Karte überein.');
}
