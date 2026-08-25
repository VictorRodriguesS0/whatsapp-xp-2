// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { CatalogProduct } from "./schemas";
import {
  CatalogImageProxyError,
  createCatalogImageProxy,
} from "./image-proxy";

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

function product(imageUrl: string | null): CatalogProduct {
  return {
    retailerId: "SKU-1",
    name: "Controle sem fio",
    description: null,
    priceText: "BRL 199.90",
    availability: "IN_STOCK",
    availableToSend: true,
    imageUrl,
  };
}

function imageResponse(
  body: BodyInit | null = jpeg,
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "image/jpeg");
  return new Response(body, {
    ...init,
    status: 200,
    headers,
  });
}

describe("closed catalog image proxy", () => {
  it("loads only the image URL resolved from the known Meta product without forwarding authorization", async () => {
    const resolveProduct = vi.fn().mockResolvedValue(product("https://cdn.example.test/items/1.jpg"));
    const resolveHost = vi.fn().mockResolvedValue(["203.0.114.10"]);
    const request = vi.fn().mockResolvedValue(imageResponse());
    const proxy = createCatalogImageProxy({ resolveProduct, resolveHost, request });

    await expect(proxy.fetchProductImage("SKU-1")).resolves.toEqual({
      bytes: jpeg,
      contentType: "image/jpeg",
    });

    expect(resolveProduct).toHaveBeenCalledWith("SKU-1");
    expect(resolveHost).toHaveBeenCalledWith("cdn.example.test");
    expect(request).toHaveBeenCalledTimes(1);
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe("https://cdn.example.test/items/1.jpg");
    expect(init).toMatchObject({ redirect: "manual" });
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("accept")).toBe("image/jpeg, image/png, image/webp");
  });

  it.each([
    "http://cdn.example.test/item.jpg",
    "https://user:secret@cdn.example.test/item.jpg",
    "https://localhost/item.jpg",
    "https://sub.localhost/item.jpg",
    "https://127.0.0.1/item.jpg",
    "https://10.0.0.8/item.jpg",
    "https://100.64.0.1/item.jpg",
    "https://169.254.169.254/latest/meta-data",
    "https://172.16.0.1/item.jpg",
    "https://192.168.1.1/item.jpg",
    "https://224.0.0.1/item.jpg",
    "https://[::1]/item.jpg",
    "https://[fc00::1]/item.jpg",
    "https://[fe80::1]/item.jpg",
    "https://[ff02::1]/item.jpg",
    "https://[::ffff:127.0.0.1]/item.jpg",
  ])("rejects an unsafe product image URL before the request: %s", async (imageUrl) => {
    const request = vi.fn();
    const proxy = createCatalogImageProxy({
      resolveProduct: async () => product(imageUrl),
      resolveHost: async () => ["203.0.114.10"],
      request,
    });

    await expect(proxy.fetchProductImage("SKU-1")).rejects.toBeInstanceOf(CatalogImageProxyError);
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "192.168.0.10",
    "::1",
    "fc00::10",
    "fe80::10",
    "ff02::1",
  ])("rejects a hostname resolving to unsafe address %s", async (address) => {
    const request = vi.fn();
    const proxy = createCatalogImageProxy({
      resolveProduct: async () => product("https://cdn.example.test/item.jpg"),
      resolveHost: async () => [address],
      request,
    });

    await expect(proxy.fetchProductImage("SKU-1")).rejects.toMatchObject({ code: "UNSAFE_ORIGIN" });
    expect(request).not.toHaveBeenCalled();
  });

  it("re-resolves and rejects an unsafe redirect target before following it", async () => {
    const resolveHost = vi.fn()
      .mockResolvedValueOnce(["203.0.114.10"])
      .mockResolvedValueOnce(["169.254.169.254"]);
    const request = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: "https://metadata.example.test/latest" },
    }));
    const proxy = createCatalogImageProxy({
      resolveProduct: async () => product("https://cdn.example.test/item.jpg"),
      resolveHost,
      request,
    });

    await expect(proxy.fetchProductImage("SKU-1")).rejects.toMatchObject({ code: "UNSAFE_ORIGIN" });
    expect(resolveHost).toHaveBeenNthCalledWith(1, "cdn.example.test");
    expect(resolveHost).toHaveBeenNthCalledWith(2, "metadata.example.test");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("follows at most three validated redirects", async () => {
    const request = vi.fn().mockImplementation(async (url: string) => new Response(null, {
      status: 302,
      headers: { location: `${url}/next` },
    }));
    const proxy = createCatalogImageProxy({
      resolveProduct: async () => product("https://cdn.example.test/item.jpg"),
      resolveHost: async () => ["203.0.114.10"],
      request,
    });

    await expect(proxy.fetchProductImage("SKU-1")).rejects.toMatchObject({ code: "TOO_MANY_REDIRECTS" });
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("rejects unsupported content types and mismatched image signatures", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(imageResponse("<svg/>", { headers: { "content-type": "image/svg+xml" } }))
      .mockResolvedValueOnce(imageResponse(new Uint8Array([1, 2, 3])));
    const proxy = createCatalogImageProxy({
      resolveProduct: async () => product("https://cdn.example.test/item"),
      resolveHost: async () => ["203.0.114.10"],
      request,
    });

    await expect(proxy.fetchProductImage("SKU-1")).rejects.toMatchObject({ code: "UNSUPPORTED_IMAGE" });
    await expect(proxy.fetchProductImage("SKU-1")).rejects.toMatchObject({ code: "UNSUPPORTED_IMAGE" });
  });

  it("rejects oversized declared and streamed bodies", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(6));
        controller.enqueue(new Uint8Array(6));
        controller.close();
      },
    });
    const request = vi.fn()
      .mockResolvedValueOnce(imageResponse(null, { headers: { "content-length": "11" } }))
      .mockResolvedValueOnce(imageResponse(stream));
    const proxy = createCatalogImageProxy({
      resolveProduct: async () => product("https://cdn.example.test/item.jpg"),
      resolveHost: async () => ["203.0.114.10"],
      request,
      maximumBytes: 10,
    });

    await expect(proxy.fetchProductImage("SKU-1")).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" });
    await expect(proxy.fetchProductImage("SKU-1")).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" });
  });

  it("times out a slow upstream request", async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn().mockImplementation((_url: string, init: RequestInit) => (
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        })
      ));
      const proxy = createCatalogImageProxy({
        resolveProduct: async () => product("https://cdn.example.test/item.jpg"),
        resolveHost: async () => ["203.0.114.10"],
        request,
        timeoutMs: 100,
      });

      const pending = proxy.fetchProductImage("SKU-1");
      const assertion = expect(pending).rejects.toMatchObject({ code: "IMAGE_TIMEOUT" });
      await vi.advanceTimersByTimeAsync(101);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
