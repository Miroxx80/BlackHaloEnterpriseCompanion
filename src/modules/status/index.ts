import os from 'node:os';
import { lanAddresses } from '../../core/net.js';
import type { BhModule } from '../../core/types.js';

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
    nav: { label: 'Status', icon: '📊' },
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
  },
};

export default mod;
