import type { EventBus, Logger, ServiceRegistry } from './types.js';

/** Sicht eines Moduls auf Bus bzw. Registry. release() nimmt alles zurück, was das Modul angemeldet hat. */
export interface Scoped<T> {
  api: T;
  release(): void;
}

export interface CoreEventBus extends EventBus {
  forModule(moduleId: string): Scoped<EventBus>;
}

export interface CoreServiceRegistry extends ServiceRegistry {
  forModule(moduleId: string): Scoped<ServiceRegistry>;
}

/** Einfacher Event-Bus. Ein fehlerhafter Handler darf andere Handler nicht stören. */
export function createEventBus(log: Logger): CoreEventBus {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();

  const on: EventBus['on'] = (event, handler) => {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event)!.add(handler);
    return () => {
      handlers.get(event)?.delete(handler);
    };
  };

  const emit: EventBus['emit'] = (event, payload) => {
    // Kopie, damit Handler, die sich während emit an- oder abmelden, die Schleife nicht stören
    for (const h of [...(handlers.get(event) ?? [])]) {
      try {
        h(payload);
      } catch (err) {
        log.error(`Event-Handler für "${event}" fehlgeschlagen:`, err);
      }
    }
  };

  return {
    on,
    emit,
    forModule() {
      const offs = new Set<() => void>();
      return {
        api: {
          on(event, handler) {
            const off = on(event, handler);
            const wrapped = () => {
              off();
              offs.delete(wrapped);
            };
            offs.add(wrapped);
            return wrapped;
          },
          emit,
        },
        release() {
          for (const off of [...offs]) off();
        },
      };
    },
  };
}

/** Lose Kopplung zwischen Modulen: Ein Modul stellt etwas bereit, ein anderes nutzt es. */
export function createServiceRegistry(): CoreServiceRegistry {
  const services = new Map<string, { owner: string; impl: unknown }>();

  const provideAs = (owner: string, name: string, impl: unknown) => {
    const existing = services.get(name);
    if (existing) throw new Error(`Service "${name}" ist schon vergeben (von "${existing.owner}")`);
    services.set(name, { owner, impl });
  };
  const get = <T>(name: string) => services.get(name)?.impl as T | undefined;
  const require = <T>(name: string) => {
    if (!services.has(name)) throw new Error(`Benötigter Service "${name}" fehlt`);
    return services.get(name)!.impl as T;
  };

  return {
    provide: (name, impl) => provideAs('core', name, impl),
    get,
    require,
    forModule(moduleId) {
      return {
        api: { provide: (name, impl) => provideAs(moduleId, name, impl), get, require },
        release() {
          for (const [name, s] of services) if (s.owner === moduleId) services.delete(name);
        },
      };
    },
  };
}
