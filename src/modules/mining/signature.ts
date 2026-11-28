/**
 * Radar-Signatur -> was liegt da? Auf dem Radar steht für jeden Kontakt die Basis-Signatur des Vorkommens mal
 * die Anzahl (Steine im Cluster, Teile eines Bodenfelds). Daten: Spieldaten 4.10.3 (scripts/mining-data.mjs).
 *
 * Reihenfolge:
 *  1. Genaue Treffer: Schiffs-Erz x Anzahl (bis zur größten Clustergröße der Seltenheit), Bodenfamilien
 *     (ROC 4000, Hand 3000, Bergung/Pflanzen 2000) x Anzahl, einzelne Wracks.
 *  2. Nur wenn nichts genau passt: Summe aus zwei Kontakten (zwei Erz-Cluster oder Erz + Bodenfeld), so im Spiel
 *     beobachtet (z. B. 76.975 = Zinn x5 + ROC x14).
 *  3. Sonst: naheliegende Werte (Tipp- oder Lesefehler).
 * Gewichte sind grobe Wahrscheinlichkeiten aus den Spawn-Daten, keine Gewissheit.
 */
import type { Dataset, Ore, Rarity, SignatureLocation } from './types.js';

export interface SignaturePart {
  /** Erz-ID (z. B. "Ore_Copper"), Familie ("roc", "fps", "small") oder "debris". */
  id: string;
  name: string;
  count: number;
  base: number;
}

export interface SignatureCandidate {
  kind: 'ore' | 'ground' | 'debris' | 'sum' | 'near';
  label: string;
  parts: SignaturePart[];
  /** Relative Wahrscheinlichkeit unter den Kandidaten (Summe 1). */
  weight: number;
  /** Seltenheit (nur Erz). */
  rarity?: Rarity;
  notes: string[];
  /** Kommt laut Spawn-Daten am gewählten Ort nicht vor. */
  outOfPlace?: boolean;
}

export interface SignatureResult {
  value: number;
  /** true: mindestens ein genauer Treffer (Einzelkontakt). */
  exact: boolean;
  candidates: SignatureCandidate[];
  location?: { id: string; name: string };
  notes: string[];
}

export const MAX_SIGNATURE = 300_000;
const NEAR_TOLERANCE = (v: number) => Math.max(30, v * 0.006);
const MAX_SUMS = 6;
/** Bodenfelder in Summen erst ab dieser Größe (kleinere Felder sind selten, sonst gäbe es zu viele Deutungen). */
const MIN_FIELD_IN_SUM = 6;
const RARITY_DE: Record<Rarity, string> = {
  legendary: 'legendär',
  epic: 'episch',
  rare: 'selten',
  uncommon: 'ungewöhnlich',
  common: 'häufig',
};

/** "6,370", "6.370", "6 370", "6370" -> 6370; sonst null. */
export function parseSignature(text: unknown): number | null {
  if (typeof text !== 'string' && typeof text !== 'number') return null;
  const t = String(text).trim().replace(/[\s'’]/g, '');
  if (!/^\d{1,3}([.,]\d{3})*$|^\d+$/.test(t)) return null;
  const v = Number(t.replace(/[.,]/g, ''));
  return Number.isInteger(v) && v > 0 && v <= MAX_SIGNATURE ? v : null;
}

/** Wahrscheinlichkeit, dass ein Vorkommen dieser Seltenheit als n Steine erscheint (0, wenn unmöglich). */
function clusterWeight(data: Dataset, rarity: Rarity, n: number): { p: number; unusual: boolean } {
  const c = data.signatures.clusters[rarity];
  const max = Math.max(...c.sizes.map((s) => s.size));
  if (n < 1 || n > max) return { p: 0, unusual: false };
  if (n === 1) {
    // Seltenheiten mit probability 1 spawnen laut Daten immer als Cluster; einzeln trotzdem nicht ausschließen
    return c.probability < 1 ? { p: 1 - c.probability, unusual: false } : { p: 0.02, unusual: true };
  }
  const size = c.sizes.find((s) => s.size === n);
  return size ? { p: c.probability * size.p, unusual: false } : { p: 0.02, unusual: true };
}

interface Term {
  kind: 'ore' | 'ground' | 'debris';
  part: SignaturePart;
  value: number;
  weight: number;
  rarity?: Rarity;
  notes: string[];
  outOfPlace: boolean;
}

/** Alle einzelnen Deutungen (Erz x n, Familie x n, Wrack) bis zu einem Höchstwert. */
function terms(data: Dataset, location: SignatureLocation | undefined, upTo: number): Term[] {
  const out: Term[] = [];
  const shipOres = data.ores.filter((o): o is Ore & { signature: number; rarity: Rarity } => !!o.signature && !!o.rarity);
  for (const ore of shipOres) {
    const share = location?.ores.find((x) => x.ore === ore.id)?.p ?? 0;
    const outOfPlace = !!location && share === 0;
    for (let n = 1; n * ore.signature <= upTo; n++) {
      const cw = clusterWeight(data, ore.rarity, n);
      if (!cw.p) break;
      const notes: string[] = [];
      if (cw.unusual) notes.push(n === 1 ? 'einzelner Stein (laut Spieldaten selten)' : `${n} Steine (laut Spieldaten selten)`);
      if (outOfPlace) notes.push(`kommt laut Spieldaten nicht bei ${location!.name} vor`);
      else if (location) notes.push(`${Math.round(share * 1000) / 10} % der Vorkommen hier`);
      out.push({
        kind: 'ore',
        part: { id: ore.id, name: ore.name, count: n, base: ore.signature },
        value: n * ore.signature,
        weight: cw.p * (location ? (outOfPlace ? 0.01 : 0.2 + share) : 1),
        rarity: ore.rarity,
        notes,
        outOfPlace,
      });
    }
  }
  for (const fam of data.signatures.families) {
    // Boden (ROC/Hand) nur auf Planeten und Monden; 2000 = Wrackteile (All) oder Pflanzen (Boden)
    const ground = fam.id === 'roc' || fam.id === 'fps';
    const outOfPlace = !!location && ground && (!location.surface || !location.ground.includes(fam.id));
    const minerals = fam.minerals.length ? `Mineral je nach Ort: ${fam.minerals.join(', ')}` : '';
    // 2000 im All: Pflanzen wachsen nur auf Planeten und Monden, dort ist es Bergung
    const name = fam.id === 'small' && location && !location.surface ? 'Bergung (Wrackteile)' : fam.label;
    for (let n = 1; n * fam.base <= upTo; n++) {
      const notes: string[] = [];
      if (minerals) notes.push(minerals);
      if (n > fam.maxCount) notes.push(`${n} Teile: größer als ein Feld laut Spieldaten (mehrere Felder?)`);
      if (outOfPlace) notes.push(location!.surface ? `laut Spieldaten nicht bei ${location!.name}` : 'nur auf Planeten und Monden');
      out.push({
        kind: 'ground',
        part: { id: fam.id, name, count: n, base: fam.base },
        value: n * fam.base,
        weight: (outOfPlace ? 0.01 : location ? 0.6 : 0.4) * (n > fam.maxCount ? 0.1 : 1),
        notes,
        outOfPlace,
      });
    }
  }
  for (const d of data.signatures.debris) {
    if (d.base > upTo) continue;
    out.push({
      kind: 'debris',
      part: { id: 'debris', name: d.label, count: 1, base: d.base },
      value: d.base,
      weight: 0.15,
      notes: ['einzelnes Wrack (Bergung)'],
      outOfPlace: false,
    });
  }
  return out;
}

const label = (parts: SignaturePart[]) => parts.map((p) => (p.count > 1 ? `${p.name} ×${p.count}` : p.name)).join(' + ');

function normalize(list: SignatureCandidate[]): SignatureCandidate[] {
  const total = list.reduce((s, c) => s + c.weight, 0) || 1;
  return list
    .map((c) => ({ ...c, weight: +(c.weight / total).toFixed(4) }))
    .sort((a, b) => Number(!!a.outOfPlace) - Number(!!b.outOfPlace) || b.weight - a.weight);
}

export function matchSignature(value: number, data: Dataset, options: { location?: string } = {}): SignatureResult {
  const location = options.location ? data.signatures.locations.find((l) => l.id === options.location) : undefined;
  const result: SignatureResult = {
    value,
    exact: false,
    candidates: [],
    notes: [],
    ...(location ? { location: { id: location.id, name: location.name } } : {}),
  };
  if (options.location && !location) result.notes.push('Unbekannter Ort, ohne Ort gesucht.');
  const all = terms(data, location, value);
  const toCandidate = (t: Term): SignatureCandidate => ({
    kind: t.kind,
    label: label([t.part]),
    parts: [t.part],
    weight: t.weight,
    ...(t.rarity ? { rarity: t.rarity } : {}),
    notes: t.rarity ? [`${RARITY_DE[t.rarity]}`, ...t.notes] : t.notes,
    ...(t.outOfPlace ? { outOfPlace: true } : {}),
  });

  // 1. Genaue Treffer
  const exact = all.filter((t) => t.value === value);
  if (exact.length) {
    result.exact = true;
    result.candidates = normalize(exact.map(toCandidate));
    if (exact.length > 1) result.notes.push('Mehrdeutig: Diese Signatur passt zu mehreren Vorkommen.');
    return result;
  }

  // 2. Summe aus zwei Kontakten (zwei verschiedene Erze, oder ein Erz + ein Bodenfeld ab MIN_FIELD_IN_SUM)
  const byValue = new Map<number, Term[]>();
  for (const t of all) byValue.set(t.value, [...(byValue.get(t.value) ?? []), t]);
  const sums: SignatureCandidate[] = [];
  for (const a of all) {
    if (a.kind !== 'ore') continue;
    for (const b of byValue.get(value - a.value) ?? []) {
      if (b.kind === 'debris') continue;
      if (b.kind === 'ore' && b.part.id <= a.part.id) continue; // jedes Paar nur einmal, verschiedene Erze
      if (b.kind === 'ground' && b.part.count < MIN_FIELD_IN_SUM) continue;
      sums.push({
        kind: 'sum',
        label: label([a.part, b.part]),
        parts: [a.part, b.part],
        weight: a.weight * b.weight * 0.3,
        notes: ['zwei Kontakte auf einem Wert (Mischsignatur)', ...a.notes, ...b.notes].filter((n) => !/^\d+([.,]\d+)? % der/.test(n)),
        ...(a.outOfPlace || b.outOfPlace ? { outOfPlace: true } : {}),
      });
    }
  }
  if (sums.length) {
    result.candidates = normalize(sums).slice(0, MAX_SUMS);
    result.notes.push('Kein einzelnes Vorkommen hat genau diese Signatur. Mögliche Kombinationen aus zwei Kontakten:');
    if (sums.length > MAX_SUMS) result.notes.push(`${sums.length - MAX_SUMS} weitere Kombinationen nicht angezeigt.`);
    return result;
  }

  // 3. Naheliegend (Tippfehler / Lesefehler)
  const tol = NEAR_TOLERANCE(value);
  const near = terms(data, location, value + tol).filter((t) => Math.abs(t.value - value) <= tol);
  result.candidates = normalize(
    near.map((t) => ({
      ...toCandidate(t),
      kind: 'near' as const,
      // Je näher am eingegebenen Wert, desto wahrscheinlicher
      weight: t.weight * (0.05 + (1 - Math.abs(t.value - value) / tol) ** 2),
      notes: [`Signatur ${t.value.toLocaleString('de-DE')}`, ...toCandidate(t).notes],
    })),
  );
  result.notes.push(near.length ? 'Kein genauer Treffer. Ähnliche Werte (Tippfehler?):' : 'Keine bekannte Signatur in der Nähe.');
  return result;
}

/** Kurzfassung für Live-Liste und Overlay. */
export interface SignatureSummary {
  exact: boolean;
  /** Höchstens 3 Deutungen; mit Ort nur die, die dort vorkommen können (falls es solche gibt). */
  candidates: { label: string; weight: number; kind: SignatureCandidate['kind'] }[];
  /** Mit Ort: Keine Deutung passt laut Spieldaten zum Ort (gezeigt werden dann die besten ohne Ort). */
  outOfPlace?: boolean;
}

/**
 * Deutung für die Live-Liste und das Overlay. Mit Ort fallen Deutungen weg, die dort laut Spieldaten nicht vorkommen
 * (z. B. ROC-Vorkommen im Aaron Halo); Anteile werden unter den übrigen neu verteilt.
 */
export function summarizeSignature(value: number, data: Dataset, location?: string): SignatureSummary {
  const m = matchSignature(value, data, { location });
  const inPlace = m.candidates.filter((c) => !c.outOfPlace);
  const list = inPlace.length ? inPlace : m.candidates;
  const total = list.reduce((s, c) => s + c.weight, 0) || 1;
  return {
    exact: m.exact,
    candidates: list.slice(0, 3).map((c) => ({ label: c.label, weight: +(c.weight / total).toFixed(4), kind: c.kind })),
    ...(m.location && !inPlace.length && m.candidates.length ? { outOfPlace: true } : {}),
  };
}

/** Übersicht für die Oberfläche: alle Schiffs-Erze mit ihren möglichen Werten. */
export function signatureTable(data: Dataset) {
  return data.ores
    .filter((o) => o.signature && o.rarity)
    .map((o) => {
      const c = data.signatures.clusters[o.rarity!];
      const max = Math.max(...c.sizes.map((s) => s.size));
      return { id: o.id, name: o.name, rarity: o.rarity!, base: o.signature!, values: Array.from({ length: max }, (_, i) => o.signature! * (i + 1)) };
    })
    .sort((a, b) => a.base - b.base);
}
