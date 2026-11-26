// Mining Companion: Scan eingeben, Loadout wählen, Ergebnis wie Bedrock. Rechnet auf dem PC (POST /api/mining/calc).

const STYLE = `
.mn { display: grid; gap: 16px; }
.mn [hidden] { display: none !important; } /* sonst überschreibt display:grid das hidden-Attribut */
.mn-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.mn-head h2 { margin: 0; }
.mn-head .grow { flex: 1; }
.mn select, .mn input { font: inherit; color: var(--text); background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; min-width: 0; }
.mn button { font: inherit; color: var(--text); background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; cursor: pointer; }
.mn button.primary { background: var(--accent); color: #1a1303; border-color: var(--accent); font-weight: 600; }
.mn button.link { background: none; border: none; color: var(--muted); padding: 4px 6px; }
.mn label, .mn .mn-field { display: grid; gap: 4px; align-content: start; font-size: 13px; color: var(--muted); }
.mn input[aria-invalid="true"] { border-color: var(--bad); }
.mn-fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
.mn-seg { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.mn-seg button { border: none; border-radius: 0; padding: 6px 10px; font-size: 13px; background: var(--bg); }
.mn-seg button.on[data-v="white"] { background: #e6e9f5; color: #0b1020; }
.mn-seg button.on[data-v="green"] { background: var(--ok); color: #04150d; }
.mn-seg button.on[data-v="red"] { background: var(--bad); color: #1b0505; }
.mn-parts { display: grid; gap: 8px; }
.mn-part { display: grid; grid-template-columns: 80px 1fr 80px 32px; gap: 8px; align-items: center; }
.mn-part input, .mn-part select { width: 100%; }
.mn-sub { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin: 4px 0 8px; }
.mn-sub h3 { margin: 0; font-size: 15px; }
.mn-result { background: #070a14; border: 1px solid var(--line); border-radius: 12px; padding: 16px; display: grid; gap: 10px; }
.mn-big { font-size: 34px; font-weight: 700; color: var(--accent); line-height: 1; }
.mn-big small { font-size: 14px; color: var(--muted); font-weight: 400; margin-left: 6px; }
.mn-stats { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 14px; }
.mn-stats b { color: var(--muted); font-weight: 600; margin-right: 4px; }
.mn-ores { width: 100%; border-collapse: collapse; font-size: 14px; }
.mn-ores td { padding: 2px 8px 2px 0; }
.mn-ores td.num { text-align: right; font-variant-numeric: tabular-nums; }
.mn-ores tr.inert { color: var(--muted); }
.mn-verdict { font-weight: 700; letter-spacing: 0.02em; font-size: 16px; }
.mn-verdict.ok { color: var(--ok); }
.mn-verdict.warn { color: var(--accent); }
.mn-verdict.bad { color: var(--bad); }
.mn-line { font-size: 15px; }
.mn-muted { color: var(--muted); font-size: 13px; }
.mn-note { background: rgba(242, 169, 59, 0.12); border: 1px solid var(--accent); border-radius: 8px; padding: 8px 10px; font-size: 13px; }
.mn-error { background: rgba(239, 91, 91, 0.15); border: 1px solid var(--bad); border-radius: 8px; padding: 8px 10px; }
.mn-editor { display: grid; gap: 12px; }
.mn-actions { display: flex; flex-wrap: wrap; gap: 8px; }
@media (max-width: 520px) { .mn-part { grid-template-columns: 64px 1fr 64px 28px; } .mn-big { font-size: 28px; } }
`;

const SCAN_KEY = 'bh-mining-scan';
const OPTIONS_KEY = 'bh-mining-options';

const storage = {
  load(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key) || 'null');
      return v ?? fallback;
    } catch {
      return fallback;
    }
  },
  save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* Speicher nicht verfügbar */
    }
  },
};

const emptyScan = () => ({
  mass: '',
  resistance: '',
  resColor: 'white',
  instability: '',
  instColor: 'white',
  scu: '',
  gadget: '',
  parts: [{ pct: '', ore: '', quality: '' }],
});

// ---- Zahlen aus der Eingabe (HUD-Schreibweisen erlaubt) ----

/** Ganze Zahl: "4,627" / "4.627" / "4627" -> 4627 (Tausendertrennzeichen werden ignoriert). */
function parseInt0(s) {
  const t = String(s).replace(/[\s.,']/g, '');
  return /^\d+$/.test(t) ? Number(t) : null;
}

/** Dezimalzahl: Komma oder Punkt als Dezimaltrennzeichen, "%" am Ende (auch mit Leerzeichen) erlaubt. */
function parseDec(s) {
  const t = String(s).replace(/\s*%\s*$/, '').trim().replace(',', '.');
  return t !== '' && /^\d*\.?\d+$/.test(t) ? Number(t) : null;
}

/** SCU wie im HUD: "5.54", "901.80m" (Milli) -> 0.9018. */
function parseScu(s) {
  const t = String(s).trim().toLowerCase().replace(/\s*scu$/, '');
  const milli = t.endsWith('m');
  const v = parseDec(milli ? t.slice(0, -1) : t);
  return v == null ? null : milli ? v / 1000 : v;
}

const fmtInt = (n) => Math.round(n).toLocaleString('de-DE');
const fmtDec = (n, d = 2) => n.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}

export async function mount(root, api) {
  const style = el('style', {}, STYLE);
  document.head.append(style);

  let data;
  let store;
  try {
    [data, store] = await Promise.all([api.get('/api/mining/data'), api.get('/api/mining/loadouts')]);
  } catch (err) {
    root.append(el('p', { class: 'state-failed' }, `Mining-Daten nicht ladbar: ${err.message}`));
    return () => style.remove();
  }

  let scan = { ...emptyScan(), ...storage.load(SCAN_KEY, {}) };
  let options = { ...data.defaults, ...storage.load(OPTIONS_KEY, {}) };
  let editing = null; // Kopie des Loadouts im Editor
  let timer = null;
  let seq = 0;
  let ignoredParts = 0;

  const byId = (list, id) => list.find((x) => x.id === id);
  const active = () => byId(store.loadouts, store.activeId) ?? store.loadouts[0];

  // ---------- Grundgerüst ----------
  const loadoutSelect = el('select', { 'aria-label': 'Loadout' });
  const head = el(
    'div',
    { class: 'mn-head' },
    el('h2', {}, 'Mining'),
    el('span', { class: 'mn-muted grow' }, `Spieldaten ${data.build.replace(/-LIVE.*/, '')}`),
    loadoutSelect,
    el('button', { onclick: () => openEditor(active()) }, 'Loadout bearbeiten'),
  );
  const scanCard = el('div', { class: 'card' });
  const resultBox = el('div', { class: 'mn-result' });
  const editorCard = el('div', { class: 'card mn-editor', hidden: true });
  root.append(el('div', { class: 'mn' }, head, scanCard, resultBox, editorCard));

  loadoutSelect.addEventListener('change', async () => {
    const previous = store.activeId;
    try {
      await persist({ ...store, activeId: loadoutSelect.value });
    } catch (err) {
      if (err.status !== 409) store.activeId = previous; // bei 409 gilt der geladene aktuelle Stand
      renderLoadoutSelect();
      resultBox.replaceChildren(el('p', { class: 'mn-error' }, err.message));
      return;
    }
    schedule();
  });

  function renderLoadoutSelect() {
    loadoutSelect.replaceChildren(...store.loadouts.map((l) => el('option', { value: l.id, selected: l.id === store.activeId }, l.name)));
  }

  // ---------- Scan-Eingabe ----------
  function segmented(value, onPick, name) {
    const seg = el('div', { class: 'mn-seg', role: 'group', 'aria-label': name });
    for (const [v, label] of [['white', 'Weiß'], ['green', 'Grün'], ['red', 'Rot']]) {
      seg.append(
        el('button', {
          type: 'button',
          'data-v': v,
          class: v === value ? 'on' : '',
          'aria-pressed': String(v === value),
          onclick: () => onPick(v),
        }, label),
      );
    }
    return seg;
  }

  /** Beschriftetes Feld. Zusatz (z. B. Farbschalter) steht außerhalb des Labels, damit Screenreader sauber vorlesen. */
  function field(label, input, extra) {
    if (!extra) return el('label', {}, label, input);
    return el('div', { class: 'mn-field' }, el('label', {}, label, input), extra);
  }

  function renderScan() {
    const set = (key) => (e) => {
      scan[key] = e.target.value;
      changed();
    };
    // Ungültige Eingaben rot markieren statt still zu ignorieren
    const parsers = { mass: parseInt0, resistance: parseDec, instability: parseDec, scu: parseScu };
    const num = (key, placeholder, mode = 'decimal') => {
      const input = el('input', { value: scan[key], placeholder, inputmode: mode, autocomplete: 'off' });
      const mark = () => input.setAttribute('aria-invalid', String(input.value.trim() !== '' && parsers[key](input.value) == null));
      input.addEventListener('input', (e) => {
        set(key)(e);
        mark();
      });
      mark();
      return input;
    };

    const gadgetSelect = el(
      'select',
      { onchange: set('gadget') },
      el('option', { value: '' }, 'keins'),
      data.gadgets.map((g) => el('option', { value: g.id, selected: g.id === scan.gadget }, g.name)),
    );

    const fields = el(
      'div',
      { class: 'mn-fields' },
      field('Masse (kg)', num('mass', 'z. B. 4627', 'numeric')),
      field('Resistenz (%)', num('resistance', 'z. B. 56'), segmented(scan.resColor, (v) => { scan.resColor = v; renderScan(); changed(); }, 'Farbe der Resistenz')),
      field('Instabilität', num('instability', 'z. B. 64,16'), segmented(scan.instColor, (v) => { scan.instColor = v; renderScan(); changed(); }, 'Farbe der Instabilität')),
      // Text-Tastatur: Das HUD zeigt kleine Mengen als "901.80m SCU" (Milli), das "m" braucht Buchstaben
      field('Gesamt-SCU (optional)', num('scu', 'z. B. 5,54 oder 901.80m', 'text')),
      field('Gadget schon am Stein', gadgetSelect),
    );

    const parts = el('div', { class: 'mn-parts' });
    scan.parts.forEach((p, i) => {
      const setPart = (key) => (e) => {
        scan.parts[i][key] = e.target.value;
        changed();
      };
      parts.append(
        el(
          'div',
          { class: 'mn-part' },
          el('input', { value: p.pct, placeholder: '%', inputmode: 'decimal', 'aria-label': 'Anteil in %', oninput: setPart('pct') }),
          el(
            'select',
            { 'aria-label': 'Erz', onchange: setPart('ore') },
            el('option', { value: '' }, 'Erz wählen'),
            el('option', { value: 'inert', selected: p.ore === 'inert' }, 'Inert (taubes Gestein)'),
            data.ores.map((o) => el('option', { value: o.id, selected: o.id === p.ore }, `${o.name} (${o.form === 'RAW' ? 'Raw' : 'Ore'})`)),
          ),
          el('input', { value: p.quality, placeholder: 'Qual.', inputmode: 'numeric', 'aria-label': 'Qualität', oninput: setPart('quality') }),
          el('button', {
            type: 'button',
            class: 'link',
            title: 'Zeile entfernen',
            'aria-label': 'Zeile entfernen',
            onclick: () => {
              scan.parts.splice(i, 1);
              if (!scan.parts.length) scan.parts.push({ pct: '', ore: '', quality: '' });
              renderScan();
              changed();
            },
          }, '✕'),
        ),
      );
    });

    scanCard.replaceChildren(
      el('div', { class: 'mn-sub' }, el('h3', {}, 'Scan'), el('button', { type: 'button', class: 'link', onclick: () => { scan = emptyScan(); renderScan(); changed(); } }, 'Zurücksetzen')),
      fields,
      el('div', { class: 'mn-sub' }, el('h3', {}, 'Zusammensetzung (optional)'), el('button', { type: 'button', class: 'link', onclick: () => { scan.parts.push({ pct: '', ore: '', quality: '' }); renderScan(); } }, '+ Zeile')),
      parts,
      el('p', { class: 'mn-muted' }, 'Farbe wie im Spiel: Weiß = Wert des Steins. Grün/Rot = Wert enthält schon Laser und Module des gewählten Loadouts sowie das Gadget, falls oben eins angegeben ist.'),
    );
  }

  // ---------- Rechnen ----------
  function buildRequest() {
    const mass = parseInt0(scan.mass);
    const resistance = parseDec(scan.resistance);
    const instability = parseDec(scan.instability);
    if (mass == null || resistance == null || instability == null) return { missing: true };
    ignoredParts = scan.parts.filter((p) => (p.ore || p.pct !== '') && (!p.ore || parseDec(p.pct) == null)).length;
    const parts = scan.parts
      .filter((p) => p.ore && parseDec(p.pct) != null)
      .map((p) => ({ oreId: p.ore === 'inert' ? null : p.ore, pct: parseDec(p.pct), quality: parseInt0(p.quality) }));
    const l = active();
    return {
      body: {
        scan: {
          mass,
          resistance,
          resistanceColored: scan.resColor !== 'white',
          instability,
          instabilityColored: scan.instColor !== 'white',
          scu: scan.scu === '' ? null : parseScu(scan.scu),
          parts,
          gadgetAttached: scan.gadget || null,
        },
        loadout: { laserId: l.laserId, moduleIds: l.moduleIds },
        options,
      },
    };
  }

  function changed() {
    storage.save(SCAN_KEY, scan);
    schedule();
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(run, 200);
  }

  async function run() {
    // Zuerst hochzählen: Eine noch laufende ältere Anfrage darf das Ergebnis danach nicht mehr überschreiben
    const mine = ++seq;
    const req = buildRequest();
    if (req.missing) {
      resultBox.replaceChildren(el('p', { class: 'mn-muted' }, 'Masse, Resistenz und Instabilität eingeben, dann erscheint das Ergebnis.'));
      return;
    }
    try {
      const result = await api.post('/api/mining/calc', req.body);
      if (mine === seq) renderResult(result);
    } catch (err) {
      if (mine === seq) resultBox.replaceChildren(el('p', { class: 'mn-error' }, err.message));
    }
  }

  // ---------- Ergebnis ----------
  function verdict(a) {
    switch (a.status) {
      case 'ok':
        return ['ok', 'SCHAFFBAR'];
      case 'slow':
        return ['warn', 'SCHAFFBAR – LÄDT LANGSAM'];
      case 'edge':
        return ['warn', 'GRENZFALL – nur mit voller Leistung, vielleicht'];
      case 'too-strong':
        return ['warn', `LASER ZU STARK – ca. ${a.backoffM} m Abstand halten`];
      default:
        return ['bad', 'NICHT SCHAFFBAR'];
    }
  }

  const bandText = (a) => (a.band[0] === a.band[1] ? `${a.band[0]} %` : `${a.band[0]}–${a.band[1]} %`);

  function powerLine(a, r) {
    if (a.status === 'impossible') return `Benötigt ${fmtInt(a.share * 100)} % der Laserleistung`;
    if (a.status === 'edge') return `Benötigt rechnerisch ${fmtInt(a.share * 100)} %, also volle Leistung (100 %)`;
    if (a.status === 'too-strong') {
      return `Schon die Mindestleistung (${Math.round(r.setup.laser.throttleMin * 100)} %) ist zu viel – ab ca. ${a.backoffM} m Abstand passt es`;
    }
    return `${bandText(a)} Laserleistung halten die Ladung stabil`;
  }

  function renderResult(r) {
    const a = r.baseline;
    const mainPart = [...r.rock.parts].filter((p) => p.oreId).sort((x, y) => y.pct - x.pct)[0];
    const [cls, text] = verdict(a);
    const nodes = [];

    nodes.push(
      el('div', { class: 'mn-big' }, fmtInt(r.rock.mass), el('small', {}, `kg${mainPart ? ' · ' + mainPart.name.toUpperCase() : ''}`)),
      el(
        'div',
        { class: 'mn-stats' },
        el('span', {}, el('b', {}, 'RES'), `${fmtDec(a.resistancePct, 1)} %`),
        el('span', {}, el('b', {}, 'INST'), fmtDec(a.instability, 2)),
        r.rock.scu != null ? el('span', {}, el('b', {}, 'SCU'), fmtDec(r.rock.scu, 2)) : null,
        el('span', { class: 'mn-muted' }, `Stein: RES ${fmtDec(r.rock.resistanceOwn, 1)} %, INST ${fmtDec(r.rock.instabilityOwn, 2)}`),
      ),
    );

    if (r.rock.parts.length) {
      nodes.push(
        el(
          'table',
          { class: 'mn-ores' },
          r.rock.parts.map((p) =>
            el(
              'tr',
              { class: p.oreId ? '' : 'inert' },
              el('td', {}, p.name),
              el('td', { class: 'num' }, `${fmtDec(p.pct)} %`),
              el('td', { class: 'num' }, p.scu != null ? `${fmtDec(p.scu)} SCU` : ''),
              el('td', { class: 'num' }, p.quality != null && p.oreId ? `Q ${p.quality}` : ''),
            ),
          ),
        ),
      );
    }

    // Nur das Urteil vorlesen lassen, nicht das ganze Ergebnis nach jedem Tastendruck
    nodes.push(el('div', { class: `mn-verdict ${cls}`, 'aria-live': 'polite' }, text), el('div', { class: 'mn-line' }, powerLine(a, r)));

    // Aktive Module nur zeigen, wenn es ohne sie nicht gut geht (sonst nur Ablenkung)
    for (const v of a.status === 'ok' ? [] : r.variants) {
      const [vc, vt] = verdict(v.assessment);
      nodes.push(el('div', { class: 'mn-line' }, `${v.label[0].toUpperCase()}${v.label.slice(1)}: `, el('span', { class: `mn-verdict ${vc}` }, vt), ' · ', powerLine(v.assessment, r)));
    }

    const g = r.gadgets;
    const gadgetEffect = (o) =>
      `Resistenz ${fmtDec(a.resistancePct, 1)} → ${fmtDec(o.assessment.resistancePct, 1)} % · Instabilität ${fmtDec(a.instability, 2)} → ${fmtDec(o.assessment.instability, 2)}`;
    if (g.kind === 'attached') nodes.push(el('div', { class: 'mn-muted' }, `Gadget am Stein: ${r.rock.gadgetAttached.name}`));
    else if (g.kind === 'required') nodes.push(el('div', { class: 'mn-line' }, el('b', {}, `Gadget nötig: ${g.best.gadget.name}`), ` – dann ${g.best.assessment.status === 'too-strong' ? `Laser zu stark, ca. ${g.best.assessment.backoffM} m Abstand` : bandText(g.best.assessment)}`), el('div', { class: 'mn-muted' }, gadgetEffect(g.best)));
    else if (g.kind === 'recommended') nodes.push(el('div', { class: 'mn-line' }, el('b', {}, `Empfohlen: ${g.best.gadget.name}`), ` – Laserleistung ${fmtInt(a.share * 100)} → ${fmtInt(g.best.assessment.share * 100)} %`), el('div', { class: 'mn-muted' }, gadgetEffect(g.best)));
    else if (g.kind === 'optional' && g.best) nodes.push(el('div', { class: 'mn-muted' }, `Optional: ${g.best.gadget.name} · ${gadgetEffect(g.best)}`));
    else if (g.kind === 'none-helps') nodes.push(el('div', { class: 'mn-line mn-verdict bad' }, 'Kein Gadget hilft bei diesem Stein'));

    for (const n of r.notes) nodes.push(el('div', { class: 'mn-note' }, n));
    if (ignoredParts) nodes.push(el('div', { class: 'mn-note' }, `${ignoredParts} Zeile(n) der Zusammensetzung unvollständig (Erz oder Anteil fehlt) und nicht berücksichtigt.`));

    const mods = [...r.setup.passive, ...r.setup.active];
    nodes.push(
      el('div', { class: 'mn-muted' }, `${active().name}: ${r.setup.laser.name}${mods.length ? ' · ' + mods.join(', ') : ''} · max. ${fmtInt(a.maxMass)} kg bei dieser Resistenz`),
      el(
        'div',
        { class: 'mn-muted' },
        `Rechenmodell: ${r.options.resistanceExponent === 1 ? 'linear' : `Kurve ${r.options.resistanceExponent} (wie Bedrock)`} `,
        el('button', {
          type: 'button',
          class: 'link',
          onclick: () => {
            options = { ...options, resistanceExponent: options.resistanceExponent === 1 ? data.defaults.resistanceExponent : 1 };
            storage.save(OPTIONS_KEY, options);
            schedule();
          },
        }, 'umschalten'),
      ),
    );
    resultBox.replaceChildren(...nodes);
  }

  // ---------- Loadout-Editor ----------
  /**
   * Speichert eine neue Fassung der Loadouts. Bei einem Konflikt (anderes Gerät hat inzwischen gespeichert)
   * wird der aktuelle Stand übernommen und der Fehler weitergereicht.
   */
  async function persist(next) {
    try {
      store = await api.put('/api/mining/loadouts', { ...next, revision: store.revision });
      renderLoadoutSelect();
    } catch (err) {
      if (err.status === 409 && err.body?.current) {
        store = err.body.current;
        renderLoadoutSelect();
        schedule();
      }
      throw err;
    }
  }

  function openEditor(loadout) {
    editing = structuredClone(loadout);
    renderEditor();
    editorCard.hidden = false;
    editorCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderEditor() {
    const ship = byId(data.ships, editing.shipId) ?? data.ships[0];
    const size = ship.heads[0].size;
    const fits = (l) => l.size === size && l.requiredTags.every((t) => t === 'miningMount' || t === ship.id);
    const laser = byId(data.lasers, editing.laserId);
    editing.moduleIds = editing.moduleIds.slice(0, laser.slots);
    const message = el('p', { class: 'mn-muted' });

    const slots = Array.from({ length: laser.slots }, (_, i) =>
      field(
        `Modul-Slot ${i + 1}`,
        el(
          'select',
          {
            onchange: (e) => {
              editing.moduleIds[i] = e.target.value;
              editing.moduleIds = editing.moduleIds.filter(Boolean);
              renderEditor();
            },
          },
          el('option', { value: '' }, 'leer'),
          el('optgroup', { label: 'Passiv' }, data.modules.filter((m) => !m.active).map((m) => el('option', { value: m.id, selected: editing.moduleIds[i] === m.id }, m.name))),
          el('optgroup', { label: 'Aktiv' }, data.modules.filter((m) => m.active).map((m) => el('option', { value: m.id, selected: editing.moduleIds[i] === m.id }, `${m.name} (${m.uses}×, ${m.durationS} s)`))),
        ),
      ),
    );

    const save = async (asNew) => {
      const entry = { ...editing, name: editing.name.trim() || 'Loadout' };
      if (asNew) entry.id = crypto.randomUUID?.() ?? String(Date.now());
      const next = structuredClone(store);
      const i = next.loadouts.findIndex((l) => l.id === entry.id);
      if (i >= 0) next.loadouts[i] = entry;
      else next.loadouts.push(entry);
      next.activeId = entry.id;
      try {
        await persist(next);
        editorCard.hidden = true;
        schedule();
      } catch (err) {
        message.textContent = err.message;
      }
    };

    const remove = async () => {
      if (store.loadouts.length <= 1) {
        message.textContent = 'Das letzte Loadout kann nicht gelöscht werden.';
        return;
      }
      const next = { ...store, loadouts: store.loadouts.filter((l) => l.id !== editing.id) };
      try {
        await persist(next);
        editorCard.hidden = true;
        schedule();
      } catch (err) {
        message.textContent = err.message;
      }
    };

    const fmtMod = (v) => (v > 0 ? `+${v}` : `${v}`);
    editorCard.replaceChildren(
      el('div', { class: 'mn-sub' }, el('h3', {}, 'Loadout'), el('button', { type: 'button', class: 'link', onclick: () => (editorCard.hidden = true) }, 'Schließen')),
      el(
        'div',
        { class: 'mn-fields' },
        field('Name', el('input', { value: editing.name, maxlength: 60, oninput: (e) => (editing.name = e.target.value) })),
        field('Schiff', el('select', { onchange: (e) => { editing.shipId = e.target.value; editing.laserId = byId(data.ships, e.target.value).heads[0].stockLaser; editing.moduleIds = []; renderEditor(); } }, data.ships.map((s) => el('option', { value: s.id, selected: s.id === ship.id }, s.name)))),
        field('Laserkopf', el('select', { onchange: (e) => { editing.laserId = e.target.value; renderEditor(); } }, data.lasers.filter(fits).map((l) => el('option', { value: l.id, selected: l.id === laser.id }, l.name)))),
        ...slots,
      ),
      el('p', { class: 'mn-muted' }, `${laser.name}: ${fmtInt(laser.power)} Leistung, min. ${Math.round(laser.throttleMin * 100)} %, Resistenz ${fmtMod(laser.mods.resistance)} %, Instabilität ${fmtMod(laser.mods.instability)} %, Fenster ${fmtMod(laser.mods.window)} %, ${laser.slots} Slot(s), optimal bis ${laser.rangeFull} m`),
      store.staleCount ? el('p', { class: 'mn-note' }, `${store.staleCount} gespeicherte(s) Loadout(s) passen nicht mehr zu den aktuellen Spieldaten und sind ausgeblendet (nicht gelöscht).`) : null,
      el('div', { class: 'mn-actions' }, el('button', { type: 'button', class: 'primary', onclick: () => save(false) }, 'Speichern'), el('button', { type: 'button', onclick: () => save(true) }, 'Als neues speichern'), el('button', { type: 'button', onclick: remove }, 'Löschen')),
      message,
    );
  }

  renderLoadoutSelect();
  renderScan();
  run();

  return () => {
    clearTimeout(timer);
    style.remove();
  };
}
