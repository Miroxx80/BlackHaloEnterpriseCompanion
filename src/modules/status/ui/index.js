// UI-Vertrag: export function mount(root, api) -> optional Cleanup-Funktion
export function mount(root, api) {
  root.innerHTML = `
    <h2>Status</h2>
    <div class="card"><dl id="info" class="kv"></dl></div>
    <h3>Module</h3>
    <div class="card"><ul id="mods" class="list"></ul></div>
  `;
  const info = root.querySelector('#info');
  const mods = root.querySelector('#mods');

  function row(dl, key, value) {
    const dt = document.createElement('dt');
    dt.textContent = key;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dl.append(dt, dd);
  }

  async function refresh() {
    try {
      const [s, m] = await Promise.all([api.get('/api/status'), api.get('/api/modules')]);
      info.replaceChildren();
      row(info, 'Rolle', s.role);
      row(info, 'Rechner', s.host);
      row(info, 'Laufzeit', `${Math.floor(s.uptimeSec / 60)} min`);
      row(info, 'Verbundene Geräte', String(s.clients));
      row(info, 'Node', s.node);
      row(info, 'Tablet-URL', s.addresses.map((ip) => `http://${ip}:${s.port}`).join('  |  ') || 'keine gefunden');

      mods.replaceChildren();
      for (const mod of m.modules) {
        const li = document.createElement('li');
        li.textContent = `${mod.name} v${mod.version}: ${mod.state}${mod.error ? ' (' + mod.error + ')' : ''}`;
        li.className = 'state-' + mod.state;
        mods.append(li);
      }
    } catch (err) {
      info.replaceChildren();
      row(info, 'Fehler', String(err.message || err));
    }
  }

  refresh();
  const timer = setInterval(refresh, 5000);
  return () => clearInterval(timer);
}
