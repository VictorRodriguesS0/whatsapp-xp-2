// @vitest-environment node

import {
  MessageDirection,
  MessageStatus,
  MessageType,
  UserRole,
} from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";
import { describe, expect, it, vi } from "vitest";

import {
  CATALOG_MESSAGE_JSON_MAX_BYTES,
  createCatalogMessagesRouteHandlers,
} from "./route";

const conversationId = "10000000-0000-4000-8000-000000000001";
const clientRequestId = "50000000-0000-4000-8000-000000000001";
const actor = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Victor",
  email: "victor@example.test",
  role: UserRole.ADMIN,
};

function message() {
  return {
    id: "20000000-0000-4000-8000-000000000001",
    clientRequestId,
    direction: MessageDirection.OUTBOUND,
    type: MessageType.INTERACTIVE,
    body: "Catálogo enviado",
    content: {
      kind: "catalog" as const,
      body: "Confira o catálogo da XP Eletrônicos.",
      thumbnailRetailerId: null,
    },
    canReply: false,
    replyTo: null,
    mediaObjectId: null,
    mediaState: null,
    sentBy: { id: actor.id, name: actor.name },
    status: MessageStatus.SENT,
    failureReason: null,
    editedAt: null,
    revokedAt: null,
    reactions: [],
    externalTimestamp: new Date(0).toISOString(),
    createdAt: new Date(0).toISOString(),
  };
}

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request(
    `http://localhost/api/conversations/${conversationId}/catalog-messages`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    },
  );
}

describe("conversation catalog messages route", () => {
  it.each([
    { clientRequestId, kind: "PRODUCT", retailerIds: ["XP-1"] },
    { clientRequestId, kind: "PRODUCT_LIST", retailerIds: ["XP-1", "XP-2"] },
    { clientRequestId, kind: "CATALOG" },
  ])("sends one validated operation as the authenticated actor %#", async (input) => {
    const order: string[] = [];
    const sendCatalogMessage = vi.fn().mockImplementation(async () => {
      order.push("send");
      return message();
    });
    const { POST } = createCatalogMessagesRouteHandlers({
      assertSameOrigin: () => order.push("origin"),
      requireUser: async () => { order.push("auth"); return actor; },
      sendCatalogMessage,
    });

    const response = await POST(request(input), {
      params: Promise.resolve({ id: conversationId }),
    });

    expect(response.status).toBe(201);
    expect(order).toEqual(["origin", "auth", "send"]);
    expect(sendCatalogMessage).toHaveBeenCalledWith(actor, conversationId, input);
    await expect(response.json()).resolves.toEqual({ data: message(), error: null });
  });

  it.each([
    { clientRequestId: "bad", kind: "CATALOG" },
    { clientRequestId, kind: "PRODUCT", retailerIds: [] },
    { clientRequestId, kind: "PRODUCT_LIST", retailerIds: ["XP-1", "XP-1"] },
    { clientRequestId, kind: "CATALOG", retailerIds: [] },
    { clientRequestId, kind: "PRODUCT", retailerIds: ["XP-1"], catalogId: "123" },
    { clientRequestId, kind: "PRODUCT", retailerIds: ["XP-1"], product: { price: 1 } },
  ])("rejects invalid or forged input before the service %#", async (input) => {
    const sendCatalogMessage = vi.fn();
    const { POST } = createCatalogMessagesRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      sendCatalogMessage,
    });

    const response = await POST(request(input), {
      params: Promise.resolve({ id: conversationId }),
    });
    expect(response.status).toBe(400);
    expect(sendCatalogMessage).not.toHaveBeenCalled();
  });

  it("rejects oversized JSON from Content-Length before consuming the body", async () => {
    let accessed = false;
    const { POST } = createCatalogMessagesRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      sendCatalogMessage: vi.fn(),
    });
    const oversized = request(
      { clientRequestId, kind: "CATALOG" },
      { "content-length": String(CATALOG_MESSAGE_JSON_MAX_BYTES + 1) },
    );
    const body = oversized.body;
    Object.defineProperty(oversized, "body", {
      get() { accessed = true; return body; },
    });

    const response = await POST(oversized, {
      params: Promise.resolve({ id: conversationId }),
    });
    expect(response.status).toBe(413);
    expect(accessed).toBe(false);
  });

  it.each([
    new HttpError(409, "Produto indisponível", "CATALOG_PRODUCT_UNAVAILABLE"),
    new HttpError(409, "Janela encerrada", "WHATSAPP_SERVICE_WINDOW_CLOSED"),
    new HttpError(503, "Tente novamente", "CATALOG_TEMPORARILY_UNAVAILABLE"),
  ])("preserves a safe service failure %#", async (failure) => {
    const { POST } = createCatalogMessagesRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      sendCatalogMessage: async () => { throw failure; },
    });
    const response = await POST(
      request({ clientRequestId, kind: "CATALOG" }),
      { params: Promise.resolve({ id: conversationId }) },
    );
    expect(response.status).toBe(failure.status);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: { code: failure.code, message: failure.message },
    });
  });

  it("redacts unexpected Graph details", async () => {
    const { POST } = createCatalogMessagesRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      sendCatalogMessage: async () => {
        throw new Error("Bearer private https://graph.facebook.com/catalog/123");
      },
    });
    const response = await POST(
      request({ clientRequestId, kind: "CATALOG" }),
      { params: Promise.resolve({ id: conversationId }) },
    );
    expect(response.status).toBe(500);
    expect(await response.text()).toBe(
      '{"data":null,"error":{"code":"INTERNAL_ERROR","message":"Erro interno"}}',
    );
  });
});
