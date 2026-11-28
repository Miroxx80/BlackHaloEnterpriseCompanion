/**
 * Radar-Signaturen live vom Bildschirm lesen. Nach einem Ping steht an gescannten Kontakten ein Schild mit Pin und
 * Zahl ("16,960"), etwa ein Drittel der Bildhöhe von oben nahe der Mitte. Gesucht wird nur in einem Band um das
 * Fadenkreuz (sonst greift man Cockpit-Anzeigen ab), mit Text-Detektion; gelesen werden nur Kästen mit dem Pin
 * links davon (pin.ts, jeder Farbton, solange gesättigt), und nur bekannte Signaturen (lexicon.ts). Zweiter Leser:
 * die eigene Lesung der Schild-Schrift (tagfont.ts); gelesen ist ein Wert nur, wenn beide ihn lesen. Nur anzeigen,
 * nie steuern.
 *
 * Bestätigung über mehrere Bilder (Marker blitzen manchmal nur kurz auf): ein Wert gilt erst, wenn er in zwei Bildern
 * gelesen wurde, oder in einem, wenn die Lexikon-Lesung sicher ist und die Schild-Schrift denselben Wert liest. Zwei
 * Lesungen schützen nur gegen zufällige Fehler; ein Fehler, den die Erkennung in jedem Bild gleich macht (verdeckte
 * führende 1, 5 als 6), wird dadurch nicht besser. Dagegen hilft nur die zweite Meinung, siehe readSignatures.
 */
import { fileURLToPath } from 'node:url';
import type { LineReader, TextDetector } from './engine.js';
import { cropPadded, type Rgb } from './image.js';
import type { Box } from './layout.js';
import { buildLexicon, differByOne1, freeCovers, LEXICON_CHARS, type LexiconEntry, readLexicon, signatureFormats } from './lexicon.js';
import { findPin, type PinMatch } from './pin.js';
import { loadTagFont, readTag, type TagFontModel } from './tagfont.js';

/** Suchband bei 1920x1080: +-324 px um die Bildmitte, y 230..582 (Marker liegen bei ~0,3–0,4 der Höhe). */
export const SIGNATURE_BAND: Box = [636, 230, 648, 352];

export interface SignatureReading {
  value: number;
  /** Der Wert als "16,960". */
  text: string;
  /** Lexikon-Lesung: exp(-gap), 1 = das Lexikon-Wort ist genau das, was das Modell auch ohne Lexikon sieht. */
  confidence: number;
  /** Mit Tausendertrenner gelesen (sicherer: unterscheidet von anderen HUD-Zahlen). */
  separator: boolean;
  /** Eine 0/6/8/9 war zweifelhaft. */
  ambiguous: boolean;
  /** Lexikon-Lesung: Abstände zum zweitbesten bekannten Wert, zum freien Pfad, zu Zahlen mit einer Ziffer Unterschied. */
  margin?: number;
  gap?: number;
  open?: number;
  /** Eine Lesung genügt: Lexikon sicher und die Schild-Schrift liest denselben Wert (source 'both'). */
  sure?: boolean;
  /**
   * Wer las: 'both' (Lexikon-Schwellen erfüllt und die Schild-Schrift liest denselben Wert), 'tag' (Lexikon allein
   * zu knapp, aber sein bester Wert ist genau der, den die Schild-Schrift liest). 'lexicon' (Lexikon allein) liefert
   * readSignatures nicht mehr; der Tracker behandelt es wie 'tag' (2 Bilder).
   */
  source?: 'lexicon' | 'both' | 'tag';
  /** Mitte des Kastens im Bild (1920x1080). */
  x: number;
  y: number;
}

export const MIN_VALUE = 1500;
export const MAX_VALUE = 300_000;

/** Fehlersuche: jeder gefundene Textkasten, was gelesen wurde und warum er verworfen wurde (leer = übernommen). */
export interface SignatureTrace {
  box: Box;
  /** Gierig gelesener Text (nur Ziffern, Komma, Punkt). */
  text?: string;
  /** Sicherheit der Lexikon-Lesung: exp(-gap), 1 = das Lexikon-Wort ist genau das, was das Modell sieht. */
  confidence?: number;
  /** Pin des Schilds (Bildkoordinaten) und der gelesene Bereich rechts davon. */
  pin?: Box;
  region?: Box;
  /** Lexikon-Lesung: bester und zweitbester Wert, Abstände (siehe lexicon.ts). */
  best?: number;
  second?: number | null;
  margin?: number;
  gap?: number;
  open?: number;
  rival?: string;
  other?: number;
  /**
   * Schild-Schrift (tagfont.ts): gelesener Wert, null = Schild gefunden, aber kein eindeutiger Wert, 'disagree' = zwei
   * Kästen am selben Pin lesen verschiedene Werte. Fehlt, wenn sie kein Schild gefunden hat.
   */
  tag?: number | null | 'disagree';
  /** Schild-Schrift: schwächste Ziffer des Lexikon-Werts am Schild (> 0: jede Ziffer ist dort die beste), null = passt nicht auf die Zeile. */
  tagFit?: number | null;
  /**
   * tag-conflict: Schild-Schrift liest einen anderen Wert als das Lexikon (oder zwei Kästen verschiedene).
   * no-tag: Lexikon-Schwellen erfüllt, aber die Schild-Schrift liest keinen Wert (Schild nicht gefunden oder nicht
   * eindeutig); das Lexikon allein reicht nicht (siehe readSignatures).
   */
  dropped?: 'size' | 'no-pin' | 'same-pin' | 'empty' | 'no-match' | 'not-sure' | 'tag-conflict' | 'no-tag';
}

/** Schwellen der Lexikon-Lesung (Abstände in natürlichem Logarithmus, siehe lexicon.ts). */
export interface LexiconOptions {
  /** Höchstens so viel unwahrscheinlicher als der beste freie Pfad. */
  maxGap: number;
  /** Mindestens so viel wahrscheinlicher als der zweitbeste bekannte Wert. */
  minMargin: number;
  /** Mindestens so viel wahrscheinlicher als jede Zahl mit einer Ziffer Unterschied (auch unbekannte). */
  minOpen: number;
  /** Höchstens dieser mittlere Anteil anderer Zeichen (Buchstaben: "UNKNOWN", "km"). */
  maxOther: number;
}

/**
 * Gemessen (2026-11-28) an 35 Schildern (32 Bilder Aaron Halo + 3 Testbilder), 467 lesbaren Kästen ohne Schild,
 * denselben Bildern verschoben (1–2 px), unscharf, heller/dunkler, Gamma, JPEG 85/60, Maßstab 0,8/1,25, dazu 230
 * künstlichen Schildern mit vertauschten oder entfernten Ziffern (z. B. 10,620 -> 16,620, kein bekannter Wert):
 * 11.274 Fälle, keine falsche Lesung; der nächste falsche Kandidat liegt 1,4 vom Annehmen entfernt (Abstand =
 * größte Überschreitung einer Schwelle). Schwellen gewählt als "null Fehler und mindestens 1,0 Reserve, sonst
 * möglichst viele richtig"; dieselbe Wahl im Leave-one-out (je Bild, je Wert, je Störung) ohne Fehler, kleinste
 * Reserve dort 0,4. Pro Bild wird etwa die Hälfte der Schilder gelesen (der Rest ist zu unscharf, oder "17,080"
 * gegen 7,080 bleibt zu knapp) - der Tracker sammelt über mehrere Bilder.
 *
 * Nachprüfung (2026-11-28, Angriffe mit echten Ziffern): Diese Abstände messen nur, wie sicher die Erkennung sich ist,
 * nicht, ob sie recht hat. Ein heller Asteroid hinter der führenden 1 ergibt "7.080" für 17,080 (margin 4–5), eine
 * schwache erste Ziffer "4000" für 8,000 (margin 5,8), eine 5, die die Erkennung als 6 liest, "11655" für ein Schild
 * 11,555 (margin 10, open 3,7) - in jedem Bild gleich, also auch nach zwei Lesungen. Deshalb gilt das Lexikon allein
 * nicht mehr als Lesung; es braucht immer die Schild-Schrift mit demselben Wert (readSignatures).
 */
export const DEFAULT_LEXICON: LexiconOptions = { maxGap: 2, minMargin: 4, minOpen: 2, maxOther: 0.1 };
/**
 * Stufe mit zweiter Meinung (source 'tag', immer 2 Bilder) für genau die bekannte Schwäche der Erkennung, die schmale
 * führende 1: Die Lexikon-Lesung erfüllt alle Schwellen von DEFAULT_LEXICON außer dem Abstand zum Zweitbesten, und der
 * Zweitbeste unterscheidet sich nur um eine 1 (17,200 gegen 7,200, margin 2,2). Dann entscheidet die Schild-Schrift,
 * die die Breite der Zeile sieht, wenn sie genau den besten Wert liest, die Erkennung ihn trotzdem vorzieht (margin
 * >= 1) und jede Ziffer außer 1en selbst gesehen hat (lexicon.ts: freeCovers). Die Schild-Schrift ergänzt also keine
 * Ziffer und entscheidet keine andere Verwechslung.
 *
 * Warum so eng (Nachprüfung 2026-11-28, künstliche Schilder mit Ziffern aus anderen echten Schildern, Schild-Schrift
 * auch ohne die beteiligten Bilder gelernt): Die frühere lockere Stufe (margin 0, open 0, gap 8: "Lexikon knapp,
 * Schild-Schrift liest denselben Wert") las gemeinsam falsch, wo beide auf denselben unscharfen Pixeln dieselbe
 * Verwechslung machen (3/8, 5/6, 9/8/0; die 8 und 9 der Schild-Schrift stammen aus 1–2 Schildern): 9,000 -> 8000
 * (Erkennung "0000"), 4,390 -> 4300, 6,360 -> 8360, 11,505 -> 11565, 9,390 -> 8390, 16,360 -> 15360, mit JPEG 85
 * auch 3,135 -> 3185 und 12,535 -> 12585 (margin 2,3 bzw. 3,1). Zwei schwache Leser sind keine starke Lesung.
 * Preis: Im Belastungstest fallen etwa 85 % der Lesungen der alten Stufe weg (meist unscharfe 11,565, deren 6 die
 * Erkennung nicht sieht); an den echten Bildern eine (17,200 in 08-56-53 bleibt).
 */
export const TAG_LEXICON: LexiconOptions = { maxGap: 2, minMargin: 1, minOpen: 2, maxOther: 0.1 };
/** Erfüllt eine Lexikon-Lesung die Schwellen? */
export const lexiconPasses = (r: { gap: number; margin: number; open: number; other: number }, o: LexiconOptions) =>
  r.gap <= o.maxGap && r.margin >= o.minMargin && r.open >= o.minOpen && r.other <= o.maxOther;

export interface ReadSignatureOptions extends Partial<LexiconOptions> {
  /** Bekannte Signaturen (sonst einmalig aus isKnown bestimmt, dauert ~3 s). */
  known?: number[];
  /** Modell der Schild-Schrift; Standard ist das mitgelieferte (data/ocr/tagfont.json), null schaltet sie ab. */
  tagFont?: TagFontModel | null;
}

let bundled: TagFontModel | null | undefined;
/** Mitgeliefertes Modell der Schild-Schrift (dist/modules/mining/data/ocr/tagfont.json), fehlt es: null. */
export function bundledTagFont(): TagFontModel | null {
  if (bundled === undefined) bundled = loadTagFont(fileURLToPath(new URL('../data/ocr/', import.meta.url)));
  return bundled;
}

/**
 * Schild-Schrift an allen Kästen eines Pins. undefined = nirgends ein Schild gefunden. Sonst value: gelesener Wert,
 * null = gefunden, aber kein eindeutiger Wert, 'disagree' = zwei Kästen lesen verschiedene Werte; fit: wie gut der
 * Wert des Lexikons (lexValue) Ziffer für Ziffer passt (bester Kasten; null = passt an keinem auf die Zeile). fit
 * steht nur im Trace (Fehlersuche: sieht die Schild-Schrift dieselben Ziffern?), entscheidet nichts.
 */
function tagOpinion(
  img: Rgb,
  boxes: Box[],
  model: TagFontModel,
  values: readonly number[],
  lexValue: number,
): { value: number | null | 'disagree'; fit: number | null } | undefined {
  let located = false;
  let fit: number | null = null;
  const seen = new Set<number>();
  for (const b of boxes) {
    const t = readTag(img, b, model, values);
    if (!t) continue;
    located = true;
    if (t.value !== null) seen.add(t.value);
    const c = t.check(lexValue);
    if (c && (fit === null || c.slotMargin > fit)) fit = c.slotMargin;
  }
  if (!located) return undefined;
  return { value: seen.size === 0 ? null : seen.size === 1 ? [...seen][0] : 'disagree', fit };
}

interface Lexicon {
  entries: LexiconEntry[];
  values: number[];
}
const lexiconCache = new WeakMap<object, Lexicon>();
/** Bekannte Werte ab 1000 (auch unter MIN_VALUE als Mitbewerber, damit der Abstand zum Zweitbesten ehrlich ist). */
function lexiconFor(isKnown: (v: number) => boolean, known?: number[]): Lexicon {
  const key = known ?? isKnown;
  let lex = lexiconCache.get(key);
  if (!lex) {
    let values: number[] = [];
    if (known) values = known.filter((v) => v >= 1000 && v <= MAX_VALUE);
    else for (let v = 1000; v <= MAX_VALUE; v += 5) if (isKnown(v)) values.push(v);
    lex = { entries: buildLexicon(values), values };
    lexiconCache.set(key, lex);
  }
  return lex;
}

/**
 * Signaturen im Band lesen. img ist das ganze Bild (1920x1080) oder nur das Band, dann mit offset = Lage des Bands.
 * isKnown: ist der Wert eine bekannte Signatur? Gelesen werden nur bekannte Signaturen (Lexikon).
 *
 * Ablauf: Text-Detektion -> nur Kästen mit Pin links davon (Cockpit-Texte haben keinen; spart die meisten
 * Erkennungen) -> je Pin einmal der Bereich vom Pin bis zum Ende der Zahl (so gehört eine vom Detektor
 * abgetrennte "11" dazu) -> Lexikon-Lesung mit Abständen -> Schild-Schrift als zweite Meinung:
 * - liest sie einen anderen Wert als das Lexikon: nichts (tag-conflict);
 * - liest sie denselben Wert und erfüllt das Lexikon seine Schwellen: Lesung, eine genügt (source 'both', sure);
 * - liest sie denselben Wert, und das Lexikon ist nur gegen einen Wert mit einer 1 mehr/weniger knapp (TAG_LEXICON):
 *   Lesung, 2 Bilder nötig (source 'tag');
 * - liest sie keinen Wert (Schild nicht gefunden oder nicht eindeutig): nichts (no-tag), auch wenn das Lexikon sehr
 *   sicher ist. Grund: Fehler, die die Erkennung in jedem Bild gleich macht (eine vom Asteroiden überstrahlte führende
 *   1: 17,080 -> 7,080; eine schwache erste Ziffer: 8,000 -> 4,000; 5 als 6: 11,555 -> 11,655), ergeben einen anderen
 *   bekannten Wert mit gutem Abstand, und zwei Lesungen helfen nicht. Nur ein zweiter, anderer Leser fängt sie ab.
 *   Preis: Wo die Schild-Schrift das Schild nicht findet (bisher: grünes HUD 7200, PC-Testbild 4180, Asteroid direkt
 *   hinter den Ziffern), wird nichts gelesen.
 * Die Schild-Schrift allein ergibt nie eine Lesung. Werte, die keine bekannte Signatur sind (z. B. zwei Kontakte
 * auf einer Zahl), werden nicht gelesen: Die alte freie Lesung lieferte genau dort falsche Werte ("1,565" statt
 * 11,565), und es gibt keine Testbilder, an denen sich eine sichere Schwelle dafür messen ließe.
 */
export async function readSignatures(
  img: Rgb,
  reader: LineReader,
  detector: TextDetector,
  isKnown: (value: number) => boolean,
  band: Box = [0, 0, img.width, img.height],
  offset: [number, number] = [0, 0],
  trace?: SignatureTrace[],
  options: ReadSignatureOptions = {},
): Promise<SignatureReading[]> {
  const opts = { ...DEFAULT_LEXICON, ...options };
  const tagFont = options.tagFont === undefined ? bundledTagFont() : options.tagFont;
  const boxes = await detector.detect(img, band);
  const out: SignatureReading[] = [];
  const shift = (b: Box): Box => [offset[0] + b[0], offset[1] + b[1], b[2], b[3]];
  // Kästen je Pin sammeln (Pin-Lage als Schlüssel)
  const groups: { pin: PinMatch; boxes: Box[]; traces: SignatureTrace[] }[] = [];
  for (const b of boxes) {
    const t0: SignatureTrace = { box: shift(b) };
    trace?.push(t0);
    // Zahlen-Schild: niedrig und kurz (bei 1080p ~10 px Ziffern, Kasten 10–22 px hoch, 4–6 Ziffern plus Komma).
    // Obergrenze großzügig, damit Heranzoomen (F) bis etwa 2,5x hilft; ob es ein Schild ist, entscheidet der Pin.
    if (b[3] < 7 || b[3] > 64 || b[2] < 14 || b[2] > 300) {
      t0.dropped = 'size';
      continue;
    }
    const pin = findPin(img, b);
    if (!pin) {
      t0.dropped = 'no-pin';
      continue;
    }
    t0.pin = shift(pin.box);
    const g = groups.find((x) => Math.abs(x.pin.box[0] - pin.box[0]) <= 2 && Math.abs(x.pin.box[1] - pin.box[1]) <= 2);
    if (g) {
      g.boxes.push(b);
      g.traces.push(t0);
      if (pin.digitRight > g.pin.digitRight) g.pin = pin;
    } else groups.push({ pin, boxes: [b], traces: [t0] });
  }
  if (!groups.length || !reader.logProbs) {
    for (const g of groups) for (const t of g.traces) t.dropped = 'empty';
    return out;
  }
  const lexicon = lexiconFor(isKnown, options.known);
  for (const g of groups) {
    const { pin } = g;
    const left = pin.right;
    // Rechts: Ende der Ziffernspur, oder ein Kasten, der dort weitergeht (unscharfe Ziffern), höchstens 5 Pinhöhen
    let right = pin.digitRight + 1;
    for (const b of g.boxes) if (b[0] <= pin.digitRight + 0.5 * pin.box[3]) right = Math.max(right, b[0] + b[2]);
    right = Math.min(right, left + 5 * pin.box[3]);
    // Höhe wie der breiteste Kasten (so hat die Erkennung die Zeilen gelernt), sonst aus der Ziffernspur
    const main = g.boxes.reduce((a, b) => (b[2] > a[2] ? b : a));
    const region: Box = [left, main[1], right - left, main[3]];
    const [first, ...rest] = g.traces;
    for (const t of rest) t.dropped = 'same-pin';
    first.region = shift(region);
    if (region[2] < 8) {
      first.dropped = 'empty';
      continue;
    }
    const lp = await reader.logProbs(cropPadded(img, region, 3), LEXICON_CHARS);
    const r = lp ? readLexicon(lp, lexicon.entries) : null;
    if (!r) {
      first.dropped = 'empty';
      continue;
    }
    Object.assign(first, { text: r.free, confidence: Math.exp(-Math.max(0, r.gap)), best: r.value, second: r.second, margin: r.margin, gap: r.gap, open: r.open, rival: r.rival, other: r.other });
    if (r.value < MIN_VALUE) {
      first.dropped = 'no-match';
      continue;
    }
    // Zweite Meinung: eigene Lesung der Schild-Schrift an den Kästen dieses Pins
    const tag = tagFont ? tagOpinion(img, g.boxes, tagFont, lexicon.values, r.value) : undefined;
    if (tag) Object.assign(first, { tag: tag.value, tagFit: tag.fit });
    if (tag && tag.value !== null && tag.value !== r.value) {
      first.dropped = 'tag-conflict';
      continue;
    }
    const passes = lexiconPasses(r, opts);
    if (tag?.value !== r.value) {
      first.dropped = passes ? 'no-tag' : 'not-sure';
      continue;
    }
    const oneShort = r.second !== null && differByOne1(r.value, r.second);
    if (!passes && (!oneShort || !lexiconPasses(r, TAG_LEXICON) || !freeCovers(r.free, r.value))) {
      first.dropped = 'not-sure';
      continue;
    }
    out.push({
      value: r.value,
      text: signatureFormats(r.value)[0],
      confidence: Math.exp(-Math.max(0, r.gap)),
      separator: true,
      ambiguous: false,
      margin: r.margin,
      gap: r.gap,
      open: r.open,
      sure: passes,
      source: passes ? 'both' : 'tag',
      x: offset[0] + region[0] + region[2] / 2,
      y: offset[1] + region[1] + region[3] / 2,
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
      // Gezählt werden Bilder, nicht Lesungen: zwei Lesungen aus demselben Bild (ein Schild in zwei Pin-Gruppen) sind
      // dieselben Pixel und keine Bestätigung.
      const count = new Set(this.readings.filter((x) => x.value === r.value).map((x) => x.t)).size;
      const known = this.isKnown(r.value);
      // Lexikon-Lesung: sofort, wenn sure (beide Leser einig), sonst in 2 Bildern. Freie Lesung (ohne margin, nur noch
      // in Tests): einmal sehr sicher mit Komma, bekannt mit Komma 2, sonst 3 Bilder.
      const solo = r.margin !== undefined ? Boolean(r.sure) : r.separator && !r.ambiguous && r.confidence >= this.opts.singleConfidence && known;
      const needed = known && r.separator ? 2 : 3;
      if (count >= needed || solo) {
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
