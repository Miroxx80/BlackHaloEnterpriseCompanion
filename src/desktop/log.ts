import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Eine Log-Datei für Hauptprozess und Server. Wird beim Start rotiert, sobald sie 5 MB überschreitet
 * (eine alte Kopie bleibt als .old.log). Hilft bei der Fehlersuche auf den PCs der Mitglieder.
 */
export function createLogFile(dir: string) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'blackhalo.log');
  if (existsSync(file) && statSync(file).size > MAX_BYTES) renameSync(file, join(dir, 'blackhalo.old.log'));
  const stream: WriteStream = createWriteStream(file, { flags: 'a' });
  stream.on('error', () => {}); // Logging darf die App nie zum Absturz bringen

  return {
    file,
    /** Rohdaten aus dem Server-Prozess (enthalten schon Zeitstempel). */
    raw(chunk: string | Buffer) {
      stream.write(chunk);
      process.stdout.write(chunk);
    },
    /** Zeile aus dem Hauptprozess. */
    line(level: 'INFO' | 'WARN' | 'ERROR', msg: string) {
      const text = `${new Date().toISOString().slice(11, 19)} ${level.padEnd(5)} [desktop] ${msg}\n`;
      stream.write(text);
      (level === 'ERROR' ? process.stderr : process.stdout).write(text);
    },
    close: () => new Promise<void>((r) => stream.end(r)),
  };
}

export type LogFile = ReturnType<typeof createLogFile>;
