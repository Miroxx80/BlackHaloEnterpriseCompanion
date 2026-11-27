// Die Shell: Verbindung, Navigation und Laden der Modul-UIs. Kennt keine konkreten Module.
import { installIcons } from '/icons.js';
import { icon } from '/ui.js';

installIcons();
for (const slot of document.querySelectorAll('.mark-slot')) {
  slot.replaceWith(document.getElementById('brand-mark-tpl').content.cloneNode(true));
}

const store = {
  get(k) {
    try { return localStorage.getItem(k) || ''; } catch { return ''; }
  },
  set(k, v) {
    try { localStorage.setItem(k, v); } catch { /* Speicher nicht verfügbar */ }
  },
};

// Muss zu src/core/token.ts passen: nur sichtbare ASCII-Zeichen. Alles andere würde jede Anfrage
// im Browser scheitern lassen ("non ISO-8859-1 code point") und wird deshalb verworfen.
const validToken = (t) => /^[\x21-\x7e]{1,256}$/.test(t);

const params = new URLSearchParams(location.search);
const urlToken = params.get('token');
if (urlToken !== null) {
  if (validToken(urlToken)) store.set('bh-token', urlToken);
  // Token aus der Adresszeile entfernen, damit es nicht sichtbar bleibt (Screenshots, Streams)
  params.delete('token');
  const rest = params.toString();
  history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
}
let token = store.get('bh-token');
if (token && !validToken(token)) {
  store.set('bh-token', '');
  token = '';
}

// ---- REST ----
async function request(method, path, body, rawType) {
  const headers = token ? { 'x-bh-token': token } : {};
  if (rawType) headers['content-type'] = rawType;
  else if (body !== undefined) headers['content-type'] = 'application/json';
  const payload = body === undefined ? undefined : rawType ? body : JSON.stringify(body);
  const res = await fetch(path, { method, headers, body: payload });
  if (res.status === 401) {
    throw Object.assign(
      new Error('Zugangsschlüssel fehlt oder ist falsch. Bitte am PC unter „Verbinden“ den QR-Code neu scannen.'),
      { auth: true },
    );
  }
  if (!res.ok) {
    // Module liefern verständliche Meldungen als { error } (z. B. Eingabefehler, HTTP 400)
    let message = `${path}: HTTP ${res.status}`;
    let data = null;
    try {
      data = await res.json();
      if (data && typeof data.error === 'string') message = data.error;
    } catch { /* keine JSON-Antwort */ }
    // body: die ganze Antwort, z. B. der aktuelle Stand bei einem Konflikt (409)
    throw Object.assign(new Error(message), { status: res.status, body: data });
  }
  return res.json();
}

const get = (path) => request('GET', path);
const post = (path, body) => request('POST', path, body ?? {});
const put = (path, body) => request('PUT', path, body ?? {});
/** Rohe Daten senden (z. B. ein Bild als Blob). */
const postRaw = (path, body, contentType) => request('POST', path, body, contentType || 'application/octet-stream');

// ---- Verbindungsanzeige ----
const connState = document.querySelector('#conn .conn-state');
const connMeta = document.getElementById('conn-meta');
const pillText = document.querySelector('#conn-pill .pill-text');
let everConnected = false;

function setOnline(online) {
  // Vor dem ersten Verbindungsaufbau kein Alarm, nur "Verbinde"
  document.body.classList.toggle('offline', !online && everConnected);
  connState.textContent = online ? 'Verbunden' : everConnected ? 'Getrennt' : 'Verbinde';
  pillText.textContent = online ? 'Online' : everConnected ? 'Offline' : 'Verbinde';
}
connMeta.textContent = location.host;

// ---- WebSocket mit Auto-Reconnect ----
const listeners = new Map(); // type -> Set<fn>
let socket = null;
let retry = 1000;

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${proto}://${location.host}/ws${token ? '?token=' + encodeURIComponent(token) : ''}`);
  socket.onopen = () => {
    retry = 1000;
    everConnected = true;
    setOnline(true);
  };
  socket.onclose = () => {
    setOnline(false);
    setTimeout(connect, retry);
    retry = Math.min(retry * 1.5, 5000);
  };
  socket.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'core:hello') {
      buildNav(msg.payload.modules);
      document.getElementById('rail-foot').textContent = `BHE-COMPANION v${msg.payload.version ?? '?'} · ${msg.payload.role}`;
      get('/api/status/update').then(showUpdateBadge).catch(() => {});
    }
    if (msg.type === 'status:update') showUpdateBadge(msg.payload);
    for (const fn of listeners.get(msg.type) ?? []) {
      try { fn(msg.payload); } catch (err) { console.error(err); }
    }
  };
}

/** Hinweis unten in der Seitenleiste, wenn eine neue Version bereitsteht (Link zur Status-Seite). */
function showUpdateBadge(u) {
  const foot = document.getElementById('rail-foot');
  foot.querySelector('.upd-badge')?.remove();
  if (u?.status !== 'available') return;
  const a = document.createElement('a');
  a.className = 'upd-badge';
  a.href = '#status';
  a.textContent = `Update v${u.latest} verfügbar`;
  foot.append(a);
}

// ---- API, das jedes Modul bekommt ----
function createApi(moduleId, subs, meta) {
  return {
    moduleId,
    /** Für den Seitenkopf: { index: '02', label: 'Mining', description: 'Mining Companion', icon } */
    meta,
    get,
    post,
    put,
    postRaw,
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
const view = document.getElementById('view');
let current = null; // { id, cleanup, subs }
let navKey = '';
let metaById = new Map();

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

  for (const a of nav.querySelectorAll('a.nav-item')) {
    if (a.dataset.id === id) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  document.body.dataset.view = id ?? '';
  view.replaceChildren();
  if (!id) {
    view.innerHTML = '<p class="empty">Keine Module mit Oberfläche aktiv.</p>';
    return;
  }

  const subs = [];
  const entry = { id, cleanup: null, subs };
  current = entry;
  // Eigener Container pro Modul: schreibt ein altes Modul verspätet hinein, landet das im Leeren
  const root = document.createElement('section');
  root.className = 'view';
  root.setAttribute('aria-labelledby', `h-${id}`);
  view.append(root);
  try {
    const m = await import(`/modules/${id}/index.js`);
    if (stale()) return;
    const cleanup = await m.mount(root, createApi(id, subs, metaById.get(id)));
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
    p.className = 'alert view-error';
    p.textContent = `Modul "${id}" konnte nicht angezeigt werden: ${err.message}`;
    root.replaceChildren(p);
  }
}

function buildNav(modules) {
  const items = modules.filter((m) => m.state === 'running' && m.ui && m.nav);
  const key = items.map((m) => m.id).join(',');
  if (key === navKey) return; // nichts geändert (z. B. nach Reconnect)
  navKey = key;
  metaById = new Map(
    items.map((m, i) => [
      m.id,
      { index: String(i + 1).padStart(2, '0'), label: m.nav.label, description: m.nav.description ?? m.name, icon: m.nav.icon },
    ]),
  );
  for (const a of nav.querySelectorAll('a.nav-item')) a.remove();
  for (const m of items) {
    const meta = metaById.get(m.id);
    const a = document.createElement('a');
    a.className = 'nav-item';
    a.href = `#${m.id}`;
    a.dataset.id = m.id;
    const label = document.createElement('span');
    label.textContent = m.nav.label;
    const idx = document.createElement('span');
    idx.className = 'nav-idx';
    idx.textContent = meta.index;
    a.append(icon(m.nav.icon ?? 'module'), label, idx);
    nav.append(a);
  }
  route();
}

function route() {
  const wanted = location.hash.slice(1);
  const ids = [...nav.querySelectorAll('a.nav-item')].map((a) => a.dataset.id);
  const id = ids.includes(wanted) ? wanted : ids[0] || null;
  if (!current || current.id !== id) show(id);
}

window.addEventListener('hashchange', route);

// Navigation schon vor dem WebSocket per REST aufbauen, damit die Seite schnell erscheint.
get('/api/modules')
  .then((d) => buildNav(d.modules))
  .catch((err) => {
    // Schlüssel-Fehler sind schon verständlich formuliert, alles andere ist meist ein Netzwerkproblem
    const p = document.createElement('p');
    p.className = 'alert view-error';
    p.textContent = err.auth ? err.message : `Server nicht erreichbar: ${err.message}`;
    view.replaceChildren(p);
  });
setOnline(false);
connect();
