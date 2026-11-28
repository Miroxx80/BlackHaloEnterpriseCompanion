/**
 * Lexikon-Lesung der Radar-Signaturen: Statt Zeichen für Zeichen zu raten (gierig), wird jede bekannte Signatur
 * gegen die Ausgabe der Erkennung bewertet (CTC-Vorwärts, Wahrscheinlichkeit des ganzen Worts). Schreibweisen
 * "11,565", "11.565" und "11565" zählen gleich (der Trenner wird oft als Punkt oder gar nicht erkannt).
 *
 * Warum: Bei ~9 px hohen Ziffern mit Farbsäumen liest die gierige Dekodierung oft eine "1" zu wenig ("1.520" statt
 * "11,520"), 5 als 6 oder 9 als 0. Die Wahrscheinlichkeit des richtigen Worts ist trotzdem meist klar die höchste.
 * Abgesichert über zwei Abstände: zum zweitbesten Wert (margin) und zum besten freien Pfad (gap, wie viel
 * unwahrscheinlicher das Lexikon-Wort ist als das, was das Modell ohne Lexikon sieht).
 */
import type { CharLogProbs } from './engine.js';

/** Zeichen, über die renormalisiert wird (alles andere zählt als "other"). */
export const LEXICON_CHARS = '0123456789,.';

export interface LexiconEntry {
  value: number;
  /** Schreibweisen als Spalten-Indizes in CharLogProbs.lp (1..n, 0 = blank). */
  labels: number[][];
}

export interface LexiconResult {
  value: number;
  /** log P des besten Werts (beste Schreibweise). */
  score: number;
  second: number | null;
  /** score minus Score des zweitbesten Werts (natürlicher Logarithmus). */
  margin: number;
  /** log P des besten freien Pfads minus score (klein = das Lexikon-Wort ist fast das, was das Modell sieht). */
  gap: number;
  /**
   * score minus Score der wahrscheinlichsten möglichen Signatur (Vielfaches von 5, auch unbekannt), die sich vom
   * besten Wert in genau einer Ziffer unterscheidet (ersetzt, eingefügt, weggelassen), oder des gierig gelesenen Texts.
   * Klein oder negativ = das Bild zeigt vermutlich eine andere Zahl als die bekannte (z. B. "16,620" statt 10,620).
   */
  open: number;
  /** Die stärkste dieser Ziffernfolgen. */
  rival: string;
  /** Gierig gelesener Text (nur Ziffern, Komma, Punkt), zur Fehlersuche. */
  free: string;
  other: number;
}

/** "11,565", "11.565", "11565" (Werte unter 1000 nur als Ziffern). */
export function signatureFormats(v: number): string[] {
  return digitFormats(String(v));
}

/** Ziffernfolge in allen Schreibweisen (ab 4 Ziffern mit Komma, Punkt oder ohne Trenner). */
function digitFormats(d: string): string[] {
  if (d.length < 4) return [d];
  const sep = `${d.slice(0, -3)},${d.slice(-3)}`;
  return [sep, sep.replace(',', '.'), d];
}

/** Alle Ziffernfolgen mit genau einer Ziffer Unterschied (ersetzt, eingefügt, weggelassen). */
export function digitNeighbours(d: string): string[] {
  const out = new Set<string>();
  for (let i = 0; i <= d.length; i++) {
    for (const c of '0123456789') {
      out.add(d.slice(0, i) + c + d.slice(i));
      if (i < d.length) out.add(d.slice(0, i) + c + d.slice(i + 1));
    }
    if (i < d.length) out.add(d.slice(0, i) + d.slice(i + 1));
  }
  out.delete(d);
  out.delete('');
  return [...out];
}

/**
 * Könnte diese Ziffernfolge auf einem Schild stehen? Signaturen sind Vielfache von 5 (Erze, Boden, Wracks) und nicht
 * kleiner als die kleinste bekannte (1700, Wrackteil; zwei Kontakte auf einer Zahl ergeben mehr).
 */
export const plausibleDigits = (d: string, min: number) => /^[1-9]\d{3,5}$/.test(d) && Number(d) % 5 === 0 && Number(d) >= min && Number(d) <= 300_000;

const toCols = (f: string) => [...f].map((c) => LEXICON_CHARS.indexOf(c) + 1);

export function buildLexicon(values: number[]): LexiconEntry[] {
  return values.map((value) => ({ value, labels: signatureFormats(value).map(toCols) }));
}

const lse = (a: number, b: number) => (a === -Infinity ? b : b === -Infinity ? a : Math.max(a, b) + Math.log1p(Math.exp(-Math.abs(a - b))));

/** CTC-Vorwärts: log P(label | Ausgabe). */
export function ctcLogLik(p: CharLogProbs, label: number[]): number {
  const k = p.chars.length + 1;
  const T = p.steps;
  const ext = [0];
  for (const c of label) ext.push(c, 0);
  const S = ext.length;
  if (T === 0 || label.length > T) return -Infinity;
  let a = new Float64Array(S).fill(-Infinity);
  let b = new Float64Array(S);
  a[0] = p.lp[ext[0]];
  if (S > 1) a[1] = p.lp[ext[1]];
  for (let t = 1; t < T; t++) {
    const row = t * k;
    for (let s = 0; s < S; s++) {
      let v = a[s];
      if (s > 0) v = lse(v, a[s - 1]);
      if (s > 1 && ext[s] !== 0 && ext[s] !== ext[s - 2]) v = lse(v, a[s - 2]);
      b[s] = v + p.lp[row + ext[s]];
    }
    [a, b] = [b, a];
  }
  return S > 1 ? lse(a[S - 1], a[S - 2]) : a[S - 1];
}

/**
 * Hat die Erkennung (gierig gelesener Text) jede Ziffer des Werts selbst gesehen? Ja, wenn die gelesenen Ziffern in
 * derselben Reihenfolge im Wert vorkommen (keine fremde Ziffer: "0,390" passt nicht zu 8390, "11,506" nicht zu 11565)
 * und höchstens schmale 1en fehlen ("1.520" passt zu 11520, "1360" nicht zu 15360: die 5 hat sie nicht gesehen). Die
 * letzte Ziffer ist auf einem Schild immer 0 oder 5: eine gelesene 6 zählt als 5, eine 8/9 als 0 (die bekannten
 * Verwechslungen), andere fallen weg.
 */
export function freeCovers(free: string, value: number): boolean {
  let g = free.replace(/[,.]/g, '');
  const last = g[g.length - 1];
  if (last === '6') g = `${g.slice(0, -1)}5`;
  else if (last === '8' || last === '9') g = `${g.slice(0, -1)}0`;
  else if (g && last !== '0' && last !== '5') g = g.slice(0, -1);
  const v = String(value);
  // Gierig von links zuordnen (Teilfolge); übersprungene Ziffern des Werts dürfen nur 1en sein
  let j = 0;
  for (const c of g) {
    while (j < v.length && v[j] !== c) {
      if (v[j] !== '1') return false;
      j++;
    }
    if (j === v.length) return false;
    j++;
  }
  for (; j < v.length; j++) if (v[j] !== '1') return false;
  return true;
}

/** Unterscheiden sich zwei Werte nur um eine eingefügte/fehlende 1 (17200/7200, 11520/1520)? */
export function differByOne1(a: number, b: number): boolean {
  const [s, l] = [String(a), String(b)].sort((x, y) => x.length - y.length);
  if (l.length !== s.length + 1) return false;
  for (let i = 0; i < l.length; i++) if (l[i] === '1' && l.slice(0, i) + l.slice(i + 1) === s) return true;
  return false;
}

/** Gierig: bester Pfad (Score) und Text. */
function greedy(p: CharLogProbs) {
  const k = p.chars.length + 1;
  let score = 0;
  let text = '';
  let prev = 0;
  for (let t = 0; t < p.steps; t++) {
    let bi = 0;
    for (let j = 1; j < k; j++) if (p.lp[t * k + j] > p.lp[t * k + bi]) bi = j;
    score += p.lp[t * k + bi];
    if (bi !== 0 && bi !== prev) text += p.chars[bi - 1];
    prev = bi;
  }
  return { score, text };
}

/** Besten und zweitbesten Wert des Lexikons bestimmen, dazu die Gegenproben. null, wenn das Lexikon leer ist. */
export function readLexicon(p: CharLogProbs, lexicon: LexiconEntry[]): LexiconResult | null {
  const score = (labels: number[][]) => {
    let s = -Infinity;
    for (const l of labels) s = Math.max(s, ctcLogLik(p, l));
    return s;
  };
  const g = greedy(p);
  let best: { value: number; s: number } | null = null;
  let second: { value: number; s: number } | null = null;
  for (const e of lexicon) {
    const s = score(e.labels);
    if (!best || s > best.s) {
      second = best;
      best = { value: e.value, s };
    } else if (!second || s > second.s) second = { value: e.value, s };
  }
  if (!best || best.s === -Infinity) return null;
  // Offene Gegenprobe: Ziffernfolgen mit einer Ziffer Unterschied und der gierig gelesene Text, soweit sie auf
  // einem Schild stehen könnten (Vielfache von 5, nicht kleiner als die kleinste bekannte Signatur, ohne führende
  // Null; auch unbekannte Werte, z. B. zwei Kontakte auf einer Zahl). "19276" gegen "19275" ist nur die
  // 5/6-Unsicherheit des Modells, "1,520" gegen "11,520" kann so nicht auf einem Schild stehen.
  const digits = String(best.value);
  const rivals = new Set(digitNeighbours(digits));
  const freeDigits = g.text.replace(/[,.]/g, '');
  if (freeDigits && freeDigits !== digits) rivals.add(freeDigits);
  const min = lexicon.reduce((m, e) => Math.min(m, e.value), Infinity);
  for (const d of rivals) if (!plausibleDigits(d, min)) rivals.delete(d);
  let rival = '';
  let rivalScore = -Infinity;
  for (const d of rivals) {
    const s = score(digitFormats(d).map(toCols));
    if (s > rivalScore) {
      rivalScore = s;
      rival = d;
    }
  }
  return {
    value: best.value,
    score: best.s,
    second: second?.value ?? null,
    margin: second ? best.s - second.s : Infinity,
    gap: g.score - best.s,
    open: best.s - rivalScore,
    rival,
    free: g.text,
    other: p.other,
  };
}
