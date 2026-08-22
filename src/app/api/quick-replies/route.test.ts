// @vitest-environment node

import { describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";
import { QuickReplyConflictError, QuickReplyValidationError } from "@/modules/quick-replies/service";

import { createQuickRepliesRouteHandlers } from "./route";

const actor = { id: "00000000-0000-4000-8000-000000000001", name: "Marcos", email: "m@example.test", role: UserRole.ATTENDANT };
const item = { id: "10000000-0000-4000-8000-000000000001", shortcut: "horario", message: "Das 9h às 17h30", position: 10, active: true };

function request(body: unknown) {
  return new Request("http://localhost:3000/api/quick-replies", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("quick replies collection route", () => {
  it.each([UserRole.ADMIN, UserRole.ATTENDANT])("allows %s to list active replies", async (role) => {
    const { GET } = createQuickRepliesRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => ({ ...actor, role }),
      listQuickReplies: async (options) => { expect(options).toEqual({ activeOnly: true }); return [item]; },
      createQuickReply: async () => item,
    });
    expect(await (await GET(new Request("http://localhost/api/quick-replies?active=true"))).json()).toEqual({ data: { quickReplies: [item] }, error: null });
  });

  it("returns 401 before reading data when unauthenticated", async () => {
    let listed = false;
    const { GET } = createQuickRepliesRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => { throw new HttpError(401, "Não autenticado"); },
      listQuickReplies: async () => { listed = true; return []; },
      createQuickReply: async () => item,
    });
    expect((await GET(new Request("http://localhost/api/quick-replies"))).status).toBe(401);
    expect(listed).toBe(false);
  });

  it("creates a normalized reply and maps validation and duplicate errors", async () => {
    let failure: unknown = null;
    const { POST } = createQuickRepliesRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      listQuickReplies: async () => [],
      createQuickReply: async (input) => { if (failure) throw failure; expect(input).toEqual({ shortcut: "/HORARIO", message: "Texto" }); return item; },
    });
    const created = await POST(request({ shortcut: "/HORARIO", message: "Texto" }));
    failure = new QuickReplyValidationError();
    const invalid = await POST(request({ shortcut: "inválido", message: "Texto" }));
    failure = new QuickReplyConflictError();
    const duplicate = await POST(request({ shortcut: "horario", message: "Outro" }));
    expect(created.status).toBe(201);
    expect(invalid.status).toBe(400);
    expect(duplicate.status).toBe(409);
  });
});
