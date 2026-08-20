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

  it("also bounds different media IDs for the same authenticated user", async () => {
    const limiter = new MediaTaskLimiter(3, 1);
    const activeByUser = new Map<string, number>();
    let maximumForUser = 0;
    let globalActive = 0;
    let globalMaximum = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const task = (userId: string) => limiter.run(async () => {
      const active = (activeByUser.get(userId) ?? 0) + 1;
      activeByUser.set(userId, active);
      maximumForUser = Math.max(maximumForUser, active);
      globalActive += 1;
      globalMaximum = Math.max(globalMaximum, globalActive);
      await gate;
      activeByUser.set(userId, active - 1);
      globalActive -= 1;
    }, userId);

    const tasks = [task("user-a"), task("user-a"), task("user-b"), task("user-b")];
    await new Promise((resolve) => setImmediate(resolve));
    expect(maximumForUser).toBe(1);
    expect(globalMaximum).toBe(2);
    release();
    await Promise.all(tasks);
  });
});
