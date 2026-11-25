import type { Logger } from './types.js';

export function createLogger(scope: string): Logger {
  const line = (level: string, msg: string, args: unknown[]) => {
    const time = new Date().toISOString().slice(11, 19);
    const out = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
    out(`${time} ${level.padEnd(5)} [${scope}] ${msg}`, ...args);
  };
  return {
    debug: (m, ...a) => {
      if (process.env.BH_DEBUG) line('DEBUG', m, a);
    },
    info: (m, ...a) => line('INFO', m, a),
    warn: (m, ...a) => line('WARN', m, a),
    error: (m, ...a) => line('ERROR', m, a),
  };
}
