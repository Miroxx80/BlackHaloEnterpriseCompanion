// Tests für die Sprunghilfen: Kreuzungen des Aaron Halo, Hindernisse, Zielvorschläge.
// Referenzwerte: Cornerstone-Karte ARC L1 -> CRU L4 (cstone.space), Positionen aus scunpacked-data 4.10.3
// (fest eingetragen, damit der Test nicht vom Datensatz abhängt) und der Test im Spiel: MIC-L1 -> Hurston,
// Abbruch bei 13,2 Gm landet in Band 5.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startApp } from '../dist/core/app.js';
import { distance, formatGm, haloRoute, obstructions, suggestDestinations } from '../dist/modules/navigation/route.js';

const near = (actual, expected, eps, what) =>
  assert.ok(Math.abs(actual - expected) <= eps, `${what}: ${actual} statt ${expected} (±${eps})`);

// Bänder (CaptSheppard / Cornerstone, Alpha 3.16.1): n, inner, outer, densest, above, below (km).
const BANDS = [
  [1, 19673000, 19715000, 19702000, 615, 635],
  [2, 19815000, 19914000, 19857000, 2063, 2078],
  [3, 19914000, 20071000, 19995000, 4035, 4058],
  [4, 20129000, 20230000, 20168000, 2897, 2926],
  [5, 20230000, 20407000, 20320000, 4990, 5006],
  [6, 20407000, 20540000, 20471000, 4991, 5008],
  [7, 20540000, 20750000, 20662000, 4989, 5007],
  [8, 20793000, 20968000, 20881000, 3475, 3498],
  [9, 21046000, 21132000, 21082000, 2389, 2411],
  [10, 21159000, 21299000, 21207000, 2006, 2010],
].map(([n, inner, outer, densest, above, below]) => ({ n, inner, outer, densest, above, below }));

// Positionen in km (Systemrahmen, Stern im Ursprung).
const P = {
  arcL1Centre: [16729134.637, -19937006.925, 8.077],
  cruL4Centre: [-7173168.64, -17754204.16, 0],
  arcL1Station: [16729220.035, -19942048.186, 2239.765],
  cruL4Station: [-7173768.307, -17750056.492, -2174.784],
  micL1Station: [20215827.269, 33467069.518, -0.943],
  hurL1Station: [11561412.556, -262.923, -484.614],
  hurston: [12850457.093, 0, 0],
  crusader: [-18962176, -2664960, 0],
  nyxGateway: [-62284323.874, 23467575.726, 20198379.369],
  pyroGateway: [3310495.68, -27979395.048, -2676322.341],
  wikeloSelo: [-20156591.641, -1263139.664, 0],
};

test('ARC L1 -> CRU L4 (Zentren) trifft die Cornerstone-Werte aller zehn Bänder', () => {
  const route = haloRoute(P.arcL1Centre, P.cruL4Centre, BANDS);
  // Restentfernung je Band 1..10 (km), Cornerstone-Karte
  const expected = [12744804, 13157848, 13510150, 13934165, 14292609, 14637247, 15058764, 15524707, 15938062, 16188953];
  assert.equal(route.crossings.length, 10);
  // Route von außen nach innen: Band 10 zuerst
  assert.deepEqual(route.crossings.map((c) => c.band), [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  for (const c of route.crossings) {
    near(c.exit, expected[c.band - 1], 2, `Band ${c.band}`);
    assert.equal(c.pass, 1);
    assert.equal(c.status, 'in');
    assert.ok(c.enter > c.exit && c.exit > c.leave, `Band ${c.band}: Fenster umschließt die dichteste Stelle`);
  }
  assert.equal(route.best?.band, 5);
});

test('ARC-L1 Wide Forest -> CRU-L4 Shallow Fields (Stationen): Band 5 mit Fenster und Höhe', () => {
  const route = haloRoute(P.arcL1Station, P.cruL4Station, BANDS);
  near(route.length, 24003285, 2, 'Routenlänge');
  const b5 = route.crossings.find((c) => c.band === 5);
  near(b5.exit, 14290792, 2, 'dichteste Stelle');
  near(b5.enter, 14490573, 2, 'Eintritt');
  near(b5.leave, 14080145, 2, 'Austritt');
  near(b5.height, 453, 1, 'Höhe');
  assert.equal(b5.status, 'in');
  assert.equal(b5.hud, 14.3);
  assert.equal(b5.hudInWindow, true);
  assert.equal(route.best, b5);
});

test('MIC-L1 Shallow Frontier -> Hurston: Abbruch bei 13,2 Gm (im Spiel bestätigt)', () => {
  const route = haloRoute(P.micL1Station, P.hurston, BANDS);
  near(route.length / 1e6, 34.27, 0.005, 'Routenlänge (Gm)');
  const b5 = route.best;
  assert.equal(b5.band, 5);
  assert.equal(b5.status, 'in');
  near(b5.exit / 1e6, 13.22, 0.005, 'dichteste Stelle (Gm)');
  near(b5.enter / 1e6, 13.33, 0.005, 'Eintritt (Gm)');
  near(b5.leave / 1e6, 13.1, 0.005, 'Austritt (Gm)');
  assert.equal(b5.hud, 13.2);
  assert.equal(b5.hudInWindow, true);
});

test('Route komplett im inneren Loch kreuzt nichts', () => {
  const route = haloRoute(P.hurston, P.crusader, BANDS);
  assert.ok(route.length > 0);
  assert.deepEqual(route.crossings, []);
  assert.equal(route.best, null);
});

test('Leere Route (Start = Ziel) und Gerade, die den Gürtel verfehlt', () => {
  assert.deepEqual(haloRoute(P.hurston, P.hurston, BANDS), { length: 0, crossings: [], best: null });
  // Komplett außerhalb, sonnennächster Punkt bei 30 Gm
  const far = haloRoute([-40e6, 30e6, 0], [40e6, 30e6, 0], BANDS);
  assert.deepEqual(far.crossings, []);
});

test('Strecke durch den Gürtel hinein und wieder hinaus: Durchgang 1 und 2 in Routenreihenfolge', () => {
  // Sonnennächster Punkt bei 20,3 Gm: zwischen der dichtesten Stelle von Band 4 und Band 5
  const route = haloRoute([-30e6, 20.3e6, 0], [30e6, 20.3e6, 0], BANDS);
  assert.deepEqual(
    route.crossings.map((c) => `${c.band}/${c.pass}`),
    ['10/1', '9/1', '8/1', '7/1', '6/1', '5/1', '5/2', '6/2', '7/2', '8/2', '9/2', '10/2'],
  );
  for (let i = 1; i < route.crossings.length; i++) assert.ok(route.crossings[i].exit < route.crossings[i - 1].exit);
  // Beide Band-5-Kreuzungen liegen in derselben Schale (Band 4 wird nicht erreicht)
  const [a, b] = route.crossings.filter((c) => c.band === 5);
  assert.equal(a.enter, b.enter);
  assert.equal(a.leave, b.leave);
  assert.equal(route.best, a);
  // Durch das Loch: jedes Band zweimal
  const through = haloRoute([-30e6, 0, 0], [30e6, 0, 0], BANDS);
  assert.equal(through.crossings.length, 20);
  assert.equal(through.crossings.filter((c) => c.pass === 2).length, 10);
});

test('Start im Gürtel (Wikelo Selo in Band 4): Eintritt = Start, nur ein Durchgang', () => {
  const route = haloRoute(P.wikeloSelo, P.hurston, BANDS);
  assert.equal(route.crossings[0].band, 4);
  near(route.crossings[0].enter, route.length, 1e-6, 'Eintritt am Start');
  assert.ok(route.crossings.every((c) => c.pass === 1));
  assert.deepEqual(route.crossings.map((c) => c.band), [4, 3, 2, 1]);
});

test('Über und unter der Ebene: Gateways weit außerhalb', () => {
  const up = haloRoute(P.hurston, P.nyxGateway, BANDS);
  assert.equal(up.crossings.length, 10);
  assert.ok(up.crossings.every((c) => c.status === 'over' && c.height > 0));
  assert.equal(up.best, null);
  const down = haloRoute(P.hurston, P.pyroGateway, BANDS);
  assert.equal(down.crossings.length, 10);
  assert.ok(down.crossings.every((c) => c.status === 'under' && c.height < 0));
  assert.equal(down.best, null);
});

test('obstructions: Strecke durch Hurston, Ignorieren, Abstand knapp daneben', () => {
  const bodies = [
    { id: 'hurston', pos: P.hurston, radius: 1000 },
    { id: 'aberdeen', pos: [P.hurston[0] + 500, 300000, 0], radius: 300 },
    { id: 'crusader', pos: P.crusader, radius: 7450 },
    { id: 'station', pos: P.hurL1Station, radius: 0 },
  ];
  const from = [P.hurston[0], -1e6, 0];
  const to = [P.hurston[0], 1e6, 0];
  const hits = obstructions(from, to, bodies);
  assert.deepEqual(hits.map((h) => h.id), ['hurston', 'aberdeen']);
  near(hits[0].clearance, -1000, 1e-6, 'durch Hurston');
  near(hits[1].clearance, 200, 1e-6, 'an Aberdeen vorbei');
  assert.deepEqual(obstructions(from, to, bodies, ['hurston']).map((h) => h.id), ['aberdeen']);
  // Endet die Strecke vor dem Körper, zählt der Abstand zum Endpunkt
  assert.deepEqual(obstructions(from, [P.hurston[0], -10000, 0], bodies), []);
});

test('formatGm: eine Nachkommastelle mit Komma', () => {
  assert.equal(formatGm(14290.792e3), '14,3');
  assert.equal(formatGm(13219132.6), '13,2');
  assert.equal(formatGm(13e6), '13,0');
  assert.equal(formatGm(0), '0,0');
});

test('suggestDestinations: nur Quantum-Ziele mit Band "in", nach Länge sortiert, ohne Start', () => {
  const places = [
    { id: 'hurston', pos: P.hurston, qt: true },
    { id: 'mic-l1', pos: P.micL1Station, qt: true },
    { id: 'hur-l1', pos: P.hurL1Station, qt: true },
    { id: 'crusader', pos: P.crusader, qt: true },
    { id: 'nyx-gateway', pos: P.nyxGateway, qt: true },
    { id: 'hur-l1-centre', pos: [11565411.328, 0, 0], qt: false },
    { id: 'cru-l4', pos: P.cruL4Station, qt: true },
  ];
  const list = suggestDestinations(P.micL1Station, places, BANDS, 5);
  const ids = list.map((s) => s.id);
  assert.ok(!ids.includes('mic-l1'), 'Start fehlt');
  assert.ok(!ids.includes('hur-l1-centre'), 'kein Quantum-Ziel');
  assert.ok(!ids.includes('nyx-gateway'), 'Route über dem Gürtel');
  assert.ok(ids.includes('hurston') && ids.includes('hur-l1'));
  for (let i = 1; i < list.length; i++) assert.ok(list[i].length >= list[i - 1].length, 'nach Länge sortiert');
  for (const s of list) {
    assert.equal(s.crossing.band, 5);
    assert.equal(s.crossing.status, 'in');
    near(s.length, distance(P.micL1Station, places.find((p) => p.id === s.id).pos), 1e-6, s.id);
  }
  assert.equal(suggestDestinations(P.micL1Station, places, BANDS, 5, 1).length, 1);
  assert.equal(suggestDestinations(P.micL1Station, places, BANDS, 5, 1)[0].id, list[0].id);
});

// ---------- Cornerstone-Karten 3.16.1 (Abschrift in test/fixtures/halo, siehe README dort) ----------

const dataset = JSON.parse(readFileSync(new URL('../src/modules/navigation/data/dataset.json', import.meta.url), 'utf8'));
const chart = JSON.parse(readFileSync(new URL('./fixtures/halo/cornerstone-3.16.1.json', import.meta.url), 'utf8'));
/** Höchste erlaubte Abweichung je Zelle (km). */
const CHART_TOLERANCE = 20;

/**
 * Bekannte Ausnahmen, ausdrücklich statt einer größeren Toleranz:
 * - Druckfehler: die Karte druckt einen falschen Wert, wir prüfen gegen den richtigen (left + right = Routenlänge).
 * - Positionen, die 3.16.1 anders waren als in den Spieldaten 4.10.3. Damit rechnet der Test so, wie die Karte
 *   gerechnet wurde. Mit unseren 4.10.3-Positionen weichen diese Spalten ab (microTech rund 140 km, CRU-L3 bis
 *   22 km in Band 1).
 */
const MISPRINTS = {
  // Seite 4, CRU-L1 -> ARC-L3, Band 8, links: gedruckt 10 992 695 (Ziffer 9 statt 2)
  'CRU-L1>ARC-L3>8>left': 10922695,
};
const CHART_POSITIONS = {
  // microTech 3.16.1 (alle drei MICROTECH-Spalten passen damit auf ~1 km). 4.10.3: 69 / 120 km weiter außen.
  microtech: [22462016, 37185625, 0],
  // CRU-L3 3.16.1 genau gegenüber von Crusader. Die 4.10.3-Markierung liegt rund 12 km daneben.
  'cru-l3-centre': [18962176, 2664960, 0],
};

/** Kartenbezeichnung -> Position: L-Punkte über ihre Mittelpunkt-Markierung, Planeten über ihren Mittelpunkt. */
function chartPos(label, positions = CHART_POSITIONS) {
  const id = /^[A-Z]{3}-L[1-5]$/.test(label) ? `${label.toLowerCase()}-centre` : label.toLowerCase();
  if (positions[id]) return positions[id];
  const place = dataset.places.find((p) => p.id === id);
  assert.ok(place, `Kartenbezeichnung ${label} (${id}) fehlt im Datensatz`);
  return place.pos;
}

/**
 * Beide Zahlen einer Zelle nachrechnen. Die Karte zeigt die Kreuzung nahe der Raffinerie: beim Hinflug die erste
 * Kreuzung des Bands, beim Rückflug dieselbe Stelle, also die letzte (wichtig für MIC-L1 -> ArcCorp, die den
 * Gürtel zweimal kreuzt).
 */
function chartCells(page, column, positions) {
  const a = chartPos(page.refinery, positions);
  const b = chartPos(column.to, positions);
  const there = haloRoute(a, b, dataset.halo.bands);
  const back = haloRoute(b, a, dataset.halo.bands);
  return column.bands.flatMap((cell) => {
    const key = `${page.refinery}>${column.to}>${cell.band}`;
    const fw = there.crossings.filter((c) => c.band === cell.band);
    const bw = back.crossings.filter((c) => c.band === cell.band);
    assert.ok(fw.length && bw.length, `${key}: keine Kreuzung`);
    return [
      { key: `${key}>left`, printed: cell.left, ours: fw[0].exit },
      { key: `${key}>right`, printed: cell.right, ours: bw.at(-1).exit },
    ];
  });
}

test('Cornerstone-Karten 3.16.1: alle Zellen auf 20 km (bekannte Ausnahmen ausdrücklich)', () => {
  assert.equal(chart.pages.length, 5);
  let cells = 0;
  const misprintsSeen = new Set();
  for (const page of chart.pages) {
    for (const column of page.columns) {
      assert.equal(column.bands.length, 10, `${page.refinery} -> ${column.to}`);
      assert.deepEqual(column.bands.map((b) => b.band).sort((x, y) => x - y), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      for (const cell of chartCells(page, column)) {
        cells++;
        let expected = cell.printed;
        if (cell.key in MISPRINTS) {
          expected = MISPRINTS[cell.key];
          misprintsSeen.add(cell.key);
          assert.ok(Math.abs(cell.ours - cell.printed) > 1000, `${cell.key}: Druckfehler gibt es nicht mehr?`);
        }
        near(cell.ours, expected, CHART_TOLERANCE, cell.key);
      }
    }
  }
  assert.equal(cells, 23 * 10 * 2);
  assert.deepEqual([...misprintsSeen], Object.keys(MISPRINTS), 'alle bekannten Druckfehler wurden geprüft');
});

test('Cornerstone-Karten: left + right = Routenlänge, Seiten mit Band 10..1 bedeuten dasselbe', () => {
  for (const page of chart.pages) {
    for (const column of page.columns) {
      const length = distance(chartPos(page.refinery), chartPos(column.to));
      for (const cell of column.bands) {
        const left = MISPRINTS[`${page.refinery}>${column.to}>${cell.band}>left`] ?? cell.left;
        near(left + cell.right, length, 3, `${page.refinery} -> ${column.to} Band ${cell.band}`);
      }
    }
  }
});

test('Cornerstone-Karten: Abweichung mit 4.10.3-Positionen nur bei microTech und CRU-L3', () => {
  // Gegenprobe: ohne die 3.16.1-Positionen weichen genau diese Spalten ab, alle anderen bleiben unter 20 km
  for (const page of chart.pages) {
    for (const column of page.columns) {
      const worst = Math.max(
        ...chartCells(page, column, {})
          .filter((c) => !(c.key in MISPRINTS))
          .map((c) => Math.abs(c.ours - c.printed)),
      );
      const what = `${page.refinery} -> ${column.to}: ${worst.toFixed(1)} km`;
      if (column.to === 'MICROTECH') assert.ok(worst > 100 && worst < 200, what);
      else if (column.to === 'CRU-L3') assert.ok(worst > CHART_TOLERANCE && worst < 30, what);
      else assert.ok(worst <= CHART_TOLERANCE, what);
    }
  }
});

// ---------- API ----------

test('API: Daten, Halo-Route MIC-L1 -> Hurston, Fehler, Zielvorschläge', async () => {
  const app = await startApp({ overrides: { server: { host: '127.0.0.1', port: 0 }, modules: { controls: { driver: 'mock' } } } });
  const get = (path) => fetch(`http://127.0.0.1:${app.port}/api/navigation${path}`);
  try {
    const data = await (await get('/data')).json();
    assert.match(data.build, /^4\.10\.3/);
    assert.equal(data.system, 'Stanton');
    assert.equal(data.halo.bands.length, 10);
    assert.ok(data.places.length >= 40);
    assert.ok(data.places.every((p) => p.kind !== 'marker'), 'keine Markierungen');
    assert.ok(data.star.radius > 0);

    const res = await get('/halo?from=mic-l1&to=hurston');
    assert.equal(res.status, 200);
    const r = await res.json();
    assert.equal(r.from.name, 'MIC-L1 Shallow Frontier Station');
    assert.equal(r.to.id, 'hurston');
    assert.equal(r.route.best.band, 5);
    assert.equal(r.route.best.hud, 13.2);
    assert.deepEqual(r.obstructions, []);

    // Seraphim liegt im Orbit von Crusader: Crusader zählt nicht als Hindernis
    const ser = await (await get('/halo?from=seraphim&to=arc-l1')).json();
    assert.ok(!ser.obstructions.some((o) => o.id === 'crusader'));
    // HUR-L3 liegt Hurston genau gegenüber: die Route führt durch den Stern
    const sun = await (await get('/halo?from=hur-l3&to=hurston')).json();
    assert.ok(sun.obstructions.some((o) => o.id === 'stanton' && o.clearance < 0), 'HUR-L3 -> Hurston führt durch den Stern');

    assert.equal((await get('/halo?from=gibts&to=hurston')).status, 400);
    assert.match((await (await get('/halo?from=mic-l1&to=gibts')).json()).error, /Ziel/);
    assert.equal((await get('/halo?from=hur-l1-centre&to=hurston')).status, 400, 'Markierungen sind keine Ziele');
    assert.equal((await get('/suggest?from=mic-l1&band=11')).status, 400);
    assert.equal((await get('/suggest?from=mic-l1&band=x')).status, 400);
    assert.equal((await get('/suggest?from=gibts&band=5')).status, 400);

    const list = await (await get('/suggest?from=mic-l1&band=5&limit=8')).json();
    assert.ok(list.length > 0 && list.length <= 8);
    assert.ok(list.some((s) => s.id === 'hurston'));
    for (const s of list) {
      assert.equal(s.crossing.band, 5);
      assert.equal(s.crossing.status, 'in');
    }
    for (let i = 1; i < list.length; i++) assert.ok(list[i].length >= list[i - 1].length);
  } finally {
    await app.stop();
  }
});
