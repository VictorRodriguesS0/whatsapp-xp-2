// @vitest-environment node

import { describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";

import { createWhatsAppTemplateSyncRouteHandlers } from "./route";

const origin = "http://localhost:3000";
const admin = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Victor",
  email: "victor@example.test",
  role: UserRole.ADMIN,
};
const settings = {
  mode: "INACTIVE" as const,
  version: 0,
  lastSync: { status: "SUCCEEDED" as const, attemptedAt: null, succeededAt: null, failureCode: null },
  templates: [],
  assignment: null,
  canActivate: false,
  readinessReason: "NO_ASSIGNMENT" as const,
};

function request(body: unknown, requestOrigin = origin) {
  return new Request(`${origin}/api/settings/whatsapp/sync`, {
    method: "POST",
    headers: { origin: requestOrigin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("WhatsApp template sync route", () => {
  it("orders same-origin, admin, strict body, service and publication", async () => {
    const calls: string[] = [];
    const events: unknown[] = [];
    const { POST } = createWhatsAppTemplateSyncRouteHandlers({
      assertSameOrigin: () => calls.push("origin"),
      requireAdmin: async () => {
        calls.push("auth");
        return admin;
      },
      syncWhatsAppTemplates: async (actor) => {
        calls.push("sync");
        expect(actor).toBe(admin);
        return settings;
      },
      publishRealtime: (event) => {
        calls.push("publish");
        events.push(event);
      },
    });
    const response = await POST(request({}));
    expect(response.status).toBe(200);
    expect(calls).toEqual(["origin", "auth", "sync", "publish"]);
    expect(events).toEqual([{ type: "settings.updated", scope: "whatsapp-policy" }]);
  });

  it("rejects cross-origin and unknown fields before sync", async () => {
    const calls: string[] = [];
    const handlers = createWhatsAppTemplateSyncRouteHandlers({
      assertSameOrigin: (received) => {
        calls.push("origin");
        if (received.headers.get("origin") !== origin) {
          throw new HttpError(403, "Origem inválida");
        }
      },
      requireAdmin: async () => admin,
      syncWhatsAppTemplates: async () => {
        calls.push("sync");
        return settings;
      },
      publishRealtime: () => calls.push("publish"),
    });
    expect((await handlers.POST(request({}, "https://evil.test"))).status).toBe(403);
    expect((await handlers.POST(request({ token: "secret" }))).status).toBe(400);
    expect(calls).toEqual(["origin", "origin"]);
  });

  it("sanitizes unexpected provider failures", async () => {
    const { POST } = createWhatsAppTemplateSyncRouteHandlers({
      assertSameOrigin: () => undefined,
      requireAdmin: async () => admin,
      syncWhatsAppTemplates: async () => {
        throw new Error("Graph token=secret raw diagnostics");
      },
      publishRealtime: () => undefined,
    });
    const response = await POST(request({}));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: { code: "INTERNAL_ERROR", message: "Erro interno" },
    });
  });
});
