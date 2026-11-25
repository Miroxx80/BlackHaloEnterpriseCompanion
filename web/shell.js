// Die Shell: Verbindung, Navigation und Laden der Modul-UIs. Kennt keine konkreten Module.

const store = {
  get(k) {
    try { return localStorage.getItem(k) || ''; } catch { return ''; }
  },
  set(k, v) {
    try { localStorage.setItem(k, v); } catch { /* Speicher nicht verfügbar */ }
  },
};

const params = new URLSearchParams(location.search);
const urlToken = params.get('token');
if (urlToken) {
  store.set('bh-token', urlToken);
  // Token aus der Adresszeile entfernen, damit es nicht sichtbar bleibt (Screenshots, Streams)
  params.delete('token');
  const rest = params.toString();
  history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
}
const token = store.get('bh-token');

// ---- REST ----
async function get(path) {
  const res = await fetch(path, { headers: token ? { 'x-bh-token': token } : {} });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

// ---- WebSocket mit Auto-Reconnect ----
const listeners = new Map(); // type -> Set<fn>
let socket = null;
let retry = 1000;
const connEl = document.getElementById('conn');

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${proto}://${location.host}/ws${token ? '?token=' + encodeURIComponent(token) : ''}`);
  socket.onopen = () => {
    retry = 1000;
    connEl.className = 'conn on';
  };
  socket.onclose = () => {
    connEl.className = 'conn off';
    setTimeout(connect, retry);
    retry = Math.min(retry * 1.5, 5000);
  };
  socket.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'core:hello') buildNav(msg.payload.modules);
    for (const fn of listeners.get(msg.type) ?? []) {
      try { fn(msg.payload); } catch (err) { console.error(err); }
    }
  };
}

// ---- API, das jedes Modul bekommt ----
function createApi(moduleId, subs) {
  return {
    moduleId,
    get,
    /** Sendet "<modul>:<name>". Gibt false zurück, wenn keine Verbindung besteht. */
    send(name, payload) {
      if (!socket || socket.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify({ type: `${moduleId}:${name}`, payload }));
      return true;
    },
    /** Hört auf "<modul>:<name>". Wird beim Verlassen des Moduls automatisch entfernt. */
    on(name, fn) {
      const type = `${moduleId}:${name}`;
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
      subs.push(() => listeners.get(type)?.delete(fn));
    },
  };
}

// ---- Navigation ----
const nav = document.getElementById('nav');
const main = document.getElementById('main');
let current = null; // { id, cleanup, subs }
let modulesById = new Map();

/** Nur in der Desktop-App vorhanden (preload). Im Browser auf Tablet/Handy passiert nichts. */
const desktop = window.bhDesktop;
let navKey = '';

let generation = 0; // jeder show()-Aufruf bekommt eine Nummer; nur der neueste darf die Ansicht ändern

async function show(id) {
  const gen = ++generation;
  const stale = () => gen !== generation;

  const prev = current;
  current = null; // sofort, damit ein zweiter Aufruf prev nicht noch einmal abbaut
  if (prev) {
    prev.subs.forEach((off) => off());
    try { await prev.cleanup?.(); } catch (err) { console.error(err); }
  }
  if (stale()) return;

  for (const a of nav.querySelectorAll('a')) a.classList.toggle('active', a.dataset.id === id);
  desktop?.setFocusable(!modulesById.get(id)?.noFocus);
  main.replaceChildren();
  if (!id) {
    main.innerHTML = '<p class="muted">Keine Module mit Oberfläche aktiv.</p>';
    return;
  }

  const subs = [];
  const entry = { id, cleanup: null, subs };
  current = entry;
  // Eigener Container pro Modul: schreibt ein altes Modul verspätet hinein, landet das im Leeren
  const root = document.createElement('div');
  main.append(root);
  try {
    const m = await import(`/modules/${id}/index.js`);
    if (stale()) return;
    const cleanup = await m.mount(root, createApi(id, subs));
    if (stale()) {
      // Zu spät fertig geworden: sofort wieder abbauen, ohne die neue Ansicht anzufassen
      subs.forEach((off) => off());
      try { await cleanup?.(); } catch (err) { console.error(err); }
      return;
    }
    entry.cleanup = cleanup;
  } catch (err) {
    console.error(err);
    if (stale()) return;
    const p = document.createElement('p');
    p.className = 'state-failed';
    p.textContent = `Modul "${id}" konnte nicht angezeigt werden: ${err.message}`;
    root.replaceChildren(p);
  }
}

function buildNav(modules) {
  const items = modules.filter((m) => m.state === 'running' && m.ui && m.nav);
  modulesById = new Map(items.map((m) => [m.id, m]));
  const key = items.map((m) => m.id).join(',');
  if (key === navKey) return; // nichts geändert (z. B. nach Reconnect)
  navKey = key;
  nav.replaceChildren();
  for (const m of items) {
    const a = document.createElement('a');
    a.href = `#${m.id}`;
    a.dataset.id = m.id;
    a.textContent = `${m.nav.icon ? m.nav.icon + ' ' : ''}${m.nav.label}`;
    nav.append(a);
  }
  route();
}

function route() {
  const wanted = location.hash.slice(1);
  const ids = [...nav.querySelectorAll('a')].map((a) => a.dataset.id);
  const id = ids.includes(wanted) ? wanted : ids[0] || null;
  if (!current || current.id !== id) show(id);
}

window.addEventListener('hashchange', route);

// Navigation schon vor dem WebSocket per REST aufbauen, damit die Seite schnell erscheint.
get('/api/modules')
  .then((d) => buildNav(d.modules))
  .catch((err) => {
    main.textContent = `Server nicht erreichbar oder Token falsch: ${err.message}`;
  });
connect();
