/**
 * Rechenkern des Mining Companion. Reine Logik, ohne Server und Oberfläche.
 *
 * Modell (Herleitung und Quellen: docs/research/mining-companion.md, Abschnitt 2):
 * - Ein Stein bricht, wenn die durchkommende Leistung die "Entladung" übersteigt: decayPerMass × Masse.
 * - Durchkommende Leistung = Laserleistung × (1 − R_eff^k), R_eff = wirksame Resistenz (0..1).
 * - Laser, Module und Gadgets wirken multiplikativ: Faktor (1 + Wert/100) je Teil.
 * - Nötige Laserleistung = Bedarf ÷ durchkommende Leistung bei 100 %.
 *
 * Werte im Scan-Panel: weiß = Wert des Steins, grün/rot = schon mit Laser, Modulen und Gadget verrechnet
 * (im Spiel beobachtet, 4.10.3). Farbige Werte werden zurückgerechnet, damit nichts doppelt zählt.
 */
import type { CalcOptions, Dataset, Gadget, Laser, LoadoutInput, MiningModule, ScanInput } from './types.js';

/**
 * Messtoleranz (Bedrock BREAK_EDGE): Zwischen 100 % und 105 % ist es ein Grenzfall. Rechnerisch reicht die Leistung
 * nicht ganz, wegen der Ungenauigkeit des Modells kann es aber trotzdem klappen.
 */
export const EDGE = 1.05;
/** Bis hierhin lädt der Stein zügig. Darüber "geht, lädt aber langsam". */
export const COMFORTABLE = 0.9;
/** Schwankung der Anzeige bei Instabilität > 1 (± Prozentpunkte), wie Bedrock. */
export const SWAY = 4;
export const DEFAULT_OPTIONS: CalcOptions = { resistanceExponent: 1.21 };

/**
 * ok: passt. slow: geht, lädt aber langsam (über 90 %). edge: Grenzfall (100–105 %).
 * too-strong: schon die Mindestleistung des Lasers ist zu viel. impossible: reicht nicht.
 */
export type Status = 'ok' | 'slow' | 'edge' | 'too-strong' | 'impossible';

/** Reihenfolge für Vergleiche: kleiner = besser. */
const STATUS_RANK: Record<Status, number> = { ok: 0, slow: 1, 'too-strong': 2, edge: 3, impossible: 4 };
/** Wunsch-Leistung für Vergleiche (Bedrock bevorzugt um 60 %: Spielraum nach oben und unten). */
const TARGET_SHARE = 0.6;

export interface Assessment {
  /** Durchkommende Leistung bei 100 %. */
  through: number;
  /** Nötiger Anteil der Laserleistung (0.336 = 33,6 %). Über 1 = Laser reicht nicht. */
  share: number;
  /** Anzeige-Spanne in % (gerundet). null, wenn gar keine Leistung durchkommt (Resistenz 100 %). */
  band: [number, number] | null;
  status: Status;
  /** Schwerster Stein dieser Resistenz, den das Setup noch bricht (kg). */
  maxMass: number;
  /** Nur bei "too-strong": geschätzter Abstand (m), ab dem der Laser bei Mindestleistung + 25 Punkte passt. */
  backoffM?: number;
  /**
   * Nötige Leistung je Abstand (außer "impossible"): Bis rangeFull volle Leistung, bis rangeZero linear auf null
   * (Form nicht in den Spieldaten; zwei Messungen von Bedrock und ein PC-Test der Orga passen zu linear).
   * m: Abstand in Metern, pct: Einstellung.
   */
  distances?: { m: number; pct: number }[];
  /**
   * Nur bei "too-strong": Selbst die Mindestleistung passt erst in den letzten Metern vor der maximalen Reichweite
   * (oder gar nicht). Praktisch kaum zu halten; ein Laser mit niedrigerer Mindestleistung passt besser.
   */
  nearMaxRange?: { fromM: number | null; maxM: number };
  resistancePct: number;
  instability: number;
}

export interface Variant {
  label: string;
  moduleNames: string[];
  assessment: Assessment;
}

export interface GadgetOption {
  gadget: { id: string; name: string };
  assessment: Assessment;
}

export interface GadgetAdvice {
  kind: 'attached' | 'required' | 'recommended' | 'optional' | 'none-helps';
  /** Bester Vorschlag (bei required/recommended/optional). */
  best?: GadgetOption;
  /** Alle Gadgets zum Vergleich. */
  all: GadgetOption[];
}

export interface CalcResult {
  build: string;
  options: CalcOptions;
  rock: {
    mass: number;
    /** Benötigte durchkommende Leistung. */
    needs: number;
    resistanceOwn: number;
    instabilityOwn: number;
    scu: number | null;
    parts: { oreId: string | null; name: string; pct: number; scu: number | null; quality: number | null }[];
    gadgetAttached: { id: string; name: string } | null;
  };
  setup: {
    laser: { id: string; name: string; throttleMin: number };
    /** Crafting-Bonus auf die Leistung in % (0 = Serienlaser). */
    powerBonusPct: number;
    passive: string[];
    active: string[];
    /** Leistung bei 100 % ohne aktive Module. */
    power: number;
    /** Gesamtfaktor auf die Resistenz (0.7 = −30 %), ohne aktive Module. */
    resistanceFactor: number;
    instabilityFactor: number;
    /** Größe des optimalen Ladefensters in % (100 = Standard), wie im HUD "WINDOW SIZE". */
    windowPct: number;
  };
  /** Mit aktuellem Setup, ohne aktive Module, mit dem Gadget, das schon am Stein sitzt. */
  baseline: Assessment;
  /** Mit aktiven Modulen (nur wenn welche eingebaut sind). */
  variants: Variant[];
  gadgets: GadgetAdvice;
  notes: string[];
}

export class InputError extends Error {}

const factor = (pct: number) => 1 + pct / 100;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function finite(v: unknown, name: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    throw new InputError(`${name} muss eine Zahl zwischen ${min} und ${max} sein`);
  }
  return v;
}

/** Erlaubter Bereich für den Crafting-Bonus (Recherche: etwa x0,64 bis x1,44; mit Puffer). */
export const POWER_BONUS_RANGE = [-50, 100] as const;

interface Setup {
  /** Faktor aus dem Crafting-Bonus (1.105 = +10,5 %). */
  craft: number;
  laser: Laser;
  passive: MiningModule[];
  active: MiningModule[];
}

function resolveSetup(data: Dataset, loadout: LoadoutInput): Setup {
  const laser = data.lasers.find((l) => l.id === loadout.laserId);
  if (!laser) throw new InputError(`Unbekannter Laser "${loadout.laserId}"`);
  if (!Array.isArray(loadout.moduleIds)) throw new InputError('moduleIds muss eine Liste sein');
  if (loadout.moduleIds.length > laser.slots) {
    throw new InputError(`${laser.name} hat nur ${laser.slots} Modul-Slot(s)`);
  }
  const modules = loadout.moduleIds.map((id) => {
    const m = data.modules.find((x) => x.id === id);
    if (!m) throw new InputError(`Unbekanntes Modul "${id}"`);
    return m;
  });
  const bonus = loadout.powerBonusPct ?? 0;
  finite(bonus, 'Crafting-Bonus', POWER_BONUS_RANGE[0], POWER_BONUS_RANGE[1]);
  return { craft: factor(bonus), laser, passive: modules.filter((m) => !m.active), active: modules.filter((m) => m.active) };
}

/** Kombinierte Werte von Laser + Modulen (+ Crafting-Faktor auf die Leistung). */
function combine(laser: Laser, modules: MiningModule[], craft = 1) {
  let power = laser.power * craft;
  let res = factor(laser.mods.resistance);
  let inst = factor(laser.mods.instability);
  let win = factor(laser.mods.window);
  for (const m of modules) {
    power *= m.power;
    res *= factor(m.mods.resistance);
    inst *= factor(m.mods.instability);
    win *= factor(m.mods.window);
  }
  return { power, res, inst, win };
}

function assess(
  power: number,
  resistancePct: number,
  instability: number,
  needs: number,
  laser: Laser,
  decayPerMass: number,
  k: number,
): Assessment {
  const r = clamp(resistancePct, 0, 100) / 100;
  const through = power * (1 - Math.pow(r, k));
  // Ohne durchkommende Leistung: als "unmöglich" behandeln. JSON kennt kein Infinity, daher eine große Zahl.
  const share = through > 0 ? needs / through : Number.MAX_VALUE;
  let status: Status;
  if (share > EDGE) status = 'impossible';
  else if (share > 1) status = 'edge';
  else if (share > COMFORTABLE) status = 'slow';
  else if (share < laser.throttleMin) status = 'too-strong';
  else status = 'ok';

  // Mehr als 100 % lässt sich nicht einstellen: Spanne oben kappen
  const hold = Math.round(share * 100);
  const sway = instability > 1 ? SWAY : 0;
  const band: [number, number] | null =
    through > 0 ? [Math.min(100, Math.max(0, hold - sway)), Math.min(100, hold + sway)] : null;

  const result: Assessment = {
    through,
    share,
    band,
    status,
    maxMass: through / decayPerMass,
    resistancePct: clamp(resistancePct, 0, 100),
    instability,
  };
  if (status !== 'impossible' && through > 0) result.distances = distanceTable(share, laser);
  if (status === 'too-strong') {
    const span = laser.rangeZero - laser.rangeFull;
    const fromM = result.distances?.[0]?.m ?? null;
    if (fromM == null || fromM >= laser.rangeZero - Math.max(2, 0.1 * span)) result.nearMaxRange = { fromM, maxM: laser.rangeZero };
    // Laser ist selbst bei Mindestleistung zu stark: mit Abstand nimmt die Leistung ab (linear zwischen
    // rangeFull und rangeZero, Schätzung). Ziel wie Bedrock: Mindestleistung + 25 Punkte, 35–60 %.
    const target = clamp(laser.throttleMin + 0.25, 0.35, 0.6);
    const f = share / target;
    result.backoffM = Math.round(laser.rangeFull + (1 - f) * (laser.rangeZero - laser.rangeFull));
  }
  return result;
}

/**
 * Abstand -> nötige Leistung. Durchkommende Leistung bei Abstand d: P x f(d), f = 1 bis rangeFull, dann linear bis 0
 * bei rangeZero. Nötige Einstellung t = share / f(d), also d(t) = rangeFull + (1 - share / t) x (rangeZero - rangeFull).
 * Zeilen für Mindestleistung, 30, 40 ... 100 % (nur einstellbare Werte), auf höchstens 6 ausgedünnt.
 */
export function distanceTable(share: number, laser: Laser): { m: number; pct: number }[] {
  const span = laser.rangeZero - laser.rangeFull;
  if (!(share > 0) || share > 1 || span <= 0) return [];
  const steps = [laser.throttleMin, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].filter((t) => t >= laser.throttleMin && t >= share);
  // Erste Zeile: bis zur optimalen Reichweite die eigentliche Haltleistung (wenn sie einstellbar ist)
  if (share >= laser.throttleMin) steps.unshift(share);
  const rows: { m: number; pct: number }[] = [];
  for (const t of [...new Set(steps)].sort((a, b) => a - b)) {
    const m = Math.round(laser.rangeFull + (1 - share / t) * span);
    if (rows.length && rows[rows.length - 1].m === m) continue;
    rows.push({ m, pct: Math.round(t * 100) });
  }
  if (rows.length <= 6) return rows;
  // Erste und letzte behalten, dazwischen gleichmäßig auswählen
  const keep = [0, ...[1, 2, 3, 4].map((i) => Math.round((i * (rows.length - 1)) / 5)), rows.length - 1];
  return [...new Set(keep)].map((i) => rows[i]);
}

/** Aktive-Modul-Varianten: Surge läuft parallel (auch doppelt), andere aktive Module nur einzeln. */
function activeVariants(active: MiningModule[]): MiningModule[][] {
  if (active.length === 0) return [];
  const parallel = active.filter((m) => !m.canInterrupt);
  const exclusive = [...new Map(active.filter((m) => m.canInterrupt).map((m) => [m.id, m])).values()];
  const variants: MiningModule[][] = [];
  if (parallel.length) variants.push(parallel);
  for (const m of exclusive) {
    variants.push([m]);
    if (parallel.length) variants.push([...parallel, m]);
  }
  return variants;
}

export function calculate(
  data: Dataset,
  scan: ScanInput,
  loadout: LoadoutInput,
  options: CalcOptions = DEFAULT_OPTIONS,
): CalcResult {
  const k = finite(options.resistanceExponent, 'resistanceExponent', 0.5, 2);
  const mass = finite(scan.mass, 'Masse', 1, 1_000_000);
  const resPrinted = finite(scan.resistance, 'Resistenz', 0, 100);
  const instPrinted = finite(scan.instability, 'Instabilität', 0, 1000);
  const scu = scan.scu == null ? null : finite(scan.scu, 'SCU', 0, 1000);
  const decay = data.ruleset.decayPerMass;
  const notes: string[] = [];

  const setup = resolveSetup(data, loadout);
  const { laser } = setup;
  const base = combine(laser, setup.passive, setup.craft);

  let attached: Gadget | null = null;
  if (scan.gadgetAttached) {
    attached = data.gadgets.find((g) => g.id === scan.gadgetAttached) ?? null;
    if (!attached) throw new InputError(`Unbekanntes Gadget "${scan.gadgetAttached}"`);
  }
  const gRes = attached ? factor(attached.mods.resistance) : 1;
  const gInst = attached ? factor(attached.mods.instability) : 1;

  // Eigene Werte des Steins zurückgewinnen.
  // Weiß = Wert des Steins. Farbig = enthält Laser, passive Module und (falls angegeben) das Gadget am Stein.
  const ownFrom = (
    printed: number,
    colored: boolean,
    setupFactor: number,
    gadgetFactor: number,
    what: string,
    cappedAt?: number,
  ) => {
    const total = setupFactor * gadgetFactor;
    if (!colored) {
      // Im Spiel beobachtet: Mit Gadget am Stein werden die Werte farbig. Weiß passt dann nicht dazu.
      if (Math.abs(gadgetFactor - 1) > 1e-9) {
        notes.push(`${what} ist weiß, obwohl ein Gadget am Stein sitzt. Im Spiel wird der Wert dann farbig. Bitte Farbe prüfen.`);
      }
      return printed;
    }
    if (Math.abs(total - 1) < 1e-9) {
      notes.push(`${what} ist farbig, aber das gewählte Setup verändert sie nicht. Bitte Loadout prüfen.`);
      return printed;
    }
    if (cappedAt !== undefined && printed >= cappedAt && total > 1) {
      // Das Spiel kappt bei 100 %. Der Stein hat also mindestens 100 / Faktor, vielleicht mehr.
      // Vorsichtig rechnen: mit dem höchsten möglichen Wert, damit kein Gadget falsch empfohlen wird.
      const atLeast = cappedAt / total;
      notes.push(
        `${what} ${cappedAt} % (farbig) ist im Spiel gekappt: Der Stein hat mindestens ${atLeast.toFixed(0)} %. ` +
          `Gerechnet wird vorsichtig mit ${cappedAt} %. Genauer wird es mit dem weißen Wert (Laser nicht auf dem Stein).`,
      );
      return cappedAt;
    }
    return printed / total;
  };
  const resistanceOwn = Math.min(
    100,
    ownFrom(resPrinted, scan.resistanceColored, base.res, gRes, 'Resistenz', 100),
  );
  const instabilityOwn = ownFrom(instPrinted, scan.instabilityColored, base.inst, gInst, 'Instabilität');

  const needs = decay * mass;
  const evaluate = (modules: MiningModule[], gadget: Gadget | null) => {
    const c = combine(laser, [...setup.passive, ...modules], setup.craft);
    const gr = gadget ? factor(gadget.mods.resistance) : 1;
    const gi = gadget ? factor(gadget.mods.instability) : 1;
    return assess(c.power, resistanceOwn * c.res * gr, instabilityOwn * c.inst * gi, needs, laser, decay, k);
  };

  const baseline = evaluate([], attached);
  const variants: Variant[] = activeVariants(setup.active).map((mods) => {
    const names = mods.map((m) => m.name);
    return {
      label: `mit ${names.join(' + ')}`,
      moduleNames: names,
      assessment: evaluate(mods, attached),
    };
  });

  // Gadget-Empfehlung (Schwellen wie Bedrock, dort als "erste Schätzung" bezeichnet).
  // Vergleich: erst nach Status (ok vor langsam vor zu stark ...), dann nach Nähe zu ~60 % Leistung.
  const all: GadgetOption[] = data.gadgets.map((g) => ({
    gadget: { id: g.id, name: g.name },
    assessment: evaluate([], g),
  }));
  const better = (a: GadgetOption, b: GadgetOption) =>
    STATUS_RANK[a.assessment.status] - STATUS_RANK[b.assessment.status] ||
    Math.abs(a.assessment.share - TARGET_SHARE) - Math.abs(b.assessment.share - TARGET_SHARE);
  let gadgets: GadgetAdvice;
  if (attached) {
    gadgets = { kind: 'attached', all: [] };
  } else if (baseline.status === 'impossible' || baseline.status === 'edge') {
    // Ein Gadget hilft nur, wenn es danach sicher reicht (höchstens 100 %)
    const helping = all.filter((o) => o.assessment.share <= 1).sort(better);
    if (helping.length) gadgets = { kind: 'required', best: helping[0], all };
    else gadgets = baseline.status === 'impossible' ? { kind: 'none-helps', all } : { kind: 'optional', all };
  } else if (baseline.status === 'slow') {
    const helping = all.filter((o) => o.assessment.status === 'ok').sort(better);
    gadgets = helping.length ? { kind: 'recommended', best: helping[0], all } : { kind: 'optional', all };
  } else if (baseline.status === 'too-strong') {
    // Zu stark löst man mit Abstand, nicht mit einem Gadget
    gadgets = { kind: 'optional', all };
  } else {
    // Bruch ist sicher. Optional: Instabilität dämpfen, sonst Fenster vergrößern, sonst mehr Ausbeute.
    const windowPct = 100 * base.win;
    const pick = baseline.instability >= 5 ? 'BoreMax' : windowPct < 70 ? 'Waveshift' : 'OptiMax';
    const best = all.find((o) => o.gadget.name === pick && o.assessment.status === 'ok');
    gadgets = { kind: 'optional', best, all };
  }

  const oreName = (id: string | null) => {
    if (!id) return 'Inert';
    const o = data.ores.find((x) => x.id === id);
    if (!o) throw new InputError(`Unbekanntes Erz "${id}"`);
    return `${o.name} (${o.form === 'RAW' ? 'Raw' : 'Ore'})`;
  };
  const parts = (scan.parts ?? []).map((p, i) => {
    const pctV = finite(p.pct, `Anteil in Zeile ${i + 1}`, 0, 100);
    const quality = p.quality == null ? null : finite(p.quality, `Qualität in Zeile ${i + 1}`, 0, 1000);
    return {
      oreId: p.oreId,
      name: oreName(p.oreId),
      pct: pctV,
      scu: scu == null ? null : (pctV / 100) * scu,
      quality,
    };
  });
  const sum = parts.reduce((s, p) => s + p.pct, 0);
  if (parts.length && (sum < 98 || sum > 100.5)) {
    notes.push(`Die Anteile ergeben ${sum.toFixed(2).replace('.', ',')} % statt 100 %. Bitte Zusammensetzung prüfen.`);
  }

  return {
    build: data.build,
    options: { resistanceExponent: k },
    rock: {
      mass,
      needs,
      resistanceOwn,
      instabilityOwn,
      scu,
      parts,
      gadgetAttached: attached ? { id: attached.id, name: attached.name } : null,
    },
    setup: {
      laser: { id: laser.id, name: laser.name, throttleMin: laser.throttleMin },
      powerBonusPct: loadout.powerBonusPct ?? 0,
      passive: setup.passive.map((m) => m.name),
      active: setup.active.map((m) => m.name),
      power: base.power,
      resistanceFactor: base.res,
      instabilityFactor: base.inst,
      windowPct: 100 * base.win,
    },
    baseline,
    variants,
    gadgets,
    notes,
  };
}
