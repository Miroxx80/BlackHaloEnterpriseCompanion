import { startApp } from './core/app.js';
import { createLogger } from './core/logger.js';
import { lanAddresses } from './core/net.js';

const log = createLogger('main');

try {
  const app = await startApp();
  const q = app.config.security.token ? `/?token=${app.config.security.token}` : '/';
  log.info(`Rolle: ${app.config.role}`);
  log.info(`Lokal:  http://localhost:${app.port}${q}`);
  for (const ip of lanAddresses()) log.info(`Tablet: http://${ip}:${app.port}${q}`);

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return; // zweites Strg+C während des Beendens ignorieren
    stopping = true;
    log.info('Beende ...');
    try {
      await app.stop();
    } catch (err) {
      log.error('Beenden nicht sauber:', err);
      process.exit(1);
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (err) {
  log.error('Start fehlgeschlagen:', err);
  process.exit(1);
}
