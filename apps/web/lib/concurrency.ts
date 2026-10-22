// Pool de concurrencia limitado.
// Promise.all sobre N tareas de red abre N conexiones simultaneas: con 200
// leads eso satura los sockets del server, dispara timeouts y hace que el
// proveedor de origen bloquee. Este pool mantiene un maximo en vuelo.

export const DEFAULT_CONCURRENCY = 8;

export async function mapWithConcurrency<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency: number = DEFAULT_CONCURRENCY
): Promise<R[]> {
  if (!items.length) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function runner() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runner()));
  return results;
}

/**
 * Cache en memoria con TTL. Se usa para datos que cambian poco (DNS de
 * dominios, texto de webs) y hoy se recalculan en cada request.
 */
export class TtlCache<T> {
  private store = new Map<string, { value: T; expires: number }>();

  constructor(private readonly ttlMs: number, private readonly maxEntries = 2000) {}

  get(key: string): T | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: T) {
    if (this.store.size >= this.maxEntries) {
      // descarta la entrada mas vieja
      const oldest = this.store.keys().next();
      if (!oldest.done) this.store.delete(oldest.value);
    }
    this.store.set(key, { value, expires: Date.now() + this.ttlMs });
  }
}
