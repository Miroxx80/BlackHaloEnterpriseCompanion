import type { EventBus, Logger, ServiceRegistry } from './types.js';

/** Einfacher Event-Bus. Ein fehlerhafter Handler darf andere Handler nicht stören. */
export function createEventBus(log: Logger): EventBus {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  return {
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
      return () => handlers.get(event)?.delete(handler);
    },
    emit(event, payload) {
      for (const h of handlers.get(event) ?? []) {
        try {
          h(payload);
        } catch (err) {
          log.error(`Event-Handler für "${event}" fehlgeschlagen:`, err);
        }
      }
    },
  };
}

/** Lose Kopplung zwischen Modulen: Ein Modul stellt etwas bereit, ein anderes nutzt es. */
export function createServiceRegistry(): ServiceRegistry {
  const services = new Map<string, unknown>();
  return {
    provide(name, impl) {
      if (services.has(name)) throw new Error(`Service "${name}" ist schon vergeben`);
      services.set(name, impl);
    },
    get<T>(name: string) {
      return services.get(name) as T | undefined;
    },
    require<T>(name: string) {
      if (!services.has(name)) throw new Error(`Benötigter Service "${name}" fehlt`);
      return services.get(name) as T;
    },
  };
}
