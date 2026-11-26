// Tests für den Mining Companion: Datensatz, Rechenkern und API.
// Referenzwerte: docs/research/mining-companion.md (Bedrock-Quellcode, Datamine 4.10.3) und echte Scans.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp } from '../dist/core/app.js';
import { calculate } from '../dist/modules/mining/calc.js';

const data = JSON.parse(readFileSync(new URL('../src/modules/mining/data/dataset.json', import.meta.url), 'utf8'));
const L = (name) => data.lasers.find((l) => l.name === name).id;
const M = (name) => data.modules.find((m) => m.name === name).id;
const G = (name) => data.gadgets.find((g) => g.name === name).id;
const near = (actual, expected, eps, what) =>
  assert.ok(Math.abs(actual - expected) <= eps, `${what}: ${actual} statt ${expected} (±${eps})`);

const scan = (o) => ({ resistanceColored: false, instabilityColored: false, ...o });

test('Datensatz 4.10.3 stimmt mit den recherchierten Werten überein (Datamine/Bedrock)', () => {
  assert.match(data.build, /^4\.10\.3-LIVE/);
  assert.equal(data.ruleset.decayPerMass, 0.2);
  const laser = (name) => data.lasers.find((l) => l.name === name);
  // Name: [Leistung, Mindest-Drosselung, Resistenz %, Fenster %, Slots]
  const expected = {
    'Helix I': [3900, 0.2, -30, -40, 2],
    'Hofstede-S1': [2600, 0.05, -30, 60, 1],
    'Arbor MH1': [2340, 0.05, 25, 40, 1],
    'Klein-S1': [3120, 0.15, -45, 20, 0],
    'Lancet MH1': [3120, 0.2, 0, -60, 1],
    'Impact I': [2600, 0.2, 10, 20, 2],
    'Helix II': [4930, 0.3, -30, -40, 3],
    'Hofstede-S2': [4060, 0.1, -30, 60, 2],
  };
  for (const [name, [power, tmin, res, win, slots]] of Object.entries(expected)) {
    const l = laser(name);
    assert.deepEqual([l.power, l.throttleMin, l.mods.resistance, l.mods.window, l.slots], [power, tmin, res, win, slots], name);
  }
  const mod = (name) => data.modules.find((m) => m.name === name);
  assert.deepEqual([mod('Surge').power, mod('Surge').mods.resistance, mod('Surge').mods.instability, mod('Surge').canInterrupt], [1.5, -15.5, 10, false]);
  assert.deepEqual([mod('Rieger-C3').power, mod('Rieger-C3').mods.window], [1.25, -1]);
  assert.deepEqual([mod('Focus III').power, mod('Focus III').mods.window], [0.95, 40]);
  assert.equal(mod('Rime').mods.resistance, -24.8);
  const gad = (name) => data.gadgets.find((g) => g.name === name).mods;
  assert.deepEqual([gad('BoreMax').instability, gad('BoreMax').resistance], [-70, 10]);
  assert.equal(gad('OptiMax').resistance, -25); // Spieldaten, nicht der Beschreibungstext (-30)
  assert.equal(gad('Sabir').resistance, -50);
  assert.ok(data.ores.some((o) => o.id === 'Ore_Titanium' && o.form === 'ORE'));
  assert.ok(data.ores.some((o) => o.id === 'Raw_Bexalite' && o.form === 'RAW'));
});

test('Referenz-Screenshot Bedrock: Bexalit 4627 kg, RES 56 %, Hofstede-S2 -> 30–38 %', () => {
  const r = calculate(data, scan({ mass: 4627, resistance: 56, instability: 64.16 }), { laserId: L('Hofstede-S2'), moduleIds: [] });
  near(r.rock.needs, 925.4, 0.01, 'Bedarf');
  near(r.baseline.share, 0.336, 0.001, 'Anteil');
  assert.deepEqual(r.baseline.band, [30, 38]);
  assert.equal(r.baseline.status, 'ok');
  // Linear (Option) ergibt laut Recherche 37,5 %
  const lin = calculate(data, scan({ mass: 4627, resistance: 56, instability: 64.16 }), { laserId: L('Hofstede-S2'), moduleIds: [] }, { resistanceExponent: 1 });
  near(lin.baseline.share, 0.375, 0.001, 'Anteil linear');
  // BoreMax auf den Stein: Instabilität des Steins 64,16 -> 19,25 (Bedrock "64.2 -> 19.2"), hier zusätzlich mit Laser (+10 %)
  const bore = r.gadgets.all.find((o) => o.gadget.name === 'BoreMax');
  near(bore.assessment.instability, 64.16 * 0.3 * 1.1, 0.001, 'Instabilität mit BoreMax');
});

test('Farbige Werte werden zurückgerechnet: gleiches Ergebnis wie mit dem weißen Steinwert', () => {
  const lo = { laserId: L('Helix I'), moduleIds: [] };
  const white = calculate(data, scan({ mass: 8000, resistance: 40, instability: 2 }), lo);
  // Helix I: Resistenz × 0,7. Instabilität unverändert (0 %).
  const colored = calculate(data, scan({ mass: 8000, resistance: 28, resistanceColored: true, instability: 2 }), lo);
  near(colored.rock.resistanceOwn, 40, 1e-9, 'eigene Resistenz');
  near(colored.baseline.share, white.baseline.share, 1e-9, 'Anteil');
  assert.deepEqual(colored.notes, []);
  // Weiß, obwohl der Laser die Resistenz ändert: rechnet mit dem Wert, gibt aber einen Hinweis
  assert.match(white.notes.join(' '), /Resistenz ist weiß/);
});

test('Gadget schon am Stein: farbiger Wert enthält Laser und Gadget', () => {
  // Helix I (×0,7) und Sabir (×0,5): Stein 40 % wird als 14 % angezeigt
  const r = calculate(
    data,
    scan({ mass: 8000, resistance: 14, resistanceColored: true, instability: 1, gadgetAttached: G('Sabir') }),
    { laserId: L('Helix I'), moduleIds: [] },
  );
  near(r.rock.resistanceOwn, 40, 1e-9, 'eigene Resistenz');
  near(r.baseline.resistancePct, 14, 1e-9, 'wirksame Resistenz');
  assert.equal(r.gadgets.kind, 'attached');
});

test('Prospector Helix I: Höchstmasse, Surge parallel, Laser zu stark', () => {
  const r = calculate(data, scan({ mass: 10000, resistance: 0, instability: 0 }), {
    laserId: L('Helix I'),
    moduleIds: [M('Surge'), M('Surge')],
  });
  near(r.baseline.maxMass, 19500, 0.01, 'Höchstmasse ohne Module');
  // Zwei Surge laufen gleichzeitig: 3900 × 1,5 × 1,5 / 0,2 ≈ 44.000 kg (Community-Messung)
  assert.equal(r.variants.length, 1);
  assert.deepEqual(r.variants[0].moduleNames, ['Surge', 'Surge']);
  near(r.variants[0].assessment.maxMass, 43875, 0.01, 'Höchstmasse mit 2× Surge');

  // Kleiner Stein: selbst bei Mindestleistung (20 %) zu stark -> Abstand halten
  const small = calculate(data, scan({ mass: 500, resistance: 0, instability: 0 }), { laserId: L('Helix I'), moduleIds: [] });
  assert.equal(small.baseline.status, 'too-strong');
  assert.ok(small.baseline.backoffM > 15 && small.baseline.backoffM < 45, `Abstand ${small.baseline.backoffM} m`);
});

test('Aktive Module: exklusive einzeln, Surge zusätzlich parallel', () => {
  const r = calculate(data, scan({ mass: 10000, resistance: 30, instability: 1 }), {
    laserId: L('Helix I'),
    moduleIds: [M('Surge'), M('Brandt')],
  });
  assert.deepEqual(r.variants.map((v) => v.label), ['mit Surge', 'mit Brandt', 'mit Surge + Brandt']);
});

test('Gadget-Empfehlung: nötig, empfohlen, keins hilft', () => {
  // Arbor MH1 (2340, Resistenz +25 %), 9000 kg, 50 %: ohne Gadget unmöglich, mit Sabir knapp machbar
  const arbor = { laserId: L('Arbor MH1'), moduleIds: [] };
  const r = calculate(data, scan({ mass: 9000, resistance: 50, instability: 1 }), arbor);
  assert.equal(r.baseline.status, 'impossible');
  assert.equal(r.gadgets.kind, 'required');
  assert.equal(r.gadgets.best.gadget.name, 'Sabir');
  assert.ok(r.gadgets.best.assessment.share <= 1.05);

  const hopeless = calculate(data, scan({ mass: 40000, resistance: 80, instability: 1 }), arbor);
  assert.equal(hopeless.gadgets.kind, 'none-helps');

  // Sicher machbar mit hoher Instabilität: BoreMax als optional
  const easy = calculate(data, scan({ mass: 3000, resistance: 10, instability: 20 }), { laserId: L('Hofstede-S1'), moduleIds: [] });
  assert.equal(easy.gadgets.kind, 'optional');
  assert.equal(easy.gadgets.best.gadget.name, 'BoreMax');
});

test('Echter Scan Titan 458 kg: SCU und Qualität je Erz', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/scan-panel/titanium-458kg.json', import.meta.url), 'utf8'));
  const ore = (name) => (name === 'INERT MATERIALS' ? null : data.ores.find((o) => o.name.toUpperCase() === name).id);
  const r = calculate(
    data,
    {
      mass: fixture.mass,
      resistance: fixture.resistance.value,
      resistanceColored: true,
      instability: fixture.instability.value,
      instabilityColored: true,
      scu: fixture.scu,
      parts: fixture.parts.map((p) => ({ oreId: ore(p.ore), pct: p.pct, quality: p.quality })),
    },
    { laserId: L('Helix I'), moduleIds: [] },
  );
  assert.deepEqual(r.rock.parts.map((p) => p.name), ['Agricium (Ore)', 'Aslarite (Raw)', 'Titanium (Ore)', 'Titanium (Ore)', 'Inert']);
  near(r.rock.parts[3].scu, 0.4827, 0.0001, 'SCU Titan-Hauptteil');
  assert.equal(r.rock.parts[2].quality, 516);
  assert.equal(r.baseline.status, 'too-strong'); // 458 kg sind für einen Helix I winzig
  assert.ok(!r.notes.some((n) => /Anteile/.test(n)));
});

test('Eingabefehler werden verständlich gemeldet', () => {
  const lo = { laserId: L('Helix I'), moduleIds: [] };
  assert.throws(() => calculate(data, scan({ mass: 0, resistance: 10, instability: 1 }), lo), /Masse/);
  assert.throws(() => calculate(data, scan({ mass: 100, resistance: 120, instability: 1 }), lo), /Resistenz/);
  assert.throws(() => calculate(data, scan({ mass: 100, resistance: 10, instability: 1 }), { laserId: 'gibts', moduleIds: [] }), /Unbekannter Laser/);
  assert.throws(
    () => calculate(data, scan({ mass: 100, resistance: 10, instability: 1 }), { laserId: L('Klein-S1'), moduleIds: [M('Surge')] }),
    /0 Modul-Slot/,
  );
  const sum = calculate(data, scan({ mass: 100, resistance: 10, instability: 1, parts: [{ oreId: 'Ore_Gold', pct: 50 }] }), lo);
  assert.match(sum.notes.join(' '), /50,00 %/);
});

test('API: Datensatz, Loadouts speichern und prüfen, Berechnung', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'bh-mining-'));
  const opts = { overrides: { server: { host: '127.0.0.1', port: 0 }, modules: { controls: { driver: 'mock' } } }, dataRoot };
  let app = await startApp(opts);
  const call = (method, path, body) =>
    fetch(`http://127.0.0.1:${app.port}/api/mining${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    const d = await (await call('GET', '/data')).json();
    assert.match(d.build, /4\.10\.3/);
    assert.equal(d.defaults.resistanceExponent, 1.21);

    const initial = await (await call('GET', '/loadouts')).json();
    assert.equal(initial.loadouts[0].laserId, 'mining_laser_grin_arbor_s1'); // Prospector ab Werk

    const helix = { id: 'helix', name: 'Helix Surge', shipId: 'MISC_Prospector', laserId: L('Helix I'), moduleIds: [M('Surge'), M('Rieger-C3')] };
    const saved = await call('PUT', '/loadouts', { activeId: 'helix', loadouts: [...initial.loadouts, helix] });
    assert.equal(saved.status, 200);

    // S2-Laser passt nicht in die Prospector
    const bad = await call('PUT', '/loadouts', { loadouts: [{ ...helix, laserId: L('Helix II') }] });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /passt nicht in die MISC Prospector/);

    // Berechnung ohne Loadout im Body nimmt das aktive Loadout
    const res = await call('POST', '/calc', { scan: scan({ mass: 4000, resistance: 30, instability: 1 }) });
    assert.equal(res.status, 200);
    const result = await res.json();
    assert.equal(result.setup.laser.name, 'Helix I');
    assert.deepEqual(result.setup.passive, ['Rieger-C3']);

    const invalid = await call('POST', '/calc', { scan: scan({ mass: -5, resistance: 30, instability: 1 }) });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /Masse/);

    // Nach Neustart ist das Loadout noch da
    await app.stop();
    app = await startApp(opts);
    const again = await (await call('GET', '/loadouts')).json();
    assert.equal(again.activeId, 'helix');
  } finally {
    await app.stop();
  }
});
