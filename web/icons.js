// Icon-Sammlung (24er Raster, 2px Strich, eckige Enden). Wird einmal als SVG-Sprite in die Seite gelegt,
// danach überall per <svg class="ic"><use href="#i-name"/></svg> verwendet (siehe ui.js: icon()).
//
// Module wählen ihr Navigations-Icon im Manifest (nav.icon) und Controls-Buttons per "icon" in der Config.
// Unbekannte Namen fallen auf "module" zurück.

export const ICONS = {
  // Navigation
  controls: '<path d="M6 3v6M6 13v8M4 9h4v4H4zM12 3v10M12 17v4M10 13h4v4h-4zM18 3v2M18 9v12M16 5h4v4h-4z"/>',
  mining: '<path d="M4 20 16.5 7.5"/><path d="M9.5 3.5Q19 4 20.5 14.5"/>',
  pairing: '<path d="M3 8h9v13H3zM6.5 18h2"/><path d="M15 2.5a6.5 6.5 0 0 1 6.5 6.5M15 6a3 3 0 0 1 3 3"/>',
  status: '<path d="M2 12h4l3-7 6 14 3-7h4"/>',
  module: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',

  // Allgemein
  reset: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 3v5h-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  wrench: '<path d="M14.5 3.5a5 5 0 0 0-5.3 6.6L3 16.3 7.7 21l6.2-6.2a5 5 0 0 0 6.6-5.3l-3 3-3.3-.7-.7-3.3z"/>',
  check: '<path d="M3 4h18v16H3z"/><path d="M7.5 12.5l3 3 6-7"/>',
  edge: '<path d="M12 3 22 20H2z"/><path d="M12 9.5v4.5M12 17v.2"/>',
  ban: '<path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7"/>',
  gadget: '<path d="M12 2.5 20.5 7.5v9L12 21.5 3.5 16.5v-9z"/><path d="M12 8.5l3 3.5-3 3.5-3-3.5z"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  info: '<path d="M3 3h18v18H3z"/><path d="M12 11v6M12 7.5v.2"/>',
  ship: '<path d="M12 2l3 7 6 3-6 3-3 7-3-7-6-3 6-3z"/>',
  plug: '<path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5"/>',
  unplug: '<path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5"/><path d="M3 3l18 18"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  swap: '<path d="M3 8h16M15 4l4 4-4 4M21 16H5M9 12l-4 4 4 4"/>',
  shield: '<path d="M12 2.5 20 6v6c0 4.5-3.4 8-8 9.5C7.4 20 4 16.5 4 12V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  cpu: '<path d="M6 6h12v12H6zM10 10h4v4h-4zM9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  save: '<path d="M4 3h13l3 3v15H4z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>',
  trash: '<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15"/><path d="M10 10v7M14 10v7"/>',
  copy: '<path d="M8 8h13v13H8z"/><path d="M16 8V3H3v13h5"/>',
  log: '<path d="M4 3h16v18H4z"/><path d="M8 8h8M8 12h8M8 16h5"/>',

  // Controls (Spielfunktionen)
  key: '<path d="M3 6h18v12H3z"/><path d="M7 10h2M11 10h2M15 10h2M8 14h8"/>',
  gear: '<path d="M12 2.5v8M8 2.5h8"/><path d="M7 16a5 5 0 1 0 10 0a5 5 0 1 0-10 0z"/><path d="M12 15.5v1"/>',
  lights: '<path d="M10 5C5.5 5 3 8 3 12s2.5 7 7 7z"/><path d="M14 7h7M14 12h7M14 17h7"/>',
  quantum: '<path d="M3 6l6 6-6 6M10 6l6 6-6 6M20 4v16"/>',
  scan: '<path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 7.5a4.5 4.5 0 1 0 4.5 4.5"/><path d="M12 12l7-7"/>',
  exit: '<path d="M11 3H4v18h7"/><path d="M9 12h12M17 8l4 4-4 4"/>',
  power: '<path d="M12 2.5v9"/><path d="M6.3 6.3a8 8 0 1 0 11.4 0"/>',
  mine: '<path d="M12 2v6M12 16v6M2 12h6M16 12h6"/><path d="M9 9h6v6H9z"/>',
  missile: '<path d="M14 4h6v6L10.5 19.5l-6-6z"/><path d="M7.5 16.5 3 21M4.5 13.5l-1.5-3 4-.5M10.5 19.5l3 1.5.5-4"/>',
  shieldUp: '<path d="M12 2.5 20 6v6c0 4.5-3.4 8-8 9.5C7.4 20 4 16.5 4 12V6z"/><path d="M12 8v7M9 11l3-3 3 3"/>',
  door: '<path d="M5 3h11v18H5z"/><path d="M16 5h3v16"/><path d="M12 12v.5"/>',
  camera: '<path d="M3 7h13v10H3z"/><path d="M16 10.5 21 8v8l-5-2.5"/>',
  target: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><path d="M7 12a5 5 0 1 0 10 0a5 5 0 1 0-10 0z"/>',
};

/** Legt das Sprite einmal in die Seite. */
export function installIcons(doc = document) {
  if (doc.getElementById('bh-icon-sprite')) return;
  const symbols = Object.entries(ICONS)
    .map(([name, body]) => `<symbol id="i-${name}" viewBox="0 0 24 24">${body}</symbol>`)
    .join('');
  const holder = doc.createElement('div');
  holder.innerHTML = `<svg id="bh-icon-sprite" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${symbols}</defs></svg>`;
  doc.body.prepend(holder.firstElementChild);
}

export const hasIcon = (name) => Object.prototype.hasOwnProperty.call(ICONS, name);
