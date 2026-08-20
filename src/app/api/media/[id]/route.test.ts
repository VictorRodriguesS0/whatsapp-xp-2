// @vitest-environment node

import { describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";

import { createMediaRouteHandlers } from "./route";

const id = "30000000-0000-4000-8000-000000000001";
const actor = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Victor",
  email: "victor@example.test",
  role: UserRole.ADMIN,
};

describe("authenticated media route", () => {
  it("streams visible media with safe private headers and injection-proof disposition", async () => {
    const { GET } = createMediaRouteHandlers({
      requireUser: async () => actor,
      getMediaForDownload: async () => ({
        stream: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("file")); controller.close(); } }),
        mimeType: "application/pdf",
        sizeBytes: 4n,
        filename: "nota\"; x=bad\r\nX-Evil: yes.pdf",
        kind: "document",
      }),
    });

    const response = await GET(new Request(`http://localhost/api/media/${id}`), {
      params: Promise.resolve({ id }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-length")).toBe("4");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain("attachment;");
    expect(response.headers.get("content-disposition")).not.toMatch(/[\r\n]/);
    expect(response.headers.get("content-disposition")).not.toContain("X-Evil:");
    await expect(response.text()).resolves.toBe("file");
  });

  it("does not resolve or stream media before authentication", async () => {
    let resolved = false;
    const { GET } = createMediaRouteHandlers({
      requireUser: async () => { throw new HttpError(401, "Não autenticado"); },
      getMediaForDownload: async () => { resolved = true; throw new Error("must not run"); },
    });
    const response = await GET(new Request(`http://localhost/api/media/${id}`), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(401);
    expect(resolved).toBe(false);
  });

  it("returns a stable 404 envelope for a malformed media UUID", async () => {
    let resolved = false;
    const { GET } = createMediaRouteHandlers({
      requireUser: async () => actor,
      getMediaForDownload: async () => { resolved = true; throw new Error("must not run"); },
    });
    const response = await GET(new Request("http://localhost/api/media/not-a-uuid"), { params: Promise.resolve({ id: "not-a-uuid" }) });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Mídia não encontrada" });
    expect(resolved).toBe(false);
  });
});
