import os from 'node:os';
import { lanAddresses } from '../../core/net.js';
import { UPDATE_SERVICE, type BhModule, type UpdateService } from '../../core/types.js';

const startedAt = Date.now();

/**
 * Referenzmodul: zeigt, wie ein Modul REST-Routen und UI mitbringt.
 * Läuft in beiden Rollen (Companion und Hub).
 */
const mod: BhModule = {
  manifest: {
    id: 'status',
    name: 'Status',
    version: '0.1.0',
    roles: ['companion', 'hub'],
    nav: { label: 'Status', icon: 'status', description: 'System' },
    ui: true,
  },

  setup(ctx) {
    ctx.http.get('/', async (req) => ({
      role: ctx.role,
      host: os.hostname(),
      node: process.version,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      clients: ctx.ws.clientCount(),
      port: req.socket.localPort,
      addresses: lanAddresses(),
    }));

    // Updates (nur Desktop-App): Stand abfragen, nachsehen, installieren. Die Arbeit macht die Desktop-App.
    const updates = ctx.services.get<UpdateService>(UPDATE_SERVICE);
    const unsupported = { status: 'unsupported', error: 'Updates gibt es nur in der Desktop-App.' };
    ctx.http.get('/update', async () => updates?.state() ?? unsupported);
    ctx.http.post('/update', async (req, reply) => {
      const action = (req.body as { action?: unknown } | null)?.action;
      if (action !== 'check' && action !== 'install') return reply.code(400).send({ error: "action: 'check' oder 'install'" });
      if (!updates) return reply.code(501).send(unsupported);
      return action === 'install' ? updates.install() : updates.check();
    });
    updates?.onChange((s) => ctx.ws.broadcast('update', s));
  },
};

export default mod;
