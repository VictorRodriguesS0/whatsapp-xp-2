// @vitest-environment node

import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { MessageDirection, MessageStatus, MessageType, UserRole } from "@/generated/prisma/enums";

import { createConversationMessagesRouteHandlers, OUTBOUND_JSON_MAX_BODY_BYTES } from "./route";

const id = "10000000-0000-4000-8000-000000000001";
const actor = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Victor",
  email: "victor@example.test",
  role: UserRole.ADMIN,
};
const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("conversation history route", () => {
  it("awaits params and returns the stable success envelope", async () => {
    let receivedId = "";
    const detail = {
      id,
      contact: {
        id,
        profileName: "Carlos",
        preferredName: null,
        name: "Carlos",
        phone: "1",
        profilePictureUrl: null,
        type: null,
        tags: [],
      },
      responsible: null,
      lastMessageAt: new Date(0).toISOString(),
      latestMessage: null,
      unreadCount: 0,
      manuallyUnread: false,
      manualUnreadRevision: null,
      awaitingResponseSince: null,
      revision: new Date(0).toISOString(),
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      messages: [],
      lastReadMessageId: null,
      lastReadAt: null,
    };
    const { GET } = createConversationMessagesRouteHandlers({
      requireUser: async () => actor,
      getConversation: async (_userId, conversationId) => {
        receivedId = conversationId;
        return detail;
      },
    });

    const response = await GET(new Request(`http://localhost/api/conversations/${id}/messages`), {
      params: Promise.resolve({ id }),
    });

    expect(receivedId).toBe(id);
    await expect(response.json()).resolves.toEqual({ data: detail, error: null });
  });

  it("sends JSON text as the authenticated actor and ignores spoofable identity headers", async () => {
    let received: unknown;
    const { POST } = createConversationMessagesRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      sendMessage: async (receivedActor, receivedConversationId, input) => {
        received = { actor: receivedActor, conversationId: receivedConversationId, input };
        return {
          id,
          direction: MessageDirection.OUTBOUND,
          type: MessageType.TEXT,
          body: "Oi",
          mediaObjectId: null,
          mediaState: null,
          sentBy: { id: actor.id, name: actor.name },
          status: MessageStatus.SENT,
          failureReason: null,
          externalTimestamp: new Date(0).toISOString(),
          createdAt: new Date(0).toISOString(),
        };
      },
    });
    const clientRequestId = "40000000-0000-4000-8000-000000000001";

    const response = await POST(
      new Request(`http://localhost/api/conversations/${id}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": "attacker-controlled",
          "x-forwarded-user": "attacker-controlled",
        },
        body: JSON.stringify({ type: "TEXT", clientRequestId, body: "Oi" }),
      }),
      { params: Promise.resolve({ id }) },
    );

    expect(response.status).toBe(201);
    expect(received).toEqual({
      actor,
      conversationId: id,
      input: { type: "TEXT", clientRequestId, body: "Oi" },
    });
  });

  it("accepts multipart document bytes without trusting the supplied filename as a path", async () => {
    let receivedInput: any;
    const root = await mkdtemp(join(tmpdir(), "xp-route-media-"));
    roots.push(root);
    const { POST } = createConversationMessagesRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      mediaRoot: root,
      sendMessage: async (_actor, _conversationId, input) => {
        receivedInput = input;
        if (input.type !== MessageType.TEXT) receivedInput.stagedBytes = await readFile(input.file.path!);
        return {
          id,
          direction: MessageDirection.OUTBOUND,
          type: MessageType.DOCUMENT,
          body: null,
          mediaObjectId: id,
          mediaState: { status: "AVAILABLE", nextAttemptAt: null, canRetry: false },
          sentBy: { id: actor.id, name: actor.name },
          status: MessageStatus.SENT,
          failureReason: null,
          externalTimestamp: new Date(0).toISOString(),
          createdAt: new Date(0).toISOString(),
        };
      },
    });
    const form = new FormData();
    form.set("type", "DOCUMENT");
    form.set("clientRequestId", "40000000-0000-4000-8000-000000000001");
    form.set("file", new File([new TextEncoder().encode("%PDF-1.7")], "../../nota.pdf", { type: "application/pdf" }));

    const request = new Request(`http://localhost/api/conversations/${id}/messages`, { method: "POST", body: form });
    Object.defineProperty(request, "formData", { value: () => { throw new Error("formData must not be used"); } });
    const response = await POST(
      request,
      { params: Promise.resolve({ id }) },
    );

    expect(response.status).toBe(201);
    expect(receivedInput.file).toMatchObject({
      filename: "../../nota.pdf",
      mimeType: "application/pdf",
      sizeBytes: 8n,
    });
    expect([...receivedInput.stagedBytes]).toEqual([...new TextEncoder().encode("%PDF-1.7")]);
  });

  it("accepts replacement media with the same clientRequestId for service-level LOCAL_FAILURE repair", async () => {
    const root = await mkdtemp(join(tmpdir(), "xp-route-media-repair-"));
    roots.push(root);
    const clientRequestId = "40000000-0000-4000-8000-000000000001";
    let calls = 0;
    const { POST } = createConversationMessagesRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      mediaRoot: root,
      sendMessage: async (_actor, _conversationId, input) => {
        calls += 1;
        expect(input).toMatchObject({ type: MessageType.DOCUMENT, clientRequestId });
        return {
          id,
          direction: MessageDirection.OUTBOUND,
          type: MessageType.DOCUMENT,
          body: null,
          mediaObjectId: calls === 1 ? null : id,
          mediaState: calls === 1
            ? null
            : { status: "AVAILABLE", nextAttemptAt: null, canRetry: false },
          sentBy: { id: actor.id, name: actor.name },
          status: calls === 1 ? MessageStatus.FAILED : MessageStatus.SENT,
          failureReason: calls === 1 ? "Falha local" : null,
          externalTimestamp: new Date(0).toISOString(),
          createdAt: new Date(0).toISOString(),
        };
      },
    });
    const request = () => {
      const form = new FormData();
      form.set("type", "DOCUMENT");
      form.set("clientRequestId", clientRequestId);
      form.set("file", new File([new TextEncoder().encode("%PDF-1.7")], "nota.pdf", { type: "application/pdf" }));
      return new Request(`http://localhost/api/conversations/${id}/messages`, { method: "POST", body: form });
    };

    const first = await POST(request(), { params: Promise.resolve({ id }) });
    const repaired = await POST(request(), { params: Promise.resolve({ id }) });

    expect(first.status).toBe(201);
    expect(repaired.status).toBe(201);
    await expect(first.json()).resolves.toMatchObject({ data: { id, status: MessageStatus.FAILED } });
    await expect(repaired.json()).resolves.toMatchObject({ data: { id, status: MessageStatus.SENT } });
    expect(calls).toBe(2);
    await expect(readdir(join(root, ".staging"))).resolves.toEqual([]);
  });

  it("rejects an oversized multipart request from Content-Length before reading its body", async () => {
    let formDataCalled = false;
    const root = await mkdtemp(join(tmpdir(), "xp-route-media-"));
    roots.push(root);
    const { POST } = createConversationMessagesRouteHandlers({
      mediaRoot: root,
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
    });
    const request = new Request(`http://localhost/api/conversations/${id}/messages`, {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(101 * 1024 * 1024 + 1) },
      body: "--x--\r\n",
    });
    Object.defineProperty(request, "formData", { value: () => { formDataCalled = true; throw new Error("must reject first"); } });
    const response = await POST(request, { params: Promise.resolve({ id }) });

    expect(response.status).toBe(413);
    expect(formDataCalled).toBe(false);
  });

  it.each([
    ["type", "GIF"],
    ["clientRequestId", "not-a-uuid"],
    ["body", "x".repeat(1_025)],
  ])("cleans staged media when multipart %s validation fails", async (field, invalidValue) => {
    const root = await mkdtemp(join(tmpdir(), "xp-route-media-"));
    roots.push(root);
    const { POST } = createConversationMessagesRouteHandlers({
      mediaRoot: root,
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      sendMessage: async () => { throw new Error("sendMessage must not run"); },
    });
    const form = new FormData();
    form.set("type", field === "type" ? invalidValue : "DOCUMENT");
    form.set("clientRequestId", field === "clientRequestId" ? invalidValue : "40000000-0000-4000-8000-000000000001");
    form.set("body", field === "body" ? invalidValue : "ok");
    form.set("file", new File([new TextEncoder().encode("%PDF-1.7")], "nota.pdf", { type: "application/pdf" }));

    const response = await POST(new Request(`http://localhost/api/conversations/${id}/messages`, { method: "POST", body: form }), {
      params: Promise.resolve({ id }),
    });

    expect(response.status).toBe(400);
    await expect(readdir(join(root, ".staging"))).resolves.toEqual([]);
  });

  it("rejects oversized JSON from Content-Length before consuming the body", async () => {
    let bodyAccessed = false;
    const { POST } = createConversationMessagesRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
    });
    const request = new Request(`http://localhost/api/conversations/${id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(OUTBOUND_JSON_MAX_BODY_BYTES + 1) },
      body: "{}",
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const originalBody = request.body;
    Object.defineProperty(request, "body", { get() { bodyAccessed = true; return originalBody; } });

    const response = await POST(request, { params: Promise.resolve({ id }) });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ data: null, error: { code: "REQUEST_FAILED", message: "Payload muito grande" } });
    expect(bodyAccessed).toBe(false);
  });

  it("rejects chunked JSON once the bounded reader reaches its limit", async () => {
    const chunk = new Uint8Array(OUTBOUND_JSON_MAX_BODY_BYTES / 2 + 1).fill(0x20);
    let pulls = 0;
    const { POST } = createConversationMessagesRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
    });
    const request = new Request(`http://localhost/api/conversations/${id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new ReadableStream({
        pull(controller) {
          pulls += 1;
          if (pulls <= 2) controller.enqueue(chunk); else controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const response = await POST(request, { params: Promise.resolve({ id }) });

    expect(response.status).toBe(413);
  });

  it("rejects non-UTF-8 JSON with the stable validation envelope", async () => {
    const { POST } = createConversationMessagesRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
    });
    const request = new Request(`http://localhost/api/conversations/${id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new Uint8Array([0xc3, 0x28]),
    });
    Object.defineProperty(request, "json", { value: () => { throw new Error("request.json must not be used"); } });

    const response = await POST(request, { params: Promise.resolve({ id }) });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ data: null, error: { code: "INVALID_INPUT", message: "JSON inválido" } });
  });
});
