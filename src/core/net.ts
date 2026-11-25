import { networkInterfaces } from 'node:os';

/** Lokale IPv4-Adressen (ohne Loopback). Praktisch, um die URL für Tablet/Handy anzuzeigen. */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
  }
  return out;
}
