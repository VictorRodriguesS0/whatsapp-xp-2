import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SessionUser } from "@/modules/auth/session";

import { useInbox } from "./use-inbox";

const user: SessionUser = {
  id: "30000000-0000-4000-8000-000000000001",
  name: "Marcos",
  email: "marcos@xp.test",
  role: "ATTENDANT",
};

function response(data: unknown, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(data) } as Response);
}

describe("useInbox", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends the exact text with one stable client request id", async () => {
    const serverMessage = {
      id: "server-message",
      direction: "OUTBOUND",
      type: "TEXT",
      body: "Sem assinatura no corpo",
      mediaObjectId: null,
      sentBy: { id: user.id, name: user.name },
      status: "SENT",
      failureReason: null,
      externalTimestamp: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/conversations") return response({ data: { items: [], nextCursor: null }, error: null });
      if (url.includes("/messages") && init?.method === "POST") {
        return response({ data: serverMessage, error: null }, true, 201);
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));

    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.sendText("conversation-id", "Sem assinatura no corpo"));

    const sendCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    const body = JSON.parse(String(sendCall?.[1]?.body));
    expect(body.body).toBe("Sem assinatura no corpo");
    expect(body.body).not.toContain("Marcos");
    expect(body.clientRequestId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("keeps an optimistic failed row with the original request id", async () => {
    const sentBodies: Array<{ clientRequestId: string; body: string }> = [];
    let attempts = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/conversations") return response({ data: { items: [], nextCursor: null }, error: null });
      if (url === "/api/conversations/conversation-id/messages" && !init?.method) {
        return response({
          data: {
            id: "conversation-id",
            contact: { id: "contact", name: "Carlos", phone: "5561999999999", profilePictureUrl: null },
            responsible: null,
            lastMessageAt: new Date().toISOString(),
            latestMessage: null,
            unreadCount: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messages: [],
            lastReadMessageId: null,
            lastReadAt: null,
          },
          error: null,
        });
      }
      if (init?.method === "POST") {
        attempts += 1;
        sentBodies.push(JSON.parse(String(init.body)) as { clientRequestId: string; body: string });
        if (attempts === 1) return response({ data: null, error: { message: "Falha" } }, false, 503);
        return response({
          data: {
            id: "server-message",
            direction: "OUTBOUND",
            type: "TEXT",
            body: "Olá",
            mediaObjectId: null,
            sentBy: { id: user.id, name: user.name },
            status: "SENT",
            failureReason: null,
            externalTimestamp: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          },
          error: null,
        }, true, 201);
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-id"));
    await act(() => hook.result.current.sendText("conversation-id", "Olá"));

    const failed = hook.result.current.conversation?.messages.at(-1);
    expect(failed).toMatchObject({ status: "FAILED", body: "Olá" });
    expect(failed?.id).toMatch(/^optimistic:/);

    await act(() => hook.result.current.retryMessage(failed!.id));
    expect(hook.result.current.conversation?.messages.at(-1)).toMatchObject({ id: "server-message", status: "SENT" });
    expect(sentBodies[1].clientRequestId).toBe(sentBodies[0].clientRequestId);
    expect(sentBodies[1].body).toBe("Olá");
  });

  it("does not duplicate a message when SSE sync wins the send-response race", async () => {
    let resolveSend!: (value: Response) => void;
    const sentAt = new Date().toISOString();
    const serverMessage = {
      id: "server-message",
      direction: "OUTBOUND" as const,
      type: "TEXT" as const,
      body: "Resposta",
      mediaObjectId: null,
      sentBy: { id: user.id, name: user.name },
      status: "SENT" as const,
      failureReason: null,
      clientRequestId: null as string | null,
      externalTimestamp: sentAt,
      createdAt: sentAt,
    };
    let detailFetches = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/conversations") return response({ data: { items: [], nextCursor: null }, error: null });
      if (url.endsWith("/messages") && init?.method === "POST") {
        serverMessage.clientRequestId = (JSON.parse(String(init.body)) as { clientRequestId: string }).clientRequestId;
        return new Promise<Response>((resolve) => { resolveSend = resolve; });
      }
      if (url.endsWith("/messages")) {
        detailFetches += 1;
        return response({
          data: {
            id: "conversation-id",
            contact: { id: "contact", name: "Carlos", phone: "5561999999999", profilePictureUrl: null },
            responsible: null,
            lastMessageAt: sentAt,
            latestMessage: detailFetches > 1 ? serverMessage : null,
            unreadCount: 0,
            createdAt: sentAt,
            updatedAt: sentAt,
            messages: detailFetches > 1 ? [serverMessage] : [],
            lastReadMessageId: null,
            lastReadAt: null,
          },
          error: null,
        });
      }
      if (url.endsWith("/read")) return response({ data: {}, error: null });
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-id"));

    let sendPromise!: Promise<unknown>;
    act(() => { sendPromise = hook.result.current.sendText("conversation-id", "Resposta"); });
    await waitFor(() => expect(hook.result.current.conversation?.messages).toHaveLength(1));
    await act(() => hook.result.current.refreshConversation());
    expect(hook.result.current.conversation?.messages).toHaveLength(1);

    resolveSend(await response({ data: serverMessage, error: null }, true, 201));
    await act(() => sendPromise);
    expect(hook.result.current.conversation?.messages.filter((item) => item.id === "server-message")).toHaveLength(1);
  });

  it("refreshes the unread list after the read acknowledgement", async () => {
    let listFetches = 0;
    const receivedAt = new Date().toISOString();
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/conversations") {
        listFetches += 1;
        return response({ data: { items: [], nextCursor: null }, error: null });
      }
      if (url.endsWith("/messages")) {
        return response({ data: {
          id: "conversation-id",
          contact: { id: "contact", name: "Carlos", phone: "5561999999999", profilePictureUrl: null },
          responsible: null,
          lastMessageAt: receivedAt,
          latestMessage: null,
          unreadCount: 1,
          createdAt: receivedAt,
          updatedAt: receivedAt,
          messages: [{
            id: "received-message",
            clientRequestId: null,
            direction: "INBOUND",
            type: "TEXT",
            body: "Olá",
            mediaObjectId: null,
            sentBy: null,
            status: "RECEIVED",
            failureReason: null,
            externalTimestamp: receivedAt,
            createdAt: receivedAt,
          }],
          lastReadMessageId: null,
          lastReadAt: null,
        }, error: null });
      }
      if (url.endsWith("/read") && init?.method === "POST") return response({ data: {}, error: null });
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-id"));
    expect(listFetches).toBe(1);
    await act(() => hook.result.current.markRead("conversation-id", "received-message"));
    await waitFor(() => expect(listFetches).toBeGreaterThan(1));
  });

  it("clears the previous detail when the next conversation cannot be loaded", async () => {
    const now = new Date().toISOString();
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/conversations") return response({ data: { items: [], nextCursor: null }, error: null });
      if (url.endsWith("/conversation-a/messages")) return response({ data: {
        id: "conversation-a",
        contact: { id: "contact-a", name: "Ana", phone: "551100000001", profilePictureUrl: null },
        responsible: null,
        lastMessageAt: now,
        latestMessage: null,
        unreadCount: 0,
        createdAt: now,
        updatedAt: now,
        messages: [],
        lastReadMessageId: null,
        lastReadAt: null,
      }, error: null });
      if (url.endsWith("/conversation-b/messages")) return response({ data: null, error: { message: "Falha B" } }, false, 503);
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-a"));
    expect(hook.result.current.conversation?.id).toBe("conversation-a");

    await act(() => hook.result.current.openConversation("conversation-b"));

    expect(hook.result.current.selectedId).toBe("conversation-b");
    expect(hook.result.current.conversation).toBeNull();
    expect(hook.result.current.conversationError).toBe("Falha B");
  });

  it("retries a persisted failed send through the retry endpoint", async () => {
    const now = new Date().toISOString();
    const failedMessage = {
      id: "persisted-failed",
      clientRequestId: "11111111-1111-4111-8111-111111111111",
      direction: "OUTBOUND",
      type: "TEXT",
      body: "Olá",
      mediaObjectId: null,
      sentBy: { id: user.id, name: user.name },
      status: "FAILED",
      failureReason: "Meta indisponível",
      externalTimestamp: now,
      createdAt: now,
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/conversations") return response({ data: { items: [], nextCursor: null }, error: null });
      if (url.endsWith("/conversation-id/messages") && !init?.method) return response({ data: {
        id: "conversation-id",
        contact: { id: "contact", name: "Carlos", phone: "5561999999999", profilePictureUrl: null },
        responsible: null,
        lastMessageAt: now,
        latestMessage: null,
        unreadCount: 0,
        createdAt: now,
        updatedAt: now,
        messages: [],
        lastReadMessageId: null,
        lastReadAt: null,
      }, error: null });
      if (url.endsWith("/conversation-id/messages") && init?.method === "POST") {
        return response({ data: failedMessage, error: null }, true, 201);
      }
      if (url === "/api/messages/persisted-failed/retry" && init?.method === "POST") {
        return response({ data: { ...failedMessage, status: "SENT", failureReason: null }, error: null });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-id"));
    await act(() => hook.result.current.sendText("conversation-id", "Olá"));
    expect(hook.result.current.conversation?.messages.at(-1)).toMatchObject({ id: "persisted-failed", status: "FAILED" });

    await act(() => hook.result.current.retryMessage("persisted-failed"));

    expect(fetchMock).toHaveBeenCalledWith("/api/messages/persisted-failed/retry", { method: "POST" });
    expect(hook.result.current.conversation?.messages.at(-1)).toMatchObject({ id: "persisted-failed", status: "SENT" });
  });

  it("preserves local message rows when assignment metadata changes", async () => {
    const now = new Date().toISOString();
    const baseDetail = {
      id: "conversation-id",
      contact: { id: "contact", name: "Carlos", phone: "5561999999999", profilePictureUrl: null },
      responsible: null,
      lastMessageAt: now,
      latestMessage: null,
      unreadCount: 0,
      createdAt: now,
      updatedAt: now,
      messages: [],
      lastReadMessageId: null,
      lastReadAt: null,
    };
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/conversations") return response({ data: { items: [], nextCursor: null }, error: null });
      if (url.endsWith("/messages") && !init?.method) return response({ data: baseDetail, error: null });
      if (url.endsWith("/messages") && init?.method === "POST") return response({ data: null, error: { message: "Sem conexão" } }, false, 503);
      if (url.endsWith("/responsible") && init?.method === "PATCH") return response({
        data: { ...baseDetail, responsible: { id: user.id, name: user.name } },
        error: null,
      });
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-id"));
    await act(() => hook.result.current.sendText("conversation-id", "Ainda aqui"));
    expect(hook.result.current.conversation?.messages).toHaveLength(1);

    await act(() => hook.result.current.setResponsible(user.id));

    expect(hook.result.current.conversation?.responsible).toEqual({ id: user.id, name: user.name });
    expect(hook.result.current.conversation?.messages).toHaveLength(1);
    expect(hook.result.current.conversation?.messages[0]).toMatchObject({ body: "Ainda aqui", status: "FAILED" });
  });
});
