import { randomUUID } from 'node:crypto';
import type { Logger, WsApi, WsClient } from './types.js';

/** Minimales Interface des ws-Sockets, damit der Core nicht an eine Typ-Bibliothek gebunden ist. */
export interface RawSocket {
  readyState: number;
  send(data: string): void;
  on(event: 'message', cb: (data: unknown) => void): void;
  on(event: 'close' | 'error', cb: () => void): void;
}

const OPEN = 1;

type RawHandler = (payload: unknown, client: ClientEntry) => void | Promise<void>;

interface ClientEntry {
  id: string;
  socket: RawSocket;
  sendRaw(type: string, payload?: unknown): void;
}

export interface WsHub {
  attach(socket: RawSocket, hello: () => unknown): void;
  forModule(moduleId: string): WsApi;
  dropModule(moduleId: string): void;
  clientCount(): number;
}

/**
 * Nachrichten sind JSON: { "type": "<modulId>:<name>", "payload": ... }
 * Jedes Modul sieht nur seinen eigenen Namensraum. Damit können sich Module nicht
 * gegenseitig Handler überschreiben oder Nachrichten abfangen.
 */
export function createWsHub(log: Logger): WsHub {
  const clients = new Map<string, ClientEntry>();
  const handlers = new Map<string, { moduleId: string; fn: RawHandler }>();

  function rawBroadcast(type: string, payload?: unknown) {
    const msg = JSON.stringify({ type, payload });
    for (const c of clients.values()) {
      if (c.socket.readyState === OPEN) c.socket.send(msg);
    }
  }

  return {
    attach(socket, hello) {
      const entry: ClientEntry = {
        id: randomUUID(),
        socket,
        sendRaw(type, payload) {
          if (socket.readyState === OPEN) socket.send(JSON.stringify({ type, payload }));
        },
      };
      clients.set(entry.id, entry);
      log.info(`Client verbunden (${clients.size} aktiv)`);
      entry.sendRaw('core:hello', { clientId: entry.id, ...(hello() as object) });

      socket.on('message', (data) => {
        let msg: { type?: unknown; payload?: unknown };
        try {
          msg = JSON.parse(String(data));
        } catch {
          entry.sendRaw('core:error', { message: 'Ungültiges JSON' });
          return;
        }
        if (typeof msg.type !== 'string') {
          entry.sendRaw('core:error', { message: 'Feld "type" fehlt' });
          return;
        }
        const h = handlers.get(msg.type);
        if (!h) {
          log.debug(`Keine Handler für "${msg.type}"`);
          return;
        }
        Promise.resolve()
          .then(() => h.fn(msg.payload, entry))
          .catch((err) => {
            log.error(`Handler "${msg.type}" fehlgeschlagen:`, err);
            entry.sendRaw('core:error', { message: `Fehler in ${msg.type}` });
          });
      });

      const cleanup = () => {
        if (clients.delete(entry.id)) log.info(`Client getrennt (${clients.size} aktiv)`);
      };
      socket.on('close', cleanup);
      socket.on('error', cleanup);
    },

    forModule(moduleId) {
      const prefix = `${moduleId}:`;
      return {
        on(name, handler) {
          const type = prefix + name;
          if (handlers.has(type)) throw new Error(`WS-Handler "${type}" ist schon vergeben`);
          handlers.set(type, {
            moduleId,
            fn: (payload, c) => {
              const client: WsClient = {
                id: c.id,
                send: (n, p) => c.sendRaw(prefix + n, p),
              };
              return handler(payload, client);
            },
          });
        },
        broadcast: (name, payload) => rawBroadcast(prefix + name, payload),
        clientCount: () => clients.size,
      };
    },

    dropModule(moduleId) {
      for (const [type, h] of handlers) if (h.moduleId === moduleId) handlers.delete(type);
    },

    clientCount: () => clients.size,
  };
}
