/**
 * Tastennamen -> Scancodes (Set 1).
 *
 * Scancodes beschreiben die physische Position einer Taste, nicht das aufgedruckte Zeichen.
 * Die Namen folgen dem US-Layout, so wie Star Citizen sie in seinen Keybinds (actionmaps.xml)
 * verwendet. Auf einer deutschen Tastatur sind dadurch z. B. "y" und "z" vertauscht:
 * "z" ist die Taste links unten neben Shift, auf der "Y" steht. Das entspricht dem, was das Spiel erwartet.
 */

export interface Key {
  name: string;
  scan: number;
  /** Erweiterte Taste (Präfix E0), z. B. Pfeiltasten, rechte Strg/Alt. */
  extended: boolean;
}

/** Eine Kombination: alle Tasten werden der Reihe nach gedrückt und rückwärts losgelassen. */
export interface KeyCombo {
  spec: string;
  keys: Key[];
}

const TABLE: Record<string, [scan: number, extended?: boolean]> = {
  escape: [0x01],
  '1': [0x02], '2': [0x03], '3': [0x04], '4': [0x05], '5': [0x06],
  '6': [0x07], '7': [0x08], '8': [0x09], '9': [0x0a], '0': [0x0b],
  minus: [0x0c], equals: [0x0d], backspace: [0x0e], tab: [0x0f],
  q: [0x10], w: [0x11], e: [0x12], r: [0x13], t: [0x14], y: [0x15], u: [0x16], i: [0x17], o: [0x18], p: [0x19],
  lbracket: [0x1a], rbracket: [0x1b], enter: [0x1c], lctrl: [0x1d],
  a: [0x1e], s: [0x1f], d: [0x20], f: [0x21], g: [0x22], h: [0x23], j: [0x24], k: [0x25], l: [0x26],
  semicolon: [0x27], apostrophe: [0x28], grave: [0x29], lshift: [0x2a], backslash: [0x2b],
  z: [0x2c], x: [0x2d], c: [0x2e], v: [0x2f], b: [0x30], n: [0x31], m: [0x32],
  comma: [0x33], period: [0x34], slash: [0x35], rshift: [0x36],
  np_multiply: [0x37], lalt: [0x38], space: [0x39], capslock: [0x3a],
  f1: [0x3b], f2: [0x3c], f3: [0x3d], f4: [0x3e], f5: [0x3f],
  f6: [0x40], f7: [0x41], f8: [0x42], f9: [0x43], f10: [0x44],
  numlock: [0x45], scrolllock: [0x46],
  np_7: [0x47], np_8: [0x48], np_9: [0x49], np_subtract: [0x4a],
  np_4: [0x4b], np_5: [0x4c], np_6: [0x4d], np_add: [0x4e],
  np_1: [0x4f], np_2: [0x50], np_3: [0x51], np_0: [0x52], np_period: [0x53],
  oem_102: [0x56], // Taste "< >" links neben Y auf deutschen Tastaturen
  f11: [0x57], f12: [0x58],
  // F13 bis F24 gibt es auf normalen Tastaturen nicht. Gut für Binds, die nur das Tool auslöst.
  f13: [0x64], f14: [0x65], f15: [0x66], f16: [0x67], f17: [0x68], f18: [0x69],
  f19: [0x6a], f20: [0x6b], f21: [0x6c], f22: [0x6d], f23: [0x6e], f24: [0x76],
  // Erweiterte Tasten
  np_enter: [0x1c, true], rctrl: [0x1d, true], np_divide: [0x35, true], ralt: [0x38, true],
  home: [0x47, true], up: [0x48, true], pgup: [0x49, true], left: [0x4b, true], right: [0x4d, true],
  end: [0x4f, true], down: [0x50, true], pgdn: [0x51, true], insert: [0x52, true], delete: [0x53, true],
};

const ALIASES: Record<string, string> = {
  esc: 'escape',
  return: 'enter',
  ctrl: 'lctrl',
  strg: 'lctrl',
  shift: 'lshift',
  alt: 'lalt',
  altgr: 'ralt',
  del: 'delete',
  entf: 'delete',
  ins: 'insert',
  einfg: 'insert',
  pageup: 'pgup',
  pagedown: 'pgdn',
  backtick: 'grave',
};

export const KEY_NAMES = Object.keys(TABLE);

export function lookupKey(raw: string): Key {
  const lower = raw.trim().toLowerCase();
  const name = ALIASES[lower] ?? lower;
  const entry = TABLE[name];
  if (!entry) {
    throw new Error(`Unbekannte Taste "${raw}". Beispiele: n, f1, lalt, np_1, space (Liste in keys.ts)`);
  }
  return { name, scan: entry[0], extended: entry[1] ?? false };
}

/** "lalt+n" -> [lalt, n]. Wirft bei unbekannten Tasten, doppelten Tasten oder leerer Angabe. */
export function parseCombo(spec: string): KeyCombo {
  if (typeof spec !== 'string' || spec.trim() === '') throw new Error('Leere Tastenangabe');
  const parts = spec.split('+');
  if (parts.some((p) => p.trim() === '')) throw new Error(`Ungültige Tastenangabe "${spec}"`);
  const keys = parts.map(lookupKey);
  const names = new Set(keys.map((k) => k.name));
  if (names.size !== keys.length) throw new Error(`Taste doppelt in "${spec}"`);
  if (keys.length > 4) throw new Error(`Höchstens 4 Tasten pro Kombination ("${spec}")`);
  return { spec: keys.map((k) => k.name).join('+'), keys };
}
