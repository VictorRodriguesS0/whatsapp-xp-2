// @vitest-environment node

import { describe, expect, it } from "vitest";

import { UserRole } from "@/generated/prisma/enums";
import { HttpError } from "@/lib/http";
import { MediaRangeNotSatisfiableError } from "@/modules/media/service";

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
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-disposition")).toContain("attachment;");
    expect(response.headers.get("content-disposition")).not.toMatch(/[\r\n]/);
    expect(response.headers.get("content-disposition")).not.toContain("X-Evil:");
    await expect(response.text()).resolves.toBe("file");
  });

  it("previews only a verified PDF inline when explicitly requested", async () => {
    const { GET } = createMediaRouteHandlers({
      requireUser: async () => actor,
      getMediaForDownload: async () => ({
        stream: new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } }),
        mimeType: "application/pdf",
        sizeBytes: 0n,
        filename: "manual.pdf",
        kind: "document",
      }),
    });

    const response = await GET(new Request(`http://localhost/api/media/${id}?preview=1`), {
      params: Promise.resolve({ id }),
    });

    expect(response.headers.get("content-disposition")).toContain("inline;");
  });

  it("keeps a non-PDF document as an attachment even when preview is requested", async () => {
    const { GET } = createMediaRouteHandlers({
      requireUser: async () => actor,
      getMediaForDownload: async () => ({
        stream: new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } }),
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: 0n,
        filename: "manual.docx",
        kind: "document",
      }),
    });

    const response = await GET(new Request(`http://localhost/api/media/${id}?preview=1`), {
      params: Promise.resolve({ id }),
    });

    expect(response.headers.get("content-disposition")).toContain("attachment;");
  });

  it("returns a 206 response and forwards one Range header to the media service", async () => {
    let requestedRange: string | null | undefined;
    const { GET } = createMediaRouteHandlers({
      requireUser: async () => actor,
      getMediaForDownload: async (_actorId, _mediaId, options) => {
        requestedRange = options?.rangeHeader;
        return {
          stream: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("il")); controller.close(); } }),
          mimeType: "video/mp4",
          sizeBytes: 4n,
          filename: "clip.mp4",
          kind: "video",
          range: { start: 1n, end: 2n, length: 2n },
        };
      },
    });

    const response = await GET(new Request(`http://localhost/api/media/${id}`, {
      headers: { Range: "bytes=1-2" },
    }), { params: Promise.resolve({ id }) });

    expect(requestedRange).toBe("bytes=1-2");
    expect(response.status).toBe(206);
    expect(response.headers.get("content-length")).toBe("2");
    expect(response.headers.get("content-range")).toBe("bytes 1-2/4");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    await expect(response.text()).resolves.toBe("il");
  });

  it("returns an RFC-compatible 416 response without resolving a body stream", async () => {
    const { GET } = createMediaRouteHandlers({
      requireUser: async () => actor,
      getMediaForDownload: async () => { throw new MediaRangeNotSatisfiableError(4n); },
    });

    const response = await GET(new Request(`http://localhost/api/media/${id}`, {
      headers: { Range: "bytes=9-" },
    }), { params: Promise.resolve({ id }) });

    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */4");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    await expect(response.json()).resolves.toEqual({ error: "Intervalo de mídia inválido" });
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
