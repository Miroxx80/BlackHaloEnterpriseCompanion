export async function mount(root, api) {
  root.innerHTML = `
    <h2>Gerät verbinden</h2>
    <p class="muted">QR-Code mit dem Tablet oder Handy scannen. Das Gerät muss im selben WLAN sein.</p>
    <div id="list" class="pair-list"></div>
    <p id="note" class="muted"></p>
  `;
  const list = root.querySelector('#list');
  const note = root.querySelector('#note');
  try {
    const data = await api.get('/api/pairing');
    if (data.targets.length === 0) {
      note.textContent = 'Keine Netzwerkadresse gefunden. Ist der PC mit einem Netzwerk verbunden?';
      return;
    }
    for (const t of data.targets) {
      const card = document.createElement('div');
      card.className = 'card pair-card';
      const img = document.createElement('img');
      img.src = t.qr;
      img.alt = `QR-Code für ${t.display}`;
      const url = document.createElement('code');
      url.textContent = t.display;
      card.append(img, url);
      list.append(card);
    }
    note.textContent = data.protected
      ? 'Der QR-Code enthält den Zugangsschlüssel. Nicht öffentlich zeigen (z. B. im Stream).'
      : 'Achtung: Kein Zugangsschlüssel gesetzt. Jedes Gerät im WLAN kann das Tool bedienen.';
  } catch (err) {
    note.textContent = 'Fehler: ' + (err.message || err);
  }
}
