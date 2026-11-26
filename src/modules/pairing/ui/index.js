// UI-Vertrag: export function mount(root, api) -> optional Cleanup-Funktion
import { el, icon, pageHead, notice } from '/ui.js';

export async function mount(root, api) {
  const list = el('div', { class: 'pairs', id: 'pairing-list' });
  const note = el('div', { id: 'pairing-note' });

  root.replaceChildren(
    pageHead(api, { title: 'Verbinden' }),
    el(
      'p',
      { class: 'lead' },
      'QR-Code mit dem Tablet oder Handy scannen. Das Gerät muss im selben Netzwerk sein. ' +
        'Bei mehreren Codes meist den mit „WLAN“ oder „Ethernet“ nehmen.',
    ),
    list,
    note,
  );

  try {
    const data = await api.get('/api/pairing');
    if (data.targets.length === 0) {
      list.remove();
      note.replaceChildren(notice('note', 'Keine Netzwerkadresse gefunden. Ist der PC mit einem Netzwerk verbunden?'));
      return;
    }
    for (const t of data.targets) {
      const card = el(
        'div',
        { class: `panel pair${t.virtual ? ' virtual' : ''}` },
        el('h3', {}, t.adapter),
        el(
          'div',
          { class: 'qr' },
          el('img', { src: t.qr, alt: `QR-Code für ${t.display}` }),
        ),
        el('code', {}, t.display),
        t.virtual ? el('span', { class: 'badge' }, 'Virtueller Adapter, meist nicht der richtige') : null,
      );
      list.append(card);
    }
    note.style.marginTop = '20px';
    note.replaceChildren(
      data.protected
        ? el(
            'div',
            { class: 'advice' },
            icon('shield'),
            el(
              'p',
              {},
              el('strong', {}, 'Zugangsschlüssel im Code'),
              el('span', { class: 'sub' }, 'Der QR-Code enthält den Zugangsschlüssel. Nicht öffentlich zeigen (z. B. im Stream).'),
            ),
          )
        : notice('alert', 'Kein Zugangsschlüssel gesetzt. Jedes Gerät im WLAN kann das Tool bedienen.', { title: 'Achtung:' }),
    );
  } catch (err) {
    list.remove();
    note.replaceChildren(notice('alert', String(err.message || err), { title: 'Fehler:' }));
  }
}
