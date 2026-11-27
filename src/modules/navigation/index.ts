import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BhModule } from '../../core/types.js';
import { haloRoute, obstructions, suggestDestinations, type Band, type Body, type Vec3 } from './route.js';

/** Ein Ort im Datensatz (scripts/navigation-data.mjs). pos in km im Systemrahmen, Stern im Ursprung. */
interface Place {
  id: string;
  name: string;
  short: string;
  kind: 'planet' | 'moon' | 'station' | 'lpoint' | 'gateway' | 'marker';
  group: string;
  qt: boolean;
  pos: Vec3;
  /** Hindernisradius in km (Planeten und Monde), 0 für Stationen und Punkte. */
  radius: number;
}

interface Dataset {
  build: string;
  source: { repo: string; commit: string };
  system: string;
  places: Place[];
  star: { radius: number };
  halo: { name: string; source: string; bands: Band[] };
}

/** ID des Sterns in der Hindernisliste. */
const STAR_ID = 'stanton';
/**
 * Nahbereich eines Körpers für das Ignorieren: Liegen Start oder Ziel näher als NEAR_FACTOR × Radius an seinem
 * Mittelpunkt (Stationen im Orbit, z. B. Everus Harbor über Hurston, Grim HEX bei Yela), gilt der Körper als
 * "Mutterkörper" und wird nicht als Hindernis gemeldet. Monde liegen weit außerhalb (ab ca. 6,7 × Radius).
 */
const NEAR_FACTOR = 3;
/** Höchstzahl der Zielvorschläge pro Abfrage. */
const MAX_SUGGEST = 50;

function loadDataset(dir: string): Dataset {
  const file = join(dir, 'data', 'dataset.json');
  if (!existsSync(file)) throw new Error(`Datensatz fehlt: ${file} (npm run build kopiert ihn nach dist)`);
  return JSON.parse(readFileSync(file, 'utf8')) as Dataset;
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Ort für die Antwort, ohne interne Felder. */
const publicPlace = ({ id, name, short, kind, group, qt, pos, radius }: Place) => ({ id, name, short, kind, group, qt, pos, radius });

/**
 * Sprunghilfen: Quantum-Routen und Aaron Halo. Stufe 1: Wo kreuzt ein Sprung von A nach B die Bänder des Halo,
 * und bei welcher Restentfernung im HUD bricht man ab? Nur Anzeige, keine Eingaben ans Spiel.
 * Rechenkern: route.ts. Daten: data/dataset.json (scripts/navigation-data.mjs).
 */
const mod: BhModule = {
  manifest: {
    id: 'navigation',
    name: 'Sprunghilfen',
    version: '0.1.0',
    roles: ['companion'],
    nav: { label: 'Sprunghilfen', icon: 'quantum', description: 'Quantum-Routen und Aaron Halo' },
    ui: true,
  },

  setup(ctx) {
    const data = loadDataset(ctx.dir);
    // Markierungen (Mittelpunkte der L-Punkte) sind keine Ziele, sie dienen nur den Referenztests
    const places = data.places.filter((p) => p.kind !== 'marker');
    const byId = new Map(places.map((p) => [p.id, p]));
    const bands = data.halo.bands;
    const bodies: Body[] = [
      ...places.filter((p) => p.radius > 0).map((p) => ({ id: p.id, pos: p.pos, radius: p.radius })),
      { id: STAR_ID, pos: [0, 0, 0], radius: data.star.radius },
    ];

    /** Start, Ziel und Körper, in deren Nahbereich Start oder Ziel liegen (siehe NEAR_FACTOR). */
    const ignoreFor = (from: Place, to: Place): string[] => {
      const ids = new Set([from.id, to.id]);
      for (const b of bodies) {
        if (dist(b.pos, from.pos) < b.radius * NEAR_FACTOR || dist(b.pos, to.pos) < b.radius * NEAR_FACTOR) ids.add(b.id);
      }
      return [...ids];
    };

    const place = (raw: unknown): Place | undefined => (typeof raw === 'string' ? byId.get(raw) : undefined);

    ctx.http.get('/data', async () => ({
      build: data.build,
      source: data.source,
      system: data.system,
      places: places.map(publicPlace),
      halo: data.halo,
      star: data.star,
    }));

    ctx.http.get('/halo', async (req, reply) => {
      const q = req.query as Record<string, unknown>;
      const from = place(q.from);
      const to = place(q.to);
      if (!from) return reply.code(400).send({ error: `Unbekannter Start "${String(q.from ?? '')}"` });
      if (!to) return reply.code(400).send({ error: `Unbekanntes Ziel "${String(q.to ?? '')}"` });
      return {
        from: publicPlace(from),
        to: publicPlace(to),
        route: haloRoute(from.pos, to.pos, bands),
        obstructions: obstructions(from.pos, to.pos, bodies, ignoreFor(from, to)),
      };
    });

    ctx.http.get('/suggest', async (req, reply) => {
      const q = req.query as Record<string, unknown>;
      const from = place(q.from);
      if (!from) return reply.code(400).send({ error: `Unbekannter Start "${String(q.from ?? '')}"` });
      const band = Number(q.band);
      if (!Number.isInteger(band) || !bands.some((b) => b.n === band)) {
        return reply.code(400).send({ error: `Band muss eine Zahl von 1 bis ${bands.length} sein` });
      }
      const limit = q.limit === undefined ? 10 : Number(q.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SUGGEST) {
        return reply.code(400).send({ error: `limit muss zwischen 1 und ${MAX_SUGGEST} liegen` });
      }
      return suggestDestinations(from.pos, places, bands, band, limit);
    });
  },
};

export default mod;
