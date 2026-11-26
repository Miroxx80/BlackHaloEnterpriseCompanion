/**
 * Radar-Signaturen live vom Bildschirm lesen. Nach einem Ping steht an gescannten Kontakten ein Schild mit Pin und
 * Zahl ("16,960"), etwa ein Drittel der Bildhöhe von oben nahe der Mitte. Gesucht wird nur in einem Band um das
 * Fadenkreuz (sonst greift man Cockpit-Anzeigen ab), mit Text-Detektion statt Farbe: Schild und Pin haben die
 * HUD-Farbe des Schiffs (orange, grün, ...). Nur anzeigen, nie steuern.
 *
 * Bestätigung über mehrere Bilder (Marker blitzen manchmal nur kurz auf, Lesefehler sind zufällig):
 * ein Wert gilt erst, wenn er zweimal gelesen wurde, oder einmal sehr sicher mit Komma und als bekannte Signatur.
 */
import type { LineReader, TextDetector } from './engine.js';
import { cropPadded, type Rgb } from './image.js';
import type { Box } from './layout.js';

/** Suchband bei 1920x1080: +-324 px um die Bildmitte, y 230..582 (Marker liegen bei ~0,3–0,4 der Höhe). */
export const SIGNATURE_BAND: Box = [636, 230, 648, 352];

export interface SignatureReading {
  value: number;
  /** Wie gelesen, z. B. "16,960". */
  text: string;
  confidence: number;
  /** Mit Tausendertrenner gelesen (sicherer: unterscheidet von anderen HUD-Zahlen). */
  separator: boolean;
  /** Eine 0/6/8/9 war zweifelhaft. */
  ambiguous: boolean;
  /** Mitte des Kastens im Bild (1920x1080). */
  x: number;
  y: number;
}

const SIGNATURE_TEXT = /^(\d{1,3})[,.](\d{3})$/;
const PLAIN_DIGITS = /^\d{4,6}$/;
export const MIN_VALUE = 1500;
export const MAX_VALUE = 300_000;

/** "16,960" / "16.960" / "16960" -> Zahl, sonst null (Buchstaben = anderer Text, z. B. "UNKNOWN", "11.4KM"). */
export function parseSignatureText(raw: string): { value: number; separator: boolean } | null {
  const t = raw.replace(/\s+/g, '');
  const m = SIGNATURE_TEXT.exec(t);
  const value = m ? Number(m[1] + m[2]) : PLAIN_DIGITS.test(t) ? Number(t) : NaN;
  if (!Number.isFinite(value) || value < MIN_VALUE || value > MAX_VALUE) return null;
  return { value, separator: Boolean(m) };
}

/**
 * Signaturen im Band lesen. img ist das ganze Bild (1920x1080) oder nur das Band, dann mit offset = Lage des Bands.
 * isKnown: ist der Wert eine bekannte Signatur? Dient nur dazu, einen als Ziffer gelesenen Pin vorn abzuschneiden.
 */
export async function readSignatures(
  img: Rgb,
  reader: LineReader,
  detector: TextDetector,
  isKnown: (value: number) => boolean,
  band: Box = [0, 0, img.width, img.height],
  offset: [number, number] = [0, 0],
): Promise<SignatureReading[]> {
  const boxes = await detector.detect(img, band);
  const out: SignatureReading[] = [];
  for (const b of boxes) {
    // Zahlen-Schild: niedrig und kurz (bei 1080p ~10 px Ziffern, 4–6 Ziffern plus Komma)
    if (b[3] < 7 || b[3] > 30 || b[2] < 14 || b[2] > 140) continue;
    const r = await reader.read(cropPadded(img, b, 3), 'signature');
    if (!r?.text) continue;
    let parsed = parseSignatureText(r.text);
    // Der Pin links wird manchmal als führende Ziffer gelesen ("27,200"): ohne erste Ziffer eine bekannte Signatur?
    const t = r.text.replace(/\s+/g, '');
    if (parsed && !isKnown(parsed.value) && /^\d/.test(t)) {
      const shorter = parseSignatureText(t.slice(1));
      if (shorter && isKnown(shorter.value)) parsed = shorter;
    }
    if (!parsed) continue;
    out.push({
      value: parsed.value,
      text: r.text,
      confidence: r.confidence,
      separator: parsed.separator,
      ambiguous: Boolean(r.ambiguous),
      x: offset[0] + b[0] + b[2] / 2,
      y: offset[1] + b[1] + b[3] / 2,
    });
  }
  return out;
}

export interface LiveContact {
  value: number;
  firstSeen: number;
  lastSeen: number;
  /** Wie oft gelesen (im Bestätigungsfenster und danach). */
  hits: number;
  x: number;
  y: number;
}

export interface TrackerOptions {
  /** Lesungen so lange zur Bestätigung heranziehen. */
  windowMs: number;
  /** Bestätigte Kontakte so lange zeigen, nachdem sie zuletzt gelesen wurden. */
  holdMs: number;
  /** Eine einzelne Lesung genügt ab dieser Sicherheit (nur mit Komma, bekannte Signatur, ohne 0/6/8/9-Zweifel). */
  singleConfidence: number;
  /** Gleicher Wert an gleicher Stelle so viele Bilder lang: feste Cockpit-Anzeige, ignorieren. */
  stuckFrames: number;
}

export const DEFAULT_TRACKER: TrackerOptions = { windowMs: 20_000, holdMs: 45_000, singleConfidence: 0.97, stuckFrames: 120 };

/** Sammelt Lesungen über mehrere Bilder und liefert bestätigte Kontakte. */
export class SignatureTracker {
  private readings: { value: number; t: number; x: number; y: number }[] = [];
  private confirmed = new Map<number, LiveContact>();
  private stuck = new Map<string, number>();
  private ignored = new Set<string>();

  constructor(
    private readonly isKnown: (value: number) => boolean,
    private readonly opts: TrackerOptions = DEFAULT_TRACKER,
  ) {}

  /** Lesungen eines Bilds hinzufügen. Gibt true zurück, wenn sich die Liste der Kontakte geändert hat. */
  add(list: SignatureReading[], now: number): boolean {
    let changed = this.expire(now);
    const seenKeys = new Set<string>();
    for (const r of list) {
      // Feste Anzeigen erkennen: gleicher Wert an (fast) gleicher Stelle über sehr viele Bilder
      const key = `${r.value}@${Math.round(r.x / 6)}:${Math.round(r.y / 6)}`;
      seenKeys.add(key);
      if (this.ignored.has(key)) continue;
      const n = (this.stuck.get(key) ?? 0) + 1;
      this.stuck.set(key, n);
      if (n >= this.opts.stuckFrames) {
        this.ignored.add(key);
        if (this.confirmed.delete(r.value)) changed = true;
        continue;
      }
      this.readings.push({ value: r.value, t: now, x: r.x, y: r.y });
      const existing = this.confirmed.get(r.value);
      if (existing) {
        existing.lastSeen = now;
        existing.hits++;
        existing.x = r.x;
        existing.y = r.y;
        changed = true;
        continue;
      }
      const count = this.readings.filter((x) => x.value === r.value).length;
      const solo = r.separator && !r.ambiguous && r.confidence >= this.opts.singleConfidence && this.isKnown(r.value);
      if (count >= 2 || solo) {
        this.confirmed.set(r.value, { value: r.value, firstSeen: now, lastSeen: now, hits: count, x: r.x, y: r.y });
        changed = true;
      }
    }
    // Zähler für feste Anzeigen nur fortlaufend: nicht gesehen -> zurücksetzen
    for (const key of [...this.stuck.keys()]) if (!seenKeys.has(key)) this.stuck.delete(key);
    return changed;
  }

  private expire(now: number): boolean {
    this.readings = this.readings.filter((r) => now - r.t <= this.opts.windowMs);
    let changed = false;
    for (const [v, c] of this.confirmed) {
      if (now - c.lastSeen > this.opts.holdMs) {
        this.confirmed.delete(v);
        changed = true;
      }
    }
    return changed;
  }

  /** Bestätigte Kontakte, zuletzt gesehene zuerst. */
  contacts(now: number): LiveContact[] {
    this.expire(now);
    return [...this.confirmed.values()].sort((a, b) => b.lastSeen - a.lastSeen);
  }

  clear() {
    this.readings = [];
    this.confirmed.clear();
    this.stuck.clear();
  }
}
