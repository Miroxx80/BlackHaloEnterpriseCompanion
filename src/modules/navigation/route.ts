/**
 * Rechenkern der Sprunghilfen: Wo kreuzt ein Quantum-Sprung von A nach B den Aaron Halo? Reine Logik, ohne Server,
 * Dateien und Oberfläche.
 *
 * Modell (eigene Umsetzung, allgemeine Geometrie):
 * - Der Sprung ist eine gerade Strecke P(t) = A + t·(B − A), t von 0 (Start) bis 1 (Ziel). Koordinaten in km im
 *   Systemrahmen, der Stern liegt im Ursprung.
 * - Ein Band des Halo ist eine Kugelschale um den Stern [inner, outer]. Die Strecke kreuzt das Band dort, wo
 *   |P(t)| = Radius ist (quadratische Gleichung |A + t·d|² = r²).
 * - Im Spiel zeigt das HUD die Restentfernung zum Ziel. Alle Werte hier sind deshalb Restentfernung = L·(1 − t).
 * - Eine Strecke kann den Gürtel zweimal kreuzen (hinein und wieder hinaus, z. B. durch das innere Loch oder
 *   streifend). Jede Kreuzung wird in Reihenfolge der Route gemeldet.
 *
 * Höhe und Dicke der Bänder: Vermessung von CaptSheppard / Cornerstone (Alpha 3.16.1), siehe Datensatz.
 */

export type Vec3 = [number, number, number];

/** Ein Band des Aaron Halo. Radien in km vom Stern, above/below = halbe Dicke über/unter der Ebene (km). */
export interface Band {
  n: number;
  inner: number;
  outer: number;
  densest: number;
  above: number;
  below: number;
  note?: string;
}

/** Eine Kreuzung der dichtesten Stelle eines Bands. Alle Entfernungen sind Restentfernung zum Ziel in km. */
export interface Crossing {
  band: number;
  /** 1 = erster Durchgang durch den Gürtel, 2 = zweiter (nur wenn die Strecke ihn wieder verlässt und erneut kreuzt). */
  pass: number;
  /** Restentfernung an der dichtesten Stelle (km). */
  exit: number;
  /** Restentfernung beim Eintritt in die Bandschale (km). */
  enter: number;
  /** Restentfernung beim Verlassen der Bandschale (km). */
  leave: number;
  /** Höhe über der Ebene (z, km) an der dichtesten Stelle. */
  height: number;
  /** in: innerhalb der Banddicke, over: darüber, under: darunter. */
  status: 'in' | 'over' | 'under';
  /** Empfohlener HUD-Wert in Gm (eine Nachkommastelle), bei dem man den Sprung abbricht. */
  hud: number;
  /** true: der HUD-Wert liegt im Fenster [leave, enter]. */
  hudInWindow: boolean;
}

export interface HaloRoute {
  /** Länge der Strecke (km). */
  length: number;
  /** Alle Kreuzungen in Reihenfolge der Route. */
  crossings: Crossing[];
  /** Band 5 mit Status "in", sonst die "in"-Kreuzung mit dem breitesten Fenster, sonst null. */
  best: Crossing | null;
}

export interface Body {
  id: string;
  pos: Vec3;
  /** Radius in km (Größe bzw. Hindernisradius). */
  radius: number;
}

/** Strecken kürzer als das (km) gelten als Stillstand. */
const MIN_LENGTH = 1e-6;
/** Rundungsreserve beim Vergleich der HUD-Stufen mit dem Fenster (in Zehntel-Gm). */
const STEP_EPS = 1e-9;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const at = (a: Vec3, d: Vec3, t: number): Vec3 => [a[0] + t * d[0], a[1] + t * d[1], a[2] + t * d[2]];
const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

/** Abstand zweier Punkte (km). */
export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Hilfswerte der Geraden durch A in Richtung d: tMin = Parameter des sonnennächsten Punkts, h = dessen Abstand
 * zum Stern. Daraus folgen die Schnittpunkte mit jeder Kugel um den Ursprung ohne Auslöschung.
 */
interface Line {
  a: Vec3;
  d: Vec3;
  length: number;
  tMin: number;
  h: number;
}

function line(a: Vec3, b: Vec3): Line {
  const d = sub(b, a);
  const length = Math.hypot(d[0], d[1], d[2]);
  const tMin = length > MIN_LENGTH ? -dot(a, d) / (length * length) : 0;
  const p = at(a, d, tMin);
  return { a, d, length, tMin, h: Math.hypot(p[0], p[1], p[2]) };
}

/**
 * Schnittpunkte der (unbegrenzten) Geraden mit der Kugel vom Radius r: t = tMin ± √(r² − h²) / L.
 * Berührt die Gerade die Kugel nur (oder verfehlt sie), gibt es keine Kreuzung.
 */
function sphereRoots(l: Line, r: number): [number, number] | null {
  if (l.length <= MIN_LENGTH || l.h >= r) return null;
  const s = Math.sqrt((r - l.h) * (r + l.h)) / l.length;
  return [l.tMin - s, l.tMin + s];
}

/**
 * HUD-Empfehlung. Das HUD zeigt Entfernungen über 1 Gm in Gm mit EINER Nachkommastelle. Man bricht den Sprung ab,
 * sobald dort ein bestimmter Wert steht; abbrechen lässt sich also praktisch nur auf 0,1-Gm-Stufen.
 * Regel: Von allen Stufen k/10 Gm, die im Fenster [leave, enter] liegen, nehmen wir die, die der dichtesten Stelle
 * (exit) am nächsten liegt. Liegt keine Stufe im Fenster (Band schmaler als 0,1 Gm an dieser Stelle), bleibt der auf
 * 0,1 Gm gerundete exit-Wert, markiert mit hudInWindow = false.
 * Beispiel (im Spiel bestätigt, 4.10.3): MIC-L1 -> Hurston, Fenster 13,33–13,10 Gm, dichteste Stelle 13,22 Gm
 * -> Abbruch bei 13,2 landet in Band 5.
 */
function hudStep(exit: number, enter: number, leave: number): { hud: number; hudInWindow: boolean } {
  const toSteps = 1e-5; // km -> Zehntel-Gm
  const ideal = Math.round(exit * toSteps);
  const lo = Math.ceil(leave * toSteps - STEP_EPS);
  const hi = Math.floor(enter * toSteps + STEP_EPS);
  if (lo > hi) return { hud: ideal / 10, hudInWindow: false };
  const k = Math.min(hi, Math.max(lo, ideal));
  return { hud: k / 10, hudInWindow: true };
}

function statusOf(height: number, band: Band): Crossing['status'] {
  if (height > band.above) return 'over';
  if (height < -band.below) return 'under';
  return 'in';
}

/** Alle Kreuzungen der Strecke from -> to mit den dichtesten Stellen der Bänder. */
export function haloRoute(from: Vec3, to: Vec3, bands: Band[]): HaloRoute {
  const l = line(from, to);
  if (l.length <= MIN_LENGTH) return { length: 0, crossings: [], best: null };

  // Erst nur die Parameter sammeln, die Durchgangsnummer hängt von allen Kreuzungen ab.
  const raw: { band: Band; t: number }[] = [];
  for (const band of bands) {
    const roots = sphereRoots(l, band.densest);
    if (!roots) continue;
    for (const t of roots) if (t >= 0 && t <= 1) raw.push({ band, t });
  }
  raw.sort((x, y) => x.t - y.t);

  // Vor dem sonnennächsten Punkt geht es nach innen, danach nach außen. Zwei Durchgänge nur, wenn es beides gibt.
  const inward = raw.some((c) => c.t < l.tMin);
  const outward = raw.some((c) => c.t >= l.tMin);
  const twoPasses = inward && outward;

  const crossings: Crossing[] = raw.map(({ band, t }) => {
    // Schalengrenzen (innere und äußere Kugel), die diese Stelle auf der Strecke einrahmen. Beginnt oder endet
    // die Strecke in der Schale, gilt t = 0 bzw. t = 1.
    const bounds = [sphereRoots(l, band.inner), sphereRoots(l, band.outer)].flatMap((r) => r ?? []);
    let tEnter = 0;
    let tLeave = 1;
    for (const b of bounds) {
      if (b <= t && b > tEnter) tEnter = b;
      if (b >= t && b < tLeave) tLeave = b;
    }
    tEnter = clamp01(tEnter);
    tLeave = clamp01(tLeave);
    const height = at(l.a, l.d, t)[2];
    const exit = l.length * (1 - t);
    const enter = l.length * (1 - tEnter);
    const leave = l.length * (1 - tLeave);
    return {
      band: band.n,
      pass: twoPasses && t >= l.tMin ? 2 : 1,
      exit,
      enter,
      leave,
      height,
      status: statusOf(height, band),
      ...hudStep(exit, enter, leave),
    };
  });

  let best: Crossing | null = crossings.find((c) => c.band === 5 && c.status === 'in') ?? null;
  if (!best) {
    for (const c of crossings) {
      if (c.status !== 'in') continue;
      if (!best || c.enter - c.leave > best.enter - best.leave) best = c;
    }
  }
  return { length: l.length, crossings, best };
}

/**
 * Himmelskörper nahe der Strecke: alle, deren Oberfläche die Strecke näher als einen Körperradius kommt.
 * clearance = Abstand Strecke – Oberfläche in km (negativ = die Strecke geht durch den Körper).
 * ignore: IDs von Start, Ziel und deren Mutterkörper (dort liegt man zwangsläufig nah). Ergebnis in Reihenfolge
 * der Route.
 */
export function obstructions(
  from: Vec3,
  to: Vec3,
  bodies: Body[],
  ignore: string[] = [],
): { id: string; clearance: number }[] {
  const d = sub(to, from);
  const dd = dot(d, d);
  const skip = new Set(ignore);
  const hits: { id: string; clearance: number; t: number }[] = [];
  for (const body of bodies) {
    if (skip.has(body.id) || !(body.radius > 0)) continue;
    const t = dd > 0 ? clamp01(dot(sub(body.pos, from), d) / dd) : 0;
    const clearance = distance(at(from, d, t), body.pos) - body.radius;
    if (clearance < body.radius) hits.push({ id: body.id, clearance, t });
  }
  hits.sort((x, y) => x.t - y.t);
  return hits.map(({ id, clearance }) => ({ id, clearance }));
}

/**
 * Ziele, deren Route vom Startpunkt aus das gewünschte Band innerhalb seiner Dicke kreuzt (Status "in"), kürzeste
 * Route zuerst. Der Startpunkt selbst (Abstand unter 1 km) und Orte ohne Quantum-Ziel fallen weg.
 */
export function suggestDestinations(
  from: Vec3,
  places: { id: string; pos: Vec3; qt: boolean }[],
  bands: Band[],
  band: number,
  limit = 10,
): { id: string; length: number; crossing: Crossing }[] {
  const out: { id: string; length: number; crossing: Crossing }[] = [];
  for (const place of places) {
    if (!place.qt || distance(from, place.pos) < 1) continue;
    const route = haloRoute(from, place.pos, bands);
    const crossing = route.crossings.find((c) => c.band === band && c.status === 'in');
    if (crossing) out.push({ id: place.id, length: route.length, crossing });
  }
  out.sort((x, y) => x.length - y.length);
  return out.slice(0, Math.max(0, limit));
}

/** km -> Gm mit einer Nachkommastelle und deutschem Komma, wie das HUD ("14,3"). */
export function formatGm(km: number): string {
  const tenths = Math.round(km / 1e5);
  return (tenths / 10).toFixed(1).replace('.', ',');
}
