/**
 * Zugangsschlüssel werden als HTTP-Header (x-bh-token) und in URLs übertragen. Erlaubt sind deshalb nur
 * sichtbare ASCII-Zeichen ohne Leerzeichen. Umlaute, "…" oder typografische Anführungszeichen würden
 * im Browser jede Anfrage scheitern lassen.
 */
export const TOKEN_PATTERN = /^[\x21-\x7e]{1,256}$/;

export function isValidToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

export const TOKEN_RULE = 'nur Buchstaben (ohne Umlaute), Ziffern und Zeichen wie - _ . ohne Leerzeichen, höchstens 256 Zeichen';
