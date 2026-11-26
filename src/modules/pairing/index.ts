import QRCode from 'qrcode';
import { lanInterfaces } from '../../core/net.js';
import type { BhModule } from '../../core/types.js';

/**
 * Gerät verbinden: zeigt pro LAN-Adresse einen QR-Code mit URL und Token.
 * Das Tablet scannt ihn, öffnet die Seite und merkt sich das Token.
 */
const mod: BhModule = {
  manifest: {
    id: 'pairing',
    name: 'Gerät verbinden',
    version: '0.1.0',
    roles: ['companion'],
    nav: { label: 'Verbinden', icon: 'pairing', description: 'Geräte koppeln' },
    ui: true,
  },

  setup(ctx) {
    ctx.http.get('/', async (req) => {
      const port = req.socket.localPort;
      // Ist ein Token gesetzt, kommt diese Anfrage nur mit gültigem Token durch.
      // Wir geben also genau das Token weiter, mit dem der Aufrufer schon Zugriff hat.
      const header = req.headers['x-bh-token'];
      const token = typeof header === 'string' ? header : '';
      const query = token ? `/?token=${encodeURIComponent(token)}` : '/';

      const targets = await Promise.all(
        lanInterfaces().map(async ({ name, address, virtual }) => {
          const url = `http://${address}:${port}${query}`;
          const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
          return {
            adapter: name,
            virtual,
            display: `http://${address}:${port}`,
            qr: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
          };
        }),
      );
      return { protected: !!token, targets };
    });
  },
};

export default mod;
