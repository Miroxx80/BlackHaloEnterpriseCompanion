import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp } from '../dist/core/app.js';

const LOCAL = { server: { host: '127.0.0.1', port: 0 } };

/** Kleiner WS-Client: sammelt Nachrichten und wartet gezielt auf einen Typ. */
function openWs(port, query = '') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws${query}`);
    const inbox = [];
    const waiters = [];
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      const i = waiters.findIndex((w) => w.type === msg.type);
      if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
      else inbox.push(msg);
    };
    ws.onerror = () => reject(new Error('WS-Fehler'));
    ws.onopen = () =>
      resolve({
        send: (type, payload) => ws.send(JSON.stringify({ type, payload })),
        next: (type) =>
          new Promise((res, rej) => {
            const i = inbox.findIndex((m) => m.type === type);
            if (i >= 0) return res(inbox.splice(i, 1)[0]);
            const t = setTimeout(() => rej(new Error(`Timeout auf ${type}`)), 2000);
            waiters.push({ type, resolve: (m) => { clearTimeout(t); res(m); } });
          }),
        close: () => ws.close(),
      });
  });
}

test('echte Module: REST, UI-Dateien und WebSocket', async () => {
  const app = await startApp({ overrides: LOCAL });
  const base = `http://127.0.0.1:${app.port}`;
  try {
    const mods = await (await fetch(`${base}/api/modules`)).json();
    const states = Object.fromEntries(mods.modules.map((m) => [m.id, m.state]));
    assert.deepEqual(states, { controls: 'running', status: 'running' });

    const buttons = await (await fetch(`${base}/api/controls/buttons`)).json();
    assert.equal(buttons.buttons.length, 4);

    assert.equal((await fetch(`${base}/api/status`)).status, 200);
    assert.equal((await fetch(`${base}/`)).status, 200);
    assert.equal((await fetch(`${base}/shell.js`)).status, 200);
    assert.equal((await fetch(`${base}/modules/controls/index.js`)).status, 200);
    assert.equal((await fetch(`${base}/modules/status/index.js`)).status, 200);

    const ws = await openWs(app.port);
    const hello = await ws.next('core:hello');
    assert.equal(hello.payload.role, 'companion');

    ws.send('controls:press', { id: 'landing-gear' });
    const pressed = await ws.next('controls:pressed');
    assert.equal(pressed.payload.id, 'landing-gear');

    ws.send('controls:press', { id: 'gibt-es-nicht' });
    const err = await ws.next('controls:error');
    assert.match(err.payload.message, /Unbekannt/);

    // Kaputte Eingaben dürfen den Server nicht stören
    ws.send('controls:press', null);
    await ws.next('controls:error');
    ws.close();
  } finally {
    await app.stop();
  }
});

test('Rolle hub lädt Companion-Module nicht', async () => {
  const app = await startApp({ overrides: { ...LOCAL, role: 'hub' } });
  try {
    const mods = await (await fetch(`http://127.0.0.1:${app.port}/api/modules`)).json();
    const states = Object.fromEntries(mods.modules.map((m) => [m.id, m.state]));
    assert.deepEqual(states, { controls: 'skipped', status: 'running' });
    assert.equal((await fetch(`http://127.0.0.1:${app.port}/api/controls/buttons`)).status, 404);
  } finally {
    await app.stop();
  }
});

test('Token-Schutz für /api und /ws', async () => {
  const app = await startApp({ overrides: { ...LOCAL, security: { token: 'geheim' } } });
  const base = `http://127.0.0.1:${app.port}`;
  try {
    assert.equal((await fetch(`${base}/api/modules`)).status, 401);
    assert.equal((await fetch(`${base}/api/modules`, { headers: { 'x-bh-token': 'falsch' } })).status, 401);
    assert.equal((await fetch(`${base}/api/modules`, { headers: { 'x-bh-token': 'geheim' } })).status, 200);
    assert.equal((await fetch(`${base}/`)).status, 200); // Shell bleibt frei

    await assert.rejects(openWs(app.port)); // ohne Token
    const ws = await openWs(app.port, '?token=geheim');
    await ws.next('core:hello');
    ws.close();
  } finally {
    await app.stop();
  }
});

test('ein defektes Modul reißt die anderen nicht mit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bh-mods-'));
  const mk = (id, code) => {
    mkdirSync(join(dir, id));
    writeFileSync(join(dir, id, 'index.js'), code);
  };
  const manifest = (id, extra = '') =>
    `manifest: { id: '${id}', name: '${id}', version: '1.0.0', roles: ['companion'] ${extra}}`;

  // "broken" startet vor "good" (alphabetisch). Was broken vor dem Absturz anmeldet, muss weg sein.
  mk(
    'good',
    `export default { ${manifest('good')}, setup(ctx) {
      ctx.services.provide('leak', 'von good'); // wäre ein Fehler, wenn broken den Namen noch hielte
      ctx.http.get('/ping', async () => ({ ok: true }));
      ctx.http.get('/probe', async () => {
        globalThis.__bhLeak = false;
        ctx.events.emit('probe');
        return { leak: globalThis.__bhLeak, service: ctx.services.get('leak') };
      });
    } };`,
  );
  mk(
    'broken',
    `export default { ${manifest('broken')}, setup(ctx) {
      ctx.http.get('/ping', async () => ({ ok: true }));
      ctx.ws.on('x', () => {});
      ctx.services.provide('leak', 'von broken');
      ctx.events.on('probe', () => { globalThis.__bhLeak = true; });
      throw new Error('kaputt');
    } };`,
  );
  mk('child', `export default { ${manifest('child', ", dependsOn: ['broken']")}, setup() {} };`);
  mk('garbage', `export default { irgendwas: 1 };`);
  mk('syntax', `export default {{{`);
  mk('off', `export default { ${manifest('off')}, setup() { throw new Error('darf nicht laufen'); } };`);

  const app = await startApp({
    overrides: { ...LOCAL, modules: { off: { enabled: false } } },
    modulesDir: dir,
    dataRoot: join(dir, '_data'),
  });
  const base = `http://127.0.0.1:${app.port}`;
  try {
    const mods = await (await fetch(`${base}/api/modules`)).json();
    const states = Object.fromEntries(mods.modules.map((m) => [m.id, m.state]));
    assert.deepEqual(states, {
      broken: 'failed',
      child: 'failed',
      garbage: 'failed',
      good: 'running',
      off: 'disabled',
      syntax: 'failed',
    });

    assert.equal((await fetch(`${base}/api/good/ping`)).status, 200);
    assert.equal((await fetch(`${base}/api/broken/ping`)).status, 503); // Teil-Routen werden gesperrt
    const child = mods.modules.find((m) => m.id === 'child');
    assert.match(child.error, /broken/);

    const probe = await (await fetch(`${base}/api/good/probe`)).json();
    assert.deepEqual(probe, { leak: false, service: 'von good' });

    assert.ok(existsSync(join(dir, '_data', 'good')), 'dataDir wird vor setup() angelegt');
  } finally {
    await app.stop();
  }
});

test('ungültige Config wird beim Start abgelehnt', async () => {
  await assert.rejects(startApp({ overrides: { server: { port: 'abc' } } }), /server\.port/);
  await assert.rejects(startApp({ overrides: { ...LOCAL, role: 'server' } }), /role/);
});
