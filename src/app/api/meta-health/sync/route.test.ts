// @vitest-environment node

import { UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";
import { describe, expect, it, vi } from "vitest";

import { createMetaHealthSyncHandlers } from "./route";

const admin = { id: "00000000-0000-4000-8000-000000000001", name: "Victor", email: "v@x.test", role: UserRole.ADMIN };
const request = (body: unknown = {}) => new Request("http://localhost/api/meta-health/sync", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify(body) });

describe("Meta health sync route", () => {
  it.each([["SYNCED", 202], ["FRESH", 200], ["BUSY", 200], ["RATE_LIMITED", 200]] as const)("returns %i for %s", async (status, expectedStatus) => {
    const syncMetaHealth = vi.fn().mockResolvedValue({ status, success: true });
    const { POST } = createMetaHealthSyncHandlers({ assertSameOrigin: () => undefined, requireAdmin: async () => admin, syncMetaHealth } as never);
    const response = await POST(request());
    expect(response.status).toBe(expectedStatus);
    expect(syncMetaHealth).toHaveBeenCalledWith(admin, { force: true });
  });

  it.each([401, 403])("returns %i before syncing", async (status) => {
    const syncMetaHealth = vi.fn();
    const { POST } = createMetaHealthSyncHandlers({
      assertSameOrigin: () => undefined,
      requireAdmin: async () => { throw new HttpError(status, "blocked"); },
      syncMetaHealth,
    } as never);
    expect((await POST(request())).status).toBe(status);
    expect(syncMetaHealth).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin mutation before authentication", async () => {
    const requireAdmin = vi.fn();
    const syncMetaHealth = vi.fn();
    const { POST } = createMetaHealthSyncHandlers({
      assertSameOrigin: () => { throw new HttpError(403, "Origem inválida"); },
      requireAdmin,
      syncMetaHealth,
    } as never);
    expect((await POST(request())).status).toBe(403);
    expect(requireAdmin).not.toHaveBeenCalled();
    expect(syncMetaHealth).not.toHaveBeenCalled();
  });

  it("rejects non-empty bodies and redacts unexpected service errors", async () => {
    const syncMetaHealth = vi.fn().mockRejectedValue(new Error("Bearer private-token SQL DATABASE_URL"));
    const { POST } = createMetaHealthSyncHandlers({ assertSameOrigin: () => undefined, requireAdmin: async () => admin, syncMetaHealth } as never);
    expect((await POST(request({ extra: true }))).status).toBe(400);
    const failure = await POST(request());
    expect(failure.status).toBe(500);
    expect(await failure.text()).toBe('{"error":"Erro interno"}');
  });
});
