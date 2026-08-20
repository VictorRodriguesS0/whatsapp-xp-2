// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { DemoWhatsAppProvider } from "./demo-provider";
import { MetaWhatsAppProvider, WhatsAppProviderError } from "./meta-provider";

const config = {
  version: "v23.0",
  phoneNumberId: "123",
  accessToken: "secret-token",
};

describe("Meta WhatsApp provider", () => {
  it("uses the configured Graph version and bearer token for text", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ messaging_product: "whatsapp", contacts: [{ input: "5561999999999", wa_id: "5561999999999" }], messages: [{ id: "wamid.1" }] }),
    );
    const provider = new MetaWhatsAppProvider({ ...config, timeoutMs: 1_000, maximumJsonBytes: 1024 }, fetchMock);

    await expect(provider.sendText({ to: "5561999999999", body: "Olá" })).resolves.toEqual({
      whatsappMessageId: "wamid.1",
      status: "SENT",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://graph.facebook.com/v23.0/123/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer secret-token" }),
      }),
    );
    const request = fetchMock.mock.calls[0]![1]!;
    expect(JSON.parse(String(request.body))).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "5561999999999",
      type: "text",
      text: { body: "Olá", preview_url: false },
    });
  });

  it("uploads multipart media and sends every supported media type", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ id: "media-1" }))
      .mockImplementation(async () =>
        Response.json({ messaging_product: "whatsapp", messages: [{ id: "wamid.media" }] }),
      );
    const provider = new MetaWhatsAppProvider({ ...config, timeoutMs: 1_000, maximumJsonBytes: 1024 }, fetchMock);

    await expect(
      provider.uploadMedia({
        sizeBytes: 8n,
        open: async () => new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("%PDF-1.7")); controller.close(); } }),
        filename: "nota.pdf",
        mimeType: "application/pdf",
      }),
    ).resolves.toEqual({ mediaId: "media-1" });

    const upload = fetchMock.mock.calls[0]!;
    expect(upload[0]).toBe("https://graph.facebook.com/v23.0/123/media");
    expect(upload[1]?.body).toBeInstanceOf(ReadableStream);
    expect(upload[1]?.headers).toMatchObject({ Authorization: "Bearer secret-token", "Content-Type": expect.stringContaining("multipart/form-data; boundary=") });

    for (const type of ["image", "audio", "video", "document"] as const) {
      await provider.sendMedia({
        to: "5561999999999",
        type,
        mediaId: "media-1",
        caption: type === "audio" ? undefined : "Legenda",
        filename: type === "document" ? "nota.pdf" : undefined,
      });
    }

    const mediaBodies = fetchMock.mock.calls.slice(1).map((call) => JSON.parse(String(call[1]?.body)));
    expect(mediaBodies.map((body) => body.type)).toEqual(["image", "audio", "video", "document"]);
    expect(mediaBodies[3].document).toEqual({ id: "media-1", caption: "Legenda", filename: "nota.pdf" });
  });

  it("retrieves metadata through Graph and downloads only an allowlisted HTTPS temporary host without redirects", async () => {
    const temporaryUrl = "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=media-1";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({
        messaging_product: "whatsapp",
        url: temporaryUrl,
        mime_type: "image/jpeg",
        sha256: "base64-sha",
        file_size: 4,
        id: "media-1",
      }))
      .mockResolvedValueOnce(new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), {
        headers: { "content-type": "image/jpeg", "content-length": "4" },
      }));
    const provider = new MetaWhatsAppProvider({ ...config, timeoutMs: 1_000, maximumJsonBytes: 1024 }, fetchMock);

    await expect(provider.getMediaMetadata("media-1")).resolves.toMatchObject({
      url: temporaryUrl,
      mimeType: "image/jpeg",
      sizeBytes: 4n,
    });
    const downloaded = await provider.downloadMedia({ url: temporaryUrl, maximumBytes: 10 });
    await expect(new Response(downloaded.stream).arrayBuffer()).resolves.toEqual(
      Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]).buffer,
    );
    expect(downloaded).toMatchObject({ mimeType: "image/jpeg", sizeBytes: 4n });

    expect(fetchMock.mock.calls[0]![0]).toBe("https://graph.facebook.com/v23.0/media-1?phone_number_id=123");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(temporaryUrl);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: { Authorization: "Bearer secret-token" },
      redirect: "manual",
      signal: expect.any(AbortSignal),
    });
  });

  it.each([
    "http://lookaside.fbsbx.com/file",
    "https://evil.example/file",
    "https://lookaside.fbsbx.com.evil.example/file",
    "https://user@lookaside.fbsbx.com/file",
  ])("rejects an unsafe media download URL without making a request: %s", async (url) => {
    const fetchMock = vi.fn<typeof fetch>();
    const provider = new MetaWhatsAppProvider({ ...config, timeoutMs: 1_000, maximumJsonBytes: 1024 }, fetchMock);
    await expect(provider.downloadMedia({ url, maximumBytes: 10 })).rejects.toBeInstanceOf(WhatsAppProviderError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not follow a redirect returned by the temporary media host", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "https://evil.example/file" } }),
    );
    const provider = new MetaWhatsAppProvider({ ...config, timeoutMs: 1_000, maximumJsonBytes: 1024 }, fetchMock);
    await expect(
      provider.downloadMedia({ url: "https://lookaside.fbsbx.com/file", maximumBytes: 10 }),
    ).rejects.toBeInstanceOf(WhatsAppProviderError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns a bounded Graph error without leaking access tokens", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ error: { message: `bad ${config.accessToken}\r\n`, type: "OAuthException", code: 190 } }, { status: 400 }),
    );
    const provider = new MetaWhatsAppProvider({ ...config, timeoutMs: 1_000, maximumJsonBytes: 1024 }, fetchMock);

    const error = await provider.sendText({ to: "1", body: "x" }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WhatsAppProviderError);
    expect(String(error)).toContain("Graph 190");
    expect(String(error)).not.toContain(config.accessToken);
    expect(String(error)).not.toContain("\r");
  });

  it("classifies a definitive Graph rejection separately from an unknown transport outcome", async () => {
    const rejected = new MetaWhatsAppProvider(
      { ...config, timeoutMs: 1_000, maximumJsonBytes: 1024 },
      async () => Response.json({ error: { code: 131047, message: "rejected" } }, { status: 400 }),
    );
    const unknown = new MetaWhatsAppProvider(
      { ...config, timeoutMs: 10, maximumJsonBytes: 1024 },
      async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    );

    await expect(rejected.sendText({ to: "1", body: "x" })).rejects.toMatchObject({ kind: "rejected" });
    await expect(unknown.sendText({ to: "1", body: "x" })).rejects.toMatchObject({ kind: "unknown" });
  });

  it.each([408, 429, 500, 503])("classifies retryable Graph HTTP %s as unknown for outbound send", async (status) => {
    const provider = new MetaWhatsAppProvider(
      { ...config, timeoutMs: 1_000, maximumJsonBytes: 1024 },
      async () => Response.json({ error: { code: status, message: "retry later" } }, { status }),
    );

    await expect(provider.sendText({ to: "1", body: "x" })).rejects.toMatchObject({ kind: "unknown" });
  });

  it("keeps a definitive allowlisted Graph 4xx as rejected", async () => {
    const provider = new MetaWhatsAppProvider(
      { ...config, timeoutMs: 1_000, maximumJsonBytes: 1024 },
      async () => Response.json({ error: { code: 400, message: "bad request" } }, { status: 400 }),
    );
    await expect(provider.sendText({ to: "1", body: "x" })).rejects.toMatchObject({ kind: "rejected" });
  });

  it("classifies retryable HTTP failures in upload, metadata and download as unknown", async () => {
    const upload = new MetaWhatsAppProvider(
      { ...config, timeoutMs: 1_000, maximumJsonBytes: 1024 },
      async (_url, init) => {
        await (init?.body as ReadableStream<Uint8Array>).cancel();
        return Response.json({ error: { code: 503 } }, { status: 503 });
      },
    );
    const metadata = new MetaWhatsAppProvider(
      { ...config, timeoutMs: 1_000, maximumJsonBytes: 1024 },
      async () => Response.json({ error: { code: 429 } }, { status: 429 }),
    );
    const download = new MetaWhatsAppProvider(
      { ...config, timeoutMs: 1_000, maximumJsonBytes: 1024 },
      async () => new Response("retry", { status: 500 }),
    );

    await expect(upload.uploadMedia({
      sizeBytes: 1n,
      open: async () => new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.of(1)); controller.close(); } }),
      filename: "x.jpg",
      mimeType: "image/jpeg",
    })).rejects.toMatchObject({ kind: "unknown" });
    await expect(metadata.getMediaMetadata("media-1")).rejects.toMatchObject({ kind: "unknown" });
    await expect(download.downloadMedia({ url: "https://lookaside.fbsbx.com/file", maximumBytes: 10 }))
      .rejects.toMatchObject({ kind: "unknown" });
  });

  it("rejects oversized or truncated JSON as unknown without buffering an unbounded body", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(40).fill(0x61));
      },
      cancel() { cancelled = true; },
    });
    const provider = new MetaWhatsAppProvider(
      { ...config, timeoutMs: 1_000, maximumJsonBytes: 32 },
      async () => new Response(body, { status: 200 }),
    );

    await expect(provider.sendText({ to: "1", body: "x" })).rejects.toMatchObject({ kind: "unknown" });
    expect(cancelled).toBe(true);
  });

  it("classifies a truncated media response as unknown while streaming", async () => {
    const provider = new MetaWhatsAppProvider(
      { ...config, timeoutMs: 1_000, maximumJsonBytes: 1024 },
      async () => new Response(Uint8Array.from([1, 2, 3, 4]), { headers: { "content-type": "image/jpeg", "content-length": "5" } }),
    );
    const download = await provider.downloadMedia({ url: "https://lookaside.fbsbx.com/file", maximumBytes: 10 });
    await expect(new Response(download.stream).arrayBuffer()).rejects.toMatchObject({ kind: "unknown" });
  });
});

describe("demo WhatsApp provider", () => {
  it("returns simulated SENT identifiers in every outbound flow", async () => {
    const provider = new DemoWhatsAppProvider(() => "123e4567-e89b-42d3-a456-426614174000");
    await expect(provider.sendText({ to: "1", body: "oi" })).resolves.toEqual({
      whatsappMessageId: "demo-123e4567-e89b-42d3-a456-426614174000",
      status: "SENT",
    });
    await expect(provider.uploadMedia({ sizeBytes: 4n, open: async () => new ReadableStream({ start(controller) { controller.enqueue(jpegBytes()); controller.close(); } }), filename: "x.jpg", mimeType: "image/jpeg" }))
      .resolves.toEqual({ mediaId: "demo-123e4567-e89b-42d3-a456-426614174000" });
    await expect(provider.sendMedia({ to: "1", type: "image", mediaId: "demo-media" }))
      .resolves.toEqual({ whatsappMessageId: "demo-123e4567-e89b-42d3-a456-426614174000", status: "SENT" });
  });
});

function jpegBytes(): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
}
