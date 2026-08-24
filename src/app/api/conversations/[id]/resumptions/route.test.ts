// @vitest-environment node

import { describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";

import { createConversationResumptionRouteHandlers } from "./route";

const origin = "http://localhost:3000";
const conversationId = "10000000-0000-4000-8000-000000000001";
const actor = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Ana",
  email: "ana@example.test",
  role: UserRole.ATTENDANT,
};

function request(body: unknown): Request {
  return new Request(`${origin}/api/conversations/${conversationId}/resumptions`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("conversation resumption route", () => {
  it("uses the active employee and returns the idempotent safe result", async () => {
    const calls: string[] = [];
    const result = {
      id: "20000000-0000-4000-8000-000000000001",
      clientRequestId: "30000000-0000-4000-8000-000000000001",
      status: "SENT" as const,
      messageId: "40000000-0000-4000-8000-000000000001",
    };
    const { POST } = createConversationResumptionRouteHandlers({
      assertSameOrigin: () => calls.push("origin"),
      requireUser: async () => {
        calls.push("auth");
        return actor;
      },
      resumeConversation: async (receivedActor, receivedId, input) => {
        calls.push("service");
        expect(receivedActor).toBe(actor);
        expect(receivedId).toBe(conversationId);
        expect(input).toEqual({ clientRequestId: result.clientRequestId });
        return result;
      },
    });
    const response = await POST(request({ clientRequestId: result.clientRequestId }), {
      params: Promise.resolve({ id: conversationId }),
    });
    expect(calls).toEqual(["origin", "auth", "service"]);
    expect(response.status).toBe(200);
    const responseBody = await response.json();
    expect(responseBody).toEqual({ data: result, error: null });
    expect(JSON.stringify(responseBody)).not.toContain("provider");
  });

  it.each([
    ["invalid conversation", conversationId.slice(1), { clientRequestId: "30000000-0000-4000-8000-000000000001" }],
    ["invalid request", conversationId, { clientRequestId: "bad" }],
    ["unknown field", conversationId, { clientRequestId: "30000000-0000-4000-8000-000000000001", templateId: "x" }],
  ])("rejects %s before service", async (_label, id, body) => {
    const calls: string[] = [];
    const { POST } = createConversationResumptionRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      resumeConversation: async () => {
        calls.push("service");
        throw new Error("must not call");
      },
    });
    const response = await POST(request(body), {
      params: Promise.resolve({ id }),
    });
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it.each([
    "WHATSAPP_SERVICE_WINDOW_CLOSED",
    "WHATSAPP_TEMPLATE_NOT_READY",
    "WHATSAPP_RESUMPTION_ALREADY_STARTED",
    "WHATSAPP_CONTACT_OPTED_OUT",
    "WHATSAPP_RESUMPTION_OUTCOME_UNKNOWN",
  ])("preserves stable conflict code %s", async (code) => {
    const { POST } = createConversationResumptionRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      resumeConversation: async () => {
        throw new HttpError(409, "Operação bloqueada com segurança.", code);
      },
    });
    const response = await POST(
      request({ clientRequestId: "30000000-0000-4000-8000-000000000001" }),
      { params: Promise.resolve({ id: conversationId }) },
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code, message: "Operação bloqueada com segurança." },
    });
  });
});
