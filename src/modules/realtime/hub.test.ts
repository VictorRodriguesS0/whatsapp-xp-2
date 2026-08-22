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

    expect(new TextDecoder().decode((await reader.read()).value)).toBe(": connected\n\n");
    publishRealtime({
      type: "conversation.updated",
      conversationId: "c1",
      revision: "2026-08-21T12:00:00.000Z",
    });

    expect(new TextDecoder().decode((await reader.read()).value)).toBe(
      'event: update\ndata: {"type":"conversation.updated","conversationId":"c1","revision":"2026-08-21T12:00:00.000Z"}\n\n',
    );

    controller.abort();

    expect(realtimeSubscriberCount()).toBe(0);
  });

  it("sends heartbeat comments every 20 seconds and stops after abort", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const reader = subscribeRealtime(controller.signal).getReader();

    expect(new TextDecoder().decode((await reader.read()).value)).toBe(": connected\n\n");
    await vi.advanceTimersByTimeAsync(20_000);

    expect(new TextDecoder().decode((await reader.read()).value)).toBe(": heartbeat\n\n");

    controller.abort();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(realtimeSubscriberCount()).toBe(0);
  });

  it("emits an initial comment immediately so EventSource can open", async () => {
    const controller = new AbortController();
    const reader = subscribeRealtime(controller.signal).getReader();

    const initial = await Promise.race([
      reader.read(),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 50)),
    ]);

    try {
      expect(initial).not.toBe("timeout");
      expect(new TextDecoder().decode((initial as ReadableStreamReadResult<Uint8Array>).value)).toBe(
        ": connected\n\n",
      );
    } finally {
      controller.abort();
    }
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

  it.each([
    [{ type: "contact.updated", contactId: "contact-1" }, '{"type":"contact.updated","contactId":"contact-1"}'],
    [{ type: "settings.updated", scope: "contact-types" }, '{"type":"settings.updated","scope":"contact-types"}'],
    [{ type: "settings.updated", scope: "contact-tags" }, '{"type":"settings.updated","scope":"contact-tags"}'],
  ] as const)("publishes the safe invalidation %o", async (event, payload) => {
    const controller = new AbortController();
    const reader = subscribeRealtime(controller.signal).getReader();
    await reader.read();

    publishRealtime(event);

    expect(new TextDecoder().decode((await reader.read()).value)).toBe(
      `event: update\ndata: ${payload}\n\n`,
    );
    controller.abort();
  });

  it.each([
    { type: "contact.updated", contactId: "contact-1", phone: "5511999999999" },
    { type: "settings.updated", scope: "contact-tags", displayName: "VIP" },
    { type: "settings.updated", scope: "contact-types", providerPayload: { secret: true } },
  ])("rejects realtime invalidations with extra PII or payload fields", (event) => {
    expect(() => publishRealtime(event as never)).toThrow();
  });
});
