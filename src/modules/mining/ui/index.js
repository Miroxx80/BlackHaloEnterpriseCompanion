// Mining Companion: Scan eingeben, Loadout wählen, Ergebnis wie Bedrock. Rechnet auf dem PC (POST /api/mining/calc).
// Aussehen: gemeinsame Bausteine aus shell.css (Design "Industrial"), hier nur wenige Ergänzungen mit Präfix "mn-".
import { el, icon, chip, pageHead, button, notice, fmtInt, fmtDec } from '/ui.js';

const STYLE = `
.mn .page-actions .select { min-width: 220px; }
.mn .verdict { cursor: default; }
.mn .result { scroll-margin-top: 20px; }
.mn-editor { margin-bottom: 20px; scroll-margin-top: 20px; }
.mn-editor .panel-body { display: grid; gap: 16px; }
.mn-editor .fields { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
.mn-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.mn-dim { margin: 0; font-size: var(--fs-s); color: var(--text-dim); }
.mn-msg:empty { display: none; }
.mn-msg { margin: 0; font-size: var(--fs-s); color: var(--bad); }
.mn-empty { margin: 0; padding: 18px; color: var(--text-dim); }
.mn-sync { margin-left: auto; font-size: var(--fs-xs); color: var(--text-faint); }
.mn-sync.bad { color: var(--bad); }
.mn-variants { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; font-size: var(--fs-s); color: var(--text-dim); }
.mn-variants b { font-family: var(--font-head); letter-spacing: .06em; text-transform: uppercase; font-weight: 700; }
.mn-c-ok { color: var(--ok); }
.mn-c-warn { color: var(--warn); }
.mn-c-bad { color: var(--bad); }
.mn .advice.mn-bad .ic, .mn .advice.mn-bad strong { color: var(--bad); }
.mn-compbar { display: flex; height: 8px; margin-top: 12px; background: var(--s3); overflow: hidden; }
.mn-compbar > i { flex: none; height: 100%; background: var(--oc); box-shadow: inset -1px 0 0 var(--bg-deep); }
.mn-sw { display: inline-block; width: 8px; height: 8px; margin-right: 8px; background: var(--oc); vertical-align: 1px; }
.mn-inert { --oc: repeating-linear-gradient(-45deg, var(--line-strong) 0 3px, var(--s3) 3px 6px); }
.mn-compbar > i.mn-inert, .mn-sw.mn-inert { background: var(--oc); }
@media (max-width: 520px) {
  .mn .page-actions .select { min-width: 0; }
  .mn .result, .mn-editor { scroll-margin-top: 72px; }
}
`;

// Erzfarben für den Balken: aus der Palette abgeleitet (Haupterz bekommt Amber, Inert bleibt grau gestreift)
const ORE_COLORS = [
  'var(--amber)',
  'var(--ok)',
  'var(--warn)',
  'var(--focus)',
  'var(--amber-lo)',
  'color-mix(in srgb, var(--ok) 55%, var(--warn))',
  'color-mix(in srgb, var(--amber) 55%, var(--bad))',
  'var(--text-dim)',
];

/** Früher pro Gerät gespeicherter Scan; wird einmalig auf den Server übernommen, dann gelöscht. */
const LEGACY_SCAN_KEY = 'bh-mining-scan';
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
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* Speicher nicht verfügbar */
    }
  },
};

const isEmptyDraft = (d) =>
  !d.mass && !d.resistance && !d.instability && !d.scu && !d.gadget && d.parts.every((p) => !p.pct && !p.ore && !p.quality);

const emptyPart = () => ({ pct: '', ore: '', quality: '' });
const emptyScan = () => ({
  mass: '',
  resistance: '',
  resColor: 'white',
  instability: '',
  instColor: 'white',
  scu: '',
  gadget: '',
  parts: [emptyPart()],
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

/** Zahl mit Vorzeichen (Crafting-Bonus): "10,5", "+10.5", "-5". Leer = 0. */
function parseSigned(s) {
  const t = String(s).replace(/\s*%\s*$/, '').trim().replace(',', '.');
  if (t === '') return 0;
  return /^[+-]?\d*\.?\d+$/.test(t) ? Number(t) : null;
}

/** aria-invalid setzen: nicht leer, aber nicht lesbar. */
function markInvalid(input, parse) {
  input.setAttribute('aria-invalid', String(input.value.trim() !== '' && parse(input.value) == null));
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const fmtExp = (k) => String(k).replace('.', ',');

export async function mount(root, api) {
  const style = el('style', {}, STYLE);
  document.head.append(style);
  root.classList.add('mn');

  let data;
  let store;
  let shared; // { revision, scan } vom Server
  try {
    [data, store, shared] = await Promise.all([api.get('/api/mining/data'), api.get('/api/mining/loadouts'), api.get('/api/mining/scan')]);
  } catch (err) {
    root.append(pageHead(api, { title: 'Mining' }), notice('alert', `Mining-Daten nicht ladbar: ${err.message}`));
    return () => style.remove();
  }

  // Der aktuelle Scan liegt auf dem PC-Server und ist auf allen Geräten gleich (PC-Fenster, Handy, später OCR).
  let scan = structuredClone(shared.scan);
  // Kennung dieses Geräts/Fensters, damit eigene Änderungen beim Verteilen nicht doppelt ankommen.
  // (crypto.randomUUID gibt es im LAN über http nicht, daher Math.random)
  const origin = `ui-${Math.random().toString(36).slice(2, 12)}`;
  let pending = []; // noch nicht gesendete Änderungen
  let inflight = false;
  let flushTimer = null;
  let retryTimer = null;
  let options = { ...data.defaults, ...storage.load(OPTIONS_KEY, {}) };
  let editing = null; // Kopie des Loadouts im Editor
  let timer = null;
  let seq = 0;
  let ignoredParts = 0;
  let lastSpoken = '';

  const byId = (list, id) => list.find((x) => x.id === id);
  const active = () => byId(store.loadouts, store.activeId) ?? store.loadouts[0];
  const oreById = new Map(data.ores.map((o) => [o.id, o]));
  const modelName = () => (options.resistanceExponent === 1 ? 'linear' : 'Bedrock-Kurve');

  // ---------- Grundgerüst ----------
  const loadoutSelect = el('select', { class: 'select', 'aria-label': 'Loadout' });
  const editButton = el(
    'button',
    { type: 'button', class: 'btn', 'aria-label': 'Loadout bearbeiten', onclick: () => openEditor(active()) },
    icon('wrench', 's'),
    el('span', { class: 'lbl' }, 'Loadout bearbeiten'),
  );
  const modelChip = chip('Modell', modelName());
  const head = pageHead(api, {
    title: 'Mining',
    meta: [chip('Spieldaten', data.build.replace(/-LIVE.*/, '')), modelChip],
    actions: [loadoutSelect, editButton],
  });

  const scanPanel = el('div', { class: 'panel' });
  const resultContent = el('div', {});
  // Nur das Urteil vorlesen lassen (feste Live-Region, nicht das ganze Ergebnis nach jedem Tastendruck)
  const spoken = el('div', { class: 'sr-only', 'aria-live': 'polite' });
  const resultPanel = el(
    'section',
    { class: 'panel result', 'aria-labelledby': 'mn-h-res' },
    el('div', { class: 'panel-head' }, el('h2', { id: 'mn-h-res' }, el('span', { class: 'idx' }, '03'), 'Ergebnis'), el('span', { class: 'live' }, el('i', {}), 'LIVE')),
    resultContent,
    spoken,
  );
  const editorPanel = el('section', { class: 'panel mn-editor', 'aria-labelledby': 'mn-h-editor', hidden: true });

  // Handy: Kurz-Urteil unten, solange das Urteil nicht im Bild ist
  const peekWord = el('b', {});
  const peekText = el('span', {});
  const peek = el(
    'button',
    {
      type: 'button',
      class: 'peek hide',
      'aria-label': 'Zum Ergebnis springen',
      hidden: true,
      onclick: () => resultPanel.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    },
    peekWord,
    peekText,
    icon('up', 's'),
  );
  const observer = 'IntersectionObserver' in window ? new IntersectionObserver(([e]) => peek.classList.toggle('hide', e.isIntersecting), { threshold: 0.15 }) : null;

  root.append(head, editorPanel, el('div', { class: 'mining-grid' }, scanPanel, resultPanel), peek);

  loadoutSelect.addEventListener('change', async () => {
    const previous = store.activeId;
    try {
      await persist({ ...store, activeId: loadoutSelect.value });
    } catch (err) {
      if (err.status !== 409) store.activeId = previous; // bei 409 gilt der geladene aktuelle Stand
      renderLoadoutSelect();
      showResultMessage(notice('alert', err.message));
      return;
    }
    schedule();
  });

  function renderLoadoutSelect() {
    loadoutSelect.replaceChildren(...store.loadouts.map((l) => el('option', { value: l.id, selected: l.id === store.activeId }, l.name)));
  }

  // ---------- Scan-Eingabe ----------
  function segmented(key, name) {
    const seg = el('div', { class: 'seg', role: 'group', 'aria-label': name });
    const buttons = [['white', 'Weiß'], ['green', 'Grün'], ['red', 'Rot']].map(([v, label]) =>
      el(
        'button',
        {
          type: 'button',
          class: 'seg-btn',
          'data-v': v,
          'aria-pressed': String(v === scan[key]),
          'data-path': `${key}:${v}`,
          onclick: () => {
            scan[key] = v;
            // An Ort und Stelle umschalten, damit der Fokus auf dem Knopf bleibt
            for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.v === v));
            queue({ op: 'set', field: key, value: v });
            changed();
          },
        },
        el('span', { class: 'swatch' }),
        label,
      ),
    );
    seg.append(...buttons);
    return seg;
  }

  const fieldLabel = (text, small, attrs = {}) => el(attrs.for ? 'label' : 'span', { class: 'field-label', ...attrs }, text, small ? el('small', {}, small) : null);
  const withUnit = (unit, input) => (unit ? el('span', { class: 'unit', 'data-unit': unit }, input) : input);

  function renderScan() {
    const set = (key) => (e) => {
      scan[key] = e.target.value;
      queue({ op: 'set', field: key, value: e.target.value });
      changed();
    };
    // Ungültige Eingaben rot markieren statt still zu ignorieren
    const parsers = { mass: parseInt0, resistance: parseDec, instability: parseDec, scu: parseScu };
    const num = (key, placeholder, mode = 'decimal', id) => {
      const input = el('input', { class: 'input', id, value: scan[key], placeholder, inputmode: mode, autocomplete: 'off', 'data-path': key });
      input.addEventListener('input', (e) => {
        set(key)(e);
        markInvalid(input, parsers[key]);
      });
      markInvalid(input, parsers[key]);
      return input;
    };

    const gadgetSelect = el(
      'select',
      { class: 'select', onchange: set('gadget'), 'data-path': 'gadget' },
      el('option', { value: '' }, 'keins'),
      data.gadgets.map((g) => el('option', { value: g.id, selected: g.id === scan.gadget }, g.name)),
    );

    // Farbschalter stehen außerhalb des Labels, damit Screenreader sauber vorlesen
    const fields = el(
      'div',
      { class: 'fields' },
      el('label', { class: 'field' }, fieldLabel('Masse'), withUnit('kg', num('mass', 'z. B. 4627', 'numeric'))),
      el(
        'div',
        { class: 'field' },
        fieldLabel('Resistenz', null, { for: 'mn-res' }),
        withUnit('%', num('resistance', 'z. B. 56', 'decimal', 'mn-res')),
        segmented('resColor', 'Farbe der Resistenz'),
      ),
      el(
        'div',
        { class: 'field' },
        fieldLabel('Instabilität', null, { for: 'mn-inst' }),
        num('instability', 'z. B. 64,16', 'decimal', 'mn-inst'),
        segmented('instColor', 'Farbe der Instabilität'),
      ),
      // Text-Tastatur: Das HUD zeigt kleine Mengen als "901.80m SCU" (Milli), das "m" braucht Buchstaben
      el('label', { class: 'field' }, fieldLabel('Gesamt-SCU', 'optional'), withUnit('SCU', num('scu', 'z. B. 5,54 oder 901.80m', 'text'))),
      el('label', { class: 'field span-2' }, fieldLabel('Gadget schon am Stein'), gadgetSelect),
    );

    const sumVal = el('span', { class: 'val' });
    const sumFill = el('i', {});
    const sumBox = el('div', { class: 'comp-sum' }, el('b', {}, 'Summe'), el('div', { class: 'bar', 'aria-hidden': 'true' }, sumFill), sumVal);
    const updateSum = () => {
      const values = scan.parts.map((p) => parseDec(p.pct)).filter((v) => v != null);
      const s = values.reduce((a, b) => a + b, 0);
      // Gleiche Grenzen wie der Rechenkern (Hinweis unter 98 % oder über 100,5 %)
      sumBox.classList.toggle('off', values.length > 0 && (s < 98 || s > 100.5));
      sumFill.style.setProperty('--w', `${Math.min(100, s)}%`);
      sumVal.textContent = `${fmtDec(s, 1)} %`;
    };

    const addButton = button('Zeile', {
      variant: 'ghost',
      iconName: 'plus',
      onclick: () => {
        if (scan.parts.length >= 12) return; // wie der Server
        scan.parts.push(emptyPart());
        queue({ op: 'addPart' });
        renderScan();
        scanPanel.querySelector('.comp-row:last-child .input')?.focus();
      },
    });
    addButton.setAttribute('aria-label', 'Zeile hinzufügen');

    const comp = el(
      'div',
      { class: 'comp' },
      el('div', { class: 'comp-row comp-headrow', 'aria-hidden': 'true' }, el('span', {}, 'Anteil %'), el('span', {}, 'Erz'), el('span', {}, 'Qualität'), el('span', {})),
    );
    scan.parts.forEach((p, i) => {
      const setPart = (key, parse) => (e) => {
        scan.parts[i][key] = e.target.value;
        queue({ op: 'part', index: i, field: key, value: e.target.value });
        if (parse) markInvalid(e.target, parse);
        if (key === 'pct') updateSum();
        changed();
      };
      const pct = el('input', { class: 'input', value: p.pct, placeholder: '%', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Anteil in %', 'data-path': `parts.${i}.pct`, oninput: setPart('pct', parseDec) });
      const quality = el('input', { class: 'input', value: p.quality, placeholder: 'Qual.', inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Qualität', 'data-path': `parts.${i}.quality`, oninput: setPart('quality', parseInt0) });
      markInvalid(pct, parseDec);
      markInvalid(quality, parseInt0);
      comp.append(
        el(
          'div',
          { class: 'comp-row' },
          pct,
          el(
            'select',
            { class: 'select', 'aria-label': 'Erz', 'data-path': `parts.${i}.ore`, onchange: setPart('ore') },
            el('option', { value: '' }, 'Erz wählen'),
            el('option', { value: 'inert', selected: p.ore === 'inert' }, 'Inert (taubes Gestein)'),
            data.ores.map((o) => el('option', { value: o.id, selected: o.id === p.ore }, `${o.name} (${o.form === 'RAW' ? 'Raw' : 'Ore'})`)),
          ),
          quality,
          el(
            'button',
            {
              type: 'button',
              class: 'btn btn-ghost btn-icon',
              title: 'Zeile entfernen',
              'aria-label': 'Zeile entfernen',
              onclick: () => {
                scan.parts.splice(i, 1);
                if (!scan.parts.length) scan.parts.push(emptyPart());
                queue({ op: 'removePart', index: i });
                renderScan();
                changed();
                // Fokus nicht verlieren: auf die nächste Zeile, sonst auf "+ Zeile"
                const rows = scanPanel.querySelectorAll('.comp-row:not(.comp-headrow) .btn-icon');
                (rows[Math.min(i, rows.length - 1)] ?? scanPanel.querySelector('[aria-label="Zeile hinzufügen"]'))?.focus();
              },
            },
            icon('x', 's'),
          ),
        ),
      );
    });
    updateSum();

    const resetButton = button('Zurücksetzen', {
      variant: 'ghost',
      iconName: 'reset',
      onclick: () => {
        scan = emptyScan();
        queue({ op: 'reset' });
        renderScan();
        changed();
        scanPanel.querySelector('.input')?.focus();
      },
    });

    scanPanel.replaceChildren(
      el('div', { class: 'panel-head' }, el('h2', {}, el('span', { class: 'idx' }, '01'), 'Scan', el('span', { class: 'tag' }, 'auf allen Geräten gleich')), syncState, resetButton),
      el('div', { class: 'panel-body' }, fields),
      el('hr', { class: 'panel-sep' }),
      el('div', { class: 'panel-head' }, el('h2', {}, el('span', { class: 'idx' }, '02'), 'Zusammensetzung', el('span', { class: 'tag' }, 'optional')), addButton),
      el(
        'div',
        { class: 'panel-body' },
        comp,
        sumBox,
        el(
          'p',
          { class: 'help' },
          icon('info', 's'),
          el('span', {}, 'Farbe wie im Spiel: Weiß = Wert des Steins. Grün/Rot = Wert enthält schon Laser und Module des gewählten Loadouts sowie das Gadget, falls oben eins angegeben ist.'),
        ),
      ),
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
        loadout: { laserId: l.laserId, moduleIds: l.moduleIds, powerBonusPct: l.powerBonusPct ?? 0 },
        options,
      },
    };
  }

  function changed() {
    schedule();
  }

  // ---------- Abgleich mit dem Server ----------
  const syncState = el('span', { class: 'mn-sync', role: 'status' });
  function setSync(ok, text) {
    syncState.textContent = text ?? (ok ? '' : 'Nicht synchronisiert – neuer Versuch läuft');
    syncState.classList.toggle('bad', !ok);
  }

  /** Änderung merken und gebündelt senden. Mehrere Eingaben ins selbe Feld werden zusammengefasst. */
  function queue(op) {
    const last = pending[pending.length - 1];
    const sameField = last && last.op === op.op && last.field === op.field && last.index === op.index && (op.op === 'set' || op.op === 'part');
    if (sameField) pending[pending.length - 1] = op;
    else pending.push(op);
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 120);
  }

  async function flush() {
    if (inflight || !pending.length) return;
    inflight = true;
    const ops = pending;
    pending = [];
    try {
      const res = await api.post('/api/mining/scan', { ops, origin });
      setSync(true);
      shared = res;
      // Antwort ist der volle aktuelle Stand: holt auch verpasste Änderungen anderer Geräte nach
      if (!pending.length) adoptRemote(res.scan);
    } catch (err) {
      if (err.status === 400) {
        // Ungültig (z. B. Erz nach Daten-Update unbekannt): verwerfen und aktuellen Stand holen
        setSync(false, `Nicht übernommen: ${err.message}`);
        refreshShared();
      } else {
        pending = [...ops, ...pending];
        setSync(false);
        clearTimeout(retryTimer);
        retryTimer = setTimeout(flush, 2000);
      }
    } finally {
      inflight = false;
      if (pending.length) flush();
    }
  }

  /**
   * Stand von außen übernehmen (anderes Gerät, Serverantwort, später OCR).
   * Noch nicht gesendete eigene Eingaben bleiben erhalten, ebenso das Feld, in dem gerade getippt wird.
   */
  function adoptRemote(remote) {
    let next = structuredClone(remote);
    for (const op of pending) next = applyLocal(next, op);
    if (JSON.stringify(next) === JSON.stringify(scan)) return;
    const active = document.activeElement;
    const path = active && scanPanel.contains(active) ? active.dataset.path : null;
    const caret = path && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
    const typed = path && active.tagName === 'INPUT' ? active.value : null;
    scan = next;
    if (typed != null) setPath(scan, path, typed);
    renderScan();
    if (path) {
      const again = scanPanel.querySelector(`[data-path="${path}"]`);
      if (again) {
        again.focus();
        if (caret && again.setSelectionRange) {
          try { again.setSelectionRange(caret[0], caret[1]); } catch { /* nicht jedes Feld */ }
        }
      }
    }
    schedule();
  }

  /** Dieselben Befehle wie der Server, für die Anzeige noch nicht bestätigter Eingaben. */
  function applyLocal(d, op) {
    const n = structuredClone(d);
    if (op.op === 'set') n[op.field] = op.value;
    else if (op.op === 'part' && n.parts[op.index]) n.parts[op.index][op.field] = op.value;
    else if (op.op === 'addPart') n.parts.push(emptyPart());
    else if (op.op === 'removePart') { n.parts.splice(op.index, 1); if (!n.parts.length) n.parts.push(emptyPart()); }
    else if (op.op === 'reset') return emptyScan();
    else if (op.op === 'replace') return structuredClone(op.scan);
    return n;
  }

  function setPath(d, path, value) {
    const m = /^parts\.(\d+)\.(pct|ore|quality)$/.exec(path);
    if (m) { if (d.parts[+m[1]]) d.parts[+m[1]][m[2]] = value; }
    else if (path in d) d[path] = value;
  }

  async function refreshShared() {
    try {
      const [s, l] = await Promise.all([api.get('/api/mining/scan'), api.get('/api/mining/loadouts')]);
      shared = s;
      store = l;
      renderLoadoutSelect();
      if (!pending.length) adoptRemote(s.scan);
    } catch { /* nächster Versuch beim nächsten Ereignis */ }
  }

  // Änderungen anderer Geräte live übernehmen
  api.on('scan', (msg) => {
    if (msg.origin === origin) return; // eigene Änderung, schon angezeigt
    shared = { revision: msg.revision, scan: msg.scan };
    adoptRemote(msg.scan);
  });
  api.on('loadouts', (next) => {
    store = next;
    renderLoadoutSelect();
    schedule();
  });
  // Handy aus dem Standby zurück: Verbindung war evtl. weg, aktuellen Stand holen
  const onVisible = () => { if (document.visibilityState === 'visible') refreshShared(); };
  document.addEventListener('visibilitychange', onVisible);

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(run, 200);
  }

  async function run() {
    // Zuerst hochzählen: Eine noch laufende ältere Anfrage darf das Ergebnis danach nicht mehr überschreiben
    const mine = ++seq;
    const req = buildRequest();
    if (req.missing) {
      showResultMessage(el('p', { class: 'mn-empty' }, 'Masse, Resistenz und Instabilität eingeben, dann erscheint das Ergebnis.'));
      return;
    }
    try {
      const result = await api.post('/api/mining/calc', req.body);
      if (mine === seq) renderResult(result);
    } catch (err) {
      if (mine === seq) showResultMessage(notice('alert', err.message));
    }
  }

  /** Ergebnisbereich ohne Urteil (Hinweis oder Fehler): Kurz-Urteil auf dem Handy ausblenden. */
  function showResultMessage(node) {
    observer?.disconnect();
    peek.hidden = true;
    resultContent.replaceChildren(node.classList.contains('alert') ? el('div', { class: 'result-body' }, node) : node);
  }

  // ---------- Ergebnis ----------
  function verdict(a) {
    switch (a.status) {
      case 'ok':
        return { cls: 'ok', icon: 'check', text: 'SCHAFFBAR', long: 'SCHAFFBAR' };
      case 'slow':
        return { cls: 'warn', icon: 'edge', text: 'SCHAFFBAR – LÄDT LANGSAM', long: 'SCHAFFBAR – LÄDT LANGSAM' };
      case 'edge':
        return { cls: 'warn', icon: 'edge', text: 'GRENZFALL', sub: 'Nur mit voller Leistung, vielleicht', long: 'GRENZFALL – nur mit voller Leistung, vielleicht' };
      case 'too-strong':
        return { cls: 'warn', icon: 'edge', text: 'LASER ZU STARK', sub: `Ca. ${a.backoffM} m Abstand halten`, long: `LASER ZU STARK – ca. ${a.backoffM} m Abstand halten` };
      default:
        return { cls: 'bad', icon: 'ban', text: 'NICHT SCHAFFBAR', long: 'NICHT SCHAFFBAR' };
    }
  }

  const bandText = (a) => (!a.band ? '–' : a.band[0] === a.band[1] ? `${a.band[0]} %` : `${a.band[0]}–${a.band[1]} %`);

  /** Leistungszeile als Knoten, der wichtige Wert fett. */
  function powerLine(a, r) {
    if (a.status === 'impossible') return ['Benötigt ', el('b', {}, `${fmtInt(a.share * 100)} %`), ' der Laserleistung'];
    if (a.status === 'edge') return ['Benötigt rechnerisch ', el('b', {}, `${fmtInt(a.share * 100)} %`), ', also volle Leistung (100 %)'];
    if (a.status === 'too-strong') {
      return ['Schon die Mindestleistung (', el('b', {}, `${Math.round(r.setup.laser.throttleMin * 100)} %`), `) ist zu viel – ab ca. ${a.backoffM} m Abstand passt es`];
    }
    return [el('b', {}, bandText(a)), ' Laserleistung halten die Ladung stabil'];
  }

  function peekLine(a) {
    if (a.status === 'impossible') return `Benötigt ${fmtInt(a.share * 100)} % Leistung`;
    if (a.status === 'edge') return 'Nur mit voller Leistung, vielleicht';
    if (a.status === 'too-strong') return `Ca. ${a.backoffM} m Abstand halten`;
    return `${bandText(a)} Laserleistung`;
  }

  function gauge(a, r, cls) {
    if (!a.band) return null;
    const [from, to] = a.band;
    const g = el(
      'div',
      { class: 'gauge' },
      el(
        'div',
        { class: 'gauge-track', role: 'img', 'aria-label': from === to ? `Laserleistung ${from} Prozent` : `Laserleistung ${from} bis ${to} Prozent` },
        el('span', { class: 'gauge-min' }),
        el('span', { class: 'gauge-band' }),
      ),
      el('div', { class: 'gauge-scale', 'aria-hidden': 'true' }, ['0', '25', '50', '75', '100 %'].map((t) => el('span', {}, t))),
    );
    g.style.setProperty('--from', String(from));
    g.style.setProperty('--to', String(to));
    g.style.setProperty('--min', String(Math.round(r.setup.laser.throttleMin * 100)));
    g.style.setProperty('--c', `var(--${cls})`);
    return g;
  }

  function renderResult(r) {
    const a = r.baseline;
    const v = verdict(a);
    const parts = r.rock.parts;

    // Haupterz: größter Gesamtanteil (ohne Inert); Hauptzeile: dessen größter Einzelanteil
    const totals = new Map();
    for (const p of parts) if (p.oreId) totals.set(p.oreId, (totals.get(p.oreId) ?? 0) + p.pct);
    const oreOrder = [...totals.entries()].sort((x, y) => y[1] - x[1]).map(([id]) => id);
    const mainOreId = oreOrder[0] ?? null;
    const mainPart = mainOreId ? parts.filter((p) => p.oreId === mainOreId).sort((x, y) => y.pct - x.pct)[0] : null;
    const color = (p) => (p.oreId ? ORE_COLORS[oreOrder.indexOf(p.oreId) % ORE_COLORS.length] : null);
    const swatchProps = (p, cls) => {
      const s = el('i', { class: `${cls}${p.oreId ? '' : ' mn-inert'}` });
      if (p.oreId) s.style.setProperty('--oc', color(p));
      return s;
    };

    // ---- Anzeige oben ----
    const mainOre = mainOreId ? oreById.get(mainOreId) : null;
    const total = parts.reduce((s, p) => s + p.pct, 0);
    let compBar = null;
    if (parts.length) {
      compBar = el('div', {
        class: 'mn-compbar',
        role: 'img',
        'aria-label': `Zusammensetzung: ${parts.map((p) => `${p.name} ${fmtDec(p.pct, 1)} %`).join(', ')}`,
      });
      for (const p of parts) {
        const seg = swatchProps(p, '');
        seg.style.width = `${(p.pct / Math.max(100, total)) * 100}%`;
        seg.title = `${p.name}: ${fmtDec(p.pct, 1)} %`;
        compBar.append(seg);
      }
    }
    const readout = el(
      'div',
      { class: 'readout' },
      el('div', { class: 'readout-top' }, el('span', { class: 'mass' }, fmtInt(r.rock.mass)), el('span', { class: 'mass-unit' }, 'kg')),
      mainOre ? el('div', { class: 'ore-main' }, mainOre.name, ' ', el('span', {}, mainOre.form === 'RAW' ? '(Raw)' : '(Ore)')) : null,
      el(
        'dl',
        { class: 'stats' },
        el('div', {}, el('dt', {}, 'RES'), el('dd', {}, fmtDec(a.resistancePct, 1), el('small', {}, '%'))),
        el('div', {}, el('dt', {}, 'INST'), el('dd', {}, fmtDec(a.instability, 2))),
        el('div', {}, el('dt', {}, 'SCU'), el('dd', {}, r.rock.scu != null ? fmtDec(r.rock.scu, 2) : '–')),
      ),
      compBar,
      el('p', { class: 'readout-own' }, `Stein: RES ${fmtDec(r.rock.resistanceOwn, 1)} % · INST ${fmtDec(r.rock.instabilityOwn, 2)}`),
    );

    // ---- Erz-Tabelle ----
    const table = parts.length
      ? el(
          'table',
          { class: 'ores' },
          el('thead', {}, el('tr', {}, ['Erz', 'Anteil', 'SCU', 'Qualität'].map((t) => el('th', { scope: 'col' }, t)))),
          el(
            'tbody',
            {},
            parts.map((p) => {
              let q = '–';
              if (p.quality != null && p.oreId) {
                const fill = el('i', {});
                fill.style.setProperty('--w', `${Math.min(100, p.quality / 10)}%`);
                q = el('span', { class: `q${p.quality >= 600 ? ' q-hi' : ''}` }, el('span', { class: 'bar', 'aria-hidden': 'true' }, fill), `Q ${p.quality}`);
              }
              return el(
                'tr',
                { class: p === mainPart ? 'main' : p.oreId ? null : 'inert' },
                el('td', {}, swatchProps(p, 'mn-sw'), p.name),
                el('td', {}, `${fmtDec(p.pct, 1)} %`),
                el('td', {}, p.scu != null ? fmtDec(p.scu) : '–'),
                el('td', {}, q),
              );
            }),
          ),
        )
      : null;

    // ---- Urteil, Leistung, Varianten, Gadget, Hinweise ----
    const body = [];
    const verdictEl = el(
      'div',
      { class: `verdict ${v.cls}` },
      icon(v.icon),
      el(
        'span',
        {},
        el('span', { class: 'verdict-label' }, `Urteil · ${active().name}`),
        el('span', { class: 'verdict-text' }, v.text),
        v.sub ? el('span', { class: 'verdict-sub' }, v.sub) : null,
      ),
    );
    body.push(verdictEl, el('div', { class: 'power' }, el('p', { class: 'power-line' }, powerLine(a, r)), gauge(a, r, v.cls)));

    // Aktive Module nur zeigen, wenn es ohne sie nicht gut geht (sonst nur Ablenkung)
    const variants = a.status === 'ok' ? [] : r.variants;
    if (variants.length) {
      body.push(
        el(
          'ul',
          { class: 'mn-variants' },
          variants.map((x) => {
            const vv = verdict(x.assessment);
            return el('li', {}, `${cap(x.label)}: `, el('b', { class: `mn-c-${vv.cls}` }, vv.long), ' · ', powerLine(x.assessment, r));
          }),
        ),
      );
    }

    const g = r.gadgets;
    const gadgetEffect = (o) =>
      `Resistenz ${fmtDec(a.resistancePct, 1)} → ${fmtDec(o.assessment.resistancePct, 1)} % · Instabilität ${fmtDec(a.instability, 2)} → ${fmtDec(o.assessment.instability, 2)}`;
    const advice = (title, line, sub, bad = false) =>
      el(
        'div',
        { class: `advice${bad ? ' mn-bad' : ''}` },
        icon(bad ? 'ban' : 'gadget'),
        el('p', {}, el('strong', {}, title), line ? el('span', { class: 'line' }, line) : null, sub ? el('span', { class: 'sub' }, sub) : null),
      );
    if (g.kind === 'attached') body.push(advice(`Gadget am Stein: ${r.rock.gadgetAttached.name}`));
    else if (g.kind === 'required') {
      const b = g.best.assessment;
      body.push(advice(`Gadget nötig: ${g.best.gadget.name}`, b.status === 'too-strong' ? `Dann Laser zu stark, ca. ${b.backoffM} m Abstand` : `Dann ${bandText(b)} Laserleistung`, gadgetEffect(g.best)));
    } else if (g.kind === 'recommended') {
      body.push(advice(`Empfohlen: ${g.best.gadget.name}`, `Laserleistung ${fmtInt(a.share * 100)} → ${fmtInt(g.best.assessment.share * 100)} %`, gadgetEffect(g.best)));
    } else if (g.kind === 'optional' && g.best) body.push(advice(`Optional: ${g.best.gadget.name}`, null, gadgetEffect(g.best)));
    else if (g.kind === 'none-helps') body.push(advice('Kein Gadget hilft bei diesem Stein', null, null, true));

    for (const n of r.notes) body.push(notice('note', n, { iconName: 'edge' }));
    if (ignoredParts) body.push(notice('note', `${ignoredParts} Zeile(n) der Zusammensetzung unvollständig (Erz oder Anteil fehlt) und nicht berücksichtigt.`, { iconName: 'edge' }));

    // ---- Fuß: Loadout und Rechenmodell ----
    const mods = [...r.setup.passive, ...r.setup.active];
    const foot = el(
      'footer',
      { class: 'loadout-foot' },
      el(
        'div',
        { class: 'row' },
        icon('ship', 's'),
        el('span', {}, el('b', {}, `${active().name}:`), ` ${r.setup.laser.name}${r.setup.powerBonusPct ? ` (Crafting ${r.setup.powerBonusPct > 0 ? '+' : ''}${fmtDec(r.setup.powerBonusPct, 1)} % Leistung)` : ''}${mods.length ? ' · ' + mods.join(', ') : ''} · max. ${fmtInt(a.maxMass)} kg bei dieser Resistenz`),
      ),
      el(
        'div',
        { class: 'row' },
        icon('bolt', 's'),
        el(
          'span',
          {},
          `Rechenmodell: ${r.options.resistanceExponent === 1 ? 'linear' : `Kurve ${fmtExp(r.options.resistanceExponent)} (wie Bedrock)`} `,
          el(
            'button',
            {
              type: 'button',
              class: 'linkbtn',
              onclick: () => {
                options = { ...options, resistanceExponent: options.resistanceExponent === 1 ? data.defaults.resistanceExponent : 1 };
                storage.save(OPTIONS_KEY, options);
                modelChip.querySelector('b').textContent = modelName();
                schedule();
              },
            },
            'umschalten',
          ),
        ),
      ),
    );

    resultContent.replaceChildren(readout, table, el('div', { class: 'result-body' }, body), foot);

    const said = `${v.long}. ${peekLine(a)}`;
    if (said !== lastSpoken) {
      lastSpoken = said;
      spoken.textContent = said;
    }

    peekWord.textContent = v.text;
    peekText.textContent = peekLine(a);
    peek.style.setProperty('--pc', `var(--${v.cls})`);
    peek.hidden = false;
    if (observer) {
      observer.disconnect();
      observer.observe(verdictEl);
    } else peek.classList.remove('hide');
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
    editorPanel.hidden = false;
    editorPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    editorPanel.querySelector('input')?.focus({ preventScroll: true });
  }

  function closeEditor() {
    editorPanel.hidden = true;
    editButton.focus({ preventScroll: true });
  }

  function renderEditor() {
    // Nach dem Neuaufbau den Fokus auf dasselbe Feld zurücksetzen
    const focusKey = editorPanel.contains(document.activeElement) ? document.activeElement.dataset.k : null;
    const ship = byId(data.ships, editing.shipId) ?? data.ships[0];
    const size = ship.heads[0].size;
    const fits = (l) => l.size === size && l.requiredTags.every((t) => t === 'miningMount' || t === ship.id);
    const laser = byId(data.lasers, editing.laserId);
    editing.moduleIds = editing.moduleIds.slice(0, laser.slots);
    const message = el('p', { class: 'mn-msg', role: 'status' });

    const field = (label, input) => el('label', { class: 'field' }, fieldLabel(label), input);

    const slots = Array.from({ length: laser.slots }, (_, i) =>
      field(
        `Modul-Slot ${i + 1}`,
        el(
          'select',
          {
            class: 'select',
            'data-k': `slot-${i}`,
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

    // Crafting-Bonus: als Text bearbeiten (Komma, Vorzeichen), beim Speichern als Zahl
    if (editing.bonusText === undefined) editing.bonusText = editing.powerBonusPct ? String(editing.powerBonusPct).replace('.', ',') : '';
    const bonusValue = () => parseSigned(editing.bonusText);
    const bonusOk = (v) => v != null && v >= -50 && v <= 100;
    const bonusInput = el('input', {
      class: 'input',
      'data-k': 'bonus',
      value: editing.bonusText,
      placeholder: 'z. B. 10,5',
      inputmode: 'text',
      autocomplete: 'off',
      oninput: (e) => {
        editing.bonusText = e.target.value;
        e.target.setAttribute('aria-invalid', String(!bonusOk(bonusValue())));
        updateSummary();
      },
    });
    bonusInput.setAttribute('aria-invalid', String(!bonusOk(bonusValue())));
    const fmtMod = (v) => (v > 0 ? `+${v}` : `${v}`);
    const summary = el('p', { class: 'mn-dim' });
    function updateSummary() {
      const b = bonusValue();
      const eff = bonusOk(b) && b !== 0 ? ` (mit Crafting ${fmtInt(laser.power * (1 + b / 100))})` : '';
      summary.textContent = `${laser.name}: ${fmtInt(laser.power)} Leistung${eff}, min. ${Math.round(laser.throttleMin * 100)} %, Resistenz ${fmtMod(laser.mods.resistance)} %, Instabilität ${fmtMod(laser.mods.instability)} %, Fenster ${fmtMod(laser.mods.window)} %, ${laser.slots} Slot(s), optimal bis ${laser.rangeFull} m`;
    }
    updateSummary();

    const save = async (asNew) => {
      const b = bonusValue();
      if (!bonusOk(b)) {
        message.textContent = 'Crafting-Bonus: Zahl zwischen -50 und 100 eingeben (z. B. 10,5), oder leer lassen.';
        bonusInput.focus();
        return;
      }
      const { bonusText: _drop, ...rest } = editing;
      const entry = { ...rest, powerBonusPct: b, name: editing.name.trim() || 'Loadout' };
      if (asNew) entry.id = crypto.randomUUID?.() ?? String(Date.now());
      const next = structuredClone(store);
      const i = next.loadouts.findIndex((l) => l.id === entry.id);
      if (i >= 0) next.loadouts[i] = entry;
      else next.loadouts.push(entry);
      next.activeId = entry.id;
      try {
        await persist(next);
        closeEditor();
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
        closeEditor();
        schedule();
      } catch (err) {
        message.textContent = err.message;
      }
    };

    editorPanel.replaceChildren(
      el(
        'div',
        { class: 'panel-head' },
        el('h2', { id: 'mn-h-editor' }, 'Loadout'),
        el('button', { type: 'button', class: 'btn btn-ghost btn-icon', title: 'Schließen', 'aria-label': 'Schließen', onclick: closeEditor }, icon('x', 's')),
      ),
      el(
        'div',
        { class: 'panel-body' },
        el(
          'div',
          { class: 'fields' },
          field('Name', el('input', { class: 'input', 'data-k': 'name', value: editing.name, maxlength: 60, autocomplete: 'off', oninput: (e) => (editing.name = e.target.value) })),
          field(
            'Schiff',
            el(
              'select',
              {
                class: 'select',
                'data-k': 'ship',
                onchange: (e) => {
                  editing.shipId = e.target.value;
                  editing.laserId = byId(data.ships, e.target.value).heads[0].stockLaser;
                  editing.moduleIds = [];
                  renderEditor();
                },
              },
              data.ships.map((s) => el('option', { value: s.id, selected: s.id === ship.id }, s.name)),
            ),
          ),
          field(
            'Laserkopf',
            el(
              'select',
              { class: 'select', 'data-k': 'laser', onchange: (e) => { editing.laserId = e.target.value; renderEditor(); } },
              data.lasers.filter(fits).map((l) => el('option', { value: l.id, selected: l.id === laser.id }, l.name)),
            ),
          ),
          el(
            'label',
            { class: 'field' },
            el('span', { class: 'field-label' }, 'Crafting-Bonus Leistung', el('small', {}, '% · optional')),
            el('span', { class: 'unit', 'data-unit': '%' }, bonusInput),
          ),
          ...slots,
        ),
        summary,
        el('p', { class: 'mn-dim' }, 'Crafting-Bonus: zusätzliche Laserleistung eines gecrafteten Lasers (z. B. +10,5 %). Das Spiel zeigt ihn im HUD nicht an, deshalb hier eintragen.'),
        store.staleCount ? notice('note', `${store.staleCount} gespeicherte(s) Loadout(s) passen nicht mehr zu den aktuellen Spieldaten und sind ausgeblendet (nicht gelöscht).`) : null,
        el(
          'div',
          { class: 'mn-actions' },
          button('Speichern', { variant: 'primary', iconName: 'save', onclick: () => save(false) }),
          button('Als neues speichern', { iconName: 'copy', onclick: () => save(true) }),
          button('Löschen', { iconName: 'trash', onclick: remove }),
        ),
        message,
      ),
    );
    if (focusKey) editorPanel.querySelector(`[data-k="${focusKey}"]`)?.focus({ preventScroll: true });
  }

  // Einmalig: Scan, der früher nur auf diesem Gerät gespeichert war, auf den Server übernehmen
  const legacy = storage.load(LEGACY_SCAN_KEY, null);
  if (legacy) {
    storage.remove(LEGACY_SCAN_KEY);
    if (isEmptyDraft(scan) && Array.isArray(legacy.parts)) {
      const migrated = { ...emptyScan(), ...legacy, parts: legacy.parts.length ? legacy.parts.slice(0, 12) : [emptyPart()] };
      scan = migrated;
      queue({ op: 'replace', scan: migrated });
    }
  }

  renderLoadoutSelect();
  renderScan();
  run();

  return () => {
    clearTimeout(timer);
    clearTimeout(retryTimer);
    // Noch nicht gesendete Eingaben nicht verlieren
    clearTimeout(flushTimer);
    flush();
    document.removeEventListener('visibilitychange', onVisible);
    seq++; // späte Antworten nicht mehr anzeigen
    observer?.disconnect();
    style.remove();
  };
}
