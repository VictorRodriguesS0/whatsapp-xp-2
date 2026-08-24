// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";

import { createConversationsRouteHandlers } from "./route";

const actor = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Victor",
  email: "victor@example.test",
  role: UserRole.ADMIN,
};

describe("conversation collection route", () => {
  it("preserves a stable domain error code", async () => {
    const { GET } = createConversationsRouteHandlers({
      requireUser: async () => {
        throw new HttpError(
          409,
          "A janela de atendimento terminou.",
          "WHATSAPP_SERVICE_WINDOW_CLOSED",
        );
      },
      listConversations: async () => ({ items: [], nextCursor: null }),
    });

    const response = await GET(
      new Request("http://localhost:3000/api/conversations"),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: {
        code: "WHATSAPP_SERVICE_WINDOW_CLOSED",
        message: "A janela de atendimento terminou.",
      },
    });
  });

  it("authenticates before parsing query options", async () => {
    const listConversations = vi.fn(async () => ({ items: [], nextCursor: null }));
    const { GET } = createConversationsRouteHandlers({
      requireUser: async () => {
        throw new HttpError(401, "Não autenticado");
      },
      listConversations,
    });

    const response = await GET(
      new Request("http://localhost:3000/api/conversations?unknown=value"),
    );

    expect(response.status).toBe(401);
    expect(listConversations).not.toHaveBeenCalled();
  });

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

  it("passes canonical type and repeated tag filters exactly", async () => {
    const listConversations = vi.fn(async () => ({ items: [], nextCursor: null }));
    const { GET } = createConversationsRouteHandlers({
      requireUser: async () => actor,
      listConversations,
    });
    const typeId = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
    const tagA = "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB";
    const tagB = "CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC";

    const response = await GET(new Request(
      `http://localhost:3000/api/conversations?search=%20Bia%20&contactTypeId=${typeId}&tagIds=${tagA}&tagIds=${tagB}`,
    ));

    expect(response.status).toBe(200);
    expect(listConversations).toHaveBeenCalledWith(actor.id, {
      search: "Bia",
      contactTypeId: typeId.toLowerCase(),
      tagIds: [tagA.toLowerCase(), tagB.toLowerCase()],
    });
  });

  it.each([
    ["unknown key", "unknown=value"],
    ["duplicate scalar", "search=a&search=b"],
    ["empty tag", "tagIds="],
    ["semantic duplicate tags", "tagIds=BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB&tagIds=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
    ["too many tags", Array.from({ length: 21 }, (_, index) => `tagIds=50000000-0000-4000-8000-${(index + 1).toString().padStart(12, "0")}`).join("&")],
    ["invalid cursor length", `cursor=${"x".repeat(2_049)}`],
    ["invalid search length", `search=${"x".repeat(121)}`],
  ])("returns a safe 400 envelope for %s", async (_label, query) => {
    const listConversations = vi.fn(async () => ({ items: [], nextCursor: null }));
    const { GET } = createConversationsRouteHandlers({
      requireUser: async () => actor,
      listConversations,
    });

    const response = await GET(
      new Request(`http://localhost:3000/api/conversations?${query}`),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: { code: "INVALID_INPUT", message: "Dados inválidos" },
    });
    expect(listConversations).not.toHaveBeenCalled();
  });
});
