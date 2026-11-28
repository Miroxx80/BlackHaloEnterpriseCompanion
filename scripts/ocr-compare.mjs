// Vergleich eines OCR-Ergebnisses mit einem bestätigten Scan (für ocr-eval.mjs und ocr-train-glyphs.mjs).
// Zeilen der Zusammensetzung werden ohne Rücksicht auf die Reihenfolge zugeordnet (meiste gleiche Felder): In
// bestätigten Scans steht eine Zeile, die die OCR nicht gefunden hat, oft am Ende. Leere Werte in der Wahrheit
// (z. B. SCU nicht eingetragen) gelten als nicht geprüft und zählen nicht.
import sharp from 'sharp';

/** Zahl aus einem Wert ("9.84", "901.80m" = Milli-SCU, "11,77" mit Komma). NaN, wenn leer. */
export const value = (v) => {
  const s = String(v ?? '').trim().replace(',', '.');
  if (!s) return NaN;
  return s.endsWith('m') ? Number(s.slice(0, -1)) / 1000 : Number(s);
};

/** Leer gelassen = nicht geprüft. */
export const blank = (v) => String(v ?? '').trim() === '';

export const MAIN_FIELDS = ['mass', 'resistance', 'instability', 'scu', 'resColor', 'instColor'];

/** Gleich? Farben und Erze als Text, Zahlen als Wert; leere Qualität = 0. */
export function same(field, read, want) {
  if (field === 'ore' || field.endsWith('Color')) return read === want;
  if (field === 'quality' && !Number(want || 0) && !Number(read || 0)) return true;
  return value(read) === value(want);
}

/**
 * Gelesene Zeile i -> Zeile der Wahrheit (oder -1): meiste gleiche Felder, bei Gleichstand gleiche Stelle. Sonst
 * streng: An anderer Stelle nur mit mindestens einem gleichen (geprüften) Feld.
 */
export function matchParts(read, truth) {
  const score = (i, j) => {
    const n = ['pct', 'ore', 'quality'].filter((f) => !blank(truth[j][f]) && same(f, read[i][f], truth[j][f])).length;
    return i === j ? n * 10 + 1 : n ? n * 10 : -Infinity;
  };
  const memo = new Map();
  const best = (i, used) => {
    if (i === read.length) return { s: 0, pick: [] };
    const key = `${i}:${used}`;
    if (memo.has(key)) return memo.get(key);
    const skip = best(i + 1, used);
    let r = { s: skip.s, pick: [-1, ...skip.pick] };
    for (let j = 0; j < truth.length; j++) {
      if (used & (1 << j) || score(i, j) === -Infinity) continue;
      const sub = best(i + 1, used | (1 << j));
      if (sub.s + score(i, j) > r.s) r = { s: sub.s + score(i, j), pick: [j, ...sub.pick] };
    }
    memo.set(key, r);
    return r;
  };
  return best(0, 0).pick;
}

/**
 * Felder vergleichen. Liefert [{ key, ok, marked, read, want }]. Fehlende Zeilen gelten als gewarnt, wenn ein
 * Anteil markiert ist (dann steht "Fehlt eine Zeile?" da).
 */
export function compareScan(result, truth) {
  const d = result.draft;
  const marks = result.marks;
  const pctMarked = Object.keys(marks).some((k) => /^parts\.\d+\.pct$/.test(k));
  const out = [];
  for (const k of MAIN_FIELDS) {
    if (blank(truth[k])) continue; // nicht geprüft
    out.push({ key: k, ok: same(k, d[k], truth[k]), marked: Boolean(marks[k]), read: d[k], want: truth[k] });
  }
  const pick = matchParts(d.parts, truth.parts);
  d.parts.forEach((p, i) => {
    const t = pick[i] >= 0 ? truth.parts[pick[i]] : null;
    for (const f of ['pct', 'ore', 'quality']) {
      const key = `parts.${i}.${f}`;
      // Leer gelassen = nicht geprüft (leere Qualität bei Inert zählt: same() nimmt leer = 0)
      if (t && blank(t[f]) && !(f === 'quality' && same(f, p[f], t[f]))) continue;
      out.push({ key, ok: t ? same(f, p[f], t[f]) : false, marked: Boolean(marks[key]), read: p[f], want: t?.[f] });
    }
  });
  const used = new Set(pick);
  let extra = d.parts.length;
  truth.parts.forEach((t, j) => {
    if (used.has(j)) return;
    const i = extra++;
    for (const f of ['pct', 'ore', 'quality']) if (!blank(t[f])) out.push({ key: `parts.${i}.${f}`, ok: false, marked: pctMarked, read: undefined, want: t[f] });
  });
  return out;
}

/** Wahrer Text eines gelesenen Zahlenfelds (für das Lernen der Ziffern); null, wenn unbekannt. */
export function truthText(result, truth, key) {
  if (['mass', 'resistance', 'instability', 'scu'].includes(key)) return String(truth[key] ?? '').trim() || null;
  const m = key.match(/^parts\.(\d+)\.(pct|quality)$/);
  if (!m) return null;
  const j = matchParts(result.draft.parts, truth.parts)[+m[1]];
  return j >= 0 ? String(truth.parts[j][m[2]] ?? '').trim() || null : null;
}

/** Summen über mehrere Scans. */
export function tally() {
  const t = { fields: 0, right: 0, rightYellow: 0, wrongYellow: 0, silent: [], reasons: {} };
  t.add = (id, result, truth) => {
    const wrong = [];
    for (const f of compareScan(result, truth)) {
      t.fields++;
      if (f.ok) {
        t.right++;
        if (f.marked) {
          t.rightYellow++;
          for (const why of result.reasons?.[f.key] ?? ['sonst']) t.reasons[why] = (t.reasons[why] ?? 0) + 1;
        }
      } else if (f.marked) {
        t.wrongYellow++;
        wrong.push(`${f.key}=${f.read ?? '-'}? (echt ${f.want ?? '-'})`);
      } else {
        t.silent.push(`${id}: ${f.key}=${f.read} (echt ${f.want})`);
        wrong.push(`${f.key}=${f.read} STILL (echt ${f.want})`);
      }
    }
    return wrong;
  };
  t.summary = (n) =>
    `${n} Scans, ${t.fields} Felder: richtig ${t.right} (${((100 * t.right) / t.fields).toFixed(1)} %), davon unnötig gelb ${t.rightYellow}\n` +
    `Falsch und gelb: ${t.wrongYellow}. FALSCH OHNE MARKIERUNG: ${t.silent.length}\n` +
    `Gründe für unnötiges Gelb: ${JSON.stringify(t.reasons)}`;
  return t;
}

/**
 * Gespeichertes Beispielbild (Suchbereich) zurück an seine Stelle in einem 1920x1080-Bild. crops: mögliche
 * Ausschnitte (layout.SAVED_CROPS), erkannt an der Größe.
 */
export async function screenFromCrop(panel, crops) {
  const meta = await sharp(panel).metadata();
  const at = crops.find((b) => b[2] === meta.width && b[3] === meta.height);
  if (!at) throw new Error(`${panel}: unbekannte Ausschnittgröße ${meta.width}x${meta.height}`);
  return sharp({ create: { width: 1920, height: 1080, channels: 3, background: '#787878' } })
    .composite([{ input: panel, left: at[0], top: at[1] }])
    .png()
    .toBuffer();
}

/** Screenshot um die Bildmitte skalieren (so ändert sich das HUD mit dem FOV), wieder auf 1920x1080. */
export async function zoomScreen(buf, k) {
  const [w, h] = [Math.round(1920 * k), Math.round(1080 * k)];
  const big = await sharp(buf).resize(w, h, { kernel: 'lanczos3' }).png().toBuffer();
  if (k >= 1) return sharp(big).extract({ left: Math.round((w - 1920) / 2), top: Math.round((h - 1080) / 2), width: 1920, height: 1080 }).png().toBuffer();
  return sharp({ create: { width: 1920, height: 1080, channels: 3, background: '#787878' } })
    .composite([{ input: big, left: Math.round((1920 - w) / 2), top: Math.round((1080 - h) / 2) }])
    .png()
    .toBuffer();
}
