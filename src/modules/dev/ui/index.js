// Menü "Dev": Schalter für die Entwicklung des Tools (z. B. Scans als Bild speichern) und die Größe der
// gespeicherten Beispiel-Ordner. Für normales Spielen bleibt alles aus. Stand gilt für alle Geräte (PC speichert).
// Aussehen: gemeinsame Bausteine aus shell.css, hier nur wenige Ergänzungen mit Präfix "dv-".
import { el, pageHead, panel, button, notice, fmtInt } from '/ui.js';

const STYLE = `
.dv-list { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; }
.dv-row { display: grid; grid-template-columns: minmax(0, 1fr) 180px; gap: 8px 20px; align-items: center; padding: 16px 0; border-bottom: var(--bw) solid color-mix(in srgb, var(--line) 60%, transparent); }
.dv-row:first-child { padding-top: 0; }
.dv-row:last-child { border-bottom: 0; padding-bottom: 0; }
.dv-row h3 { margin: 0 0 4px; font-family: var(--font-head); font-stretch: 87.5%; font-size: 17px; font-weight: 700; letter-spacing: .02em; }
.dv-row p { margin: 0; font-size: var(--fs-s); color: var(--text-dim); line-height: 1.5; }
.dv-seg { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.dv-seg .seg-btn[data-v="off"] { --sw: var(--s3, var(--line-strong)); }
.dv-seg .seg-btn[data-v="off"][aria-pressed="true"] { color: var(--text); }
.dv-seg .seg-btn[data-v="on"] { --sw: var(--amber); }
.dv-seg .seg-btn[data-v="on"][aria-pressed="true"] { color: var(--on-amber); }
.dv-store { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 20px; align-items: center; padding: 14px 0; border-bottom: var(--bw) solid color-mix(in srgb, var(--line) 60%, transparent); }
.dv-store:first-child { padding-top: 0; }
.dv-store:last-child { border-bottom: 0; padding-bottom: 0; }
.dv-store .dv-name { font-weight: 600; }
.dv-store .dv-size { font-family: var(--font-head); font-stretch: 87.5%; font-size: 17px; font-weight: 700; color: var(--text); margin-left: 8px; }
.dv-store .dv-path { grid-column: 1 / -1; font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--text-faint); overflow-wrap: anywhere; }
.dv-store .dv-meta { font-size: var(--fs-s); color: var(--text-dim); }
.dv-msg { margin: 12px 0 0; font-size: var(--fs-s); color: var(--text-dim); }
.dv-msg:empty { margin: 0; } /* leer, aber im Barrierefreiheits-Baum, damit Meldungen vorgelesen werden */
.dv > .note, .dv > .panel { margin-bottom: 20px; }
.dv .btn[aria-disabled="true"] { opacity: .45; cursor: default; }
.dv .btn.dv-armed { border-color: var(--bad); color: var(--bad); }
@media (max-width: 620px) {
  .dv-row { grid-template-columns: minmax(0, 1fr); }
  .dv-store { grid-template-columns: minmax(0, 1fr); }
}
`;

const TOGGLES = [
  {
    key: 'saveOcrSamples',
    title: 'OCR-Scans als Bild speichern',
    text: 'Speichert bei jedem „Einlesen“ den Bildausschnitt mit dem Ergebnis (die letzten 60). „Alles geprüft“ legt den korrigierten Scan als Wahrheit dazu (bis 200). Das sind Trainingsdaten, um die Texterkennung zu verbessern. Ca. 0,5 MB pro Scan.',
  },
  {
    key: 'saveSignatureSamples',
    title: 'Radar-Bilder speichern',
    text: 'Speichert beim Live-Lesen der Radar-Signaturen das Bild, wenn eine neue Zahl erkannt wurde (die letzten 60). Trainingsdaten für eine spätere eigene Erkennung.',
  },
];

/** 1234567 -> "1,2 MB" */
function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;
  return `${(n / 1024 / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 2 })} GB`;
}

export function mount(root, api) {
  if (!document.getElementById('dv-style')) document.head.append(el('style', { id: 'dv-style' }, STYLE));

  let state = null;
  let disposed = false;
  /** Zeigt msg gerade "nicht erreichbar"? Dann beim nächsten Erfolg leeren (eine Speicher-Fehlermeldung bleibt stehen). */
  let unreachable = false;
  const msg = el('p', { class: 'dv-msg', role: 'status', 'aria-live': 'polite' });
  const storeMsg = el('p', { class: 'dv-msg', role: 'status', 'aria-live': 'polite' });

  // ---- Schalter ----
  const rows = TOGGLES.map((t) => {
    const off = el('button', { type: 'button', class: 'seg-btn', 'data-v': 'off', 'aria-pressed': 'false' }, 'Aus');
    const on = el('button', { type: 'button', class: 'seg-btn', 'data-v': 'on', 'aria-pressed': 'false' }, 'An');
    const seg = el('div', { class: 'seg dv-seg', role: 'group', 'aria-label': t.title }, off, on);
    off.addEventListener('click', () => set(t.key, false));
    on.addEventListener('click', () => set(t.key, true));
    const li = el('li', { class: 'dv-row' }, el('div', {}, el('h3', {}, t.title), el('p', {}, t.text)), seg);
    return { key: t.key, li, off, on };
  });
  const list = el('ul', { class: 'dv-list' }, ...rows.map((r) => r.li));

  // ---- Gespeicherte Bilder ----
  const stores = el('div', {});
  const storeRows = new Map();
  /** Ordner, dessen Löschen gerade auf die Bestätigung wartet. */
  let armed = null;
  let armTimer = null;
  let storeIds = '';

  function render() {
    if (!state) return;
    for (const r of rows) {
      const v = Boolean(state.settings?.[r.key]);
      r.off.setAttribute('aria-pressed', String(!v));
      r.on.setAttribute('aria-pressed', String(v));
    }
    if (!state.stores?.length) {
      storeRows.clear();
      stores.replaceChildren(el('p', { class: 'dv-msg' }, 'Keine Beispiel-Ordner (Mining-Modul läuft nicht).'));
      return;
    }
    // Zeilen bleiben bestehen und werden nur aktualisiert: Neu bauen würde den Fokus vom Löschen-Knopf nehmen
    // (Tastatur, Screenreader), z. B. beim regelmäßigen Neuladen oder zwischen den zwei Klicks.
    const ids = state.stores.map((s) => s.id).join(',');
    if (ids !== storeIds) {
      storeIds = ids;
      storeRows.clear();
      stores.replaceChildren(
        ...state.stores.map((s) => {
          const del = button('Löschen', { iconName: 'trash', onclick: () => clear(s.id) });
          const name = el('span', { class: 'dv-name' });
          const size = el('span', { class: 'dv-size' });
          const meta = el('div', { class: 'dv-meta' });
          const path = el('span', { class: 'dv-path' });
          storeRows.set(s.id, { del, name, size, meta, path });
          return el('div', { class: 'dv-store' }, el('div', {}, name, size, meta), del, path);
        }),
      );
    }
    for (const s of state.stores) {
      const r = storeRows.get(s.id);
      const ask = armed === s.id;
      r.name.textContent = s.label;
      r.size.textContent = fmtBytes(s.bytes);
      r.meta.textContent = s.error ? `Fehler: ${s.error}` : s.samples === 1 ? '1 Bild' : `${fmtInt(s.samples)} Bilder`;
      r.path.textContent = s.path;
      r.del.querySelector('.lbl').textContent = ask ? 'Wirklich löschen?' : 'Löschen';
      r.del.setAttribute('aria-label', ask ? `${s.label} wirklich löschen?` : `${s.label} löschen`);
      r.del.classList.toggle('dv-armed', ask);
      // aria-disabled statt disabled: Der Knopf behält den Fokus, auch wenn der Ordner gerade leer geworden ist
      r.del.setAttribute('aria-disabled', String(!s.files));
    }
  }

  async function set(key, value) {
    if (state?.settings?.[key] === value) return;
    try {
      state = await api.post('/api/dev/settings', { [key]: value });
      msg.textContent = '';
      unreachable = false;
      render();
    } catch (err) {
      msg.textContent = `Nicht gespeichert: ${err.message}`;
    }
  }

  // Löschen in zwei Schritten: erst fragen, dann löschen. Die Bestätigung verfällt nach 4 s und übersteht
  // das regelmäßige Neuzeichnen (armed merkt sich den Ordner, nicht den Knopf).
  async function clear(id) {
    const store = state?.stores?.find((s) => s.id === id);
    if (!store || !store.files) return;
    if (armed !== id) {
      armed = id;
      clearTimeout(armTimer);
      armTimer = setTimeout(() => {
        armed = null;
        render();
      }, 4000);
      render();
      return;
    }
    armed = null;
    clearTimeout(armTimer);
    try {
      const out = await api.post('/api/dev/clear', { store: id });
      if (disposed) return;
      state = out;
      storeMsg.textContent = `${store.label}: ${out.deleted} Datei(en) gelöscht.`;
    } catch (err) {
      storeMsg.textContent = `Löschen fehlgeschlagen: ${err.message}`;
    }
    render();
  }

  async function refresh() {
    try {
      const s = await api.get('/api/dev');
      if (disposed) return;
      state = s;
      if (unreachable) msg.textContent = '';
      unreachable = false;
      render();
    } catch (err) {
      if (disposed) return;
      unreachable = true;
      msg.textContent = `Dev-Einstellungen nicht erreichbar: ${err.message}`;
    }
  }
  api.on('state', (s) => {
    state = s;
    if (unreachable) msg.textContent = '';
    unreachable = false;
    render();
  });

  root.classList.add('dv');
  root.replaceChildren(
    pageHead(api, { title: 'Dev', eyebrow: 'Entwickler-Einstellungen' }),
    notice('note', 'Nur für die Entwicklung des Tools. Für normales Spielen alles auf „Aus“ lassen, dann speichert das Tool keine Bilder. Gilt für alle Geräte.', { iconName: 'info' }),
    panel({ idx: '01', title: 'Speichern', id: 'dev-h-save' }, el('div', { class: 'panel-body' }, list, msg)),
    panel({ idx: '02', title: 'Gespeicherte Bilder', id: 'dev-h-store', tag: 'auf dem PC' }, el('div', { class: 'panel-body' }, stores, storeMsg)),
  );
  refresh();
  // Größe der Ordner ab und zu neu lesen (Scans kommen auch von anderen Geräten)
  const timer = setInterval(refresh, 10000);
  return () => {
    disposed = true;
    clearInterval(timer);
    clearTimeout(armTimer);
  };
}
