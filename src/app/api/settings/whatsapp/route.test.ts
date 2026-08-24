// @vitest-environment node

import { describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";

import { createWhatsAppSettingsRouteHandlers } from "./route";

const origin = "http://localhost:3000";
const admin = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Victor",
  email: "victor@example.test",
  role: UserRole.ADMIN,
};
const settings = {
  mode: "INACTIVE" as const,
  version: 2,
  lastSync: {
    status: "SUCCEEDED" as const,
    attemptedAt: "2026-08-24T12:00:00.000Z",
    succeededAt: "2026-08-24T12:00:00.000Z",
    failureCode: null,
  },
  templates: [],
  assignment: null,
  canActivate: false,
  readinessReason: "NO_ASSIGNMENT" as const,
};

function patchRequest(body: unknown): Request {
  return new Request(`${origin}/api/settings/whatsapp`, {
    method: "PATCH",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("WhatsApp settings route", () => {
  it("returns only the safe admin dashboard DTO", async () => {
    const { GET } = createWhatsAppSettingsRouteHandlers({
      assertSameOrigin: () => undefined,
      requireAdmin: async () => admin,
      getWhatsAppPolicySettings: async (actor) => {
        expect(actor).toBe(admin);
        return settings;
      },
      assignServiceResumptionTemplate: async () => settings,
      setWhatsAppPolicyMode: async () => settings,
      publishRealtime: () => undefined,
    });

    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: settings, error: null });
    expect(JSON.stringify(await (await GET()).json())).not.toContain("metaId");
    expect(JSON.stringify(await (await GET()).json())).not.toContain("components");
  });

  it.each([
    [
      { action: "ASSIGN_TEMPLATE", templateId: "A0000000-0000-4000-8000-000000000001" },
      "assign",
    ],
    [{ action: "SET_MODE", mode: "ACTIVE" }, "mode"],
  ] as const)("applies %s after origin and admin checks", async (body, expected) => {
    const calls: string[] = [];
    const events: unknown[] = [];
    const { PATCH } = createWhatsAppSettingsRouteHandlers({
      assertSameOrigin: () => calls.push("origin"),
      requireAdmin: async () => {
        calls.push("auth");
        return admin;
      },
      getWhatsAppPolicySettings: async () => settings,
      assignServiceResumptionTemplate: async (_actor, id) => {
        calls.push("assign");
        expect(id).toBe("a0000000-0000-4000-8000-000000000001");
        return settings;
      },
      setWhatsAppPolicyMode: async (_actor, input) => {
        calls.push("mode");
        expect(input).toEqual({ mode: "ACTIVE" });
        return settings;
      },
      publishRealtime: (event) => {
        calls.push("publish");
        events.push(event);
      },
    });

    const response = await PATCH(patchRequest(body));
    expect(response.status).toBe(200);
    expect(calls).toEqual(["origin", "auth", expected, "publish"]);
    expect(events).toEqual([
      { type: "settings.updated", scope: "whatsapp-policy" },
    ]);
  });

  it.each([
    {},
    { action: "SET_MODE", mode: "ACTIVE", force: true },
    { action: "ASSIGN_TEMPLATE", templateId: "bad" },
    { action: "UNKNOWN" },
  ])("rejects a strict invalid mutation before service", async (body) => {
    const calls: string[] = [];
    const { PATCH } = createWhatsAppSettingsRouteHandlers({
      assertSameOrigin: () => undefined,
      requireAdmin: async () => admin,
      getWhatsAppPolicySettings: async () => settings,
      assignServiceResumptionTemplate: async () => {
        calls.push("assign");
        return settings;
      },
      setWhatsAppPolicyMode: async () => {
        calls.push("mode");
        return settings;
      },
      publishRealtime: () => calls.push("publish"),
    });
    const response = await PATCH(patchRequest(body));
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("preserves an allowed stable domain code without leaking provider details", async () => {
    const { PATCH } = createWhatsAppSettingsRouteHandlers({
      assertSameOrigin: () => undefined,
      requireAdmin: async () => admin,
      getWhatsAppPolicySettings: async () => settings,
      assignServiceResumptionTemplate: async () => settings,
      setWhatsAppPolicyMode: async () => {
        throw new HttpError(
          409,
          "Sincronize e selecione um template aprovado antes de ativar.",
          "WHATSAPP_TEMPLATE_NOT_READY",
        );
      },
      publishRealtime: () => {
        throw new Error("must not publish");
      },
    });
    const response = await PATCH(
      patchRequest({ action: "SET_MODE", mode: "ACTIVE" }),
    );
    expect(response.status).toBe(409);
    const responseBody = await response.json();
    expect(responseBody).toEqual({
      data: null,
      error: {
        code: "WHATSAPP_TEMPLATE_NOT_READY",
        message: "Sincronize e selecione um template aprovado antes de ativar.",
      },
    });
    expect(JSON.stringify(responseBody)).not.toContain("token");
  });
});
