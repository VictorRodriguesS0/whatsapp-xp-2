// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { UserRole } from "@/generated/prisma/enums";

import { createMessageSearchRouteHandlers } from "./route";

const actor = { id: "10000000-0000-4000-8000-000000000001", name: "Ana", email: "ana@example.test", role: UserRole.ATTENDANT };

describe("global message search route", () => {
  it("authenticates and forwards validated search input", async () => {
    const searchMessages = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
    const { GET } = createMessageSearchRouteHandlers({ requireUser: async () => actor, searchMessages });

    const response = await GET(new Request("http://localhost/api/message-search?query=%20pix%20&take=10"));

    expect(searchMessages).toHaveBeenCalledWith(actor.id, { query: "pix", take: 10 });
    await expect(response.json()).resolves.toEqual({ data: { items: [], nextCursor: null }, error: null });
  });

  it("rejects duplicate scalar and one-character query values", async () => {
    const { GET } = createMessageSearchRouteHandlers({ requireUser: async () => actor });
    await expect(GET(new Request("http://localhost/api/message-search?query=a&query=b"))).resolves.toMatchObject({ status: 400 });
    await expect(GET(new Request("http://localhost/api/message-search?query=a"))).resolves.toMatchObject({ status: 400 });
  });
});
