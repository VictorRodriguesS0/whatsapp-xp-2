// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";

import { createPdfThumbnailRouteHandlers } from "./route";

const id = "30000000-0000-4000-8000-000000000001";
const actor = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Victor",
  email: "victor@example.test",
  role: UserRole.ADMIN,
};
const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

function stream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

describe("authenticated PDF thumbnail route", () => {
  it("streams the private PNG with exact security headers", async () => {
    const getPdfThumbnail = vi.fn(async () => ({ stream: stream(png), sizeBytes: BigInt(png.byteLength) }));
    const { GET } = createPdfThumbnailRouteHandlers({
      requireUser: async () => actor,
      getPdfThumbnail,
    });

    const response = await GET(new Request(`http://localhost/api/media/${id}/thumbnail`), {
      params: Promise.resolve({ id }),
    });

    expect(response.status).toBe(200);
    expect(getPdfThumbnail).toHaveBeenCalledWith(actor.id, id);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-length")).toBe(String(png.byteLength));
    expect(response.headers.get("content-disposition")).toBe("inline; filename=\"preview.png\"");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
  });

  it("validates the public UUID before invoking the thumbnail service", async () => {
    const getPdfThumbnail = vi.fn();
    const { GET } = createPdfThumbnailRouteHandlers({
      requireUser: async () => actor,
      getPdfThumbnail,
    });

    const response = await GET(new Request("http://localhost/api/media/not-an-id/thumbnail"), {
      params: Promise.resolve({ id: "not-an-id" }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Mídia não encontrada" });
    expect(getPdfThumbnail).not.toHaveBeenCalled();
  });

  it.each([
    [401, "Não autenticado"],
    [404, "Mídia não encontrada"],
    [424, "Miniatura indisponível"],
  ])("preserves a safe %i service response", async (status, message) => {
    const { GET } = createPdfThumbnailRouteHandlers({
      requireUser: async () => actor,
      getPdfThumbnail: async () => { throw new HttpError(status, message); },
    });

    const response = await GET(new Request(`http://localhost/api/media/${id}/thumbnail`), {
      params: Promise.resolve({ id }),
    });

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: message });
  });

  it("requires an active session before inspecting media", async () => {
    const getPdfThumbnail = vi.fn();
    const { GET } = createPdfThumbnailRouteHandlers({
      requireUser: async () => { throw new HttpError(401, "Não autenticado"); },
      getPdfThumbnail,
    });

    const response = await GET(new Request(`http://localhost/api/media/${id}/thumbnail`), {
      params: Promise.resolve({ id }),
    });

    expect(response.status).toBe(401);
    expect(getPdfThumbnail).not.toHaveBeenCalled();
  });

  it("does not expose unexpected renderer details", async () => {
    const { GET } = createPdfThumbnailRouteHandlers({
      requireUser: async () => actor,
      getPdfThumbnail: async () => { throw new Error("/private/path secret stderr"); },
    });

    const response = await GET(new Request(`http://localhost/api/media/${id}/thumbnail`), {
      params: Promise.resolve({ id }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Erro interno" });
  });
});
