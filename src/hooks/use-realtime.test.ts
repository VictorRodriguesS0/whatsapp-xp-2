import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRealtime } from "./use-realtime";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Set<(event: MessageEvent) => void>>();
  close = vi.fn();

  constructor(public readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener = vi.fn((type: string, listener: (event: MessageEvent) => void) => {
    this.listeners.get(type)?.delete(listener);
  });

  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data: JSON.stringify(data) }));
    }
  }
}

describe("useRealtime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shares one connection and closes it after the last subscriber leaves", () => {
    const first = renderHook(() => useRealtime({ onSync: vi.fn(), onEvent: vi.fn() }));
    const second = renderHook(() => useRealtime({ onSync: vi.fn(), onEvent: vi.fn() }));

    expect(FakeEventSource.instances).toHaveLength(1);
    first.unmount();
    expect(FakeEventSource.instances[0].close).not.toHaveBeenCalled();
    second.unmount();
    expect(FakeEventSource.instances[0].close).toHaveBeenCalledOnce();
    expect(FakeEventSource.instances[0].removeEventListener).toHaveBeenCalledWith("update", expect.any(Function));
  });

  it("runs a full sync on open and routes typed invalidations", () => {
    const onSync = vi.fn();
    const onEvent = vi.fn();
    const hook = renderHook(() => useRealtime({ onSync, onEvent }));

    act(() => FakeEventSource.instances[0].onopen?.());
    expect(hook.result.current.connected).toBe(true);
    expect(onSync).toHaveBeenCalledOnce();

    act(() => {
      FakeEventSource.instances[0].emit("update", {
        type: "message.created",
        conversationId: "conversation-id",
        messageId: "message-id",
      });
    });
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "message.created" }));
    hook.unmount();
  });

  it("routes strict message and reaction mutation invalidations", () => {
    const onEvent = vi.fn();
    const hook = renderHook(() => useRealtime({ onSync: vi.fn(), onEvent }));

    act(() => {
      FakeEventSource.instances[0].emit("update", {
        type: "message.updated",
        conversationId: "conversation-id",
        messageId: "message-id",
      });
      FakeEventSource.instances[0].emit("update", {
        type: "reaction.updated",
        conversationId: "conversation-id",
        messageId: "message-id",
      });
      FakeEventSource.instances[0].emit("update", {
        type: "message.updated",
        conversationId: "conversation-id",
        messageId: "message-id",
        previousBody: "must-not-cross-the-client-boundary",
      });
    });

    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onEvent).toHaveBeenNthCalledWith(1, {
      type: "message.updated",
      conversationId: "conversation-id",
      messageId: "message-id",
    });
    expect(onEvent).toHaveBeenNthCalledWith(2, {
      type: "reaction.updated",
      conversationId: "conversation-id",
      messageId: "message-id",
    });
    hook.unmount();
  });

  it("routes only complete ID-only conversation.merged events", () => {
    const onEvent = vi.fn();
    const hook = renderHook(() =>
      useRealtime({ onSync: vi.fn(), onEvent }),
    );

    act(() => {
      FakeEventSource.instances[0].emit("update", {
        type: "conversation.merged",
        sourceConversationId: "source-conversation-id",
        targetConversationId: "target-conversation-id",
      });
      FakeEventSource.instances[0].emit("update", {
        type: "conversation.merged",
        sourceConversationId: "source-conversation-id",
      });
    });

    expect(onEvent).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenCalledWith({
      type: "conversation.merged",
      sourceConversationId: "source-conversation-id",
      targetConversationId: "target-conversation-id",
    });
    hook.unmount();
  });

  it("routes complete media invalidations", () => {
    const onEvent = vi.fn();
    const hook = renderHook(() => useRealtime({ onSync: vi.fn(), onEvent }));

    act(() => {
      FakeEventSource.instances[0].emit("update", {
        type: "media.updated",
        conversationId: "conversation-id",
        messageId: "message-id",
        mediaId: "media-id",
      });
      FakeEventSource.instances[0].emit("update", {
        type: "media.updated",
        conversationId: "conversation-id",
        messageId: "message-id",
      });
    });

    expect(onEvent).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "media.updated" }));
    hook.unmount();
  });

  it("routes only complete contact and settings invalidations", () => {
    const onEvent = vi.fn();
    const hook = renderHook(() => useRealtime({ onSync: vi.fn(), onEvent }));

    act(() => {
      FakeEventSource.instances[0].emit("update", {
        type: "contact.updated",
        contactId: "contact-id",
      });
      FakeEventSource.instances[0].emit("update", {
        type: "settings.updated",
        scope: "contact-tags",
      });
      FakeEventSource.instances[0].emit("update", {
        type: "contact.updated",
      });
      FakeEventSource.instances[0].emit("update", {
        type: "settings.updated",
        scope: "unknown",
      });
    });

    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onEvent).toHaveBeenNthCalledWith(1, {
      type: "contact.updated",
      contactId: "contact-id",
    });
    expect(onEvent).toHaveBeenNthCalledWith(2, {
      type: "settings.updated",
      scope: "contact-tags",
    });
    hook.unmount();
  });

  it("routes only PII-free contact sync invalidations", () => {
    const onEvent = vi.fn();
    const hook = renderHook(() => useRealtime({ onSync: vi.fn(), onEvent }));

    act(() => {
      FakeEventSource.instances[0].emit("update", {
        type: "contacts.synced",
        revision: "opaque-revision",
      });
      FakeEventSource.instances[0].emit("update", {
        type: "contacts.synced",
        revision: "opaque-revision",
        phone: "5561992250908",
      });
      FakeEventSource.instances[0].emit("update", { type: "contacts.synced" });
    });

    expect(onEvent).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenCalledWith({
      type: "contacts.synced",
      revision: "opaque-revision",
    });
    hook.unmount();
  });

  it("reconnects exponentially with a 15 second cap", () => {
    const hook = renderHook(() => useRealtime({ onSync: vi.fn(), onEvent: vi.fn() }));

    for (const expectedDelay of [1_000, 2_000, 4_000, 8_000, 15_000, 15_000]) {
      act(() => FakeEventSource.instances.at(-1)?.onerror?.());
      expect(hook.result.current.connected).toBe(false);
      act(() => vi.advanceTimersByTime(expectedDelay - 1));
      const count = FakeEventSource.instances.length;
      act(() => vi.advanceTimersByTime(1));
      expect(FakeEventSource.instances).toHaveLength(count + 1);
    }

    hook.unmount();
  });
});
