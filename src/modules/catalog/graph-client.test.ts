// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  createMetaCatalogGraphClient,
  MetaCatalogGraphError,
} from "./graph-client";

function jsonResponse(value: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function config(fetcher: typeof fetch) {
  return {
    graphVersion: "v23.0",
    catalogId: "123456789012345",
    phoneNumberId: "987654321098765",
    accessToken: "private-access-token",
    timeoutMs: 100,
    fetcher,
  };
}

function requestUrl(fetcher: ReturnType<typeof vi.fn>, index = 0): URL {
  const request = fetcher.mock.calls[index]?.[0];
  if (typeof request !== "string") throw new Error("Expected string request URL");
  return new URL(request);
}

describe("Meta catalog Graph client", () => {
  it("reads only the configured catalog summary fields", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: "123456789012345",
        name: "Catálogo XP",
        product_count: 42,
        owner_business: { id: "must-not-survive" },
      }),
    );

    await expect(
      createMetaCatalogGraphClient(config(fetcher)).getCatalogSummary(),
    ).resolves.toEqual({
      id: "123456789012345",
      name: "Catálogo XP",
      productCount: 42,
    });

    const url = requestUrl(fetcher);
    expect(url.origin).toBe("https://graph.facebook.com");
    expect(url.pathname).toBe("/v23.0/123456789012345");
    expect(url.searchParams.get("fields")).toBe("id,name,product_count");
    expect(url.searchParams.has("access_token")).toBe(false);
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("Authorization"))
      .toBe("Bearer private-access-token");
  });

  it("returns a bounded normalized product page and an opaque cursor", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          {
            retailer_id: "XP-01",
            name: "Controle PS5",
            description: "Sem fio",
            price: "399.90",
            currency: "BRL",
            availability: "in stock",
            visibility: "published",
            image_url: "https://images.example.test/xp-01.webp",
          },
        ],
        paging: {
          cursors: { after: "opaque-next-cursor" },
          next: "https://attacker.example/private-access-token",
        },
      }),
    );

    await expect(
      createMetaCatalogGraphClient(config(fetcher)).listProducts({
        query: "controle",
        cursor: "opaque-current-cursor",
        limit: 25,
      }),
    ).resolves.toEqual({
      products: [
        {
          retailerId: "XP-01",
          name: "Controle PS5",
          description: "Sem fio",
          priceText: "BRL 399.90",
          availability: "IN_STOCK",
          availableToSend: true,
          imageUrl: "https://images.example.test/xp-01.webp",
        },
      ],
      nextCursor: "opaque-next-cursor",
    });

    const url = requestUrl(fetcher);
    expect(url.pathname).toBe("/v23.0/123456789012345/products");
    expect(url.searchParams.get("fields")).toBe(
      "retailer_id,name,description,price,currency,availability,visibility,image_url",
    );
    expect(url.searchParams.get("limit")).toBe("25");
    expect(url.searchParams.get("after")).toBe("opaque-current-cursor");
    expect(url.searchParams.get("return_only_approved_products")).toBe("true");
    expect(url.searchParams.has("filter")).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("uses the documented product filter only for exact retailer ids", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          {
            retailer_id: "XP-02",
            name: "Headset",
            availability: "available for order",
            visibility: "published",
          },
        ],
      }),
    );

    await expect(
      createMetaCatalogGraphClient(config(fetcher)).getProductsByRetailerIds([
        "XP-02",
        "XP-02",
      ]),
    ).resolves.toMatchObject([{ retailerId: "XP-02" }]);

    const url = requestUrl(fetcher);
    expect(JSON.parse(url.searchParams.get("filter") ?? "null")).toEqual({
      retailer_id: { is_any: ["XP-02"] },
    });
    expect(url.searchParams.get("limit")).toBe("1");
  });

  it("reads commerce settings for the configured phone only", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [{ is_catalog_visible: true, is_cart_enabled: true }],
      }),
    );

    await expect(
      createMetaCatalogGraphClient(config(fetcher)).getCommerceSettings(),
    ).resolves.toEqual({ catalogVisible: true, cartEnabled: true });

    const url = requestUrl(fetcher);
    expect(url.pathname).toBe(
      "/v23.0/987654321098765/whatsapp_commerce_settings",
    );
    expect(url.searchParams.get("fields")).toBe(
      "is_catalog_visible,is_cart_enabled",
    );
  });

  it("rejects more than thirty exact retailer ids before fetching", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const promise = createMetaCatalogGraphClient(config(fetcher))
      .getProductsByRetailerIds(
        Array.from({ length: 31 }, (_, index) => `XP-${index}`),
      );

    await expect(promise).rejects.toEqual(
      new MetaCatalogGraphError("META_INVALID_RESPONSE"),
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects malformed and oversized product pages", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: [{ name: "Sem código" }] }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: Array.from({ length: 51 }, (_, index) => ({
            retailer_id: `XP-${index}`,
            name: `Produto ${index}`,
            availability: "in stock",
            visibility: "published",
          })),
        }),
      );
    const client = createMetaCatalogGraphClient(config(fetcher));

    await expect(
      client.listProducts({ query: "", cursor: null, limit: 20 }),
    ).rejects.toMatchObject({ code: "META_INVALID_RESPONSE" });
    await expect(
      client.listProducts({ query: "", cursor: null, limit: 50 }),
    ).rejects.toMatchObject({ code: "META_INVALID_RESPONSE" });
  });

  it.each([
    [401, "CATALOG_PERMISSION_REQUIRED"],
    [403, "CATALOG_PERMISSION_REQUIRED"],
    [404, "CATALOG_NOT_FOUND"],
    [429, "META_RATE_LIMITED"],
    [500, "META_UNAVAILABLE"],
  ] as const)("maps HTTP %s to %s without leaking the Graph body", async (status, code) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        { error: { message: "private-access-token private Graph detail" } },
        { status },
      ),
    );
    const promise = createMetaCatalogGraphClient(config(fetcher))
      .getCatalogSummary();

    await expect(promise).rejects.toMatchObject({ code });
    await expect(promise).rejects.not.toThrow(/private-access-token|Graph detail/i);
  });

  it.each([
    [10, "CATALOG_PERMISSION_REQUIRED"],
    [200, "CATALOG_PERMISSION_REQUIRED"],
    [100, "CATALOG_NOT_FOUND"],
  ] as const)("maps Graph code %s from HTTP 400 to %s", async (graphCode, code) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: graphCode,
            message: "private-access-token private Graph detail",
          },
        },
        { status: 400 },
      ),
    );
    const promise = createMetaCatalogGraphClient(config(fetcher))
      .getCatalogSummary();

    await expect(promise).rejects.toMatchObject({ code });
    await expect(promise).rejects.not.toThrow(/private-access-token|Graph detail/i);
  });

  it("rejects invalid or larger-than-two-megabyte JSON", async () => {
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("private malformed marker", { status: 200 }),
    );
    const oversized = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "content-length": String(2 * 1024 * 1024 + 1) },
      }),
    );

    await expect(
      createMetaCatalogGraphClient(config(malformed)).getCatalogSummary(),
    ).rejects.toEqual(new MetaCatalogGraphError("META_INVALID_RESPONSE"));
    await expect(
      createMetaCatalogGraphClient(config(oversized)).getCatalogSummary(),
    ).rejects.toEqual(new MetaCatalogGraphError("META_INVALID_RESPONSE"));
  });

  it("aborts a slow Graph request with a public timeout", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("private abort", "AbortError")),
          { once: true },
        );
      }),
    );

    await expect(
      createMetaCatalogGraphClient({
        ...config(fetcher),
        timeoutMs: 5,
      }).getCatalogSummary(),
    ).rejects.toEqual(new MetaCatalogGraphError("META_TIMEOUT"));
  });
});
