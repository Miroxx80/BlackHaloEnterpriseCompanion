/** Datensatz aus scripts/mining-data.mjs (Spieldaten pro LIVE-Build). Prozentwerte wie im Spiel: -30 = -30 %. */
export interface Dataset {
  build: string;
  source: { repo: string; commit: string };
  ruleset: { decayPerMass: number };
  ships: Ship[];
  lasers: Laser[];
  modules: MiningModule[];
  gadgets: Gadget[];
  ores: Ore[];
  signatures: SignatureData;
}

export type Rarity = 'legendary' | 'epic' | 'rare' | 'uncommon' | 'common';

/** Radar-Signaturen (generiert aus den Spieldaten, siehe scripts/mining-data.mjs). */
export interface SignatureData {
  /** Clustergrößen je Seltenheit: probability = Anteil der Vorkommen, die als Cluster spawnen. */
  clusters: Record<Rarity, { probability: number; sizes: { size: number; p: number }[] }>;
  /** Bodenfamilien und Kleinteile: gleiche Signatur für alle Mineralien einer Familie. */
  families: { id: 'roc' | 'fps' | 'small'; label: string; base: number; maxCount: number; minerals: string[] }[];
  /** Einzelne Wracks mit eigener Signatur. */
  debris: { base: number; label: string }[];
  locations: SignatureLocation[];
}

export interface SignatureLocation {
  id: string;
  name: string;
  system: string;
  /** Planet oder Mond (Bodenvorkommen möglich). */
  surface: boolean;
  /** Anteil der Schiffs-Erze an den Vorkommen dieses Orts (0..1). */
  ores: { ore: string; p: number }[];
  /** Bodenfamilien an diesem Ort ('roc', 'fps'). */
  ground: string[];
}

export interface Ship {
  id: string;
  name: string;
  heads: { position: string; size: number; stockLaser: string }[];
}

export interface Laser {
  id: string;
  name: string;
  size: number;
  /** Bruch-Leistung bei 100 % (DamageEnergy des ElectricArc-Strahls). */
  power: number;
  /** Kleinste einstellbare Leistung als Anteil (0.2 = 20 %). */
  throttleMin: number;
  extraction: number;
  /** Volle Leistung bis rangeFull (m), dann linear abfallend bis 0 bei rangeZero. */
  rangeFull: number;
  rangeZero: number;
  slots: number;
  requiredTags: string[];
  mods: { resistance: number; instability: number; window: number; rate: number };
  inertFilter: number;
}

export interface MiningModule {
  id: string;
  name: string;
  active: boolean;
  /** Faktor auf die Bruch-Leistung (1.5 = +50 %). */
  power: number;
  extraction: number;
  mods: {
    resistance: number;
    instability: number;
    window: number;
    rate: number;
    shatter: number;
    catastrophic: number;
    inertFilter: number;
  };
  uses: number | null;
  durationS: number | null;
  /** false bei Surge: läuft parallel zu anderen aktiven Modulen. */
  canInterrupt: boolean;
  isInterruptible: boolean;
}

export interface Gadget {
  id: string;
  name: string;
  mods: { resistance: number; instability: number; window: number; rate: number; cluster: number };
}

export interface Ore {
  id: string;
  name: string;
  form: 'ORE' | 'RAW';
  /** Dichte (g/cm³, relativ zu Wasser); Masse = 142,857 x SCU x Summe(Anteil x Dichte). */
  density?: number;
  /** Basis-Signatur auf dem Radar (nur Schiffs-Erze). */
  signature?: number;
  rarity?: Rarity;
}

/** Was im Scan-Panel steht (von Hand eingegeben oder später per OCR). */
export interface ScanInput {
  /** Masse in kg. */
  mass: number;
  /** Resistenz in %, wie angezeigt. */
  resistance: number;
  /** true: Wert ist grün/rot, also schon durch Laser, Module und ggf. Gadget verändert. */
  resistanceColored: boolean;
  instability: number;
  instabilityColored: boolean;
  /** Gesamtvolumen in SCU (optional). */
  scu?: number | null;
  parts?: { oreId: string | null; pct: number; quality?: number | null }[];
  /** Gadget, das beim Scan schon am Stein sitzt (dann sind die Werte farbig und enthalten es). */
  gadgetAttached?: string | null;
}

export interface LoadoutInput {
  laserId: string;
  /** Module in den Slots des Laserkopfs (aktive und passive). */
  moduleIds: string[];
  /**
   * Zusätzliche Laserleistung durch Crafting in Prozent (z. B. 10.5 = +10,5 %). Wird auf die Bruch-Leistung
   * multipliziert. Das Spiel zeigt diesen Bonus im HUD nicht an (Fracture PWR bleibt beim Grundwert).
   */
  powerBonusPct?: number;
}

export interface CalcOptions {
  /**
   * Exponent der Resistenz-Kurve: durchkommende Leistung = P × (1 − R^k).
   * 1.21 (Bedrock, an Messungen angepasst, trifft den Referenz-Screenshot) oder 1 (linear, die meisten Tools).
   */
  resistanceExponent: number;
}
