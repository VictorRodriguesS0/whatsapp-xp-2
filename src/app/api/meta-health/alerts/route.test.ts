// @vitest-environment node

import { UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";
import { describe, expect, it, vi } from "vitest";

import { createMetaHealthAlertsHandlers } from "./route";

const admin = { id: "00000000-0000-4000-8000-000000000001", name: "Victor", email: "v@x.test", role: UserRole.ADMIN };

describe("Meta health alerts route", () => {
  it("parses bounded pagination and returns its page", async () => {
    const listMetaHealthAlerts = vi.fn().mockResolvedValue({ alerts: [], nextCursor: null });
    const { GET } = createMetaHealthAlertsHandlers({ requireAdmin: async () => admin, listMetaHealthAlerts } as never);
    const response = await GET(new Request("http://localhost/api/meta-health/alerts?limit=50&active=true"));
    expect(response.status).toBe(200);
    expect(listMetaHealthAlerts).toHaveBeenCalledWith(admin, { limit: 50, active: true });
  });

  it.each(["limit=101", "limit=1&limit=2", "secret=value", "cursorId=bad"])("rejects invalid query %s", async (query) => {
    const listMetaHealthAlerts = vi.fn();
    const { GET } = createMetaHealthAlertsHandlers({ requireAdmin: async () => admin, listMetaHealthAlerts } as never);
    const response = await GET(new Request(`http://localhost/api/meta-health/alerts?${query}`));
    expect(response.status).toBe(400);
    expect(listMetaHealthAlerts).not.toHaveBeenCalled();
  });

  it.each([401, 403])("returns %i before listing", async (status) => {
    const listMetaHealthAlerts = vi.fn();
    const { GET } = createMetaHealthAlertsHandlers({
      requireAdmin: async () => { throw new HttpError(status, "blocked"); },
      listMetaHealthAlerts,
    } as never);
    expect((await GET(new Request("http://localhost/api/meta-health/alerts"))).status).toBe(status);
    expect(listMetaHealthAlerts).not.toHaveBeenCalled();
  });
});
