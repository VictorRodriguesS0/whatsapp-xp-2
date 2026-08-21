// @vitest-environment node

import { describe, expect, it } from "vitest";

import { MediaStatus, UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";
import { createRecoverMediaRouteHandlers } from "./route";

const mediaId = "30000000-0000-4000-8000-000000000001";
const actor = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Victor",
  email: "victor@example.test",
  role: UserRole.ADMIN,
};

function request(body: unknown = { manual: false }) {
  return new Request(`http://localhost/api/media/${mediaId}/recover`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify(body),
  });
}

describe("media recovery route", () => {
  it("requires same origin and recovers as the authenticated actor", async () => {
    const calls: string[] = [];
    const { POST } = createRecoverMediaRouteHandlers({
      assertSameOrigin: () => calls.push("origin"),
      requireUser: async () => { calls.push("auth"); return actor; },
      recoverMedia: async (actorId, id, manual) => {
        calls.push(`${actorId}:${id}:${manual}`);
        return { status: MediaStatus.PENDING, nextAttemptAt: null, canRetry: true };
      },
    });

    const response = await POST(request(), { params: Promise.resolve({ id: mediaId }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { status: MediaStatus.PENDING, nextAttemptAt: null, canRetry: true },
      error: null,
    });
    expect(calls).toEqual(["origin", "auth", `${actor.id}:${mediaId}:false`]);
  });

  it("passes explicit manual recovery semantics", async () => {
    let manualValue: boolean | null = null;
    const { POST } = createRecoverMediaRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      recoverMedia: async (_actorId, _id, manual) => {
        manualValue = manual;
        return { status: MediaStatus.AVAILABLE, nextAttemptAt: null, canRetry: false };
      },
    });

    const response = await POST(request({ manual: true }), { params: Promise.resolve({ id: mediaId }) });

    expect(response.status).toBe(200);
    expect(manualValue).toBe(true);
  });

  it("returns a stable 404 without recovery for an invalid UUID", async () => {
    let recovered = false;
    const { POST } = createRecoverMediaRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      recoverMedia: async () => { recovered = true; throw new Error("must not run"); },
    });

    const response = await POST(request(), { params: Promise.resolve({ id: "not-a-uuid" }) });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Mídia não encontrada" });
    expect(recovered).toBe(false);
  });

  it("rejects an unauthenticated request before recovery", async () => {
    let recovered = false;
    const { POST } = createRecoverMediaRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => { throw new HttpError(401, "Não autenticado"); },
      recoverMedia: async () => { recovered = true; throw new Error("must not run"); },
    });

    const response = await POST(request(), { params: Promise.resolve({ id: mediaId }) });

    expect(response.status).toBe(401);
    expect(recovered).toBe(false);
  });

  it("rejects cross-origin requests before authentication or recovery", async () => {
    const calls: string[] = [];
    const { POST } = createRecoverMediaRouteHandlers({
      assertSameOrigin: () => { calls.push("origin"); throw new HttpError(403, "Origem inválida"); },
      requireUser: async () => { calls.push("auth"); return actor; },
      recoverMedia: async () => { calls.push("recover"); return { status: MediaStatus.AVAILABLE, nextAttemptAt: null, canRetry: false }; },
    });

    const response = await POST(request(), { params: Promise.resolve({ id: mediaId }) });

    expect(response.status).toBe(403);
    expect(calls).toEqual(["origin"]);
  });

  it("rejects malformed recovery semantics without invoking the service", async () => {
    let recovered = false;
    const { POST } = createRecoverMediaRouteHandlers({
      assertSameOrigin: () => undefined,
      requireUser: async () => actor,
      recoverMedia: async () => { recovered = true; throw new Error("must not run"); },
    });

    const response = await POST(request({ manual: "yes" }), { params: Promise.resolve({ id: mediaId }) });

    expect(response.status).toBe(400);
    expect(recovered).toBe(false);
  });
});
