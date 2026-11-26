/**
 * Gelesene Texte in Scan-Werte umwandeln und gegeneinander prüfen.
 * Unabhängig von der Texterkennung: bekommt Rohtexte, liefert Entwurf + Markierungen "bitte prüfen".
 */
import type { Ore } from '../types.js';

/** Zahl aus einem gelesenen Text, z. B. "58.23", "0%", "9.84", "901.80m" (Milli-SCU). Punkt ist Dezimalpunkt. */
export function cleanNumber(raw: string | null | undefined, { int = false } = {}): string | null {
  if (!raw) return null;
  let t = raw.replace(/\s+/g, '').replace(/%$/, '').replace(/scu$/i, '');
  t = t.replace(/[oO]/g, '0').replace(/[lI|]/g, '1'); // typische Verwechslungen bei Ziffernfeldern
  if (int) t = t.replace(/[.,]/g, '');
  return /^\d+(\.\d+)?m?$/.test(t) ? t : null;
}

const MILLI = (s: string) => (s.endsWith('m') ? Number(s.slice(0, -1)) / 1000 : Number(s));

/** Varianten eines Zahlentexts mit vertauschten 0/8 (durchgestrichene Null). Höchstens 4 Stellen werden variiert. */
export function zeroEightVariants(s: string): string[] {
  const idx = [...s].map((c, i) => (c === '0' || c === '8' ? i : -1)).filter((i) => i >= 0).slice(0, 4);
  const out: string[] = [];
  for (let mask = 0; mask < 1 << idx.length; mask++) {
    const chars = [...s];
    idx.forEach((pos, bit) => {
      if (mask & (1 << bit)) chars[pos] = chars[pos] === '0' ? '8' : '0';
    });
    out.push(chars.join(''));
  }
  return out; // erste Variante = wie gelesen
}

/** Erzname aus dem HUD ("HEPH (RAW)", "TITANIUM (ORE)", "INERT MATERIALS") einem Erz im Datensatz zuordnen. */
export function matchOre(raw: string | null | undefined, ores: Ore[]): { id: string; exact: boolean } | null {
  if (!raw) return null;
  const t = raw.toUpperCase().replace(/[^A-Z() ]/g, ' ').replace(/\s+/g, ' ').trim();
  const flat = t.replace(/[^A-Z]/g, '');
  // "INERT MATERIALS": das erste Wort reicht (eindeutig); verstümmelt (heller Boden) nur unsicher
  if (/^INERT/.test(t) || (flat.length >= 12 && levenshtein(flat, 'INERTMATERIALS') <= 2)) return { id: 'inert', exact: true };
  if (/MATERIALS?$/.test(t) || (flat.length >= 8 && (levenshtein(flat, 'INERTMATERIALS') <= 5 || /ATER?I?ALS?$/.test(flat)))) {
    return { id: 'inert', exact: false };
  }
  // Form am Ende: "(ORE)", "(RAW)", auch verstümmelt wie "CORE)", "ORE", "(RAN"
  const formMatch = t.match(/\s*[(C]?\s*(ORE|0RE|RAW|RAN|RAV)\)?$/);
  const form = formMatch ? (formMatch[1].startsWith('R') ? 'RAW' : 'ORE') : null;
  const clean = !formMatch || /\((ORE|RAW)\)$/.test(t);
  const word = (formMatch ? t.slice(0, formMatch.index) : t).replace(/[^A-Z]/g, '');
  if (word.length < 2) return null;
  const pool = ores.filter((o) => !form || o.form === form);
  // 1. Name beginnt mit dem gelesenen Wort (Abkürzungen der Prospector, z. B. HEPH -> Hephaestanite)
  const prefix = word.length >= 3 ? pool.filter((o) => o.name.toUpperCase().startsWith(word)) : [];
  // Eindeutige Abkürzung mit sauber gelesener Form (z. B. "HEPH (RAW)") gilt als sicher erkannt
  if (prefix.length === 1) return { id: prefix[0].id, exact: clean };
  // 2. Ähnlichster Name (Lesefehler einzelner Buchstaben), höchstens ein Drittel der Buchstaben anders
  // (Anfang des Namens mit Länge ±1, weil Buchstaben fehlen oder doppelt gelesen werden). Gleichstand: keine Wahl.
  const scored = pool.map((o) => {
    const name = o.name.toUpperCase();
    const lens = [word.length - 1, word.length, word.length + 1].filter((n) => n >= 2);
    return { o, d: Math.min(...lens.map((n) => levenshtein(word, name.slice(0, n)))) };
  });
  const bestD = Math.min(...scored.map((x) => x.d));
  const best = scored.filter((x) => x.d === bestD);
  if (best.length === 1 && bestD <= Math.max(1, Math.floor(word.length / 3))) return { id: best[0].o.id, exact: false };
  return null;
}

export function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

export interface ReadPart {
  pct: string | null;
  ore: string | null;
  quality: string | null;
}

/**
 * Anteile der Zusammensetzung prüfen und 0/8-Verwechslungen auflösen: Die Anteile müssen 98–100,5 % ergeben.
 * Gibt die korrigierten Anteile zurück und welche Zeilen dafür geändert wurden (die werden zum Prüfen markiert).
 */
export function resolvePercents(pcts: (string | null)[]): { values: (string | null)[]; changed: number[]; ok: boolean } {
  const known = pcts.map((p, i) => ({ p, i })).filter((x) => x.p != null) as { p: string; i: number }[];
  if (!known.length) return { values: pcts, changed: [], ok: false };
  const sum = (vals: string[]) => vals.reduce((s, v) => s + Number(v), 0);
  const inRange = (s: number) => s >= 98 && s <= 100.5;
  if (inRange(sum(known.map((k) => k.p)))) return { values: pcts, changed: [], ok: known.length === pcts.length };
  // Kombinationen mit möglichst wenigen Tauschungen suchen (begrenzt, damit es schnell bleibt)
  const options = known.map((k) => zeroEightVariants(k.p));
  let best: { pick: string[]; swaps: number } | null = null;
  let count = 0;
  const walk = (i: number, pick: string[], swaps: number) => {
    if (count++ > 5000) return;
    if (best && swaps >= best.swaps) return;
    if (i === options.length) {
      if (inRange(sum(pick))) best = { pick: [...pick], swaps };
      return;
    }
    options[i].forEach((v, n) => walk(i + 1, [...pick, v], swaps + (n === 0 ? 0 : 1)));
  };
  walk(0, [], 0);
  if (!best) return { values: pcts, changed: [], ok: false };
  const values = [...pcts];
  const changed: number[] = [];
  known.forEach((k, n) => {
    if (best!.pick[n] !== k.p) changed.push(k.i);
    values[k.i] = best!.pick[n];
  });
  return { values, changed, ok: true };
}

/** Masse und SCU passen zueinander, wenn die mittlere Dichte zwischen etwa 1 (Inert) und 21 (Quantainium) liegt. */
export function massScuPlausible(mass: string | null, scu: string | null): boolean | null {
  if (!mass || !scu) return null;
  const density = Number(mass) / (MILLI(scu) * 142.857);
  return density >= 0.95 && density <= 21.5;
}

export { MILLI as scuValue };
