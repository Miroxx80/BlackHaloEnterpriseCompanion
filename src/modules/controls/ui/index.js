import { el, icon, chip, pageHead, panel, button, fmtDec } from '/ui.js';

const ALERT_MS = 6000;
const FLASH_MS = 220;
const FAILED_MS = 700;
const LOG_MAX = 12;

export async function mount(root, api) {
  const els = new Map(); // id -> Knopf
  const byId = new Map(); // id -> Button-Daten
  const timers = new Set();
  let alertTimer = null;

  // ---- Grundgerüst ----
  const head = pageHead(api, { title: 'Controls' });
  const meta = el('div', { class: 'page-meta' });

  const alertText = el('p');
  const alertEl = el(
    'div',
    { class: 'alert', role: 'alert', hidden: true },
    icon('edge'),
    alertText,
    button('Meldung schließen', { variant: 'ghost', iconName: 'x', iconOnly: true, onclick: hideAlert }),
  );

  const keys = el('div', { class: 'keys' });
  const logList = el('ul', { class: 'log', hidden: true });
  const logEmpty = el('p', { class: 'panel-body empty' }, 'Noch keine Eingaben.');
  const logPanel = panel({ idx: 'LOG', title: 'Rückmeldung', id: 'h-controls-log' }, logList, logEmpty);

  root.append(head, alertEl, el('div', { class: 'controls-grid' }, keys, logPanel));

  function later(fn, ms) {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
    return t;
  }

  function hideAlert() {
    clearTimeout(alertTimer);
    alertTimer = null;
    alertEl.hidden = true;
  }

  /** Fehlermeldung zeigen. title: optional fett davor (z. B. Button-Name). autoHide: nach ALERT_MS ausblenden. */
  function showAlert(text, { title, autoHide = true } = {}) {
    alertText.replaceChildren(...(title ? [el('b', {}, title), ' '] : []), text);
    alertEl.hidden = false;
    clearTimeout(alertTimer);
    alertTimer = autoHide ? setTimeout(hideAlert, ALERT_MS) : null;
  }

  const blinkTimers = new Map(); // `${id}:${cls}` -> Timer
  function blink(id, cls, ms) {
    const b = els.get(id);
    if (!b) return;
    const k = `${id}:${cls}`;
    clearTimeout(blinkTimers.get(k));
    timers.delete(blinkTimers.get(k));
    b.classList.remove(cls);
    void b.offsetWidth; // Animation neu starten, wenn schnell hintereinander gedrückt wird
    b.classList.add(cls);
    blinkTimers.set(k, later(() => b.classList.remove(cls), ms));
  }

  function log(label, keySpec, ok) {
    const time = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    logList.prepend(
      el(
        'li',
        {},
        el('time', {}, time),
        el('span', {}, label, keySpec ? el('kbd', {}, keySpec) : null),
        el('span', { class: `st ${ok ? 'ok' : 'bad'}` }, ok ? 'Gesendet' : 'Fehler'),
      ),
    );
    while (logList.children.length > LOG_MAX) logList.lastElementChild.remove();
    logList.hidden = false;
    logEmpty.hidden = true;
  }

  // ---- Rückmeldung vom PC ----
  api.on('pressed', ({ id, label } = {}) => {
    const b = byId.get(id);
    blink(id, 'flash', FLASH_MS);
    log(b?.label ?? label ?? id ?? 'Unbekannt', b?.keys, true);
  });
  api.on('error', ({ id, message } = {}) => {
    const b = id ? byId.get(id) : undefined;
    showAlert(message ?? 'Unbekannter Fehler', { title: b?.label });
    if (id) blink(id, 'failed', FAILED_MS);
    log(b?.label ?? 'Eingabe', b?.keys, false);
  });

  // ---- Buttons laden ----
  try {
    const data = await api.get('/api/controls/buttons');
    meta.append(
      data.driver === 'mock' ? chip('Testmodus', 'nur Protokoll') : chip('Ziel', data.target, true),
      chip('Treiber', data.driver),
    );
    head.querySelector('.page-title').append(meta);

    for (const b of data.buttons) {
      const holdText = b.hold ? `Halten · ${fmtDec(b.hold / 1000, 1)} s` : '';
      const key = el(
        'button',
        {
          type: 'button',
          class: 'key',
          'data-id': b.id,
          'aria-label': `${b.label}, Taste ${b.keys}${b.hold ? ', wird gehalten' : ''}`,
          onclick: () => {
            if (!api.send('press', { id: b.id })) {
              showAlert('Keine Verbindung zum PC', { title: b.label });
              blink(b.id, 'failed', FAILED_MS);
              log(b.label, b.keys, false);
            }
          },
        },
        el('span', { class: 'key-top' }, icon(b.icon ?? 'key', 'l'), el('span', { class: 'keycap' }, b.keys)),
        el('span', { class: 'key-label' }, b.label),
        el('span', { class: `key-meta${b.hold ? ' hold' : ''}` }, holdText),
      );
      keys.append(key);
      els.set(b.id, key);
      byId.set(b.id, b);
    }
    if (!data.buttons.length) keys.append(el('p', { class: 'empty' }, 'Keine Buttons konfiguriert.'));
  } catch (err) {
    // Ohne Buttons ist die Seite leer: Meldung stehen lassen statt automatisch auszublenden
    showAlert(err.message || String(err), { title: 'Fehler', autoHide: false });
  }

  return () => {
    clearTimeout(alertTimer);
    for (const t of timers) clearTimeout(t);
    timers.clear();
  };
}
