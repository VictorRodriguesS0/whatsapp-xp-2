import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SessionUser } from "@/modules/auth/session";

import { useInbox, type InboxMessage } from "./use-inbox";

const user: SessionUser = {
  id: "30000000-0000-4000-8000-000000000001",
  name: "Marcos",
  email: "marcos@xp.test",
  role: "ATTENDANT",
};

function response(data: unknown, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(data) } as Response);
}

function listItem(id: string, name = id, lastMessageAt = "2026-08-20T14:30:00.000Z") {
  return {
    id,
    contact: { id: `contact-${id}`, name, phone: "5561999999999", profilePictureUrl: null },
    responsible: null,
    lastMessageAt,
    latestMessage: null,
    unreadCount: 0,
  };
}

function conversationDetail(id = "conversation-id", messages: unknown[] = []) {
  const now = "2026-08-20T14:30:00.000Z";
  return {
    ...listItem(id, "Carlos", now),
    createdAt: now,
    updatedAt: now,
    messages,
    lastReadMessageId: null,
    lastReadAt: null,
  };
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

    let sendPromise!: Promise<InboxMessage | null>;
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
    expect(hook.result.current.conversationError).toBe("Não foi possível carregar a conversa.");
  });

  it("retries a persisted failed attachment without a local File through the retry endpoint", async () => {
    const now = new Date().toISOString();
    const failedMessage = {
      id: "persisted-failed",
      clientRequestId: "11111111-1111-4111-8111-111111111111",
      direction: "OUTBOUND",
      type: "IMAGE",
      body: "Foto",
      mediaObjectId: "stored-media",
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
        messages: [failedMessage],
        lastReadMessageId: null,
        lastReadAt: null,
      }, error: null });
      if (url === "/api/messages/persisted-failed/retry" && init?.method === "POST") {
        return response({ data: { ...failedMessage, status: "SENT", failureReason: null }, error: null });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-id"));
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

  it("appends older pages without duplicates and preserves them during a full refresh", async () => {
    let firstPageRequests = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/users/assignable") return response({ data: { items: [] }, error: null });
      if (url === "/api/conversations?cursor=cursor-1") {
        return response({ data: { items: [listItem("b", "B atualizado"), listItem("c", "C")], nextCursor: null }, error: null });
      }
      if (url === "/api/conversations") {
        firstPageRequests += 1;
        return firstPageRequests === 1
          ? response({ data: { items: [listItem("a", "A"), listItem("b", "B")], nextCursor: "cursor-1" }, error: null })
          : response({ data: { items: [listItem("a", "A novo"), listItem("d", "D")], nextCursor: "cursor-2" }, error: null });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.conversations.map(({ id }) => id)).toEqual(["a", "b"]));

    await act(() => hook.result.current.loadMore());
    expect(hook.result.current.conversations.map(({ id }) => id)).toEqual(["a", "b", "c"]);
    expect(hook.result.current.conversations[1].contact.name).toBe("B atualizado");

    await act(() => hook.result.current.refreshList());
    expect(hook.result.current.conversations.map(({ id }) => id)).toEqual(["a", "d", "b", "c"]);
    expect(hook.result.current.nextCursor).toBeNull();
  });

  it("resets loaded pages before running a new search", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/users/assignable") return response({ data: { items: [] }, error: null });
      if (url === "/api/conversations") return response({ data: { items: [listItem("old")], nextCursor: "older" }, error: null });
      if (url === "/api/conversations?search=Rita") return response({ data: { items: [listItem("rita", "Rita")], nextCursor: null }, error: null });
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.conversations).toHaveLength(1));

    act(() => hook.result.current.setSearch("Rita"));
    expect(hook.result.current.conversations).toEqual([]);
    expect(hook.result.current.nextCursor).toBeNull();
    await waitFor(() => expect(hook.result.current.conversations[0]?.id).toBe("rita"));
  });

  it("ignores an older page response after the search changes", async () => {
    let resolveOlder!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/users/assignable") return response({ data: { items: [] }, error: null });
      if (url === "/api/conversations") return response({ data: { items: [listItem("old")], nextCursor: "older" }, error: null });
      if (url === "/api/conversations?cursor=older") return new Promise<Response>((resolve) => { resolveOlder = resolve; });
      if (url === "/api/conversations?search=Rita") return response({ data: { items: [listItem("rita", "Rita")], nextCursor: null }, error: null });
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.nextCursor).toBe("older"));

    let olderPage!: Promise<void>;
    act(() => { olderPage = hook.result.current.loadMore(); });
    act(() => hook.result.current.setSearch("Rita"));
    await waitFor(() => expect(hook.result.current.conversations[0]?.id).toBe("rita"));
    resolveOlder(await response({ data: { items: [listItem("stale")], nextCursor: null }, error: null }));
    await act(() => olderPage);

    expect(hook.result.current.conversations.map(({ id }) => id)).toEqual(["rita"]);
  });

  it("keeps a lost media upload aliased through SSE failure and retries the same multipart row", async () => {
    const file = new File(["image"], "produto.png", { type: "image/png" });
    const createPreview = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:produto");
    const revokePreview = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    let clientRequestId = "";
    let detailFetches = 0;
    const sentForms: FormData[] = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/users/assignable") return response({ data: { items: [] }, error: null });
      if (url === "/api/conversations") return response({ data: { items: [], nextCursor: null }, error: null });
      if (url.endsWith("/messages") && !init?.method) {
        detailFetches += 1;
        const failed = {
          id: "persisted-media",
          clientRequestId,
          direction: "OUTBOUND",
          type: "IMAGE",
          body: "Foto",
          mediaObjectId: null,
          sentBy: { id: user.id, name: user.name },
          status: "FAILED",
          failureReason: "Graph code 131053",
          externalTimestamp: "2026-08-20T14:30:00.000Z",
          createdAt: "2026-08-20T14:30:00.000Z",
        };
        return response({ data: conversationDetail("conversation-id", detailFetches > 1 ? [failed] : []), error: null });
      }
      if (url.endsWith("/messages") && init?.method === "POST") {
        const form = init.body as FormData;
        sentForms.push(form);
        clientRequestId = String(form.get("clientRequestId"));
        if (sentForms.length === 1) return Promise.reject(new Error("Failed to fetch"));
        return response({ data: {
          id: "persisted-media",
          clientRequestId,
          direction: "OUTBOUND",
          type: "IMAGE",
          body: "Foto",
          mediaObjectId: "media-id",
          sentBy: { id: user.id, name: user.name },
          status: "SENT",
          failureReason: null,
          externalTimestamp: "2026-08-20T14:30:00.000Z",
          createdAt: "2026-08-20T14:30:00.000Z",
        }, error: null }, true, 201);
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-id"));
    await act(() => hook.result.current.sendMedia("conversation-id", file, "Foto"));
    await act(() => hook.result.current.refreshConversation());
    expect(createPreview).toHaveBeenCalledWith(file);
    expect(revokePreview).not.toHaveBeenCalled();
    expect(hook.result.current.conversation?.messages).toHaveLength(1);
    expect(hook.result.current.conversation?.messages[0]).toMatchObject({ id: "persisted-media", status: "FAILED", localFileName: "produto.png" });

    await act(() => hook.result.current.retryMessage("persisted-media"));

    expect(sentForms).toHaveLength(2);
    expect(sentForms[1].get("clientRequestId")).toBe(sentForms[0].get("clientRequestId"));
    expect((sentForms[1].get("file") as File).name).toBe("produto.png");
    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/messages/persisted-media/retry")).toBe(false);
    expect(hook.result.current.conversation?.messages).toHaveLength(1);
    expect(hook.result.current.conversation?.messages[0]).toMatchObject({ id: "persisted-media", status: "SENT", mediaObjectId: "media-id" });
    expect(revokePreview).toHaveBeenCalledOnce();
  });

  it("releases a media preview once when SSE success wins the HTTP response race", async () => {
    const file = new File(["image"], "produto.png", { type: "image/png" });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:produto");
    const revokePreview = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    let clientRequestId = "";
    let detailFetches = 0;
    let resolveSend!: (response: Response) => void;
    const serverMessage = () => ({
      id: "persisted-media",
      clientRequestId,
      direction: "OUTBOUND",
      type: "IMAGE",
      body: "Foto",
      mediaObjectId: "media-id",
      sentBy: { id: user.id, name: user.name },
      status: "SENT",
      failureReason: null,
      externalTimestamp: "2026-08-20T14:30:00.000Z",
      createdAt: "2026-08-20T14:30:00.000Z",
    });
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/users/assignable") return response({ data: { items: [] }, error: null });
      if (url === "/api/conversations") return response({ data: { items: [], nextCursor: null }, error: null });
      if (url.endsWith("/messages") && init?.method === "POST") {
        clientRequestId = String((init.body as FormData).get("clientRequestId"));
        return new Promise<Response>((resolve) => { resolveSend = resolve; });
      }
      if (url.endsWith("/messages")) {
        detailFetches += 1;
        return response({ data: conversationDetail("conversation-id", detailFetches > 1 ? [serverMessage()] : []), error: null });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-id"));

    let sendPromise!: Promise<unknown>;
    act(() => { sendPromise = hook.result.current.sendMedia("conversation-id", file, "Foto"); });
    await act(() => hook.result.current.refreshConversation());
    expect(revokePreview).toHaveBeenCalledOnce();

    resolveSend(await response({ data: serverMessage(), error: null }, true, 201));
    await act(() => sendPromise);

    expect(revokePreview).toHaveBeenCalledOnce();
    expect(hook.result.current.conversation?.messages).toHaveLength(1);
  });

  it("owns and retries a recording through its dedicated multipart endpoint", async () => {
    const sourceFile = new File(["voice"], "gravacao.webm", { type: "audio/webm", lastModified: 123 });
    const createPreview = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:inbox-recording");
    const revokePreview = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const requestId = "11111111-1111-4111-8111-111111111111";
    const sentForms: FormData[] = [];
    let attempts = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/users/assignable") return response({ data: { items: [] }, error: null });
      if (url === "/api/conversations") return response({ data: { items: [], nextCursor: null }, error: null });
      if (url.endsWith("/messages") && !init?.method) {
        return response({ data: conversationDetail(), error: null });
      }
      if (url === "/api/conversations/conversation-id/recordings" && init?.method === "POST") {
        attempts += 1;
        sentForms.push(init.body as FormData);
        if (attempts === 1) return Promise.reject(new Error("offline"));
        return response({ data: {
          id: "recording-message",
          clientRequestId: requestId,
          direction: "OUTBOUND",
          type: "AUDIO",
          body: null,
          mediaObjectId: "audio-media",
          sentBy: { id: user.id, name: user.name },
          status: "SENT",
          failureReason: null,
          externalTimestamp: "2026-08-20T14:30:00.000Z",
          createdAt: "2026-08-20T14:30:00.000Z",
        }, error: null }, true, 201);
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-id"));

    await act(() => hook.result.current.sendRecording("conversation-id", sourceFile, requestId));

    const failed = hook.result.current.conversation?.messages[0];
    expect(failed).toMatchObject({
      id: `optimistic:${requestId}`,
      clientRequestId: requestId,
      type: "AUDIO",
      body: null,
      status: "FAILED",
      localFileName: "gravacao.webm",
    });
    const firstFile = sentForms[0].get("file");
    expect([...sentForms[0].keys()].sort()).toEqual(["clientRequestId", "file"]);
    expect(sentForms[0].get("clientRequestId")).toBe(requestId);
    expect(firstFile).toBeInstanceOf(File);
    expect(firstFile).not.toBe(sourceFile);
    expect(createPreview).toHaveBeenCalledWith(firstFile);

    await act(() => hook.result.current.sendRecording("conversation-id", sourceFile, requestId));

    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/recordings"))).toHaveLength(2);
    expect(createPreview).toHaveBeenCalledOnce();
    expect(sentForms[1].get("clientRequestId")).toBe(requestId);
    expect(sentForms[1].get("file")).toBe(firstFile);
    expect(hook.result.current.conversation?.messages).toHaveLength(1);
    expect(hook.result.current.conversation?.messages[0]).toMatchObject({
      id: "recording-message",
      type: "AUDIO",
      status: "SENT",
      mediaObjectId: "audio-media",
    });
    expect(revokePreview).toHaveBeenCalledOnce();
  });

  it("restores a failed recording row after navigating away and back", async () => {
    const sourceFile = new File(["voice"], "gravacao.webm", { type: "audio/webm" });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:navigated-recording");
    const requestId = "66666666-6666-4666-8666-666666666666";
    let rejectFirst!: (reason?: unknown) => void;
    let attempts = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/users/assignable") return response({ data: { items: [] }, error: null });
      if (url === "/api/conversations") return response({ data: { items: [listItem("conversation-a"), listItem("conversation-b")], nextCursor: null }, error: null });
      if (url === "/api/conversations/conversation-a/messages" && !init?.method) {
        return response({ data: conversationDetail("conversation-a"), error: null });
      }
      if (url === "/api/conversations/conversation-b/messages" && !init?.method) {
        return response({ data: conversationDetail("conversation-b"), error: null });
      }
      if (url === "/api/conversations/conversation-a/recordings" && init?.method === "POST") {
        attempts += 1;
        if (attempts === 1) return new Promise<Response>((_resolve, reject) => { rejectFirst = reject; });
        return response({ data: {
          id: "navigated-recording-message",
          clientRequestId: requestId,
          direction: "OUTBOUND",
          type: "AUDIO",
          body: null,
          mediaObjectId: "audio-media",
          sentBy: { id: user.id, name: user.name },
          status: "SENT",
          failureReason: null,
          externalTimestamp: "2026-08-20T14:30:00.000Z",
          createdAt: "2026-08-20T14:30:00.000Z",
        }, error: null }, true, 201);
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-a"));

    let firstSend!: Promise<InboxMessage | null>;
    act(() => { firstSend = hook.result.current.sendRecording("conversation-a", sourceFile, requestId); });
    expect(hook.result.current.conversation?.messages).toHaveLength(1);
    await act(() => hook.result.current.openConversation("conversation-b"));
    rejectFirst(new Error("offline"));
    await act(() => firstSend);
    await act(() => hook.result.current.openConversation("conversation-a"));

    const restored = hook.result.current.conversation?.messages[0];
    expect(restored).toMatchObject({
      id: `optimistic:${requestId}`,
      clientRequestId: requestId,
      status: "FAILED",
      localFileName: "gravacao.webm",
      previewUrl: "blob:navigated-recording",
    });
    await act(() => hook.result.current.retryMessage(restored!.id));
    expect(attempts).toBe(2);
    expect(hook.result.current.conversation?.messages).toEqual([
      expect.objectContaining({ id: "navigated-recording-message", status: "SENT" }),
    ]);
  });

  it("releases recording custody once and ignores a response that arrives after unmount", async () => {
    const sourceFile = new File(["voice"], "gravacao.webm", { type: "audio/webm" });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:unmounted-recording");
    const revokePreview = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const requestId = "33333333-3333-4333-8333-333333333333";
    let resolveSend!: (value: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/users/assignable") return response({ data: { items: [] }, error: null });
      if (url === "/api/conversations") return response({ data: { items: [], nextCursor: null }, error: null });
      if (url.endsWith("/messages") && !init?.method) return response({ data: conversationDetail(), error: null });
      if (url.endsWith("/recordings") && init?.method === "POST") {
        return new Promise<Response>((resolve) => { resolveSend = resolve; });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-id"));

    let sendPromise!: Promise<InboxMessage | null>;
    act(() => { sendPromise = hook.result.current.sendRecording("conversation-id", sourceFile, requestId); });
    hook.unmount();
    expect(revokePreview).toHaveBeenCalledOnce();

    resolveSend(await response({ data: {
      id: "late-recording",
      clientRequestId: requestId,
      direction: "OUTBOUND",
      type: "AUDIO",
      body: null,
      mediaObjectId: "audio-media",
      sentBy: { id: user.id, name: user.name },
      status: "SENT",
      failureReason: null,
      externalTimestamp: "2026-08-20T14:30:00.000Z",
      createdAt: "2026-08-20T14:30:00.000Z",
    }, error: null }, true, 201));
    await sendPromise;

    expect(revokePreview).toHaveBeenCalledOnce();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("shares one in-flight recording operation across send and bubble retry callers", async () => {
    const sourceFile = new File(["voice"], "gravacao.webm", { type: "audio/webm" });
    const createPreview = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:shared-recording");
    const revokePreview = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const requestId = "44444444-4444-4444-8444-444444444444";
    let resolveSend!: (value: Response) => void;
    let recordingFetches = 0;
    const confirmed = {
      id: "shared-recording-message",
      clientRequestId: requestId,
      direction: "OUTBOUND",
      type: "AUDIO",
      body: null,
      mediaObjectId: "audio-media",
      sentBy: { id: user.id, name: user.name },
      status: "SENT",
      failureReason: null,
      externalTimestamp: "2026-08-20T14:30:00.000Z",
      createdAt: "2026-08-20T14:30:00.000Z",
    };
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/users/assignable") return response({ data: { items: [] }, error: null });
      if (url === "/api/conversations") return response({ data: { items: [], nextCursor: null }, error: null });
      if (url.endsWith("/messages") && !init?.method) return response({ data: conversationDetail(), error: null });
      if (url.endsWith("/recordings") && init?.method === "POST") {
        recordingFetches += 1;
        return new Promise<Response>((resolve) => { resolveSend = resolve; });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-id"));

    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    let retry!: Promise<unknown>;
    act(() => {
      first = hook.result.current.sendRecording("conversation-id", sourceFile, requestId);
      second = hook.result.current.sendRecording("conversation-id", sourceFile, requestId);
      retry = hook.result.current.retryMessage(`optimistic:${requestId}`);
    });

    expect(second).toBe(first);
    expect(retry).toBe(first);
    expect(recordingFetches).toBe(1);
    expect(createPreview).toHaveBeenCalledOnce();
    expect(hook.result.current.conversation?.messages).toHaveLength(1);
    resolveSend(await response({ data: confirmed, error: null }, true, 201));
    const results = await act(() => Promise.all([first, second, retry]));

    expect(results[0]).toEqual(confirmed);
    expect(results[1]).toEqual(confirmed);
    expect(results[2]).toEqual(confirmed);
    expect(recordingFetches).toBe(1);
    expect(hook.result.current.conversation?.messages).toHaveLength(1);
    expect(revokePreview).toHaveBeenCalledOnce();
  });

  it("treats an SSE-confirmed recording as successful when its HTTP response is lost", async () => {
    const sourceFile = new File(["voice"], "gravacao.webm", { type: "audio/webm" });
    const createPreview = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:sse-recording");
    const revokePreview = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const requestId = "55555555-5555-4555-8555-555555555555";
    let rejectSend!: (reason?: unknown) => void;
    let detailFetches = 0;
    let recordingFetches = 0;
    const confirmed = {
      id: "sse-recording-message",
      clientRequestId: requestId,
      direction: "OUTBOUND",
      type: "AUDIO",
      body: null,
      mediaObjectId: "audio-media",
      sentBy: { id: user.id, name: user.name },
      status: "SENT",
      failureReason: null,
      externalTimestamp: "2026-08-20T14:30:00.000Z",
      createdAt: "2026-08-20T14:30:00.000Z",
    };
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/users/assignable") return response({ data: { items: [] }, error: null });
      if (url === "/api/conversations") return response({ data: { items: [], nextCursor: null }, error: null });
      if (url.endsWith("/recordings") && init?.method === "POST") {
        recordingFetches += 1;
        return new Promise<Response>((_resolve, reject) => { rejectSend = reject; });
      }
      if (url.endsWith("/messages")) {
        detailFetches += 1;
        return response({
          data: conversationDetail("conversation-id", detailFetches > 1 ? [confirmed] : []),
          error: null,
        });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-id"));

    let sendPromise!: Promise<InboxMessage | null>;
    act(() => { sendPromise = hook.result.current.sendRecording("conversation-id", sourceFile, requestId); });
    await act(() => hook.result.current.refreshConversation());
    expect(hook.result.current.conversation?.messages).toEqual([confirmed]);
    expect(revokePreview).toHaveBeenCalledOnce();

    act(() => hook.result.current.closeConversation());
    expect(hook.result.current.conversation).toBeNull();
    rejectSend(new Error("lost response"));
    const result: InboxMessage | null = await act(() => sendPromise);
    expect(result).toMatchObject({
      id: confirmed.id,
      clientRequestId: requestId,
      type: "AUDIO",
      status: "SENT",
      mediaObjectId: "audio-media",
    });

    const repeated: InboxMessage | null = await act(() => (
      hook.result.current.sendRecording("conversation-id", sourceFile, requestId)
    ));
    expect(repeated).toEqual(result);
    expect(recordingFetches).toBe(1);
    expect(createPreview).toHaveBeenCalledOnce();
    expect(hook.result.current.conversation).toBeNull();
    expect(revokePreview).toHaveBeenCalledOnce();
  });

  it("deduplicates a recording when SSE wins and ignores its late response after navigation", async () => {
    const sourceFile = new File(["voice"], "gravacao.webm", { type: "audio/webm" });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:owned-recording");
    const revokePreview = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const requestId = "22222222-2222-4222-8222-222222222222";
    let resolveSend!: (value: Response) => void;
    let detailFetches = 0;
    const confirmed = {
      id: "recording-message",
      clientRequestId: requestId,
      direction: "OUTBOUND",
      type: "AUDIO",
      body: null,
      mediaObjectId: "audio-media",
      sentBy: { id: user.id, name: user.name },
      status: "SENT",
      failureReason: null,
      externalTimestamp: "2026-08-20T14:30:00.000Z",
      createdAt: "2026-08-20T14:30:00.000Z",
    };
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/users/assignable") return response({ data: { items: [] }, error: null });
      if (url === "/api/conversations") return response({ data: { items: [], nextCursor: null }, error: null });
      if (url.endsWith("/recordings") && init?.method === "POST") {
        return new Promise<Response>((resolve) => { resolveSend = resolve; });
      }
      if (url === "/api/conversations/conversation-id/messages") {
        detailFetches += 1;
        return response({ data: conversationDetail("conversation-id", detailFetches > 1 ? [confirmed] : []), error: null });
      }
      if (url === "/api/conversations/other/messages") {
        return response({ data: conversationDetail("other"), error: null });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-id"));

    let sendPromise!: Promise<unknown>;
    act(() => { sendPromise = hook.result.current.sendRecording("conversation-id", sourceFile, requestId); });
    expect(hook.result.current.conversation?.messages).toHaveLength(1);
    await act(() => hook.result.current.refreshConversation());
    expect(hook.result.current.conversation?.messages).toHaveLength(1);
    expect(revokePreview).toHaveBeenCalledOnce();

    await act(() => hook.result.current.openConversation("other"));
    resolveSend(await response({ data: confirmed, error: null }, true, 201));
    await act(() => sendPromise);

    expect(hook.result.current.conversation?.id).toBe("other");
    expect(hook.result.current.conversation?.messages).toHaveLength(0);
    expect(revokePreview).toHaveBeenCalledOnce();
  });

  it("blocks overlapping responsible updates so an older response cannot win", async () => {
    let resolvePatch!: (response: Response) => void;
    const patchCalls: Array<string | null> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/users/assignable") return response({ data: { items: [] }, error: null });
      if (url === "/api/conversations") return response({ data: { items: [], nextCursor: null }, error: null });
      if (url.endsWith("/messages")) return response({ data: conversationDetail(), error: null });
      if (url.endsWith("/responsible") && init?.method === "PATCH") {
        const requested = (JSON.parse(String(init.body)) as { userId: string | null }).userId;
        patchCalls.push(requested);
        return new Promise<Response>((resolve) => { resolvePatch = resolve; });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-id"));

    let first!: Promise<void>;
    act(() => { first = hook.result.current.setResponsible("first-user"); });
    await waitFor(() => expect(hook.result.current.responsiblePending).toBe(true));
    await act(() => hook.result.current.setResponsible("second-user"));
    expect(patchCalls).toEqual(["first-user"]);

    resolvePatch(await response({ data: { ...conversationDetail(), responsible: { id: "first-user", name: "Primeiro" } }, error: null }));
    await act(() => first);
    expect(hook.result.current.responsiblePending).toBe(false);
    expect(hook.result.current.conversation?.responsible?.id).toBe("first-user");
  });

  it("refetches server truth and hides raw provider errors after an assignment failure", async () => {
    let detailFetches = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/users/assignable") return response({ data: { items: [] }, error: null });
      if (url === "/api/conversations") return response({ data: { items: [], nextCursor: null }, error: null });
      if (url.endsWith("/messages")) {
        detailFetches += 1;
        return response({ data: { ...conversationDetail(), responsible: detailFetches > 1 ? { id: "server-user", name: "Servidor" } : null }, error: null });
      }
      if (url.endsWith("/responsible") && init?.method === "PATCH") {
        return response({ data: null, error: { message: "Graph OAuthException code 190" } }, false, 502);
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-id"));

    await act(() => hook.result.current.setResponsible("requested-user"));

    expect(detailFetches).toBe(2);
    expect(hook.result.current.conversation?.responsible?.id).toBe("server-user");
    expect(hook.result.current.conversationError).toBe("Não foi possível alterar o responsável.");
    expect(hook.result.current.conversationError).not.toMatch(/Graph|OAuthException|190/i);
  });

  it("clears a previous assignment error after a successful retry while realtime is offline", async () => {
    const successfulResponsible = { id: "successful-user", name: "Atendente final" };
    let listFetches = 0;
    let patchAttempts = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/users/assignable") return response({ data: { items: [] }, error: null });
      if (url === "/api/conversations") {
        listFetches += 1;
        const item = listItem("conversation-id", "Carlos");
        return response({
          data: {
            items: [{ ...item, responsible: listFetches > 1 ? successfulResponsible : null }],
            nextCursor: null,
          },
          error: null,
        });
      }
      if (url.endsWith("/messages")) return response({ data: conversationDetail(), error: null });
      if (url.endsWith("/responsible") && init?.method === "PATCH") {
        patchAttempts += 1;
        if (patchAttempts === 1) {
          return response({ data: null, error: { message: "Graph code 190" } }, false, 502);
        }
        return response({
          data: { ...conversationDetail(), responsible: successfulResponsible },
          error: null,
        });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-id"));
    expect(hook.result.current.connected).toBe(false);

    await act(() => hook.result.current.setResponsible("failed-user"));
    expect(hook.result.current.conversationError).toBe("Não foi possível alterar o responsável.");

    await act(() => hook.result.current.setResponsible(successfulResponsible.id));

    expect(hook.result.current.conversationError).toBeNull();
    expect(hook.result.current.conversation?.responsible).toEqual(successfulResponsible);
    await waitFor(() => expect(hook.result.current.conversations[0]?.responsible).toEqual(successfulResponsible));
    expect(patchAttempts).toBe(2);
  });

  it("never exposes a network Error message in list state", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      if (String(input) === "/api/conversations") return Promise.reject(new Error("Failed to fetch"));
      if (String(input) === "/api/users/assignable") return response({ data: { items: [] }, error: null });
      throw new Error(`Unexpected request ${String(input)}`);
    });
    const hook = renderHook(() => useInbox(user));

    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    expect(hook.result.current.listError).toBe("Não foi possível carregar as conversas.");
    expect(hook.result.current.listError).not.toContain("Failed to fetch");
  });
});
