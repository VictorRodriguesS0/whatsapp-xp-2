// @vitest-environment node

import { describe, expect, it } from "vitest";

import { MediaTaskLimiter } from "./task-limiter";

describe("media after task limiter", () => {
  it("bounds global concurrent work and drains queued tasks", async () => {
    const limiter = new MediaTaskLimiter(2);
    let active = 0;
    let maximum = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tasks = Array.from({ length: 4 }, () => limiter.run(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await gate;
      active -= 1;
    }));
    await new Promise((resolve) => setImmediate(resolve));
    expect(maximum).toBe(2);
    release();
    await Promise.all(tasks);
    expect(maximum).toBe(2);
  });
});
