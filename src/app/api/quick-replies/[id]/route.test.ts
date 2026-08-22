// @vitest-environment node

import { describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import { QuickReplyNotFoundError } from "@/modules/quick-replies/service";

import { createQuickReplyItemRouteHandlers } from "./route";

const actor = { id: "00000000-0000-4000-8000-000000000001", name: "Marcos", email: "m@example.test", role: UserRole.ATTENDANT };
const id = "10000000-0000-4000-8000-000000000001";
const item = { id, shortcut: "horario", message: "Texto", position: 10, active: false };

describe("quick reply item route", () => {
  it("allows attendants to edit and toggle a reply", async () => {
    const calls: unknown[] = [];
    const { PATCH } = createQuickReplyItemRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      updateQuickReply: async (receivedId, input) => { calls.push(receivedId, input); return item; },
    });
    const response = await PATCH(new Request(`http://localhost/api/quick-replies/${id}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ active: false }) }), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(200);
    expect(calls).toEqual([id, { active: false }]);
  });

  it("maps missing records to 404 and unexpected errors to a safe 500", async () => {
    let failure: unknown = new QuickReplyNotFoundError();
    const { PATCH } = createQuickReplyItemRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      updateQuickReply: async () => { throw failure; },
    });
    const makeRequest = () => new Request(`http://localhost/api/quick-replies/${id}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ active: true }) });
    expect((await PATCH(makeRequest(), { params: Promise.resolve({ id }) })).status).toBe(404);
    failure = new Error("database secret");
    const unexpected = await PATCH(makeRequest(), { params: Promise.resolve({ id }) });
    expect(unexpected.status).toBe(500);
    expect(await unexpected.json()).toEqual({ data: null, error: { code: "INTERNAL_ERROR", message: "Erro interno" } });
  });
});
