import "server-only";

import { processNextDueReadReceipt } from "./service";

export type ReadReceiptWorker = {
  runNow(): Promise<void>;
  stop(): void;
};

let singleton: ReadReceiptWorker | null = null;

export function startReadReceiptWorker(
  input: {
    intervalMs?: number;
    maximumPerDrain?: number;
    processNext?: () => Promise<boolean>;
  } = {},
): ReadReceiptWorker {
  if (singleton) return singleton;
  const intervalMs = input.intervalMs ?? 5_000;
  const maximum = input.maximumPerDrain ?? 25;
  const processNext = input.processNext ?? (() => processNextDueReadReceipt());
  let stopped = false;
  let active: Promise<void> | null = null;

  const runNow = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (active) return active;
    active = (async () => {
      for (let index = 0; index < maximum; index += 1) {
        if (stopped || !(await processNext())) break;
      }
    })().finally(() => {
      active = null;
    });
    return active;
  };

  const timer = setInterval(
    () => void runNow().catch(() => undefined),
    intervalMs,
  );
  timer.unref?.();
  singleton = {
    runNow,
    stop() {
      stopped = true;
      clearInterval(timer);
      singleton = null;
    },
  };
  void runNow().catch(() => undefined);
  return singleton;
}
