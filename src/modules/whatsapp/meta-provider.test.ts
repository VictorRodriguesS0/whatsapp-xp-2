// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { DemoWhatsAppProvider } from "./demo-provider";
import { MetaWhatsAppProvider, WhatsAppProviderError } from "./meta-provider";

const config = {
  version: "v23.0",
  phoneNumberId: "123",
  businessAccountId: "waba/123",
  accessToken: "secret-token",
};

function providerTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: "template-meta-id",
    name: " retomar_atendimento ",
    language: " pt_BR ",
    category: " UTILITY ",
    status: " APPROVED ",
    quality_score: { score: " GREEN " },
    components: [
      { type: " BODY ", text: " Olá, {{1}}! Podemos continuar? " },
      { type: "FOOTER", text: "XP Eletrônicos" },
    ],
    ...overrides,
  };
}

describe("Meta WhatsApp provider", () => {
  it("lists bounded templates through the encoded WABA endpoint and local cursor pagination", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          data: [providerTemplate()],
          paging: {
            cursors: { after: "cursor +/=" },
            next: "https://evil.example/steal-token",
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          data: [
            providerTemplate({
              id: "second-id",
              name: "segundo_template",
              quality_score: "YELLOW",
              components: [{ type: "BODY", format: "TEXT", text: "Oi" }],
            }),
          ],
          paging: { cursors: {} },
        }),
      );
    const provider = new MetaWhatsAppProvider(
      { ...config, timeoutMs: 1_000 },
      fetchMock,
    );

    await expect(provider.listTemplates()).resolves.toEqual([
      {
        metaId: "template-meta-id",
        name: "retomar_atendimento",
        language: "pt_BR",
        category: "UTILITY",
        status: "APPROVED",
        qualityScore: "GREEN",
        components: [
          { type: "BODY", format: null, text: "Olá, {{1}}! Podemos continuar?" },
          { type: "FOOTER", format: null, text: "XP Eletrônicos" },
        ],
      },
      {
        metaId: "second-id",
        name: "segundo_template",
        language: "pt_BR",
        category: "UTILITY",
        status: "APPROVED",
        qualityScore: "YELLOW",
        components: [{ type: "BODY", format: "TEXT", text: "Oi" }],
      },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      expect(call[1]).toMatchObject({
        headers: { Authorization: "Bearer secret-token" },
        signal: expect.any(AbortSignal),
      });
      expect(call[1]?.method).toBeUndefined();
    }
    const first = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(`${first.origin}${first.pathname}`).toBe(
      "https://graph.facebook.com/v23.0/waba%2F123/message_templates",
    );
    expect(Object.fromEntries(first.searchParams)).toEqual({
      fields: "id,name,status,category,language,quality_score,components",
      limit: "100",
    });
    const second = new URL(String(fetchMock.mock.calls[1]![0]));
    expect(second.origin).toBe("https://graph.facebook.com");
    expect(second.pathname).toBe("/v23.0/waba%2F123/message_templates");
    expect(second.searchParams.get("after")).toBe("cursor +/=");
  });

  it("rejects repeated cursors and pagination beyond twenty pages", async () => {
    const repeatedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ data: [], paging: { cursors: { after: "same" } } }),
      );
    const repeated = new MetaWhatsAppProvider(
      { ...config, timeoutMs: 1_000 },
      repeatedFetch,
    );

    await expect(repeated.listTemplates()).rejects.toMatchObject({
      kind: "unknown",
      graphCode: null,
    });
    expect(repeatedFetch).toHaveBeenCalledTimes(2);

    let page = 0;
    const endlessFetch = vi.fn<typeof fetch>().mockImplementation(async () => {
      page += 1;
      return Response.json({
        data: [],
        paging: { cursors: { after: `cursor-${page}` } },
      });
    });
    const endless = new MetaWhatsAppProvider(
      { ...config, timeoutMs: 1_000 },
      endlessFetch,
    );
    await expect(endless.listTemplates()).rejects.toMatchObject({ kind: "unknown" });
    expect(endlessFetch).toHaveBeenCalledTimes(20);
  });

  it("rejects a synchronization result above two thousand templates", async () => {
    const data = Array.from({ length: 2_001 }, (_, index) => ({
      id: `id-${index}`,
      name: `template_${index}`,
      language: "pt_BR",
      category: "UTILITY",
      status: "APPROVED",
      components: [],
    }));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ data }));
    const provider = new MetaWhatsAppProvider(
      { ...config, timeoutMs: 1_000 },
      fetchMock,
    );

    await expect(provider.listTemplates()).rejects.toMatchObject({
      kind: "unknown",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    ["malformed JSON", new TextEncoder().encode("{")],
    ["malformed UTF-8", Uint8Array.from([0xc3, 0x28])],
  ])("rejects %s in a template page", async (_label, body) => {
    const provider = new MetaWhatsAppProvider(
      { ...config, timeoutMs: 1_000 },
      async () => new Response(body),
    );
    await expect(provider.listTemplates()).rejects.toMatchObject({ kind: "unknown" });
  });

  it.each([
    { paging: {} },
    { data: "not-an-array" },
    { data: [providerTemplate({ id: "" })] },
    { data: [providerTemplate({ id: "x".repeat(257) })] },
    { data: [providerTemplate({ components: [{ type: "BODY", text: 123 }] })] },
  ])("rejects a malformed template-list schema %#", async (payload) => {
    const provider = new MetaWhatsAppProvider(
      { ...config, timeoutMs: 1_000 },
      async () => Response.json(payload),
    );
    await expect(provider.listTemplates()).rejects.toMatchObject({ kind: "unknown" });
  });

  it("caps each template page at 512 KiB and applies one total timeout", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(513 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    const oversized = new MetaWhatsAppProvider(
      { ...config, timeoutMs: 1_000 },
      async () => new Response(body),
    );
    await expect(oversized.listTemplates()).rejects.toMatchObject({ kind: "unknown" });
    expect(cancelled).toBe(true);

    const timedOut = new MetaWhatsAppProvider(
      { ...config, timeoutMs: 10 },
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    await expect(timedOut.listTemplates()).rejects.toMatchObject({
      kind: "unknown",
      graphCode: null,
    });
  });

  it("sends a template with the exact official body-parameter payload", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ messages: [{ id: "wamid.template" }] }),
    );
    const provider = new MetaWhatsAppProvider(
      { ...config, timeoutMs: 1_000 },
      fetchMock,
    );

    await expect(
      provider.sendTemplate({
        to: "5561999999999",
        name: "retomar_atendimento",
        language: "pt_BR",
        bodyParameters: [{ type: "text", text: "Carlos" }],
      }),
    ).resolves.toEqual({ whatsappMessageId: "wamid.template", status: "SENT" });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "5561999999999",
      type: "template",
      template: {
        name: "retomar_atendimento",
        language: { code: "pt_BR" },
        components: [
          {
            type: "body",
            parameters: [{ type: "text", text: "Carlos" }],
          },
        ],
      },
    });
  });

  it("sends product, product list and catalog with the exact official payloads", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
      Response.json({ messages: [{ id: "wamid.catalog" }] }),
    );
    const provider = new MetaWhatsAppProvider(
      { ...config, catalogId: "367025965434465", timeoutMs: 1_000 },
      fetchMock,
    );

    await provider.sendProduct({
      to: "5561999999999",
      retailerId: "XP-CONTROLE-01",
      body: "Confira este produto",
      footer: "XP Eletrônicos",
    });
    await provider.sendProductList({
      to: "5561999999999",
      retailerIds: ["XP-CONTROLE-01", "XP-CONTROLE-02"],
      header: "Produtos selecionados",
      body: "Confira estas opções",
      footer: "XP Eletrônicos",
      sectionTitle: "Produtos",
    });
    await provider.sendCatalog({
      to: "5561999999999",
      body: "Confira nosso catálogo",
      thumbnailRetailerId: "XP-CONTROLE-01",
    });

    expect(fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body))))
      .toEqual([
        {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: "5561999999999",
          type: "interactive",
          interactive: {
            type: "product",
            body: { text: "Confira este produto" },
            footer: { text: "XP Eletrônicos" },
            action: {
              catalog_id: "367025965434465",
              product_retailer_id: "XP-CONTROLE-01",
            },
          },
        },
        {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: "5561999999999",
          type: "interactive",
          interactive: {
            type: "product_list",
            header: { type: "text", text: "Produtos selecionados" },
            body: { text: "Confira estas opções" },
            footer: { text: "XP Eletrônicos" },
            action: {
              catalog_id: "367025965434465",
              sections: [{
                title: "Produtos",
                product_items: [
                  { product_retailer_id: "XP-CONTROLE-01" },
                  { product_retailer_id: "XP-CONTROLE-02" },
                ],
              }],
            },
          },
        },
        {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: "5561999999999",
          type: "interactive",
          interactive: {
            type: "catalog_message",
            body: { text: "Confira nosso catálogo" },
            action: {
              name: "catalog_message",
              parameters: {
                thumbnail_product_retailer_id: "XP-CONTROLE-01",
              },
            },
          },
        },
      ]);
  });

  it("rejects catalog sends without a configured catalog or with duplicate list items", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const unconfigured = new MetaWhatsAppProvider(config, fetchMock);
    const configured = new MetaWhatsAppProvider(
      { ...config, catalogId: "367025965434465" },
      fetchMock,
    );

    await expect(unconfigured.sendProduct({
      to: "5561999999999",
      retailerId: "XP-1",
      body: "Produto",
      footer: "XP Eletrônicos",
    })).rejects.toMatchObject({ kind: "rejected", graphCode: null });
    await expect(configured.sendProductList({
      to: "5561999999999",
      retailerIds: ["XP-1", "XP-1"],
      header: "Produtos",
      body: "Confira",
      footer: "XP Eletrônicos",
      sectionTitle: "Produtos",
    })).rejects.toMatchObject({ kind: "rejected", graphCode: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["👍", ""])("sends a Meta reaction while preserving emoji %j", async (emoji) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ messaging_product: "whatsapp", messages: [{ id: "wamid.reaction" }] }),
    );
    const provider = new MetaWhatsAppProvider(
      { ...config, timeoutMs: 1_000, maximumJsonBytes: 1024 },
      fetchMock,
    );

    await expect(provider.sendReaction({
      to: "5561999999999",
      targetWhatsappMessageId: "wamid.target",
      emoji,
    })).resolves.toEqual({ whatsappMessageId: "wamid.reaction", status: "SENT" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0]![1]!;
    expect(JSON.parse(String(request.body))).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "5561999999999",
      type: "reaction",
      reaction: { message_id: "wamid.target", emoji },
    });
  });

  it("classifies an invalid reaction response as an unknown outcome", async () => {
    const provider = new MetaWhatsAppProvider(
      { ...config, timeoutMs: 1_000, maximumJsonBytes: 1024 },
      async () => Response.json({ messaging_product: "whatsapp", messages: [] }),
    );
    await expect(provider.sendReaction({
      to: "5561999999999",
      targetWhatsappMessageId: "wamid.target",
      emoji: "👍",
    })).rejects.toMatchObject({ kind: "unknown" });
  });

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
    let uploadedBodyBytes = 0;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async (_input, init) => {
        uploadedBodyBytes = (await new Response(init?.body as BodyInit).arrayBuffer()).byteLength;
        return Response.json({ id: "media-1" });
      })
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
    expect(uploadedBodyBytes).toBeGreaterThan(8);
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
    expect(mediaBodies.every((body) => !("context" in body))).toBe(true);
    expect(mediaBodies[3].document).toEqual({ id: "media-1", caption: "Legenda", filename: "nota.pdf" });
  });

  it("adds the official root reply context to text and every supported media type", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
      Response.json({ messaging_product: "whatsapp", messages: [{ id: "wamid.reply" }] })
    );
    const provider = new MetaWhatsAppProvider(
      { ...config, timeoutMs: 1_000, maximumJsonBytes: 1024 },
      fetchMock,
    );
    const contextMessageId = "wamid.original-1";

    await provider.sendText({
      to: "5561999999999",
      body: "Resposta",
      contextMessageId,
    });
    for (const type of ["image", "audio", "video", "document"] as const) {
      await provider.sendMedia({
        to: "5561999999999",
        type,
        mediaId: `media-${type}`,
        contextMessageId,
      });
    }

    const bodies = fetchMock.mock.calls.map((call) =>
      JSON.parse(String(call[1]?.body)) as Record<string, unknown>
    );
    expect(bodies).toHaveLength(5);
    expect(bodies.map(({ context }) => context)).toEqual(
      Array(5).fill({ message_id: contextMessageId }),
    );
    expect(bodies.map(({ type }) => type)).toEqual([
      "text",
      "image",
      "audio",
      "video",
      "document",
    ]);
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

  it("marks an inbound message read with the exact official payload", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{"success":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const provider = new MetaWhatsAppProvider(config, fetchMock);

    await expect(
      provider.markRead({ messageId: "wamid.inbound-1" }),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://graph.facebook.com/v23.0/123/messages");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer secret-token",
        "Content-Type": "application/json",
      },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.inbound-1",
    });
  });

  it.each([
    ["false success", '{"success":false}'],
    ["missing success", "{}"],
  ])("rejects an invalid read acknowledgement: %s", async (_name, body) => {
    const provider = new MetaWhatsAppProvider(
      config,
      vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 200 })),
    );

    await expect(provider.markRead({ messageId: "wamid.inbound-1" }))
      .rejects.toMatchObject({ name: "WhatsAppProviderError", kind: "unknown" });
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
    expect(error).toMatchObject({ graphCode: "190" });
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

    await expect(rejected.sendText({ to: "1", body: "x" })).rejects.toMatchObject({ kind: "rejected", graphCode: "131047" });
    await expect(unknown.sendText({ to: "1", body: "x" })).rejects.toMatchObject({ kind: "unknown", graphCode: null });
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
    await expect(provider.sendReaction({ to: "1", targetWhatsappMessageId: "wamid.target", emoji: "👍" }))
      .resolves.toEqual({ whatsappMessageId: "demo-reaction-123e4567-e89b-42d3-a456-426614174000", status: "SENT" });
    await expect(provider.listTemplates()).resolves.toEqual([]);
    await expect(provider.sendTemplate({
      to: "1",
      name: "retomar_atendimento",
      language: "pt_BR",
      bodyParameters: [{ type: "text", text: "cliente" }],
    })).resolves.toEqual({
      whatsappMessageId: "demo-123e4567-e89b-42d3-a456-426614174000",
      status: "SENT",
    });
    await expect(provider.sendProduct({
      to: "1",
      retailerId: "XP-1",
      body: "Produto",
      footer: "XP Eletrônicos",
    })).resolves.toEqual({
      whatsappMessageId: "demo-123e4567-e89b-42d3-a456-426614174000",
      status: "SENT",
    });
    await expect(provider.sendProductList({
      to: "1",
      retailerIds: ["XP-1"],
      header: "Produtos",
      body: "Confira",
      footer: "XP Eletrônicos",
      sectionTitle: "Produtos",
    })).resolves.toEqual({
      whatsappMessageId: "demo-123e4567-e89b-42d3-a456-426614174000",
      status: "SENT",
    });
    await expect(provider.sendCatalog({
      to: "1",
      body: "Catálogo",
      thumbnailRetailerId: null,
    })).resolves.toEqual({
      whatsappMessageId: "demo-123e4567-e89b-42d3-a456-426614174000",
      status: "SENT",
    });
  });
});

function jpegBytes(): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]);
}
