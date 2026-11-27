// Tests für die Sprunghilfen: Kreuzungen des Aaron Halo, Hindernisse, Zielvorschläge.
// Referenzwerte: Cornerstone-Karte ARC L1 -> CRU L4 (cstone.space), Positionen aus scunpacked-data 4.10.3
// (fest eingetragen, damit der Test nicht vom Datensatz abhängt) und der Test im Spiel: MIC-L1 -> Hurston,
// Abbruch bei 13,2 Gm landet in Band 5.
import { test } from 'node:test';
import assert from 'node:assert/strict';
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
