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
    const provider = new MetaWhatsAppProvider(config, fetchMock);

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
    const provider = new MetaWhatsAppProvider(config, fetchMock);

    await expect(
      provider.uploadMedia({
        bytes: new TextEncoder().encode("%PDF-1.7"),
        filename: "nota.pdf",
        mimeType: "application/pdf",
      }),
    ).resolves.toEqual({ mediaId: "media-1" });

    const upload = fetchMock.mock.calls[0]!;
    expect(upload[0]).toBe("https://graph.facebook.com/v23.0/123/media");
    expect(upload[1]?.headers).toEqual({ Authorization: "Bearer secret-token" });
    expect(upload[1]?.body).toBeInstanceOf(FormData);

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
    const provider = new MetaWhatsAppProvider(config, fetchMock);

    await expect(provider.getMediaMetadata("media-1")).resolves.toMatchObject({
      url: temporaryUrl,
      mimeType: "image/jpeg",
      sizeBytes: 4n,
    });
    await expect(provider.downloadMedia({ url: temporaryUrl, maximumBytes: 10 })).resolves.toMatchObject({
      mimeType: "image/jpeg",
      bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]),
    });

    expect(fetchMock.mock.calls[0]![0]).toBe("https://graph.facebook.com/v23.0/media-1?phone_number_id=123");
    expect(fetchMock.mock.calls[1]).toEqual([
      temporaryUrl,
      { headers: { Authorization: "Bearer secret-token" }, redirect: "manual" },
    ]);
  });

  it.each([
    "http://lookaside.fbsbx.com/file",
    "https://evil.example/file",
    "https://lookaside.fbsbx.com.evil.example/file",
    "https://user@lookaside.fbsbx.com/file",
  ])("rejects an unsafe media download URL without making a request: %s", async (url) => {
    const fetchMock = vi.fn<typeof fetch>();
    const provider = new MetaWhatsAppProvider(config, fetchMock);
    await expect(provider.downloadMedia({ url, maximumBytes: 10 })).rejects.toBeInstanceOf(WhatsAppProviderError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not follow a redirect returned by the temporary media host", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "https://evil.example/file" } }),
    );
    const provider = new MetaWhatsAppProvider(config, fetchMock);
    await expect(
      provider.downloadMedia({ url: "https://lookaside.fbsbx.com/file", maximumBytes: 10 }),
    ).rejects.toBeInstanceOf(WhatsAppProviderError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns a bounded Graph error without leaking access tokens", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ error: { message: `bad ${config.accessToken}\r\n`, type: "OAuthException", code: 190 } }, { status: 400 }),
    );
    const provider = new MetaWhatsAppProvider(config, fetchMock);

    const error = await provider.sendText({ to: "1", body: "x" }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WhatsAppProviderError);
    expect(String(error)).toContain("Graph 190");
    expect(String(error)).not.toContain(config.accessToken);
    expect(String(error)).not.toContain("\r");
  });
});

describe("demo WhatsApp provider", () => {
  it("returns simulated SENT identifiers in every outbound flow", async () => {
    const provider = new DemoWhatsAppProvider(() => "123e4567-e89b-42d3-a456-426614174000");
    await expect(provider.sendText({ to: "1", body: "oi" })).resolves.toEqual({
      whatsappMessageId: "demo-123e4567-e89b-42d3-a456-426614174000",
      status: "SENT",
    });
    await expect(provider.uploadMedia({ bytes: jpegBytes(), filename: "x.jpg", mimeType: "image/jpeg" }))
      .resolves.toEqual({ mediaId: "demo-123e4567-e89b-42d3-a456-426614174000" });
    await expect(provider.sendMedia({ to: "1", type: "image", mediaId: "demo-media" }))
      .resolves.toEqual({ whatsappMessageId: "demo-123e4567-e89b-42d3-a456-426614174000", status: "SENT" });
  });
});

function jpegBytes(): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
}
