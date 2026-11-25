export async function mount(root, api) {
  root.innerHTML = `
    <h2>Controls</h2>
    <p class="muted" id="hint"></p>
    <div id="grid" class="grid"></div>
  `;
  const grid = root.querySelector('#grid');
  const hint = root.querySelector('#hint');
  const els = new Map();

  try {
    const data = await api.get('/api/controls/buttons');
    hint.textContent = `Treiber: ${data.driver}`;
    for (const b of data.buttons) {
      const el = document.createElement('button');
      el.className = 'big';
      el.textContent = b.label;
      el.addEventListener('click', () => {
        if (!api.send('press', { id: b.id })) hint.textContent = 'Keine Verbindung zum PC';
      });
      grid.append(el);
      els.set(b.id, el);
    }
  } catch (err) {
    hint.textContent = 'Fehler: ' + (err.message || err);
  }

  // Rückmeldung vom PC: kurz aufleuchten
  api.on('pressed', ({ id }) => {
    const el = els.get(id);
    if (!el) return;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 200);
  });
}
