// Tests für den Mining Companion: Datensatz, Rechenkern und API.
// Referenzwerte: docs/research/mining-companion.md (Bedrock-Quellcode, Datamine 4.10.3) und echte Scans.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp } from '../dist/core/app.js';
import { calculate } from '../dist/modules/mining/calc.js';
import { matchSignature, parseSignature, signatureTable } from '../dist/modules/mining/signature.js';

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
    Pitman: [3900, 0.2, 25, 40, 2], // Slots stehen als Array im Rohformat (früher fälschlich 0)
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
  // Weiß ist der Normalfall vor dem Laser (im Spiel bestätigt): keine Warnung
  assert.deepEqual(white.notes, []);
});

test('Farbige 100 % Resistenz sind gekappt: vorsichtig rechnen, kein falscher Gadget-Rat', () => {
  // Arbor MH1 (+25 %): Jeder Stein ab 80 % eigener Resistenz zeigt rot 100 %
  const arbor = { laserId: L('Arbor MH1'), moduleIds: [] };
  const r = calculate(data, scan({ mass: 6000, resistance: 100, resistanceColored: true, instability: 2, instabilityColored: true }), arbor);
  assert.equal(r.rock.resistanceOwn, 100);
  assert.match(r.notes.join(' '), /gekappt.*mindestens 80 %/);
  assert.equal(r.gadgets.kind, 'none-helps'); // früher fälschlich "Sabir nötig"
});

test('Weiß trotz Gadget am Stein: Hinweis, weil das Spiel dann farbig anzeigt', () => {
  const r = calculate(data, scan({ mass: 6000, resistance: 30, instability: 2, gadgetAttached: G('Sabir') }), { laserId: L('Helix I'), moduleIds: [] });
  assert.match(r.notes.join(' '), /Resistenz ist weiß, obwohl ein Gadget/);
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
  // Arbor MH1 (2340, Resistenz +25 %), 8500 kg, 50 %: ohne Gadget unmöglich, mit Sabir machbar (unter 100 %)
  const arbor = { laserId: L('Arbor MH1'), moduleIds: [] };
  const r = calculate(data, scan({ mass: 8500, resistance: 50, instability: 1 }), arbor);
  assert.equal(r.baseline.status, 'impossible');
  assert.equal(r.gadgets.kind, 'required');
  assert.equal(r.gadgets.best.gadget.name, 'Sabir');
  assert.ok(r.gadgets.best.assessment.share <= 1);

  // 9000 kg: Sabir käme nur auf ~102 % (Grenzfall). Das ist kein verlässlicher Rat.
  assert.equal(calculate(data, scan({ mass: 9000, resistance: 50, instability: 1 }), arbor).gadgets.kind, 'none-helps');

  // Ein Gadget, das den Laser "zu stark" macht, verliert gegen eins, das normal passt
  const impact = calculate(data, scan({ mass: 1000, resistance: 95, instability: 1 }), { laserId: L('Impact I'), moduleIds: [] });
  assert.equal(impact.gadgets.kind, 'required');
  assert.equal(impact.gadgets.best.assessment.status, 'ok');
  assert.equal(impact.gadgets.best.gadget.name, 'OptiMax');

  const hopeless = calculate(data, scan({ mass: 40000, resistance: 80, instability: 1 }), arbor);
  assert.equal(hopeless.gadgets.kind, 'none-helps');

  // Sicher machbar mit hoher Instabilität: BoreMax als optional
  const easy = calculate(data, scan({ mass: 3000, resistance: 10, instability: 20 }), { laserId: L('Hofstede-S1'), moduleIds: [] });
  assert.equal(easy.gadgets.kind, 'optional');
  assert.equal(easy.gadgets.best.gadget.name, 'BoreMax');
});

test('Grenzfall 100–105 %: eigener Status, Spanne bei 100 % gekappt', () => {
  // Arbor MH1, 30 % farbig: knapp über der Höchstmasse
  const r = calculate(data, scan({ mass: 8980, resistance: 30, resistanceColored: true, instability: 2, instabilityColored: true }), { laserId: L('Arbor MH1'), moduleIds: [] });
  assert.equal(r.baseline.status, 'edge');
  assert.ok(r.baseline.band[1] <= 100);
  assert.equal(r.gadgets.kind, 'required');
});

test('Laser zu stark: kein optionales Gadget (Abstand ist die Lösung)', () => {
  const r = calculate(data, scan({ mass: 300, resistance: 10, instability: 1 }), { laserId: L('Helix I'), moduleIds: [] });
  assert.equal(r.baseline.status, 'too-strong');
  assert.equal(r.gadgets.kind, 'optional');
  assert.equal(r.gadgets.best, undefined);
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
  // Offene Frage an die Orga: Der Scan zeigt Instabilität rot, Helix I ändert sie laut Spieldaten aber nicht.
  // Welcher Laser/welche Module waren montiert? Bis dahin erwarten wir den Hinweis.
  assert.match(r.notes.join(' '), /Instabilität ist farbig, aber das gewählte Setup verändert sie nicht/);
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
    const saved = await call('PUT', '/loadouts', { revision: initial.revision, activeId: 'helix', loadouts: [...initial.loadouts, helix] });
    assert.equal(saved.status, 200);
    const afterSave = await saved.json();
    assert.equal(afterSave.revision, initial.revision + 1);

    // Zweites Gerät mit altem Stand darf nicht überschreiben
    const stale = await call('PUT', '/loadouts', { revision: initial.revision, loadouts: initial.loadouts });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).current.activeId, 'helix');

    // S2-Laser passt nicht in die Prospector
    const bad = await call('PUT', '/loadouts', { revision: afterSave.revision, loadouts: [{ ...helix, laserId: L('Helix II') }] });
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

test('API: Loadouts nach Patch beiseitelegen statt löschen, kaputte Datei sichern', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'bh-mining-'));
  mkdirSync(join(dataRoot, 'mining'));
  const file = join(dataRoot, 'mining', 'loadouts.json');
  const ok = { id: 'a', name: 'Arbor', shipId: 'MISC_Prospector', laserId: L('Arbor MH1'), moduleIds: [] };
  const old = { id: 'b', name: 'Alt', shipId: 'MISC_Prospector', laserId: L('Helix I'), moduleIds: ['mining_modules_gibt_es_nicht_mehr'] };
  writeFileSync(file, JSON.stringify({ activeId: 'a', revision: 3, loadouts: [ok, old] }));
  const opts = { overrides: { server: { host: '127.0.0.1', port: 0 }, modules: { controls: { driver: 'mock' } } }, dataRoot };

  let app = await startApp(opts);
  const call = (method, path, body) =>
    fetch(`http://127.0.0.1:${app.port}/api/mining${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    }).then((r) => r.json());
  try {
    const store = await call('GET', '/loadouts');
    assert.deepEqual(store.loadouts.map((l) => l.id), ['a']);
    assert.equal(store.staleCount, 1);
    // Speichern löscht das beiseitegelegte Loadout nicht
    await call('PUT', '/loadouts', { ...store, activeId: 'a' });
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).stale.map((l) => l.id), ['b']);
  } finally {
    await app.stop();
  }

  // Kaputte Datei: Sicherungskopie, dann Standard
  writeFileSync(file, '{ kaputt');
  app = await startApp(opts);
  try {
    const store = await call('GET', '/loadouts');
    assert.equal(store.loadouts.length, 1);
    assert.ok(readdirSync(join(dataRoot, 'mining')).some((f) => f.startsWith('loadouts.json.kaputt-')));
  } finally {
    await app.stop();
  }
});

test('Gemeinsamer Scan: Befehle, Prüfung, Verteilen an andere Geräte, Speichern über Neustart', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'bh-mining-sync-'));
  const opts = { overrides: { server: { host: '127.0.0.1', port: 0 }, modules: { controls: { driver: 'mock' } } }, dataRoot };
  let app = await startApp(opts);
  const call = (method, path, body) =>
    fetch(`http://127.0.0.1:${app.port}/api/mining${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  // Zweites Gerät hört per WebSocket mit
  const ws = new WebSocket(`ws://127.0.0.1:${app.port}/ws`);
  const inbox = [];
  ws.onmessage = (e) => inbox.push(JSON.parse(e.data));
  await new Promise((r) => (ws.onopen = r));
  const waitFor = async (type) => {
    for (let i = 0; i < 100; i++) {
      const m = inbox.find((x) => x.type === type);
      if (m) return inbox.splice(inbox.indexOf(m), 1)[0];
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`keine Nachricht ${type}`);
  };
  try {
    const start = await (await call('GET', '/scan')).json();
    assert.equal(start.scan.parts.length, 1);

    // Halbe Eingaben werden genau so übernommen (Text), Farbe und Zeilen
    const res = await call('POST', '/scan', {
      origin: 'pc-1',
      ops: [
        { op: 'set', field: 'mass', value: '4,627' },
        { op: 'set', field: 'instability', value: '64,' },
        { op: 'set', field: 'resColor', value: 'red' },
        { op: 'part', index: 0, field: 'ore', value: 'Raw_Bexalite' },
        { op: 'addPart' },
        { op: 'part', index: 1, field: 'pct', value: '26,3' },
      ],
    });
    assert.equal(res.status, 200);
    const after = await res.json();
    assert.equal(after.revision, start.revision + 1);
    assert.deepEqual([after.scan.mass, after.scan.instability, after.scan.resColor], ['4,627', '64,', 'red']);
    assert.equal(after.scan.parts.length, 2);

    const msg = await waitFor('mining:scan');
    assert.equal(msg.payload.origin, 'pc-1');
    assert.equal(msg.payload.scan.mass, '4,627');

    // Ungültige Befehle: nichts wird halb übernommen
    for (const ops of [
      [{ op: 'set', field: 'mass', value: '1' }, { op: 'set', field: 'gibtsnicht', value: 'x' }],
      [{ op: 'set', field: 'resColor', value: 'blau' }],
      [{ op: 'part', index: 0, field: 'ore', value: 'Ore_Unobtainium' }],
      [{ op: 'part', index: 9, field: 'pct', value: '1' }],
      [{ op: 'set', field: 'mass', value: 'x'.repeat(100) }],
      [],
    ]) {
      const bad = await call('POST', '/scan', { origin: 'pc-1', ops });
      assert.equal(bad.status, 400, JSON.stringify(ops));
    }
    assert.equal((await (await call('GET', '/scan')).json()).scan.mass, '4,627');

    // Loadout-Wechsel geht auch an andere Geräte
    const lo = await (await call('GET', '/loadouts')).json();
    await call('PUT', '/loadouts', lo);
    assert.equal((await waitFor('mining:loadouts')).payload.revision, lo.revision + 1);

    // Nach Neustart ist der Scan noch da
    await app.stop();
    app = await startApp(opts);
    const again = await (await call('GET', '/scan')).json();
    assert.equal(again.scan.mass, '4,627');
    assert.equal(again.scan.parts[1].pct, '26,3');
  } finally {
    ws.close();
    await app.stop();
  }
});

test('Crafting-Bonus: zusätzliche Laserleistung wird eingerechnet, Grenzen und Speichern im Loadout', async () => {
  const lo = { laserId: L('Helix I'), moduleIds: [M('Rieger-C3'), M('Rieger-C3')] };
  const plain = calculate(data, scan({ mass: 10000, resistance: 0, instability: 1 }), lo);
  const crafted = calculate(data, scan({ mass: 10000, resistance: 0, instability: 1 }), { ...lo, powerBonusPct: 10.5 });
  // Helix I 3900 × 1,25 × 1,25 (HUD zeigt 156) × 1,105 Crafting
  near(plain.setup.power, 3900 * 1.5625, 1e-6, 'Leistung ohne Crafting');
  near(crafted.setup.power, 3900 * 1.5625 * 1.105, 1e-6, 'Leistung mit Crafting');
  near(crafted.baseline.share, plain.baseline.share / 1.105, 1e-9, 'Anteil sinkt um den Bonus');
  assert.equal(crafted.setup.powerBonusPct, 10.5);
  assert.throws(() => calculate(data, scan({ mass: 1000, resistance: 0, instability: 1 }), { ...lo, powerBonusPct: 500 }), /Crafting-Bonus/);

  const dataRoot = mkdtempSync(join(tmpdir(), 'bh-mining-craft-'));
  const app = await startApp({ overrides: { server: { host: '127.0.0.1', port: 0 }, modules: { controls: { driver: 'mock' } } }, dataRoot });
  const call = (method, path, body) =>
    fetch(`http://127.0.0.1:${app.port}/api/mining${path}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  try {
    const store = await (await call('GET', '/loadouts')).json();
    assert.equal(store.loadouts[0].powerBonusPct, 0); // ältere/Standard-Loadouts: 0
    const mine = { id: 'craft', name: 'Helix gecraftet', shipId: 'MISC_Prospector', ...lo, powerBonusPct: 10.5 };
    const saved = await call('PUT', '/loadouts', { revision: store.revision, activeId: 'craft', loadouts: [...store.loadouts, mine] });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).loadouts.find((l) => l.id === 'craft').powerBonusPct, 10.5);
    const bad = await call('PUT', '/loadouts', { revision: store.revision + 1, loadouts: [{ ...mine, powerBonusPct: 'viel' }] });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /Crafting-Bonus/);
    // Berechnung mit dem aktiven Loadout nutzt den Bonus
    const res = await (await call('POST', '/calc', { scan: scan({ mass: 10000, resistance: 0, instability: 1 }) })).json();
    assert.equal(res.setup.powerBonusPct, 10.5);
  } finally {
    await app.stop();
  }
});

test('Signaturen aus den Spieldaten: 26 Schiffs-Erze wie im Spiel (Gegenprobe mit Bedrock/SCMDB 4.10)', () => {
  const sig = Object.fromEntries(data.ores.filter((o) => o.signature).map((o) => [o.name, o.signature]));
  assert.equal(Object.keys(sig).length, 26);
  assert.deepEqual([sig.Quantainium, sig.Stileron, sig.Savrilium, sig.Lindinium, sig.Gold, sig.Copper, sig.Ice], [3170, 3185, 3200, 3400, 3585, 4240, 4300]);
  // Keine zwei Erze mit gleichem Wert innerhalb der Clustergrößen
  const values = signatureTable(data).flatMap((t) => t.values);
  assert.equal(new Set(values).size, values.length);
  // Clustergrößen je Seltenheit (größter Cluster 2/3/4/5/6)
  const max = (r) => Math.max(...data.signatures.clusters[r].sizes.map((s) => s.size));
  assert.deepEqual(['legendary', 'epic', 'rare', 'uncommon', 'common'].map(max), [2, 3, 4, 5, 6]);
  assert.deepEqual(data.signatures.families.map((f) => f.base), [4000, 3000, 2000]);
  assert.ok(data.ores.every((o) => o.density > 0), 'jede Erz-Dichte bekannt');
});

test('Signatur deuten: Erz x Steine, Mehrdeutigkeit am Boden, Ort, Summen, Tippfehler', () => {
  assert.equal(parseSignature('6.370'), 6370);
  assert.equal(parseSignature('16,960'), 16960);
  assert.equal(parseSignature('6.37'), null);
  let r = matchSignature(6370, data);
  assert.equal(r.exact, true);
  assert.equal(r.candidates[0].label, 'Stileron ×2');
  r = matchSignature(16960, data);
  assert.equal(r.candidates[0].label, 'Copper ×4');
  // 12.000: ROC x3 = Hand x4 = Bergung/Pflanzen x6, alle angezeigt
  r = matchSignature(12000, data);
  assert.deepEqual(r.candidates.map((c) => c.parts[0].id).sort(), ['fps', 'roc', 'small']);
  assert.match(r.notes.join(' '), /Mehrdeutig/);
  // Im All (Aaron Halo) gibt es keine Bodenvorkommen
  r = matchSignature(12000, data, { location: 'HPP_AaronHalo' });
  assert.equal(r.candidates[0].parts[0].id, 'small');
  assert.ok(r.candidates.filter((c) => c.parts[0].id !== 'small').every((c) => c.outOfPlace));
  // Ort: Kupfer gibt es auf Ita nicht
  r = matchSignature(4240 * 4, data, { location: 'HPP_Stanton1d' });
  assert.equal(r.candidates[0].outOfPlace, true);
  // Beobachtete Mischsignatur: 76.975 = Zinn x5 + ROC x14
  r = matchSignature(76975, data);
  assert.equal(r.exact, false);
  assert.equal(r.candidates[0].label, 'Tin ×5 + ROC-Vorkommen (Bodenfahrzeug) ×14');
  // Tippfehler: nächster Wert zuerst
  r = matchSignature(16965, data);
  assert.equal(r.candidates[0].kind, 'near');
  assert.equal(r.candidates[0].label, 'Copper ×4');
});

test('API: Signatur deuten', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'bh-sig-'));
  const app = await startApp({ overrides: { server: { host: '127.0.0.1', port: 0 }, modules: { controls: { driver: 'mock' } } }, dataRoot });
  const base = `http://127.0.0.1:${app.port}/api/mining`;
  try {
    const r = await (await fetch(`${base}/signature?value=6.370`)).json();
    assert.equal(r.candidates[0].label, 'Stileron ×2');
    assert.equal((await fetch(`${base}/signature?value=abc`)).status, 400);
    const d = await (await fetch(`${base}/data`)).json();
    assert.ok(d.signatures.table.length === 26 && d.signatures.locations.length > 30);
  } finally {
    await app.stop();
  }
});
