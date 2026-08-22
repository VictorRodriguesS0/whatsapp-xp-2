// @vitest-environment node

import { describe, expect, it } from "vitest";

import { MessageDirection, MessageStatus, MessageType, UserRole } from "@/generated/prisma/enums";
import { createRetryMessageRouteHandlers } from "./route";

const id = "20000000-0000-4000-8000-000000000001";
const actor = { id: "00000000-0000-4000-8000-000000000001", name: "Victor", email: "v@example.test", role: UserRole.ADMIN };

describe("message retry route", () => {
  it("requires same origin and retries as the authenticated actor", async () => {
    const order: string[] = [];
    const { POST } = createRetryMessageRouteHandlers({
      assertSameOrigin: () => order.push("origin"),
      requireUser: async () => { order.push("auth"); return actor; },
      retryMessage: async (receivedActor, receivedId) => {
        order.push(`${receivedActor.id}:${receivedId}`);
        return {
          id,
          direction: MessageDirection.OUTBOUND,
          type: MessageType.TEXT,
          body: "Oi",
          content: null,
          canReply: false,
          replyTo: null,
          mediaObjectId: null,
          mediaState: null,
          sentBy: { id: actor.id, name: actor.name },
          status: MessageStatus.SENT,
          failureReason: null,
          revokedAt: null,
          reactions: [],
          externalTimestamp: new Date(0).toISOString(),
          createdAt: new Date(0).toISOString(),
        };
      },
    });

    const response = await POST(new Request(`http://localhost/api/messages/${id}/retry`, { method: "POST" }), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(200);
    expect(order).toEqual(["origin", "auth", `${actor.id}:${id}`]);
  });

  it("returns a stable 404 envelope for a malformed message UUID", async () => {
    let retried = false;
    const { POST } = createRetryMessageRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      retryMessage: async () => { retried = true; throw new Error("must not run"); },
    });
    const response = await POST(new Request("http://localhost/api/messages/not-a-uuid/retry", { method: "POST" }), { params: Promise.resolve({ id: "not-a-uuid" }) });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Mensagem não encontrada" });
    expect(retried).toBe(false);
  });
});
