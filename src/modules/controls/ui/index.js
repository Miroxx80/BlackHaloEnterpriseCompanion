export async function mount(root, api) {
  root.innerHTML = `
    <h2>Controls</h2>
    <p class="muted" id="hint"></p>
    <p class="alert" id="alert" hidden></p>
    <div id="grid" class="grid"></div>
  `;
  const grid = root.querySelector('#grid');
  const hint = root.querySelector('#hint');
  const alertEl = root.querySelector('#alert');
  const els = new Map();
  let alertTimer = null;

  function showAlert(text) {
    alertEl.textContent = text;
    alertEl.hidden = false;
    clearTimeout(alertTimer);
    alertTimer = setTimeout(() => (alertEl.hidden = true), 5000);
  }

  function blink(id, cls, ms) {
    const el = els.get(id);
    if (!el) return;
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), ms);
  }

  try {
    const data = await api.get('/api/controls/buttons');
    hint.textContent =
      data.driver === 'mock' ? 'Testmodus: Tastendrücke werden nur protokolliert' : `Ziel: ${data.target}`;
    for (const b of data.buttons) {
      const el = document.createElement('button');
      el.className = 'big';
      const label = document.createElement('span');
      label.textContent = b.label;
      const keys = document.createElement('small');
      keys.className = 'keys';
      keys.textContent = b.hold ? `${b.keys} (halten)` : b.keys;
      el.append(label, keys);
      el.addEventListener('click', () => {
        if (!api.send('press', { id: b.id })) showAlert('Keine Verbindung zum PC');
      });
      grid.append(el);
      els.set(b.id, el);
    }
  } catch (err) {
    showAlert('Fehler: ' + (err.message || err));
  }

  // Rückmeldung vom PC
  api.on('pressed', ({ id }) => blink(id, 'flash', 200));
  api.on('error', ({ id, message }) => {
    showAlert(message);
    if (id) blink(id, 'failed', 600);
  });

  return () => clearTimeout(alertTimer);
}
