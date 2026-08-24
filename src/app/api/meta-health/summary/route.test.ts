// @vitest-environment node

import { UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";
import { describe, expect, it, vi } from "vitest";

import { createMetaHealthSummaryHandlers } from "./route";

const admin = { id: "00000000-0000-4000-8000-000000000001", name: "Victor", email: "v@x.test", role: UserRole.ADMIN };
const summary = { label: "NORMAL", unacknowledgedCount: 0, stale: false };

describe("Meta health summary route", () => {
  it("returns the admin summary", async () => {
    const getMetaHealthSummary = vi.fn().mockResolvedValue(summary);
    const { GET } = createMetaHealthSummaryHandlers({ requireAdmin: async () => admin, getMetaHealthSummary } as never);
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ summary });
    expect(getMetaHealthSummary).toHaveBeenCalledWith(admin);
  });

  it.each([[401, "Não autenticado"], [403, "Acesso negado"]])("returns %i before reading health", async (status, message) => {
    const getMetaHealthSummary = vi.fn();
    const { GET } = createMetaHealthSummaryHandlers({
      requireAdmin: async () => { throw new HttpError(status, message); },
      getMetaHealthSummary,
    } as never);
    expect((await GET()).status).toBe(status);
    expect(getMetaHealthSummary).not.toHaveBeenCalled();
  });
});
