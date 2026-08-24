// @vitest-environment node

import { UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";
import { describe, expect, it, vi } from "vitest";

import { createMetaHealthAcknowledgeHandlers } from "./route";

const id = "10000000-0000-4000-8000-000000000001";
const admin = { id: "00000000-0000-4000-8000-000000000001", name: "Victor", email: "v@x.test", role: UserRole.ADMIN };
const request = () => new Request(`http://localhost/api/meta-health/alerts/${id}/acknowledge`, { method: "POST", headers: { origin: "http://localhost" }, body: "{}" });

describe("Meta health acknowledgement route", () => {
  it("checks origin, admin and UUID before acknowledging", async () => {
    const calls: string[] = [];
    const acknowledgeMetaAlert = vi.fn(async () => ({ id }));
    const { POST } = createMetaHealthAcknowledgeHandlers({
      assertSameOrigin: () => calls.push("origin"),
      requireAdmin: async () => { calls.push("admin"); return admin; },
      acknowledgeMetaAlert,
    } as never);
    const response = await POST(request(), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(200);
    expect(calls).toEqual(["origin", "admin"]);
    expect(acknowledgeMetaAlert).toHaveBeenCalledWith(admin, id);
  });

  it.each([401, 403])("returns %i without acknowledging", async (status) => {
    const acknowledgeMetaAlert = vi.fn();
    const { POST } = createMetaHealthAcknowledgeHandlers({
      assertSameOrigin: () => undefined,
      requireAdmin: async () => { throw new HttpError(status, "blocked"); },
      acknowledgeMetaAlert,
    } as never);
    expect((await POST(request(), { params: Promise.resolve({ id }) })).status).toBe(status);
    expect(acknowledgeMetaAlert).not.toHaveBeenCalled();
  });

  it("rejects cross-origin and malformed identifiers with generic errors", async () => {
    const acknowledgeMetaAlert = vi.fn();
    const originHandlers = createMetaHealthAcknowledgeHandlers({
      assertSameOrigin: () => { throw new HttpError(403, "Origem inválida"); },
      requireAdmin: async () => admin,
      acknowledgeMetaAlert,
    } as never);
    const invalidHandlers = createMetaHealthAcknowledgeHandlers({
      assertSameOrigin: () => undefined,
      requireAdmin: async () => admin,
      acknowledgeMetaAlert,
    } as never);
    expect((await originHandlers.POST(request(), { params: Promise.resolve({ id }) })).status).toBe(403);
    const invalid = await invalidHandlers.POST(request(), { params: Promise.resolve({ id: "token-secret" }) });
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).not.toContain("token-secret");
  });
});
