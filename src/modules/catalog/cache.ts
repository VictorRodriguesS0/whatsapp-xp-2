export type CacheLookup<Value> = {
  value: Value;
  freshness: "FRESH" | "STALE";
  fetchedAt: number;
};

export type BoundedTtlCache<Value> = {
  peek(key: string): CacheLookup<Value> | null;
  load(key: string, loader: () => Promise<Value>): Promise<CacheLookup<Value>>;
  set(key: string, value: Value): CacheLookup<Value>;
  invalidate(key?: string): void;
  stats(): { entries: number; weight: number; inFlight: number };
};

type CacheEntry<Value> = {
  value: Value;
  fetchedAt: number;
  expiresAt: number;
  lastAccessedAt: number;
  weight: number;
};

export function createBoundedTtlCache<Value>(input: {
  ttlMs: number;
  maximumEntries: number;
  maximumWeight: number;
  weight?: (value: Value) => number;
  now?: () => number;
}): BoundedTtlCache<Value> {
  if (
    !Number.isInteger(input.ttlMs) ||
    input.ttlMs < 1 ||
    !Number.isInteger(input.maximumEntries) ||
    input.maximumEntries < 1 ||
    !Number.isInteger(input.maximumWeight) ||
    input.maximumWeight < 1
  ) {
    throw new TypeError("Invalid cache bounds");
  }

  const entries = new Map<string, CacheEntry<Value>>();
  const inFlight = new Map<string, Promise<CacheLookup<Value>>>();
  const now = input.now ?? Date.now;
  const weightOf = input.weight ?? (() => 1);
  let totalWeight = 0;
  let generation = 0;

  function lookup(entry: CacheEntry<Value>, at: number): CacheLookup<Value> {
    entry.lastAccessedAt = at;
    return {
      value: entry.value,
      freshness: at <= entry.expiresAt ? "FRESH" : "STALE",
      fetchedAt: entry.fetchedAt,
    };
  }

  function remove(key: string): void {
    const entry = entries.get(key);
    if (!entry) return;
    totalWeight -= entry.weight;
    entries.delete(key);
  }

  function evict(): void {
    while (
      entries.size > input.maximumEntries ||
      totalWeight > input.maximumWeight
    ) {
      const oldest = Array.from(entries.entries()).sort((left, right) =>
        left[1].lastAccessedAt - right[1].lastAccessedAt ||
        left[0].localeCompare(right[0]),
      )[0];
      if (!oldest) break;
      remove(oldest[0]);
    }
  }

  const cache: BoundedTtlCache<Value> = {
    peek(key) {
      const entry = entries.get(key);
      return entry ? lookup(entry, now()) : null;
    },

    load(key, loader) {
      const cached = cache.peek(key);
      if (cached?.freshness === "FRESH") return Promise.resolve(cached);
      const existing = inFlight.get(key);
      if (existing) return existing;

      const loadGeneration = generation;
      let loaded: Promise<Value>;
      try {
        loaded = Promise.resolve(loader());
      } catch (error) {
        loaded = Promise.reject(error);
      }
      const operation = loaded
        .then((value) => {
          if (generation !== loadGeneration) {
            const at = now();
            return { value, freshness: "FRESH" as const, fetchedAt: at };
          }
          return cache.set(key, value);
        })
        .finally(() => {
          if (inFlight.get(key) === operation) inFlight.delete(key);
        });
      inFlight.set(key, operation);
      return operation;
    },

    set(key, value) {
      const at = now();
      const rawWeight = weightOf(value);
      const weight = Number.isFinite(rawWeight)
        ? Math.max(1, Math.ceil(rawWeight))
        : input.maximumWeight + 1;
      remove(key);
      if (weight <= input.maximumWeight) {
        entries.set(key, {
          value,
          fetchedAt: at,
          expiresAt: at + input.ttlMs,
          lastAccessedAt: at,
          weight,
        });
        totalWeight += weight;
        evict();
      }
      return { value, freshness: "FRESH", fetchedAt: at };
    },

    invalidate(key) {
      generation += 1;
      if (key === undefined) {
        entries.clear();
        totalWeight = 0;
      } else {
        remove(key);
      }
    },

    stats() {
      return { entries: entries.size, weight: totalWeight, inFlight: inFlight.size };
    },
  };

  return cache;
}
