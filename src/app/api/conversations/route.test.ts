// @vitest-environment node

import { describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";

import { createConversationsRouteHandlers } from "./route";

const actor = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Victor",
  email: "victor@example.test",
  role: UserRole.ADMIN,
};

describe("conversation collection route", () => {
  it("authenticates and returns the stable success envelope", async () => {
    let receivedSearch: string | undefined;
    const { GET } = createConversationsRouteHandlers({
      requireUser: async () => actor,
      listConversations: async (_userId, options) => {
        receivedSearch = options.search;
        return { items: [], nextCursor: null };
      },
    });

    const response = await GET(
      new Request("http://localhost:3000/api/conversations?search=Carlos"),
    );

    expect(receivedSearch).toBe("Carlos");
    await expect(response.json()).resolves.toEqual({
      data: { items: [], nextCursor: null },
      error: null,
    });
  });
});
