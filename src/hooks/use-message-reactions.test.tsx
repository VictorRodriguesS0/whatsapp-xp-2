import { act, renderHook, waitFor } from "@testing-library/react";
import { useCallback, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MessageDto } from "@/modules/conversations/types";

import { useMessageReactions } from "./use-message-reactions";

const actor = { id: "10000000-0000-4000-8000-000000000001", name: "Ana" };
const baseMessage: MessageDto = {
  id: "20000000-0000-4000-8000-000000000001",
  direction: "INBOUND",
  type: "TEXT",
  body: "Oi",
  content: null,
  canReply: false,
  replyTo: null,
  mediaObjectId: null,
  mediaState: null,
  sentBy: null,
  status: "RECEIVED",
  failureReason: null,
  revokedAt: null,
  reactions: [],
  externalTimestamp: "2026-08-22T12:00:00.000Z",
  createdAt: "2026-08-22T12:00:00.000Z",
};

function harness() {
  return renderHook(() => {
    const [message, setMessage] = useState(baseMessage);
    const activeConversation = useRef("conversation-1");
    const getMessage = useCallback((id: string) => id === message.id ? message : null, [message]);
    const replaceReactions = useCallback((id: string, reactions: MessageDto["reactions"]) => {
      setMessage((current) => current.id === id ? { ...current, reactions } : current);
    }, []);
    const reactions = useMessageReactions({
      actor,
      getActiveConversationId: () => activeConversation.current,
      getMessage,
      replaceReactions,
    });
    return {
      message,
      activeConversation,
      replaceForTest: (reactionsValue: MessageDto["reactions"]) => setMessage((current) => ({
        ...current,
        reactions: reactionsValue,
      })),
      ...reactions,
    };
  });
}

afterEach(() => vi.restoreAllMocks());

describe("useMessageReactions", () => {
  it("optimistically applies a reaction and never calls the read endpoint", async () => {
    let resolve!: (response: Response) => void;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise((done) => { resolve = done; }),
    );
    const hook = harness();
    let operation!: Promise<unknown>;
    act(() => { operation = hook.result.current.react(baseMessage.id, "👍"); });
    expect(hook.result.current.message.reactions).toEqual([
      expect.objectContaining({ reactor: "BUSINESS", emoji: "👍", status: "PENDING" }),
    ]);
    resolve(Response.json({ data: {
      id: "30000000-0000-4000-8000-000000000001",
      messageId: baseMessage.id,
      reactor: "BUSINESS",
      emoji: "👍",
      status: "SENT",
      removed: false,
      sentBy: actor,
    }, error: null }));
    await act(() => operation);
    expect(hook.result.current.message.reactions[0]).toMatchObject({ emoji: "👍", status: "SENT" });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/read"))).toBe(false);
  });

  it("uses the same emoji as optimistic removal", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ data: {
      id: "30000000-0000-4000-8000-000000000001",
      messageId: baseMessage.id,
      reactor: "BUSINESS",
      emoji: "",
      status: "SENT",
      removed: true,
      sentBy: actor,
    }, error: null }));
    const hook = harness();
    act(() => hook.result.current.replaceForTest([{ id: "reaction", reactor: "BUSINESS", emoji: "❤️", status: "SENT", sentBy: actor }]));
    await act(() => hook.result.current.react(baseMessage.id, "❤️"));
    expect(hook.result.current.message.reactions).toEqual([]);
  });

  it("rolls back a confirmed HTTP failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ data: null, error: { message: "Falhou" } }, { status: 409 }));
    const hook = harness();
    await act(() => hook.result.current.react(baseMessage.id, "😂"));
    expect(hook.result.current.message.reactions).toEqual([]);
    expect(hook.result.current.stateFor(baseMessage.id)).toMatchObject({ pending: false, error: expect.any(String) });
  });

  it("ignores a response after the active conversation changes", async () => {
    let resolve!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise((done) => { resolve = done; }));
    const hook = harness();
    let operation!: Promise<unknown>;
    act(() => { operation = hook.result.current.react(baseMessage.id, "🙏"); });
    act(() => { hook.result.current.activeConversation.current = "conversation-2"; });
    resolve(Response.json({ data: {
      id: "30000000-0000-4000-8000-000000000001",
      messageId: baseMessage.id,
      reactor: "BUSINESS",
      emoji: "🙏",
      status: "SENT",
      removed: false,
      sentBy: actor,
    }, error: null }));
    await act(() => operation);
    await waitFor(() => expect(hook.result.current.stateFor(baseMessage.id).pending).toBe(false));
  });
});
