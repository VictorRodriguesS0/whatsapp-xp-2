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

const contactType = {
  id: "10000000-0000-4000-8000-000000000001",
  displayName: "Cliente",
  color: "#176B52",
  position: 10,
  active: true,
};

const authoritativeType = {
  id: contactType.id,
  name: contactType.displayName,
  color: contactType.color,
  active: true,
};

const contactTag = {
  id: "20000000-0000-4000-8000-000000000001",
  displayName: "Aguardando produto",
  color: "#176B52",
  position: 10,
  active: true,
};

const priorityTag = {
  id: "20000000-0000-4000-8000-000000000002",
  displayName: "Prioridade",
  color: "#D64545",
  position: 20,
  active: true,
};

function updatedContact(id: string, tags = [contactTag]) {
  return {
    id,
    preferredName: null,
    name: "Carlos",
    phone: "+55 (61) 99999-9999",
    type: null,
    tags: tags.map(({ displayName, position: _position, ...tag }) => ({
      ...tag,
      name: displayName,
    })),
  };
}

function response(data: unknown, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(data) } as Response);
}

function listItem(id: string, name = id, lastMessageAt = "2026-08-20T14:30:00.000Z") {
  return {
    id,
    contact: { id: `contact-${id}`, name, phone: "5561999999999", profilePictureUrl: null },
    responsible: null,
    pinnedAt: null,
    lastMessageAt,
    latestMessage: null,
    unreadCount: 0,
    manuallyUnread: false,
    manualUnreadRevision: null,
    awaitingResponseSince: null,
    revision: lastMessageAt,
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

function replyableMessage(
  id = "11111111-1111-4111-8111-111111111111",
  overrides: Partial<InboxMessage> = {},
): InboxMessage {
  const now = "2026-08-20T14:30:00.000Z";
  return {
    id,
    clientRequestId: null,
    direction: "INBOUND",
    type: "TEXT",
    body: "Tem esse produto?",
    content: null,
    canReply: true,
    replyTo: null,
    mediaObjectId: null,
    mediaState: null,
    sentBy: null,
    status: "RECEIVED",
    failureReason: null,
    revokedAt: null,
    reactions: [],
    externalTimestamp: now,
    createdAt: now,
    ...overrides,
  };
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Set<(event: MessageEvent) => void>>();

  constructor() {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  close() {}

  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data: JSON.stringify(data) }));
    }
  }
}

describe("useInbox", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    FakeEventSource.instances = [];
  });

  it("loads the active contact type catalog and exposes retryable safe state", async () => {
    let typeAttempts = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/conversations") {
        return response({ data: { items: [], nextCursor: null }, error: null });
      }
      if (url === "/api/users/assignable") {
        return response({ data: { items: [] }, error: null });
      }
      if (url === "/api/contact-types") {
        typeAttempts += 1;
        return typeAttempts === 1
          ? response({ data: null, error: { message: "database address" } }, false, 503)
          : response({ data: { items: [contactType] }, error: null });
      }
      if (url === "/api/contact-tags") {
        return response({ data: { items: [contactTag] }, error: null });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));

    await waitFor(() => expect(hook.result.current.contactTypesLoading).toBe(false));
    expect(hook.result.current.contactTypes).toEqual([]);
    expect(hook.result.current.contactTypesError).toBe(
      "Não foi possível carregar os tipos de contato.",
    );
    expect(hook.result.current.contactTypesError).not.toMatch(/database|address/i);

    await act(() => hook.result.current.loadContactTypes());

    expect(hook.result.current.contactTypes).toEqual([contactType]);
    expect(hook.result.current.contactTypesError).toBeNull();
    expect(typeAttempts).toBe(2);
  });

  it("reloads contact types only on their settings invalidation and realtime sync", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    let typeFetches = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/conversations") {
        return response({ data: { items: [], nextCursor: null }, error: null });
      }
      if (url === "/api/users/assignable") {
        return response({ data: { items: [] }, error: null });
      }
      if (url === "/api/contact-types") {
        typeFetches += 1;
        return response({ data: { items: [contactType] }, error: null });
      }
      if (url === "/api/contact-tags") {
        return response({ data: { items: [contactTag] }, error: null });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(typeFetches).toBe(1));

    act(() => {
      FakeEventSource.instances[0].emit("update", {
        type: "settings.updated",
        scope: "contact-tags",
      });
    });
    await waitFor(() => expect(hook.result.current.contactTagsLoading).toBe(false));
    expect(typeFetches).toBe(1);

    act(() => {
      FakeEventSource.instances[0].emit("update", {
        type: "settings.updated",
        scope: "contact-types",
      });
    });
    await waitFor(() => expect(typeFetches).toBe(2));

    act(() => FakeEventSource.instances[0].onopen?.());
    await waitFor(() => expect(typeFetches).toBe(3));
    hook.unmount();
  });

  it("loads the active contact tag catalog and exposes retryable safe state", async () => {
    let tagAttempts = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/conversations") {
        return response({ data: { items: [], nextCursor: null }, error: null });
      }
      if (url === "/api/users/assignable") {
        return response({ data: { items: [] }, error: null });
      }
      if (url === "/api/contact-tags") {
        tagAttempts += 1;
        return tagAttempts === 1
          ? response({ data: null, error: { message: "database address" } }, false, 503)
          : response({ data: { items: [contactTag] }, error: null });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));

    await waitFor(() => expect(hook.result.current.contactTagsLoading).toBe(false));
    expect(hook.result.current.contactTags).toEqual([]);
    expect(hook.result.current.contactTagsError).toBe(
      "Não foi possível carregar as etiquetas.",
    );
    expect(hook.result.current.contactTagsError).not.toMatch(/database|address/i);

    await act(() => hook.result.current.loadContactTags());

    expect(hook.result.current.contactTags).toEqual([contactTag]);
    expect(hook.result.current.contactTagsError).toBeNull();
    expect(tagAttempts).toBe(2);
  });

  it("reloads contact tags on their settings invalidation and realtime sync", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    let tagFetches = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/conversations") {
        return response({ data: { items: [], nextCursor: null }, error: null });
      }
      if (url === "/api/users/assignable") {
        return response({ data: { items: [] }, error: null });
      }
      if (url === "/api/contact-tags") {
        tagFetches += 1;
        return response({ data: { items: [contactTag] }, error: null });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(tagFetches).toBe(1));

    act(() => {
      FakeEventSource.instances[0].emit("update", {
        type: "settings.updated",
        scope: "contact-types",
      });
      FakeEventSource.instances[0].emit("update", {
        type: "settings.updated",
        scope: "contact-tags",
      });
    });
    await waitFor(() => expect(tagFetches).toBe(2));

    act(() => FakeEventSource.instances[0].onopen?.());
    await waitFor(() => expect(tagFetches).toBe(3));
    hook.unmount();
  });

  it("replaces contact tags once and reconciles list and open detail with server truth", async () => {
    const item = listItem("conversation-id", "Carlos");
    const authoritativeContact = updatedContact(item.contact.id, [contactTag, priorityTag]);
    let resolveSave!: (value: Response) => void;
    let saveCalls = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/conversations") {
        const currentItem = saveCalls > 0
          ? { ...item, contact: { ...item.contact, ...authoritativeContact, profileName: "Carlos" } }
          : item;
        return response({ data: { items: [currentItem], nextCursor: null }, error: null });
      }
      if (url === "/api/users/assignable") {
        return response({ data: { items: [] }, error: null });
      }
      if (url === "/api/contact-tags") {
        return response({ data: { items: [contactTag, priorityTag] }, error: null });
      }
      if (url === "/api/conversations/conversation-id/messages") {
        return response({ data: conversationDetail(), error: null });
      }
      if (url === `/api/contacts/${item.contact.id}/tags` && init?.method === "PUT") {
        saveCalls += 1;
        return new Promise<Response>((resolve) => { resolveSave = resolve; });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-id"));

    let first!: Promise<boolean>;
    let duplicate!: Promise<boolean>;
    act(() => {
      first = hook.result.current.replaceContactTags(item.contact.id, [
        contactTag.id,
        priorityTag.id,
      ]);
      duplicate = hook.result.current.replaceContactTags(item.contact.id, [
        contactTag.id,
        priorityTag.id,
      ]);
    });

    expect(duplicate).toBe(first);
    expect(saveCalls).toBe(1);
    expect(hook.result.current.contactTagSavePendingId).toBe(item.contact.id);
    const saveCall = fetchMock.mock.calls.find(([, options]) => options?.method === "PUT");
    expect(saveCall?.[1]).toMatchObject({
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([contactTag.id, priorityTag.id]),
    });

    resolveSave(await response({ data: authoritativeContact, error: null }));
    await act(() => Promise.all([first, duplicate]));

    expect(hook.result.current.contactTagSavePendingId).toBeNull();
    expect(hook.result.current.contactTagSaveError).toBeNull();
    expect(hook.result.current.conversations[0].contact.tags).toEqual(authoritativeContact.tags);
    expect(hook.result.current.conversation?.contact.tags).toEqual(authoritativeContact.tags);
    expect(hook.result.current.conversation?.contact.profileName).toBe("Carlos");
  });

  it("sends an empty replacement, hides provider failures and allows a successful retry", async () => {
    const item = listItem("conversation-id", "Carlos");
    let attempts = 0;
    let detailFetches = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/conversations") {
        return response({ data: { items: [item], nextCursor: null }, error: null });
      }
      if (url === "/api/users/assignable") {
        return response({ data: { items: [] }, error: null });
      }
      if (url === "/api/contact-tags") {
        return response({ data: { items: [contactTag] }, error: null });
      }
      if (url === "/api/conversations/conversation-id/messages") {
        detailFetches += 1;
        return response({ data: conversationDetail(), error: null });
      }
      if (url === `/api/contacts/${item.contact.id}/tags` && init?.method === "PUT") {
        attempts += 1;
        return attempts === 1
          ? response({ data: null, error: { message: "Graph OAuthException code 190" } }, false, 502)
          : response({ data: updatedContact(item.contact.id, []), error: null });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-id"));

    await act(() => hook.result.current.replaceContactTags(item.contact.id, []));

    expect(detailFetches).toBe(2);
    expect(hook.result.current.contactTagSaveError).toBe(
      "Não foi possível salvar as etiquetas.",
    );
    expect(hook.result.current.contactTagSaveError).not.toMatch(/Graph|OAuthException|190/i);

    await act(() => hook.result.current.replaceContactTags(item.contact.id, []));

    expect(attempts).toBe(2);
    expect(hook.result.current.contactTagSaveError).toBeNull();
    expect(hook.result.current.conversation?.contact.tags).toEqual([]);
  });

  it("sets contact type once and reconciles list and open detail with server truth", async () => {
    const item = listItem("conversation-id", "Carlos");
    const authoritativeContact = {
      ...updatedContact(item.contact.id, []),
      type: authoritativeType,
    };
    let resolveSave!: (value: Response) => void;
    let saveCalls = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/conversations") {
        const currentItem = saveCalls > 0
          ? { ...item, contact: { ...item.contact, ...authoritativeContact } }
          : item;
        return response({ data: { items: [currentItem], nextCursor: null }, error: null });
      }
      if (url === "/api/users/assignable") {
        return response({ data: { items: [] }, error: null });
      }
      if (url === "/api/contact-types") {
        return response({ data: { items: [contactType] }, error: null });
      }
      if (url === "/api/contact-tags") {
        return response({ data: { items: [contactTag] }, error: null });
      }
      if (url === "/api/conversations/conversation-id/messages") {
        return response({ data: conversationDetail(), error: null });
      }
      if (url === `/api/contacts/${item.contact.id}` && init?.method === "PATCH") {
        saveCalls += 1;
        return new Promise<Response>((resolve) => { resolveSave = resolve; });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-id"));

    let first!: Promise<boolean>;
    let duplicate!: Promise<boolean>;
    act(() => {
      first = hook.result.current.setContactType(item.contact.id, contactType.id);
      duplicate = hook.result.current.setContactType(item.contact.id, contactType.id);
    });

    expect(duplicate).toBe(first);
    expect(saveCalls).toBe(1);
    expect(hook.result.current.contactTypeSavePendingId).toBe(item.contact.id);
    const saveCall = fetchMock.mock.calls.find(([, options]) => options?.method === "PATCH");
    expect(saveCall?.[1]).toMatchObject({
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactTypeId: contactType.id }),
    });

    resolveSave(await response({ data: authoritativeContact, error: null }));
    await act(() => Promise.all([first, duplicate]));

    expect(hook.result.current.contactTypeSavePendingId).toBeNull();
    expect(hook.result.current.contactTypeSaveError).toBeNull();
    expect(hook.result.current.conversations[0].contact.type).toEqual(authoritativeType);
    expect(hook.result.current.conversation?.contact.type).toEqual(authoritativeType);
  });

  it("can clear contact type with null", async () => {
    const base = listItem("conversation-id", "Carlos");
    const item = {
      ...base,
      contact: { ...base.contact, type: authoritativeType, tags: [] },
    };
    const clearedContact = { ...updatedContact(item.contact.id, []), type: null };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/conversations") {
        return response({ data: { items: [item], nextCursor: null }, error: null });
      }
      if (url === "/api/users/assignable") {
        return response({ data: { items: [] }, error: null });
      }
      if (url === "/api/contact-types") {
        return response({ data: { items: [contactType] }, error: null });
      }
      if (url === "/api/contact-tags") {
        return response({ data: { items: [contactTag] }, error: null });
      }
      if (url === "/api/conversations/conversation-id/messages") {
        return response({
          data: { ...conversationDetail(), contact: item.contact },
          error: null,
        });
      }
      if (url === `/api/contacts/${item.contact.id}` && init?.method === "PATCH") {
        return response({ data: clearedContact, error: null });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-id"));

    await act(() => hook.result.current.setContactType(item.contact.id, null));

    const clearCall = fetchMock.mock.calls.find(([, options]) => options?.method === "PATCH");
    expect(JSON.parse(String(clearCall?.[1]?.body))).toEqual({ contactTypeId: null });
    expect(hook.result.current.conversation?.contact.type).toBeNull();
  });

  it("shows a safe contact type save error and allows a successful retry", async () => {
    const item = listItem("conversation-id", "Carlos");
    const authoritativeContact = {
      ...updatedContact(item.contact.id, []),
      type: authoritativeType,
    };
    let attempts = 0;
    let detailFetches = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/conversations") {
        return response({ data: { items: [item], nextCursor: null }, error: null });
      }
      if (url === "/api/users/assignable") {
        return response({ data: { items: [] }, error: null });
      }
      if (url === "/api/contact-types") {
        return response({ data: { items: [contactType] }, error: null });
      }
      if (url === "/api/contact-tags") {
        return response({ data: { items: [contactTag] }, error: null });
      }
      if (url === "/api/conversations/conversation-id/messages") {
        detailFetches += 1;
        return response({ data: conversationDetail(), error: null });
      }
      if (url === `/api/contacts/${item.contact.id}` && init?.method === "PATCH") {
        attempts += 1;
        return attempts === 1
          ? response({ data: null, error: { message: "Graph token 190" } }, false, 502)
          : response({ data: authoritativeContact, error: null });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-id"));

    await act(() => hook.result.current.setContactType(item.contact.id, contactType.id));

    expect(detailFetches).toBe(2);
    expect(hook.result.current.contactTypeSaveError).toBe(
      "Não foi possível atualizar o tipo de contato.",
    );
    expect(hook.result.current.contactTypeSaveError).not.toMatch(/Graph|token|190/i);

    await act(() => hook.result.current.setContactType(item.contact.id, contactType.id));

    expect(attempts).toBe(2);
    expect(hook.result.current.contactTypeSaveError).toBeNull();
    expect(hook.result.current.conversation?.contact.type).toEqual(authoritativeType);
  });

  it("navigates to login after a 401 contact type save", async () => {
    const item = listItem("conversation-id", "Carlos");
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/conversations") {
        return response({ data: { items: [item], nextCursor: null }, error: null });
      }
      if (url === "/api/users/assignable") {
        return response({ data: { items: [] }, error: null });
      }
      if (url === "/api/contact-types") {
        return response({ data: { items: [contactType] }, error: null });
      }
      if (url === "/api/contact-tags") {
        return response({ data: { items: [contactTag] }, error: null });
      }
      if (url === `/api/contacts/${item.contact.id}` && init?.method === "PATCH") {
        return response({ data: null, error: { message: "expired" } }, false, 401);
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    const assign = vi.fn();
    vi.stubGlobal("window", { location: { assign } });

    await act(() => hook.result.current.setContactType(item.contact.id, contactType.id));

    expect(assign).toHaveBeenCalledWith("/login");
  });

  it("isolates a stale contact type save failure after switching contacts", async () => {
    const first = listItem("conversation-a", "Ana");
    const second = listItem("conversation-b", "Bia");
    const secondContact = {
      ...updatedContact(second.contact.id, []),
      name: "Bia",
      type: authoritativeType,
    };
    let rejectFirst!: (reason?: unknown) => void;
    let resolveSecond!: (value: Response) => void;
    let secondSaved = false;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/conversations") {
        const secondItem = secondSaved
          ? { ...second, contact: { ...second.contact, ...secondContact } }
          : second;
        return response({ data: { items: [first, secondItem], nextCursor: null }, error: null });
      }
      if (url === "/api/users/assignable") {
        return response({ data: { items: [] }, error: null });
      }
      if (url === "/api/contact-types") {
        return response({ data: { items: [contactType] }, error: null });
      }
      if (url === "/api/contact-tags") {
        return response({ data: { items: [contactTag] }, error: null });
      }
      if (url === "/api/conversations/conversation-a/messages") {
        return response({ data: conversationDetail("conversation-a"), error: null });
      }
      if (url === "/api/conversations/conversation-b/messages") {
        return response({
          data: {
            ...conversationDetail("conversation-b"),
            contact: secondSaved
              ? { ...second.contact, ...secondContact }
              : second.contact,
          },
          error: null,
        });
      }
      if (url === `/api/contacts/${first.contact.id}` && init?.method === "PATCH") {
        return new Promise<Response>((_resolve, reject) => { rejectFirst = reject; });
      }
      if (url === `/api/contacts/${second.contact.id}` && init?.method === "PATCH") {
        return new Promise<Response>((resolve) => { resolveSecond = resolve; });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-a"));

    let firstSave!: Promise<boolean>;
    act(() => {
      firstSave = hook.result.current.setContactType(first.contact.id, contactType.id);
    });
    await act(() => hook.result.current.openConversation("conversation-b"));
    let secondSave!: Promise<boolean>;
    act(() => {
      secondSave = hook.result.current.setContactType(second.contact.id, contactType.id);
    });

    secondSaved = true;
    resolveSecond(await response({ data: secondContact, error: null }));
    await act(() => secondSave);
    rejectFirst(new Error("private database failure"));
    await act(() => firstSave);

    expect(hook.result.current.selectedId).toBe("conversation-b");
    expect(hook.result.current.conversation?.contact.type).toEqual(authoritativeType);
    expect(hook.result.current.contactTypeSaveError).toBeNull();
  });

  it("refreshes list and only the matching open detail after a contact update event", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const first = listItem("conversation-a", "Ana");
    const second = listItem("conversation-b", "Bia");
    let listFetches = 0;
    let firstDetailFetches = 0;
    let secondDetailFetches = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/conversations") {
        listFetches += 1;
        return response({ data: { items: [first, second], nextCursor: null }, error: null });
      }
      if (url === "/api/users/assignable") {
        return response({ data: { items: [] }, error: null });
      }
      if (url === "/api/contact-tags") {
        return response({ data: { items: [contactTag] }, error: null });
      }
      if (url === "/api/conversations/conversation-a/messages") {
        firstDetailFetches += 1;
        return response({ data: conversationDetail("conversation-a"), error: null });
      }
      if (url === "/api/conversations/conversation-b/messages") {
        secondDetailFetches += 1;
        return response({ data: conversationDetail("conversation-b"), error: null });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-b"));

    act(() => FakeEventSource.instances[0].emit("update", {
      type: "contact.updated",
      contactId: first.contact.id,
    }));
    await waitFor(() => expect(listFetches).toBe(2));
    expect(secondDetailFetches).toBe(1);

    act(() => FakeEventSource.instances[0].emit("update", {
      type: "contact.updated",
      contactId: second.contact.id,
    }));
    await waitFor(() => expect(listFetches).toBe(3));
    await waitFor(() => expect(secondDetailFetches).toBe(2));
    expect(firstDetailFetches).toBe(0);
    hook.unmount();
  });

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

  it("sends a quoted text and mirrors its preview before and after confirmation", async () => {
    const original = replyableMessage();
    const confirmed = replyableMessage("22222222-2222-4222-8222-222222222222", {
      direction: "OUTBOUND",
      body: "Sim, temos.",
      canReply: true,
      replyTo: {
        available: true,
        messageId: original.id,
        direction: original.direction,
        type: original.type,
        author: "Cliente",
        summary: original.body!,
      },
      sentBy: { id: user.id, name: user.name },
      status: "SENT",
    });
    let resolveSend!: (value: Response) => void;
    let postedBody: Record<string, unknown> | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/conversations") {
        return response({ data: { items: [], nextCursor: null }, error: null });
      }
      if (url === "/api/conversations/conversation-id/messages" && !init?.method) {
        return response({ data: conversationDetail("conversation-id", [original]), error: null });
      }
      if (url.endsWith("/messages") && init?.method === "POST") {
        postedBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return new Promise<Response>((resolve) => { resolveSend = resolve; });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-id"));

    let send!: Promise<InboxMessage | null>;
    act(() => {
      send = hook.result.current.sendText(
        "conversation-id",
        "Sim, temos.",
        original.id,
      );
    });

    expect(postedBody).toMatchObject({
      type: "TEXT",
      body: "Sim, temos.",
      replyToMessageId: original.id,
    });
    expect(hook.result.current.conversation?.messages.at(-1)).toMatchObject({
      status: "PENDING",
      canReply: false,
      replyTo: {
        available: true,
        messageId: original.id,
        author: "Cliente",
        summary: "Tem esse produto?",
      },
    });

    resolveSend(await response({ data: confirmed, error: null }, true, 201));
    await act(() => send);

    expect(hook.result.current.conversation?.messages.at(-1)).toEqual(confirmed);
  });

  it("does not send when the selected quote is unavailable", async () => {
    const unavailable = replyableMessage(undefined, { canReply: false });
    let posts = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/conversations") {
        return response({ data: { items: [], nextCursor: null }, error: null });
      }
      if (url.endsWith("/messages") && !init?.method) {
        return response({ data: conversationDetail("conversation-id", [unavailable]), error: null });
      }
      if (init?.method === "POST") posts += 1;
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-id"));

    const result = await act(() => hook.result.current.sendText(
      "conversation-id",
      "Resposta",
      unavailable.id,
    ));

    expect(result).toBeNull();
    expect(posts).toBe(0);
    expect(hook.result.current.conversation?.messages).toEqual([unavailable]);
  });

  it("keeps the same quote on attachment retry and sends it with recordings", async () => {
    const original = replyableMessage();
    const attachment = new File(["image"], "produto.png", { type: "image/png" });
    const recording = new File(["voice"], "gravacao.webm", { type: "audio/webm" });
    const recordingRequestId = "33333333-3333-4333-8333-333333333333";
    vi.spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:quoted-image")
      .mockReturnValueOnce("blob:quoted-recording");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const attachmentForms: FormData[] = [];
    const recordingForms: FormData[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/conversations") {
        return response({ data: { items: [], nextCursor: null }, error: null });
      }
      if (url.endsWith("/messages") && !init?.method) {
        return response({ data: conversationDetail("conversation-id", [original]), error: null });
      }
      if (url.endsWith("/messages") && init?.method === "POST") {
        const form = init.body as FormData;
        attachmentForms.push(form);
        if (attachmentForms.length === 1) return Promise.reject(new Error("offline"));
        return response({
          data: replyableMessage("44444444-4444-4444-8444-444444444444", {
            direction: "OUTBOUND",
            type: "IMAGE",
            body: "Foto",
            canReply: true,
            replyTo: {
              available: true,
              messageId: original.id,
              direction: original.direction,
              type: original.type,
              author: "Cliente",
              summary: original.body!,
            },
            mediaObjectId: "media-image",
            mediaState: { status: "AVAILABLE", nextAttemptAt: null, canRetry: false },
            sentBy: { id: user.id, name: user.name },
            status: "SENT",
          }),
          error: null,
        }, true, 201);
      }
      if (url.endsWith("/recordings") && init?.method === "POST") {
        const form = init.body as FormData;
        recordingForms.push(form);
        return response({
          data: replyableMessage("55555555-5555-4555-8555-555555555555", {
            direction: "OUTBOUND",
            type: "AUDIO",
            body: null,
            canReply: true,
            replyTo: {
              available: true,
              messageId: original.id,
              direction: original.direction,
              type: original.type,
              author: "Cliente",
              summary: original.body!,
            },
            mediaObjectId: "media-audio",
            mediaState: { status: "AVAILABLE", nextAttemptAt: null, canRetry: false },
            sentBy: { id: user.id, name: user.name },
            status: "SENT",
          }),
          error: null,
        }, true, 201);
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-id"));

    await act(() => hook.result.current.sendMedia(
      "conversation-id",
      attachment,
      "Foto",
      original.id,
    ));
    const failed = hook.result.current.conversation?.messages.at(-1);
    expect(failed).toMatchObject({
      status: "FAILED",
      replyTo: { available: true, messageId: original.id },
    });

    await act(() => hook.result.current.retryMessage(failed!.id));
    await act(() => hook.result.current.sendRecording(
      "conversation-id",
      recording,
      recordingRequestId,
      original.id,
    ));

    expect(attachmentForms).toHaveLength(2);
    expect(attachmentForms.map((form) => form.get("replyToMessageId"))).toEqual([
      original.id,
      original.id,
    ]);
    expect(recordingForms).toHaveLength(1);
    expect(recordingForms[0].get("replyToMessageId")).toBe(original.id);
  });

  it("isolates a quoted send response after switching conversations", async () => {
    const original = replyableMessage();
    const confirmed = replyableMessage("66666666-6666-4666-8666-666666666666", {
      direction: "OUTBOUND",
      body: "Resposta da A",
      canReply: true,
      replyTo: {
        available: true,
        messageId: original.id,
        direction: original.direction,
        type: original.type,
        author: "Cliente",
        summary: original.body!,
      },
      sentBy: { id: user.id, name: user.name },
      status: "SENT",
    });
    let resolveSend!: (value: Response) => void;
    let posts = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/conversations") {
        return response({ data: { items: [], nextCursor: null }, error: null });
      }
      if (url === "/api/conversations/conversation-a/messages" && !init?.method) {
        return response({ data: conversationDetail("conversation-a", [original]), error: null });
      }
      if (url === "/api/conversations/conversation-b/messages" && !init?.method) {
        return response({ data: conversationDetail("conversation-b"), error: null });
      }
      if (url === "/api/conversations/conversation-a/messages" && init?.method === "POST") {
        posts += 1;
        return new Promise<Response>((resolve) => { resolveSend = resolve; });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-a"));

    let send!: Promise<InboxMessage | null>;
    act(() => {
      send = hook.result.current.sendText(
        "conversation-a",
        "Resposta da A",
        original.id,
      );
    });
    await act(() => hook.result.current.openConversation("conversation-b"));
    const rejected = await act(() => hook.result.current.sendText(
      "conversation-b",
      "Não deve enviar",
      original.id,
    ));

    expect(rejected).toBeNull();
    expect(posts).toBe(1);
    resolveSend(await response({ data: confirmed, error: null }, true, 201));
    await act(() => send);
    expect(hook.result.current.conversation).toMatchObject({
      id: "conversation-b",
      messages: [],
    });
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

  it("reconciles an ID-only message.created echo once without duplicating an optimistic API message", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    let rejectSend!: (reason?: unknown) => void;
    let listFetches = 0;
    let detailFetches = 0;
    const sentAt = new Date().toISOString();
    const apiMessage = {
      id: "api-message",
      clientRequestId: "",
      direction: "OUTBOUND" as const,
      type: "TEXT" as const,
      body: "Resposta da equipe",
      mediaObjectId: null,
      sentBy: { id: user.id, name: user.name },
      status: "SENT" as const,
      failureReason: null,
      externalTimestamp: sentAt,
      createdAt: sentAt,
    };
    const echoMessage = {
      id: "echo-message",
      clientRequestId: null,
      direction: "OUTBOUND" as const,
      type: "TEXT" as const,
      body: "Resposta do aplicativo",
      mediaObjectId: null,
      sentBy: null,
      status: "SENT" as const,
      failureReason: null,
      externalTimestamp: sentAt,
      createdAt: sentAt,
    };
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/users/assignable") return response({ data: { items: [] }, error: null });
      if (url === "/api/conversations") {
        listFetches += 1;
        return response({ data: { items: [listItem("conversation-id")], nextCursor: null }, error: null });
      }
      if (url.endsWith("/messages") && init?.method === "POST") {
        apiMessage.clientRequestId = (JSON.parse(String(init.body)) as { clientRequestId: string }).clientRequestId;
        return new Promise<Response>((_resolve, reject) => { rejectSend = reject; });
      }
      if (url === "/api/conversations/conversation-id/messages") {
        detailFetches += 1;
        return response({
          data: conversationDetail("conversation-id", detailFetches === 1 ? [] : [apiMessage, echoMessage]),
          error: null,
        });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-id"));

    let sendPromise!: Promise<InboxMessage | null>;
    act(() => { sendPromise = hook.result.current.sendText("conversation-id", "Resposta da equipe"); });
    await waitFor(() => expect(hook.result.current.conversation?.messages).toHaveLength(1));

    expect(FakeEventSource.instances).toHaveLength(1);
    act(() => {
      FakeEventSource.instances[0].emit("update", {
        type: "message.created",
        conversationId: "conversation-id",
        messageId: "echo-message",
      });
    });
    await waitFor(() => expect(hook.result.current.conversation?.messages).toHaveLength(2));

    expect(listFetches).toBe(2);
    expect(detailFetches).toBe(2);
    expect(hook.result.current.conversation?.messages.map((message) => message.id)).toEqual(["api-message", "echo-message"]);
    expect(hook.result.current.conversation?.messages.filter((message) => message.id === "api-message")).toHaveLength(1);

    rejectSend(new Error("lost response"));
    await expect(sendPromise).resolves.toMatchObject({ id: "api-message" });
    expect(hook.result.current.conversation?.messages).toHaveLength(2);
    hook.unmount();
  });

  it("moves a selected merged source to its target across paginated state and ignores stale source responses", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    let resolveSource!: (value: Response) => void;
    let listFetches = 0;
    let targetFetches = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/users/assignable") return response({ data: { items: [] }, error: null });
      if (url === "/api/conversations?cursor=page-2") {
        return response({ data: { items: [listItem("source"), listItem("page-item")], nextCursor: null }, error: null });
      }
      if (url === "/api/conversations") {
        listFetches += 1;
        return response({ data: { items: [listItem("target"), listItem("first-page")], nextCursor: "page-2" }, error: null });
      }
      if (url === "/api/conversations/source/messages") {
        return new Promise<Response>((resolve) => { resolveSource = resolve; });
      }
      if (url === "/api/conversations/target/messages") {
        targetFetches += 1;
        return response({ data: conversationDetail("target"), error: null });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.nextCursor).toBe("page-2"));
    await act(() => hook.result.current.loadMore());
    expect(hook.result.current.conversations.map((item) => item.id)).toEqual(["target", "first-page", "source", "page-item"]);

    act(() => { void hook.result.current.openConversation("source"); });
    await waitFor(() => expect(hook.result.current.selectedId).toBe("source"));
    act(() => {
      FakeEventSource.instances[0].emit("update", {
        type: "conversation.merged",
        sourceConversationId: "source",
        targetConversationId: "target",
      });
      FakeEventSource.instances[0].emit("update", {
        type: "conversation.merged",
        sourceConversationId: "source",
        targetConversationId: "target",
      });
    });
    await waitFor(() => expect(hook.result.current.conversation?.id).toBe("target"));
    resolveSource(await response({ data: conversationDetail("source"), error: null }));
    await waitFor(() => expect(hook.result.current.loadingConversation).toBe(false));

    expect(hook.result.current.selectedId).toBe("target");
    expect(hook.result.current.conversationError).toBeNull();
    expect(hook.result.current.conversations.map((item) => item.id)).toEqual(["target", "first-page", "page-item"]);
    expect(listFetches).toBe(2);
    expect(targetFetches).toBe(1);
    hook.unmount();
  });

  it("removes an unselected merged source without stealing another active selection", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    let listFetches = 0;
    let activeFetches = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/users/assignable") return response({ data: { items: [] }, error: null });
      if (url === "/api/conversations") {
        listFetches += 1;
        return response({ data: { items: [listItem("active"), listItem("target"), listItem("source")], nextCursor: null }, error: null });
      }
      if (url === "/api/conversations/active/messages") {
        activeFetches += 1;
        return response({ data: conversationDetail("active"), error: null });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("active"));
    act(() => {
      FakeEventSource.instances[0].emit("update", {
        type: "conversation.merged",
        sourceConversationId: "source",
        targetConversationId: "target",
      });
    });
    await waitFor(() => expect(listFetches).toBe(2));

    expect(hook.result.current.selectedId).toBe("active");
    expect(hook.result.current.conversation?.id).toBe("active");
    expect(hook.result.current.conversations.map((item) => item.id)).toEqual(["active", "target"]);
    expect(activeFetches).toBe(1);
    hook.unmount();
  });

  it("moves a pending source send to the merge target without duplicating it", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    let resolveSend!: (value: Response) => void;
    let requestId = "";
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/users/assignable") return response({ data: { items: [] }, error: null });
      if (url === "/api/conversations") return response({ data: { items: [listItem("target"), listItem("source")], nextCursor: null }, error: null });
      if (url === "/api/conversations/source/messages" && !init?.method) return response({ data: conversationDetail("source"), error: null });
      if (url === "/api/conversations/source/messages" && init?.method === "POST") {
        requestId = (JSON.parse(String(init.body)) as { clientRequestId: string }).clientRequestId;
        return new Promise<Response>((resolve) => { resolveSend = resolve; });
      }
      if (url === "/api/conversations/target/messages") return response({ data: conversationDetail("target"), error: null });
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("source"));

    let sendPromise!: Promise<InboxMessage | null>;
    act(() => { sendPromise = hook.result.current.sendText("source", "Mensagem pendente"); });
    await waitFor(() => expect(hook.result.current.conversation?.messages).toHaveLength(1));
    act(() => {
      FakeEventSource.instances[0].emit("update", {
        type: "conversation.merged",
        sourceConversationId: "source",
        targetConversationId: "target",
      });
    });
    await waitFor(() => expect(hook.result.current.conversation?.id).toBe("target"));
    await waitFor(() => expect(hook.result.current.conversation?.messages).toHaveLength(1));

    expect(hook.result.current.conversation?.messages[0]?.clientRequestId).toBe(requestId);
    await act(async () => {
      resolveSend(await response({ data: {
        id: "confirmed-message",
        clientRequestId: requestId,
        direction: "OUTBOUND",
        type: "TEXT",
        body: "Mensagem pendente",
        mediaObjectId: null,
        sentBy: { id: user.id, name: user.name },
        status: "SENT",
        failureReason: null,
        externalTimestamp: "2026-08-21T14:30:00.000Z",
        createdAt: "2026-08-21T14:30:00.000Z",
      }, error: null }, true, 201));
      await expect(sendPromise).resolves.toMatchObject({ id: "confirmed-message" });
    });

    expect(hook.result.current.conversation?.messages).toEqual([
      expect.objectContaining({ id: "confirmed-message", clientRequestId: requestId }),
    ]);
    hook.unmount();
  });

  it("resets paginated state to the authoritative searched first page on realtime reconnect", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    let searchedListFetches = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/users/assignable") return response({ data: { items: [] }, error: null });
      if (url === "/api/conversations") return response({ data: { items: [], nextCursor: null }, error: null });
      if (url === "/api/conversations?search=Rita") {
        searchedListFetches += 1;
        return response({
          data: searchedListFetches === 1
            ? { items: [listItem("stale-first")], nextCursor: "page-2" }
            : { items: [listItem("target")], nextCursor: null },
          error: null,
        });
      }
      if (url === "/api/conversations?search=Rita&cursor=page-2") {
        return response({ data: { items: [listItem("source"), listItem("stale-page")], nextCursor: null }, error: null });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    act(() => hook.result.current.setSearch("Rita"));
    await waitFor(() => expect(hook.result.current.nextCursor).toBe("page-2"));
    await act(() => hook.result.current.loadMore());
    expect(hook.result.current.conversations.map((item) => item.id)).toEqual(["stale-first", "source", "stale-page"]);

    act(() => FakeEventSource.instances[0].onopen?.());
    await waitFor(() => expect(hook.result.current.conversations.map((item) => item.id)).toEqual(["target"]));

    expect(hook.result.current.search).toBe("Rita");
    expect(hook.result.current.nextCursor).toBeNull();
    expect(searchedListFetches).toBe(2);
    hook.unmount();
  });

  it("clears a selected conversation when realtime sync refetches it as missing and ignores an older response", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    let sourceFetches = 0;
    let resolveOldSource!: (value: Response) => void;
    let listFetches = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/users/assignable") return response({ data: { items: [] }, error: null });
      if (url === "/api/conversations") {
        listFetches += 1;
        return response({
          data: { items: listFetches === 1 ? [listItem("source"), listItem("other")] : [listItem("other")], nextCursor: null },
          error: null,
        });
      }
      if (url === "/api/conversations/source/messages") {
        sourceFetches += 1;
        if (sourceFetches === 1) return response({ data: conversationDetail("source"), error: null });
        if (sourceFetches === 2) return new Promise<Response>((resolve) => { resolveOldSource = resolve; });
        return response({ data: null, error: { message: "Missing" } }, false, 404);
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("source"));
    expect(hook.result.current.conversation?.id).toBe("source");

    act(() => { void hook.result.current.refreshConversation(); });
    await waitFor(() => expect(sourceFetches).toBe(2));
    act(() => FakeEventSource.instances[0].onopen?.());
    await waitFor(() => expect(hook.result.current.selectedId).toBeNull());
    await act(async () => { resolveOldSource(await response({ data: conversationDetail("source"), error: null })); });

    expect(hook.result.current.conversation).toBeNull();
    expect(hook.result.current.conversationError).toBeNull();
    expect(hook.result.current.conversations.map((item) => item.id)).toEqual(["other"]);
    hook.unmount();
  });

  it.each([
    ["a server failure", () => response({ data: null, error: { message: "Unavailable" } }, false, 503)],
    ["a network failure", () => Promise.reject(new Error("offline"))],
  ])("keeps the selected conversation and exposes a safe error after %s", async (_label, failDetail) => {
    let detailFetches = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/users/assignable") return response({ data: { items: [] }, error: null });
      if (url === "/api/conversations") return response({ data: { items: [listItem("source")], nextCursor: null }, error: null });
      if (url === "/api/conversations/source/messages") {
        detailFetches += 1;
        return detailFetches === 1
          ? response({ data: conversationDetail("source"), error: null })
          : failDetail();
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("source"));
    await act(() => hook.result.current.refreshConversation());

    expect(hook.result.current.selectedId).toBe("source");
    expect(hook.result.current.conversation?.id).toBe("source");
    expect(hook.result.current.conversationError).toBe("Não foi possível carregar a conversa.");
  });

  it("refreshes the unread list after the read acknowledgement", async () => {
    let listFetches = 0;
    const receivedAt = new Date().toISOString();
    const manualUnreadRevision = "2026-08-21T11:00:00.000Z";
    let readBody: unknown;
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
          manualUnreadRevision,
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
      if (url.endsWith("/read") && init?.method === "POST") {
        readBody = JSON.parse(String(init.body));
        return response({ data: {}, error: null });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-id"));
    expect(listFetches).toBe(1);
    await act(() => hook.result.current.markRead("conversation-id", "received-message"));
    expect(readBody).toEqual({
      messageId: "received-message",
      observedManualUnreadRevision: manualUnreadRevision,
    });
    await waitFor(() => expect(listFetches).toBeGreaterThan(1));
  });

  it("marks a conversation unread once and refreshes shared list and selected detail", async () => {
    let listFetches = 0;
    let detailFetches = 0;
    let unreadFetches = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/users/assignable") return response({ data: { items: [] }, error: null });
      if (url === "/api/conversations") {
        listFetches += 1;
        return response({ data: { items: [listItem("conversation-id")], nextCursor: null }, error: null });
      }
      if (url === "/api/conversations/conversation-id/messages") {
        detailFetches += 1;
        return response({ data: conversationDetail("conversation-id"), error: null });
      }
      if (url === "/api/conversations/conversation-id/unread" && init?.method === "POST") {
        unreadFetches += 1;
        return response({
          data: {
            conversationId: "conversation-id",
            unreadCount: 0,
            manuallyUnread: true,
            manualUnreadRevision: "2026-08-21T12:00:00.000Z",
            awaitingResponseSince: null,
            revision: "2026-08-21T12:00:00.000Z",
          },
          error: null,
        });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-id"));

    expect(hook.result.current).toHaveProperty("markUnread");
    const inbox = hook.result.current as unknown as { markUnread: (id: string) => Promise<void> };
    await act(async () => { await Promise.all([inbox.markUnread("conversation-id"), inbox.markUnread("conversation-id")]); });

    expect(unreadFetches).toBe(1);
    expect(listFetches).toBe(2);
    expect(detailFetches).toBe(2);
  });

  it("keeps the manual unread failure safe for the selected conversation", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/users/assignable") return response({ data: { items: [] }, error: null });
      if (url === "/api/conversations") return response({ data: { items: [listItem("conversation-id")], nextCursor: null }, error: null });
      if (url === "/api/conversations/conversation-id/messages") return response({ data: conversationDetail("conversation-id"), error: null });
      if (url === "/api/conversations/conversation-id/unread" && init?.method === "POST") {
        return response({ data: null, error: { message: "Graph OAuthException 190" } }, false, 502);
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-id"));

    const inbox = hook.result.current as unknown as { markUnread: (id: string) => Promise<void> };
    await act(() => inbox.markUnread("conversation-id"));

    expect(hook.result.current.markUnreadError).toBe("Não foi possível marcar como não lida.");
    expect(hook.result.current.markUnreadError).not.toMatch(/Graph|OAuthException|190/i);
  });

  it("keeps B's manual unread error after A's older request fails", async () => {
    let resolveA!: (value: Response) => void;
    let resolveB!: (value: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/users/assignable") return response({ data: { items: [] }, error: null });
      if (url === "/api/conversations") return response({ data: { items: [listItem("conversation-a"), listItem("conversation-b")], nextCursor: null }, error: null });
      if (url === "/api/conversations/conversation-a/messages") return response({ data: conversationDetail("conversation-a"), error: null });
      if (url === "/api/conversations/conversation-b/messages") return response({ data: conversationDetail("conversation-b"), error: null });
      if (url === "/api/conversations/conversation-a/unread" && init?.method === "POST") {
        return new Promise<Response>((resolve) => { resolveA = resolve; });
      }
      if (url === "/api/conversations/conversation-b/unread" && init?.method === "POST") {
        return new Promise<Response>((resolve) => { resolveB = resolve; });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-a"));

    let markA!: Promise<void>;
    act(() => { markA = hook.result.current.markUnread("conversation-a"); });
    await act(() => hook.result.current.openConversation("conversation-b"));
    let markB!: Promise<void>;
    act(() => { markB = hook.result.current.markUnread("conversation-b"); });
    await act(async () => { resolveB(await response({ data: null, error: { message: "B failed" } }, false, 502)); await markB; });
    expect(hook.result.current.markUnreadError).toBe("Não foi possível marcar como não lida.");

    await act(async () => { resolveA(await response({ data: null, error: { message: "A failed" } }, false, 502)); await markA; });
    expect(hook.result.current.selectedId).toBe("conversation-b");
    expect(hook.result.current.markUnreadError).toBe("Não foi possível marcar como não lida.");
  });

  it("pins optimistically, blocks duplicate actions, and reconciles the server timestamp", async () => {
    let resolvePin!: (value: Response) => void;
    let pinFetches = 0;
    const older = listItem("conversation-a", "Ana", "2026-08-23T12:00:00.000Z");
    const newer = listItem("conversation-b", "Bia", "2026-08-23T13:00:00.000Z");
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/users/assignable") return response({ data: { items: [] }, error: null });
      if (url === "/api/conversations") return response({ data: { items: [newer, older], nextCursor: null }, error: null });
      if (url === "/api/conversations/conversation-a/pin" && init?.method === "PATCH") {
        pinFetches += 1;
        return new Promise<Response>((resolve) => { resolvePin = resolve; });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));

    let first!: Promise<void>;
    let duplicate!: Promise<void>;
    act(() => {
      first = hook.result.current.setPinned("conversation-a", true);
      duplicate = hook.result.current.setPinned("conversation-a", true);
    });

    expect(first).toBe(duplicate);
    expect(pinFetches).toBe(1);
    expect(hook.result.current.conversations.map(({ id }) => id)).toEqual([
      "conversation-a",
      "conversation-b",
    ]);
    expect(hook.result.current.pinPendingIds.has("conversation-a")).toBe(true);

    const pinnedAt = "2026-08-23T13:45:00.000Z";
    await act(async () => {
      resolvePin(await response({
        data: { conversationId: "conversation-a", pinnedAt, revision: pinnedAt },
        error: null,
      }));
      await first;
    });

    expect(hook.result.current.conversations[0]).toMatchObject({
      id: "conversation-a",
      pinnedAt,
      revision: pinnedAt,
    });
    expect(hook.result.current.pinPendingIds.has("conversation-a")).toBe(false);
    expect(hook.result.current.pinError).toBeNull();
  });

  it("restores server ordering and exposes only a safe pin failure", async () => {
    let listFetches = 0;
    const older = listItem("conversation-a", "Ana", "2026-08-23T12:00:00.000Z");
    const newer = listItem("conversation-b", "Bia", "2026-08-23T13:00:00.000Z");
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/users/assignable") return response({ data: { items: [] }, error: null });
      if (url === "/api/conversations") {
        listFetches += 1;
        return response({ data: { items: [newer, older], nextCursor: null }, error: null });
      }
      if (url === "/api/conversations/conversation-a/pin" && init?.method === "PATCH") {
        return response({ data: null, error: { message: "Graph OAuthException 190" } }, false, 502);
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));

    await act(() => hook.result.current.setPinned("conversation-a", true));

    expect(listFetches).toBe(2);
    expect(hook.result.current.conversations.map(({ id }) => id)).toEqual([
      "conversation-b",
      "conversation-a",
    ]);
    expect(hook.result.current.pinError).toBe("Não foi possível atualizar a fixação da conversa.");
    expect(hook.result.current.pinError).not.toMatch(/Graph|OAuthException|190/i);
  });

  it("refreshes the first page for every shared update but reloads detail only for the selected conversation", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    let listFetches = 0;
    let detailFetches = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/users/assignable") return response({ data: { items: [] }, error: null });
      if (url === "/api/conversations") {
        listFetches += 1;
        return response({ data: { items: [listItem("conversation-a"), listItem("conversation-b")], nextCursor: null }, error: null });
      }
      if (url === "/api/conversations/conversation-a/messages") {
        detailFetches += 1;
        return response({ data: conversationDetail("conversation-a"), error: null });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-a"));

    act(() => {
      FakeEventSource.instances[0].emit("update", {
        type: "conversation.updated",
        conversationId: "conversation-a",
        revision: "2026-08-21T12:00:00.000Z",
      });
    });
    await waitFor(() => expect(detailFetches).toBe(2));
    expect(listFetches).toBe(2);

    act(() => {
      FakeEventSource.instances[0].emit("update", {
        type: "conversation.updated",
        conversationId: "conversation-b",
        revision: "2026-08-21T12:01:00.000Z",
      });
    });
    await waitFor(() => expect(listFetches).toBe(3));
    expect(detailFetches).toBe(2);
  });

  it("refreshes the first page for media updates and reloads detail only when the conversation is selected", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    let listFetches = 0;
    let detailFetches = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/users/assignable") return response({ data: { items: [] }, error: null });
      if (url === "/api/conversations") {
        listFetches += 1;
        return response({ data: { items: [listItem("conversation-a"), listItem("conversation-b")], nextCursor: null }, error: null });
      }
      if (url === "/api/conversations/conversation-a/messages") {
        detailFetches += 1;
        return response({ data: conversationDetail("conversation-a"), error: null });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-a"));

    act(() => {
      FakeEventSource.instances[0].emit("update", {
        type: "media.updated",
        conversationId: "conversation-a",
        messageId: "message-a",
        mediaId: "media-a",
      });
    });
    await waitFor(() => expect(detailFetches).toBe(2));
    expect(listFetches).toBe(2);

    act(() => {
      FakeEventSource.instances[0].emit("update", {
        type: "media.updated",
        conversationId: "conversation-b",
        messageId: "message-b",
        mediaId: "media-b",
      });
    });
    await waitFor(() => expect(listFetches).toBe(3));
    expect(detailFetches).toBe(2);
  });

  it("acknowledges the selected conversation with its own manual-unread revision", async () => {
    const revisionA = "2026-08-21T12:00:00.000Z";
    const revisionB = "2026-08-21T12:01:00.000Z";
    let readBody: unknown;
    const messageFor = (id: string) => ({
      id: `message-${id}`,
      direction: "INBOUND" as const,
      type: "TEXT" as const,
      body: "Olá",
      mediaObjectId: null,
      sentBy: null,
      status: "RECEIVED" as const,
      failureReason: null,
      externalTimestamp: revisionA,
      createdAt: revisionA,
    });
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/users/assignable") return response({ data: { items: [] }, error: null });
      if (url === "/api/conversations") return response({ data: { items: [], nextCursor: null }, error: null });
      if (url === "/api/conversations/conversation-a/messages") {
        return response({ data: { ...conversationDetail("conversation-a", [messageFor("a")]), manuallyUnread: true, manualUnreadRevision: revisionA }, error: null });
      }
      if (url === "/api/conversations/conversation-b/messages") {
        return response({ data: { ...conversationDetail("conversation-b", [messageFor("b")]), manuallyUnread: true, manualUnreadRevision: revisionB }, error: null });
      }
      if (url === "/api/conversations/conversation-b/read" && init?.method === "POST") {
        readBody = JSON.parse(String(init.body));
        return response({ data: {}, error: null });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-a"));
    await act(() => hook.result.current.openConversation("conversation-b"));
    await act(() => hook.result.current.markRead("conversation-b", "message-b"));

    expect(readBody).toEqual({ messageId: "message-b", observedManualUnreadRevision: revisionB });
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

  it("merges exact message context without marking the conversation read", async () => {
    const first = {
      id: "30000000-0000-4000-8000-000000000001",
      clientRequestId: null,
      direction: "INBOUND",
      type: "TEXT",
      body: "Primeira",
      content: null,
      mediaObjectId: null,
      mediaState: null,
      sentBy: null,
      status: "DELIVERED",
      failureReason: null,
      externalTimestamp: "2026-08-20T14:30:00.000Z",
      createdAt: "2026-08-20T14:30:00.000Z",
    };
    const target = {
      ...first,
      id: "30000000-0000-4000-8000-000000000002",
      body: "Produto localizado",
      externalTimestamp: "2026-08-20T14:31:00.000Z",
      createdAt: "2026-08-20T14:31:00.000Z",
    };
    const readRequests: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/users/assignable") return response({ data: { items: [] }, error: null });
      if (url === "/api/conversations") return response({ data: { items: [], nextCursor: null }, error: null });
      if (url.endsWith("/messages")) return response({ data: conversationDetail("conversation-id", [first]), error: null });
      if (url.endsWith(`/messages/${target.id}/context`)) {
        return response({ data: { conversationId: "conversation-id", targetMessageId: target.id, messages: [first, target] }, error: null });
      }
      if (url.endsWith("/read")) {
        readRequests.push(String(init?.method));
        return response({ data: {}, error: null });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    const hook = renderHook(() => useInbox(user));
    await waitFor(() => expect(hook.result.current.loadingList).toBe(false));
    await act(() => hook.result.current.openConversation("conversation-id"));

    await act(() => hook.result.current.loadMessageContext("conversation-id", target.id));

    expect(hook.result.current.conversation?.messages.map((message) => message.id)).toEqual([first.id, target.id]);
    expect(readRequests).toEqual([]);
  });
});
