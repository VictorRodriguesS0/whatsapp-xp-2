// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { MediaStatus, MessageDirection, MessageStatus, MessageType, UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";
import type { StagedMediaFile } from "@/modules/media/temp-file";

import { createConversationRecordingsRouteHandler } from "./route";

const conversationId = "10000000-0000-4000-8000-000000000001";
const clientRequestId = "40000000-0000-4000-8000-000000000001";
const actor = { id: "00000000-0000-4000-8000-000000000001", name: "Victor", email: "victor@example.test", role: UserRole.ADMIN };

function staged(mimeType = "audio/webm"): StagedMediaFile & { cleanup: ReturnType<typeof vi.fn> } {
  return {
    path: "/private/raw.part",
    filename: "browser-name.webm",
    mimeType,
    sizeBytes: 1n,
    sha256: "a".repeat(64),
    cleanup: vi.fn().mockResolvedValue(undefined),
  };
}

function message() {
  return {
    id: conversationId,
    direction: MessageDirection.OUTBOUND,
    type: MessageType.AUDIO,
    body: null,
    content: null,
    canReply: false,
    replyTo: null,
    mediaObjectId: conversationId,
    mediaState: { status: MediaStatus.AVAILABLE, nextAttemptAt: null, canRetry: false },
    sentBy: { id: actor.id, name: actor.name },
    status: MessageStatus.SENT,
    failureReason: null,
    revokedAt: null,
    reactions: [],
    externalTimestamp: new Date(0).toISOString(),
    createdAt: new Date(0).toISOString(),
  };
}

describe("conversation recordings route", () => {
  it("rejects cross-origin and unauthenticated requests before touching the body", async () => {
    let bodyAccessed = false;
    const request = new Request("http://localhost/recordings", { method: "POST", body: "ignored" });
    const body = request.body;
    Object.defineProperty(request, "body", { get() { bodyAccessed = true; return body; } });
    const crossOrigin = createConversationRecordingsRouteHandler({
      assertSameOrigin: () => { throw new HttpError(403, "Origem inválida"); },
      requireUser: async () => { throw new Error("must not authenticate"); },
    });
    const denied = await crossOrigin(request, { params: Promise.resolve({ id: conversationId }) });
    expect(denied.status).toBe(403);
    expect(bodyAccessed).toBe(false);

    const unauthenticated = createConversationRecordingsRouteHandler({
      assertSameOrigin: () => undefined,
      requireUser: async () => { throw new HttpError(401, "Não autenticado"); },
    });
    const response = await unauthenticated(request, { params: Promise.resolve({ id: conversationId }) });
    expect(response.status).toBe(401);
    expect(bodyAccessed).toBe(false);
  });

  it("validates and authorizes the conversation before admission or multipart parsing", async () => {
    const parse = vi.fn();
    const limiter = { tryAcquire: vi.fn() };
    const handler = createConversationRecordingsRouteHandler({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      getConversation: async () => { throw new HttpError(404, "Conversa não encontrada"); },
      parseRecordingMultipartRequest: parse,
      limiter: limiter as any,
    });

    const response = await handler(new Request("http://localhost/recordings", { method: "POST" }), { params: Promise.resolve({ id: conversationId }) });
    expect(response.status).toBe(404);
    expect(limiter.tryAcquire).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
  });

  it("rejects an invalid conversation UUID before admission or body access", async () => {
    let bodyAccessed = false;
    const request = new Request("http://localhost/recordings", { method: "POST", body: "ignored" });
    const body = request.body;
    Object.defineProperty(request, "body", { get() { bodyAccessed = true; return body; } });
    const parse = vi.fn();
    const limiter = { tryAcquire: vi.fn() };
    const handler = createConversationRecordingsRouteHandler({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      getConversation: async () => { throw new Error("must not authorize"); },
      parseRecordingMultipartRequest: parse,
      limiter: limiter as any,
    });

    const response = await handler(request, { params: Promise.resolve({ id: "not-a-uuid" }) });
    expect(response.status).toBe(400);
    expect(limiter.tryAcquire).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
    expect(bodyAccessed).toBe(false);
  });

  it.each(["BUSY", "RATE_LIMITED"] as const)("returns 429 for %s before reading multipart", async (admission) => {
    const parse = vi.fn();
    const handler = createConversationRecordingsRouteHandler({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      getConversation: async () => ({}) as any,
      limiter: { tryAcquire: () => admission } as any,
      parseRecordingMultipartRequest: parse,
    });

    const response = await handler(new Request("http://localhost/recordings", { method: "POST" }), { params: Promise.resolve({ id: conversationId }) });
    expect(response.status).toBe(429);
    expect(parse).not.toHaveBeenCalled();
  });

  it("converts raw audio, sends canonical AUDIO input, and cleans every temporary", async () => {
    const raw = staged();
    const converted = staged("audio/ogg");
    converted.path = "/private/converted.ogg";
    converted.filename = "gravacao.ogg";
    const release = vi.fn();
    const sendMessage = vi.fn().mockResolvedValue(message());
    const convertRecording = vi.fn().mockResolvedValue(converted);
    const handler = createConversationRecordingsRouteHandler({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      getConversation: async () => ({}) as any,
      limiter: { tryAcquire: () => ({ release }) } as any,
      parseRecordingMultipartRequest: async () => ({
        fields: {
          clientRequestId,
          replyToMessageId: "20000000-0000-4000-8000-000000000001",
        },
        file: raw,
      }),
      convertRecording,
      sendMessage,
    });

    const response = await handler(new Request("http://localhost/recordings", { method: "POST" }), { params: Promise.resolve({ id: conversationId }) });
    expect(response.status).toBe(201);
    expect(convertRecording).toHaveBeenCalledWith({ root: expect.any(String), source: raw });
    expect(sendMessage).toHaveBeenCalledWith(actor, conversationId, {
      type: "AUDIO",
      clientRequestId,
      replyToMessageId: "20000000-0000-4000-8000-000000000001",
      file: {
        filename: "gravacao.ogg",
        mimeType: "audio/ogg",
        path: "/private/converted.ogg",
        sizeBytes: 1n,
        sha256: "a".repeat(64),
        cleanup: converted.cleanup,
      },
    });
    expect(raw.cleanup).toHaveBeenCalledTimes(1);
    expect(converted.cleanup).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("cleans raw audio and releases admission when conversion fails", async () => {
    const raw = staged();
    const release = vi.fn();
    const handler = createConversationRecordingsRouteHandler({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      getConversation: async () => ({}) as any,
      limiter: { tryAcquire: () => ({ release }) } as any,
      parseRecordingMultipartRequest: async () => ({ fields: { clientRequestId }, file: raw }),
      convertRecording: async () => { throw new HttpError(422, "Não foi possível converter a gravação"); },
    });

    const response = await handler(new Request("http://localhost/recordings", { method: "POST" }), { params: Promise.resolve({ id: conversationId }) });
    expect(response.status).toBe(422);
    expect(raw.cleanup).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("cleans raw and converted audio and releases admission when sending fails", async () => {
    const raw = staged();
    const converted = staged("audio/ogg");
    const release = vi.fn();
    const handler = createConversationRecordingsRouteHandler({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      getConversation: async () => ({}) as any,
      limiter: { tryAcquire: () => ({ release }) } as any,
      parseRecordingMultipartRequest: async () => ({ fields: { clientRequestId }, file: raw }),
      convertRecording: async () => converted,
      sendMessage: async () => { throw new Error("provider unavailable"); },
    });

    const response = await handler(new Request("http://localhost/recordings", { method: "POST" }), { params: Promise.resolve({ id: conversationId }) });
    expect(response.status).toBe(500);
    expect(raw.cleanup).toHaveBeenCalledTimes(1);
    expect(converted.cleanup).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("delegates repeated client request ids to sendMessage and cleans both attempts", async () => {
    const release = vi.fn();
    const sendMessage = vi.fn().mockResolvedValue(message());
    const handler = createConversationRecordingsRouteHandler({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      getConversation: async () => ({}) as any,
      limiter: { tryAcquire: () => ({ release }) } as any,
      parseRecordingMultipartRequest: async () => ({ fields: { clientRequestId }, file: staged() }),
      convertRecording: async () => staged("audio/ogg"),
      sendMessage,
    });

    await handler(new Request("http://localhost/recordings", { method: "POST" }), { params: Promise.resolve({ id: conversationId }) });
    await handler(new Request("http://localhost/recordings", { method: "POST" }), { params: Promise.resolve({ id: conversationId }) });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls.map((call) => call[2].clientRequestId)).toEqual([clientRequestId, clientRequestId]);
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("finishes cleanup after the client aborts while delivery is in progress", async () => {
    const raw = staged();
    const converted = staged("audio/ogg");
    const release = vi.fn();
    const controller = new AbortController();
    const handler = createConversationRecordingsRouteHandler({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      getConversation: async () => ({}) as any,
      limiter: { tryAcquire: () => ({ release }) } as any,
      parseRecordingMultipartRequest: async () => ({ fields: { clientRequestId }, file: raw }),
      convertRecording: async () => converted,
      sendMessage: async () => { controller.abort(); return message(); },
    });

    const response = await handler(new Request("http://localhost/recordings", { method: "POST", signal: controller.signal }), { params: Promise.resolve({ id: conversationId }) });
    expect(response.status).toBe(201);
    expect(raw.cleanup).toHaveBeenCalledTimes(1);
    expect(converted.cleanup).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid client ids and raw MIME before conversion and cleans staging", async () => {
    const raw = staged();
    const convertRecording = vi.fn();
    const handler = createConversationRecordingsRouteHandler({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      getConversation: async () => ({}) as any,
      limiter: { tryAcquire: () => ({ release() {} }) } as any,
      parseRecordingMultipartRequest: async () => ({ fields: { clientRequestId: "not-a-uuid" }, file: raw }),
      convertRecording,
    });
    const response = await handler(new Request("http://localhost/recordings", { method: "POST" }), { params: Promise.resolve({ id: conversationId }) });
    expect(response.status).toBe(400);
    expect(convertRecording).not.toHaveBeenCalled();
    expect(raw.cleanup).toHaveBeenCalledTimes(1);
  });

  it("does not call conversion for an unsupported raw MIME", async () => {
    const raw = staged("text/plain");
    const convertRecording = vi.fn();
    const handler = createConversationRecordingsRouteHandler({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      getConversation: async () => ({}) as any,
      limiter: { tryAcquire: () => ({ release() {} }) } as any,
      parseRecordingMultipartRequest: async () => ({ fields: { clientRequestId }, file: raw }),
      convertRecording,
    });
    const response = await handler(new Request("http://localhost/recordings", { method: "POST" }), { params: Promise.resolve({ id: conversationId }) });
    expect(response.status).toBe(400);
    expect(convertRecording).not.toHaveBeenCalled();
    expect(raw.cleanup).toHaveBeenCalledTimes(1);
  });
});
