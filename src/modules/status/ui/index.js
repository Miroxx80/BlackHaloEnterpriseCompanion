// UI-Vertrag: export function mount(root, api) -> optional Cleanup-Funktion
import { el, icon, chip, pageHead, panel } from '/ui.js';

const STATES = {
  running: { cls: 'run', label: 'Läuft' },
  failed: { cls: 'fail', label: 'Fehler' },
  disabled: { cls: 'off', label: 'Aus' },
  skipped: { cls: 'off', label: 'Nicht in dieser Rolle' },
};

/** Laufzeit: "1 h 42 min" bzw. "42 min". */
function fmtUptime(sec) {
  const min = Math.floor(sec / 60);
  const h = Math.floor(min / 60);
  return h > 0 ? `${h} h ${min % 60} min` : `${min} min`;
}

export function mount(root, api) {
  const serverChip = el('span', { 'aria-live': 'polite' });
  const info = el('dl', { class: 'kv', id: 'status-info' });
  const mods = el('ul', { class: 'mods', id: 'status-mods' });

  let serverOk = null;
  function setServer(ok) {
    if (ok === serverOk) return; // nur bei Wechsel neu zeichnen (sonst liest der Screenreader alle 5 s vor)
    serverOk = ok;
    serverChip.replaceChildren(ok ? chip('Server', 'läuft', true) : chip('Server', 'nicht erreichbar'));
  }
  setServer(true);

  root.replaceChildren(
    pageHead(api, { title: 'Status', meta: [serverChip] }),
    el(
      'div',
      { class: 'two-col' },
      panel({ idx: 'SYS', title: 'Rechner', id: 'status-h-sys' }, info),
      panel({ idx: 'MOD', title: 'Module', id: 'status-h-mods' }, mods),
    ),
  );

  function row(key, value, mono = false) {
    info.append(el('dt', {}, key), el('dd', { class: mono ? 'mono' : null }, value));
  }

  let seq = 0;
  let disposed = false;

  async function refresh() {
    const my = ++seq;
    try {
      const [s, m] = await Promise.all([api.get('/api/status'), api.get('/api/modules')]);
      // Eine ältere, langsamere Antwort darf eine neuere nicht überschreiben.
      if (disposed || my !== seq) return;
      setServer(true);
      info.replaceChildren();
      row('Version', `v${m.version ?? '?'}`, true);
      row('Rolle', s.role);
      row('Rechner', s.host);
      row('Laufzeit', fmtUptime(s.uptimeSec));
      row('Verbundene Geräte', String(s.clients));
      row('Node', s.node, true);
      const urls = s.addresses.map((ip) => `http://${ip}:${s.port}`);
      row('Tablet-URL', urls.length ? urls.map((u) => el('span', { style: { display: 'block' } }, u)) : 'keine gefunden', urls.length > 0);

      mods.replaceChildren();
      for (const mod of m.modules) {
        const st = STATES[mod.state] ?? { cls: 'off', label: mod.state };
        const sub = `v${mod.version}${mod.error ? ' · ' + mod.error : ''}`;
        mods.append(
          el(
            'li',
            { class: 'state-' + mod.state },
            icon(mod.nav?.icon ?? 'module', 's'),
            el('span', { class: 'name' }, mod.name, ' ', el('small', {}, sub)),
            el('span', { class: `state ${st.cls}` }, st.label),
          ),
        );
      }
    } catch (err) {
      if (disposed || my !== seq) return;
      setServer(false);
      info.replaceChildren();
      row('Fehler', String(err.message || err));
    }
  }

  refresh();
  const timer = setInterval(refresh, 5000);
  return () => {
    disposed = true;
    clearInterval(timer);
  };
}
