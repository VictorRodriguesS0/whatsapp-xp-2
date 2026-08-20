// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  publishRealtime,
  realtimeSubscriberCount,
  subscribeRealtime,
} from "./hub";

describe("realtime hub", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("publishes a typed event and removes aborted subscribers", async () => {
    const controller = new AbortController();
    const reader = subscribeRealtime(controller.signal).getReader();

    publishRealtime({ type: "conversation.updated", conversationId: "c1" });

    expect(new TextDecoder().decode((await reader.read()).value)).toBe(
      'event: update\ndata: {"type":"conversation.updated","conversationId":"c1"}\n\n',
    );

    controller.abort();

    expect(realtimeSubscriberCount()).toBe(0);
  });

  it("sends heartbeat comments every 20 seconds and stops after abort", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const reader = subscribeRealtime(controller.signal).getReader();

    await vi.advanceTimersByTimeAsync(20_000);

    expect(new TextDecoder().decode((await reader.read()).value)).toBe(": heartbeat\n\n");

    controller.abort();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(realtimeSubscriberCount()).toBe(0);
  });

  it("closes a subscriber when its user's session is invalidated", () => {
    const controller = new AbortController();
    subscribeRealtime(controller.signal, "user-1");

    publishRealtime({ type: "user.updated", userId: "user-1" });

    expect(realtimeSubscriberCount()).toBe(0);
  });

  it("removes the abort listener when a reader cancels the stream", async () => {
    let abortListener: EventListener | undefined;
    const removeEventListener = vi.fn();
    const signal = {
      aborted: false,
      addEventListener: (_type: string, listener: EventListener) => {
        abortListener = listener;
      },
      removeEventListener,
    } as unknown as AbortSignal;
    const reader = subscribeRealtime(signal).getReader();

    await reader.cancel();

    expect(removeEventListener).toHaveBeenCalledWith("abort", abortListener);
    expect(realtimeSubscriberCount()).toBe(0);
  });
});
