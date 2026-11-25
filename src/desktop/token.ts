import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isValidToken } from '../core/token.js';

export type TokenResult = 'kept' | 'created' | 'replaced' | 'skipped';

/**
 * Die Desktop-App läuft immer mit Zugangsschlüssel. Fehlt einer oder ist er ungültig (z. B. von Hand
 * eingetragen mit Umlauten), wird ein neuer erzeugt und in der lokalen Config gespeichert.
 * Ein ungültiger Schlüssel kann ohnehin nie funktionieren; Geräte verbinden sich danach neu per QR-Code.
 */
export function ensureToken(localConfigPath: string, log: (msg: string) => void = console.log): TokenResult {
  let cfg: Record<string, unknown> = {};
  if (existsSync(localConfigPath)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(localConfigPath, 'utf8'));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'skipped';
      cfg = parsed as Record<string, unknown>;
    } catch {
      return 'skipped'; // kaputte Datei nicht überschreiben; loadConfig meldet den Fehler verständlich
    }
  }
  const rawSecurity = cfg.security;
  const security =
    typeof rawSecurity === 'object' && rawSecurity !== null && !Array.isArray(rawSecurity)
      ? (rawSecurity as Record<string, unknown>)
      : {};
  const current = security.token;
  if (typeof current === 'string' && isValidToken(current)) return 'kept';

  const replaced = current !== undefined && current !== '';
  cfg.security = { ...security, token: randomBytes(18).toString('base64url') };
  mkdirSync(dirname(localConfigPath), { recursive: true });
  writeFileSync(localConfigPath, JSON.stringify(cfg, null, 2) + '\n');
  log(
    replaced
      ? `Ungültiger Zugangsschlüssel in ${localConfigPath} durch einen neuen ersetzt. Geräte bitte neu per QR-Code verbinden.`
      : `Neuer Zugangsschlüssel in ${localConfigPath} gespeichert`,
  );
  return replaced ? 'replaced' : 'created';
}
