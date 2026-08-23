// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  startReadReceiptWorker,
  type ReadReceiptWorker,
} from "./worker";

let worker: ReadReceiptWorker | null = null;

afterEach(() => {
  worker?.stop();
  worker = null;
  vi.restoreAllMocks();
});

describe("WhatsApp read receipt worker", () => {
  it("drains due work until the repository reports empty", async () => {
    const processNext = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    worker = startReadReceiptWorker({
      intervalMs: 5_000,
      maximumPerDrain: 25,
      processNext,
    });

    await worker.runNow();

    expect(processNext).toHaveBeenCalledTimes(3);
  });

  it("coalesces overlapping drains into the same promise", async () => {
    let release!: (value: boolean) => void;
    const gate = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    const processNext = vi.fn(() => gate);
    worker = startReadReceiptWorker({ processNext });

    const second = worker.runNow();
    const third = worker.runNow();

    expect(second).toBe(third);
    release(false);
    await second;
    expect(processNext).toHaveBeenCalledTimes(1);
  });

  it("is a singleton until the active controller is stopped", () => {
    const processNext = vi.fn(async () => false);
    worker = startReadReceiptWorker({ processNext });
    const second = startReadReceiptWorker({ processNext });

    expect(second).toBe(worker);
    worker.stop();
    const replacement = startReadReceiptWorker({ processNext });
    expect(replacement).not.toBe(worker);
    worker = replacement;
  });
});
