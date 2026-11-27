// UI-Vertrag: export function mount(root, api) -> optional Cleanup-Funktion
import { el, icon, chip, pageHead, panel, button, notice } from '/ui.js';

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

  // ---- Version & Updates (nur Desktop-App, installierte Version) ----
  const updBody = el('div', { class: 'panel-body' });
  let upd = null;
  const renderUpdate = () => {
    if (!upd) return;
    const parts = [];
    const action = (label, act, variant) => button(label, { variant, iconName: act === 'install' ? 'save' : 'reset', onclick: () => run(act) });
    if (upd.status === 'unsupported') parts.push(el('p', { class: 'upd-hint' }, upd.error || 'Updates gibt es nur in der installierten Desktop-App.'));
    else if (upd.status === 'available') {
      parts.push(notice('note', `Version ${upd.latest} ist verfügbar (installiert: ${upd.current}).`, { iconName: 'info' }));
      if (upd.notes) parts.push(el('pre', { class: 'upd-notes' }, upd.notes));
      parts.push(action(`Update auf v${upd.latest} installieren`, 'install', 'primary'), el('p', { class: 'upd-hint' }, 'Die App lädt den Installer, installiert und startet neu. Dauert ca. 1 Minute.'));
    } else if (upd.status === 'downloading') parts.push(el('p', {}, `Update wird geladen ... ${upd.progress ?? 0} %`));
    else if (upd.status === 'ready') parts.push(el('p', {}, 'Update wird installiert, die App startet gleich neu.'));
    else if (upd.status === 'checking') parts.push(el('p', {}, 'Suche nach Updates ...'));
    else {
      if (upd.status === 'none') parts.push(el('p', {}, `Aktuell: v${upd.current} ist die neueste Version.`));
      if (upd.status === 'error') parts.push(notice('alert', `Update-Prüfung fehlgeschlagen: ${upd.error}`));
      parts.push(action('Nach Updates suchen', 'check'));
    }
    updBody.replaceChildren(...parts);
  };
  const run = async (act) => {
    try {
      upd = await api.post('/api/status/update', { action: act });
    } catch (err) {
      upd = { ...(upd ?? {}), status: 'error', error: err.message };
    }
    renderUpdate();
  };
  api.get('/api/status/update').then((s) => { upd = s; renderUpdate(); }).catch(() => {});
  api.on('update', (s) => { upd = s; renderUpdate(); });

  root.replaceChildren(
    pageHead(api, { title: 'Status', meta: [serverChip] }),
    panel({ idx: 'UPD', title: 'Version & Updates', id: 'status-h-upd', cls: 'upd' }, updBody),
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
