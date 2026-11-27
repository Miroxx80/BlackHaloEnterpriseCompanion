// Sprunghilfen: Aaron Halo. Start und Ziel wählen, dann zeigt die Seite, bei welcher Restentfernung im HUD man den
// Quantum-Sprung abbricht, um in einem Band des Halo zu landen. Rechnet auf dem PC (GET /api/navigation/...).
// Nur Anzeige: keine Eingaben ans Spiel.
// Aussehen: gemeinsame Bausteine aus shell.css (Design "Industrial"), hier nur wenige Ergänzungen mit Präfix "nv-".
import { el, icon, chip, pageHead, panel, button, notice, fmtDec } from '/ui.js';

const STYLE = `
.nv-grid { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(320px, .85fr); gap: 20px; align-items: start; }
.nv-pick { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 14px 12px; }
.nv-pick .nv-from { grid-column: 1; grid-row: 1; }
.nv-pick .nv-to { grid-column: 1; grid-row: 2; }
.nv-pick .nv-swap { grid-column: 2; grid-row: 1 / 3; align-self: center; margin-top: 22px; }
.nv-res { display: grid; gap: 14px; padding: 18px; }
.nv-res:empty { display: none; }
.nv-len { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 14px; margin: 0; font-size: var(--fs-s); color: var(--text-dim); }
.nv-len b { font-family: var(--font-head); font-stretch: 87.5%; font-size: 20px; font-weight: 700; color: var(--text); letter-spacing: .02em; }
.nv-res .verdict { cursor: default; }
.nv-res .verdict-text { text-transform: none; letter-spacing: .02em; }
.nv-tbl { overflow-x: auto; margin: 0 -18px; }
.nv-tbl table { width: 100%; border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; }
.nv-tbl th { padding: 8px; font-family: var(--font-head); font-size: 11px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--text-faint); text-align: right; border-bottom: var(--bw) solid var(--line); white-space: nowrap; }
.nv-tbl td { padding: 9px 8px; text-align: right; border-bottom: var(--bw) solid color-mix(in srgb, var(--line) 60%, transparent); white-space: nowrap; }
.nv-tbl th:first-child, .nv-tbl td:first-child { text-align: left; padding-left: 18px; }
.nv-tbl th:last-child, .nv-tbl td:last-child { padding-right: 18px; }
.nv-tbl td.nv-b b { font-family: var(--font-head); font-size: 17px; font-weight: 700; }
.nv-tbl td.nv-b small { margin-left: 6px; font-size: var(--fs-xs); color: var(--text-faint); }
.nv-tbl td.nv-hud { font-family: var(--font-head); font-stretch: 87.5%; font-size: 17px; font-weight: 700; color: var(--text); }
.nv-tbl td.nv-st { color: var(--ok); }
.nv-tbl td.nv-st small { display: block; font-size: var(--fs-xs); color: var(--text-faint); }
.nv-tbl tr.nv-best td.nv-b b, .nv-tbl tr.nv-best td.nv-hud { color: var(--amber); }
.nv-tbl tr.nv-off td { color: var(--text-faint); }
.nv-tbl tr.nv-off td.nv-hud, .nv-tbl tr.nv-off td.nv-b b { color: var(--text-faint); }
.nv-tbl tr.nv-p2 td.nv-b small { color: var(--text-dim); }
.nv-tbl tr.nv-p2-first td { border-top: 1px dashed var(--line-strong); }
.nv-narrow { color: var(--warn); }
.nv-dim { margin: 0; font-size: var(--fs-s); color: var(--text-dim); }
.nv-res .alert, .nv-res .note { margin: 0; }
.nv-seg { grid-template-columns: repeat(10, minmax(0, 1fr)); margin-bottom: 14px; }
.nv-seg .seg-btn { --sw: var(--amber); min-height: 40px; padding: 0; font-family: var(--font-mono); font-size: 14px; letter-spacing: 0; }
.nv-seg .seg-btn[aria-pressed="true"] { color: var(--on-amber); }
.nv-list { display: grid; gap: 6px; margin: 0 0 12px; padding: 0; list-style: none; }
.nv-item { display: grid; gap: 4px; width: 100%; padding: 10px 12px; border: var(--bw) solid var(--line); background: var(--bg); color: var(--text); text-align: left; cursor: pointer; font: inherit; }
.nv-item:hover, .nv-item:focus-visible { border-color: var(--amber); }
.nv-item[aria-current="true"] { border-color: var(--amber); background: color-mix(in srgb, var(--amber) 8%, var(--bg)); }
.nv-item .nv-name { font-weight: 600; overflow-wrap: anywhere; }
.nv-item .nv-sub { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 12px; }
.nv-item .nv-hudl { font-family: var(--font-head); font-stretch: 87.5%; font-size: 17px; font-weight: 700; color: var(--amber); white-space: nowrap; }
.nv-item .nv-hudl.nv-narrow { color: var(--warn); }
.nv-item .nv-meta { font-size: var(--fs-xs); color: var(--text-faint); }
.nv-credits { margin: 20px 0 0; font-size: var(--fs-xs); color: var(--text-faint); line-height: 1.6; }
.nv .help { margin-top: 0; }
@media (max-width: 1099px) {
  .nv-grid { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 520px) {
  .nv-res { padding: 14px; }
  .nv-tbl { margin: 0 -14px; }
  .nv-tbl th, .nv-tbl td { padding-left: 4px; padding-right: 4px; }
  .nv-tbl th:first-child, .nv-tbl td:first-child { padding-left: 14px; }
  .nv-tbl th:last-child, .nv-tbl td:last-child { padding-right: 14px; }
  .nv-tbl td.nv-b small { display: block; margin: 0; }
  .nv-tbl th { letter-spacing: .06em; }
  .nv-seg { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .nv-res { scroll-margin-top: 72px; }
}
`;

/** Start, Ziel und Band pro Gerät. */
const STORE_KEY = 'bh-navigation';
const DEFAULTS = { from: 'mic-l1', to: 'hurston', band: 5 };
/** So viele Ziele zeigt "Ziele vom Start aus". */
const SUGGEST_LIMIT = 8;

const GROUP_LABELS = { Hurston: 'Hurston', Crusader: 'Crusader', ArcCorp: 'ArcCorp', microTech: 'microTech', Lagrange: 'Lagrange-Punkte', Sonstige: 'Sonstige' };
const BAND_NOTE = { 1: 'fast leer', 5: 'dichtestes' };
const STATUS_TEXT = { in: 'im Band', over: 'über dem Band', under: 'unter dem Band' };

function loadPrefs() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    return { ...DEFAULTS, ...(v && typeof v === 'object' ? v : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}
function savePrefs(prefs) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(prefs));
  } catch {
    /* Speicher nicht verfügbar */
  }
}

/** km -> Gm mit d Nachkommastellen, deutsches Komma. */
const gm = (km, d = 1) => fmtDec(km / 1e6, d);
/** km -> Mm (1000 km) ganzzahlig, für Bereiche unter 1 Gm. */
const mm = (km) => Math.round(km / 1e3).toLocaleString('de-DE');
/** HUD-Wert (Gm, eine Nachkommastelle) deutsch. */
const hudText = (hud) => fmtDec(hud, 1);
/**
 * Fenster im Band mit Einheit, immer zwei Nachkommastellen (einheitlich lesbar, schmale Bänder sind oft nur
 * 0,1–0,2 Gm breit). Liegt das Fenster ganz unter 1 Gm (dort zeigt das HUD keine Gm), in Mm.
 */
const windowText = (c) => {
  if (!c.hudGm) return `${mm(c.enter)}–${mm(c.leave)} Mm`;
  return `${gm(c.enter, 2)}–${gm(c.leave, 2)} Gm`;
};
const NARROW_TEXT = 'Band hier schmaler als 0,1 Gm, der Wert liegt knapp daneben';
const BELOW_GM_TEXT = 'unter 1 Gm vor dem Ziel, dort zeigt das HUD keine Gm';
const signed = (km) => {
  if (Math.abs(km) >= 1e6) return `${km > 0 ? '+' : '−'}${gm(Math.abs(km))} Gm`;
  const r = Math.round(km);
  return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${Math.abs(r).toLocaleString('de-DE')} km`;
};

export async function mount(root, api) {
  const style = el('style', {}, STYLE);
  document.head.append(style);
  root.classList.add('nv');

  let data;
  try {
    data = await api.get('/api/navigation/data');
  } catch (err) {
    root.append(pageHead(api, { title: 'Sprunghilfen' }), notice('alert', `Daten der Sprunghilfen nicht ladbar: ${err.message}`));
    return () => style.remove();
  }

  const places = data.places.filter((p) => p.qt);
  const byId = new Map(places.map((p) => [p.id, p]));
  const nameOf = (id) => (id === 'stanton' ? 'Stanton (Stern)' : byId.get(id)?.name ?? id);
  const prefs = loadPrefs();
  if (!byId.has(prefs.from)) prefs.from = DEFAULTS.from;
  if (!byId.has(prefs.to)) prefs.to = DEFAULTS.to;
  if (!data.halo.bands.some((b) => b.n === prefs.band)) prefs.band = DEFAULTS.band;

  // ---------- Auswahl Start / Ziel ----------
  const groups = [...new Set(places.map((p) => p.group))];
  const placeSelect = (label, value) => {
    const select = el(
      'select',
      { class: 'select', 'aria-label': label },
      groups.map((g) => el('optgroup', { label: GROUP_LABELS[g] ?? g }, places.filter((p) => p.group === g).map((p) => el('option', { value: p.id }, p.name)))),
    );
    select.value = value;
    return select;
  };
  const fromSelect = placeSelect('Start', prefs.from);
  const toSelect = placeSelect('Ziel', prefs.to);
  const swap = button('Start und Ziel tauschen', {
    iconName: 'swap',
    iconOnly: true,
    onclick: () => {
      [fromSelect.value, toSelect.value] = [toSelect.value, fromSelect.value];
      changed(true);
    },
  });
  swap.classList.add('nv-swap');
  fromSelect.addEventListener('change', () => changed(true));
  toSelect.addEventListener('change', () => changed(false));

  const field = (cls, label, control) => el('label', { class: `field ${cls}` }, el('span', { class: 'field-label' }, label), control);
  const result = el('div', { class: 'nv-res' });
  // Nur die Empfehlung vorlesen lassen (feste Live-Region, nicht Tabelle und Hinweise nach jeder Änderung)
  const spoken = el('div', { class: 'sr-only', 'aria-live': 'polite' });

  const haloPanel = panel(
    { idx: '01', title: 'Aaron Halo', tag: 'Abbruchpunkt im Quantum-Sprung' },
    el('div', { class: 'panel-body' }, el('div', { class: 'nv-pick' }, field('nv-from', 'Start', fromSelect), swap, field('nv-to', 'Ziel', toSelect))),
    el('hr', { class: 'panel-sep' }),
    result,
    el('hr', { class: 'panel-sep' }),
    el(
      'div',
      { class: 'panel-body' },
      el('p', { class: 'help' }, icon('info', 's'), el('span', {}, 'Sprung zum Ziel planen, starten und bei der angezeigten Restentfernung aus dem Quantum-Sprung gehen.')),
    ),
    spoken,
  );

  // ---------- Ziele vom Start aus ----------
  const segButtons = data.halo.bands.map((b) =>
    el(
      'button',
      {
        type: 'button',
        class: 'seg-btn',
        'aria-pressed': String(b.n === prefs.band),
        'aria-label': `Band ${b.n}${BAND_NOTE[b.n] ? ` (${BAND_NOTE[b.n]})` : ''}`,
        onclick: () => {
          prefs.band = b.n;
          for (const x of segButtons) x.setAttribute('aria-pressed', String(x === segButtons[b.n - 1]));
          savePrefs(prefs);
          loadSuggestions();
          // Die Empfehlung oben folgt dem gewählten Band
          if (lastRoute) renderRoute(lastRoute);
        },
      },
      String(b.n),
    ),
  );
  const suggestOut = el('div', {});
  const suggestSpoken = el('div', { class: 'sr-only', 'aria-live': 'polite' });
  const suggestTag = el('span', { class: 'tag' });
  const suggestPanel = el(
    'section',
    { class: 'panel', 'aria-labelledby': 'nv-h-sug' },
    el('div', { class: 'panel-head' }, el('h2', { id: 'nv-h-sug' }, el('span', { class: 'idx' }, '02'), 'Ziele vom Start aus', suggestTag)),
    el(
      'div',
      { class: 'panel-body' },
      el('div', { class: 'seg nv-seg', role: 'group', 'aria-label': 'Band' }, segButtons),
      suggestOut,
      suggestSpoken,
      el('p', { class: 'nv-dim' }, 'Kürzeste Routen zuerst. Nur Ziele, deren Route das Band innerhalb seiner Dicke kreuzt und nicht durch einen Planeten oder Mond führt. Antippen setzt das Ziel und die Empfehlung oben gilt für dieses Band.'),
    ),
  );

  const head = pageHead(api, {
    title: 'Sprunghilfen',
    meta: [chip('Spieldaten', data.build.replace(/-LIVE.*/, '')), chip('System', data.system)],
  });
  const credits = el(
    'p',
    { class: 'nv-credits' },
    `Bänder: Vermessung von CaptSheppard / Cornerstone (cstone.space, Alpha 3.16.1), Band 5 im Spiel 4.10.3 stichprobenartig bestätigt (MIC-L1 nach Hurston). Positionen: Spieldaten ${data.build} über scunpacked-data (StarCitizenWiki).`,
  );
  root.append(head, el('div', { class: 'nv-grid' }, haloPanel, suggestPanel), credits);

  // ---------- Ablauf ----------
  let haloSeq = 0;
  let suggestSeq = 0;
  let lastSuggestions = [];
  /** Letzte Antwort von /halo zur aktuellen Auswahl (für neues Zeichnen beim Bandwechsel). */
  let lastRoute = null;

  function changed(startChanged) {
    prefs.from = fromSelect.value;
    prefs.to = toSelect.value;
    savePrefs(prefs);
    loadRoute();
    if (startChanged) loadSuggestions();
    else markCurrent();
  }

  async function loadRoute() {
    const my = ++haloSeq;
    lastRoute = null;
    if (prefs.from === prefs.to) {
      result.replaceChildren(notice('note', 'Start und Ziel sind gleich. Wähle ein anderes Ziel.'));
      spoken.textContent = 'Start und Ziel sind gleich.';
      return;
    }
    try {
      const r = await api.get(`/api/navigation/halo?from=${encodeURIComponent(prefs.from)}&to=${encodeURIComponent(prefs.to)}`);
      if (my !== haloSeq) return;
      lastRoute = r;
      renderRoute(r);
    } catch (err) {
      if (my === haloSeq) {
        result.replaceChildren(notice('alert', `Route nicht berechenbar: ${err.message}`));
        spoken.textContent = 'Route nicht berechenbar.';
      }
    }
  }

  function renderRoute({ route, obstructions }) {
    const parts = [el('p', { class: 'nv-len' }, el('span', {}, 'Route ', el('b', {}, `${gm(route.length)} Gm`)), el('span', {}, `${byId.get(prefs.from)?.short ?? ''} nach ${byId.get(prefs.to)?.short ?? ''}`))];
    // Empfehlung für das gewählte Band (dieselbe Kreuzung wie in „Ziele vom Start aus“), sonst die allgemein beste
    const chosen = route.crossings.find((c) => c.band === prefs.band && c.status === 'in' && c.hudGm) ?? null;
    const best = chosen ?? route.best;
    if (!route.crossings.length) {
      parts.push(
        notice('note', 'Bei „Ziele vom Start aus“ findest du Ziele, deren Route durch den Halo führt.', { title: 'Diese Route kreuzt den Aaron Halo nicht.' }),
      );
      spoken.textContent = 'Diese Route kreuzt den Aaron Halo nicht.';
    } else if (best) {
      const narrow = !best.hudInWindow;
      parts.push(
        el(
          'div',
          { class: `verdict${narrow ? ' warn' : ''}` },
          icon(narrow ? 'edge' : 'quantum'),
          el(
            'span',
            {},
            el('span', { class: 'verdict-label' }, best.pass === 2 ? 'Empfehlung · 2. Durchquerung' : 'Empfehlung'),
            el('span', { class: 'verdict-text' }, `Bei ${hudText(best.hud)} Gm abbrechen`),
            el('span', { class: 'verdict-sub' }, `Band ${best.band} · im Band zwischen ${windowText(best).replace('–', ' und ')}`),
          ),
        ),
      );
      if (!chosen) parts.push(el('p', { class: 'nv-dim' }, `Band ${prefs.band} (gewählt unter „Ziele vom Start aus“) liegt auf dieser Route nicht nutzbar, die Empfehlung gilt für Band ${best.band}.`));
      if (narrow) parts.push(el('p', { class: 'nv-dim' }, 'Das Band ist hier schmaler als ein Schritt der HUD-Anzeige (0,1 Gm). Der Wert liegt knapp daneben, besser ein anderes Band oder Ziel wählen.'));
      spoken.textContent = `Bei ${hudText(best.hud)} Gm abbrechen, Band ${best.band}${narrow ? ', knapp' : ''}.`;
    } else if (route.crossings.some((c) => c.status === 'in')) {
      // Im Band nur kurz vor dem Ziel (Ziel liegt im Gürtel, z. B. Wikelo Emporium Selo Station in Band 4)
      parts.push(
        el(
          'div',
          { class: 'verdict warn' },
          icon('edge'),
          el(
            'span',
            {},
            el('span', { class: 'verdict-label' }, 'Empfehlung'),
            el('span', { class: 'verdict-text' }, 'Kein HUD-Wert möglich'),
            el('span', { class: 'verdict-sub' }, 'Die Route ist erst unter 1 Gm vor dem Ziel im Band. Dort zeigt das HUD keine Gm mehr. Wähle ein Ziel aus „Ziele vom Start aus“.'),
          ),
        ),
      );
      spoken.textContent = 'Kein HUD-Wert möglich, die Route ist erst kurz vor dem Ziel im Band.';
    } else {
      const side = route.crossings.every((c) => c.status === 'over') ? 'über' : route.crossings.every((c) => c.status === 'under') ? 'unter' : 'über oder unter';
      parts.push(
        el(
          'div',
          { class: 'verdict warn' },
          icon('edge'),
          el(
            'span',
            {},
            el('span', { class: 'verdict-label' }, 'Empfehlung'),
            el('span', { class: 'verdict-text' }, 'Kein Band auf dieser Route'),
            el('span', { class: 'verdict-sub' }, `Die Route verläuft ${side} den Bändern. Wähle ein Ziel aus „Ziele vom Start aus“.`),
          ),
        ),
      );
      spoken.textContent = `Kein Band auf dieser Route, sie verläuft ${side} den Bändern.`;
    }
    if (route.crossings.length) parts.push(crossingTable(route.crossings, best));
    for (const o of obstructions) {
      const name = nameOf(o.id);
      parts.push(
        o.clearance < 0
          ? notice('alert', `Route führt durch ${name} – im Spiel evtl. gesperrt.`)
          : el('p', { class: 'nv-dim' }, `Route führt nah an ${name} vorbei (${Math.round(o.clearance).toLocaleString('de-DE')} km Abstand zur Oberfläche).`),
      );
    }
    result.replaceChildren(...parts);
  }

  function crossingTable(crossings, best) {
    let firstPass2 = true;
    const rows = crossings.map((c) => {
      const cls = [best && c.band === best.band && c.pass === best.pass ? 'nv-best' : '', c.status !== 'in' ? 'nv-off' : '', c.pass === 2 ? 'nv-p2' : ''];
      if (c.pass === 2 && firstPass2) {
        cls.push('nv-p2-first');
        firstPass2 = false;
      }
      const note = c.pass === 2 ? '2. Durchquerung' : BAND_NOTE[c.band];
      return el(
        'tr',
        { class: cls.filter(Boolean).join(' ') || null },
        el('td', { class: 'nv-b' }, el('b', {}, String(c.band)), note ? el('small', {}, note) : null),
        c.hudGm
          ? el('td', { class: `nv-hud${c.hudInWindow ? '' : ' nv-narrow'}`, title: c.hudInWindow ? null : NARROW_TEXT }, hudText(c.hud))
          : el('td', { class: 'nv-hud nv-narrow', title: BELOW_GM_TEXT }, el('span', { 'aria-hidden': 'true' }, '–'), el('span', { class: 'sr-only' }, BELOW_GM_TEXT)),
        el('td', {}, windowText(c)),
        el('td', { class: c.status === 'in' ? 'nv-st' : null }, STATUS_TEXT[c.status], el('small', {}, signed(c.height))),
      );
    });
    return el(
      'div',
      { class: 'nv-tbl' },
      el(
        'table',
        {},
        el('caption', { class: 'sr-only' }, 'Alle Kreuzungen in Reihenfolge der Route'),
        el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Band'), el('th', { scope: 'col' }, 'Abbrechen bei'), el('th', { scope: 'col' }, 'Im Band'), el('th', { scope: 'col' }, 'Lage'))),
        el('tbody', {}, rows),
      ),
      el(
        'p',
        { class: 'nv-dim', style: { padding: '10px 18px 0' } },
        `Restentfernung zum Ziel in Gm, wie im HUD. Lage: Höhe über der Ebene an der dichtesten Stelle.${crossings.some((c) => !c.hudGm) ? ' „–“: erst unter 1 Gm vor dem Ziel, dort zeigt das HUD keine Gm (Bereich in Mm = 1.000 km).' : ''}`,
      ),
    );
  }

  async function loadSuggestions() {
    const my = ++suggestSeq;
    const from = prefs.from;
    suggestTag.textContent = `ab ${byId.get(from)?.short ?? from}`;
    try {
      const list = await api.get(`/api/navigation/suggest?from=${encodeURIComponent(from)}&band=${prefs.band}&limit=${SUGGEST_LIMIT}`);
      if (my !== suggestSeq) return;
      lastSuggestions = list;
      renderSuggestions();
      suggestSpoken.textContent = list.length ? `${list.length} Ziele für Band ${prefs.band}.` : `Kein Ziel für Band ${prefs.band}.`;
    } catch (err) {
      if (my === suggestSeq) {
        suggestOut.replaceChildren(notice('alert', `Ziele nicht ladbar: ${err.message}`));
        suggestSpoken.textContent = 'Ziele nicht ladbar.';
      }
    }
  }

  function renderSuggestions() {
    if (!lastSuggestions.length) {
      suggestOut.replaceChildren(el('p', { class: 'nv-dim', style: { marginBottom: '12px' } }, `Von hier kreuzt keine Route Band ${prefs.band} innerhalb seiner Dicke.`));
      return;
    }
    suggestOut.replaceChildren(
      el(
        'ul',
        { class: 'nv-list' },
        lastSuggestions.map((s) =>
          el(
            'li',
            {},
            el(
              'button',
              {
                type: 'button',
                class: 'nv-item',
                'data-id': s.id,
                'aria-current': String(s.id === prefs.to),
                onclick: () => {
                  toSelect.value = s.id;
                  changed(false);
                  if (window.matchMedia('(max-width: 1099px)').matches) haloPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
                },
              },
              el('span', { class: 'nv-name' }, nameOf(s.id)),
              el(
                'span',
                { class: 'nv-sub' },
                el('span', { class: `nv-hudl${s.crossing.hudInWindow ? '' : ' nv-narrow'}` }, `abbrechen bei ${hudText(s.crossing.hud)} Gm`),
                el(
                  'span',
                  { class: 'nv-meta' },
                  `Route ${gm(s.length)} Gm · im Band ${windowText(s.crossing)}${s.crossing.pass === 2 ? ' · 2. Durchquerung' : ''}${s.crossing.hudInWindow ? '' : ' · knapp, Band schmaler als 0,1 Gm'}`,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  function markCurrent() {
    for (const b of suggestOut.querySelectorAll('.nv-item')) b.setAttribute('aria-current', String(b.dataset.id === prefs.to));
  }

  loadRoute();
  loadSuggestions();

  return () => style.remove();
}
