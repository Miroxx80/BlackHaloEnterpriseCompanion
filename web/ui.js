// Gemeinsame UI-Helfer für alle Module. Module importieren sie mit: import { el, icon, pageHead } from '/ui.js';
// Die passenden Klassen stehen in shell.css (Bausteine wie .panel, .btn, .field, .chip, .note, .alert ...).
import { hasIcon } from '/icons.js';

const SVG = 'http://www.w3.org/2000/svg';

/**
 * Element bauen. attrs: class, on<Event>, sonst Attribute (true = leeres Attribut, false/null = weglassen).
 * Kinder: Knoten oder Text (Text wird nie als HTML interpretiert).
 */
export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}

/** Icon aus dem Sprite. size: 's' (18px), 'l' (32px) oder Standard (24px). */
export function icon(name, size) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', `ic${size ? ' ic-' + size : ''}`);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', `#i-${hasIcon(name) ? name : 'module'}`);
  svg.append(use);
  return svg;
}

/** Kleine Info-Kapsel: chip('Ziel', 'StarCitizen.exe', true) -> "• Ziel StarCitizen.exe". */
export function chip(label, value, dot = false) {
  return el('span', { class: 'chip' }, dot ? el('span', { class: 'dot' }) : null, label, value != null ? ' ' : null, value != null ? el('b', {}, value) : null);
}

/**
 * Seitenkopf wie im Design: kleine Zeile ("Modul 02 / Mining Companion"), großer Titel, Chips, Aktionen rechts.
 * api: das Modul-API aus der Shell (liefert Nummer, Name, Beschreibung).
 */
export function pageHead(api, { title, eyebrow, meta = [], actions = [] } = {}) {
  const m = api?.meta ?? {};
  const line = eyebrow ?? `Modul ${m.index ?? ''}${m.description ? ' / ' + m.description : ''}`;
  const id = `h-${api?.moduleId ?? 'page'}`;
  return el(
    'div',
    { class: 'page-head' },
    el(
      'div',
      { class: 'page-title' },
      el('span', { class: 'eyebrow' }, line),
      el('h1', { id }, title ?? m.label ?? ''),
      meta.length ? el('div', { class: 'page-meta' }, meta) : null,
    ),
    actions.length ? el('div', { class: 'page-actions' }, actions) : null,
  );
}

/** Kasten mit Kopfzeile: panel({ idx: '01', title: 'Scan', tag: 'optional', actions: [...] }, ...inhalt). */
export function panel({ idx, title, tag, actions = [], id, cls = '' } = {}, ...body) {
  const headId = id ?? (title ? `p-${String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : undefined);
  return el(
    'section',
    { class: `panel ${cls}`.trim(), 'aria-labelledby': title ? headId : null },
    title
      ? el('div', { class: 'panel-head' }, el('h2', { id: headId }, idx ? el('span', { class: 'idx' }, idx) : null, title, tag ? el('span', { class: 'tag' }, tag) : null), actions)
      : null,
    body,
  );
}

/** Knopf. variant: 'primary' | 'ghost' | undefined. iconName optional. */
export function button(label, { variant, iconName, onclick, title, type = 'button', iconOnly = false } = {}) {
  return el(
    'button',
    {
      type,
      class: `btn${variant ? ' btn-' + variant : ''}${iconOnly ? ' btn-icon' : ''}`,
      onclick,
      title: title ?? (iconOnly ? label : null),
      // Immer benennen: Auf dem Handy wird die Beschriftung (.lbl) teils ausgeblendet
      'aria-label': label,
    },
    iconName ? icon(iconName, 's') : null,
    iconOnly ? null : el('span', { class: 'lbl' }, label),
  );
}

/** Hinweis (gelb, mit Warnstreifen) oder Fehler (rot): notice('note'|'alert', text, { title }). */
export function notice(kind, text, { title, iconName } = {}) {
  return el(
    'div',
    { class: kind, role: kind === 'alert' ? 'alert' : null },
    icon(iconName ?? (kind === 'alert' ? 'edge' : 'info')),
    el('p', {}, title ? el('b', {}, title) : null, title ? ' ' : null, text),
  );
}

/** Zahlen deutsch formatieren. */
export const fmtInt = (n) => Math.round(n).toLocaleString('de-DE');
export const fmtDec = (n, d = 2) => n.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
