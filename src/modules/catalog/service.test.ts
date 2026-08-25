import { UserRole } from "@/generated/prisma/enums";
import { describe, expect, it, vi } from "vitest";

import type { SessionUser } from "@/modules/auth/session";

import {
  MetaCatalogGraphError,
  type MetaCatalogGraphClient,
} from "./graph-client";
import { createCatalogService } from "./service";

const admin: SessionUser = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Victor",
  email: "victor@example.test",
  role: UserRole.ADMIN,
};
const attendant: SessionUser = {
  ...admin,
  id: "00000000-0000-4000-8000-000000000002",
  name: "Marcos",
  email: "marcos@example.test",
  role: UserRole.ATTENDANT,
};

function product(retailerId: string, name: string, description: string | null = null) {
  return {
    retailerId,
    name,
    description,
    priceText: "BRL 100.00",
    availability: "IN_STOCK" as const,
    availableToSend: true,
    imageUrl: "https://images.example.test/product.webp",
  };
}

function client(overrides: Partial<MetaCatalogGraphClient> = {}): MetaCatalogGraphClient {
  return {
    getCatalogSummary: vi.fn().mockResolvedValue({
      id: "123456789012345",
      name: "Catálogo XP",
      productCount: 12,
    }),
    listProducts: vi.fn().mockResolvedValue({ products: [], nextCursor: null }),
    getProductsByRetailerIds: vi.fn().mockResolvedValue([]),
    getCommerceSettings: vi.fn().mockResolvedValue({
      catalogVisible: true,
      cartEnabled: true,
    }),
    ...overrides,
  };
}

describe("catalog service", () => {
  it("returns an isolated unconfigured admin status without a client", async () => {
    const service = createCatalogService({ catalogId: null, client: null });

    await expect(service.getStatus(admin)).resolves.toEqual({
      configured: false,
      ready: false,
      catalog: null,
      commerce: null,
      freshness: "UNAVAILABLE",
      lastSuccessAt: null,
      errorCode: "CATALOG_NOT_CONFIGURED",
    });
  });

  it("allows only admins to read status", async () => {
    const service = createCatalogService({
      catalogId: "123456789012345",
      client: client(),
    });

    await expect(service.getStatus(attendant)).rejects.toMatchObject({ status: 403 });
  });

  it("exposes only picker readiness to active attendants", async () => {
    const graph = client();
    const service = createCatalogService({
      catalogId: "123456789012345",
      client: graph,
    });

    await expect(service.getReadiness(attendant)).resolves.toBe(true);
    expect(graph.getCatalogSummary).toHaveBeenCalledTimes(1);
    expect(graph.getCommerceSettings).toHaveBeenCalledTimes(1);
  });

  it("keeps the picker hidden when the catalog is unconfigured or unavailable", async () => {
    await expect(
      createCatalogService({ catalogId: null, client: null }).getReadiness(attendant),
    ).resolves.toBe(false);
    const graph = client({
      getCatalogSummary: vi.fn().mockRejectedValue(new MetaCatalogGraphError("META_TIMEOUT")),
    });
    await expect(createCatalogService({
      catalogId: "123456789012345",
      client: graph,
    }).getReadiness(attendant)).resolves.toBe(false);
  });

  it("returns a ready masked status and reuses it while fresh", async () => {
    const graph = client();
    const service = createCatalogService({
      catalogId: "123456789012345",
      client: graph,
      now: () => new Date("2026-08-24T12:00:00.000Z"),
    });

    const first = await service.getStatus(admin);
    const second = await service.getStatus(admin);
    expect(first).toEqual({
      configured: true,
      ready: true,
      catalog: { idSuffix: "…012345", name: "Catálogo XP", productCount: 12 },
      commerce: { catalogVisible: true, cartEnabled: true },
      freshness: "FRESH",
      lastSuccessAt: "2026-08-24T12:00:00.000Z",
      errorCode: null,
    });
    expect(second).toEqual(first);
    expect(graph.getCatalogSummary).toHaveBeenCalledTimes(1);
    expect(graph.getCommerceSettings).toHaveBeenCalledTimes(1);
  });

  it("serves stale status only for a transient Graph failure", async () => {
    let now = new Date("2026-08-24T12:00:00.000Z");
    const graph = client();
    const service = createCatalogService({
      catalogId: "123456789012345",
      client: graph,
      now: () => now,
    });
    await service.getStatus(admin);
    now = new Date("2026-08-24T12:05:01.000Z");
    vi.mocked(graph.getCatalogSummary).mockRejectedValue(
      new MetaCatalogGraphError("META_TIMEOUT"),
    );

    await expect(service.getStatus(admin)).resolves.toMatchObject({
      freshness: "STALE",
      ready: false,
      errorCode: "META_TIMEOUT",
      catalog: { name: "Catálogo XP" },
    });
  });

  it("does not reuse stale status after a permission failure", async () => {
    let now = new Date("2026-08-24T12:00:00.000Z");
    const graph = client();
    const service = createCatalogService({
      catalogId: "123456789012345",
      client: graph,
      now: () => now,
    });
    await service.getStatus(admin);
    now = new Date("2026-08-24T12:05:01.000Z");
    vi.mocked(graph.getCatalogSummary).mockRejectedValue(
      new MetaCatalogGraphError("CATALOG_PERMISSION_REQUIRED"),
    );

    await expect(service.getStatus(admin)).resolves.toMatchObject({
      freshness: "UNAVAILABLE",
      ready: false,
      errorCode: "CATALOG_PERMISSION_REQUIRED",
      catalog: null,
      commerce: null,
    });
  });

  it("searches bounded Graph pages by name, description, or code", async () => {
    const graph = client({
      listProducts: vi
        .fn()
        .mockResolvedValueOnce({
          products: [product("CABO-01", "Cabo HDMI")],
          nextCursor: "graph-page-2",
        })
        .mockResolvedValueOnce({
          products: [
            product("CTRL-01", "Controle PS5"),
            product("FONE-01", "Headset", "Controle de volume"),
          ],
          nextCursor: null,
        }),
    });
    const service = createCatalogService({
      catalogId: "123456789012345",
      client: graph,
      now: () => new Date("2026-08-24T12:00:00.000Z"),
    });

    await expect(
      service.searchProducts(attendant, { query: " controle ", cursor: null, limit: 20 }),
    ).resolves.toEqual({
      products: [
        expect.objectContaining({ retailerId: "CTRL-01", imagePath: expect.stringContaining("CTRL-01") }),
        expect.objectContaining({ retailerId: "FONE-01", imagePath: expect.stringContaining("FONE-01") }),
      ],
      nextCursor: null,
      freshness: "FRESH",
      fetchedAt: "2026-08-24T12:00:00.000Z",
    });
    expect(graph.listProducts).toHaveBeenCalledTimes(2);
  });

  it("uses a stale product page on transient failure but not on permission failure", async () => {
    let now = new Date("2026-08-24T12:00:00.000Z");
    const graph = client({
      listProducts: vi.fn().mockResolvedValue({
        products: [product("CTRL-01", "Controle PS5")],
        nextCursor: null,
      }),
    });
    const service = createCatalogService({
      catalogId: "123456789012345",
      client: graph,
      now: () => now,
    });
    const input = { query: "controle", cursor: null, limit: 20 };
    await service.searchProducts(attendant, input);
    now = new Date("2026-08-24T12:05:01.000Z");
    vi.mocked(graph.listProducts).mockRejectedValue(
      new MetaCatalogGraphError("META_UNAVAILABLE"),
    );
    await expect(service.searchProducts(attendant, input)).resolves.toMatchObject({
      freshness: "STALE",
      products: [{ retailerId: "CTRL-01" }],
    });

    vi.mocked(graph.listProducts).mockRejectedValue(
      new MetaCatalogGraphError("CATALOG_PERMISSION_REQUIRED"),
    );
    await expect(service.searchProducts(attendant, input)).rejects.toMatchObject({
      code: "CATALOG_PERMISSION_REQUIRED",
    });
  });

  it("rate-limits repeated admin refreshes for sixty seconds", async () => {
    let now = new Date("2026-08-24T12:00:00.000Z");
    const service = createCatalogService({
      catalogId: "123456789012345",
      client: client(),
      now: () => now,
    });
    await service.refreshStatus(admin);
    now = new Date("2026-08-24T12:00:30.000Z");
    await expect(service.refreshStatus(admin)).rejects.toMatchObject({ status: 429 });
  });

  it("keeps the previous status visible when a forced refresh times out", async () => {
    const graph = client();
    const service = createCatalogService({
      catalogId: "123456789012345",
      client: graph,
      now: () => new Date("2026-08-24T12:00:00.000Z"),
    });
    await service.getStatus(admin);
    vi.mocked(graph.getCatalogSummary).mockRejectedValue(
      new MetaCatalogGraphError("META_TIMEOUT"),
    );

    await expect(service.refreshStatus(admin)).resolves.toMatchObject({
      freshness: "STALE",
      ready: false,
      catalog: { name: "Catálogo XP" },
      errorCode: "META_TIMEOUT",
    });
  });

  it("resolves a known product by exact retailer id", async () => {
    const graph = client({
      getProductsByRetailerIds: vi.fn().mockResolvedValue([
        product("CTRL-01", "Controle PS5"),
      ]),
    });
    const service = createCatalogService({
      catalogId: "123456789012345",
      client: graph,
    });

    await expect(service.resolveProduct("CTRL-01")).resolves.toMatchObject({
      retailerId: "CTRL-01",
    });
    await expect(service.resolveProduct("MISSING")).rejects.toMatchObject({
      code: "CATALOG_PRODUCT_NOT_FOUND",
    });
  });
});
