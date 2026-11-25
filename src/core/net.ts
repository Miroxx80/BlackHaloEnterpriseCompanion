import { networkInterfaces } from 'node:os';

export interface LanInterface {
  /** Name des Adapters, wie Windows ihn anzeigt (z. B. "WLAN", "Ethernet"). */
  name: string;
  address: string;
  /** Wahrscheinlich ein virtueller Adapter (VM, WSL, VPN ...). Selten die richtige Wahl fürs Tablet. */
  virtual: boolean;
}

const VIRTUAL = /virtualbox|vmware|vethernet|hyper-v|wsl|docker|vpn|bluetooth|zerotier|tailscale|hamachi|npcap|\b(tap|tun)\b/i;

/**
 * Lokale IPv4-Adressen, über die Tablet/Handy den PC erreichen können.
 * Ohne Loopback und ohne 169.254.x.x: Diese Adressen vergibt Windows selbst, wenn ein Adapter
 * keine Adresse bekommt (z. B. kein Kabel), darüber ist nichts erreichbar.
 * Echte Adapter zuerst, virtuelle am Ende.
 */
export function lanInterfaces(ifaces: ReturnType<typeof networkInterfaces> = networkInterfaces()): LanInterface[] {
  const out: LanInterface[] = [];
  for (const [name, list] of Object.entries(ifaces)) {
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal || i.address.startsWith('169.254.')) continue;
      out.push({ name, address: i.address, virtual: VIRTUAL.test(name) });
    }
  }
  return out.sort((a, b) => Number(a.virtual) - Number(b.virtual));
}

/** Nur die Adressen, z. B. um die URL für Tablet/Handy anzuzeigen. */
export function lanAddresses(): string[] {
  return lanInterfaces().map((i) => i.address);
}
