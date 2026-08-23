// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ startReadReceiptWorker: vi.fn() }));

vi.mock("@/modules/read-receipts/worker", () => mocks);

const originalRuntime = process.env.NEXT_RUNTIME;
const originalPhase = process.env.NEXT_PHASE;

beforeEach(() => {
  vi.resetModules();
  mocks.startReadReceiptWorker.mockClear();
  delete process.env.NEXT_RUNTIME;
  delete process.env.NEXT_PHASE;
});

afterEach(() => {
  if (originalRuntime === undefined) delete process.env.NEXT_RUNTIME;
  else process.env.NEXT_RUNTIME = originalRuntime;
  if (originalPhase === undefined) delete process.env.NEXT_PHASE;
  else process.env.NEXT_PHASE = originalPhase;
});

describe("Next instrumentation", () => {
  it("starts the receipt worker in the Node runtime", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    const { register } = await import("./instrumentation");

    await register();

    expect(mocks.startReadReceiptWorker).toHaveBeenCalledTimes(1);
  });

  it("does not start the worker in the Edge runtime", async () => {
    process.env.NEXT_RUNTIME = "edge";
    const { register } = await import("./instrumentation");

    await register();

    expect(mocks.startReadReceiptWorker).not.toHaveBeenCalled();
  });

  it("does not start a live processor during next build", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.NEXT_PHASE = "phase-production-build";
    const { register } = await import("./instrumentation");

    await register();

    expect(mocks.startReadReceiptWorker).not.toHaveBeenCalled();
  });
});
