import { describe, expect, it, vi } from "vitest";

import { createBoundedTtlCache } from "./cache";

describe("bounded catalog TTL cache", () => {
  it("returns one fresh load within TTL and exposes it as stale afterwards", async () => {
    let now = 1_000;
    const loader = vi.fn().mockResolvedValue({ products: ["one"] });
    const cache = createBoundedTtlCache({
      ttlMs: 300_000,
      maximumEntries: 10,
      maximumWeight: 10,
      weight: (value: { products: string[] }) => value.products.length,
      now: () => now,
    });

    await expect(cache.load("page", loader)).resolves.toMatchObject({
      freshness: "FRESH",
      value: { products: ["one"] },
      fetchedAt: 1_000,
    });
    await cache.load("page", loader);
    expect(loader).toHaveBeenCalledTimes(1);

    now += 300_001;
    expect(cache.peek("page")).toMatchObject({
      freshness: "STALE",
      value: { products: ["one"] },
    });
  });

  it("deduplicates concurrent loads for one normalized key", async () => {
    let resolve!: (value: string) => void;
    const loader = vi.fn(() => new Promise<string>((done) => { resolve = done; }));
    const cache = createBoundedTtlCache<string>({
      ttlMs: 100,
      maximumEntries: 10,
      maximumWeight: 10,
    });

    const first = cache.load("same", loader);
    const second = cache.load("same", loader);
    expect(loader).toHaveBeenCalledTimes(1);
    resolve("loaded");

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ value: "loaded" }),
      expect.objectContaining({ value: "loaded" }),
    ]);
  });

  it("keeps a stale value when a refresh fails", async () => {
    let now = 0;
    const cache = createBoundedTtlCache<string>({
      ttlMs: 10,
      maximumEntries: 10,
      maximumWeight: 10,
      now: () => now,
    });
    await cache.load("key", async () => "previous");
    now = 11;

    await expect(cache.load("key", async () => { throw new Error("down"); }))
      .rejects.toThrow("down");
    expect(cache.peek("key")).toMatchObject({
      freshness: "STALE",
      value: "previous",
    });
  });

  it("evicts least-recent entries to enforce entry and weight bounds", () => {
    let now = 0;
    const cache = createBoundedTtlCache<string[]>({
      ttlMs: 100,
      maximumEntries: 2,
      maximumWeight: 3,
      weight: (value) => value.length,
      now: () => ++now,
    });

    cache.set("a", ["a"]);
    cache.set("b", ["b"]);
    cache.peek("a");
    cache.set("c", ["c", "c2"]);

    expect(cache.peek("a")).not.toBeNull();
    expect(cache.peek("b")).toBeNull();
    expect(cache.peek("c")).not.toBeNull();
    expect(cache.stats()).toEqual({ entries: 2, weight: 3, inFlight: 0 });
  });

  it("invalidates one key or the complete cache", () => {
    const cache = createBoundedTtlCache<string>({
      ttlMs: 100,
      maximumEntries: 10,
      maximumWeight: 10,
    });
    cache.set("a", "a");
    cache.set("b", "b");
    cache.invalidate("a");
    expect(cache.peek("a")).toBeNull();
    expect(cache.peek("b")).not.toBeNull();
    cache.invalidate();
    expect(cache.stats().entries).toBe(0);
  });
});
