// @vitest-environment node

import { describe, expect, it } from "vitest";

import { ContactMessagingConsentSource, UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";

import { createContactMessagingConsentRouteHandlers } from "./route";

const origin = "http://localhost:3000";
const contactId = "10000000-0000-4000-8000-000000000001";
const actor = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Ana",
  email: "ana@example.test",
  role: UserRole.ATTENDANT,
};
const grantedAt = "2026-08-25T10:30:00.000Z";

function request(body: unknown): Request {
  return new Request(`${origin}/api/contacts/${contactId}/messaging-consent`, {
    method: "PUT",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

describe("contact messaging consent route", () => {
  it("grants consent and publishes only the contact id after commit", async () => {
    const calls: string[] = [];
    const events: unknown[] = [];
    const result = {
      active: true,
      source: ContactMessagingConsentSource.OUTRO,
      grantedAt,
      grantedBy: { id: actor.id, name: actor.name },
      note: "Autorização em feira",
    };
    const { PUT } = createContactMessagingConsentRouteHandlers({
      assertSameOrigin: () => calls.push("origin"),
      requireUser: async () => {
        calls.push("auth");
        return actor;
      },
      setContactMessagingConsent: async (receivedActor, receivedId, input) => {
        calls.push("service");
        expect(receivedActor).toBe(actor);
        expect(receivedId).toBe(contactId);
        expect(input).toEqual({
          action: "GRANT",
          source: ContactMessagingConsentSource.OUTRO,
          note: "Autorização em feira",
        });
        return result;
      },
      publishRealtime: (event) => {
        calls.push("publish");
        events.push(event);
      },
    });

    const response = await PUT(
      request({
        action: "GRANT",
        source: ContactMessagingConsentSource.OUTRO,
        note: "  Autorização em feira  ",
      }),
      { params: Promise.resolve({ id: contactId }) },
    );

    expect(calls).toEqual(["origin", "auth", "service", "publish"]);
    expect(events).toEqual([{ type: "contact.updated", contactId }]);
    expect(JSON.stringify(events)).not.toContain("Autorização em feira");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: result, error: null });
  });

  it("revokes consent through the same strict envelope", async () => {
    const events: unknown[] = [];
    const result = {
      active: false,
      source: null,
      grantedAt: null,
      grantedBy: null,
      note: null,
    };
    const { PUT } = createContactMessagingConsentRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      setContactMessagingConsent: async (_actor, _id, input) => {
        expect(input).toEqual({ action: "REVOKE" });
        return result;
      },
      publishRealtime: (event) => events.push(event),
    });

    const response = await PUT(request({ action: "REVOKE" }), {
      params: Promise.resolve({ id: contactId }),
    });

    expect(events).toEqual([{ type: "contact.updated", contactId }]);
    await expect(response.json()).resolves.toEqual({ data: result, error: null });
  });

  it.each([
    [
      "unknown field",
      {
        action: "GRANT",
        source: ContactMessagingConsentSource.WHATSAPP,
        actorUserId: actor.id,
      },
      contactId,
    ],
    [
      "missing OUTRO note",
      { action: "GRANT", source: ContactMessagingConsentSource.OUTRO },
      contactId,
    ],
    ["invalid contact", { action: "REVOKE" }, "bad"],
  ])("rejects %s before service and publication", async (_label, body, id) => {
    const calls: string[] = [];
    const { PUT } = createContactMessagingConsentRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      setContactMessagingConsent: async () => {
        calls.push("service");
        return {
          active: false,
          source: null,
          grantedAt: null,
          grantedBy: null,
          note: null,
        };
      },
      publishRealtime: () => calls.push("publish"),
    });

    const response = await PUT(request(body), {
      params: Promise.resolve({ id }),
    });

    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("stops an invalid origin before authentication", async () => {
    const calls: string[] = [];
    const { PUT } = createContactMessagingConsentRouteHandlers({
      assertSameOrigin: () => {
        calls.push("origin");
        throw new HttpError(403, "Origem inválida");
      },
      requireUser: async () => {
        calls.push("auth");
        return actor;
      },
      setContactMessagingConsent: async () => {
        calls.push("service");
        throw new Error("unreachable");
      },
      publishRealtime: () => calls.push("publish"),
    });

    const response = await PUT(request({ action: "REVOKE" }), {
      params: Promise.resolve({ id: contactId }),
    });

    expect(response.status).toBe(403);
    expect(calls).toEqual(["origin"]);
  });

  it("preserves unauthenticated failures without publishing", async () => {
    const events: unknown[] = [];
    const { PUT } = createContactMessagingConsentRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => {
        throw new HttpError(401, "Não autenticado");
      },
      setContactMessagingConsent: async () => {
        throw new Error("unreachable");
      },
      publishRealtime: (event) => events.push(event),
    });

    const response = await PUT(request({ action: "REVOKE" }), {
      params: Promise.resolve({ id: contactId }),
    });

    expect(response.status).toBe(401);
    expect(events).toEqual([]);
  });

  it("propagates only the stable opt-out domain error and never publishes", async () => {
    const events: unknown[] = [];
    const { PUT } = createContactMessagingConsentRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      setContactMessagingConsent: async () => {
        throw new HttpError(
          409,
          "Este contato está marcado como não contatar.",
          "WHATSAPP_CONTACT_OPTED_OUT",
        );
      },
      publishRealtime: (event) => events.push(event),
    });

    const response = await PUT(
      request({
        action: "GRANT",
        source: ContactMessagingConsentSource.WHATSAPP,
      }),
      { params: Promise.resolve({ id: contactId }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: {
        code: "WHATSAPP_CONTACT_OPTED_OUT",
        message: "Este contato está marcado como não contatar.",
      },
    });
    expect(events).toEqual([]);
  });
});
